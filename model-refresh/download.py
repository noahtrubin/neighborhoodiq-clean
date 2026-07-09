"""Download the latest Zillow ZHVI ZIP-level CSV.

Pulls directly from the static S3/CloudFront host (the www.zillow.com/research
HTML page 403s bots; the static CSV endpoint does not). The legacy short
filename (Zip_zhvi_sfrcondo.csv) was retired and now 404s — only the long
descriptive name below is valid. Refreshed ~monthly.

Attribution: data provided by Zillow Group (required wherever derived figures
are shown). https://www.zillow.com/research/data/
"""
from __future__ import annotations

import re

import pandas as pd
import requests

ZILLOW_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zhvi/"
    "Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
)
USER_AGENT = "neighborhoodiq-refresh/1.0 (+https://github.com/noahtrubin/NeighborhoodIQ)"
MIN_BYTES = 100_000_000  # ~122 MB file; anything much smaller = format/URL changed
_DATE_COL = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def download(dest: str) -> str:
    """Stream the CSV to `dest`, validating size + structure. Returns dest."""
    with requests.get(ZILLOW_URL, headers={"User-Agent": USER_AGENT},
                      stream=True, timeout=600) as r:
        r.raise_for_status()
        total = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                total += len(chunk)
    if total < MIN_BYTES:
        raise RuntimeError(
            f"Zillow download is only {total/1e6:.1f} MB (< {MIN_BYTES/1e6:.0f} MB) — "
            f"the URL or file format likely changed: {ZILLOW_URL}"
        )

    # structural sanity: expected metadata cols + at least one monthly date col
    head = pd.read_csv(dest, nrows=0)
    cols = list(head.columns)
    for required in ("RegionName", "State", "City", "Metro", "CountyName"):
        if required not in cols:
            raise RuntimeError(f"Zillow file missing expected column '{required}'")
    date_cols = [c for c in cols if _DATE_COL.match(c)]
    if not date_cols:
        raise RuntimeError("Zillow file has no YYYY-MM-DD month columns")
    print(f"downloaded {total/1e6:.0f} MB -> {dest} "
          f"(latest month column: {max(date_cols)})")
    return dest
