#!/usr/bin/env python3
"""
CLI: read JSON stdin { "features": [[float,...], ...], "sequences": [[[float],...], ...] optional }
Write JSON stdout { "ok", "rfRaw", "rnnRaw", "mlScore" (0-100 per row) }
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models"

# Lazy-loaded
_rf_pipe = None
_rf_alpha_pipe = None
_rf_cluster_pipe = None
_rnn_model = None
_rnn_cfg = None


def load_rf_cluster():
    global _rf_cluster_pipe
    path = MODEL_DIR / "rf_cluster_classifier.joblib"
    if not path.is_file():
        return None
    if _rf_cluster_pipe is None:
        _rf_cluster_pipe = joblib.load(path)
    return _rf_cluster_pipe


def load_rf_alpha():
    global _rf_alpha_pipe
    path = MODEL_DIR / "rf_alpha_regressor.joblib"
    if not path.is_file():
        return None
    if _rf_alpha_pipe is None:
        _rf_alpha_pipe = joblib.load(path)
    return _rf_alpha_pipe


def load_rf():
    global _rf_pipe
    path = MODEL_DIR / "rf_regressor.joblib"
    if not path.is_file():
        return None
    if _rf_pipe is None:
        _rf_pipe = joblib.load(path)
    return _rf_pipe


def load_rnn():
    global _rnn_model, _rnn_cfg
    try:
        import torch
    except ImportError:
        return None, None
    pt = MODEL_DIR / "rnn.pt"
    cfgp = MODEL_DIR / "rnn_config.json"
    if not pt.is_file() or not cfgp.is_file():
        return None, None
    if _rnn_cfg is None:
        with open(cfgp, encoding="utf-8") as f:
            _rnn_cfg = json.load(f)
    if _rnn_model is None:
        from rnn_model import ReturnPathLSTM

        m = ReturnPathLSTM(
            input_size=_rnn_cfg.get("input_size", 1),
            hidden=_rnn_cfg.get("hidden", 32),
            num_layers=1,
        )
        m.load_state_dict(torch.load(pt, map_location="cpu"))
        m.eval()
        _rnn_model = m
    return _rnn_model, _rnn_cfg


def scale_to_100(arr: np.ndarray) -> np.ndarray:
    a = np.asarray(arr, dtype=float)
    if a.size == 0:
        return a
    lo, hi = np.percentile(a, [5, 95])
    if hi - lo < 1e-9:
        return np.full_like(a, 50.0)
    t = (a - lo) / (hi - lo)
    t = np.clip(t, 0, 1) * 100
    return t


def predict_from_payload(payload: dict) -> dict:
    """Core inference used by CLI and predict_worker (models stay warm in worker)."""
    features = payload.get("features") or []
    sequences = payload.get("sequences")
    model_mode = (payload.get("model") or "structural").strip().lower()
    n = len(features)

    if model_mode == "alpha":
        ap = load_rf_alpha()
        if ap is None or n == 0:
            return {"ok": False, "error": "rf_alpha_regressor.joblib missing or empty features"}
        X = np.array(features, dtype=float)
        if X.ndim == 1:
            X = X.reshape(1, -1)
        pred = np.asarray(ap.predict(X), dtype=float)
        scores = scale_to_100(pred)
        return {
            "ok": True,
            "model": "alpha",
            "predictedAlpha": [float(x) for x in pred],
            "alphaScore0to100": [float(x) for x in scores],
        }

    if model_mode == "cluster":
        cp = load_rf_cluster()
        if cp is None or n == 0:
            return {"ok": False, "error": "rf_cluster_classifier.joblib missing or empty features"}
        X = np.array(features, dtype=float)
        if X.ndim == 1:
            X = X.reshape(1, -1)
        if hasattr(cp, "predict_proba"):
            proba = np.asarray(cp.predict_proba(X), dtype=float)
            idx = 1 if proba.shape[1] > 1 else 0
            winner_p = proba[:, idx]
        else:
            winner_p = np.asarray(cp.predict(X), dtype=float).clip(0, 1)
        scores = scale_to_100(np.asarray(winner_p, dtype=float))
        return {
            "ok": True,
            "model": "cluster",
            "clusterProbWinner": [float(x) for x in winner_p],
            "clusterScore0to100": [float(x) for x in scores],
        }

    rf_raw = np.zeros(n, dtype=float)
    rnn_raw = np.zeros(n, dtype=float)

    rf = load_rf()
    prob_positive = None
    structural_100 = None
    if rf is not None and n > 0:
        X = np.array(features, dtype=float)
        if X.ndim == 1:
            X = X.reshape(1, -1)
        if hasattr(rf, "predict_proba"):
            prob_positive = np.asarray(rf.predict_proba(X)[:, 1], dtype=float)
            structural_100 = prob_positive * 100.0
            rf_raw = prob_positive
        else:
            rf_raw = np.asarray(rf.predict(X), dtype=float)

    rnn_m, cfg = load_rnn()
    if rnn_m is not None and sequences is not None and len(sequences) == n:
        import torch as _torch

        seq_len = cfg.get("seq_len", 60)
        Xs = []
        for seq in sequences:
            s = np.array(seq, dtype=np.float32).flatten()
            if len(s) < seq_len:
                s = np.pad(s, (seq_len - len(s), 0), mode="constant")
            s = s[-seq_len:]
            Xs.append(s.reshape(seq_len, 1))
        if Xs:
            batch = _torch.from_numpy(np.stack(Xs, axis=0))
            with _torch.no_grad():
                out = rnn_m(batch).numpy()
            w = np.array([0.25, 0.35, 0.4], dtype=float)
            rnn_raw = (out * w).sum(axis=1)

    ml_score = np.full(n, 50.0)
    if structural_100 is not None:
        ml_score = structural_100.copy()
    if rf is not None and rnn_m is not None and sequences is not None and len(sequences) == n:
        s1 = structural_100 if structural_100 is not None else scale_to_100(rf_raw)
        s2 = scale_to_100(rnn_raw)
        ml_score = 0.55 * s1 + 0.45 * s2
    elif rf is not None and structural_100 is None:
        ml_score = scale_to_100(rf_raw)
    elif rnn_m is not None and sequences is not None and len(sequences) == n:
        ml_score = scale_to_100(rnn_raw)

    prob_list = None if prob_positive is None else [float(x) for x in prob_positive]
    struct_list = [float(x) for x in ml_score]

    return {
        "ok": bool(rf is not None or (rnn_m is not None and sequences is not None)),
        "rfRaw": rf_raw.tolist(),
        "rnnRaw": rnn_raw.tolist(),
        "mlScore": struct_list,
        "probPositive20d": prob_list,
        "structuralScore0to100": struct_list,
    }


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1

    out = predict_from_payload(payload)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
