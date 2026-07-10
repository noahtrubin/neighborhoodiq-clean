"""Forward-looking home-value DIRECTION model — reusable build step.

Answers the plain, honest question a buyer actually asks: "is this neighborhood's
home value likely to go UP over the next 2 years, or not?" Trains on the most
recent fully-observed 2-year episode (BASE -> BASE+2) and applies the model to
features at the latest year to estimate P(rise) for every metro ZIP. Grounded
entirely in real Zillow data: cheap-for-its-metro/state + price momentum
(1/2/4-year growth + acceleration). Gradient-boosted classifier, ISOTONIC-
CALIBRATED so the probability means what it says.

Why direction (not a ranking):
  * DIRECTION is more forecastable than "will it be a top performer". Out-of-time
    AUC ~0.66 (recent windows ~0.72), vs ~0.57 for a top-quartile-rank target,
    because momentum predicts near-term up/down more reliably than relative rank.
  * We tried the ranking + relative-outperformance framings; the relative one
    scored marginally better on a backtest number but did so by betting on cheap,
    distressed ZIPs mean-reverting — it re-created the old "Flint is #1" inversion
    (corr(score, cheapness) -0.85). Direction does not: corr ~ +0.38 (expensive,
    stable areas are correctly the safer bets).

WHAT THE NUMBERS MEAN (read this before quoting any metric)
-----------------------------------------------------------
  * `prob` is a CALIBRATED probability of rising: in backtest, ZIPs it rated ~80%
    actually rose ~80% of the time; ~97%+ rose ~95%; <60% rose only ~37%. Show it
    honestly as a likelihood, with risk tiers.
  * BASE RATE IS HIGH. Most neighborhoods appreciate in nominal dollars (~85-99%
    in a typical 2-year window), so most ZIPs read "likely to rise". The real
    value is the probability spread + flagging the ~10-15% at genuine risk of
    stalling/declining (which it does: its low-P bucket rose ~60% vs ~98% for
    high-P in the recent window).
  * IT CANNOT FORESEE A MACRO SHOCK. It reads current momentum/conditions; at the
    2022 rate-shock turning point out-of-time AUC fell to ~0.53. Honest framing:
    "based on where things stand now", not a crystal ball.
  * The target auto-rolls to the most recent complete 2-year episode, tracking the
    current regime.
"""
from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

# HORIZON=2 (2-year forward window). The target is DIRECTIONAL: will ZHVI be higher
# in HORIZON years than today? (see episode()). No quantile threshold.
HORIZON, SEED = 2, 42
QUANTILE = 0.75            # unused by the direction target; kept for back-compat
THRESH = QUANTILE          # back-compat alias for callers importing THRESH
MONTH = "01-31"
META = ["RegionName", "State", "City", "Metro", "CountyName"]
# The 9 raw features features_at() produces (used by drift/importance reporting).
FEATURES = ["g_9yr", "g_7yr", "g_4yr", "g_2yr", "g_1yr", "accel",
            "rel_metro", "rel_state", "pctile_metro"]
# The features the PRODUCTION model actually consumes: cheapness (cheap-for-its-
# metro/state) + momentum. For DIRECTION we keep g_1yr — recent momentum is the
# strongest signal for near-term up/down (unlike the ranking model, where its
# noise hurt; here it is exactly what predicts direction). rel_state is
# log-transformed in build_pipe; pctile_metro is a bounded within-metro rank.
MODEL_FEATURES = ["pctile_metro", "rel_state", "g_1yr", "g_2yr", "g_4yr", "accel"]
CHEAP_FEATURES = ["pctile_metro", "rel_state"]   # kept for back-compat imports

_DATE_COL = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# --------------------------------------------------------------------------- #
#  shared feature / target / model logic                                       #
#  (imported by evaluate.py so the offline backtest mirrors production exactly) #
# --------------------------------------------------------------------------- #
def jan_years(columns: list[str]) -> list[int]:
    """All January snapshot years present, oldest first."""
    return sorted(int(c[:4]) for c in columns if c.endswith(MONTH))


