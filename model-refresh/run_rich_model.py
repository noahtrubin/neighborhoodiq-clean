"""Push toward 0.70: does a richer MODEL on the data we already have help?

Same validated ingredients (cheap-vs-metro, cheap-vs-state, cheap-vs-neighbors,
in-migrant income, migration growth), but compares three model forms out-of-time:
  1. logistic (current approach, linear)
  2. logistic + explicit interactions (cheap x inflow)   <- your quadrant insight
  3. gradient boosting (captures interactions + nonlinearity automatically)

If trees/interactions beat plain logistic, we get free lift before any new data.
"""
from __future__ import annotations

import os
import sys
import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
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
BASES = [2017, 2018, 2019, 2020, 2021]   # hard, recent test windows


def feats(df, county, nbr, B):
    ep = model.episode(df, B)
    if ep is None:
        return None
    X9, y, d = ep
    b = pd.DataFrame(index=X9.index)
    b["pctile_metro"] = X9["pctile_metro"].to_numpy()
    b["log_rel_state"] = np.log(X9["rel_state"].to_numpy())
    cb = (county[county["year"] == B][["zip", "agi_per_inmover", "inflow_growth2"]]
          .drop_duplicates("zip"))
    nb = nbr[nbr["year"] == B][["zip", "price_vs_nbr"]].drop_duplicates("zip")
    m = d[["zip"]].merge(cb, on="zip", how="left").merge(nb, on="zip", how="left")
    for c in ("agi_per_inmover", "inflow_growth2", "price_vs_nbr"):
        b[c] = m[c].to_numpy()
    return b.replace([np.inf, -np.inf], np.nan), y


def add_interactions(b):
    x = b.copy()
    x["cheapNbr_x_inflow"] = b["price_vs_nbr"] * b["inflow_growth2"]
    x["cheapMetro_x_inflow"] = b["pctile_metro"] * b["inflow_growth2"]
    x["cheapNbr_x_agi"] = b["price_vs_nbr"] * b["agi_per_inmover"]
    return x


def logit():
    return Pipeline([("imp", SimpleImputer(strategy="median")),
                     ("sc", StandardScaler()),
                     ("lr", LogisticRegression(max_iter=2000, random_state=42))])


def main():
    df = load_df()
    c = pd.read_csv(COUNTY, dtype={"zip": str}).sort_values(["zip", "year"])
    c["zip"] = c["zip"].str.zfill(5)
    c["inflow_growth2"] = c.groupby("zip")["inflow_returns"].pct_change(2)
    n = pd.read_csv(NBR, dtype={"zip": str})
    n["zip"] = n["zip"].str.zfill(5)

    print(f"  {'test window':>14} {'logistic':>9} {'+interact':>10} {'grad-boost':>11}")
    rows = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for B in BASES:
            tr, te = feats(df, c, n, B - 5), feats(df, c, n, B)
            if tr is None or te is None:
                continue
            Xtr, ytr = tr
            Xte, yte = te
            if ytr.nunique() < 2 or yte.nunique() < 2:
                continue
            a = roc_auc_score(yte, logit().fit(Xtr, ytr).predict_proba(Xte)[:, 1])
            Xtri, Xtei = add_interactions(Xtr), add_interactions(Xte)
            b = roc_auc_score(yte, logit().fit(Xtri, ytr).predict_proba(Xtei)[:, 1])
            gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05,
                                                max_iter=300, random_state=42)
            g = roc_auc_score(yte, gb.fit(Xtr, ytr).predict_proba(Xte)[:, 1])
            rows.append((a, b, g))
            print(f"  {B-5}->{B:>4} {a:>9.4f} {b:>10.4f} {g:>11.4f}")
    r = np.array(rows)
    print(f"\n  {'AVG (recent)':>14} {r[:,0].mean():>9.4f} {r[:,1].mean():>10.4f} "
          f"{r[:,2].mean():>11.4f}")


if __name__ == "__main__":
    main()
