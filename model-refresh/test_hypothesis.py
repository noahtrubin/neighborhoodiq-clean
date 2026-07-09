"""HYPOTHESIS: cheap areas with people moving in -> prices rise over the next 5 years.

The plain-English test: as of year B, sort every ZIP into 4 buckets
(cheap/expensive x high-inflow/low-inflow), then look at what ACTUALLY happened
to prices over B->B+5. If the hypothesis holds, 'cheap + people moving in' should
have the highest 5-year appreciation and the highest hit rate.

Cheap        = cheap RELATIVE TO ITS NEIGHBORS (own price / mean neighbor price,
               bottom third) -- a local value gap, per the user's refinement
People-moving-in = top third of in-migration GROWTH that year (inflow_growth2)
                   (also reported: in-migrant INCOME, agi_per_inmover)
Outcome      = realized 5yr appreciation, and % hitting >=60% (the model's target)
Run out-of-time across independent windows so it's not one lucky period.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model  # noqa: E402
from feature_lab import load_df  # noqa: E402

COUNTY = "/Users/noahrubin/neighborhoodiq/data/raw/county_panel.csv"
NBR = "/Users/noahrubin/neighborhoodiq/data/raw/neighbor_panel.csv"


def prep_county() -> pd.DataFrame:
    c = pd.read_csv(COUNTY, dtype={"zip": str}).sort_values(["zip", "year"])
    c["zip"] = c["zip"].str.zfill(5)
    c["inflow_growth2"] = c.groupby("zip")["inflow_returns"].pct_change(2)
    return c


def prep_nbr() -> pd.DataFrame:
    n = pd.read_csv(NBR, dtype={"zip": str})
    n["zip"] = n["zip"].str.zfill(5)
    return n[["zip", "year", "price_vs_nbr"]]


def test_window(df: pd.DataFrame, county: pd.DataFrame, nbr: pd.DataFrame,
                B: int, inflow_col: str):
    tgt = B + 5
    if f"zhvi_{B}" not in df.columns or f"zhvi_{tgt}" not in df.columns:
        return None
    d = df[["zip"]].copy()
    d["cur"], d["fut"] = df[f"zhvi_{B}"].to_numpy(), df[f"zhvi_{tgt}"].to_numpy()
    d = d[(d["cur"] > 0) & d["fut"].notna()]
    d["appr"] = d["fut"] / d["cur"] - 1
    d["win"] = (d["appr"] >= 0.60).astype(int)
    cb = county[county["year"] == B][["zip", inflow_col]]
    nb = nbr[nbr["year"] == B][["zip", "price_vs_nbr"]]
    d = (d.merge(cb, on="zip", how="inner").merge(nb, on="zip", how="inner")
         .dropna(subset=["price_vs_nbr", inflow_col]))
    if len(d) < 500:
        return None

    # cheap RELATIVE TO NEIGHBORS: cheapest third by own-price / neighbor-price
    cheap = d["price_vs_nbr"] <= d["price_vs_nbr"].quantile(0.33)
    hi = d[inflow_col] >= d[inflow_col].quantile(0.67)
    lo = d[inflow_col] <= d[inflow_col].quantile(0.33)
    groups = {
        "CHEAP + inflow (hypothesis)": cheap & hi,
        "cheap, low inflow": cheap & lo,
        "expensive + inflow": (~cheap) & hi,
        "expensive, low inflow": (~cheap) & lo,
    }
    out = {"B": B, "overall_appr": d["appr"].mean(), "overall_hit": d["win"].mean(),
           "n": len(d), "groups": {}}
    for name, m in groups.items():
        s = d[m]
        out["groups"][name] = (s["appr"].mean(), s["win"].mean(), len(s))
    return out


def main():
    df = load_df()
    county = prep_county()
    nbr = prep_nbr()
    print("  CHEAP = cheapest third RELATIVE TO NEIGHBORS (own price / mean neighbor price)")
    for inflow_col, axis in [("inflow_growth2", "MORE PEOPLE MOVING IN (migration volume growth)"),
                             ("agi_per_inmover", "RICHER PEOPLE MOVING IN (in-migrant income)")]:
        print(f"\n{'='*82}\n  INFLOW = {axis}\n{'='*82}")
        for B in (2014, 2016, 2019):
            r = test_window(df, county, nbr, B, inflow_col)
            if r is None:
                continue
            print(f"\n  As of {B}  ->  realized {B}-{B+5}    "
                  f"(all ZIPs: avg +{r['overall_appr']*100:.0f}%, "
                  f"{r['overall_hit']*100:.0f}% hit >=60%, n={r['n']:,})")
            print(f"    {'bucket':<32}{'avg 5yr appr':>14}{'% hit >=60%':>13}{'n':>8}")
            for name, (ap, hit, n) in r["groups"].items():
                mark = "  <--" if name.startswith("CHEAP") else ""
                print(f"    {name:<32}{ap*100:>13.0f}%{hit*100:>12.0f}%{n:>8,}{mark}")


if __name__ == "__main__":
    main()
