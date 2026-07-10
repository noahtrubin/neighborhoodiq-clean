"""Publish the COMMITTED national_scores bundle to production Firestore.

Reads exactly what the app ships (web/app-data/national_scores.json + its meta
sidecar) and upserts it to Firestore, so the live app and the committed bundle are
guaranteed identical — no recompute, no drift. Run export_national_json.py (and
build_series.py) first to regenerate the bundle.

  DRY (default):  python model-refresh/deploy_scores.py
  WRITE:          python model-refresh/deploy_scores.py --write   [PROJECT]

Env/arg PROJECT defaults to neighborhoodiq-cb9eb. Requires Firestore credentials
(gcloud application-default login, or GOOGLE_APPLICATION_CREDENTIALS).
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLE = os.path.join(HERE, "..", "web", "app-data", "national_scores.json")
META = os.path.join(HERE, "..", "web", "app-data", "national_scores.meta.json")
DEFAULT_PROJECT = "neighborhoodiq-cb9eb"


def main() -> None:
    write = "--write" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--write"]
    project = args[0] if args else os.environ.get("GOOGLE_CLOUD_PROJECT", DEFAULT_PROJECT)

    records = json.load(open(BUNDLE))
    side = json.load(open(META)) if os.path.exists(META) else {}
    meta, metrics = side.get("meta", {}), side.get("metrics", {})

    print(f"bundle: {len(records)} records  model={meta.get('model')}  "
          f"forecast={meta.get('forecast_window')}")
    print("top 5:", [f"{r['zip']} {r['city']},{r['state']} -> {r['score']}%" for r in records[:5]])
    print("sample at-risk:", [f"{r['zip']} {r['score']}%"
                              for r in sorted(records, key=lambda x: x['score'])[:5]])

    if not write:
        print("\nDRY RUN — no Firestore write. Add --write to publish.")
        return

    from firestore_writer import write_scores  # late import so DRY needs no creds
    print(f"\nWRITING {len(records)} docs to Firestore project {project} ...")
    write_scores(records, metrics, meta, project=project)
    print("DONE — live app now matches the committed bundle.")


if __name__ == "__main__":
    main()
