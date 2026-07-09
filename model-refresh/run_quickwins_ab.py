"""Do net migration + jobs growth ADD to the proposed model (cheap-vs-nbr + migration)?
Reports individual lift over cheapness, and absolute OOT AUC: proposed vs proposed+quickwins.
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_lab import evaluate_feature, load_df  # noqa: E402

COUNTY = "/Users/noahrubin/neighborhoodiq/data/raw/county_panel.csv"
NBR = "/Users/noahrubin/neighborhoodiq/data/raw/neighbor_panel.csv"
QW = "/Users/noahrubin/neighborhoodiq/data/raw/quickwins_panel.csv"


def main():
    df = load_df()
    c = pd.read_csv(COUNTY, dtype={"zip": str}).sort_values(["zip", "year"])
    c["zip"] = c["zip"].str.zfill(5)
    c["inflow_growth2"] = c.groupby("zip")["inflow_returns"].pct_change(2)
    n = pd.read_csv(NBR, dtype={"zip": str}); n["zip"] = n["zip"].str.zfill(5)
    q = pd.read_csv(QW, dtype={"zip": str}).sort_values(["zip", "year"])
    q["zip"] = q["zip"].str.zfill(5)
    q["emp_growth2"] = q.groupby("zip")["emp"].pct_change(2)

    panel = (c[["zip", "year", "agi_per_inmover", "inflow_growth2"]]
             .merge(n[["zip", "year", "price_vs_nbr"]], on=["zip", "year"], how="outer")
             .merge(q[["zip", "year", "net_rate", "emp_growth2"]], on=["zip", "year"], how="outer"))

    # individual lift over cheapness
    for cols, lbl in [(["net_rate"], "net migration rate"),
                      (["emp_growth2"], "jobs growth (CBP emp, 2yr)")]:
        r = evaluate_feature(df, panel, "zip", cols, label=lbl)
        rr = r[r["base_year"].between(2017, 2021)]
        print(f"  >> {lbl}: recent lift over cheapness = {rr['delta'].mean():+.4f}")

    # absolute AUC: proposed vs proposed + quickwins
    proposed = ["price_vs_nbr", "agi_per_inmover", "inflow_growth2"]
    full = proposed + ["net_rate", "emp_growth2"]
    rp = evaluate_feature(df, panel, "zip", proposed, label="PROPOSED (cheap-nbr+migration)")
    rf = evaluate_feature(df, panel, "zip", full, label="PROPOSED + net migration + jobs")
    m = rp.merge(rf, on="base_year", suffixes=("_p", "_f"))
    m = m[m["base_year"].between(2017, 2021)]
    print(f"\n  {'test base':>10} {'proposed AUC':>13} {'+quickwins AUC':>15} {'gain':>8}")
    for _, r in m.iterrows():
        print(f"  {int(r['base_year']):>10} {r['auc_aug_p']:>13.4f} {r['auc_aug_f']:>15.4f} "
              f"{r['auc_aug_f']-r['auc_aug_p']:>+8.4f}")
    print(f"  {'AVG':>10} {m['auc_aug_p'].mean():>13.4f} {m['auc_aug_f'].mean():>15.4f} "
          f"{(m['auc_aug_f']-m['auc_aug_p']).mean():>+8.4f}")


if __name__ == "__main__":
    main()
