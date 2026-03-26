#!/usr/bin/env python3
"""
Time-series out-of-sample validation (no random shuffle). TimeSeriesSplit on row order.
Reports train vs test log-loss, Brier, ROC-AUC, Spearman IC (proba vs forward_return_20d if present).
Writes models/validation_metrics.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import TimeSeriesSplit

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models"
DATA_DIR = ROOT / "data"
SCHEMA_PATH = Path(__file__).resolve().parent / "features_schema.json"

# Reuse training helpers
sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_rf import build_pipeline, build_synthetic_panel, load_feature_names, load_panel_csv  # noqa: E402


def main() -> int:
    feature_names = load_feature_names()
    panel_path = DATA_DIR / "ml_panel.csv"
    loaded = load_panel_csv(panel_path, feature_names)
    if loaded is not None:
        X_df, y = loaded
        df_full = pd.read_csv(panel_path)
        fwd20 = df_full["forward_return_20d"].values.astype(float) if "forward_return_20d" in df_full.columns else None
        print(f"Loaded {len(X_df)} rows from {panel_path}")
    else:
        X_df, y = build_synthetic_panel(feature_names, n=600, seed=7)
        fwd20 = None
        print("Synthetic panel for validation smoke test")

    X = X_df.values.astype(float)
    n_splits = min(5, max(2, len(X) // 100))
    tscv = TimeSeriesSplit(n_splits=n_splits)
    folds = []
    for fold_i, (train_idx, test_idx) in enumerate(tscv.split(X)):
        if len(test_idx) < 5:
            continue
        X_tr, X_te = X[train_idx], X[test_idx]
        y_tr, y_te = y[train_idx], y[test_idx]
        pipe = build_pipeline(pca_components=None)
        pipe.fit(X_tr, y_tr)
        proba_te = pipe.predict_proba(X_te)[:, 1]
        proba_tr = pipe.predict_proba(X_tr)[:, 1]
        fold = {"fold": fold_i, "n_train": len(train_idx), "n_test": len(test_idx)}
        try:
            fold["log_loss_train"] = float(log_loss(y_tr, proba_tr))
            fold["log_loss_test"] = float(log_loss(y_te, proba_te))
        except ValueError:
            fold["log_loss_train"] = None
            fold["log_loss_test"] = None
        fold["brier_test"] = float(brier_score_loss(y_te, proba_te))
        try:
            fold["roc_auc_test"] = float(roc_auc_score(y_te, proba_te))
        except ValueError:
            fold["roc_auc_test"] = None
        if fwd20 is not None:
            f_te = fwd20[test_idx]
            if np.std(f_te) > 1e-12 and np.std(proba_te) > 1e-12:
                ic, _ = spearmanr(proba_te, f_te)
                fold["spearman_ic_test"] = float(ic) if not np.isnan(ic) else None
            else:
                fold["spearman_ic_test"] = None
        else:
            fold["spearman_ic_test"] = None
        folds.append(fold)
        print(json.dumps(fold))

    ll_vals = [f["log_loss_test"] for f in folds if f.get("log_loss_test") is not None]
    out = {
        "n_splits_requested": n_splits,
        "folds": folds,
        "mean_log_loss_test": float(np.mean(ll_vals)) if ll_vals else None,
    }
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODEL_DIR / "validation_metrics.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
