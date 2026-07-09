"""Forward-looking national gentrification model — reusable build step.

Trains on the most recent fully-observed 5-year episode (BASE -> BASE+5) and
applies the model to features computed at the latest year to forecast the next 5
years for every metro ZIP. The model is an L2 logistic regression on the
cheapness features (cheap-for-its-metro/state); an out-of-time A/B picked it over
a RandomForest for equal skill + far more stable rankings — see build_pipe.

WHAT THE NUMBERS MEAN (read this before quoting any metric)
-----------------------------------------------------------
The forward 2024->2029 forecast cannot be validated — the future hasn't
happened. The honest question is "how well does this *method* forecast a 5-year
window it has never seen?" `metrics` answers that with an OUT-OF-TIME test:
train on the prior disjoint episode (BASE-5 -> BASE) and predict the realized
BASE -> BASE+5 outcome. Key, hard-won facts (see model-refresh/evaluate.py for
the full reproduction against 2000-2026 ZHVI):

  * OUT-OF-TIME AUC ~= 0.60-0.63, NOT the ~0.75 a random in-sample split shows.
    Random-split validation leaks spatially-autocorrelated neighbors across the
    split and inflates AUC. We therefore report `oot_auc` (honest) and
    `in_sample_auc_optimistic` (the inflated number) side by side.
  * "ACCURACY" IS A TRAP. At the 0.5 threshold, accuracy == the majority-class
    base rate (predict-nobody-gentrifies). The model beats that baseline by ~2-3
    points only. Never headline "78% accuracy"; it is the base rate, not skill.
  * THE SCORE IS A RANKING, NOT A CALIBRATED PROBABILITY. Out-of-time, a constant
    base-rate guess beats the model on Brier score, yet the model's *rank order*
    carries real signal (top-decile lift ~1.5x). Use `rank` (percentile, honest)
    in the UI, not `score`/`prob` as if "86" meant "86% chance".
  * NON-STATIONARITY is real: the >=60%/5yr base rate swings 0.1%->30%->2.5%
    across eras, which is why the window is PINNED (not auto-rolled) and why the
    forecast-uncertainty band (`oot_auc_band`) is wide.
"""
from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

HORIZON, THRESH, SEED = 5, 0.60, 42
MONTH = "01-31"
META = ["RegionName", "State", "City", "Metro", "CountyName"]
FEATURES = ["g_9yr", "g_7yr", "g_4yr", "g_2yr", "g_1yr", "accel",
            "rel_metro", "rel_state", "pctile_metro"]
# The production model uses only the (bounded) cheapness features. A head-to-head
# out-of-time A/B picked an L2 logistic on these over the old RandomForest: ~equal
# forward AUC (0.60) but FAR more stable rankings (top-100 survives a +/-2% reprice
# ~89/100 vs 60, a 1-yr base shift ~72/100 vs 21) and a higher realized top-decile
# hit rate (45% vs 36%). The RF was a cheapness bet in disguise, so we model
# cheapness directly. We use pctile_metro (bounded within-metro rank) + LOG(rel_state)
# (cheap-vs-state); rel_metro is dropped (collinear with pctile_metro, and as a raw
# unbounded ratio it gave a few ultra-expensive outliers extreme linear leverage —
# e.g. Sea Island at 15x its metro median wrongly topped the list). log() tames that.
CHEAP_FEATURES = ["pctile_metro", "rel_state"]   # rel_state is log-transformed in build_pipe

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


def episode(df: pd.DataFrame, B: int, thresh: float = THRESH):
    """(X, y, frame) for the episode based at year B, or None if the data needed
    for features (B-9) or the realized outcome (B+HORIZON) is absent."""
    tgt = B + HORIZON
    needed = [f"zhvi_{B - k}" for k in (9, 7, 4, 2, 1, 0)] + [f"zhvi_{tgt}"]
    if any(c not in df.columns for c in needed):
        return None
    d = df.dropna(subset=[f"zhvi_{B}", f"zhvi_{tgt}"]).copy()
    d = d[d[f"zhvi_{B}"] > 0]
    growth = d[f"zhvi_{tgt}"] / d[f"zhvi_{B}"] - 1
    d["target"] = (growth >= thresh).astype(int)
    return features_at(d, B), d["target"], d


