"""A/B the targeted amenity-growth signals (coffee / food-drink / arts)."""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import evaluate_feature, load_df  # noqa: E402

PANEL = "/Users/noahrubin/neighborhoodiq/data/raw/amenity_panel.csv"


def main():
    df = load_df()
    p = pd.read_csv(PANEL, dtype={"zip": str}).sort_values(["zip", "year"])
    p["zip"] = p["zip"].str.zfill(5)
    for c in ("coffee", "food", "arts"):
        p[f"{c}_growth2"] = p.groupby("zip")[c].pct_change(2)
    print(f"amenity panel: {len(p):,} rows, {p['zip'].nunique():,} ZIPs")

    summary = []
    for cols, label in [
        (["coffee_growth2"], "coffee-shop growth (2yr)"),
        (["food_growth2"], "food/drink growth (2yr)"),
        (["arts_growth2"], "arts/rec growth (2yr)"),
        (["coffee_growth2", "food_growth2", "arts_growth2"], "ALL amenity growth"),
    ]:
        res = evaluate_feature(df, p[["zip", "year"] + cols], "zip", cols, label=label)
        r = res[res["base_year"].between(2017, 2021)]
        summary.append((label, r["delta"].mean(), r["covered_delta"].mean(),
                        r["coverage"].mean()))
    print(f"\n{'='*70}\n  SUMMARY — recent episodes\n{'='*70}")
    print(f"  {'feature set':>28} {'nat.delta':>10} {'covd.delta':>11} {'cov':>7}")
    for name, d, cd, cov in summary:
        print(f"  {name:>28} {d:>+10.4f} {cd:>+11.4f} {cov*100:>6.1f}%")


if __name__ == "__main__":
    main()
