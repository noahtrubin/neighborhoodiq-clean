"""The definitive number: how well does the FULL proposed model work out-of-time?

Combines the validated ingredients into one model and reports its absolute
out-of-time AUC per episode (AUC_aug), vs the current deployed cheapness model
(AUC_base). This is 'how well does it work' for the real proposed model.
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import evaluate_feature, load_df  # noqa: E402

COUNTY = "/Users/noahrubin/neighborhoodiq/data/raw/county_panel.csv"
NBR = "/Users/noahrubin/neighborhoodiq/data/raw/neighbor_panel.csv"


def main():
    df = load_df()
    c = pd.read_csv(COUNTY, dtype={"zip": str}).sort_values(["zip", "year"])
    c["zip"] = c["zip"].str.zfill(5)
    c["inflow_growth2"] = c.groupby("zip")["inflow_returns"].pct_change(2)
    n = pd.read_csv(NBR, dtype={"zip": str})
    n["zip"] = n["zip"].str.zfill(5)
    panel = c[["zip", "year", "agi_per_inmover", "inflow_growth2"]].merge(
        n[["zip", "year", "price_vs_nbr"]], on=["zip", "year"], how="outer")

    cols = ["price_vs_nbr", "agi_per_inmover", "inflow_growth2"]
    res = evaluate_feature(df, panel, "zip", cols,
                           label="FULL MODEL: cheap-vs-neighbors + migration")
    recent = res[res["base_year"].between(2014, 2021)]
    print(f"\n  current deployed model (cheapness),  avg recent OOT AUC = "
          f"{recent['auc_base'].mean():.3f}")
    print(f"  proposed model (cheap-vs-nbr+migration), avg recent OOT AUC = "
          f"{recent['auc_aug'].mean():.3f}")
    print(f"  lift = {recent['delta'].mean():+.3f}")


if __name__ == "__main__":
    main()
