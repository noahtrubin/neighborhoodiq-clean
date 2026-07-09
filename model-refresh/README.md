# model-refresh — monthly national score refresh

A containerized batch job that keeps NeighborhoodIQ's gentrification scores
current. It runs monthly on **Cloud Run Jobs**, triggered by **Cloud Scheduler**:

1. **download.py** – pulls the latest Zillow ZHVI ZIP-level CSV (~122 MB, refreshed monthly).
2. **model.py** – runs the forward-looking model (train on the pinned 2019→2024
   episode, forecast the next 5 years for every metro ZIP) and computes the honest
   metrics written to `meta/national`.
3. **firestore_writer.py** – bulk-writes `scores/{zip}` docs + a `meta/national`
   doc (last-refresh metrics + timestamp) via Firestore BulkWriter.

## How good is the model, honestly?

`evaluate.py` is the validation the model used to lack. Run it against the full
Zillow history (Jan snapshots 2000→2026) and it reproduces, end to end:

| What | Honest number | The misleading number it replaces |
|------|---------------|-----------------------------------|
| Forecast skill | **out-of-time AUC ≈ 0.63** (band 0.58–0.72 across eras) | in-sample random-split AUC ~0.75 |
| "Accuracy" | **≈ the base rate** — model beats predict-nobody by ~2–3 pts | "78% accuracy" (which *is* the base rate) |
| Is the score a probability? | **No — it's a ranking.** A constant base-rate guess beats it on Brier; rank still gives ~1.4× top-decile lift | score = prob×100 shown as "% chance" |
| Train vs score inputs | **4/9 features severely drift** (PSI>0.25) | (never measured) |
| Target stability | base rate swings **0.1%→30%→2.5%** across eras → window is pinned | (assumed stationary) |

`meta/national.metrics` therefore reports `oot_auc`, `oot_auc_band`,
`metro_grouped_auc`, `oot_brier` vs `oot_brier_constant_baseline`, and the drift
count — with the old in-sample figure kept only as `in_sample_auc_optimistic`.
Each `scores/{zip}` doc carries `rank` (a percentile), which is the field the UI
should headline instead of `score`/`prob`.

**Three models, one deployed.** Only this national scale-free RF is live. The
"91.7%" sometimes quoted is a *different* Massachusetts-only model
(`train_appreciation_model.py`, Model A) measured on **n=12** ZIPs — 95% CI
[65%, 99%], statistically near-uninformative. Never cite it as general accuracy.

```bash
# the honest backtest (needs scikit-learn + the full-history CSV)
python evaluate.py /path/to/Zip_zhvi_full_history.csv
```

The **training** window is pinned (TRAIN_BASE=2019): the ≥60%/5yr target's base
rate is era-dependent (25% in the 2019→2024 boom vs ~3% in the 2021→2026 cooldown,
which is degenerate), so 2019→2024 is the most recent learnable episode. `model.py`
raises if the target goes degenerate. The **forecast** base (SCORE_BASE) now
defaults to the **latest available data year** so the forecast tracks the present
(e.g. 2026→2031) instead of lagging the data; set SCORE_BASE to pin it.

## Run locally
```bash
pip install -r requirements.txt
DRY_RUN=1 python main.py        # download + model, no Firestore write
```

## Deploy (needs gcloud + Blaze)
```bash
gcloud auth login
./deploy.sh                      # creates the job, IAM, and monthly schedule
```

## Env
| var | default | meaning |
|-----|---------|---------|
| `GOOGLE_CLOUD_PROJECT` | (auto on Cloud Run) | Firestore project |
| `TRAIN_BASE` | 2019 | pinned training base year |
| `SCORE_BASE` | latest data year | forecast base year (auto-advances) |
| `DRY_RUN` | — | compute + print, skip Firestore |

Data provided by Zillow Group (attribution required wherever figures are shown).
