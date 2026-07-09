"""Build a county-level fundamentals panel, mapped down to ZIP.

Tests the "money / people / supply flowing in" hypothesis at county grain (light
downloads), before committing to the heavy tract-level HMDA build:
  * IRS migration  — avg AGI of households moving IN (are richer people arriving?)
  * Census permits — new housing units permitted (supply pipeline / investment)
  * BLS LAUS       — county unemployment rate (labor health), best-effort (BLS may 403)

Output: data/raw/county_panel.csv  (zip, year, agi_per_inmover, inflow_returns,
        permit_units, unemployment)
"""
from __future__ import annotations

import io
import os
import sys
import urllib.request

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crosswalk  # noqa: E402

OUT = "/Users/noahrubin/neighborhoodiq/data/raw/county_panel.csv"
XWALK = "/Users/noahrubin/neighborhoodiq/data/raw/zcta_county.csv"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}


def _get(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        print(f"  fetch failed {url.split('/')[-1]}: {e}")
        return None


def irs_migration() -> pd.DataFrame:
    """avg AGI per in-migrating return per (county, year). year = end of the
    migration window (countyinflow{y1}{y2} -> year y2)."""
    rows = []
    for y1 in range(2011, 2023):
        y2 = y1 + 1
        url = f"https://www.irs.gov/pub/irs-soi/countyinflow{str(y1)[2:]}{str(y2)[2:]}.csv"
        txt = _get(url)
        if txt is None:
            continue
        d = pd.read_csv(io.StringIO(txt), dtype=str)
        d.columns = [c.strip().lower() for c in d.columns]
        # total in-migration row: origin code 96/000 = "Total Migration-US and Foreign".
        # Recent vintages dropped zero-padding (96/0 not 96/000), so compare numerically.
        sf = pd.to_numeric(d["y1_statefips"], errors="coerce")
        cf = pd.to_numeric(d["y1_countyfips"], errors="coerce")
        tot = d[(sf == 96) & (cf == 0)].copy()
        tot["county_fips"] = tot["y2_statefips"].str.zfill(2) + tot["y2_countyfips"].str.zfill(3)
        for c in ("n1", "agi"):
            tot[c] = pd.to_numeric(tot[c], errors="coerce")
        tot = tot[tot["n1"] > 0]
        tot["agi_per_inmover"] = tot["agi"] / tot["n1"]   # $thousands per return
        tot["year"] = y2
        rows.append(tot[["county_fips", "year", "agi_per_inmover", "n1"]]
                    .rename(columns={"n1": "inflow_returns"}))
        print(f"  [irs] {y1}-{y2}: {len(tot):,} counties")
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def census_permits() -> pd.DataFrame:
    """total housing units permitted per (county, year)."""
    rows = []
    for y in range(2011, 2024):
        txt = _get(f"https://www2.census.gov/econ/bps/County/co{y}a.txt")
        if txt is None:
            continue
        d = pd.read_csv(io.StringIO(txt), skiprows=2, header=None, dtype=str,
                        encoding_errors="replace")
        # cols: 0 year,1 stateFIPS,2 countyFIPS, units at 7(1u),10(2u),13(3-4),16(5+)
        d = d[d[1].notna() & d[2].notna()].copy()
        fips = d[1].str.strip().str.zfill(2) + d[2].str.strip().str.zfill(3)
        units = sum(pd.to_numeric(d[c], errors="coerce").fillna(0) for c in (7, 10, 13, 16))
        rows.append(pd.DataFrame({"county_fips": fips, "year": y, "permit_units": units}))
        print(f"  [bps] {y}: {len(d):,} counties")
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def bls_laus() -> pd.DataFrame:
    """county unemployment rate per year (best-effort; BLS may block)."""
    rows = []
    for y in range(2011, 2024):
        txt = _get(f"https://www.bls.gov/lau/laucnty{str(y)[2:]}.txt")
        if txt is None or txt.lstrip().lower().startswith("<!doctype"):
            continue
        recs = []
        for line in txt.splitlines():
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 9 and parts[1].isdigit() and parts[2].isdigit():
                rate = parts[-1].replace(",", "")
                try:
                    recs.append((parts[1].zfill(2) + parts[2].zfill(3), float(rate)))
                except ValueError:
                    continue
        if recs:
            r = pd.DataFrame(recs, columns=["county_fips", "unemployment"])
            r["year"] = y
            rows.append(r)
            print(f"  [laus] {y}: {len(r):,} counties")
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def build() -> pd.DataFrame:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    xwalk = crosswalk.build() if not os.path.exists(XWALK) else \
        pd.read_csv(XWALK, dtype={"zip": str, "county_fips": str})
    print("[county] IRS migration ...")
    irs = irs_migration()
    print("[county] Census permits ...")
    permits = census_permits()
    print("[county] BLS LAUS ...")
    laus = bls_laus()

    county = None
    for part in (irs, permits, laus):
        if part is None or part.empty:
            continue
        county = part if county is None else county.merge(part, on=["county_fips", "year"], how="outer")
    if county is None:
        sys.exit("[county] no sources fetched")

    panel = xwalk.merge(county, on="county_fips", how="inner")
    keep = [c for c in ["agi_per_inmover", "inflow_returns", "permit_units", "unemployment"]
            if c in panel.columns]
    panel = panel[["zip", "year"] + keep].dropna(subset=["year"])
    panel["year"] = panel["year"].astype(int)
    panel.to_csv(OUT, index=False)
    print(f"[county] wrote {OUT}  ({len(panel):,} zip-years, {panel['zip'].nunique():,} ZIPs, "
          f"cols {keep})")
    return panel


if __name__ == "__main__":
    build()
