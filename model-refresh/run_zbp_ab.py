"""A/B the ZIP Business Patterns signal: is local business growth predictive?"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import evaluate_feature, load_df  # noqa: E402

PANEL = "/Users/noahrubin/neighborhoodiq/data/raw/zbp_panel.csv"


def main():
    df = load_df()
    zmeta = (df[["zip", "Metro"]].dropna(subset=["Metro"])
             .drop_duplicates("zip", keep="last"))
    p = pd.read_csv(PANEL, dtype={"zip": str}).sort_values(["zip", "year"])
    p["zip"] = p["zip"].str.zfill(5)
    p = p.merge(zmeta, on="zip", how="left")
    p["estab_growth2"] = p.groupby("zip")["estab"].pct_change(2)
    g = p.groupby(["Metro", "year"])["estab"]
    p["estab_relmetro"] = (p["estab"] - g.transform("mean")) / g.transform("std").replace(0, np.nan)

    for cols, label in [(["estab_growth2"], "business growth (2yr)"),
                        (["estab_relmetro"], "business density (rel-metro)"),
                        (["estab_growth2", "estab_relmetro"], "business growth + density")]:
        res = evaluate_feature(df, p[["zip", "year"] + cols], "zip", cols, label=label)
        r = res[res["base_year"].between(2019, 2021)]
        print(f"  >> recent mean delta={r['delta'].mean():+.4f}  "
              f"covered={r['covered_delta'].mean():+.4f}  cov={r['coverage'].mean()*100:.0f}%")


if __name__ == "__main__":
    main()
