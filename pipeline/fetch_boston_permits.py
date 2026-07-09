"""Boston building-permits collector (data.boston.gov CKAN datastore).

Aggregates the ~728k-row approved-permits table to one row per ZIP using the
datastore SQL endpoint (permit count per ZIP).

Note: summing `declared_valuation` would require an in-SQL numeric cast of its
'$'/comma text, but the datastore's WAF returns 403 for any query containing
that cast pattern (plain COUNT works). Valuation is a secondary signal for a
Boston-only source, so it is intentionally omitted rather than pulling the full
727k-row dump to compute it client-side."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

import pandas as pd

from . import config as C

_RID = C.BOSTON_RESOURCE_ID

_SQL_COUNT = f'SELECT "zip", COUNT(*) AS permit_count FROM "{_RID}" GROUP BY "zip"'


def _run_sql(sql: str) -> list[dict]:
    url = f"{C.BOSTON_SQL_URL}?{urllib.parse.urlencode({'sql': sql})}"
    req = urllib.request.Request(url, headers={"User-Agent": "neighborhoodiq-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.load(resp)
    if not payload.get("success"):
        raise RuntimeError(f"CKAN SQL error: {payload.get('error')}")
    return payload["result"]["records"]


def fetch() -> pd.DataFrame:
    print("[boston] querying datastore (permit count by ZIP) ...")
    records = _run_sql(_SQL_COUNT)

    df = pd.DataFrame(records)
    df["zip"] = df["zip"].apply(C.zfill5)
    df = df[df["zip"].apply(C.is_ma_zip)].copy()

    df["permit_count"] = pd.to_numeric(df["permit_count"], errors="coerce").astype("Int64")
    if "total_declared_valuation" in df.columns:
        df["total_declared_valuation"] = pd.to_numeric(
            df["total_declared_valuation"], errors="coerce"
        ).round(0)

    df = df.dropna(subset=["zip"]).groupby("zip", as_index=False).sum(numeric_only=True)
    df = df.rename(columns={"permit_count": "boston_permit_count"})
    if "total_declared_valuation" in df.columns:
        df = df.rename(columns={"total_declared_valuation": "boston_permit_valuation"})
    print(f"[boston] {len(df)} Boston-area ZIPs with permits")
    return df.sort_values("zip").reset_index(drop=True)


def main() -> pd.DataFrame:
    C.ensure_dirs()
    df = fetch()
    out = C.INTERIM_DIR / "boston_permits.csv"
    df.to_csv(out, index=False)
    print(f"[boston] wrote {out}")
    return df


if __name__ == "__main__":
    main()
