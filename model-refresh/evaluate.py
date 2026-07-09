"""Honest, reproducible evaluation of the forward gentrification model.

This is the validation the model never had. It mirrors production EXACTLY by
importing the same feature/target/pipeline code from model.py, then runs the
tests a single random in-sample split cannot:

  E1  out-of-time walk-forward backtest        — is the ~0.75 AUC real? (no: ~0.64)
  E2  spatial leakage: random vs grouped CV     — neighbors leak across a random split
  E3  calibration                               — is score=prob*100 an honest probability? (no)
  E4  train/score covariate drift (PSI)         — the model scores a shifted distribution
  E5  non-stationarity + a stationary target    — why the window is pinned
  E6  mean-reversion / feature dominance         — the actionable tail is a cheapness bet
  E7  three-models reconciliation + 91.7% CI    — which model the headline numbers describe

Usage:
  /Users/noahrubin/gentrification-model/.venv/bin/python evaluate.py [zhvi.csv]

Defaults to the local full-history ZHVI file; in CI/cloud pass the downloaded CSV.
Every number here is reproducible against Zillow ZHVI (Jan snapshots, 2000-2026).
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.inspection import permutation_importance
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold, StratifiedKFold, train_test_split

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import (FEATURES, HORIZON, SEED, THRESH, _importances,  # noqa: E402
                   build_pipe, episode, features_at, load_zhvi, population_stability)

CANDIDATES = [
    "/Users/noahrubin/gentrification-model/data/zillow/Zip_zhvi_sfrcondo.csv",
    "/Users/noahrubin/neighborhoodiq/data/raw/zillow_zhvi_zip.csv",
]
TRAIN_BASE, SCORE_BASE = 2019, 2024


def hr(t: str) -> None:
    print(f"\n{'='*74}\n  {t}\n{'='*74}")


def wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return (float("nan"), float("nan"))
    p, d = k / n, 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - m) / d, (c + m) / d)


def pooled_oof_auc(X, y, groups) -> float:
    oof = np.full(len(y), np.nan)
    for tr, te in GroupKFold(5).split(X, y, groups):
        oof[te] = build_pipe().fit(X.iloc[tr], y.iloc[tr]).predict_proba(X.iloc[te])[:, 1]
    return float(roc_auc_score(y, oof))


# --------------------------------------------------------------------------- #
def e1_walk_forward(df):
    hr("E1  OUT-OF-TIME WALK-FORWARD BACKTEST  vs the in-sample claim")
    years = df.attrs["years"]
    bases = list(range(min(years) + 9, max(years) - HORIZON + 1))

    Xp, yp, _ = episode(df, TRAIN_BASE)
    # reproduce BOTH the originally-shipped single 80/20 split AND a 5-fold mean
    Xt, Xho, yt, yho = train_test_split(Xp, yp, test_size=0.20, stratify=yp,
                                        random_state=SEED)
    m = build_pipe().fit(Xt, yt)
    split_auc = roc_auc_score(yho, m.predict_proba(Xho)[:, 1])
    split_acc = accuracy_score(yho, m.predict(Xho))
    split_baseline = max(yho.mean(), 1 - yho.mean())
    cv_auc = np.mean([roc_auc_score(yp.iloc[te], build_pipe().fit(Xp.iloc[tr], yp.iloc[tr])
                                    .predict_proba(Xp.iloc[te])[:, 1])
                      for tr, te in StratifiedKFold(5, shuffle=True, random_state=SEED).split(Xp, yp)])
    print(f"  IN-SAMPLE on {TRAIN_BASE}->{TRAIN_BASE+HORIZON} (what the old code reported):")
    print(f"     single 80/20 split: AUC={split_auc:.3f}  accuracy={split_acc:.3f}  "
          f"(majority baseline={split_baseline:.3f})")
    print(f"     -> accuracy beats the predict-nobody baseline by only "
          f"{split_acc-split_baseline:+.3f}.  'Accuracy' here IS the base rate.")
    print(f"     random 5-fold AUC = {cv_auc:.3f}")

    print(f"\n  TRUE OUT-OF-TIME (train prior disjoint episode, forecast the next):")
    print(f"  {'train':>11} {'->test':>11} {'n':>7} {'pos%':>6} {'OOT_AUC':>8} "
          f"{'acc':>6} {'base':>6}")
    band = []
    for B in bases:
        te, tr = episode(df, B), episode(df, B - HORIZON)
        if te is None or tr is None:
            continue
        Xte, yte, _ = te
        Xtr, ytr, _ = tr
        if yte.nunique() < 2 or ytr.nunique() < 2:
            continue
        p = build_pipe().fit(Xtr, ytr).predict_proba(Xte)[:, 1]
        auc = roc_auc_score(yte, p)
        acc = accuracy_score(yte, (p >= .5).astype(int))
        br = float(yte.mean())
        band.append(auc)
        star = "  <- deployment analogue" if B == TRAIN_BASE else ""
        print(f"  {B-HORIZON}->{B:>4} {B}->{B+HORIZON:>4} {len(yte):>7} "
              f"{br*100:>5.1f} {auc:>8.3f} {acc:>6.3f} {max(br,1-br):>6.3f}{star}")

    # headline + a CORRECT uncertainty story
    Xtr, ytr, _ = episode(df, TRAIN_BASE - HORIZON)
    p = build_pipe().fit(Xtr, ytr).predict_proba(Xp)[:, 1]
    yv = yp.to_numpy()
    auc = roc_auc_score(yv, p)
    rng = np.random.default_rng(SEED)
    boot = [roc_auc_score(yv[i], p[i]) for i in
            (rng.integers(0, len(yv), len(yv)) for _ in range(400))
            if len(np.unique(yv[i])) > 1]
    lo, hi = np.percentile(boot, [2.5, 97.5])
    print(f"\n  >> HEADLINE  train 2014->2019, FORECAST 2019->2024:  OOT AUC = {auc:.3f}")
    print(f"     in-sample single split was {split_auc:.3f}  =>  improper validation "
          f"inflated AUC by ~{split_auc-auc:+.3f}")
    print(f"     test-set sampling CI (noise only, NOT forecast uncertainty): "
          f"[{lo:.3f}, {hi:.3f}]")
    print(f"     REAL forecast-uncertainty band across eras = "
          f"[{min(band):.3f}, {max(band):.3f}]  (this is the number to trust)")


def e2_spatial(df):
    hr("E2  SPATIAL LEAKAGE  —  random split vs Metro/State-grouped (pooled-OOF)")
    X, y, d = episode(df, TRAIN_BASE)
    keep = d["Metro"].notna() & d["State"].notna()
    X, y, d = X[keep], y[keep], d[keep]
    rnd = np.mean([roc_auc_score(y.iloc[te], build_pipe().fit(X.iloc[tr], y.iloc[tr])
                                 .predict_proba(X.iloc[te])[:, 1])
                   for tr, te in StratifiedKFold(5, shuffle=True, random_state=SEED).split(X, y)])
    gm = pooled_oof_auc(X, y, d["Metro"].to_numpy())
    gs = pooled_oof_auc(X, y, d["State"].to_numpy())
    print(f"  random 5-fold (their method)  AUC = {rnd:.3f}   <- neighbors leak across folds")
    print(f"  GroupKFold by METRO (pooled)  AUC = {gm:.3f}   (drop {rnd-gm:+.3f})")
    print(f"  GroupKFold by STATE (pooled)  AUC = {gs:.3f}   (drop {rnd-gs:+.3f})")
    print(f"  => ~{rnd-gm:.2f} AUC of the headline was spatial autocorrelation, not skill.")


def e3_calibration(df):
    hr("E3  CALIBRATION  —  is score=prob*100 an honest probability?  (no)")
    Xtr, ytr, _ = episode(df, TRAIN_BASE - HORIZON)   # train 2014->2019
    Xte, yte, _ = episode(df, TRAIN_BASE)             # test  2019->2024 (out of time)
    yv = yte.to_numpy()
    ar = float(yv.mean())

    def reliability(tag, model):
        p = model.fit(Xtr, ytr).predict_proba(Xte)[:, 1]
        brier = brier_score_loss(yv, p)
        print(f"\n  [{tag}]  Brier={brier:.4f}  mean_pred={p.mean():.3f}  actual={ar:.3f}")
        return brier, float(p.mean()), p

    b_bal, mp_bal, p_bal = reliability("deployed model, class_weight=balanced", build_pipe(True))
    b_unw, _, _ = reliability("deployed model, unweighted", build_pipe(False))
    b_cal, _, _ = reliability("isotonic-calibrated",
                              CalibratedClassifierCV(build_pipe(False), method="isotonic", cv=3))
    const = ar * (1 - ar)
    print(f"\n  Brier (lower=better):  balanced={b_bal:.4f}  unweighted={b_unw:.4f}  "
          f"isotonic={b_cal:.4f}")
    print(f"  CONSTANT base-rate guess Brier = {const:.4f}  "
          f"-> it {'BEATS' if const < b_bal else 'loses to'} the deployed model.")
    print(f"  Out-of-time the model UNDER-forecasts by {ar-mp_bal:+.3f} (regime shift: "
          f"train base rate ~10% vs test ~25%), so its probabilities are not honest.")
    # but the RANK carries signal:
    order = np.argsort(-p_bal)
    top_decile = yv[order[:len(yv)//10]].mean()
    print(f"  Yet RANK works: top-decile realized rate {top_decile:.3f} vs overall {ar:.3f} "
          f"= {top_decile/ar:.2f}x lift.  => present a RANK, not a probability.")


def e4_drift(df):
    hr("E4  TRAIN/SCORE COVARIATE DRIFT  —  features_at(2019) vs features_at(2024)")
    s = population_stability(df, TRAIN_BASE, SCORE_BASE)
    print(f"  {'feature':>12} {'PSI':>7}  drift")
    for f in FEATURES:
        v = s["psi"].get(f, float("nan"))
        tag = "SEVERE" if v > 0.25 else ("moderate" if v > 0.1 else "ok")
        print(f"  {f:>12} {v:>7.3f}  {tag}")
    print(f"\n  {s['n_severe']}/9 features SEVERELY shifted (PSI>0.25): "
          f"{', '.join(s['severe_features'])}")
    print(f"  The model trains on one distribution and scores another; long-horizon "
          f"momentum drifts hardest, cheapness features are stable.")


def e5_stationarity(df):
    hr("E5  NON-STATIONARITY  —  base rate of the >=60%/5yr target by era")
    years = df.attrs["years"]
    print(f"  {'episode':>13} {'n':>7} {'pos%':>7}  learnable?")
    for B in range(2005, max(years) - HORIZON + 1):
        ep = episode(df, B)
        if ep is None:
            continue
        _, y, _ = ep
        r = float(y.mean())
        print(f"  {B}->{B+5:>4}      {len(y):>7} {r*100:>6.1f}  "
              f"{'yes' if 0.08 <= r <= 0.60 else 'DEGENERATE'}")
    Xtr, ytr = _relative(df, TRAIN_BASE - HORIZON)
    Xte, yte = _relative(df, TRAIN_BASE)
    auc = roc_auc_score(yte, build_pipe().fit(Xtr, ytr).predict_proba(Xte)[:, 1])
    print(f"\n  A PERIOD-RELATIVE target (top-25% growth within each era) is ~25% every "
          f"era by construction => always learnable, no pinning.")
    print(f"  OOT AUC with the relative target (train 2014->2019, test 2019->2024) = "
          f"{auc:.3f}  (ranking skill is the transferable metric).")


def _relative(df, B):
    tgt = B + HORIZON
    d = df.dropna(subset=[f"zhvi_{B}", f"zhvi_{tgt}"]).query(f"zhvi_{B} > 0").copy()
    g = d[f"zhvi_{tgt}"] / d[f"zhvi_{B}"] - 1
    return features_at(d, B), (g >= g.quantile(0.75)).astype(int)


def e6_meanreversion(df):
    hr("E6  MEAN-REVERSION CHECK  —  is the actionable tail a cheapness bet?")
    X, y, _ = episode(df, TRAIN_BASE)
    m = build_pipe().fit(X, y)
    imp = _importances(m)                       # |coef| over the cheapness features
    perm = permutation_importance(m, X.fillna(X.median()), y, n_repeats=4,
                                  random_state=SEED, scoring="roc_auc")
    pi = pd.Series(perm.importances_mean, index=FEATURES)
    print(f"  {'feature':>12} {'|coef|':>8} {'perm':>7}  (non-cheapness features are dropped by the model)")
    for f in FEATURES:
        print(f"  {f:>12} {imp.get(f, 0.0):>8.3f} {pi[f]:>7.3f}")
    sc = df.dropna(subset=["zhvi_2024", "Metro"]).query("zhvi_2024 > 0").copy()
    Xsc = features_at(sc, SCORE_BASE)
    prob = m.predict_proba(Xsc)[:, 1]
    ok = Xsc["pctile_metro"].notna().to_numpy()
    c = np.corrcoef(prob[ok], Xsc["pctile_metro"].to_numpy()[ok])[0, 1]
    print(f"\n  corr(score, metro price percentile) = {c:+.3f}  "
          f"(negative => cheaper-for-metro scores higher).")
    sc["prob"], sc["pct"] = prob, Xsc["pctile_metro"].to_numpy() * 100
    print(f"  Top-10 forecast ZIPs (pctile 0 = cheapest in metro):")
    for _, r in sc.sort_values("prob", ascending=False).head(10).iterrows():
        pv = r["pct"]
        print(f"     {r['zip']}  {str(r['City'])[:16]:16} {str(r['Metro'])[:26]:26} "
              f"pctile={pv:4.0f}" if pv == pv else f"     {r['zip']}")


def e7_three_models():
    hr("E7  WHICH MODEL DO THE HEADLINE NUMBERS DESCRIBE?")
    print("   1. NATIONAL scale-free RF (model-refresh/model.py)  <- DEPLOYED, serves the app")
    print("      -> the '78% / 0.75' came from THIS model's in-sample random split.")
    print("   2. MA Model A (forecast, leakage-free, train_appreciation_model.py) <- source of 91.7%")
    print("   3. MA Model B (association, post-dated features)     <- not a forecast at all")
    f = "/Users/noahrubin/neighborhoodiq/data/holdout_predictions.csv"
    if os.path.exists(f):
        h = pd.read_csv(f, dtype={"zip": str})
        col = [c for c in h.columns if c.startswith("correct_A")]
        if col:
            k, n = int(h[col[0]].sum()), len(h)
            lo, hi = wilson(k, n)
            print(f"\n  MA Model A holdout: {k}/{n} = {k/n*100:.1f}%  "
                  f"95% Wilson CI [{lo*100:.0f}%, {hi*100:.0f}%]  (width {(hi-lo)*100:.0f} pts)")
            print(f"  n={n} makes this statistically near-uninformative — never cite it "
                  f"as general accuracy.")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else next(
        (p for p in CANDIDATES if os.path.exists(p)), None)
    if not path or not os.path.exists(path):
        sys.exit(f"no ZHVI csv found; pass a path. tried: {CANDIDATES}")
    print(f"loading {path} ...")
    df = load_zhvi(path)
    print(f"loaded {len(df)} ZIPs, Jan snapshots {df.attrs['years'][0]}..{df.attrs['years'][-1]}")
    for fn in (e1_walk_forward, e2_spatial, e3_calibration, e4_drift,
               e5_stationarity, e6_meanreversion):
        fn(df)
    e7_three_models()
    hr("BOTTOM LINE")
    print("  * Honest out-of-time AUC ~0.63-0.64 (band 0.58-0.72), NOT 0.75.")
    print("  * 'Accuracy' == the base rate; the model adds ~2-3 points. Do not headline it.")
    print("  * The score is a RANKING, not a calibrated probability (a constant guess")
    print("    beats it on Brier); show `rank`/percentile in the UI.")
    print("  * 4/9 features severely drift train->score; base rate is non-stationary.")
    print("  * The 91.7% is a different (MA, n=12) model and is near-uninformative.")


if __name__ == "__main__":
    main()
