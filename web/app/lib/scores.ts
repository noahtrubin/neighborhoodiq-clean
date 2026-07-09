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
import type { ZipData } from "./types";

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
      if (d.exists) return d.data() as ZipData;
    } catch {
      /* fall through to bundle */
    }
  }
  return bundleIndex().get(zip) ?? null;
}

export async function getTopZips(n: number): Promise<ZipData[]> {
  if (await firestoreReady()) {
    try {
      const snap = await db()
        .collection("scores")
        .orderBy("score", "desc")
        .limit(n)
        .get();
      if (!snap.empty) return snap.docs.map((d) => d.data() as ZipData);
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
          .map((d) => d.data() as ZipData)
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
      const found = docs.filter((d) => d.exists).map((d) => d.data() as ZipData);
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
