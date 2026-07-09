# MA gentrification dataset pipeline

Builds a one-row-per-ZIP master table for Massachusetts from public sources.

## Run

```bash
python -m pipeline.run                # all sources, then combine
python -m pipeline.run census zillow  # subset, then combine
python -m pipeline.run --skip-redfin  # skip the slow ~1.5 GB Redfin pull
python -m pipeline.combine            # re-combine existing interim files only
```

Outputs (in `./data/`, git-ignored):

| file | contents |
|------|----------|
| `ma_master.csv`  | **training** rows — one per ZIP, holdout ZIPs excluded |
| `ma_holdout.csv` | the held-out ZIPs (Somerville/Chelsea/Everett/Lynn/New Bedford) |
| `ma_all.csv`     | everything + a `holdout` flag (for transparency) |
| `raw/`, `interim/` | cached downloads and per-source normalized CSVs |

## Sources & key decisions

- **Census ACS 5-yr** — pulled via the **keyless Census Reporter API** (one
  `860|04000US25` containment query → all MA ZCTAs). The official Census API now
  requires an activated key and the key provided for this project was rejected
  ("Invalid Key"). Fields: median household income, median age, total
  population, median gross rent, median home value, bachelor's-degree count.
  Note: ACS is by **ZCTA**, a close proxy for USPS ZIPs.
- **Zillow ZHVI** — smoothed/seasonally-adjusted all-homes ZIP series; annual
  value per year 2010–2024 = mean of that year's months.
- **Boston permits** — `data.boston.gov` CKAN datastore aggregated to ZIP
  (permit count + summed declared valuation). Boston ZIPs only.
- **Redfin** — national zip-level tracker (~1.5 GB gzip) stream-filtered to MA
  "All Residential"; latest monthly snapshot per ZIP.
- **MA DOR / MassGIS property assessment** — *not collected*. It is parcel-level
  GIS data (multi-GB, per-municipality, not keyed by ZIP) needing spatial joins;
  add a `fetch_massgis.py` and register it in `combine.SOURCES` to include it.

## Holdout

The 13 ZIPs across Somerville/Chelsea/Everett/Lynn/New Bedford are **collected
and tagged**, then split into `ma_holdout.csv` so a model can be scored against
them later. They are excluded from `ma_master.csv` (training). This is a
**non-random** holdout (the canonical MA gentrification cases), so its accuracy
estimate is optimistic/biased relative to a random split — interpret with care.
