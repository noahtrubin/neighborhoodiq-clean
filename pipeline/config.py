"""Shared configuration, paths, and helpers for the MA dataset pipeline."""
from __future__ import annotations

import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"          # cached source downloads
INTERIM_DIR = DATA_DIR / "interim"  # one normalized CSV per source

MASTER_CSV = DATA_DIR / "ma_master.csv"    # training rows (holdout excluded)
HOLDOUT_CSV = DATA_DIR / "ma_holdout.csv"  # the held-out rows, for later eval
ALL_CSV = DATA_DIR / "ma_all.csv"          # everything + holdout flag (transparency)


def ensure_dirs() -> None:
    for d in (DATA_DIR, RAW_DIR, INTERIM_DIR):
        d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Holdout set — pulled and tagged, then split out of the training master so the
# model can still be SCORED against these ZIPs later. These are the canonical MA
# gentrification cases (Somerville / Chelsea / Everett / Lynn / New Bedford);
# note this is a non-random holdout, so treat its accuracy estimate with care.
# ---------------------------------------------------------------------------
HOLDOUT_ZIPS = {
    "02143", "02144", "02145",          # Somerville
    "02150",                            # Chelsea
    "02149",                            # Everett
    "01901", "01902", "01904", "01905",  # Lynn
    "02740", "02741", "02744", "02745",  # New Bedford
}

# ---------------------------------------------------------------------------
# Census (via Census Reporter API — keyless wrapper over Census ACS 5-year)
# ---------------------------------------------------------------------------
CENSUS_RELEASE_NOTE = "ACS 5-year via Census Reporter (data/show/latest)"
CENSUS_BASE = "https://api.censusreporter.org/1.0/data/show/latest"
CENSUS_MA_CONTAINMENT = "860|04000US25"  # all ZCTAs (860) within MA (state 25)
# table_id -> (column_id, output field name)
CENSUS_FIELDS = {
    "B19013": ("B19013001", "median_household_income"),
    "B01002": ("B01002001", "median_age"),
    "B01003": ("B01003001", "total_population"),
    "B25064": ("B25064001", "median_gross_rent"),
    "B25077": ("B25077001", "median_home_value"),
    "B15003": ("B15003022", "bachelors_degree_count"),
}

# ---------------------------------------------------------------------------
# Zillow ZHVI (smoothed, seasonally-adjusted, all homes, ZIP level)
# ---------------------------------------------------------------------------
ZILLOW_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zhvi/"
    "Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
)
ZILLOW_YEARS = list(range(2010, 2025))  # 2010..2024 inclusive

# ---------------------------------------------------------------------------
# Boston building permits (data.boston.gov CKAN datastore)
# ---------------------------------------------------------------------------
BOSTON_RESOURCE_ID = "6ddcd912-32a0-43df-9908-63574f8c7e77"
BOSTON_SQL_URL = "https://data.boston.gov/api/3/action/datastore_search_sql"

# ---------------------------------------------------------------------------
# Redfin zip-level market tracker (~1.5 GB national gzip; stream-filtered to MA)
# ---------------------------------------------------------------------------
REDFIN_URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com/"
    "redfin_market_tracker/zip_code_market_tracker.tsv000.gz"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_FIVE_DIGIT = re.compile(r"(\d{5})")


def zfill5(value) -> str | None:
    """Normalize a ZIP-ish value to a 5-digit string, else None.

    Handles ints, floats ('2139.0'), and strings ('Zip Code: 02139')."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # floats like '2139.0'
    if re.fullmatch(r"\d+\.0+", s):
        s = s.split(".")[0]
    if s.isdigit():
        return s.zfill(5)[-5:] if len(s) <= 5 else (s if len(s) == 5 else None)
    m = _FIVE_DIGIT.search(s)
    return m.group(1) if m else None


def is_ma_zip(z: str | None) -> bool:
    """True if z looks like a Massachusetts ZIP (01001-02791)."""
    if not z or len(z) != 5 or not z.isdigit():
        return False
    return "01001" <= z <= "02791"
