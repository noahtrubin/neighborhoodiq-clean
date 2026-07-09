"""Zillow ZHVI collector — annual (mean-of-months) home values 2010-2024, MA only."""
from __future__ import annotations

import re
import urllib.request

import pandas as pd

from . import config as C

_DATE_COL = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _download() -> "C.Path":
    C.ensure_dirs()
    local = C.RAW_DIR / "zillow_zhvi_zip.csv"
    if local.exists() and local.stat().st_size > 0:
        print(f"[zillow] using cached {local.name}")
        return local
    print("[zillow] downloading ZHVI zip CSV ...")
    req = urllib.request.Request(C.ZILLOW_URL, headers={"User-Agent": "neighborhoodiq-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp, open(local, "wb") as fh:
        fh.write(resp.read())
    print(f"[zillow] saved {local} ({local.stat().st_size/1e6:.1f} MB)")
    return local


def fetch() -> pd.DataFrame:
    local = _download()
    df = pd.read_csv(local, dtype={"RegionName": str})
    state_col = "State" if "State" in df.columns else "StateName"
    ma = df[df[state_col] == "MA"].copy()
    print(f"[zillow] {len(ma)} MA ZIP rows")

    date_cols = [c for c in df.columns if _DATE_COL.match(str(c))]
    out = pd.DataFrame({"zip": ma["RegionName"].apply(C.zfill5)})
    for year in C.ZILLOW_YEARS:
        cols = [c for c in date_cols if c.startswith(f"{year}-")]
        out[f"zhvi_{year}"] = ma[cols].mean(axis=1).round(0) if cols else pd.NA

    out = out.dropna(subset=["zip"]).drop_duplicates(subset="zip").sort_values("zip").reset_index(drop=True)
    return out


def main() -> pd.DataFrame:
    C.ensure_dirs()
    df = fetch()
    out = C.INTERIM_DIR / "zillow.csv"
    df.to_csv(out, index=False)
    print(f"[zillow] wrote {out} ({len(df)} ZIPs)")
    return df


if __name__ == "__main__":
    main()
