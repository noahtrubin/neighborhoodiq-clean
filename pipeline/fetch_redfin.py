"""Redfin zip-level market-tracker collector.

The published file is a ~1.5 GB national gzip (decompresses to ~15 GB), so we
stream-decompress it and keep only MA 'All Residential' rows, never storing the
full file. The filtered MA subset is cached to data/raw/redfin_ma.csv for reuse.
We then keep the most recent monthly period per ZIP."""
from __future__ import annotations

import gzip
import io
import urllib.request

import pandas as pd

from . import config as C

_CACHE = C.RAW_DIR / "redfin_ma.csv"
_NEED = ["PERIOD_END", "STATE_CODE", "REGION", "PROPERTY_TYPE",
         "MEDIAN_SALE_PRICE", "MEDIAN_LIST_PRICE", "HOMES_SOLD", "MEDIAN_DOM"]
_OUT_COLS = ["zip", "redfin_period_end", "redfin_median_sale_price",
             "redfin_median_list_price", "redfin_homes_sold", "redfin_median_dom"]


def _clean(v: str):
    v = v.strip().strip('"').strip()
    return v if v else None


def _to_num(v):
    v = _clean(v)
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _stream_filter_to_cache() -> None:
    """Stream the national gzip, write MA 'All Residential' rows to the cache."""
    print(f"[redfin] streaming + filtering national file (~1.5 GB) to MA ...")
    req = urllib.request.Request(C.REDFIN_URL, headers={"User-Agent": "neighborhoodiq-pipeline/1.0"})
    rows = []
    n = 0
    with urllib.request.urlopen(req, timeout=180) as resp:
        gz = gzip.GzipFile(fileobj=resp)
        text = io.TextIOWrapper(gz, encoding="utf-8", errors="replace", newline="")
        header = text.readline().rstrip("\n").split("\t")
        idx = {h.strip().strip('"').upper(): i for i, h in enumerate(header)}
        missing = [c for c in _NEED if c not in idx]
        if missing:
            raise RuntimeError(f"Redfin header missing columns: {missing}")
        for line in text:
            n += 1
            if n % 5_000_000 == 0:
                print(f"[redfin]   scanned {n:,} rows, kept {len(rows):,} MA rows ...")
            if "MA" not in line:  # cheap reject; STATE_CODE='MA' guarantees presence
                continue
            f = line.rstrip("\n").split("\t")
            if len(f) <= idx["PROPERTY_TYPE"]:
                continue
            if _clean(f[idx["STATE_CODE"]]) != "MA":
                continue
            if _clean(f[idx["PROPERTY_TYPE"]]) != "All Residential":
                continue
            z = C.zfill5(_clean(f[idx["REGION"]]))
            if not C.is_ma_zip(z):
                continue
            rows.append({
                "zip": z,
                "redfin_period_end": _clean(f[idx["PERIOD_END"]]),
                "redfin_median_sale_price": _to_num(f[idx["MEDIAN_SALE_PRICE"]]),
                "redfin_median_list_price": _to_num(f[idx["MEDIAN_LIST_PRICE"]]),
                "redfin_homes_sold": _to_num(f[idx["HOMES_SOLD"]]),
                "redfin_median_dom": _to_num(f[idx["MEDIAN_DOM"]]),
            })
    print(f"[redfin] scanned {n:,} rows total; kept {len(rows):,} MA monthly rows")
    pd.DataFrame(rows, columns=_OUT_COLS).to_csv(_CACHE, index=False)
    print(f"[redfin] cached MA subset -> {_CACHE}")


def fetch(refresh: bool = False) -> pd.DataFrame:
    C.ensure_dirs()
    if refresh or not _CACHE.exists() or _CACHE.stat().st_size == 0:
        _stream_filter_to_cache()
    else:
        print(f"[redfin] using cached MA subset {_CACHE.name}")

    df = pd.read_csv(_CACHE, dtype={"zip": str})
    df = df.dropna(subset=["zip", "redfin_period_end"])
    # keep the most recent monthly snapshot per ZIP
    df = df.sort_values("redfin_period_end").groupby("zip", as_index=False).last()
    print(f"[redfin] {len(df)} MA ZIPs (latest snapshot each)")
    return df.sort_values("zip").reset_index(drop=True)


def main() -> pd.DataFrame:
    df = fetch()
    out = C.INTERIM_DIR / "redfin.csv"
    df.to_csv(out, index=False)
    print(f"[redfin] wrote {out}")
    return df


if __name__ == "__main__":
    main()
