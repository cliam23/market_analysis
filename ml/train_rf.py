#!/usr/bin/env python3
"""
Train RandomForestClassifier for P(positive 20d return) with scaled features (Lecture 8).
Pipeline: SimpleImputer -> StandardScaler -> [optional PCA whiten] -> RandomForestClassifier
Label: label_pos_20d, or derived from forward_return_20d / forward_annualized_return in CSV.
Writes models/rf_regressor.joblib (pipeline; name kept for predict.py), models/rf_metrics.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models"
DATA_DIR = ROOT / "data"
SCHEMA_PATH = Path(__file__).resolve().parent / "features_schema.json"


def load_feature_names() -> list[str]:
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)["features"]


def build_synthetic_panel(feature_names: list[str], n: int = 800, seed: int = 42) -> tuple[pd.DataFrame, np.ndarray]:
    rng = np.random.default_rng(seed)
    X = rng.normal(0, 1, size=(n, len(feature_names)))
    logit = X[:, :8].sum(axis=1) * 0.4 + rng.normal(0, 0.8, size=n)
    y = (logit > 0).astype(np.int32)
    df = pd.DataFrame(X, columns=feature_names)
    return df, y


def load_panel_csv(path: Path, feature_names: list[str]) -> tuple[pd.DataFrame, np.ndarray] | None:
    if not path.is_file():
        return None
    df = pd.read_csv(path)
    missing = [c for c in feature_names if c not in df.columns]
    if missing:
        print(f"CSV missing columns: {missing[:8]}...", file=sys.stderr)
        return None

    X = df[feature_names].copy()

    if "label_pos_20d" in df.columns:
        y = df["label_pos_20d"].values.astype(int)
    elif "forward_return_20d" in df.columns:
        y = (df["forward_return_20d"].values.astype(float) > 0).astype(int)
    elif "forward_annualized_return" in df.columns:
        y = (df["forward_annualized_return"].values.astype(float) > 0).astype(int)
    else:
        print(
            "CSV must include label_pos_20d, or forward_return_20d, or forward_annualized_return",
            file=sys.stderr,
        )
        return None

    return X, y


def build_pipeline(pca_components: int | None) -> Pipeline:
    steps: list = [
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ]
    if pca_components is not None and pca_components > 0:
        steps.append(("pca", PCA(n_components=pca_components, whiten=True, random_state=42)))
    steps.append(
        (
            "rf",
            RandomForestClassifier(
                n_estimators=200,
                max_depth=12,
                min_samples_leaf=8,
                random_state=42,
                n_jobs=-1,
                class_weight="balanced_subsample",
            ),
        )
    )
    return Pipeline(steps)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pca", type=int, default=0, help="If >0, add PCA(n_components=k, whiten=True) before RF")
    args = ap.parse_args()
    pca_k = args.pca if args.pca > 0 else None

    feature_names = load_feature_names()
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    panel_path = DATA_DIR / "ml_panel.csv"
    loaded = load_panel_csv(panel_path, feature_names)
    if loaded is not None:
        X_df, y = loaded
        print(f"Loaded panel from {panel_path}: {len(X_df)} rows")
    else:
        X_df, y = build_synthetic_panel(feature_names)
        print("No data/ml_panel.csv — training on synthetic panel (replace for real use)")

    X = X_df.values.astype(float)
    n = len(X)
    split = int(n * 0.8)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    pipe = build_pipeline(pca_k)
    pipe.fit(X_train, y_train)
    proba_test = pipe.predict_proba(X_test)[:, 1]
    pred_test = (proba_test >= 0.5).astype(int)

    try:
        ll = float(log_loss(y_test, proba_test))
    except ValueError:
        ll = float("nan")
    try:
        auc = float(roc_auc_score(y_test, proba_test))
    except ValueError:
        auc = float("nan")
    brier = float(brier_score_loss(y_test, proba_test))

    proba_train = pipe.predict_proba(X_train)[:, 1]
    try:
        ll_train = float(log_loss(y_train, proba_train))
    except ValueError:
        ll_train = float("nan")

    joblib.dump(pipe, MODEL_DIR / "rf_regressor.joblib")
    metrics = {
        "model": "RandomForestClassifier",
        "log_loss_test": ll,
        "log_loss_train": ll_train,
        "brier_test": brier,
        "roc_auc_test": auc,
        "n_train": int(split),
        "n_test": int(n - split),
        "n_features": len(feature_names),
        "feature_names": feature_names,
        "synthetic": loaded is None,
        "pca_components": pca_k,
    }
    with open(MODEL_DIR / "rf_metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
