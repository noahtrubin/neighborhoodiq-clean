"""Honest 'is it actually real?' self-check for the rise-probability model.

Uses ONLY real Zillow data and outcomes that already happened. Everything here is
reproducible — don't take anyone's word for the accuracy, run it:

  /path/to/python model-refresh/sanity_check.py

It tests the exact production model (imports model.py) three ways:
  1. Out-of-time AUC  — does it separate the neighborhoods that rose from those that fell?
  2. Calibration      — when it says 80%, do ~80% actually rise?
  3. The tangible one  — of the ZIPs it flagged least likely to rise, how many actually fell?
"""
import os, sys, warnings
import numpy as np
warnings.simplefilter("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import load_zhvi, episode, build_pipe, HORIZON
from sklearn.metrics import roc_auc_score

CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "zhvi.csv")
df = load_zhvi(sys.argv[1] if len(sys.argv) > 1 else CSV)
years = df.attrs["years"]

print("=" * 80)
print(f"TEST 1 — OUT-OF-TIME: for each past {HORIZON}-year window, train ONLY on the prior")
print("         window, then check whether it separated the risers from the fallers.")
print("         AUC 0.50 = coin flip. ~0.66 is real signal for home prices.")
print("=" * 80)
aucs = []
for B in range(min(years) + 9, max(years) - HORIZON + 1):
    te, tr = episode(df, B), episode(df, B - HORIZON)
    if te is None or tr is None:
        continue
    Xte, yte, _ = te
    Xtr, ytr, _ = tr
    if yte.nunique() < 2 or ytr.nunique() < 2:
        continue
    p = build_pipe().fit(Xtr, ytr).predict_proba(Xte)[:, 1]
    a = roc_auc_score(yte, p); aucs.append(a)
    print(f"  trained {B-HORIZON}->{B}, forecast {B}->{B+HORIZON}:  AUC={a:.3f}  "
          f"(actually rose: {yte.mean()*100:.0f}%)")
print(f"  ----> average out-of-time AUC = {np.mean(aucs):.3f}")

print("\n" + "=" * 80)
print("TEST 2 — CALIBRATION: train 2021->2023, score 2023, check what ACTUALLY happened")
print("         2023->2025. If the probability is honest, each bin's actual rise-rate")
print("         should roughly match its predicted probability.")
print("=" * 80)
Xtr, ytr, _ = episode(df, 2021)
m = build_pipe().fit(Xtr, ytr)
Xte, yte, _ = episode(df, 2023)
p = m.predict_proba(Xte)[:, 1]; y = yte.to_numpy()
print(f"  overall: predicted rise {p.mean()*100:.0f}% vs actually rose {y.mean()*100:.0f}%   (AUC {roc_auc_score(y,p):.3f})")
print("  predicted-chance bin     n      actually rose")
for lo, hi in [(0, .6), (.6, .75), (.75, .85), (.85, .92), (.92, .97), (.97, 1.01)]:
    msk = (p >= lo) & (p < hi)
    if msk.sum() > 30:
        print(f"    {int(lo*100):>3}-{int(hi*100):>3}%          {msk.sum():>6}       {y[msk].mean()*100:>4.0f}%")

print("\n" + "=" * 80)
print("TEST 3 — THE TANGIBLE ONE: does a LOW score actually flag risk? (train 2021->2023,")
print("         forecast 2023->2025). If real, its bottom decile falls far more often.")
print("=" * 80)
order = np.argsort(p); n = len(p)
bot = y[order[:n // 10]].mean(); top = y[order[-n // 10:]].mean()
print(f"  model's MOST confident 10%: actually rose {top*100:.0f}%")
print(f"  everyone:                   actually rose {y.mean()*100:.0f}%")
print(f"  model's LEAST confident 10%: actually rose {bot*100:.0f}%   <- the flagged-risk group")
print(f"  => a low score is {(1-bot)/max(1-top,1e-9):.1f}x more likely to actually fall than a high one.")
