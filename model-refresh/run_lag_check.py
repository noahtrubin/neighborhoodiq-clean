"""Reality check: IRS migration is released ~2 years late. The backtest used it
'as of year B' -- but scoring in real time at year B, you'd only have data from
~B-2. If the lift survives that lag, it's real and usable. If it collapses, the
0.69 was an artifact of using data we wouldn't actually have (a real-world leak).

Compares OOT AUC with migration as-of B (optimistic) vs as-of B-2 (realistic).
Price-vs-neighbors (Zillow) has ~no lag, so it's always taken as-of B.
"""
from __future__ import annotations

import os
import sys
import warnings

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model  # noqa: E402
from feature_lab import load_df  # noqa: E402

COUNTY = "/Users/noahrubin/neighborhoodiq/data/raw/county_panel.csv"
NBR = "/Users/noahrubin/neighborhoodiq/data/raw/neighbor_panel.csv"
QW = "/Users/noahrubin/neighborhoodiq/data/raw/quickwins_panel.csv"
IRSCOLS = ["agi_per_inmover", "net_rate"]
BASES = [2017, 2018, 2019, 2020, 2021]


def pipe():
    return Pipeline([("imp", SimpleImputer(strategy="median")),
                     ("sc", StandardScaler()),
                     ("lr", LogisticRegression(max_iter=2000, random_state=42))])


def feats(df, irs, nbr, B, irs_lag):
    ep = model.episode(df, B)
    if ep is None:
        return None
    X9, y, d = ep
    b = pd.DataFrame(index=X9.index)
    b["pctile_metro"] = X9["pctile_metro"].to_numpy()
    b["log_rel_state"] = np.log(X9["rel_state"].to_numpy())
    nb = nbr[nbr["year"] == B][["zip", "price_vs_nbr"]].drop_duplicates("zip")
    ir = irs[irs["year"] == B - irs_lag][["zip"] + IRSCOLS].drop_duplicates("zip")
    m = d[["zip"]].merge(nb, on="zip", how="left").merge(ir, on="zip", how="left")
    b["price_vs_nbr"] = m["price_vs_nbr"].to_numpy()
    for c in IRSCOLS:
        b[c] = m[c].to_numpy()
    return b.replace([np.inf, -np.inf], np.nan), y


def auc_for(df, irs, nbr, irs_lag):
    out = []
    for B in BASES:
        tr, te = feats(df, irs, nbr, B - 5, irs_lag), feats(df, irs, nbr, B, irs_lag)
        if tr is None or te is None:
            continue
        Xtr, ytr = tr
        Xte, yte = te
        if ytr.nunique() < 2 or yte.nunique() < 2:
            continue
        p = pipe().fit(Xtr, ytr).predict_proba(Xte)[:, 1]
        out.append((B, roc_auc_score(yte, p)))
    return out


def main():
    df = load_df()
    c = pd.read_csv(COUNTY, dtype={"zip": str})
    c["zip"] = c["zip"].str.zfill(5)
    q = pd.read_csv(QW, dtype={"zip": str})
    q["zip"] = q["zip"].str.zfill(5)
    irs = c[["zip", "year", "agi_per_inmover"]].merge(
        q[["zip", "year", "net_rate"]], on=["zip", "year"], how="outer")
    n = pd.read_csv(NBR, dtype={"zip": str}); n["zip"] = n["zip"].str.zfill(5)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        opt = dict(auc_for(df, irs, n, irs_lag=0))   # as-of B (optimistic)
        real = dict(auc_for(df, irs, n, irs_lag=2))  # as-of B-2 (realistic)
    print(f"  {'test base':>10} {'as-of B (opt)':>14} {'as-of B-2 (real)':>17} {'drop':>8}")
    for B in BASES:
        if B in opt and B in real:
            print(f"  {B:>10} {opt[B]:>14.4f} {real[B]:>17.4f} {real[B]-opt[B]:>+8.4f}")
    ov = np.mean([opt[B] for B in opt]); rv = np.mean([real[B] for B in real])
    print(f"  {'AVG':>10} {ov:>14.4f} {rv:>17.4f} {rv-ov:>+8.4f}")
    print(f"\n  optimistic avg = {ov:.3f}   realistic (2yr-lag) avg = {rv:.3f}")


if __name__ == "__main__":
    main()