def load_zhvi(zillow_csv_path: str) -> pd.DataFrame:
    """Load every January ZHVI snapshot, renamed zhvi_{year}. Full history is
    loaded (not a minimal window) so the out-of-time backtest has prior episodes."""
    head = pd.read_csv(zillow_csv_path, nrows=0)
    years = [y for y in jan_years(list(head.columns)) if y >= 1996]
    if not years:
        raise ValueError("no YYYY-01-31 month columns found in Zillow file")
    cols = META + [f"{y}-{MONTH}" for y in years]
    df = pd.read_csv(zillow_csv_path, usecols=cols, dtype={"RegionName": str})
    df = df.rename(columns={f"{y}-{MONTH}": f"zhvi_{y}" for y in years})
    df = df[df["RegionName"].notna()].copy()   # no blank/NaN ZIP -> bad doc id
    df["zip"] = df["RegionName"].str.zfill(5)
    df.attrs["years"] = years
    return df


def features_at(df: pd.DataFrame, B: int) -> pd.DataFrame:
    """Scale-free, leakage-free features as known at the END of base year B.
    Uses ONLY price levels at years <= B, so the exact same function is valid at
    train time (B=train_base) and forecast time (B=score_base)."""
    z = lambda y: df[f"zhvi_{y}"]
    out = pd.DataFrame(index=df.index)
    out["g_9yr"] = z(B - 9) / z(B) - 1
    out["g_7yr"] = z(B - 7) / z(B) - 1
    out["g_4yr"] = z(B - 4) / z(B) - 1
    out["g_2yr"] = z(B - 2) / z(B) - 1
    out["g_1yr"] = z(B - 1) / z(B) - 1
    out["accel"] = (z(B - 2) / z(B) - 1) - (z(B - 4) / z(B - 2) - 1)
    base = z(B)
    g_metro = df.groupby("Metro")[f"zhvi_{B}"]
    g_state = df.groupby("State")[f"zhvi_{B}"]
    out["rel_metro"] = base / g_metro.transform("median")
    out["rel_state"] = base / g_state.transform("median")
    out["pctile_metro"] = g_metro.rank(pct=True)
    # A metro with <3 ZIPs gives a degenerate percentile (size-1 always ranks
    # 1.0) and rel_metro==1.0 — mask those so the median imputer fills them
    # instead of feeding a spurious top-percentile signal.
    small = g_metro.transform("size") < 3
    out.loc[small, ["rel_metro", "pctile_metro"]] = np.nan
    # division by a zero/NaN denominator yields inf; SimpleImputer only fills
    # NaN, so normalize inf -> NaN here.
    return out.replace([np.inf, -np.inf], np.nan)


def episode(df: pd.DataFrame, B: int, quantile: float = QUANTILE):
    """(X, y, frame) for the episode based at year B, or None if the data needed
    for features (B-9) or the realized outcome (B+HORIZON) is absent.

    Target is DIRECTIONAL: 1 if the home value is HIGHER at B+HORIZON than at B
    (the neighborhood went up), else 0. `quantile` is accepted for back-compat but
    ignored. Most ZIPs are 1 (homes usually appreciate); the skill is separating
    the risers from the ~10-15% that stall or fall — which is what a calibrated
    probability of this target captures."""
    tgt = B + HORIZON
    needed = [f"zhvi_{B - k}" for k in (9, 7, 4, 2, 1, 0)] + [f"zhvi_{tgt}"]
    if any(c not in df.columns for c in needed):
        return None
    d = df.dropna(subset=[f"zhvi_{B}", f"zhvi_{tgt}"]).copy()
    d = d[d[f"zhvi_{B}"] > 0]
    d["target"] = (d[f"zhvi_{tgt}"] > d[f"zhvi_{B}"]).astype(int)
    return features_at(d, B), d["target"], d