def build_pipe(balanced: bool = False) -> Pipeline:
    """Production model: L2 logistic regression on the cheapness features only.
    Accepts the full 9-feature frame (selects the cheapness columns internally) so
    every existing caller keeps working unchanged."""
    cw = "balanced" if balanced else None
    return Pipeline([
        # pctile_metro passthrough (already bounded 0-1); rel_state log-transformed
        # so an ultra-expensive ZIP can't dominate the linear model.
        ("sel", ColumnTransformer([
            ("pct", "passthrough", ["pctile_metro"]),
            ("logrel", FunctionTransformer(np.log), ["rel_state"]),
        ], remainder="drop")),
        ("imp", SimpleImputer(strategy="median")),
        ("sc", StandardScaler()),
        ("lr", LogisticRegression(max_iter=2000, class_weight=cw, random_state=SEED)),
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


def compute_scores(zillow_csv_path: str, train_base: int = 2019,
                   score_base: int | None = None) -> dict:
    """Returns {records: [...], metrics: {...}, meta: {...}}.

    train_base is PINNED at 2019 (its >=60%/5yr target is the most recent learnable
    episode — the base rate is era-dependent: 25% in the 2019->2024 boom but only
    ~3% in 2021->2026, which is degenerate). Re-check the degeneracy guard below if
    you move it.

    score_base defaults to the LATEST available data year (freshness fix): we apply
    the scale-free model to the most recent inputs so the forecast window tracks the
    present (e.g. 2026->2031) instead of lagging two years behind the data. Pass an
    explicit year to pin it.
    """
    df = load_zhvi(zillow_csv_path)
    latest = df.attrs["years"][-1]
    if score_base is None:
        score_base = latest          # freshness: forecast from the newest data
    if score_base > latest:
        raise ValueError(f"score_base {score_base} > latest data year {latest}")

    # --- training episode (train_base -> train_base+HORIZON) ---
    tgt_year = train_base + HORIZON
    if tgt_year > latest:
        raise ValueError(f"train target year {tgt_year} > latest data year {latest}")
    tr = df.dropna(subset=[f"zhvi_{train_base}", f"zhvi_{tgt_year}"]).copy()
    tr = tr[tr[f"zhvi_{train_base}"] > 0]
    growth = tr[f"zhvi_{tgt_year}"] / tr[f"zhvi_{train_base}"] - 1
    tr["target"] = (growth >= THRESH).astype(int)
    Xtr_all, ytr_all = features_at(tr, train_base), tr["target"]

    # degeneracy guard: a >=60%/5yr target is only learnable when a meaningful
    # minority of ZIPs hit it. Outside ~[8%, 60%] the classes collapse and the
    # model is useless — fail loudly rather than ship garbage in an unattended run.
    pos = float(ytr_all.mean())
    if not (0.08 <= pos <= 0.60):
        raise ValueError(
            f"degenerate target for {train_base}->{tgt_year}: positive rate {pos:.1%} "
            f"outside [8%, 60%]. Pick a different train window / threshold."
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

    # --- forward forecast: refit on all of the pinned episode, apply at score_base ---
    pipe = build_pipe().fit(Xtr_all, ytr_all)
    need = [f"zhvi_{y}" for y in (train_base, score_base - 4, score_base - 2,
                                  score_base - 1, score_base) if f"zhvi_{y}" in df.columns]
    appr_base = score_base - HORIZON
    sc = df.dropna(subset=list(set(need + [f"zhvi_{appr_base}"])) + ["Metro"]).copy()
    sc = sc[(sc[f"zhvi_{score_base}"] > 0) & (sc[f"zhvi_{appr_base}"] > 0)]
    Xsc = features_at(sc, score_base)
    sc["prob"] = pipe.predict_proba(Xsc)[:, 1]
    sc["score"] = (sc["prob"] * 100).round().astype(int)
    # rank is the HONEST headline: a percentile (0-100) of the ZIP among all
    # scored ZIPs. Unlike score/prob it makes no false probability claim — it
    # only says "this ZIP ranks above X% of the country", which is what the
    # out-of-time evidence supports (ranking skill, not calibrated probability).
    sc["rank"] = (sc["prob"].rank(pct=True) * 100).round().astype(int)
    sc["appr5yr"] = (sc[f"zhvi_{score_base}"] / sc[f"zhvi_{appr_base}"] - 1) * 100
    # momentum = the LATEST observable year-over-year change, NOT score_base+1
    # (freshness fix: never show a stale YoY when newer data exists).
    mom_now, mom_prev = latest, latest - 1
    if f"zhvi_{mom_now}" in sc.columns and f"zhvi_{mom_prev}" in sc.columns:
        sc["momentum"] = (sc[f"zhvi_{mom_now}"] / sc[f"zhvi_{mom_prev}"] - 1) * 100
    else:
        sc["momentum"] = np.nan
    sc["pctile_metro_disp"] = Xsc["pctile_metro"] * 100
    # honesty flag: this ZIP's score leans on >=1 median-imputed feature (usually
    # missing long-horizon history). The UI dims/derates these so the "best" list
    # is not partly fabricated.
    sc["imputed"] = Xsc.isna().any(axis=1).reindex(sc.index, fill_value=False)

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
        "n_scored": len(records),
        "model": "cheapness-logit-v3",
    }
    return {"records": records, "metrics": metrics, "meta": meta}
