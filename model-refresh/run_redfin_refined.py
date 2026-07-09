"""Round 2 on Redfin: raw demand-pressure LEVELS hurt OOT. Before concluding,
test the theoretically-motivated forms:
  * metro-relative (z-score within metro-year)  — strip out metro composition
  * change / momentum (2yr delta within zip)     — is the market heating, not just hot?

If even these don't lift honest OOT AUC, contemporaneous demand genuinely doesn't
forecast 5yr appreciation (mean reversion) and we pivot to slower fundamentals.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import evaluate_feature, load_df  # noqa: E402

PANEL = "/Users/noahrubin/neighborhoodiq/data/raw/redfin_panel.csv"
BASE_METRICS = ["dom", "sale_to_list", "sold_above_list", "off_market_2wk"]


def main():
    df = load_df()
    # zip -> Metro (latest non-null), so demand pressure can be made metro-relative
    zmeta = (df[["zip", "Metro"]].dropna(subset=["Metro"])
             .drop_duplicates("zip", keep="last"))
    panel = pd.read_csv(PANEL, dtype={"zip": str})
    panel["zip"] = panel["zip"].str.zfill(5)
    panel = panel.merge(zmeta, on="zip", how="left")

    # (1) metro-relative z-score within (Metro, year)
    rel_cols = []
    for c in BASE_METRICS:
        g = panel.groupby(["Metro", "year"])[c]
        mu, sd = g.transform("mean"), g.transform("std")
        rc = f"{c}_relmetro"
        panel[rc] = (panel[c] - mu) / sd.replace(0, np.nan)
        rel_cols.append(rc)

    # (2) 2-year change within zip (momentum of demand)
    chg_cols = []
    panel = panel.sort_values(["zip", "year"])
    for c in BASE_METRICS:
        cc = f"{c}_chg2"
        panel[cc] = panel.groupby("zip")[c].diff(2)
        chg_cols.append(cc)

    print(f"panel enriched: {len(panel):,} rows; rel cols {rel_cols}; chg cols {chg_cols}")

    def run(cols, label):
        sub = panel[["zip", "year"] + cols].copy()
        res = evaluate_feature(df, sub, "zip", cols, label=label)
        recent = res[res["base_year"].between(2019, 2021)]
        return (label, recent["delta"].mean(), recent["covered_delta"].mean(),
                recent["coverage"].mean())

    summary = [
        run(rel_cols, "metro-relative demand pressure"),
        run(chg_cols, "2yr CHANGE in demand pressure"),
        run(rel_cols + chg_cols, "metro-relative + change"),
    ]
    print(f"\n{'='*72}\n  SUMMARY — recent episodes (2019-2021 test base)\n{'='*72}")
    print(f"  {'feature set':>34} {'nat.delta':>10} {'covd.delta':>11} {'cov':>7}")
    for name, d, cd, cov in summary:
        print(f"  {name:>34} {d:>+10.4f} {cd:>+11.4f} {cov*100:>6.1f}%")


if __name__ == "__main__":
    main()
