"""Entry point for the monthly model-refresh Cloud Run Job.

Flow: download latest Zillow ZHVI -> run the forward model -> bulk-write the
national scores + a meta doc to Firestore.

Env:
  GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT  Firestore project (auto-set on Cloud Run)
  TRAIN_BASE   (default 2019)  pinned training-episode base year
  SCORE_BASE   (default: latest data year)  forecast base year
  DRY_RUN      if set, compute + print but do NOT write Firestore
"""
from __future__ import annotations

import os
import tempfile

from download import download
from model import compute_scores


def main() -> None:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT")
    # default: train on the most recent complete episode (score_base - HORIZON) and
    # forecast from the LATEST available data year. Set TRAIN_BASE/SCORE_BASE to pin.
    _tb = os.environ.get("TRAIN_BASE")
    train_base = int(_tb) if _tb else None
    _sb = os.environ.get("SCORE_BASE")
    score_base = int(_sb) if _sb else None
    dry_run = bool(os.environ.get("DRY_RUN"))

    with tempfile.TemporaryDirectory() as tmp:
        csv_path = download(os.path.join(tmp, "zhvi.csv"))
        out = compute_scores(csv_path, train_base=train_base, score_base=score_base)

    print(f"model: {out['meta']}  metrics: {out['metrics']}")
    print(f"top: {[ (r['zip'], r['city'], r['score']) for r in out['records'][:5] ]}")

    if dry_run:
        print("DRY_RUN set — skipping Firestore write")
        return

    from firestore_writer import write_scores  # imported late so DRY_RUN needs no creds
    # Note: records carry model-computed appr5yr/momentum (annual spans). The web
    # layer intentionally sources those two display fields from the committed,
    # chart-aligned bundle (see web/app/lib/scores.ts::withBundle), so they stay
    # consistent with the price chart regardless of what Firestore holds.
    write_scores(out["records"], out["metrics"], out["meta"], project=project)
    print("refresh complete")


if __name__ == "__main__":
    main()
