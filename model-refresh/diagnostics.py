"""Diagnostic harness for the NeighborhoodIQ appreciation model.

The headline "78% accuracy" is measured IN-SAMPLE on the 2019->2024 episode the
model trained on. This script runs the tests that actually matter for trusting
the forecast, and prints a plain-English verdict:

  1. OUT-OF-TIME forecast skill: train on an earlier episode, predict a later
     fully-observed episode, score against actual outcomes. This is the only
     honest "does it forecast" test.
  2. BEAT-THE-BASELINES: does the random forest beat trivial models
     (cheapness-only, momentum-only, logistic regression)?
  3. CALIBRATION: when the model says "70%", does ~70% actually happen?
  4. SPATIAL LEAKAGE: random split accuracy vs metro-grouped split accuracy.
  5. SPOT-CHECK: do the live high-score ZIPs actually outpace low-score ones
     over the most recent observable years (2024 -> latest)?

Usage:
    pip install -r requirements.txt
    python diagnostics.py            # downloads Zillow if zhvi.csv not present
    python diagnostics.py path.csv   # use an existing Zillow ZHVI ZIP csv
"""
from __future__ import annotations

import os
import re
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import GroupKFold, train_test_split

import model as M  # reuse the production feature logic + pipeline

H, THRESH = M.HORIZON, M.THRESH


def load_panel(csv_path: str):
    """Load the full annual (Jan) ZHVI panel: one zhvi_<year> column per year."""
    head = pd.read_csv(csv_path, nrows=0)
    yrs = sorted(int(c[:4]) for c in head.columns if re.match(r"^\d{4}-01-31$", c))
    cols = M.META + [f"{y}-01-31" for y in yrs]
    df = pd.read_csv(csv_path, usecols=cols, dtype={"RegionName": str})
    df = df.rename(columns={f"{y}-01-31": f"zhvi_{y}" for y in yrs})
    df = df[df["RegionName"].notna()].copy()
    df["zip"] = df["RegionName"].str.zfill(5)
    return df, yrs


def episode(df: pd.DataFrame, B: int):
    """Features at base year B + binary label for the B -> B+H window."""
    e = df.dropna(subset=[f"zhvi_{B}", f"zhvi_{B + H}", "Metro"]).copy()
    e = e[e[f"zhvi_{B}"] > 0]
    X = M._features_at(e, B)
    growth = e[f"zhvi_{B + H}"] / e[f"zhvi_{B}"] - 1
    y = (growth >= THRESH).astype(int)
    return e, X, y


def _line(label, acc, auc, base, n, pos):
    print(f"  {label:<34} acc={acc:.3f}  auc={auc:.3f}  baseline={base:.3f}  "
          f"n={n:>6}  pos={pos:.1%}")


def out_of_time(df, years):
    """Train on episode Bt, forecast a LATER episode Bv, score vs actuals."""
    print("\n" + "=" * 78)
    print("1. OUT-OF-TIME FORECAST SKILL  (train on past, predict a later observed window)")
    print("=" * 78)
    latest = max(years)
    # base years whose B->B+H window is fully observed, with >=9y of history
    usable = [B for B in years if (B + H) <= latest and (B - 9) >= min(years)]
    if len(usable) < 2:
        print("  not enough fully-observed episodes in the data to backtest")
        return
    # pair each train base with the next non-overlapping observed base (+H apart)
    pairs = [(Bt, Bt + H) for Bt in usable if (Bt + H) in usable]
    if not pairs:
        pairs = [(usable[0], usable[-1])]
    for Bt, Bv in pairs:
        _, Xt, yt = episode(df, Bt)
        ev, Xv, yv = episode(df, Bv)
        if yt.nunique() < 2 or yv.nunique() < 2:
            continue
        pipe = M._pipe().fit(Xt, yt)
        p = pipe.predict_proba(Xv)[:, 1]
        pred = (p >= 0.5).astype(int)
        base = max(yv.mean(), 1 - yv.mean())
        print(f"\n  train {Bt}->{Bt+H}  =>  forecast {Bv}->{Bv+H} (actual known):")
        _line("random-forest (production model)",
              accuracy_score(yv, pred), roc_auc_score(yv, p), base, len(yv), yv.mean())
        _baselines(Xt, yt, Xv, yv)


def _baselines(Xt, yt, Xv, yv):
    base = max(yv.mean(), 1 - yv.mean())
    # cheapness only: lower metro percentile => more upside
    cheap = 1 - Xv["pctile_metro"].fillna(Xv["pctile_metro"].median())
    _line("  baseline: cheapness only",
          accuracy_score(yv, (cheap >= cheap.median()).astype(int)),
          roc_auc_score(yv, cheap), base, len(yv), yv.mean())
    # momentum only: most recent 1y growth
    mom = Xv["g_1yr"].fillna(Xv["g_1yr"].median())
    _line("  baseline: 1yr momentum only",
          accuracy_score(yv, (mom >= mom.median()).astype(int)),
          roc_auc_score(yv, mom), base, len(yv), yv.mean())
    # logistic regression on the same 9 features
    from sklearn.pipeline import Pipeline
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import StandardScaler
    lr = Pipeline([("imp", SimpleImputer(strategy="median")),
                   ("sc", StandardScaler()),
                   ("lr", LogisticRegression(max_iter=1000, class_weight="balanced"))])
    lr.fit(Xt, yt)
    pl = lr.predict_proba(Xv)[:, 1]
    _line("  baseline: logistic regression",
          accuracy_score(yv, (pl >= 0.5).astype(int)),
          roc_auc_score(yv, pl), base, len(yv), yv.mean())


