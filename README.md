# NeighborhoodIQ

An honest home-value dashboard for every metro ZIP code in the United States.

For each of **20,892 ZIPs** it shows what homes cost, whether prices are rising or
cooling, how the place compares to its metro — and one forward-looking number: the
**calibrated probability that the ZIP's Zillow home value is higher two years from
now than it is today**.

"Calibrated" is the point. ZIPs the model rates ~80% actually rose ~80% of the time
in out-of-time backtests. The repo ships the backtest so you don't have to take that
on faith (`model-refresh/evaluate.py`, `model-refresh/sanity_check.py`).

---

## What's in this repo

| Path | What it is | Status |
|------|-----------|--------|
| [`web/`](web/) | The product — a Next.js 16 app on Firebase App Hosting | **live** |
| [`model-refresh/`](model-refresh/) | The production model + monthly Cloud Run refresh job, plus the research scripts behind it | **live** |
| [`web/app-data/`](web/app-data/) | Committed score + price-series bundles the app ships with | **live** |
| [`pipeline/`](pipeline/) | Massachusetts-only dataset builder (Census/Zillow/Redfin/Boston permits) | research |
| [`data/`](data/) | Early feature-engineering scripts + the superseded national model | research (gitignored outputs) |
| [`train_appreciation_model.py`](train_appreciation_model.py) | The original MA-only Random Forest ("Model A") | superseded |
| [`api/analyze.js`](api/analyze.js), [`.env.example`](.env.example) | Leftovers from the deleted Vite/Vercel front end | **dead** |

