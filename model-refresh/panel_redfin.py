"""Build a NATIONAL, HISTORICAL Redfin demand-pressure panel (one row per zip-year).

The price-only model is a cheapness bet at OOT AUC ~0.61. Demand pressure is the
most promising ZIP-level fundamental with real history: when homes sell fast, above
list, with little supply, prices tend to follow. This builds the panel that
feature_lab.py then judges against the honest out-of-time baseline.

The published Redfin file is a ~1.5 GB national gzip (decompresses to ~15 GB), so we
STREAM it and accumulate per (zip, year) running means — the full file is never
stored. We keep only INTENSIVE metrics (ratios / medians), which average cleanly to
an annual value regardless of the row's period_duration; extensive counts
(inventory, homes_sold) are skipped because mixing durations would distort them.

Output: data/raw/redfin_panel.csv  (gitignored; cached for reuse)
  columns: zip, year, dom, sale_to_list, months_supply, sold_above_list,
           price_drops, off_market_2wk, n_obs

Usage:
  /Users/noahrubin/gentrification-model/.venv/bin/python model-refresh/panel_redfin.py
"""
from __future__ import annotations

import csv
import gzip
import io
import os
import re
import urllib.request
from collections import defaultdict

import pandas as pd

REDFIN_URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com/"
    "redfin_market_tracker/zip_code_market_tracker.tsv000.gz"
)
OUT = "/Users/noahrubin/neighborhoodiq/data/raw/redfin_panel.csv"
MIN_YEAR = 2011

# desired output field -> Redfin column name (intensive metrics only)
METRICS = {
    "dom": "MEDIAN_DOM",
    "sale_to_list": "AVG_SALE_TO_LIST",
    "months_supply": "MONTHS_OF_SUPPLY",
    "sold_above_list": "SOLD_ABOVE_LIST",
    "price_drops": "PRICE_DROPS",
    "off_market_2wk": "OFF_MARKET_IN_TWO_WEEKS",
}
_FIVE = re.compile(r"(\d{5})")


def _zip5(v: str) -> str | None:
    m = _FIVE.search(v or "")
    return m.group(1) if m else None


def _num(v: str):
    v = (v or "").strip().strip('"').strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def build() -> pd.DataFrame:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    print(f"[redfin] streaming national zip market tracker (~1.5 GB) ...")
    req = urllib.request.Request(REDFIN_URL,
                                 headers={"User-Agent": "neighborhoodiq-pipeline/1.0"})
    # (zip, year) -> [sum_per_metric..., count_per_metric...]
    sums: dict[tuple[str, int], list[float]] = defaultdict(lambda: [0.0] * len(METRICS))
    cnts: dict[tuple[str, int], list[int]] = defaultdict(lambda: [0] * len(METRICS))
    mkeys = list(METRICS)
    n = kept = 0
    with urllib.request.urlopen(req, timeout=300) as resp:
        gz = gzip.GzipFile(fileobj=resp)
        text = io.TextIOWrapper(gz, encoding="utf-8", errors="replace", newline="")
        header = text.readline().rstrip("\n").split("\t")
        idx = {h.strip().strip('"').upper(): i for i, h in enumerate(header)}
        for col in ("PERIOD_END", "PROPERTY_TYPE", "REGION"):
            if col not in idx:
                raise RuntimeError(f"Redfin header missing {col}; got {list(idx)[:12]}...")
        mcols = {k: idx.get(v) for k, v in METRICS.items()}
        present = [k for k, v in mcols.items() if v is not None]
        print(f"[redfin] metric columns present: {present}")
        i_pt, i_pe, i_rg = idx["PROPERTY_TYPE"], idx["PERIOD_END"], idx["REGION"]
        maxcol = max(i_pt, i_pe, i_rg, *(v for v in mcols.values() if v is not None))
        for line in text:
            n += 1
            if n % 5_000_000 == 0:
                print(f"[redfin]   scanned {n:,} rows, kept {kept:,} ...")
            if "All Residential" not in line:        # cheap reject (~80% of rows)
                continue
            f = line.rstrip("\n").split("\t")
            if len(f) <= maxcol:
                continue
            if f[i_pt].strip().strip('"') != "All Residential":
                continue
            pe = f[i_pe].strip().strip('"')
            if len(pe) < 4 or not pe[:4].isdigit():
                continue
            year = int(pe[:4])
            if year < MIN_YEAR:
                continue
            z = _zip5(f[i_rg])
            if not z:
                continue
            key = (z, year)
            s, c = sums[key], cnts[key]
            for j, k in enumerate(mkeys):
                ci = mcols[k]
                if ci is None:
                    continue
                val = _num(f[ci])
                if val is not None:
                    s[j] += val
                    c[j] += 1
            kept += 1
    print(f"[redfin] scanned {n:,} rows; kept {kept:,} All-Residential rows; "
          f"{len(sums):,} zip-year groups")

    rows = []
    for (z, year), s in sums.items():
        c = cnts[(z, year)]
        rec = {"zip": z, "year": year}
        nobs = 0
        for j, k in enumerate(mkeys):
            rec[k] = (s[j] / c[j]) if c[j] else None
            nobs = max(nobs, c[j])
        rec["n_obs"] = nobs
        rows.append(rec)
    panel = pd.DataFrame(rows).sort_values(["zip", "year"]).reset_index(drop=True)
    panel.to_csv(OUT, index=False)
    print(f"[redfin] wrote {OUT}  ({len(panel):,} rows, "
          f"{panel['zip'].nunique():,} ZIPs, years {panel['year'].min()}-{panel['year'].max()})")
    return panel


if __name__ == "__main__":
    build()
