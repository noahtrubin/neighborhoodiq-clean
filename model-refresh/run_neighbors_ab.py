"""A/B the spatial-spillover signals against the cheapness baseline."""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import evaluate_feature, load_df  # noqa: E402

PANEL = "/Users/noahrubin/neighborhoodiq/data/raw/neighbor_panel.csv"


def main():
    df = load_df()
    p = pd.read_csv(PANEL, dtype={"zip": str})
    p["zip"] = p["zip"].str.zfill(5)
    print(f"neighbor panel: {len(p):,} rows, {p['zip'].nunique():,} ZIPs")

    summary = []
    for cols, label in [
        (["neighbor_appr3"], "neighbors' past appreciation"),
        (["spillover_gap3"], "spillover gap (neighbors - me)"),
        (["neighbor_appr3", "spillover_gap3"], "both spatial signals"),
    ]:
        res = evaluate_feature(df, p[["zip", "year"] + cols], "zip", cols, label=label)
        r = res[res["base_year"].between(2014, 2021)]
        summary.append((label, r["delta"].mean(), r["covered_delta"].mean(),
                        r["coverage"].mean()))
    print(f"\n{'='*70}\n  SUMMARY — episodes 2014-2021\n{'='*70}")
    print(f"  {'feature set':>32} {'nat.delta':>10} {'covd.delta':>11} {'cov':>7}")
    for name, d, cd, cov in summary:
        print(f"  {name:>32} {d:>+10.4f} {cd:>+11.4f} {cov*100:>6.1f}%")


if __name__ == "__main__":
    main()
