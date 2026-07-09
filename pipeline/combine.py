"""Combine per-source interim tables into the master + holdout CSVs, and report
coverage / missingness."""
from __future__ import annotations

import pandas as pd

from . import config as C

# interim file -> (label, indicator column used to test "has this source")
SOURCES = {
    "census.csv": ("Census ACS 5-yr", "median_household_income"),
    "zillow.csv": ("Zillow ZHVI", "zhvi_2024"),
    "boston_permits.csv": ("Boston permits", "boston_permit_count"),
    "redfin.csv": ("Redfin", "redfin_median_sale_price"),
}
# Not collected this run (parcel-level GIS, multi-GB, not keyed by ZIP):
NOT_COLLECTED = ["MA DOR / MassGIS property assessment"]


def _load_interims() -> dict[str, pd.DataFrame]:
    frames = {}
    for fname in SOURCES:
        path = C.INTERIM_DIR / fname
        if path.exists() and path.stat().st_size > 0:
            frames[fname] = pd.read_csv(path, dtype={"zip": str})
            frames[fname]["zip"] = frames[fname]["zip"].apply(C.zfill5)
    return frames


def combine() -> pd.DataFrame:
    frames = _load_interims()
    if not frames:
        raise RuntimeError("No interim source files found — run the fetchers first.")

    zips = sorted(set().union(*[set(f["zip"].dropna()) for f in frames.values()]))
    master = pd.DataFrame({"zip": zips})
    for df in frames.values():
        master = master.merge(df, on="zip", how="left")

    master.insert(1, "holdout", master["zip"].isin(C.HOLDOUT_ZIPS))
    master = master.sort_values("zip").reset_index(drop=True)

    # Surface holdout ZIPs that fell out of the union (e.g. no Zillow coverage)
    # instead of silently shipping a holdout smaller than HOLDOUT_ZIPS.
    dropped = sorted(set(C.HOLDOUT_ZIPS) - set(master["zip"]))
    if dropped:
        print(f"[combine] WARNING: {len(dropped)} holdout ZIP(s) absent from the "
              f"data and excluded from ma_holdout.csv: {dropped}")
    return master


def summarize(master: pd.DataFrame) -> None:
    train = master[~master["holdout"]]
    hold = master[master["holdout"]]
    total = len(train)

    print("\n" + "=" * 66)
    print("  MA GENTRIFICATION DATASET — BUILD SUMMARY")
    print("=" * 66)
    print(f"  ZIP universe (union of sources): {len(master)}")
    print(f"  Training rows  (ma_master.csv):  {total}")
    print(f"  Holdout rows   (ma_holdout.csv): {len(hold)}  -> {sorted(hold['zip'])}")
    print("-" * 66)
    print(f"  {'Source':<22}{'ZIPs w/ data':>14}{'coverage':>12}{'missing':>12}")
    print("-" * 66)
    for fname, (label, indicator) in SOURCES.items():
        if indicator in train.columns:
            have = int(train[indicator].notna().sum())
            cov = have / total * 100 if total else 0
            print(f"  {label:<22}{have:>14}{cov:>11.1f}%{100 - cov:>11.1f}%")
        else:
            print(f"  {label:<22}{'(not run)':>14}{'-':>12}{'100.0%':>12}")
    print("-" * 66)
    for nc in NOT_COLLECTED:
        print(f"  NOT collected: {nc}")
    print(f"  Census note: {C.CENSUS_RELEASE_NOTE} (supplied API key was invalid)")
    print("=" * 66 + "\n")


def main() -> pd.DataFrame:
    C.ensure_dirs()
    master = combine()
    master.to_csv(C.ALL_CSV, index=False)
    master[~master["holdout"]].drop(columns=["holdout"]).to_csv(C.MASTER_CSV, index=False)
    master[master["holdout"]].drop(columns=["holdout"]).to_csv(C.HOLDOUT_CSV, index=False)
    print(f"[combine] wrote {C.MASTER_CSV}")
    print(f"[combine] wrote {C.HOLDOUT_CSV}")
    print(f"[combine] wrote {C.ALL_CSV}")
    summarize(master)
    return master


if __name__ == "__main__":
    main()
