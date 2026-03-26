#!/usr/bin/env python3
"""
Train a compact RandomForestClassifier for "winning cluster" (forward outperformance / positive forward return).
Artifact: models/rf_cluster_classifier.joblib (use predict.py model=cluster).
Same feature schema as rf_regressor; label from label_pos_20d or forward_return columns.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
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


def build_synthetic_panel(feature_names: list[str], n: int = 600, seed: int = 44) -> tuple[pd.DataFrame, np.ndarray]:
    rng = np.random.default_rng(seed)
    X = rng.normal(0, 1, size=(n, len(feature_names)))
    moat_i = feature_names.index("moat_score") if "moat_score" in feature_names else 0
    growth_proxy = feature_names.index("momentum_norm") if "momentum_norm" in feature_names else 1
    logit = (X[:, moat_i] > 0.5).astype(float) * 1.2 - (X[:, growth_proxy] > 0).astype(float) * 0.8 + rng.normal(0, 0.9, size=n)
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
    elif "forward_excess_vs_spy_63d" in df.columns:
        y = (df["forward_excess_vs_spy_63d"].values.astype(float) > 0).astype(int)
    elif "forward_return_63d" in df.columns and "spy_forward_return_63d" in df.columns:
        ex = df["forward_return_63d"].values.astype(float) - df["spy_forward_return_63d"].values.astype(float)
        y = (ex > 0).astype(int)
    else:
        print("CSV needs label_pos_20d, forward_return_20d, or excess-return columns", file=sys.stderr)
        return None
    return X, y


def build_pipeline() -> Pipeline:
    return Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            (
                "rf",
                RandomForestClassifier(
                    n_estimators=80,
                    max_depth=10,
                    min_samples_leaf=10,
                    random_state=44,
                    n_jobs=-1,
                    class_weight="balanced_subsample",
                ),
            ),
        ]
    )


def main() -> int:
    argparse.ArgumentParser(description="Train rf_cluster_classifier.joblib").parse_args()
    feature_names = load_feature_names()
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    panel_path = DATA_DIR / "ml_panel.csv"
    loaded = load_panel_csv(panel_path, feature_names)
    if loaded is not None:
        X_df, y = loaded
        print(f"Loaded panel from {panel_path}: {len(X_df)} rows")
    else:
        X_df, y = build_synthetic_panel(feature_names)
        print("No data/ml_panel.csv — training cluster RF on synthetic panel")

    X = X_df.values.astype(float)
    n = len(X)
    split = int(n * 0.8)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    pipe = build_pipeline()
    pipe.fit(X_train, y_train)
    proba_test = pipe.predict_proba(X_test)[:, 1]
    try:
        ll = float(log_loss(y_test, proba_test))
    except ValueError:
        ll = float("nan")
    try:
        auc = float(roc_auc_score(y_test, proba_test))
    except ValueError:
        auc = float("nan")
    brier = float(brier_score_loss(y_test, proba_test))

    out_path = MODEL_DIR / "rf_cluster_classifier.joblib"
    joblib.dump(pipe, out_path)
    metrics = {
        "model": "RandomForestClassifier_cluster",
        "artifact": str(out_path.name),
        "log_loss_test": ll,
        "brier_test": brier,
        "roc_auc_test": auc,
        "n_train": int(split),
        "n_test": int(n - split),
        "n_features": len(feature_names),
        "synthetic": loaded is None,
    }
    with open(MODEL_DIR / "rf_cluster_metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