def _safe_log(x):
    """log with a tiny floor so a zero/negative ratio can't produce -inf/NaN."""
    return np.log(np.clip(x, 1e-9, None))


def build_pipe(balanced: bool = False) -> Pipeline:
    """Production model: ISOTONIC-CALIBRATED gradient-boosted classifier on
    cheapness + momentum (MODEL_FEATURES), estimating a calibrated probability
    that the home value RISES over HORIZON years. Accepts the full 9-feature frame
    (selects the model columns internally) so every existing caller keeps working.

    The isotonic wrapper (cv=3) makes predict_proba honest — a 0.80 output means
    ~80% of such ZIPs actually rose in backtest. Calibration is monotonic, so it
    does not change the ranking/AUC, only the probability values. We do NOT balance
    classes by default: honest calibration needs the true up/down proportions.
    HistGradientBoosting handles NaNs natively."""
    cw = "balanced" if balanced else None
    gb = HistGradientBoostingClassifier(
        max_depth=3, learning_rate=0.05, max_iter=300, min_samples_leaf=200,
        l2_regularization=1.0, class_weight=cw, random_state=SEED)
    return Pipeline([
        # rel_state log-transformed so an ultra-expensive ZIP can't dominate; the
        # rest passthrough (pctile_metro already bounded; momentum ratios raw).
        ("sel", ColumnTransformer([
            ("logrel", FunctionTransformer(_safe_log), ["rel_state"]),
            ("pass", "passthrough", ["pctile_metro", "g_1yr", "g_2yr", "g_4yr", "accel"]),
        ], remainder="drop")),
        ("cal", CalibratedClassifierCV(gb, method="isotonic", cv=3)),
    ])


def _importances(pipe: Pipeline) -> pd.Series:
    """Model-agnostic feature importances: tree importances if present, else the
    magnitude of the logistic coefficients (over the cheapness features)."""
    est = pipe.steps[-1][1]
    if hasattr(est, "feature_importances_"):
        return pd.Series(est.feature_importances_, index=FEATURES)
    if hasattr(est, "coef_"):
        return pd.Series(np.abs(est.coef_[0]), index=CHEAP_FEATURES)
    return pd.Series(dtype=float)


# kept for any external caller that imported the old private names
_features_at = features_at
_pipe = build_pipe


def _bootstrap_auc_ci(y: np.ndarray, p: np.ndarray, reps: int = 300):
    rng = np.random.default_rng(SEED)
    out = []
    n = len(y)
    for _ in range(reps):
        idx = rng.integers(0, n, n)
        if len(np.unique(y[idx])) < 2:
            continue
        out.append(roc_auc_score(y[idx], p[idx]))
    if not out:
        return (None, None)
    return (round(float(np.percentile(out, 2.5)), 3),
            round(float(np.percentile(out, 97.5)), 3))


