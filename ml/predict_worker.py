#!/usr/bin/env python3
"""
Long-lived ML worker: one JSON object per stdin line, one JSON object per stdout line.
Keeps joblib / torch models loaded across backtest rebalances (avoids repeated cold starts).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

from predict import predict_from_payload  # noqa: E402


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "error": str(e)}), flush=True)
            continue
        out = predict_from_payload(payload)
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
