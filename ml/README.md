# ML layer (Random Forest + RNN)

Uses **Python** (`scikit-learn`, **PyTorch**) alongside the Node server. Training is **offline**; the server runs **`ml/predict.py`** when **`ML_RANK_WEIGHT`** (0–1) is set for **paper rebalance** and **backtest simulation** (composite strategies only), or **`portfolio.config.mlRankWeight`** for paper.

## Setup

```bash
cd "/path/to/Market Analysis"
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r ml/requirements.txt
```

## Train models (writes to `models/`)

```bash
python3 ml/train_rf.py
python3 ml/train_rnn.py
```

- Without `data/ml_panel.csv`, `train_rf.py` fits a **synthetic** panel (smoke test only). For real use, add a CSV with **all** columns in `ml/features_schema.json` plus a label column: **`label_pos_20d`** (0/1), or **`forward_return_20d`** (signed; label = positive), or **`forward_annualized_return`** (legacy; label = positive).
- Without `data/ml_sequences.npz`, `train_rnn.py` uses **synthetic** sequences.

## Inference

Node runs `ml/predict.py` with JSON stdin `{ "features": [[...]], "sequences": [[60 log-returns], ...] }`.

- **Interpreter:** If **`PYTHON`** is unset, the server uses **`.venv/bin/python3`** (macOS/Linux) or **`.venv\Scripts\python.exe`** (Windows) when that path exists—so `npm run server` picks up your venv without activating it in the shell.
- **Blend weight:** Set **`ML_RANK_WEIGHT`** (0–1) in `.env` — affects **Backtest** and **Paper trade** composite re-ranking (one Python call per simulated/live rebalance; slower backtests). `0` = rules-only. Paper init **`mlRankWeight`** overrides env for paper only; backtest always uses env.
- **Ticker analysis hybrid composite:** Set **`ML_COMPOSITE_ANALYSIS=1`** in `.env` to blend **`calcComposite`** with RF **P(up 20d)** (requires trained `models/rf_regressor.joblib`). Response includes **`mlAnalysisPredict`** when inference succeeds.

## Validation (time-series OOS)

```bash
python3 ml/validate_model.py
```

Writes **`models/validation_metrics.json`** using **`TimeSeriesSplit`** (no shuffle). Optional **`train_rf.py --pca K`** for PCA whitening before the forest.

## API

- **Paper rebalance** (`POST /api/paper-trade/rebalance`): blends ML `mlScore` with `compositeScore` when weight &gt; 0 and models exist.
- **Ticker analysis** (`GET /api/analysis/:ticker`): includes `mlFeatures` `{ names, vector }` when the composite is built via `calcComposite` (not the short backtest-style composite path).

There is no separate `POST /api/rebalance`; paper trading uses **`/api/paper-trade/rebalance`**.
