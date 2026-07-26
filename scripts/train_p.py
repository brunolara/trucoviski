#!/usr/bin/env python3
"""Treina regressão logística (p / q / p') e emite JSON + parity CSV.

Uso:
  python scripts/train_p.py [train.csv] [holdout.csv] [out.json] [parity.csv] [brier_max]
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss

train_path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/decisions_train.csv")
hold_path = Path(sys.argv[2] if len(sys.argv) > 2 else "data/decisions_holdout.csv")
out_json = Path(sys.argv[3] if len(sys.argv) > 3 else "packages/bots/src/pmodel.json")
parity_out = Path(sys.argv[4] if len(sys.argv) > 4 else "data/parity_holdout.csv")
brier_max = float(sys.argv[5] if len(sys.argv) > 5 else "0.20")

d = pd.read_csv(train_path)
X = d.drop(columns=["label"]).values
y = d["label"].values
feature_names = list(d.drop(columns=["label"]).columns)
m = LogisticRegression(max_iter=1000, C=1.0).fit(X, y)

v = pd.read_csv(hold_path)
Xv = v.drop(columns=["label"]).values
yv = v["label"].values
w = m.coef_[0]
b = float(m.intercept_[0])
z = Xv @ w + b

# Temperatura no holdout (calibração 1 parâmetro — ainda cabe em TS)
def brier_at_T(T: float) -> float:
    p = 1.0 / (1.0 + np.exp(-z / T))
    return float(brier_score_loss(yv, p))

opt = minimize_scalar(brier_at_T, bounds=(0.3, 5.0), method="bounded")
T = float(opt.x)
p = 1.0 / (1.0 + np.exp(-z / T))
brier = brier_score_loss(yv, p)
baseline = brier_score_loss(yv, np.full(len(yv), 0.5))
print(f"temperature: {T:.4f}")
print(f"brier: {brier:.4f}")
print(f"baseline (chute 0.5): {baseline:.4f}")
print(f"label_rate: {float(yv.mean()):.4f}")

order = np.argsort(p)
p_sorted = p[order]
y_sorted = yv[order]
n = len(p_sorted)
print("calibration (bucket_center, empiric, |err|):")
max_cal_err = 0.0
for i in range(10):
    lo = i * n // 10
    hi = (i + 1) * n // 10
    if hi <= lo:
        continue
    pb = p_sorted[lo:hi]
    yb = y_sorted[lo:hi]
    center = float(pb.mean())
    empiric = float(yb.mean())
    err = abs(center - empiric)
    max_cal_err = max(max_cal_err, err)
    print(f"  {i}: {center:.3f} vs {empiric:.3f} err={err:.3f}")

payload = {
    "trained": True,
    "w": w.tolist(),
    "b": b,
    "t": T,
    "features": feature_names,
    "brier": float(brier),
    "max_cal_err": float(max_cal_err),
}
out_json.write_text(json.dumps(payload, indent=2) + "\n")
print(f"wrote {out_json}")

n_parity = min(1000, len(v))
parity = v.iloc[:n_parity].copy()
parity["p_py"] = p[:n_parity]
parity.to_csv(parity_out, index=False)
print(f"wrote {parity_out} ({n_parity} rows)")

ok = brier < brier_max and max_cal_err < 0.05
print(
    f"GATE OK (model, brier<{brier_max})"
    if ok
    else f"GATE FAIL (model, brier<{brier_max} cal<0.05)"
)
sys.exit(0 if ok else 1)
