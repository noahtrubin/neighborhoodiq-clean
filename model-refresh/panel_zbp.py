"""Build a ZIP Business Patterns panel (establishments per ZIP per year).

Growth in local businesses (cafes, restaurants, retail, services) is a classic
early-gentrification amenity signal — and it's ZIP-level with history, orthogonal
to price. ZBP runs 2012-2018 (the NAICS variable name changes in 2017), enough to
test the signal on the training episodes. (If it works, recent scoring would need
County Business Patterns, which continues past 2018 — noted for Phase E.)

Output: data/raw/zbp_panel.csv  (zip, year, estab, emp)

Usage:
  /Users/noahrubin/gentrification-model/.venv/bin/python model-refresh/panel_zbp.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from panel_census import get_key  # noqa: E402  (reuse key loader)

OUT = "/Users/noahrubin/neighborhoodiq/data/raw/zbp_panel.csv"
YEARS = list(range(2012, 2019))   # ZBP 2012..2018


def naics_var(year: int) -> str:
    return "NAICS2017" if year >= 2017 else "NAICS2012"


def fetch_year(year: int, key: str) -> pd.DataFrame | None:
    nv = naics_var(year)
    url = (f"https://api.census.gov/data/{year}/zbp?get=ESTAB,EMP&for=zip%20code:*"
           f"&{nv}=00&key={key}")
    req = urllib.request.Request(url, headers={"User-Agent": "neighborhoodiq/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[zbp] {year}: request failed ({e})")
        return None
    df = pd.DataFrame(data[1:], columns=data[0])
    zcol = next((c for c in df.columns if c.lower() in ("zip code", "zipcode", "zip_code")), None)
    if zcol is None:
        print(f"[zbp] {year}: no zip column in {list(df.columns)}")
        return None
    out = pd.DataFrame({
        "zip": df[zcol].astype(str).str.zfill(5),
        "year": year,
        "estab": pd.to_numeric(df.get("ESTAB"), errors="coerce"),
        "emp": pd.to_numeric(df.get("EMP"), errors="coerce"),
    })
    return out


def build() -> pd.DataFrame:
    key = get_key()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    frames = []
    for y in YEARS:
        df = fetch_year(y, key)
        if df is None:
            continue
        frames.append(df)
        print(f"[zbp] {y}: {len(df):,} ZIPs (estab cov {df['estab'].notna().mean():.0%})")
        time.sleep(0.3)
    if not frames:
        sys.exit("[zbp] no years fetched")
    panel = pd.concat(frames, ignore_index=True).sort_values(["zip", "year"])
    panel.to_csv(OUT, index=False)
    print(f"[zbp] wrote {OUT}  ({len(panel):,} rows, {panel['zip'].nunique():,} ZIPs, "
          f"years {panel['year'].min()}-{panel['year'].max()})")
    return panel


if __name__ == "__main__":
    build()
