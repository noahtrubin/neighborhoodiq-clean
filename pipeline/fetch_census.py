"""Census ACS 5-year collector.

The official Census API now requires a registered+activated key, and the key
supplied for this project was rejected ("Invalid Key"). We therefore source the
identical ACS 5-year estimates through the keyless Census Reporter API, pulling
every MA ZCTA in a single containment query (860|04000US25).
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

import pandas as pd

from . import config as C


def _fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "neighborhoodiq-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def fetch() -> pd.DataFrame:
    table_ids = ",".join(C.CENSUS_FIELDS.keys())
    qs = urllib.parse.urlencode({"table_ids": table_ids, "geo_ids": C.CENSUS_MA_CONTAINMENT})
    url = f"{C.CENSUS_BASE}?{qs}"
    print(f"[census] requesting {len(C.CENSUS_FIELDS)} tables for all MA ZCTAs ...")
    payload = _fetch_json(url)

    release = payload.get("release", {})
    print(f"[census] release: {release.get('name')} ({release.get('years')})")

    data = payload.get("data", {})
    rows = []
    for geoid, tables in data.items():
        # geoid looks like '86000US02139' -> last 5 chars are the ZIP
        zip_code = C.zfill5(geoid[-5:])
        if zip_code is None:
            continue
        row = {"zip": zip_code}
        for table_id, (col_id, field_name) in C.CENSUS_FIELDS.items():
            est = tables.get(table_id, {}).get("estimate", {})
            row[field_name] = est.get(col_id)
        rows.append(row)

    df = pd.DataFrame(rows).drop_duplicates(subset="zip").sort_values("zip").reset_index(drop=True)
    print(f"[census] {len(df)} ZCTAs collected")
    return df


def main() -> pd.DataFrame:
    C.ensure_dirs()
    df = fetch()
    out = C.INTERIM_DIR / "census.csv"
    df.to_csv(out, index=False)
    print(f"[census] wrote {out}")
    return df


if __name__ == "__main__":
    main()