Three modeling efforts live here; **only one is deployed** — the national,
scale-free classifier in `model-refresh/model.py`. See
[Which model is real](#which-model-is-real) before quoting any accuracy number.

---

## The product (`web/`)

Next.js 16 (App Router, React 19, TypeScript, Turbopack), deployed on **Firebase
App Hosting** ([`web/apphosting.yaml`](web/apphosting.yaml), `output: "standalone"`).

### Routes

| Route | File | What it does |
|-------|------|--------------|
| `/` | [`app/page.tsx`](web/app/page.tsx) → [`GlobeLandingHero.tsx`](web/app/components/GlobeLandingHero.tsx) | Public landing page: a scroll-driven orthographic globe that flies from the whole Earth into a state and renders real ZCTA boundaries, colored by score. Carries its own nav, ZIP search, and metro chips. |
| `/how-it-works` | [`app/how-it-works/page.tsx`](web/app/how-it-works/page.tsx) | Plain-language explainer: the signals, the data, how to read a score, FAQ. |
| `/login` | [`app/login/page.tsx`](web/app/login/page.tsx) | Split brand panel + sign-in / create-account tabs. Google OAuth and email/password, with reset and "continue as guest". |
| `/dashboard` | [`app/dashboard/page.tsx`](web/app/dashboard/page.tsx) → [`NeighborhoodIQ.tsx`](web/app/NeighborhoodIQ.tsx) | The tool. Search a ZIP → score, risk tier, price history chart vs metro and national medians, metro peers, favorites, and an AI chat panel. Gated by [`AuthGate`](web/app/components/AuthGate.tsx) in `redirect` mode. |

### API routes

- **`GET /api/predict?zip=02127`** → [`route.ts`](web/app/api/predict/route.ts)
  Returns `{ data, metroPeers, series }` for one ZIP.
  **`GET /api/predict?zips=a,b,c`** (max 50) resolves a batch — used for favorites.
- **`POST /api/chat`** → [`route.ts`](web/app/api/chat/route.ts)
  Server-side proxy to Claude (`@anthropic-ai/sdk`). The system prompt injects
  *only* the data we actually hold for that ZIP and explicitly forbids inventing
  statistics. Requires `ANTHROPIC_API_KEY`; in-memory rate limit of 20 msg/min/IP.
  This replaced an older route that asked the model to *estimate* a score — we no
  longer fabricate scores for unknown ZIPs.

### Where the app's numbers come from

[`app/lib/scores.ts`](web/app/lib/scores.ts) is the single server-side accessor,
with a deliberate two-tier source:

1. **Firestore `scores/{zip}`** — refreshed monthly by the Cloud Run job. Used only
   once `meta/national` exists.
2. **Committed JSON bundle** — [`web/app-data/national_scores.json`](web/app-data/) —
   always ships with the app, so it works locally, before the first refresh run, and
   if Firestore is unreachable.

Firestore rows are merged with the bundle (`withBundle`) because the refresh job
omits `rank`, and because `appr5yr`/`momentum` must match the price chart exactly —
the chart is always drawn from `app-data/zhvi_series.json`, so those two display
fields are sourced from the bundle while the fresh `score`/`prob` still win. This is
what keeps the page, the chart, and the AI chat quoting the same numbers.

`next.config.ts` force-includes `app-data/**` in the traced output, since
`scores.ts` reads it with `fs` at runtime rather than importing it.

### Auth and per-user data

[`AuthProvider.tsx`](web/app/lib/AuthProvider.tsx) exposes `signIn` (Google),
`signInEmail`, `signUpEmail`, `resetPassword`, `logout`, and live-synced favorites.
Firebase web config ([`firebase-client.ts`](web/app/lib/firebase-client.ts)) is
public by design — security is enforced by [`firestore.rules`](firestore.rules), not
by secrecy.

### Map assets

- [`public/geo/land-110m.json`](web/public/geo/) — globe land mass
- [`public/geo/us-states-10m.json`](web/public/geo/) — state borders
- [`public/geo/zip-points.json`](web/public/geo/) — ZIP centroids (dots at low zoom)
- [`public/geo/zcta/{STATE}.json`](web/public/geo/zcta/) — 52 per-state TopoJSON files
  (~7.9 MB total) of real ZCTA polygons, **lazy-loaded** the first time a user flies
  into that state. Regeneration steps are in
  [`public/geo/zcta/README.md`](web/public/geo/zcta/README.md).

> ⚠️ These must live under `web/public/geo/`. The root `.gitignore` ignores any
> folder named `data/`, which silently drops geo/score JSON placed there.

---

## The model (`model-refresh/`)

### What the score is

A **directional** forecast: *will this ZIP's ZHVI be higher in 2 years than today?*
Trained on the most recent fully-observed 2-year episode, applied to features at the
latest data year. A `HistGradientBoostingClassifier`, **isotonic-calibrated**, so
`prob` means what it says.

Features (`MODEL_FEATURES`) are deliberately **scale-free**, so a model trained on one
era transfers to another:

- `pctile_metro` — price rank within its metro
- `rel_state` — price relative to its state (log-transformed)
- `g_1yr`, `g_2yr`, `g_4yr` — price growth over 1/2/4 years
- `accel` — is growth speeding up or cooling

It uses **only Zillow price history**. No crime, schools, demographics, or permits —
those were tested and did not earn their place (see [Research](#research-that-didnt-ship)).

### Why *direction* rather than a ranking

Direction is more forecastable than "will it be a top performer" (OOT AUC ~0.66 vs
~0.57). The relative-outperformance framing scored marginally better on one metric
but did so by betting on cheap, distressed ZIPs mean-reverting — recreating the old
"Flint is #1" inversion (corr(score, cheapness) = −0.85). Direction doesn't: corr ≈
+0.38, so expensive stable areas correctly read as the safer bets.

### Honest numbers

The metrics shipped in `web/app-data/national_scores.meta.json` and written to
`meta/national`:

| Metric | Value |
|--------|-------|
| Out-of-time AUC | **0.674** (sampling CI 0.666–0.681) |
| OOT AUC across 14 episodes | band **0.491 – 0.840** |
| Metro-grouped AUC | 0.804 |
| Brier vs constant baseline | 0.1723 vs **0.1642** (baseline wins) |
| Base rate (positives) | 79.3% |
| In-sample AUC | 0.816 — *kept only as `in_sample_auc_optimistic`* |
| Feature drift | 4 of 9 features severely drift (PSI > 0.25) |

Read honestly, that means:

- **The base rate is high.** Most neighborhoods appreciate in nominal dollars, so most
  ZIPs read "likely to rise." The value is in the *spread* and in flagging the
  ~10–15% at genuine risk of stalling.
- **It's not a crystal ball.** At the 2022 rate-shock turning point, OOT AUC fell to
  ~0.53. The honest framing is "based on where things stand now."
- **It's a good ranker, not a better probability than guessing the base rate.** It
  loses to a constant baseline on Brier while giving real top-decile lift.
- **Accuracy claims are the trap.** In-sample "accuracy" roughly equals the base
  rate — i.e. what you'd get by predicting "everything rises."

### Which model is real

Only the national scale-free classifier above is deployed. Two others exist in this
repo and **must not be cited as general accuracy**:

- **`train_appreciation_model.py`** — a Massachusetts-only Random Forest ("Model A")
  predicting ≥60% appreciation 2019→2024. The "91.7%" sometimes quoted comes from
  this, measured on **n = 12 ZIPs**, 95% CI [65%, 99%] — statistically near
  uninformative. Its holdout (Somerville/Chelsea/Everett/Lynn/New Bedford) is also
  *non-random*, so it's optimistic by construction.
- **`data/national_model.py`** — the first national attempt. Its header says it
  plainly: superseded, its 80/20 random split is in-sample and spatially leaky, and
  its "AUC ~0.75 / 78% accuracy" is misleading.

### Training-window policy

`TRAIN_BASE` was pinned at 2019 because the ≥60%/5yr target's base rate is
era-dependent (25% in the 2019→2024 boom vs ~3% in the 2021→2026 cooldown, which is
degenerate). The current directional target auto-rolls to the most recent complete
2-year episode, and `SCORE_BASE` defaults to the latest data year, so the forecast
window tracks the present. `model.py` raises if the target goes degenerate.

### Research that didn't ship

`model-refresh/` also holds the A/B harness used to test whether *fundamentals* could
beat the price-only model. Each `panel_*.py` builds a candidate national panel and
each `run_*_ab.py` scores it against the deployed baseline on out-of-time AUC:

| Panel | Hypothesis tested |
|-------|-------------------|
| `panel_redfin.py` | Demand pressure (sell speed, above-list, low supply) |
| `panel_census.py` | Income/education growth — the structural gentrification signal |
| `panel_county.py`, `panel_quickwins.py` | IRS migration, net migration, county jobs growth |
| `panel_zbp.py`, `panel_amenities.py` | Business/amenity growth (cafés, food & drink, arts) |
| `panel_neighbors.py` | Spatial spillover — "path of progress" from neighbors' past gains |

`feature_lab.py` is the validator gate: a feature ships only if it lifts out-of-time
AUC over the price-only baseline. `run_combined_ab.py` is the definitive combined
test. None of these made it into `MODEL_FEATURES` — the production model remains
price-only.

---

## Data flow, end to end

```
Zillow ZHVI CSV (~122 MB, monthly)
  https://files.zillowstatic.com/research/public_csvs/zhvi/...
            │
            ├── download.py  ──► model.py ──► firestore_writer.py ──► Firestore scores/{zip} + meta/national
            │        (monthly Cloud Run Job, main.py)                        │
            │                                                                │
            ├── export_national_json.py ──► web/app-data/national_scores.json│
            └── build_series.py         ──► web/app-data/zhvi_series.json    │
                                                    │                        │
                                                    └──► web/app/lib/scores.ts ◄┘
                                                              │
                                            /api/predict, /api/chat, page render
```

`deploy_scores.py` is the reconciliation path: it publishes the *committed* bundle
straight to Firestore with no recompute, guaranteeing the live app and the repo agree.

---

## Running it locally

### The web app

```bash
cd web
npm install
npm run dev            # http://localhost:3000
```

Works with no credentials: `scores.ts` falls back to the committed bundle when
Firestore is unreachable. The `/api/chat` panel needs `ANTHROPIC_API_KEY` in the
environment; everything else works without it.

```bash
npm run build          # standalone production build
npm run lint
```

### The model

```bash
cd model-refresh
pip install -r requirements.txt

DRY_RUN=1 python main.py                  # download + score, no Firestore write
python evaluate.py /path/to/Zip_zhvi_full_history.csv   # the honest backtest
python sanity_check.py                    # "is it actually real?" self-check
python diagnostics.py                     # per-test plain-English verdict
```

### Regenerating the bundles the app ships

Order matters — the series must exist first so `appr5yr`/`momentum` can be aligned
to the chart:

```bash
python model-refresh/build_series.py        [zhvi.csv]   # → web/app-data/zhvi_series.json
python model-refresh/export_national_json.py [zhvi.csv]  # → web/app-data/national_scores.json (+ .meta.json)
python model-refresh/deploy_scores.py                    # optional: push that exact bundle to Firestore
```

`zhvi.csv` defaults to `model-refresh/zhvi.csv`, which is gitignored (too large for
GitHub) and regenerable via `download.py`.

### The MA research pipeline

```bash
python -m pipeline.run                # all sources, then combine
python -m pipeline.run census zillow  # subset
python -m pipeline.run --skip-redfin  # skip the ~1.5 GB Redfin pull
```

Outputs land in the gitignored `data/`: `ma_master.csv` (training), `ma_holdout.csv`,
`ma_all.csv`. Details and source caveats are in [`pipeline/README.md`](pipeline/README.md).

---

## Deployment

### Web — Firebase App Hosting

Project `neighborhoodiq-cb9eb`. Config in [`web/apphosting.yaml`](web/apphosting.yaml):
scale-to-zero (`minInstances: 0`, max 2, 1 CPU, 512 MiB). `ANTHROPIC_API_KEY` is
wired from **Secret Manager** at runtime.

> The key must be under `env:` — App Hosting silently ignores `environmentVariables`.

### Model refresh — Cloud Run Job + Cloud Scheduler

```bash
cd model-refresh
gcloud auth login
./deploy.sh
```

Creates the job `neighborhoodiq-monthly-job` (us-central1, 4 GiB / 2 CPU, 30 min
timeout), a runtime SA with `datastore.user`, a scheduler-invoker SA, and the trigger
`0 6 1 * *` America/New_York — 06:00 on the 1st of each month. The script deliberately
does **not** auto-run the job, since a real run overwrites production scores:

```bash
gcloud run jobs execute neighborhoodiq-monthly-job --region=us-central1 --project=neighborhoodiq-cb9eb
```

### Firestore

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

| Collection | Access |
|-----------|--------|
| `scores/{zip}` | Closed to clients; server reads via Admin SDK (which bypasses rules) |
| `meta/national` | Same — holds last-refresh metrics + timestamp |
| `zips/{zip}` | Public read, no client writes |
| `users/{uid}/**` | Owner-only read/write (favorites, saved chats) |

One composite index: `scores` on `metro ASC, score DESC` (metro peers query).

### One-time manual step

Email/password sign-in must be enabled in the Firebase console
(**Authentication → Sign-in method**). Google is already on. Until then, email
sign-up returns `auth/operation-not-allowed`, which the form surfaces as a clear
message.

---

## Environment variables

| Var | Where | Purpose |
|-----|-------|---------|
| `ANTHROPIC_API_KEY` | App Hosting secret / local shell | `/api/chat` only. **Server-side only — never shipped to the browser.** |
| `GOOGLE_CLOUD_PROJECT` | auto on Cloud Run | Firestore project for the refresh job |
| `TRAIN_BASE` | job env | Pinned training base year (default: `score_base − 2`) |
| `SCORE_BASE` | job env | Forecast base year (default: latest data year) |
| `DRY_RUN` | local | Compute and print, skip the Firestore write |

The `/api/chat` model is set in one line of
[`app/api/chat/route.ts`](web/app/api/chat/route.ts) — swap it for a cheaper Haiku
model if per-message cost matters.

---

## Known cruft

- **`api/analyze.js` and `.env.example`** are orphans from the Vite/Vercel front end
  deleted in `d036b13`. Nothing imports or deploys them.
- **A stale root `package-lock.json`** used to make Next infer the parent directory
  as the workspace root; `next.config.ts` pins `turbopack.root` and
  `outputFileTracingRoot` to `web/` to prevent that regressing.
- **`next/link` inside the globe client components** trips a Turbopack RSC-manifest
  bug in Next 16.2.9, so those use plain `<a>` deliberately.
- `web/AGENTS.md` warns that this Next version has breaking changes vs. what's in
  most training data — check `node_modules/next/dist/docs/` before writing app code.

---

## Attribution

Home-value data provided by **Zillow Group** (ZHVI). Attribution is required wherever
derived figures are shown — <https://www.zillow.com/research/data/>.
ZIP boundary polygons from the Census cartographic boundary file
`cb_2020_us_zcta520_500k`. Census demographics via the ACS 5-year API.

Built by [Noah Rubin](https://www.linkedin.com/in/noah-rubin-/).