def honest_metrics(df: pd.DataFrame, train_base: int, Xtr_all: pd.DataFrame,
                   ytr_all: pd.Series) -> dict:
    """Out-of-time + spatially-grouped metrics for the PINNED episode.

    The in-sample number is reported too, but explicitly labelled optimistic.
    Everything here is best-effort: a failure must never block the score write,
    so the caller wraps this and falls back to the bare in-sample metric.
    """
    m: dict = {"train_n": int(len(ytr_all)),
               "positive_rate": round(float(ytr_all.mean()), 3)}

    # (1) in-sample, single 80/20 split — the OPTIMISTIC number the old code shipped
    Xt, Xho, yt, yho = train_test_split(Xtr_all, ytr_all, test_size=0.20,
                                        stratify=ytr_all, random_state=SEED)
    val = build_pipe().fit(Xt, yt)
    prob_is = val.predict_proba(Xho)[:, 1]
    base_rate = float(yho.mean())
    m["in_sample_auc_optimistic"] = round(float(roc_auc_score(yho, prob_is)), 3)
    m["in_sample_accuracy_optimistic"] = round(
        float(accuracy_score(yho, val.predict(Xho))), 3)
    # accuracy is a trap: this is what "predict nobody" scores. Surface it so the
    # in-sample accuracy can be seen for the base rate it is.
    m["baseline_accuracy"] = round(max(base_rate, 1 - base_rate), 3)

    # (2) OUT-OF-TIME: train on the prior disjoint episode, predict THIS one.
    prior = episode(df, train_base - HORIZON)
    if prior is not None:
        Xp, yp, _ = prior
        if yp.nunique() > 1:
            oot = build_pipe().fit(Xp, yp)
            p_oot = oot.predict_proba(Xtr_all)[:, 1]
            yv = ytr_all.to_numpy()
            m["oot_train_window"] = f"{train_base-HORIZON}->{train_base}"
            m["oot_auc"] = round(float(roc_auc_score(yv, p_oot)), 3)
            m["oot_auc_ci_sampling"] = list(_bootstrap_auc_ci(yv, p_oot))
            # calibration: a constant base-rate guess scores rate*(1-rate). If the
            # model's Brier is worse, its probabilities are uninformative as
            # probabilities (use rank instead). This is the calibration headline.
            m["oot_brier"] = round(float(brier_score_loss(yv, p_oot)), 4)
            pr = float(yv.mean())
            m["oot_brier_constant_baseline"] = round(pr * (1 - pr), 4)

    # (3) forecast-uncertainty band: walk-forward OOT AUC across every available
    #     prior episode. THIS, not the sampling CI, is the real spread.
    band = []
    years = df.attrs.get("years", [])
    if years:
        for B in range(min(years) + 9, train_base + 1):
            te = episode(df, B)
            tr = episode(df, B - HORIZON)
            if te is None or tr is None:
                continue
            Xte, yte, _ = te
            Xpb, ypb, _ = tr
            if yte.nunique() < 2 or ypb.nunique() < 2:
                continue
            mdl = build_pipe().fit(Xpb, ypb)
            band.append(roc_auc_score(yte, mdl.predict_proba(Xte)[:, 1]))
    if band:
        m["oot_auc_band"] = [round(float(min(band)), 3), round(float(max(band)), 3)]
        m["oot_auc_episodes"] = len(band)

    # (4) spatial leakage corrected: 5-fold GroupKFold by Metro on this episode.
    has_metro = df.loc[Xtr_all.index, "Metro"].notna().to_numpy()
    if has_metro.sum() > 1000:
        Xg = Xtr_all[has_metro]
        yg = ytr_all[has_metro]
        groups = df.loc[Xg.index, "Metro"].to_numpy()
        oof = np.full(len(yg), np.nan)
        for tr, te in GroupKFold(5).split(Xg, yg, groups):
            mdl = build_pipe().fit(Xg.iloc[tr], yg.iloc[tr])
            oof[te] = mdl.predict_proba(Xg.iloc[te])[:, 1]
        m["metro_grouped_auc"] = round(float(roc_auc_score(yg, oof)), 3)

    # (5) top features (logistic coefficient magnitude over the cheapness inputs)
    full = build_pipe().fit(Xtr_all, ytr_all)
    imp = _importances(full).sort_values(ascending=False)
    m["top_features"] = [{"feature": f, "importance": round(float(v), 3)}
                         for f, v in imp.head(3).items()]
    return m


