// Server-side access to the national forward-forecast scores.
//
// Primary source: the `scores` Firestore collection, refreshed monthly by the
// model-refresh Cloud Run Job (see /model-refresh). Fallback: the JSON bundle
// committed at web/app-data/national_scores.json, which always ships with the
// app — so the app works locally and before the first refresh job run, and
// never breaks if Firestore is unreachable.
//
// Imported only by Server Components and route handlers — never the browser.

import { readFileSync } from "node:fs";
import path from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { SeriesBundle, ZipData } from "./types";

// ---- JSON bundle fallback (pre-sorted by score desc) -----------------------
let BUNDLE: ZipData[] | null = null;
let BUNDLE_INDEX: Map<string, ZipData> | null = null;
function bundle(): ZipData[] {
  if (!BUNDLE) {
    const p = path.join(process.cwd(), "app-data", "national_scores.json");
    BUNDLE = JSON.parse(readFileSync(p, "utf8")) as ZipData[];
    BUNDLE_INDEX = new Map(BUNDLE.map((z) => [z.zip, z]));
  }
  return BUNDLE;
}
function bundleIndex(): Map<string, ZipData> {
  bundle();
  return BUNDLE_INDEX!;
}

// ---- Home-value history (compact ZHVI series) ------------------------------
// Always served from the committed bundle (app-data/zhvi_series.json); there is
// no Firestore mirror for the time series.
type SeriesFile = {
  years: number[];
  national: (number | null)[];
  metros: Record<string, (number | null)[]>;
  zips: Record<
    string,
    { series: (number | null)[]; latest: number | null; asOf: string | null; yoy: number | null }
  >;
};
let SERIES: SeriesFile | null = null;
function seriesFile(): SeriesFile {
  if (!SERIES) {
    const p = path.join(process.cwd(), "app-data", "zhvi_series.json");
    SERIES = JSON.parse(readFileSync(p, "utf8")) as SeriesFile;
  }
  return SERIES;
}
export function getSeries(zip: string, metro?: string | null): SeriesBundle | null {
  let f: SeriesFile;
  try {
    f = seriesFile();
  } catch {
    return null; // artifact missing (e.g. not deployed) — degrade gracefully
  }
  const z = f.zips[zip];
  if (!z) return null;
  return {
    years: f.years,
    zip: z.series,
    metro: metro ? f.metros[metro] ?? null : null,
    national: f.national,
    latest: z.latest,
    asOf: z.asOf,
    yoy: z.yoy,
  };
}

// ---- Firestore (populated by the monthly refresh job) ----------------------
let DB: Firestore | null = null;
function db(): Firestore {
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  if (!DB) DB = getFirestore();
  return DB;
}

// Use Firestore only once the refresh job has populated it (meta/national
// exists). Cached for the process lifetime — fine because backends scale to
// zero, so new data is picked up by fresh instances.
let useFs: boolean | null = null;
async function firestoreReady(): Promise<boolean> {
  if (useFs !== null) return useFs;
  try {
    const meta = await db().collection("meta").doc("national").get();
    useFs = meta.exists;
  } catch {
    useFs = false; // no creds / unreachable -> fall back to the bundle
  }
  return useFs;
}

export async function getZip(zip: string): Promise<ZipData | null> {
  if (await firestoreReady()) {
    try {
      const d = await db().collection("scores").doc(zip).get();
      if (d.exists) return withBundle(d.data() as ZipData);
    } catch {
      /* fall through to bundle */
    }
  }
  return bundleIndex().get(zip) ?? null;
}

// The monthly Firestore refresh writes fresh scores but omits `rank` and
// `imputed`; the committed bundle carries the real per-ZIP national rank. Merge
// so the ranking-based UI (percentile, "Top X%") works on live data too.
//
// One exception: `appr5yr`/`momentum` are display context that MUST match the
// price chart, and the chart is always drawn from the committed series bundle
// (app-data/zhvi_series.json). Firestore computes those from annual spans, which
// disagree with the chart's monthly series. So take them from the aligned bundle
// (falling back to Firestore only if the bundle lacks them), while fresh
// score/prob still win. Keeps the page, chart, and chat showing the same numbers.
function withBundle(rec: ZipData): ZipData {
  const b = bundleIndex().get(rec.zip);
  if (!b) return rec;
  return {
    ...b,
    ...rec,
    appr5yr: b.appr5yr ?? rec.appr5yr,
    momentum: b.momentum ?? rec.momentum,
  };
}

export async function getTopZips(n: number): Promise<ZipData[]> {
  if (await firestoreReady()) {
    try {
      const snap = await db()
        .collection("scores")
        .orderBy("score", "desc")
        .limit(n)
        .get();
      if (!snap.empty) return snap.docs.map((d) => withBundle(d.data() as ZipData));
    } catch {
      /* fall through */
    }
  }
  return bundle().slice(0, n);
}

export async function getMetroPeers(zip: string, n = 6): Promise<ZipData[]> {
  const self = await getZip(zip);
  if (!self || !self.metro) return [];
  if (await firestoreReady()) {
    try {
      const snap = await db()
        .collection("scores")
        .where("metro", "==", self.metro)
        .orderBy("score", "desc")
        .limit(n + 1)
        .get();
      if (!snap.empty) {
        return snap.docs
          .map((d) => withBundle(d.data() as ZipData))
          .filter((z) => z.zip !== zip)
          .slice(0, n);
      }
    } catch {
      /* fall through */
    }
  }
  return bundle()
    .filter((p) => p.metro === self.metro && p.zip !== zip)
    .slice(0, n);
}

export async function getManyZips(zips: string[]): Promise<ZipData[]> {
  if (zips.length === 0) return [];
  if (await firestoreReady()) {
    try {
      const refs = zips.map((z) => db().collection("scores").doc(z));
      const docs = await db().getAll(...refs);
      const found = docs.filter((d) => d.exists).map((d) => withBundle(d.data() as ZipData));
      if (found.length) return found;
    } catch {
      /* fall through */
    }
  }
  const idx = bundleIndex();
  return zips
    .map((z) => idx.get(z))
    .filter((x): x is ZipData => Boolean(x));
}
