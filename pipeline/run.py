"""Orchestrator: run each source collector (resilient), then combine.

Usage:
  python -m pipeline.run                 # all sources, then combine
  python -m pipeline.run census zillow   # only these sources, then combine
  python -m pipeline.run --skip-redfin   # all but Redfin (the slow ~1.5 GB pull)
"""
from __future__ import annotations

import sys
import time

from . import config as C
from . import combine, fetch_boston_permits, fetch_census, fetch_redfin, fetch_zillow

STAGES = {
    "census": fetch_census.main,
    "zillow": fetch_zillow.main,
    "boston": fetch_boston_permits.main,
    "redfin": fetch_redfin.main,
}


def main(argv: list[str]) -> None:
    C.ensure_dirs()
    selected = [a for a in argv if not a.startswith("-")]
    skip = {a.lstrip("-").replace("skip-", "") for a in argv if a.startswith("-")}
    stages = selected or [s for s in STAGES if s not in skip]

    for name in stages:
        if name not in STAGES:
            print(f"[run] unknown stage '{name}', skipping")
            continue
        t0 = time.time()
        try:
            STAGES[name]()
            print(f"[run] {name} OK ({time.time() - t0:.1f}s)")
        except Exception as e:  # noqa: BLE001 - one source failing must not abort the rest
            print(f"[run] {name} FAILED: {e}")

    combine.main()


if __name__ == "__main__":
    main(sys.argv[1:])
