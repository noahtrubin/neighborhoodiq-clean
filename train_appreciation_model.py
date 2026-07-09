"""Predict which MA ZIPs appreciate >=60% over 2019->2024 (ZHVI), with a
Random Forest. Trains on data/ma_master.csv, tests on data/ma_holdout.csv.

Two models, side by side:
  A) FORECAST (leakage-free): features known by end-2019 only -> honest.
  B) ASSOCIATION (all sources): adds current Census/Redfin/Boston signals,
     EXCLUDING direct 2024 price endpoints. Richer importances, but the
     features post-date the growth, so it is associational, not a true forecast.

Target window chosen as 2019->2024 because >=60% over 2010->2024 / 2014->2024 is
degenerate (95-97% positive) and unlearnable.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline

BASE, TARGET, THRESH, SEED = 2019, 2024, 0.60, 42

CITY = {
    "01901": "Lynn", "01902": "Lynn", "01904": "Lynn", "01905": "Lynn",
    "02143": "Somerville", "02144": "Somerville", "02145": "Somerville",
    "02149": "Everett", "02150": "Chelsea",
    "02740": "New Bedford", "02744": "New Bedford", "02745": "New Bedford",
}

EARLY_ZHVI = [f"zhvi_{y}" for y in range(2010, BASE + 1)]  # 2010..2019 (known at forecast time)
MOMENTUM = ["g_2010_2019", "g_2015_2019", "g_2017_2019", "g_2018_2019"]

FEATURES_A = EARLY_ZHVI + MOMENTUM
# B adds current signals but EXCLUDES direct 2024 price endpoints
# (zhvi_2020..2024, median_home_value, redfin sale/list price) to avoid
# arithmetically reconstructing the zhvi_2024/zhvi_2019 ratio.
FEATURES_B = EARLY_ZHVI + MOMENTUM + [
    "median_household_income", "median_age", "total_population",
    "median_gross_rent", "bachelors_degree_count",
    "redfin_homes_sold", "redfin_median_dom", "boston_permit_count",
]


def prep(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["growth"] = df[f"zhvi_{TARGET}"] / df[f"zhvi_{BASE}"] - 1
    df["target"] = (df["growth"] >= THRESH).astype("float")  # NaN where growth undefined
    df.loc[df["growth"].isna(), "target"] = np.nan
    df["g_2010_2019"] = df["zhvi_2019"] / df["zhvi_2010"] - 1
    df["g_2015_2019"] = df["zhvi_2019"] / df["zhvi_2015"] - 1
    df["g_2017_2019"] = df["zhvi_2019"] / df["zhvi_2017"] - 1
    df["g_2018_2019"] = df["zhvi_2019"] / df["zhvi_2018"] - 1
    return df


def build_pipe() -> Pipeline:
    return Pipeline([
        ("imp", SimpleImputer(strategy="median")),
        ("rf", RandomForestClassifier(n_estimators=400, class_weight="balanced",
                                      min_samples_leaf=2, random_state=SEED, n_jobs=-1)),
    ])


def run(name: str, feats: list[str], train: pd.DataFrame, hold: pd.DataFrame) -> pd.DataFrame:
    tr = train.dropna(subset=["target"])
    Xtr, ytr = tr[feats], tr["target"].astype(int)
    ho = hold.dropna(subset=["target"])
    Xho, yho = ho[feats], ho["target"].astype(int)

    pipe = build_pipe()
    cv = StratifiedKFold(5, shuffle=True, random_state=SEED)
    cv_acc = cross_val_score(pipe, Xtr, ytr, cv=cv, scoring="accuracy").mean()
    cv_auc = cross_val_score(pipe, Xtr, ytr, cv=cv, scoring="roc_auc").mean()

    pipe.fit(Xtr, ytr)
    pred = pipe.predict(Xho)
    prob = pipe.predict_proba(Xho)[:, 1]

    acc = accuracy_score(yho, pred)
    baseline = max(yho.mean(), 1 - yho.mean())  # always-predict-majority
    auc = roc_auc_score(yho, prob) if yho.nunique() > 1 else float("nan")

    print(f"\n{'='*70}\n  MODEL {name}   features={len(feats)}   train n={len(tr)}\n{'='*70}")
    print(f"  Train 5-fold CV:   accuracy={cv_acc:.3f}   ROC-AUC={cv_auc:.3f}")
    print(f"  HOLDOUT (n={len(ho)}):   accuracy={acc:.3f}   "
          f"(majority baseline={baseline:.3f})   ROC-AUC={auc:.3f}")
    print(f"  HOLDOUT precision={precision_score(yho,pred,zero_division=0):.3f}  "
          f"recall={recall_score(yho,pred,zero_division=0):.3f}  "
          f"F1={f1_score(yho,pred,zero_division=0):.3f}")
    tn, fp, fn, tp = confusion_matrix(yho, pred, labels=[0, 1]).ravel()
    print(f"  HOLDOUT confusion: TP={tp} FP={fp} FN={fn} TN={tn}")

    imp = pd.Series(pipe.named_steps["rf"].feature_importances_, index=feats).sort_values(ascending=False)
    print("  Top feature importances:")
    for f, v in imp.head(12).items():
        print(f"     {v:6.3f}  {f}")

    out = ho[["zip"]].copy()
    out["city"] = out["zip"].map(CITY)
    out[f"actual_growth_{BASE}_{TARGET}_%"] = (ho["growth"] * 100).round(0).values
    out[f"actual_appreciated_{int(THRESH*100)}pct"] = yho.values
    out[f"pred_{name}"] = pred
    out[f"prob_{name}"] = prob.round(3)
    out[f"correct_{name}"] = (pred == yho.values)
    return out


def main() -> None:
    train = prep(pd.read_csv("data/ma_master.csv", dtype={"zip": str}))
    hold = prep(pd.read_csv("data/ma_holdout.csv", dtype={"zip": str}))

    tr_rate = train["target"].dropna().mean()
    print(f"Target: ZHVI grew >= {int(THRESH*100)}% over {BASE}->{TARGET}")
    print(f"Training base rate (positive): {tr_rate:.1%} of {int(train['target'].notna().sum())} ZIPs")

    a = run("A_forecast", FEATURES_A, train, hold)
    b = run("B_association", FEATURES_B, train, hold)

    merged = a.merge(b[["zip", "pred_B_association", "prob_B_association", "correct_B_association"]], on="zip")
    merged = merged.sort_values(f"actual_growth_{BASE}_{TARGET}_%", ascending=False)

    print(f"\n{'='*70}\n  HOLDOUT — per-ZIP predictions (sorted by actual growth)\n{'='*70}")
    cols = ["zip", "city", f"actual_growth_{BASE}_{TARGET}_%",
            f"actual_appreciated_{int(THRESH*100)}pct",
            "pred_A_forecast", "prob_A_forecast", "correct_A_forecast",
            "pred_B_association", "prob_B_association", "correct_B_association"]
    print(merged[cols].to_string(index=False))

    merged.to_csv("data/holdout_predictions.csv", index=False)
    print("\nSaved per-ZIP predictions -> data/holdout_predictions.csv")


if __name__ == "__main__":
    main()
