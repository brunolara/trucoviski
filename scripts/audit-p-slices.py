#!/usr/bin/env python3
"""C1 — calibração de p fatiada por (trucoLevel, raiserOpp).

Uso:
  .venv/bin/python scripts/audit-p-slices.py \
    [pmodel.json] [holdout.csv]
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

model_path = Path(sys.argv[1] if len(sys.argv) > 1 else "packages/bots/src/pmodel.json")
hold_path = Path(sys.argv[2] if len(sys.argv) > 2 else "data/decisions_holdout.csv")

model = json.loads(model_path.read_text())
w = np.asarray(model["w"], dtype=float)
b = float(model["b"])
t = float(model["t"])
feat_names = list(model["features"])

df = pd.read_csv(hold_path)
X = df[feat_names].values
y = df["label"].values
z = X @ w + b
p = 1.0 / (1.0 + np.exp(-z / t))

df = df.copy()
df["p_hat"] = p
df["label"] = y

# trucoLevel = seq.index / 4 → 0, 0.25, 0.5, 0.75, 1.0
levels = sorted(df["trucoLevel"].unique())
print(f"model={model_path} holdout={hold_path} n={len(df)} T={t:.4f}")
print(f"{'trucoLevel':>10} {'raiserOpp':>9} {'n':>8} {'p_hat':>8} {'empiric':>8} {'|err|':>8}")

cause1 = False
rows = []
for level in levels:
    for raiser in (0.0, 1.0):
        mask = (df["trucoLevel"] == level) & (df["raiserOpp"] == raiser)
        n = int(mask.sum())
        if n == 0:
            continue
        ph = float(df.loc[mask, "p_hat"].mean())
        emp = float(df.loc[mask, "label"].mean())
        err = abs(ph - emp)
        flag = ""
        if n >= 500 and err > 0.10:
            cause1 = True
            flag = " ** CAUSA1"
        elif n >= 500 and err > 0.05:
            flag = "  WARN"
        print(
            f"{level:10.2f} {raiser:9.0f} {n:8d} {ph:8.3f} {emp:8.3f} {err:8.3f}{flag}"
        )
        rows.append(
            {
                "trucoLevel": level,
                "raiserOpp": raiser,
                "n": n,
                "p_hat": ph,
                "empiric": emp,
                "err": err,
            }
        )

# Foco diagnóstico: nível ≥6 (0.5) com raiserOpp=1
hi = [r for r in rows if r["trucoLevel"] >= 0.5 - 1e-9 and r["raiserOpp"] == 1.0]
print()
print("diagnóstico (trucoLevel≥0.5, raiserOpp=1):")
for r in hi:
    print(
        f"  L={r['trucoLevel']:.2f} n={r['n']} "
        f"p̂={r['p_hat']:.3f} real={r['empiric']:.3f} |err|={r['err']:.3f}"
    )

print()
if cause1:
    print("PORTÃO C1: CAUSA 1 CONFIRMADA (erro>0.10 em grupo n≥500)")
    sys.exit(2)
# Todos os grupos n≥500 dentro de 0.05?
big = [r for r in rows if r["n"] >= 500]
if big and all(r["err"] <= 0.05 for r in big):
    print("PORTÃO C1: Causa 1 MORTA (todos grupos n≥500 |err|≤0.05)")
    sys.exit(0)
print("PORTÃO C1: inconclusivo (há grupos com 0.05<|err|≤0.10 ou n<500)")
sys.exit(1)
