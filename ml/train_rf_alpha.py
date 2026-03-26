#!/usr/bin/env python3
"""
Train RandomForestRegressor for forward excess return vs SPY (~63 trading days).
Pipeline: SimpleImputer -> StandardScaler -> BaggingRegressor(RandomForestRegressor) for extra bootstrap variance reduction.

CSV: data/ml_panel.csv with all columns in ml/features_schema.json plus target column
     forward_excess_vs_spy_63d (float), or forward_return_63d + spy_forward_return_63d to derive.

Options:
  --exclude-recent-months N  Drop the last N*22 rows (approx trading months) after sort by `asof_date` if present.
  --tssplits K               Use TimeSeriesSplit(K); last fold is test; train on all prior (after exclude).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import BaggingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models"
DATA_DIR = ROOT / "data"
SCHEMA_PATH = Path(__file__).resolve().parent / "features_schema.json"


def load_feature_names() -> list[str]:
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)["features"]


def build_synthetic_alpha_panel(feature_names: list[str], n: int = 1000, seed: int = 42) -> tuple[pd.DataFrame, np.ndarray]:
    rng = np.random.default_rng(seed)
    X = rng.normal(0, 1, size=(n, len(feature_names)))
    # Moat-ish + relative strength tail + noise -> synthetic excess return
    moat_i = 1 if "moat_score" in feature_names else 0
    rs3 = feature_names.index("rel_excess_3m") if "rel_excess_3m" in feature_names else -1
    y = rng.normal(0, 0.04, size=n)
    if moat_i >= 0:
        y += X[:, moat_i] * 0.0008
    if rs3 >= 0:
        y += X[:, rs3] * 0.02
    y += X[:, :5].sum(axis=1) * 0.002
    df = pd.DataFrame(X, columns=feature_names)
    return df, y.astype(np.float64), None


def load_alpha_panel(
    path: Path, feature_names: list[str]
) -> tuple[pd.DataFrame, np.ndarray, pd.Series | None] | None:
    if not path.is_file():
        return None
    df = pd.read_csv(path)
    missing = [c for c in feature_names if c not in df.columns]
    if missing:
        print(f"CSV missing feature columns: {missing[:10]}...", file=sys.stderr)
        return None

    y = None
    if "forward_excess_vs_spy_63d" in df.columns:
        y = df["forward_excess_vs_spy_63d"].values.astype(float)
    elif "forward_return_63d" in df.columns and "spy_forward_return_63d" in df.columns:
        y = (
            df["forward_return_63d"].values.astype(float)
            - df["spy_forward_return_63d"].values.astype(float)
        )
    else:
        print(
            "CSV needs forward_excess_vs_spy_63d or (forward_return_63d and spy_forward_return_63d)",
            file=sys.stderr,
        )
        return None

    date_series = None
    if "asof_date" in df.columns:
        date_series = pd.to_datetime(df["asof_date"], errors="coerce")
        order = date_series.argsort(kind="mergesort")
        df = df.iloc[order].reset_index(drop=True)
        y = y[order]
        date_series = date_series.iloc[order].reset_index(drop=True)

    X = df[feature_names].copy()
    return X, y, date_series


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exclude-recent-months", type=int, default=0, help="Drop last N*22 rows (if asof_date sorted)")
    ap.add_argument("--tssplits", type=int, default=0, help="If >=2, TimeSeriesSplit for last-fold test")
    ap.add_argument("--bagging", type=int, default=12, help="BaggingRegressor n_estimators (0 = plain RF only)")
    args = ap.parse_args()

    feature_names = load_feature_names()
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    panel_path = DATA_DIR / "ml_panel.csv"

    loaded = load_alpha_panel(panel_path, feature_names)
    if loaded is None:
        X_df, y, _dates = build_synthetic_alpha_panel(feature_names)
        print("No valid ml_panel.csv — training synthetic alpha model (not for production).")
        synthetic = True
    else:
        X_df, y, dates = loaded
        synthetic = False
        if args.exclude_recent_months > 0 and dates is not None and len(X_df) > args.exclude_recent_months * 22:
            cut = int(args.exclude_recent_months * 22)
            X_df = X_df.iloc[:-cut].reset_index(drop=True)
            y = y[:-cut]

    X = X_df.values.astype(float)
    n = len(X)
    if n < 50:
        print("Too few rows after filters.", file=sys.stderr)
        return 1

    if args.tssplits and args.tssplits >= 2:
        tscv = TimeSeriesSplit(n_splits=args.tssplits)
        splits = list(tscv.split(X))
        train_idx, test_idx = splits[-1]
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]
    else:
        split = int(n * 0.8)
        X_train, X_test = X[:split], X[split:]
        y_train, y_test = y[:split], y[split:]

    rf = RandomForestRegressor(
        n_estimators=120,
        max_depth=14,
        min_samples_leaf=6,
        random_state=42,
        n_jobs=-1,
        max_samples=0.85,
    )
    if args.bagging and args.bagging > 0:
        est = BaggingRegressor(
            estimator=rf,
            n_estimators=int(args.bagging),
            max_samples=0.75,
            bootstrap=True,
            random_state=43,
            n_jobs=-1,
        )
    else:
        est = rf

    pipe = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", est),
        ]
    )
    pipe.fit(X_train, y_train)
    pred_test = pipe.predict(X_test)
    mse = float(mean_squared_error(y_test, pred_test))
    r2 = float(r2_score(y_test, pred_test)) if len(np.unique(y_test)) > 1 else float("nan")

    out_path = MODEL_DIR / "rf_alpha_regressor.joblib"
    joblib.dump(pipe, out_path)
    metrics = {
        "model": "RandomForestRegressor_bagged" if args.bagging else "RandomForestRegressor",
        "target": "forward_excess_vs_spy_63d",
        "mse_test": mse,
        "rmse_test": float(np.sqrt(mse)),
        "r2_test": r2,
        "n_train": int(len(y_train)),
        "n_test": int(len(y_test)),
        "n_features": len(feature_names),
        "feature_names": feature_names,
        "synthetic": synthetic,
        "exclude_recent_months": args.exclude_recent_months,
        "tssplits": args.tssplits or None,
    }
    with open(MODEL_DIR / "rf_alpha_metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
