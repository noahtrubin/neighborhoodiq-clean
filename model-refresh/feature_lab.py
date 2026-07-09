"""Validator-gated feature lab — does a candidate feature actually help?

The honest out-of-time backtest (evaluate.py) showed the price-only model sits at
AUC ~0.63 and is, in effect, a cheapness bet. The plan to turn NeighborhoodIQ into
a real *predictor* is to add fundamentals (demand pressure, income/jobs growth,
supply pipeline) — but ONLY features that prove they lift out-of-time AUC over the
cheapness baseline. The June-23 "no lift" verdict is void: it was measured against
the inflated in-sample 0.75 baseline. This is the instrument that re-judges honestly.

It imports the EXACT feature/target/pipeline code from model.py, so the baseline
here is the deployed model, not a lookalike. A candidate feature is supplied as a
historical PANEL — one row per (key, year) — and merged as-of the episode base year
(no leakage: only values known at or before year B are used).

What it reports, per out-of-time episode (train B-5->B, forecast B->B+5):
  * AUC_base      cheapness-only (the deployed model)
  * AUC_aug       cheapness + candidate feature(s)
  * delta         the honest lift (this is the number that decides keep/drop)
  * coverage      fraction of test ZIPs the feature actually covers
  * covered-only  AUC_base vs AUC_aug computed ONLY where the feature exists
                  (separates "useless feature" from "useful but too sparse")

Usage:
  # self-test the instrument (no external data needed):
  /Users/noahrubin/gentrification-model/.venv/bin/python model-refresh/feature_lab.py

  # from another script, test a real panel:
  from feature_lab import load_df, evaluate_feature
  df = load_df()
  panel = pd.DataFrame({"zip": [...], "year": [...], "dom": [...], ...})
  evaluate_feature(df, panel, join_on="zip", feature_cols=["dom"], label="redfin DOM")
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import (  # noqa: E402
    HORIZON, SEED, build_pipe, episode, load_zhvi,
)

CANDIDATES = [
    "/Users/noahrubin/gentrification-model/data/zillow/Zip_zhvi_sfrcondo.csv",
    "/Users/noahrubin/neighborhoodiq/model-refresh/zhvi.csv",
    "/Users/noahrubin/neighborhoodiq/data/raw/zillow_zhvi_zip.csv",
]


def load_df(path: str | None = None) -> pd.DataFrame:
    """Load the full-history ZHVI frame (same loader the model/validator use)."""
    path = path or next((p for p in CANDIDATES if os.path.exists(p)), None)
    if not path or not os.path.exists(path):
        sys.exit(f"no ZHVI csv found; pass a path. tried: {CANDIDATES}")
    return load_zhvi(path)


# --------------------------------------------------------------------------- #
#  augmented model: the deployed cheapness pipeline + extra numeric features    #
# --------------------------------------------------------------------------- #
def build_aug_pipe(feature_cols: list[str], balanced: bool = False) -> Pipeline:
    """The deployed cheapness treatment (pctile_metro passthrough, log rel_state)
    PLUS the candidate feature columns (median-imputed, standardized). Same
    estimator + settings as model.build_pipe so any AUC change is the feature."""
    cw = "balanced" if balanced else None
    return Pipeline([
        ("sel", ColumnTransformer([
            ("pct", "passthrough", ["pctile_metro"]),
            ("logrel", FunctionTransformer(np.log), ["rel_state"]),
            ("ext", "passthrough", list(feature_cols)),
        ], remainder="drop")),
        ("imp", SimpleImputer(strategy="median")),
        ("sc", StandardScaler()),
        ("lr", LogisticRegression(max_iter=2000, class_weight=cw, random_state=SEED)),
    ])


def asof_merge(frame: pd.DataFrame, panel: pd.DataFrame, join_on: str,
               feature_cols: list[str], B: int) -> pd.DataFrame:
    """Most-recent panel values known at or before year B, aligned to `frame`'s
    index. No leakage: rows with year > B are never used."""
    p = panel[panel["year"] <= B].sort_values("year")
    p = p.drop_duplicates(join_on, keep="last")[[join_on] + feature_cols]
    merged = frame[[join_on]].merge(p, on=join_on, how="left")
    merged.index = frame.index
    return merged[feature_cols]


def _augment(X9: pd.DataFrame, frame: pd.DataFrame, panel: pd.DataFrame,
             join_on: str, feature_cols: list[str], B: int) -> pd.DataFrame:
    """X for the augmented model: the two cheapness inputs + as-of feature cols."""
    out = X9[["pctile_metro", "rel_state"]].copy()
    ext = asof_merge(frame, panel, join_on, feature_cols, B)
    for c in feature_cols:
        out[c] = ext[c].to_numpy()
    # growth ratios can yield +/-inf on a zero denominator; the imputer only
    # fills NaN, so normalize inf -> NaN here (mirrors model.features_at).
    return out.replace([np.inf, -np.inf], np.nan)


# --------------------------------------------------------------------------- #
#  the A/B itself                                                               #
# --------------------------------------------------------------------------- #
def evaluate_feature(df: pd.DataFrame, panel: pd.DataFrame, join_on: str,
                     feature_cols: list[str], label: str = "feature") -> pd.DataFrame:
    """Out-of-time A/B of `feature_cols` vs the cheapness baseline across every
    learnable episode. Prints a table and returns it as a DataFrame."""
    if join_on not in df.columns and join_on != "zip":
        raise ValueError(f"join_on={join_on!r} is not a column produced by episode()")
    panel = panel.copy()
    panel[join_on] = panel[join_on].astype(str) if join_on == "zip" else panel[join_on]
    panel["year"] = panel["year"].astype(int)

    years = df.attrs["years"]
    bases = list(range(min(years) + 9, max(years) - HORIZON + 1))
    rows = []
    print(f"\n{'='*86}\n  FEATURE A/B: {label}   (join={join_on}, cols={feature_cols})\n{'='*86}")
    print(f"  {'train->test':>16} {'n':>7} {'cov%':>6} "
          f"{'AUC_base':>9} {'AUC_aug':>9} {'delta':>7}   "
          f"{'covd_base':>9} {'covd_aug':>9} {'covd_d':>7}")
    for B in bases:
        te, tr = episode(df, B), episode(df, B - HORIZON)
        if te is None or tr is None:
            continue
        Xte9, yte, dte = te
        Xtr9, ytr, dtr = tr
        if yte.nunique() < 2 or ytr.nunique() < 2:
            continue

        base = build_pipe().fit(Xtr9, ytr)
        p_base = base.predict_proba(Xte9)[:, 1]
        auc_base = roc_auc_score(yte, p_base)

        Xtr_a = _augment(Xtr9, dtr, panel, join_on, feature_cols, B - HORIZON)
        Xte_a = _augment(Xte9, dte, panel, join_on, feature_cols, B)
        aug = build_aug_pipe(feature_cols).fit(Xtr_a, ytr)
        p_aug = aug.predict_proba(Xte_a)[:, 1]
        auc_aug = roc_auc_score(yte, p_aug)

        # coverage + covered-only AUC (the feature's value where it actually exists)
        covered = Xte_a[feature_cols].notna().any(axis=1).to_numpy()
        cov = float(covered.mean())
        cb = ca = float("nan")
        yc = yte.to_numpy()[covered]
        if covered.sum() > 50 and len(np.unique(yc)) > 1:
            cb = roc_auc_score(yc, p_base[covered])
            ca = roc_auc_score(yc, p_aug[covered])

        rows.append({"base_year": B, "n": int(len(yte)), "coverage": round(cov, 3),
                     "auc_base": round(auc_base, 4), "auc_aug": round(auc_aug, 4),
                     "delta": round(auc_aug - auc_base, 4),
                     "covered_auc_base": round(cb, 4), "covered_auc_aug": round(ca, 4),
                     "covered_delta": round(ca - cb, 4)})
        star = "  <- deployment analogue" if B == 2019 else ""
        cd = f"{ca-cb:+7.4f}" if cb == cb else "    n/a"
        cbs = f"{cb:9.4f}" if cb == cb else "      n/a"
        cas = f"{ca:9.4f}" if ca == ca else "      n/a"
        print(f"  {f'{B-HORIZON}->{B}':>16} {len(yte):>7} {cov*100:>5.1f} "
              f"{auc_base:>9.4f} {auc_aug:>9.4f} {auc_aug-auc_base:>+7.4f}   "
              f"{cbs} {cas} {cd}{star}")

    res = pd.DataFrame(rows)
    if not res.empty:
        md, mcd = res["delta"].mean(), res["covered_delta"].mean()
        print(f"\n  mean national delta = {md:+.4f}   "
              f"mean covered-only delta = {mcd:+.4f}")
        print(f"  VERDICT: {'KEEP — lifts OOT AUC' if md > 0.005 else 'covered-only signal, too sparse nationally' if mcd > 0.01 else 'DROP — no honest lift'}")
    return res


# --------------------------------------------------------------------------- #
#  self-test: prove the instrument detects signal and rejects noise            #
# --------------------------------------------------------------------------- #
def _noise_panel(df: pd.DataFrame) -> pd.DataFrame:
    """A random feature per (zip, year). A correct harness shows ~0 lift."""
    rng = np.random.default_rng(SEED)
    years = df.attrs["years"]
    zips = df["zip"].to_numpy()
    parts = [pd.DataFrame({"zip": zips, "year": y,
                           "noise": rng.standard_normal(len(zips))}) for y in years]
    return pd.concat(parts, ignore_index=True)


def _leak_panel(df: pd.DataFrame) -> pd.DataFrame:
    """The realized 5yr growth as a feature = target leakage. A correct harness
    shows a large positive lift and covered AUC near 1.0 — it can see signal."""
    years = set(df.attrs["years"])
    parts = []
    for B in df.attrs["years"]:
        tgt = B + HORIZON
        if f"zhvi_{B}" in df and f"zhvi_{tgt}" in df.columns and tgt in years | {B + HORIZON}:
            if f"zhvi_{tgt}" not in df.columns:
                continue
            g = df[f"zhvi_{tgt}"] / df[f"zhvi_{B}"] - 1
            parts.append(pd.DataFrame({"zip": df["zip"], "year": B, "future_growth": g}))
    return pd.concat(parts, ignore_index=True)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else None
    df = load_df(path)
    print(f"loaded {len(df)} ZIPs, Jan snapshots "
          f"{df.attrs['years'][0]}..{df.attrs['years'][-1]}")
    print("\nSELF-TEST 1/2 — random noise feature (expect delta ~ 0):")
    evaluate_feature(df, _noise_panel(df), "zip", ["noise"], label="random noise (control)")
    print("\nSELF-TEST 2/2 — leaked future-growth feature (expect large positive lift):")
    evaluate_feature(df, _leak_panel(df), "zip", ["future_growth"], label="future growth (leak)")
    print("\nIf noise≈0 and leak≫0, the instrument is wired correctly. "
          "Feed it a real historical panel next (Redfin, ACS, ...).")


if __name__ == "__main__":
    main()
