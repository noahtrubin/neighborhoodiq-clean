"""Build a NATIONAL, HISTORICAL Census ACS panel (one row per ZCTA-year).

Demand pressure (Redfin) carried no out-of-time signal — it's priced in and
mean-reverts. Income/education growth is the orthogonal STRUCTURAL signal
gentrification theory points to (richer, more-educated residents moving in), and
it is NOT derived from price, so it can't be priced-in the same way. This builds
the panel feature_lab.py then judges against the honest baseline.

Source: official Census API (ACS 5-year), which — unlike the keyless Census
Reporter wrapper — exposes HISTORICAL vintages, so we can train the 2014 episode.
ACS 5yr year Y = a pooled 5-year window ending in Y, so it's known "as of" Y.

Needs a FREE key: https://api.census.gov/data/key_signup.html
Provide it WITHOUT pasting into chat — either:
  export CENSUS_API_KEY=xxxx…           (env var), or
  echo xxxx… > data/raw/census_key.txt  (gitignored file)

Output: data/raw/census_panel.csv  (zip, year, median_income, bachelors_share, population)

Usage:
  /Users/noahrubin/gentrification-model/.venv/bin/python model-refresh/panel_census.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

import pandas as pd

OUT = "/Users/noahrubin/neighborhoodiq/data/raw/census_panel.csv"
KEY_FILE = "/Users/noahrubin/neighborhoodiq/data/raw/census_key.txt"
YEARS = list(range(2011, 2024))           # ACS5 2011..2023
CORE = ["B19013_001E", "B01003_001E"]     # median HH income, total population (all years)
EDU = ["B15003_001E", "B15003_022E", "B15003_023E",
       "B15003_024E", "B15003_025E"]      # 25+ total, bachelor's, master's, prof, doctorate (2012+)
ZCTA_GEO = "zip%20code%20tabulation%20area"


def get_key() -> str:
    k = os.environ.get("CENSUS_API_KEY", "").strip()
    if k:
        return k
    for p in (KEY_FILE, os.path.expanduser("~/.census_api_key")):
        if os.path.exists(p):
            with open(p) as f:
                k = f.read().strip()
            if k:
                return k
    sys.exit(
        "No Census API key found.\n"
        "  1) get one free: https://api.census.gov/data/key_signup.html\n"
        "  2) provide it:  export CENSUS_API_KEY=...   OR   echo KEY > "
        + KEY_FILE
    )


def fetch_year(year: int, key: str, variables: list[str]) -> pd.DataFrame | None:
    url = (f"https://api.census.gov/data/{year}/acs/acs5?get=NAME,"
           f"{','.join(variables)}&for={ZCTA_GEO}:*&key={key}")
    req = urllib.request.Request(url, headers={"User-Agent": "neighborhoodiq/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[census] {year}: request failed ({e})")
        return None
    if not data or not isinstance(data, list) or len(data) < 2:
        print(f"[census] {year}: empty/uned response")
        return None
    df = pd.DataFrame(data[1:], columns=data[0])
    zcol = next((c for c in df.columns if "zip code tabulation" in c.lower()), None)
    if zcol is None:
        print(f"[census] {year}: no ZCTA column in {list(df.columns)}")
        return None
    df = df.rename(columns={zcol: "zip"})
    df["zip"] = df["zip"].astype(str).str.zfill(5)
    for v in variables:
        df[v] = pd.to_numeric(df[v], errors="coerce")
        df.loc[df[v] < 0, v] = pd.NA          # Census null sentinels (-666666666 etc.)
    df["year"] = year
    return df


def build() -> pd.DataFrame:
    key = get_key()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    frames = []
    for y in YEARS:
        variables = CORE + (EDU if y >= 2012 else [])
        df = fetch_year(y, key, variables)
        if df is None and variables != CORE:           # retry core-only
            df = fetch_year(y, key, CORE)
        if df is None:
            continue
        rec = pd.DataFrame({"zip": df["zip"], "year": df["year"]})
        rec["median_income"] = df.get("B19013_001E")
        rec["population"] = df.get("B01003_001E")
        if "B15003_001E" in df.columns:
            tot = df["B15003_001E"]
            ba = (df.get("B15003_022E", 0).fillna(0) + df.get("B15003_023E", 0).fillna(0)
                  + df.get("B15003_024E", 0).fillna(0) + df.get("B15003_025E", 0).fillna(0))
            rec["bachelors_share"] = (ba / tot).where(tot > 0)
        else:
            rec["bachelors_share"] = pd.NA
        frames.append(rec)
        print(f"[census] {y}: {len(rec):,} ZCTAs "
              f"(income cov {rec['median_income'].notna().mean():.0%}, "
              f"edu cov {rec['bachelors_share'].notna().mean():.0%})")
        time.sleep(0.3)
    if not frames:
        sys.exit("[census] no years fetched; check key/network")
    panel = pd.concat(frames, ignore_index=True).sort_values(["zip", "year"])
    panel.to_csv(OUT, index=False)
    print(f"[census] wrote {OUT}  ({len(panel):,} rows, {panel['zip'].nunique():,} ZCTAs, "
          f"years {panel['year'].min()}-{panel['year'].max()})")
    return panel


if __name__ == "__main__":
    build()
