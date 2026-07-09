"""Targeted amenity panel: coffee shops / food-drink / arts establishments per ZIP-year.

The broad 'all businesses' test barely flickered (+0.004). This tests the SHARPER
'gentrification amenity' version: coffee shops (NAICS 722515), all food & drink
(722: restaurants/bars/cafes), and arts/entertainment/rec (71). 2012-2018.

Output: data/raw/amenity_panel.csv  (zip, year, coffee, food, arts)
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from panel_census import get_key  # noqa: E402

OUT = "/Users/noahrubin/neighborhoodiq/data/raw/amenity_panel.csv"
YEARS = list(range(2012, 2019))
CODES = {"coffee": "722515", "food": "722", "arts": "71"}


def fetch(year: int, code: str, key: str) -> pd.DataFrame | None:
    nv = "NAICS2017" if year >= 2017 else "NAICS2012"
    url = (f"https://api.census.gov/data/{year}/zbp?get=ESTAB&for=zip%20code:*"
           f"&{nv}={code}&key={key}")
    try:
        with urllib.request.urlopen(urllib.request.Request(
                url, headers={"User-Agent": "neighborhoodiq/1.0"}), timeout=120) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"  {year}/{code}: {e}")
        return None
    df = pd.DataFrame(data[1:], columns=data[0])
    zc = next(c for c in df.columns if c.lower().startswith("zip"))
    return pd.DataFrame({"zip": df[zc].astype(str).str.zfill(5),
                         "year": year,
                         "estab": pd.to_numeric(df["ESTAB"], errors="coerce")})


def build() -> pd.DataFrame:
    key = get_key()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    per_code = {}
    for name, code in CODES.items():
        frames = []
        for y in YEARS:
            d = fetch(y, code, key)
            if d is not None:
                frames.append(d.rename(columns={"estab": name}))
            time.sleep(0.2)
        if frames:
            per_code[name] = pd.concat(frames, ignore_index=True)
            print(f"[amenity] {name} (NAICS {code}): "
                  f"{per_code[name]['zip'].nunique():,} ZIPs")
    panel = None
    for name, d in per_code.items():
        panel = d if panel is None else panel.merge(d, on=["zip", "year"], how="outer")
    panel = panel.sort_values(["zip", "year"])
    panel.to_csv(OUT, index=False)
    print(f"[amenity] wrote {OUT}  ({len(panel):,} rows, cols {list(CODES)})")
    return panel


if __name__ == "__main__":
    build()
