"""Does ACCELERATION of in-migration add signal on top of migration level+growth?

Compares: cheapness + [migration level + growth]   (the win so far)
      vs:  cheapness + [migration level + growth + ACCELERATION]
The marginal = whether 'the inflow is speeding up' adds anything new.
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import evaluate_feature, load_df  # noqa: E402

PANEL = "/Users/noahrubin/neighborhoodiq/data/raw/county_panel.csv"


def main():
    df = load_df()
    p = pd.read_csv(PANEL, dtype={"zip": str}).sort_values(["zip", "year"])
    p["zip"] = p["zip"].str.zfill(5)
    # growth (first change) and acceleration (change of the growth)
    p["inflow_growth2"] = p.groupby("zip")["inflow_returns"].pct_change(2)
    p["inflow_g1"] = p.groupby("zip")["inflow_returns"].pct_change(1)
    p["inflow_accel"] = p.groupby("zip")["inflow_g1"].diff(1)
    p["agi_g1"] = p.groupby("zip")["agi_per_inmover"].pct_change(1)
    p["agi_accel"] = p.groupby("zip")["agi_g1"].diff(1)

    WIN = ["agi_per_inmover", "inflow_growth2"]
    ACCEL = ["inflow_accel", "agi_accel"]
    print(f"county panel: {len(p):,} rows")

    summary = []
    for cols, label in [
        (ACCEL, "acceleration only"),
        (WIN, "migration win (level+growth)"),
        (WIN + ACCEL, "migration win + acceleration"),
    ]:
        res = evaluate_feature(df, p[["zip", "year"] + cols], "zip", cols, label=label)
        r = res[res["base_year"].between(2014, 2021)]
        summary.append((label, r["delta"].mean(), r["covered_delta"].mean()))
    print(f"\n{'='*66}\n  SUMMARY — episodes 2014-2021 (where migration data exists)\n{'='*66}")
    print(f"  {'feature set':>32} {'nat.delta':>10} {'covd.delta':>11}")
    for name, d, cd in summary:
        print(f"  {name:>32} {d:>+10.4f} {cd:>+11.4f}")
    print("\n  -> acceleration ADDS value iff 'win + acceleration' > 'migration win'")


if __name__ == "__main__":
    main()
