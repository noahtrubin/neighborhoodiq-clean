"""Spatial spillover panel — the 'path of progress' / ripple-effect test.

Hypothesis (user): a still-cheap ZIP surrounded by ZIPs that already shot up is
next in line. We use NEIGHBORS' PAST appreciation (known as of year B) to predict
THIS ZIP's FUTURE (B->B+5) — honest, not the leakage that inflated the old model.

For each ZIP we take its k nearest ZIPs (by centroid; a clean proxy for adjacency)
and compute, as of each year B:
  neighbor_appr3 = neighbors' mean 3yr appreciation ending at B
  spillover_gap3 = neighbor_appr3 - this ZIP's own 3yr appreciation
                   (high = neighbors rose, I didn't yet = catch-up candidate)

Output: data/raw/neighbor_panel.csv  (zip, year, neighbor_appr3, spillover_gap3)
"""
from __future__ import annotations

import os
import sys
import warnings

import numpy as np
import pandas as pd
import pgeocode
from sklearn.neighbors import BallTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import load_df  # noqa: E402

OUT = "/Users/noahrubin/neighborhoodiq/data/raw/neighbor_panel.csv"
K = 8        # nearest ZIPs treated as "neighbors"
WIN = 3      # appreciation window (years)


def build() -> pd.DataFrame:
    df = load_df().reset_index(drop=True)
    years = df.attrs["years"]
    Z = df["zip"].to_numpy()

    # centroids
    nomi = pgeocode.Nominatim("us")
    g = nomi.query_postal_code(sorted(df["zip"].unique()))
    g["zip"] = g["postal_code"].astype(str).str.zfill(5)
    geo = df[["zip"]].merge(g[["zip", "latitude", "longitude"]], on="zip", how="left")
    lat, lon = geo["latitude"].to_numpy(), geo["longitude"].to_numpy()
    valid = np.isfinite(lat) & np.isfinite(lon)
    print(f"[nbr] {valid.sum():,}/{len(df):,} ZIPs have centroids")

    coords = np.radians(np.c_[lat[valid], lon[valid]])
    tree = BallTree(coords, metric="haversine")
    nn = tree.query(coords, k=K + 1, return_distance=False)[:, 1:]   # drop self
    zv = Z[valid]

    rows = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)  # all-NaN slices
        for B in years:
            if f"zhvi_{B}" not in df.columns or f"zhvi_{B-WIN}" not in df.columns:
                continue
            cur = df[f"zhvi_{B}"].to_numpy()[valid]
            prev = df[f"zhvi_{B-WIN}"].to_numpy()[valid]
            ok = np.isfinite(cur) & np.isfinite(prev) & (prev > 0)
            own = np.where(ok, cur / prev - 1, np.nan)
            nbr = np.nanmean(own[nn], axis=1)        # neighbors' mean past appreciation
            # price RELATIVE TO NEIGHBORS: own price / mean neighbor price (<1 = cheap
            # for its immediate area; a LOCAL value gap, stabler than spatial momentum)
            curp = np.where((cur > 0) & np.isfinite(cur), cur, np.nan)
            nbr_price = np.nanmean(curp[nn], axis=1)
            rows.append(pd.DataFrame({"zip": zv, "year": B,
                                      "neighbor_appr3": nbr,
                                      "spillover_gap3": nbr - own,
                                      "price_vs_nbr": curp / nbr_price}))
    panel = pd.concat(rows, ignore_index=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    panel.to_csv(OUT, index=False)
    print(f"[nbr] wrote {OUT}  ({len(panel):,} rows, {panel['zip'].nunique():,} ZIPs, "
          f"k={K}, window={WIN}yr)")
    return panel


if __name__ == "__main__":
    build()
