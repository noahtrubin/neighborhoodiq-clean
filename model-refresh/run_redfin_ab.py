"""Run the Redfin demand-pressure panel through feature_lab's out-of-time A/B.

Tests each metric alone (which signals carry?) then all combined (the real
candidate feature set). Keep only what lifts honest OOT AUC over cheapness.
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import evaluate_feature, load_df  # noqa: E402

PANEL = "/Users/noahrubin/neighborhoodiq/data/raw/redfin_panel.csv"
COLS = ["dom", "sale_to_list", "months_supply", "sold_above_list",
        "price_drops", "off_market_2wk"]


def main():
    df = load_df()
    panel = pd.read_csv(PANEL, dtype={"zip": str})
    panel["zip"] = panel["zip"].str.zfill(5)
    print(f"loaded Redfin panel: {len(panel):,} rows, {panel['zip'].nunique():,} ZIPs, "
          f"years {panel['year'].min()}-{panel['year'].max()}")

    summary = []
    for c in COLS:
        sub = panel[["zip", "year", c]].dropna(subset=[c])
        res = evaluate_feature(df, sub, "zip", [c], label=f"redfin: {c}")
        recent = res[res["base_year"].between(2019, 2021)]
        summary.append((c, recent["delta"].mean(), recent["covered_delta"].mean(),
                        recent["coverage"].mean()))

    res_all = evaluate_feature(df, panel, "zip", COLS, label="redfin: ALL demand pressure")
    recent = res_all[res_all["base_year"].between(2019, 2021)]
    summary.append(("ALL", recent["delta"].mean(), recent["covered_delta"].mean(),
                    recent["coverage"].mean()))

    print(f"\n{'='*70}\n  SUMMARY — recent episodes (2019-2021 test base), mean over episodes\n{'='*70}")
    print(f"  {'feature':>16} {'nat.delta':>10} {'covd.delta':>11} {'coverage':>9}")
    for name, d, cd, cov in summary:
        print(f"  {name:>16} {d:>+10.4f} {cd:>+11.4f} {cov*100:>8.1f}%")


if __name__ == "__main__":
    main()
