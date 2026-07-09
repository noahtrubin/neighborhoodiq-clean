"""Write score records to Firestore using BulkWriter (best practice for >500
writes; WriteBatch caps at 500/commit). Non-atomic, idempotent upserts — safe
to re-run. The Admin/server SDK bypasses security rules, so 'scores' can stay
locked to clients.

Collections:
  scores/{zip}        -> one doc per ZIP (the ZipData record)
  meta/national       -> last-refresh metrics + window + timestamp
"""
from __future__ import annotations

from google.cloud import firestore


def write_scores(records: list[dict], metrics: dict, meta: dict,
                 project: str | None = None) -> None:
    db = firestore.Client(project=project)

    col = db.collection("scores")
    bw = db.bulk_writer()
    errors: list[str] = []

    # The SDK calls this with (BulkWriteFailure, BulkWriter) — both params are
    # required or it raises TypeError inside the worker and silently drops writes.
    # Bound retries on attempts so a PERMANENT error gives up instead of looping.
    def _on_error(err, _bw) -> bool:
        errors.append(str(err))
        return err.attempts < 5

    bw.on_write_error(_on_error)
    for rec in records:
        bw.set(col.document(rec["zip"]), rec)  # enqueue; do not block per-write
    bw.close()  # flush + wait for all enqueued writes

    db.collection("meta").document("national").set({
        **meta,
        "metrics": metrics,
        "count": len(records),
        "refreshedAt": firestore.SERVER_TIMESTAMP,
    })

    if errors:
        print(f"WARNING: {len(errors)} write errors (first: {errors[0]})")
    print(f"wrote {len(records)} score docs + meta/national to project "
          f"{project or '(default)'}")
