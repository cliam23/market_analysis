"""Shared LSTM definition for train_rnn.py and predict.py."""

from __future__ import annotations

import torch.nn as nn

DEFAULT_HORIZONS = (5, 21, 63)


class ReturnPathLSTM(nn.Module):
    def __init__(self, input_size: int = 1, hidden: int = 32, num_layers: int = 1):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden, num_layers, batch_first=True)
        self.head = nn.Linear(hidden, len(DEFAULT_HORIZONS))

    def forward(self, x):
        out, _ = self.lstm(x)
        last = out[:, -1, :]
        return self.head(last)
