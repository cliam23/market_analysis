#!/usr/bin/env python3
"""
Simple LSTM on log-return sequences; predicts multi-horizon forward returns (5d, 21d, 63d trading days).
Synthetic data if data/ml_sequences.npz is missing. Time-based split on batch dimension.
Saves models/rnn.pt + models/rnn_config.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from rnn_model import DEFAULT_HORIZONS, ReturnPathLSTM

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models"
DATA_DIR = ROOT / "data"

SEQ_LEN = 60
HORIZONS = DEFAULT_HORIZONS


def make_synthetic(n: int = 600, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    X = rng.normal(0, 0.02, size=(n, SEQ_LEN, 1)).astype(np.float32)
    # Per-sequence mean return as weak signal for multi-horizon targets
    drift = X.mean(axis=1).reshape(n)  # (n,) — avoid squeeze edge cases with ndim
    y = np.stack(
        [
            drift * 5 + rng.normal(0, 0.05, n),
            drift * 15 + rng.normal(0, 0.08, n),
            drift * 40 + rng.normal(0, 0.12, n),
        ],
        axis=1,
    ).astype(np.float32)
    return X, y


def main() -> int:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    npz_path = DATA_DIR / "ml_sequences.npz"

    if npz_path.is_file():
        z = np.load(npz_path)
        X = z["X"].astype(np.float32)
        y = z["y"].astype(np.float32)
        print(f"Loaded sequences from {npz_path}: {X.shape}")
    else:
        X, y = make_synthetic()
        print("No data/ml_sequences.npz — training on synthetic sequences")

    n = X.shape[0]
    split = int(n * 0.8)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    device = torch.device("cpu")
    model = ReturnPathLSTM().to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()

    train_ds = TensorDataset(torch.from_numpy(X_train), torch.from_numpy(y_train))
    train_loader = DataLoader(train_ds, batch_size=32, shuffle=True)

    model.train()
    for epoch in range(30):
        total = 0.0
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            pred = model(xb)
            loss = loss_fn(pred, yb)
            loss.backward()
            opt.step()
            total += loss.item() * len(xb)
        if epoch % 10 == 0:
            print(f"epoch {epoch} train_mse {total / len(train_ds):.6f}", file=sys.stderr)

    model.eval()
    with torch.no_grad():
        pt = torch.from_numpy(X_test).to(device)
        pred_t = model(pt).cpu().numpy()
    mse = float(np.mean((pred_t - y_test) ** 2))

    torch.save(model.state_dict(), MODEL_DIR / "rnn.pt")
    cfg = {
        "seq_len": SEQ_LEN,
        "horizons": list(HORIZONS),
        "input_size": 1,
        "hidden": 32,
        "test_mse": mse,
        "n_train": int(split),
        "n_test": int(n - split),
    }
    with open(MODEL_DIR / "rnn_config.json", "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

    print(json.dumps(cfg, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
