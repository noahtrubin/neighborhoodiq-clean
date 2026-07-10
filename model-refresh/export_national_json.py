"""Regenerate web/app-data/national_scores.json from the forward model.

This is the committed-bundle counterpart to main.py (which writes the same records
to Firestore). Run it whenever the model or the ZHVI vintage changes so the JSON
that ships with the app matches the live scores.

  python model-refresh/export_national_json.py [zhvi.csv]

Defaults to model-refresh/zhvi.csv. Writes the exact schema the Next.js app reads
(see web/app/lib/types.ts::ZipData): zip, city, state, metro, county, score, rank,
prob, appr5yr, momentum, pctileMetro, imputed — sorted by score desc.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from model import compute_scores  # noqa: E402

DEFAULT_CSV = os.path.join(HERE, "zhvi.csv")
OUT = os.path.join(HERE, "..", "web", "app-data", "national_scores.json")
META_OUT = os.path.join(HERE, "..", "web", "app-data", "national_scores.meta.json")
SERIES = os.path.join(HERE, "..", "web", "app-data", "zhvi_series.json")


def _align_display_to_series(records):
    """Make each record's display context (appr5yr, momentum) match the committed
    chart series exactly, so the page, the chart, and the AI chat never disagree.
    The model's SCORE is untouched — only the human-facing context numbers. Requires
    build_series.py to have run first; a no-op if the series bundle is absent."""
    if not os.path.exists(SERIES):
        print("NOTE: zhvi_series.json not found — run build_series.py first to align "
              "appr5yr/momentum to the chart. Leaving model-computed values.")
        return records
    zips = json.load(open(SERIES)).get("zips", {})
    aligned = 0
    for r in records:
        s = zips.get(r["zip"])
        if not s:
            continue
        ser = s.get("series") or []
        if len(ser) > 5 and ser[-1] and ser[-6]:
            r["appr5yr"] = round((ser[-1] / ser[-6] - 1) * 100, 1)  # clean 5yr, same as chart
        if s.get("yoy") is not None:
            r["momentum"] = s["yoy"]                                 # trailing-12mo, same as chart
        aligned += 1
    print(f"aligned appr5yr/momentum to the chart series for {aligned} ZIPs")
    return records


def main() -> None:
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    if not os.path.exists(csv_path):
        sys.exit(f"ZHVI csv not found: {csv_path}")
    print(f"loading {csv_path} ...")
    out = compute_scores(csv_path)
    recs, meta, metrics = out["records"], out["meta"], out["metrics"]
    recs = _align_display_to_series(recs)  # page/chart/chat show identical context numbers

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(recs, f, separators=(",", ":"))
    # a small sidecar with provenance + honest metrics (handy for the UI / debugging)
    with open(META_OUT, "w") as f:
        json.dump({"meta": meta, "metrics": metrics}, f, indent=2)

    size_mb = os.path.getsize(OUT) / 1e6
    print(f"wrote {OUT}  ({len(recs)} ZIPs, {size_mb:.1f} MB)")
    print(f"meta: {meta}")
    print(f"oot_auc={metrics.get('oot_auc')}  oot_auc_band={metrics.get('oot_auc_band')}  "
          f"metro_grouped_auc={metrics.get('metro_grouped_auc')}")
    print("top 8:", [f"{r['zip']} {r['city']},{r['state']} -> {r['score']}(rank {r['rank']})"
                     for r in recs[:8]])


if __name__ == "__main__":
    main()