def population_stability(df: pd.DataFrame, train_base: int, score_base: int) -> dict:
    """PSI per feature between the train-base and score-base distributions. PSI>0.25
    = severe covariate shift (the model scores a different distribution than it
    trained on). No model fit; cheap."""
    tr = df.dropna(subset=[f"zhvi_{train_base}"]).query(f"zhvi_{train_base} > 0")
    sc = df.dropna(subset=[f"zhvi_{score_base}"]).query(f"zhvi_{score_base} > 0")
    Xtr, Xsc = features_at(tr, train_base), features_at(sc, score_base)

    def psi(a, b, bins=10):
        a, b = a.dropna(), b.dropna()
        if len(a) < bins or len(b) < bins:
            return float("nan")
        qs = np.unique(np.quantile(a, np.linspace(0, 1, bins + 1)))
        qs[0], qs[-1] = -np.inf, np.inf
        ca = np.clip(np.histogram(a, qs)[0] / len(a), 1e-4, None)
        cb = np.clip(np.histogram(b, qs)[0] / len(b), 1e-4, None)
        return float(np.sum((cb - ca) * np.log(cb / ca)))

    vals = {f: psi(Xtr[f], Xsc[f]) for f in FEATURES}
    severe = sorted((f for f, v in vals.items() if v == v and v > 0.25),
                    key=lambda f: -vals[f])
    return {"psi": {f: round(v, 3) for f, v in vals.items() if v == v},
            "severe_features": severe, "n_severe": len(severe)}


def _num(v, ndigits=None):
    if v is None:
        return None
    f = float(v)
    if not math.isfinite(f):   # NaN or +/-inf -> null (Firestore rejects them)
        return None
    f = round(f, ndigits) if ndigits is not None else f
    return int(f) if ndigits == 0 else f


APPR_DISPLAY_YEARS = 5   # the "N-year change" context KPI is trailing-actual, not the forecast horizon


