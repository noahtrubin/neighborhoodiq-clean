"""Run the Census ACS panel through feature_lab's out-of-time A/B.

The thesis: gentrification = rising income/education in still-affordable areas.
So the candidate features are LEVELS (rich/poor for the metro) and especially
5-year GROWTH (incomes/education climbing) known as-of the episode year. If these
lift honest OOT AUC over cheapness, fundamentals work; if not, 5yr ZIP
appreciation is near-unpredictable beyond cheapness.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import evaluate_feature, load_df  # noqa: E402

PANEL = "/Users/noahrubin/neighborhoodiq/data/raw/census_panel.csv"


def main():
    if not os.path.exists(PANEL):
        sys.exit(f"{PANEL} not found — run panel_census.py first (needs the Census key).")
    df = load_df()
    zmeta = (df[["zip", "Metro"]].dropna(subset=["Metro"])
             .drop_duplicates("zip", keep="last"))
    p = pd.read_csv(PANEL, dtype={"zip": str})
    p["zip"] = p["zip"].str.zfill(5)
    p = p.merge(zmeta, on="zip", how="left").sort_values(["zip", "year"])

    # levels relative to metro (rich/poor for the area), like cheapness but on income
    g = p.groupby(["Metro", "year"])["median_income"]
    p["income_relmetro"] = (p["median_income"] - g.transform("mean")) / \
        g.transform("std").replace(0, np.nan)
    # 5-year structural CHANGE known as-of the year (the gentrification signal)
    p["income_growth5"] = p.groupby("zip")["median_income"].pct_change(5)
    p["bachelors_growth5"] = p.groupby("zip")["bachelors_share"].diff(5)
    p["pop_growth5"] = p.groupby("zip")["population"].pct_change(5)
    p["bachelors_level"] = p["bachelors_share"]

    print(f"census panel: {len(p):,} rows, {p['zip'].nunique():,} ZCTAs, "
          f"years {p['year'].min()}-{p['year'].max()}")

    def run(cols, label):
        sub = p[["zip", "year"] + cols].copy()
        res = evaluate_feature(df, sub, "zip", cols, label=label)
        recent = res[res["base_year"].between(2019, 2021)]
        return (label, recent["delta"].mean(), recent["covered_delta"].mean(),
                recent["coverage"].mean())

    summary = [
        run(["income_growth5"], "income 5yr growth"),
        run(["bachelors_growth5"], "bachelor's-share 5yr change"),
        run(["income_relmetro", "bachelors_level"], "income/edu LEVELS (rel-metro)"),
        run(["pop_growth5"], "population 5yr growth"),
        run(["income_growth5", "bachelors_growth5", "pop_growth5",
             "income_relmetro", "bachelors_level"], "ALL structural fundamentals"),
    ]
    print(f"\n{'='*74}\n  SUMMARY — recent episodes (2019-2021 test base)\n{'='*74}")
    print(f"  {'feature set':>34} {'nat.delta':>10} {'covd.delta':>11} {'cov':>7}")
    for name, d, cd, cov in summary:
        print(f"  {name:>34} {d:>+10.4f} {cd:>+11.4f} {cov*100:>6.1f}%")


if __name__ == "__main__":
    main()
