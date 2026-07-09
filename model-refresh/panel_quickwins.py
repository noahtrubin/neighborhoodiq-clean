"""Quick-win county signals: NET migration (in - out) and JOBS growth (CBP employment).

Net migration is sharper than gross inflow (controls for churn). Jobs growth is
another 'flowing in' signal. Both county-grain, mapped to ZIP. CBP employment via
the Census API (BLS blocks scrapers; CBP is the same jobs signal, keyed access).

Output: data/raw/quickwins_panel.csv  (zip, year, net_migration, net_rate, emp)
"""
from __future__ import annotations

import io
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from panel_census import get_key  # noqa: E402
from panel_county import _get  # noqa: E402  (UA-aware fetch)

OUT = "/Users/noahrubin/neighborhoodiq/data/raw/quickwins_panel.csv"
XWALK = "/Users/noahrubin/neighborhoodiq/data/raw/zcta_county.csv"
COUNTY = "/Users/noahrubin/neighborhoodiq/data/raw/county_panel.csv"


def outflow() -> pd.DataFrame:
    rows = []
    for y1 in range(2011, 2023):
        y2 = y1 + 1
        txt = _get(f"https://www.irs.gov/pub/irs-soi/countyoutflow{str(y1)[2:]}{str(y2)[2:]}.csv")
        if txt is None:
            continue
        d = pd.read_csv(io.StringIO(txt), dtype=str)
        d.columns = [c.strip().lower() for c in d.columns]
        sf = pd.to_numeric(d["y2_statefips"], errors="coerce")
        cf = pd.to_numeric(d["y2_countyfips"], errors="coerce")
        tot = d[(sf == 96) & (cf == 0)].copy()           # total OUT of the origin county
        tot["county_fips"] = tot["y1_statefips"].str.zfill(2) + tot["y1_countyfips"].str.zfill(3)
        tot["outflow_returns"] = pd.to_numeric(tot["n1"], errors="coerce")
        tot["year"] = y2
        rows.append(tot[["county_fips", "year", "outflow_returns"]])
        print(f"  [out] {y1}-{y2}: {len(tot):,}")
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def cbp_jobs() -> pd.DataFrame:
    key = get_key()
    rows = []
    for y in range(2012, 2023):
        nv = "NAICS2017" if y >= 2017 else "NAICS2012"
        txt = _get(f"https://api.census.gov/data/{y}/cbp?get=EMP&for=county:*&{nv}=00&key={key}")
        if txt is None:
            continue
        import json
        data = json.loads(txt)
        d = pd.DataFrame(data[1:], columns=data[0])
        d["county_fips"] = d["state"].str.zfill(2) + d["county"].str.zfill(3)
        d["emp"] = pd.to_numeric(d["EMP"], errors="coerce")
        d["year"] = y
        rows.append(d[["county_fips", "year", "emp"]])
        print(f"  [cbp] {y}: {len(d):,} counties")
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def build() -> pd.DataFrame:
    xwalk = pd.read_csv(XWALK, dtype={"zip": str, "county_fips": str})
    inflow = pd.read_csv(COUNTY, dtype={"zip": str})[["zip", "year", "inflow_returns"]]
    # collapse inflow to county via xwalk (inflow_returns is county value already broadcast)
    inflow = inflow.merge(xwalk, on="zip").groupby(["county_fips", "year"], as_index=False)[
        "inflow_returns"].first()

    print("[qw] IRS outflow ..."); out = outflow()
    print("[qw] CBP jobs ...");    jobs = cbp_jobs()

    county = inflow.merge(out, on=["county_fips", "year"], how="outer") \
                   .merge(jobs, on=["county_fips", "year"], how="outer")
    county["net_migration"] = county["inflow_returns"] - county["outflow_returns"]
    denom = county["inflow_returns"] + county["outflow_returns"]
    county["net_rate"] = county["net_migration"] / denom.where(denom > 0)

    panel = xwalk.merge(county, on="county_fips", how="inner")
    panel = panel[["zip", "year", "net_migration", "net_rate", "emp"]].dropna(subset=["year"])
    panel["year"] = panel["year"].astype(int)
    panel.to_csv(OUT, index=False)
    print(f"[qw] wrote {OUT}  ({len(panel):,} zip-years, {panel['zip'].nunique():,} ZIPs)")
    return panel


if __name__ == "__main__":
    build()
