"""A/B the county 'flowing in' signals: in-migrant income, migration volume,
and permit (supply) growth. County values are broadcast to every ZIP in the
county, so this is a county-grain test at ZIP resolution."""
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
    p["agi_inmover_chg2"] = p.groupby("zip")["agi_per_inmover"].pct_change(2)
    p["permit_growth2"] = p.groupby("zip")["permit_units"].pct_change(2)
    p["inflow_growth2"] = p.groupby("zip")["inflow_returns"].pct_change(2)
    print(f"county panel: {len(p):,} zip-years, {p['zip'].nunique():,} ZIPs")

    summary = []
    for cols, label in [
        (["agi_per_inmover"], "income of in-migrants (level)"),
        (["agi_inmover_chg2"], "in-migrant income (2yr change)"),
        (["permit_growth2"], "permit/supply growth (2yr)"),
        (["inflow_growth2"], "migration volume growth (2yr)"),
        (["agi_per_inmover", "agi_inmover_chg2", "permit_growth2", "inflow_growth2"],
         "ALL county flow signals"),
    ]:
        res = evaluate_feature(df, p[["zip", "year"] + cols], "zip", cols, label=label)
        r = res[res["base_year"].between(2019, 2021)]
        summary.append((label, r["delta"].mean(), r["covered_delta"].mean(),
                        r["coverage"].mean()))

    print(f"\n{'='*74}\n  SUMMARY — recent episodes (2019-2021 test base)\n{'='*74}")
    print(f"  {'feature set':>34} {'nat.delta':>10} {'covd.delta':>11} {'cov':>7}")
    for name, d, cd, cov in summary:
        print(f"  {name:>34} {d:>+10.4f} {cd:>+11.4f} {cov*100:>6.1f}%")


if __name__ == "__main__":
    main()