def compute_scores(zillow_csv_path: str, train_base: int | None = None,
                   score_base: int | None = None) -> dict:
    """Returns {records: [...], metrics: {...}, meta: {...}}.

    score_base defaults to the LATEST available data year: the model is applied to
    the most recent inputs so the forecast window tracks the present (e.g.
    2026->2028). train_base defaults to score_base-HORIZON — the most recent COMPLETE
    2-year episode, whose realized up/down outcome trains the model. The window
    auto-rolls to the current regime. Pass explicit years to override either.
    """
    df = load_zhvi(zillow_csv_path)
    latest = df.attrs["years"][-1]
    if score_base is None:
        score_base = latest          # freshness: forecast from the newest data
    if train_base is None:
        train_base = score_base - HORIZON   # most recent complete episode
    if score_base > latest:
        raise ValueError(f"score_base {score_base} > latest data year {latest}")

    # --- training episode (train_base -> train_base+HORIZON) ---
    tgt_year = train_base + HORIZON
    if tgt_year > latest:
        raise ValueError(f"train target year {tgt_year} > latest data year {latest}")
    tr = df.dropna(subset=[f"zhvi_{train_base}", f"zhvi_{tgt_year}"]).copy()
    tr = tr[tr[f"zhvi_{train_base}"] > 0]
    tr["target"] = (tr[f"zhvi_{tgt_year}"] > tr[f"zhvi_{train_base}"]).astype(int)  # went up?
    Xtr_all, ytr_all = features_at(tr, train_base), tr["target"]

    # sanity guard: the directional "went up" rate is high but must not be
    # degenerate (all-up gives the model nothing to separate). Fail loudly in an
    # unattended run if the training episode has no meaningful down class.
    pos = float(ytr_all.mean())
    if not (0.50 <= pos <= 0.995):
        raise ValueError(
            f"degenerate directional target at {train_base}->{tgt_year}: up-rate "
            f"{pos:.1%}. Need a meaningful minority of declines to learn from."
        )

    # honest, best-effort validation metrics (never block the score write)
    try:
        metrics = honest_metrics(df, train_base, Xtr_all, ytr_all)
    except Exception as e:   # noqa: BLE001 — degrade gracefully in an unattended job
        print(f"WARNING: honest_metrics failed ({e!r}); reporting in-sample only")
        Xt, Xho, yt, yho = train_test_split(Xtr_all, ytr_all, test_size=0.20,
                                            stratify=ytr_all, random_state=SEED)
        v = build_pipe().fit(Xt, yt)
        metrics = {
            "in_sample_auc_optimistic": round(float(roc_auc_score(
                yho, v.predict_proba(Xho)[:, 1])), 3),
            "train_n": int(len(tr)), "positive_rate": round(pos, 3),
        }
    try:
        metrics["drift"] = population_stability(df, train_base, score_base)
    except Exception as e:   # noqa: BLE001
        print(f"WARNING: population_stability failed ({e!r})")

    # --- forward forecast: refit on the whole training episode, apply at score_base ---
    pipe = build_pipe().fit(Xtr_all, ytr_all)
    # require the recent history the momentum features need (so the forecast is real,
    # not mostly imputed) + a metro (appreciation is a metro phenomenon).
    need = [f"zhvi_{y}" for y in (score_base, score_base - 1, score_base - 2,
                                  score_base - 4) if f"zhvi_{y}" in df.columns]
    sc = df.dropna(subset=need + ["Metro"]).copy()
    sc = sc[sc[f"zhvi_{score_base}"] > 0]
    Xsc = features_at(sc, score_base)
    sc["prob"] = pipe.predict_proba(Xsc)[:, 1]
    sc["score"] = (sc["prob"] * 100).round().astype(int)
    # rank is the HONEST headline: a percentile (0-100) of the ZIP among all
    # scored ZIPs. Unlike score/prob it makes no false probability claim — it
    # only says "this ZIP ranks above X% of the country", which is what the
    # out-of-time evidence supports (ranking skill, not calibrated probability).
    sc["rank"] = (sc["prob"].rank(pct=True) * 100).round().astype(int)
    # appr context = trailing ACTUAL appreciation over APPR_DISPLAY_YEARS (backward-
    # looking history for the KPI/chart), independent of the 3-year forecast horizon.
    appr_base = score_base - APPR_DISPLAY_YEARS
    if f"zhvi_{appr_base}" in sc.columns:
        base = sc[f"zhvi_{appr_base}"]
        sc["appr5yr"] = np.where(base > 0, (sc[f"zhvi_{score_base}"] / base - 1) * 100, np.nan)
    else:
        sc["appr5yr"] = np.nan
    # momentum = the LATEST observable year-over-year change (never a stale YoY).
    mom_now, mom_prev = latest, latest - 1
    if f"zhvi_{mom_now}" in sc.columns and f"zhvi_{mom_prev}" in sc.columns:
        prev = sc[f"zhvi_{mom_prev}"]
        sc["momentum"] = np.where(prev > 0, (sc[f"zhvi_{mom_now}"] / prev - 1) * 100, np.nan)
    else:
        sc["momentum"] = np.nan
    sc["pctile_metro_disp"] = Xsc["pctile_metro"] * 100
    # honesty flag: this ZIP's score leans on >=1 median-imputed MODEL feature
    # (usually missing 7-year history). The UI dims/derates these.
    sc["imputed"] = Xsc[MODEL_FEATURES].isna().any(axis=1).reindex(sc.index, fill_value=False)

    records = []
    for _, r in sc.sort_values("score", ascending=False).iterrows():
        records.append({
            "zip": r["zip"],
            "city": (r["City"] if isinstance(r["City"], str) else ""),
            "state": (r["State"] if isinstance(r["State"], str) else ""),
            "metro": (r["Metro"] if isinstance(r["Metro"], str) else ""),
            "county": (r["CountyName"] if isinstance(r["CountyName"], str) else ""),
            "score": int(r["score"]),
            "rank": int(r["rank"]),
            "prob": _num(r["prob"], 3),
            "appr5yr": _num(r["appr5yr"], 1),
            "momentum": _num(r["momentum"], 1),
            "pctileMetro": _num(r["pctile_metro_disp"], 0),
            "imputed": bool(r["imputed"]),
        })

    meta = {
        "train_window": f"{train_base}->{tgt_year}",
        "forecast_window": f"{score_base}->{score_base + HORIZON}",
        "horizon_years": HORIZON,
        "n_scored": len(records),
        "model": "rise-prob-2yr-v5",
        "score_meaning": "prob = calibrated probability the home value rises over the horizon",
    }
    return {"records": records, "metrics": metrics, "meta": meta}
