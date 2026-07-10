"""Rebuild web/app-data/zhvi_series.json from the SAME Zillow file the model uses,
with CONSISTENT month-anchoring, so the chart and every KPI agree with each other
and with the scores (all one dataset, one convention).

Why this exists: the previously-committed series anchored past years on a different
month than the current year (e.g. a late-2021 peak vs May-2026), which made the
"5-year change" read misleadingly low. This anchors EVERY year on the latest
available month (so year-over-year and 5-year changes are clean same-month spans).

  python model-refresh/build_series.py [zhvi.csv]

Output schema (unchanged, so the app reads it as-is):
  { years:[...], national:[...], metros:{m:[...]}, zips:{zip:{series,latest,asOf,yoy}} }
"""
from __future__ import annotations

import json
import os
import re
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CSV = os.path.join(HERE, "zhvi.csv")
OUT = os.path.join(HERE, "..", "web", "app-data", "zhvi_series.json")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _num(v):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return None
    return int(round(float(v)))


def main() -> None:
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    df = pd.read_csv(csv_path, dtype={"RegionName": str}, low_memory=False)
    df = df[df["RegionName"].notna()].copy()
    df["zip"] = df["RegionName"].str.zfill(5)

    date_cols = [c for c in df.columns if _DATE.match(c)]
    latest = max(date_cols)                       # e.g. "2026-05-31"
    anchor_mmdd = latest[5:]                       # "05-31" — same month every year
    years = sorted({int(c[:4]) for c in date_cols})
    # the anchor column per year (skip years missing that month)
    ycol = {y: f"{y}-{anchor_mmdd}" for y in years if f"{y}-{anchor_mmdd}" in df.columns}
    years = sorted(ycol)
    as_of = f"{latest[:4]}-{latest[5:7]}"          # "2026-05"
    prev_year_col = ycol.get(int(latest[:4]) - 1)  # same month, 1 year prior (for yoy)

    def annual_series(row):
        return [_num(row[ycol[y]]) for y in years]

    # national + metro reference lines = median across ZIPs at each anchor month
    national = [_num(df[ycol[y]].median()) for y in years]
    metros: dict[str, list] = {}
    for metro, g in df.groupby("Metro"):
        if isinstance(metro, str) and metro and metro != "nan":
            metros[metro] = [_num(g[ycol[y]].median()) for y in years]

    zips: dict[str, dict] = {}
    latest_vals = df[latest]
    prev_vals = df[prev_year_col] if prev_year_col else None
    for _, row in df.iterrows():
        z = row["zip"]
        lv = row[latest]
        if pd.isna(lv) or lv <= 0:
            # still emit the history if any exists, but no latest/yoy
            ser = annual_series(row)
            if any(v is not None for v in ser):
                zips[z] = {"series": ser, "latest": None, "asOf": None, "yoy": None}
            continue
        yoy = None
        if prev_vals is not None:
            pv = row[prev_year_col]
            if pd.notna(pv) and pv > 0:
                yoy = round(float(lv / pv - 1) * 100, 1)
        zips[z] = {"series": annual_series(row), "latest": _num(lv),
                   "asOf": as_of, "yoy": yoy}

    out = {"years": years, "national": national, "metros": metros, "zips": zips}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    size_mb = os.path.getsize(OUT) / 1e6
    print(f"wrote {OUT}  ({len(zips)} ZIPs, {len(metros)} metros, "
          f"years {years[0]}-{years[-1]} anchored on month -{anchor_mmdd}, {size_mb:.1f} MB)")
    # spot-check a couple ZIPs
    for z in ("11216", "10514", "48505"):
        if z in zips:
            s = zips[z]["series"]
            fv = (s[-1] / s[-6] - 1) * 100 if s[-1] and s[-6] else float("nan")
            print(f"  {z}: latest=${zips[z]['latest']:,} asOf={zips[z]['asOf']} "
                  f"yoy={zips[z]['yoy']}%  clean 5yr={fv:+.1f}%")


if __name__ == "__main__":
    main()