def calibration(df, years):
    print("\n" + "=" * 78)
    print("3. CALIBRATION  (does a predicted X% actually happen X% of the time, out-of-time?)")
    print("=" * 78)
    latest = max(years)
    # production analog: train at B, forecast the next observed window B+H
    Bv = 2019 if (2019 + H) <= latest else max(b for b in years if (b + H) <= latest)
    Bt = Bv - H
    _, Xt, yt = episode(df, Bt)
    _, Xv, yv = episode(df, Bv)
    yv = yv.to_numpy()
    p = M._pipe().fit(Xt, yt).predict_proba(Xv)[:, 1]
    print(f"  train {Bt}->{Bt+H}, forecast {Bv}->{Bv+H}")
    print(f"  {'predicted band':<18}{'mean pred':>12}{'actual rate':>14}{'n':>8}")
    for lo in np.arange(0, 1, 0.1):
        m = (p >= lo) & (p < lo + 0.1)
        if m.sum() == 0:
            continue
        print(f"  {f'{lo:.0%}-{lo+0.1:.0%}':<18}{p[m].mean():>12.1%}"
              f"{yv[m].mean():>14.1%}{int(m.sum()):>8}")
    print("  (well-calibrated = 'mean pred' ~ 'actual rate' in every row)")


def spatial_leakage(df, years):
    print("\n" + "=" * 78)
    print("4. SPATIAL LEAKAGE  (random split vs metro-grouped split, in-sample)")
    print("=" * 78)
    B = 2019 if 2019 in years and (2019 + H) <= max(years) else max(
        b for b in years if (b + H) <= max(years))
    e, X, y = episode(df, B)
    Xt, Xho, yt, yho = train_test_split(X, y, test_size=0.20, stratify=y, random_state=42)
    p = M._pipe().fit(Xt, yt).predict_proba(Xho)[:, 1]
    _line(f"random 80/20 split (episode {B})",
          accuracy_score(yho, (p >= .5).astype(int)), roc_auc_score(yho, p),
          max(yho.mean(), 1 - yho.mean()), len(yho), yho.mean())
    # metro-grouped: no metro appears in both train and test
    groups = e["Metro"].fillna("NA").values
    gkf = GroupKFold(n_splits=5)
    accs, aucs = [], []
    for tr_i, te_i in gkf.split(X, y, groups):
        pipe = M._pipe().fit(X.iloc[tr_i], y.iloc[tr_i])
        pp = pipe.predict_proba(X.iloc[te_i])[:, 1]
        accs.append(accuracy_score(y.iloc[te_i], (pp >= .5).astype(int)))
        aucs.append(roc_auc_score(y.iloc[te_i], pp))
    _line(f"metro-grouped 5-fold (episode {B})",
          float(np.mean(accs)), float(np.mean(aucs)),
          max(y.mean(), 1 - y.mean()), len(y), y.mean())
    print("  (a big drop from random -> grouped means the headline number leaks spatial signal)")


def spot_check(df, years):
    print("\n" + "=" * 78)
    print("5. LIVE SPOT-CHECK  (do today's high-score ZIPs actually outpace low ones since 2024?)")
    print("=" * 78)
    sb = 2024 if 2024 in years else max(b for b in years if (b + 1) in years)
    latest = max(years)
    if latest <= sb:
        print(f"  no post-{sb} data to check against yet")
        return
    # reproduce the production forecast: train at 2019, score features at sb
    tb = 2019 if (2019 + H) <= max(years) else sb - H
    _, Xt, yt = episode(df, tb)
    sc = df.dropna(subset=[f"zhvi_{sb}", f"zhvi_{latest}", "Metro"]).copy()
    sc = sc[sc[f"zhvi_{sb}"] > 0]
    Xs = M._features_at(sc, sb)
    sc["prob"] = M._pipe().fit(Xt, yt).predict_proba(Xs)[:, 1]
    sc["future"] = sc[f"zhvi_{latest}"] / sc[f"zhvi_{sb}"] - 1  # actual sb->latest
    sc = sc.dropna(subset=["future"])
    rho = sc["prob"].corr(sc["future"], method="spearman")
    print(f"  scored at {sb}, actual appreciation measured {sb}->{latest} (n={len(sc)})")
    print(f"  Spearman corr(score, actual {sb}->{latest} appreciation) = {rho:+.3f}")
    print("  (near 0 or negative = the score is NOT tracking what actually happened next)")
    sc["band"] = pd.qcut(sc["prob"], 5, labels=["Q1 low", "Q2", "Q3", "Q4", "Q5 high"],
                         duplicates="drop")
    print(f"\n  {'score quintile':<14}{'mean future appr':>20}{'n':>8}")
    for b, g in sc.groupby("band", observed=True):
        print(f"  {str(b):<14}{g['future'].mean():>19.1%}{len(g):>8}")
    print("  (healthy = Q5 high clearly outpaces Q1 low)")


def main():
    csv = sys.argv[1] if len(sys.argv) > 1 else "zhvi.csv"
    if not os.path.exists(csv):
        print(f"{csv} not found; downloading the latest Zillow ZHVI ZIP file ...")
        from download import download
        csv = download(csv)
    df, years = load_panel(csv)
    print(f"loaded {len(df):,} ZIPs, years {min(years)}-{max(years)}")
    out_of_time(df, years)
    calibration(df, years)
    spatial_leakage(df, years)
    spot_check(df, years)
    print("\ndone. Read sections 1, 3, and 5: those are the ones that reveal whether")
    print("the live scores are trustworthy or just a fitted-to-the-boom heuristic.")


if __name__ == "__main__":
    main()
