"""ZCTA(ZIP) -> dominant county FIPS crosswalk, from the Census ZCTA-county
relationship file. Needed to broadcast county-level features (migration, permits,
jobs) down to the ZIP grain the model scores on.

A ZCTA can span counties; we assign each ZIP to the county holding the largest
share of its population (ZPOPPCT). Output: data/raw/zcta_county.csv (zip, county_fips).
"""
from __future__ import annotations

import io
import os
import urllib.request

import pandas as pd

REL_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel/zcta_county_rel_10.txt"
OUT = "/Users/noahrubin/neighborhoodiq/data/raw/zcta_county.csv"


def build() -> pd.DataFrame:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    req = urllib.request.Request(REL_URL, headers={"User-Agent": "neighborhoodiq/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    df = pd.read_csv(io.StringIO(raw),
                     dtype={"ZCTA5": str, "STATE": str, "COUNTY": str})
    df["zip"] = df["ZCTA5"].str.zfill(5)
    df["county_fips"] = df["STATE"].str.zfill(2) + df["COUNTY"].str.zfill(3)
    # dominant county per ZCTA = largest share of the ZCTA's population
    df = df.sort_values("ZPOPPCT").drop_duplicates("zip", keep="last")
    out = df[["zip", "county_fips"]].sort_values("zip").reset_index(drop=True)
    out.to_csv(OUT, index=False)
    print(f"[xwalk] wrote {OUT}  ({len(out):,} ZIPs -> {out['county_fips'].nunique():,} counties)")
    return out


if __name__ == "__main__":
    build()
