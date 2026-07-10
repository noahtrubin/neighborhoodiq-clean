"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Plain <a> for the in-hero links (not next/link): this is a client component,
// and next/link inside it trips a Turbopack RSC-manifest bug in Next 16.2.9
// ("Could not find module .../link.js# in the React Client Manifest"). The
// sibling GlobeHero.tsx uses <a> for the same reason. Full navigations are fine
// for these off-the-landing marketing links.
import {
  geoOrthographic,
  geoPath,
  geoGraticule10,
  geoBounds,
  type GeoProjection,
} from "d3-geo";
import { Delaunay } from "d3-delaunay";
import { feature as topoFeature, mesh as topoMesh } from "topojson-client";
import type { Topology, Objects } from "topojson-specification";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import Logo from "./Logo";

/**
 * GlobeLandingHero — the landing hero merged with the scroll-driven globe.
 *
 * At the top of the scroll it reads as a normal hero: nav, headline, a ZIP
 * search box and metro chips, all floating over a slowly rotating halftone
 * globe. As the visitor scrolls through the pinned scene the hero copy fades
 * out, the globe eases to face North America and zooms in, and the abstract
 * land dots cross-fade into ~20,000 real U.S. ZIP codes, each colored by its
 * NeighborhoodIQ appreciation score.
 *
 * On top of that scroll narrative it also supports FLYING TO A CITY: clicking a
 * metro chip, a city in the on-map rail, or a city label on the globe eases the
 * globe to that metro and zooms to street level, where every ZIP dot is
 * clickable (→ /dashboard?zip=). A "Back" control returns to the U.S. map. The
 * city fly-to is an animated blend (S.f) layered on top of the scroll state, so
 * the two never fight; page scroll is locked while a city is focused.
 *
 * This is intentionally self-contained: it carries its own copy of the globe
 * canvas/scroll engine (adapted from ./GlobeHero.tsx) and all of its styles are
 * scoped under `.lgh`, so it can't collide with globals.css or the other
 * landing components. Wire it in by rendering <GlobeLandingHero /> from a page.
 *
 * Data (bundled, fetched at runtime so first paint stays light):
 *   /geo/land-110m.json  — Natural Earth land polygons (coastlines + halftone)
 *   /geo/zip-points.json — [lng, lat, score, zip, "City, ST"][]
 */

// ----- tunables -------------------------------------------------------------
const SCENE_VH = 320; // total scroll length of the pinned scene
const US_CENTER: [number, number] = [-98.5, 39.5];
const US_ROTATE: [number, number] = [-US_CENTER[0], -US_CENTER[1]]; // [98.5, -39.5]
const START_TILT = -14; // initial latitude tilt of the globe
const SPIN_DEG_PER_SEC = 6; // idle auto-rotation

// Framing spans (degrees across) per zoom level, plus animation timing. A city
// frames tight (street/metro); a state frames its whole bounding box.
const CITY_SPAN_LNG = 3.6;
const CITY_SPAN_LAT = 2.4;
const FLY_SECONDS = 1.15;
// Fraction of the viewport the framed region fills (leaves a margin of ocean).
const CITY_FILL_W = 0.9,
  CITY_FILL_H = 0.8;
const STATE_FILL_W = 0.82,
  STATE_FILL_H = 0.74;
// Time constant for easing the *displayed* focus toward a new target when you
// re-target while already zoomed in (state→city drill, city→city hop).
const RETARGET_TAU = 0.26;

// Per-ZIP borders. Zoomed into a state we draw REAL Census ZCTA polygons,
// simplified and split per state under public/geo/zcta/ (~8MB total, one file
// lazy-loaded per state on first visit — see that folder's README to
// regenerate). Until a state's file lands (or if it fails, or on the free-zoom
// U.S. map with no state focus) we fall back to tessellating the visible ZIP
// centroids into Voronoi cells. Either way, boundaries cross-fade in as the
// view narrows (measured in degrees of longitude across the viewport).
const ZIP_BORDER_FADE_HI = 6.5; // deg across: cells start appearing below this
const ZIP_BORDER_FADE_LO = 2.5; // deg across: cells fully in below this
const ZIP_CELL_MAXPTS = 5000; // don't tessellate more points than this
const ZIP_CELL_MAX_AREA_FRAC = 0.05; // skip sprawling edge cells above this area

// How far the user can free-zoom relative to a place's framed view (wheel /
// pinch / drag / ±). ZOOM_MIN < 1 lets you pull back a little past the frame so
// the "−" control (and zoom-out gestures) always do something at the frame.
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 16;

// A place the globe can fly to. `kind` drives the overlay copy + drill behavior;
// span/fill drive how tightly it frames; `stateAbbr` links a city to its parent
// state (for the Back button) or holds a state's own abbreviation.
type Place = {
  kind: "state" | "city";
  name: string;
  lng: number;
  lat: number;
  lngSpan: number;
  latSpan: number;
  fillW: number;
  fillH: number;
  zip?: string;
  stateAbbr?: string;
};

type City = { name: string; lng: number; lat: number; zip: string; state: string };
function cityPlace(c: City): Place {
  return {
    kind: "city",
    name: c.name,
    lng: c.lng,
    lat: c.lat,
    lngSpan: CITY_SPAN_LNG,
    latSpan: CITY_SPAN_LAT,
    fillW: CITY_FILL_W,
    fillH: CITY_FILL_H,
    zip: c.zip,
    stateAbbr: c.state,
  };
}

// Metro chips in the hero — quick "zoom straight to this city" shortcuts.
const METROS: City[] = [
  { name: "Boston", lng: -71.06, lat: 42.36, zip: "02127", state: "MA" },
  { name: "Austin", lng: -97.74, lat: 30.27, zip: "78704", state: "TX" },
  { name: "Chicago", lng: -87.63, lat: 41.88, zip: "60647", state: "IL" },
  { name: "Brooklyn", lng: -73.95, lat: 40.65, zip: "11216", state: "NY" },
];

// Cities aren't hand-picked — they're derived at runtime from the ZIP dataset
// (every ZIP carries a "City, ST" label), so *any* city is zoomable. These tune
// how many surface per state and how a city is framed from its own ZIP spread.
const RAIL_PER_STATE = 12; // cities listed in a focused state's rail
const LABELS_PER_STATE = 8; // cities labeled on the globe at state zoom
const CITY_PAD = 1.6; // pad a city's ZIP bounding box before framing it
const CITY_MIN_LNG = 0.35,
  CITY_MIN_LAT = 0.28; // floor, so a one-ZIP town doesn't zoom to the moon
const CITY_MAX_LNG = 4.5,
  CITY_MAX_LAT = 3.4; // ceiling, so a sprawling metro still reads as a city

// Score → color ramp, tuned for a dark backdrop.
const TIER_COLORS = [
  "#39506f", // 0  dim slate  (the quiet majority)
  "#3f6ba6", // 1  blue
  "#2f95cf", // 2  sky
  "#1fbca9", // 3  teal
  "#40d385", // 4  emerald
  "#b6e63a", // 5  lime      (top signal — drawn additively so it glows)
];
function tierOf(score: number): number {
  if (score >= 42) return 5;
  if (score >= 37) return 4;
  if (score >= 30) return 3;
  if (score >= 24) return 2;
  if (score >= 18) return 1;
  return 0;
}

// All 50 states, each framed by an approximate bounding box
// [minLng, minLat, maxLng, maxLat]. Center + span are derived from the box.
// Drawn as clickable abbreviations on the resolved U.S. map; picking one flies
// the globe to frame that state and reveals the metros inside it.
const STATE_BOXES: { name: string; abbr: string; box: [number, number, number, number] }[] = [
  { name: "Alabama", abbr: "AL", box: [-88.5, 30.2, -84.9, 35.0] },
  { name: "Alaska", abbr: "AK", box: [-170.0, 54.0, -130.0, 71.5] },
  { name: "Arizona", abbr: "AZ", box: [-114.8, 31.3, -109.0, 37.0] },
  { name: "Arkansas", abbr: "AR", box: [-94.6, 33.0, -89.6, 36.5] },
  { name: "California", abbr: "CA", box: [-124.4, 32.5, -114.1, 42.0] },
  { name: "Colorado", abbr: "CO", box: [-109.06, 37.0, -102.04, 41.0] },
  { name: "Connecticut", abbr: "CT", box: [-73.7, 40.98, -71.8, 42.05] },
  { name: "Delaware", abbr: "DE", box: [-75.8, 38.45, -75.05, 39.84] },
  { name: "Florida", abbr: "FL", box: [-87.6, 24.5, -80.0, 31.0] },
  { name: "Georgia", abbr: "GA", box: [-85.6, 30.4, -80.8, 35.0] },
  { name: "Hawaii", abbr: "HI", box: [-160.3, 18.9, -154.8, 22.3] },
  { name: "Idaho", abbr: "ID", box: [-117.2, 42.0, -111.0, 49.0] },
  { name: "Illinois", abbr: "IL", box: [-91.5, 37.0, -87.0, 42.5] },
  { name: "Indiana", abbr: "IN", box: [-88.1, 37.8, -84.8, 41.8] },
  { name: "Iowa", abbr: "IA", box: [-96.6, 40.4, -90.1, 43.5] },
  { name: "Kansas", abbr: "KS", box: [-102.05, 37.0, -94.6, 40.0] },
  { name: "Kentucky", abbr: "KY", box: [-89.6, 36.5, -81.9, 39.15] },
  { name: "Louisiana", abbr: "LA", box: [-94.05, 28.9, -88.8, 33.0] },
  { name: "Maine", abbr: "ME", box: [-71.1, 43.0, -66.9, 47.5] },
  { name: "Maryland", abbr: "MD", box: [-79.5, 37.9, -75.0, 39.7] },
  { name: "Massachusetts", abbr: "MA", box: [-73.5, 41.2, -69.9, 42.9] },
  { name: "Michigan", abbr: "MI", box: [-90.4, 41.7, -82.4, 48.3] },
  { name: "Minnesota", abbr: "MN", box: [-97.2, 43.5, -89.5, 49.4] },
  { name: "Mississippi", abbr: "MS", box: [-91.7, 30.2, -88.1, 35.0] },
  { name: "Missouri", abbr: "MO", box: [-95.8, 36.0, -89.1, 40.6] },
  { name: "Montana", abbr: "MT", box: [-116.05, 44.4, -104.04, 49.0] },
  { name: "Nebraska", abbr: "NE", box: [-104.05, 40.0, -95.3, 43.0] },
  { name: "Nevada", abbr: "NV", box: [-120.0, 35.0, -114.04, 42.0] },
  { name: "New Hampshire", abbr: "NH", box: [-72.6, 42.7, -70.6, 45.3] },
  { name: "New Jersey", abbr: "NJ", box: [-75.6, 38.9, -73.9, 41.4] },
  { name: "New Mexico", abbr: "NM", box: [-109.05, 31.3, -103.0, 37.0] },
  { name: "New York", abbr: "NY", box: [-79.8, 40.5, -71.85, 45.0] },
  { name: "North Carolina", abbr: "NC", box: [-84.3, 33.8, -75.4, 36.6] },
  { name: "North Dakota", abbr: "ND", box: [-104.05, 45.9, -96.55, 49.0] },
  { name: "Ohio", abbr: "OH", box: [-84.8, 38.4, -80.5, 42.0] },
  { name: "Oklahoma", abbr: "OK", box: [-103.0, 33.6, -94.4, 37.0] },
  { name: "Oregon", abbr: "OR", box: [-124.6, 42.0, -116.5, 46.3] },
  { name: "Pennsylvania", abbr: "PA", box: [-80.5, 39.7, -74.7, 42.3] },
  { name: "Rhode Island", abbr: "RI", box: [-71.9, 41.15, -71.1, 42.02] },
  { name: "South Carolina", abbr: "SC", box: [-83.4, 32.0, -78.5, 35.2] },
  { name: "South Dakota", abbr: "SD", box: [-104.06, 42.5, -96.4, 45.95] },
  { name: "Tennessee", abbr: "TN", box: [-90.3, 35.0, -81.6, 36.7] },
  { name: "Texas", abbr: "TX", box: [-106.65, 25.8, -93.5, 36.5] },
  { name: "Utah", abbr: "UT", box: [-114.05, 37.0, -109.04, 42.0] },
  { name: "Vermont", abbr: "VT", box: [-73.44, 42.7, -71.5, 45.02] },
  { name: "Virginia", abbr: "VA", box: [-83.7, 36.5, -75.2, 39.5] },
  { name: "Washington", abbr: "WA", box: [-124.8, 45.5, -116.9, 49.0] },
  { name: "West Virginia", abbr: "WV", box: [-82.65, 37.2, -77.7, 40.65] },
  { name: "Wisconsin", abbr: "WI", box: [-92.9, 42.5, -86.8, 47.1] },
  { name: "Wyoming", abbr: "WY", box: [-111.06, 41.0, -104.05, 45.0] },
];
const STATES: Place[] = STATE_BOXES.map((s) => {
  const [minLng, minLat, maxLng, maxLat] = s.box;
  return {
    kind: "state",
    name: s.name,
    stateAbbr: s.abbr,
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2,
    lngSpan: Math.max(1.4, maxLng - minLng),
    latSpan: Math.max(1.4, maxLat - minLat),
    fillW: STATE_FILL_W,
    fillH: STATE_FILL_H,
  };
});
const STATE_BY_ABBR: Record<string, Place> = Object.fromEntries(
  STATES.map((s) => [s.stateAbbr as string, s]),
);

// ----- small math helpers ---------------------------------------------------
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
// shortest signed angular delta a→b, in degrees (-180, 180]
function angDelta(a: number, b: number) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

// ----- world halftone dots (point-in-polygon on the land geojson) -----------
function pointInRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function pointInFeature(x: number, y: number, geom: any): boolean {
  const polys =
    geom.type === "Polygon"
      ? [geom.coordinates]
      : geom.type === "MultiPolygon"
        ? geom.coordinates
        : [];
  for (const poly of polys) {
    if (pointInRing(x, y, poly[0])) {
      let hole = false;
      for (let i = 1; i < poly.length; i++)
        if (pointInRing(x, y, poly[i])) {
          hole = true;
          break;
        }
      if (!hole) return true;
    }
  }
  return false;
}
function buildWorldDots(land: any, step = 1.35): [number, number][] {
  const dots: [number, number][] = [];
  for (const f of land.features) {
    const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(f);
    for (let lng = minLng; lng <= maxLng; lng += step)
      for (let lat = minLat; lat <= maxLat; lat += step)
        if (pointInFeature(lng, lat, f.geometry)) dots.push([lng, lat]);
  }
  return dots;
}

type ZipData = {
  lng: Float32Array;
  lat: Float32Array;
  tier: Uint8Array;
  score: Uint8Array;
  zip: string[];
  place: string[];
  n: number;
};

type Hover = { x: number; y: number; zip: string; place: string; score: number } | null;

// Group the loaded ZIPs into cities by their "City, ST" label, framing each city
// by the bounding box of its own ZIPs and picking its highest-scoring ZIP as the
// representative. Returns the top cities per state (most ZIPs first) for the
// rails/labels, plus a full label→Place lookup so a click on ANY ZIP dot can
// zoom to its city (not just the top-rail ones).
function buildCityIndex(z: ZipData): {
  byState: Record<string, Place[]>;
  byLabel: Map<string, Place>;
} {
  type Acc = {
    name: string;
    st: string;
    n: number;
    sLng: number;
    sLat: number;
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
    bestScore: number;
    bestZip: string;
  };
  const acc = new Map<string, Acc>();
  for (let i = 0; i < z.n; i++) {
    const place = z.place[i];
    const ci = place.lastIndexOf(", ");
    if (ci < 1) continue;
    const st = place.slice(ci + 2);
    if (st.length !== 2 || !STATE_BY_ABBR[st]) continue; // skip multi-state rollups
    const lng = z.lng[i],
      lat = z.lat[i],
      score = z.score[i],
      zip = z.zip[i];
    let a = acc.get(place);
    if (!a) {
      a = {
        name: place.slice(0, ci),
        st,
        n: 0,
        sLng: 0,
        sLat: 0,
        minLng: Infinity,
        minLat: Infinity,
        maxLng: -Infinity,
        maxLat: -Infinity,
        bestScore: -1,
        bestZip: zip,
      };
      acc.set(place, a);
    }
    a.n++;
    a.sLng += lng;
    a.sLat += lat;
    if (lng < a.minLng) a.minLng = lng;
    if (lng > a.maxLng) a.maxLng = lng;
    if (lat < a.minLat) a.minLat = lat;
    if (lat > a.maxLat) a.maxLat = lat;
    if (score > a.bestScore) {
      a.bestScore = score;
      a.bestZip = zip;
    }
  }
  const byStateAll: Record<string, { place: Place; n: number }[]> = {};
  const byLabel = new Map<string, Place>();
  for (const [label, a] of acc) {
    const lngSpan = clamp((a.maxLng - a.minLng) * CITY_PAD, CITY_MIN_LNG, CITY_MAX_LNG);
    const latSpan = clamp((a.maxLat - a.minLat) * CITY_PAD, CITY_MIN_LAT, CITY_MAX_LAT);
    const place: Place = {
      kind: "city",
      name: a.name,
      lng: a.sLng / a.n,
      lat: a.sLat / a.n,
      lngSpan,
      latSpan,
      fillW: CITY_FILL_W,
      fillH: CITY_FILL_H,
      zip: a.bestZip,
      stateAbbr: a.st,
    };
    byLabel.set(label, place);
    (byStateAll[a.st] ??= []).push({ place, n: a.n });
  }
  const byState: Record<string, Place[]> = {};
  for (const st of Object.keys(byStateAll)) {
    byState[st] = byStateAll[st]
      .sort((x, y) => y.n - x.n)
      .slice(0, RAIL_PER_STATE)
      .map((e) => e.place);
  }
  return { byState, byLabel };
}

// A horizontal, scrollable rail of metros. Rendered inside a focused state (to
// drill into its cities) and inside a focused city (to hop between siblings).
function CityRail({
  cities,
  activeName,
  onPick,
}: {
  cities: Place[];
  activeName?: string;
  onPick: (c: Place) => void;
}) {
  return (
    <div className="lgh-rail" role="group" aria-label="Jump to a city">
      {cities.map((c) => (
        <button
          key={c.name}
          type="button"
          className="lgh-railbtn"
          data-active={c.name === activeName ? "true" : undefined}
          onClick={() => onPick(c)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

// The full "jump to a state" rail, shown on the resolved U.S. map. All 50
// states, scrollable; picking one flies the globe to frame that state.
function StateRail({ onPick }: { onPick: (s: Place) => void }) {
  return (
    <div className="lgh-rail" role="group" aria-label="Jump to a state">
      {STATES.map((s) => (
        <button
          key={s.stateAbbr}
          type="button"
          className="lgh-railbtn"
          onClick={() => onPick(s)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

export default function GlobeLandingHero() {
  const router = useRouter();
  // Read the router through a ref inside the canvas effect so the effect can
  // keep []-deps and never tear down / recreate the engine on re-render.
  const routerRef = useRef(router);
  routerRef.current = router;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    flyTo: (p: Place) => void;
    flyHome: () => void;
    zoomBy: (g: number) => void;
  } | null>(null);
  // Cities derived from the ZIP data (see buildCityIndex), keyed by state abbr.
  // Lives in a ref so the canvas engine can read it; `indexReady` flips once it's
  // built so the React overlays (rails) re-render and pick it up.
  const cityIndexRef = useRef<Record<string, Place[]>>({});
  const [indexReady, setIndexReady] = useState(false);
  const [progress, setProgress] = useState(0); // scroll t 0..1, mirrored for overlays
  const [focusProg, setFocusProg] = useState(0); // focus f 0..1, mirrored for overlays
  const [focusPlace, setFocusPlace] = useState<Place | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [zipError, setZipError] = useState(false);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const sceneEl = sceneRef.current;
    if (!canvasEl || !sceneEl) return;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    // Bind to explicitly non-null consts so the narrowing survives into the
    // nested closures below (layout/render/updateProgress).
    const canvas: HTMLCanvasElement = canvasEl;
    const scene: HTMLDivElement = sceneEl;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // mutable render state (kept in a closure object to avoid re-creating rAF)
    const S = {
      w: 0,
      h: 0,
      dpr: 1,
      R: 300,
      usScale: 900,
      t: 0,
      f: 0, // current focus progress (0 = U.S. map, 1 = fully focused)
      fTarget: 0, // where f is heading
      mirroredF: 0, // last f value pushed to React
      // `focus` is the destination place (+ its framing scale); `focusView` is
      // the currently-displayed focus, eased toward `focus` for smooth re-target.
      focus: null as (Place & { scale: number }) | null,
      focusView: null as { lng: number; lat: number; scale: number } | null,
      // free zoom/pan the user layers on top of the focus (wheel + pinch + ±).
      // uz is a scale multiplier; ux/uy shift the view in screen px. Reset on
      // every fly so each place starts framed.
      uz: 1,
      ux: 0,
      uy: 0,
      autoLng: reduced ? 70 : 20,
      hoverPt: null as Hover,
      hoverIdx: -1, // index of the hovered ZIP (to light up its Voronoi cell)
      dirty: true,
      last: 0,
    };

    let land: any = null;
    // Crisp U.S. layer (Census/us-atlas states): a clean national outline + real
    // interior state borders, drawn on top of the coarse world coastline as the
    // view zooms into the country so the U.S. reads sharply instead of blobby.
    let usNation: Feature | null = null;
    let usBorders: Geometry | null = null;
    let worldDots: [number, number][] = [];
    let zips: ZipData | null = null;
    let cityIndex: Record<string, Place[]> = {}; // derived cities, by state abbr
    let cityByLabel: Map<string, Place> = new Map(); // every city, by "City, ST"
    let idxByZip: Map<string, number> | null = null; // ZIP code → dataset index

    // Real ZCTA boundary polygons (Census cb_2020 500k, simplified + split per
    // state; see public/geo/zcta/). Lazy-loaded the first time the user flies
    // into a state. While a file is in flight — or if it fails — the Voronoi
    // cells below stay on as the fallback, so borders are never just blank.
    type ZctaFeat = { f: Feature; zip: string; bbox: [number, number, number, number] };
    const zctaCache = new Map<string, ZctaFeat[] | "loading" | "failed">();
    function geomBBox(g: Geometry): [number, number, number, number] {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      const scan = (c: unknown): void => {
        const a = c as number[] | unknown[];
        if (typeof a[0] === "number") {
          const p = a as number[];
          if (p[0] < x0) x0 = p[0];
          if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1];
          if (p[1] > y1) y1 = p[1];
        } else for (const q of a) scan(q);
      };
      scan((g as { coordinates: unknown }).coordinates);
      return [x0, y0, x1, y1];
    }
    function ensureZcta(st: string) {
      if (zctaCache.has(st)) return;
      zctaCache.set(st, "loading");
      fetch(`/geo/zcta/${st}.json`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((topo: Topology<Objects>) => {
          const obj = topo.objects[st];
          if (!obj) throw new Error("missing topology object");
          const out = topoFeature(topo, obj);
          const fc = (
            out.type === "FeatureCollection" ? out : { type: "FeatureCollection", features: [out] }
          ) as FeatureCollection;
          zctaCache.set(
            st,
            fc.features
              .filter((f) => f.geometry)
              .map((f) => ({
                f,
                zip: String((f.properties as { zip?: string } | null)?.zip ?? ""),
                bbox: geomBBox(f.geometry),
              })),
          );
          S.dirty = true;
        })
        .catch(() => zctaCache.set(st, "failed"));
    }
    // last-rendered on-screen positions, for hover/click hit-tests
    let screen: { x: number; y: number; i: number }[] = [];
    let stateScreen: { x: number; y: number; place: Place }[] = [];
    let cityScreen: { x: number; y: number; place: Place }[] = [];

    const projection: GeoProjection = geoOrthographic().clipAngle(90);
    const path = geoPath(projection, ctx);
    const graticule = geoGraticule10();

    // Scale that frames a place's bounding span with its margin at the given lat.
    function scaleFor(p: {
      lat: number;
      lngSpan: number;
      latSpan: number;
      fillW: number;
      fillH: number;
    }) {
      const latC = (p.lat * Math.PI) / 180;
      const sByW = (S.w * p.fillW) / (p.lngSpan * Math.cos(latC) * (Math.PI / 180));
      const sByH = (S.h * p.fillH) / (p.latSpan * (Math.PI / 180));
      return Math.min(sByW, sByH);
    }

    function layout() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      S.w = w;
      S.h = h;
      S.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      S.R = Math.min(w, h) * 0.42;
      // scale that fits the continental U.S. with padding
      const latC = (US_CENTER[1] * Math.PI) / 180;
      const sByW = (w * (w < 640 ? 0.98 : 0.9)) / (60 * Math.cos(latC) * (Math.PI / 180));
      const sByH = (h * 0.8) / (26 * (Math.PI / 180));
      S.usScale = Math.min(sByW, sByH);
      if (S.focus) {
        S.focus.scale = scaleFor(S.focus); // keep framing on resize
        if (S.focusView) S.focusView.scale = S.focus.scale;
      }
      projection.translate([w / 2, h / 2]);
      S.dirty = true;
    }

    // ---- render ------------------------------------------------------------
    function render() {
      const c = ctx!;
      const { w, h, t, f } = S;

      // base view from scroll, then blend toward the focused city by f
      const eScroll = smoothstep(0, 1, t);
      const scaleScroll = lerp(S.R, S.usScale, eScroll);
      const lngScroll = S.autoLng + angDelta(S.autoLng, US_ROTATE[0]) * eScroll;
      const latScroll = lerp(START_TILT, US_ROTATE[1], eScroll);

      let lng = lngScroll,
        lat = latScroll,
        scale = scaleScroll;
      if (S.focusView && f > 0) {
        const cf = smoothstep(0, 1, f);
        const tLng = -S.focusView.lng;
        const tLat = -S.focusView.lat;
        lng = lngScroll + angDelta(lngScroll, tLng) * cf;
        lat = latScroll + (tLat - latScroll) * cf;
        scale = scaleScroll * Math.pow(S.focusView.scale / scaleScroll, cf); // exp zoom
      }
      // Apply the user's free zoom/pan (wheel + pinch) on top of the scripted
      // scroll/focus framing, so you can push in past the preset city frame down
      // to individual ZIP cells. uz=1, ux=uy=0 → identical to the scripted view.
      const effScale = scale * S.uz;
      projection.scale(effScale);
      projection.rotate([lng, lat, 0]);
      projection.translate([w / 2 + S.ux, h / 2 + S.uy]);

      // reveal driven by whichever is further along: scroll or city-focus
      const tEff = Math.max(t, f);
      const e = smoothstep(0, 1, tEff);
      const worldAlpha = 1 - smoothstep(0.32, 0.66, tEff);
      const zipAlpha = smoothstep(0.42, 0.82, tEff);
      const coastAlpha = 0.5 - 0.34 * e;

      // backdrop: deep space, with the planet disc on top
      c.clearRect(0, 0, w, h);
      c.fillStyle = "#05070f";
      c.fillRect(0, 0, w, h);

      const cx = w / 2 + S.ux,
        cy = h / 2 + S.uy;

      // atmosphere halo (only meaningful while the globe is small)
      if (effScale < Math.max(w, h)) {
        const halo = c.createRadialGradient(cx, cy, effScale * 0.85, cx, cy, effScale * 1.16);
        halo.addColorStop(0, "rgba(56,120,200,0.18)");
        halo.addColorStop(1, "rgba(56,120,200,0)");
        c.fillStyle = halo;
        c.beginPath();
        c.arc(cx, cy, effScale * 1.16, 0, 2 * Math.PI);
        c.fill();
      }

      // ocean / planet disc
      c.beginPath();
      c.arc(cx, cy, effScale, 0, 2 * Math.PI);
      const ocean = c.createRadialGradient(
        cx - effScale * 0.3,
        cy - effScale * 0.3,
        effScale * 0.1,
        cx,
        cy,
        effScale,
      );
      ocean.addColorStop(0, "#12203c");
      ocean.addColorStop(1, "#070d1c");
      c.fillStyle = ocean;
      c.fill();

      // graticule + coastlines + halftone land dots. Coastlines linger faintly
      // when focused (f) to orient coastal metros even after the dots fade.
      if (land && (worldAlpha > 0.01 || f > 0.01)) {
        c.save();
        if (worldAlpha > 0.01) {
          c.globalAlpha = worldAlpha * 0.12;
          c.beginPath();
          path(graticule);
          c.strokeStyle = "#93b2e6";
          c.lineWidth = 1;
          c.stroke();
        }

        c.globalAlpha = Math.max(worldAlpha * coastAlpha, f * 0.16);
        c.beginPath();
        for (const ft of land.features) path(ft);
        c.strokeStyle = "#9db4d8";
        c.lineWidth = 1;
        c.stroke();

        if (worldAlpha > 0.01) {
          c.globalAlpha = worldAlpha;
          c.fillStyle = "#546a86";
          const dotR = 1.1;
          for (const d of worldDots) {
            const p = projection(d);
            if (!p) continue;
            c.fillRect(p[0] - dotR, p[1] - dotR, dotR * 2, dotR * 2);
          }
        }
        c.restore();
      }

      // Crisp U.S. layer — real state borders + a clean national outline that fade
      // in as the view zooms toward the country (`e` = zoom-in progress). The
      // orthographic back-hemisphere clip means these only draw when the U.S. faces
      // us, so no gating by rotation is needed.
      const usOutlineA = smoothstep(0.12, 0.46, e) * 0.9;
      const usBorderA = smoothstep(0.24, 0.6, e) * 0.5;
      if (usNation && usOutlineA > 0.01) {
        c.save();
        c.lineJoin = "round";
        c.lineCap = "round";
        if (usBorders && usBorderA > 0.01) {
          c.globalAlpha = usBorderA;
          c.beginPath();
          path(usBorders);
          c.strokeStyle = "#6f8bbb";
          c.lineWidth = 0.7;
          c.stroke();
        }
        c.globalAlpha = usOutlineA;
        c.beginPath();
        path(usNation);
        c.strokeStyle = "#b3ccf0";
        c.lineWidth = 1.2;
        c.stroke();
        c.restore();
      }

      // ZIP scores. Gather the visible ZIPs once (projecting each centroid), then
      // render them two ways that cross-fade with zoom: dots when far out, and —
      // as the view narrows past a few degrees across — Voronoi cells that give
      // every ZIP a colored border.
      screen = [];
      if (zips && zipAlpha > 0.01) {
        const vx: number[] = [],
          vy: number[] = [],
          vt: number[] = [],
          vi: number[] = [];
        for (let i = 0; i < zips.n; i++) {
          const p = projection([zips.lng[i], zips.lat[i]]);
          if (!p) continue;
          const x = p[0],
            y = p[1];
          if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
          vx.push(x);
          vy.push(y);
          vt.push(zips.tier[i]);
          vi.push(i);
          screen.push({ x, y, i });
        }

        // degrees of longitude spanned by the viewport width → cell fade
        const latHere = S.focusView?.lat ?? US_CENTER[1];
        const degAcross =
          w / (effScale * (Math.PI / 180) * Math.max(0.2, Math.cos((latHere * Math.PI) / 180)));
        const borderAlpha = smoothstep(ZIP_BORDER_FADE_HI, ZIP_BORDER_FADE_LO, degAcross);

        // --- per-ZIP boundaries ---
        // Preferred: REAL ZCTA polygons for the focused state (Census 500k,
        // lazy-loaded per state). Fallback: Voronoi cells around centroids
        // while the file is in flight, if it failed, or outside a state focus.
        // cellOk tracks PER ZIP whether a boundary actually rendered — only
        // those dots fade in the dot→boundary crossfade, so no ZIP vanishes.
        let cellsDrawn = false;
        let cellOk: Uint8Array | null = null;
        const focusSt = S.focus?.stateAbbr;
        let realFeats: ZctaFeat[] | null = null;
        if (focusSt) {
          const entry = zctaCache.get(focusSt);
          if (entry === undefined) ensureZcta(focusSt);
          else if (Array.isArray(entry)) realFeats = entry;
        }
        if (borderAlpha > 0.01 && realFeats && realFeats.length && idxByZip) {
          // padded viewport window in degrees → cheap bbox cull per feature.
          // Center it on the geography actually under the screen center, not on
          // the focus point: invert() picks up the user's pan (S.ux/S.uy via the
          // projection translate), so panning past the focus doesn't cull the
          // ZCTAs you've panned TO and leave blank gaps.
          const ctr = projection.invert?.([w / 2, h / 2]);
          const lngHere = ctr ? ctr[0] : S.focusView?.lng ?? US_CENTER[0];
          const latCull = ctr ? ctr[1] : latHere;
          const degAcrossY = h / (effScale * (Math.PI / 180));
          const wx0 = lngHere - degAcross * 0.62,
            wx1 = lngHere + degAcross * 0.62;
          const wy0 = latCull - degAcrossY * 0.62,
            wy1 = latCull + degAcrossY * 0.62;
          const drawnIdx = new Set<number>();
          let hoverF: Feature | null = null;
          c.save();
          c.lineJoin = "round";
          c.strokeStyle = "rgba(230,238,250,0.5)";
          c.lineWidth = 0.8;
          for (const zf of realFeats) {
            const b = zf.bbox;
            if (b[2] < wx0 || b[0] > wx1 || b[3] < wy0 || b[1] > wy1) continue;
            const idx = idxByZip.get(zf.zip);
            if (idx === undefined) continue;
            const tier = zips.tier[idx];
            c.beginPath();
            path(zf.f);
            c.globalAlpha = borderAlpha * (tier >= 4 ? 0.42 : 0.3);
            c.fillStyle = TIER_COLORS[tier];
            c.fill();
            c.globalAlpha = borderAlpha * 0.55;
            c.stroke();
            drawnIdx.add(idx);
            if (idx === S.hoverIdx) hoverF = zf.f;
          }
          // brighten the hovered ZIP's real boundary on top of the rest
          if (hoverF) {
            c.beginPath();
            path(hoverF);
            c.globalAlpha = borderAlpha;
            c.strokeStyle = "#ffffff";
            c.lineWidth = 1.5;
            c.stroke();
          }
          c.restore();
          if (drawnIdx.size) {
            cellsDrawn = true;
            cellOk = new Uint8Array(vx.length);
            for (let k = 0; k < vi.length; k++) if (drawnIdx.has(vi[k])) cellOk[k] = 1;
          }
        } else if (borderAlpha > 0.01 && vx.length >= 3 && vx.length <= ZIP_CELL_MAXPTS) {
          cellOk = new Uint8Array(vx.length);
          const pts = new Float64Array(vx.length * 2);
          let bxmin = Infinity,
            bymin = Infinity,
            bxmax = -Infinity,
            bymax = -Infinity;
          for (let k = 0; k < vx.length; k++) {
            pts[2 * k] = vx[k];
            pts[2 * k + 1] = vy[k];
            if (vx[k] < bxmin) bxmin = vx[k];
            if (vx[k] > bxmax) bxmax = vx[k];
            if (vy[k] < bymin) bymin = vy[k];
            if (vy[k] > bymax) bymax = vy[k];
          }
          // Clip the tessellation to the visible ZIPs' bounding box (padded)
          // rather than the whole viewport, so peripheral cells stay compact
          // instead of sprawling out to the edges and getting culled — which is
          // what left the gaps where ZIPs seemed to disappear.
          const padX = w * 0.05,
            padY = h * 0.05;
          const voronoi = new Delaunay(pts).voronoi([
            Math.max(0, bxmin - padX),
            Math.max(0, bymin - padY),
            Math.min(w, bxmax + padX),
            Math.min(h, bymax + padY),
          ]);
          const maxArea = w * h * ZIP_CELL_MAX_AREA_FRAC;
          let hoverPoly: [number, number][] | null = null;
          c.save();
          c.lineJoin = "round";
          c.lineWidth = 0.7;
          c.strokeStyle = "rgba(230,238,250,0.5)";
          for (let k = 0; k < vx.length; k++) {
            const poly = voronoi.cellPolygon(k) as [number, number][] | null;
            if (!poly || poly.length < 4) continue;
            let area = 0;
            for (let j = 0, l = poly.length - 1; j < poly.length; l = j++)
              area += poly[l][0] * poly[j][1] - poly[j][0] * poly[l][1];
            if (Math.abs(area) / 2 > maxArea) continue; // drop sprawling edge cells
            c.beginPath();
            c.moveTo(poly[0][0], poly[0][1]);
            for (let j = 1; j < poly.length; j++) c.lineTo(poly[j][0], poly[j][1]);
            c.closePath();
            c.globalAlpha = borderAlpha * (vt[k] >= 4 ? 0.42 : 0.3);
            c.fillStyle = TIER_COLORS[vt[k]];
            c.fill();
            c.globalAlpha = borderAlpha * 0.5;
            c.stroke();
            cellsDrawn = true;
            cellOk![k] = 1;
            if (vi[k] === S.hoverIdx) hoverPoly = poly;
          }
          // brighten the hovered ZIP's cell on top of the rest
          if (hoverPoly) {
            c.beginPath();
            c.moveTo(hoverPoly[0][0], hoverPoly[0][1]);
            for (let j = 1; j < hoverPoly.length; j++)
              c.lineTo(hoverPoly[j][0], hoverPoly[j][1]);
            c.closePath();
            c.globalAlpha = borderAlpha;
            c.strokeStyle = "#ffffff";
            c.lineWidth = 1.4;
            c.stroke();
          }
          c.restore();
        }

        // --- centroid dots ---
        // Per-ZIP crossfade: only dots whose cell actually rendered fade out;
        // culled-cell ZIPs keep a full dot. Dots also grow with the user's
        // free zoom so deep city views stay readable and clickable.
        const fadedAlpha = zipAlpha * (1 - 0.82 * (cellsDrawn ? borderAlpha : 0));
        if (zipAlpha > 0.01) {
          const size =
            (lerp(1.0, 1.7, e) + f * 2.3) * clamp(Math.sqrt(S.uz), 1, 2.4);
          c.save();
          c.globalAlpha = fadedAlpha;
          let curAlpha = fadedAlpha;
          let curTier = -1;
          let lit = false;
          for (let k = 0; k < vx.length; k++) {
            const tier = vt[k];
            if (tier !== curTier) {
              curTier = tier;
              const glow = tier >= 4;
              if (glow !== lit) {
                c.globalCompositeOperation = glow ? "lighter" : "source-over";
                lit = glow;
              }
              c.fillStyle = TIER_COLORS[tier];
            }
            const a = cellOk && cellOk[k] ? fadedAlpha : zipAlpha;
            if (a !== curAlpha) {
              c.globalAlpha = a;
              curAlpha = a;
            }
            if (a < 0.01) continue;
            const s = tier >= 4 ? size + 0.8 : size;
            c.fillRect(vx[k] - s / 2, vy[k] - s / 2, s, s);
          }
          c.restore();
        }
      }

      // Level labels + click targets. On the resolved U.S. map: state
      // abbreviations (click → fly to that state). Focused on a state: the
      // metros inside it (click → drill to the city). Each fades with the zoom.
      stateScreen = [];
      cityScreen = [];

      const stateLa = smoothstep(0.72, 0.92, tEff) * (1 - smoothstep(0.12, 0.55, f));
      if (stateLa > 0.02) {
        c.save();
        c.globalAlpha = stateLa;
        c.font = '700 12px var(--font-sans, ui-sans-serif), system-ui, sans-serif';
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = "rgba(226,232,240,0.92)";
        for (const st of STATES) {
          const p = projection([st.lng, st.lat]);
          if (!p) continue;
          if (p[0] < -20 || p[0] > w + 20 || p[1] < -20 || p[1] > h + 20) continue;
          c.fillText(st.stateAbbr as string, p[0], p[1]);
          stateScreen.push({ x: p[0], y: p[1], place: st });
        }
        c.restore();
      }

      const cityLa = S.focus?.kind === "state" ? smoothstep(0.4, 0.85, f) : 0;
      if (cityLa > 0.02 && S.focus?.stateAbbr) {
        const cities = (cityIndex[S.focus.stateAbbr] ?? []).slice(0, LABELS_PER_STATE);
        c.save();
        c.globalAlpha = cityLa * 0.9;
        c.font = '600 12px var(--font-sans, ui-sans-serif), system-ui, sans-serif';
        c.textBaseline = "middle";
        // Cities come sorted biggest-first; skip any label whose text box would
        // collide with one already drawn, so dense metros don't overprint.
        const drawn: { x0: number; x1: number; y0: number; y1: number }[] = [];
        for (const city of cities) {
          const p = projection([city.lng, city.lat]);
          if (!p) continue;
          if (p[0] < -40 || p[0] > w + 150 || p[1] < -30 || p[1] > h + 30) continue;
          const tw = c.measureText(city.name).width;
          const box = { x0: p[0] - 8, x1: p[0] + 12 + tw, y0: p[1] - 10, y1: p[1] + 10 };
          if (drawn.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0))
            continue;
          drawn.push(box);
          c.beginPath();
          c.arc(p[0], p[1], 3.2, 0, 2 * Math.PI);
          c.fillStyle = "rgba(255,255,255,0.95)";
          c.fill();
          c.beginPath();
          c.arc(p[0], p[1], 6, 0, 2 * Math.PI);
          c.strokeStyle = "rgba(255,255,255,0.4)";
          c.lineWidth = 1;
          c.stroke();
          c.fillStyle = "rgba(236,240,248,0.95)";
          c.fillText(city.name, p[0] + 10, p[1]);
          cityScreen.push({ x: p[0], y: p[1], place: city });
        }
        c.restore();
      }

      // hover highlight ring
      const hv = S.hoverPt;
      if (hv) {
        c.save();
        c.beginPath();
        c.arc(hv.x, hv.y, 7, 0, 2 * Math.PI);
        c.strokeStyle = "#ffffff";
        c.lineWidth = 1.5;
        c.stroke();
        c.beginPath();
        c.arc(hv.x, hv.y, 12, 0, 2 * Math.PI);
        c.strokeStyle = "rgba(255,255,255,0.4)";
        c.lineWidth = 1;
        c.stroke();
        c.restore();
      }
    }

    // ---- scroll → t --------------------------------------------------------
    function updateProgress() {
      // ignore scroll while a city is focused (scroll is locked anyway)
      if (S.focus) return;
      const rect = scene.getBoundingClientRect();
      const total = scene.offsetHeight - window.innerHeight;
      const t = clamp(total > 0 ? -rect.top / total : 0, 0, 1);
      if (Math.abs(t - S.t) > 0.0005) {
        S.t = t;
        S.dirty = true;
        setProgress(t);
      }
    }

    // ---- fly-to (state or city) -------------------------------------------
    function resetUserZoom() {
      S.uz = 1;
      S.ux = 0;
      S.uy = 0;
    }
    function flyTo(p: Place) {
      if (p.stateAbbr) ensureZcta(p.stateAbbr); // real borders, fetched just-in-time
      const dest = { ...p, scale: scaleFor(p) };
      const wasFocused = !!S.focusView && S.f > 0.02;
      S.focus = dest;
      resetUserZoom(); // start every place framed; the user re-zooms from there
      // First fly-in from the map: snap the displayed view to the destination so
      // the motion is driven purely by f. Re-targeting while already zoomed in
      // instead leaves focusView where it is and eases it across, so drilling
      // state→city (or hopping city→city) glides instead of cutting.
      if (!wasFocused) {
        S.focusView = { lng: p.lng, lat: p.lat, scale: dest.scale };
      }
      S.fTarget = 1;
      S.dirty = true;
      setFocusPlace(p);
    }
    function flyHome() {
      S.fTarget = 0; // frame() clears S.focus + focusView + focusPlace at f=0
      resetUserZoom();
      S.dirty = true;
    }
    // Keep the panned view from being dragged fully off-screen. There's a
    // baseline of pan room even at the framed view (so drag-to-pan always
    // works once focused), and it grows as the user zooms in further.
    function clampPan() {
      const maxX = S.w * (0.6 + Math.max(0, S.uz - 1) * 0.7);
      const maxY = S.h * (0.6 + Math.max(0, S.uz - 1) * 0.7);
      S.ux = clamp(S.ux, -maxX, maxX);
      S.uy = clamp(S.uy, -maxY, maxY);
    }
    // Free zoom about a screen point (cursor for wheel/pinch, viewport center for
    // the ± buttons/keys), layered on the scripted framing via S.uz / S.ux / S.uy.
    function zoomAbout(g: number, mx: number, my: number) {
      const uzNew = clamp(S.uz * g, ZOOM_MIN, ZOOM_MAX);
      const ge = uzNew / S.uz;
      if (Math.abs(ge - 1) < 1e-4) return;
      const cx = S.w / 2,
        cy = S.h / 2;
      S.ux = mx + ge * (cx + S.ux - mx) - cx;
      S.uy = my + ge * (cy + S.uy - my) - cy;
      S.uz = uzNew;
      clampPan();
      S.dirty = true;
    }
    apiRef.current = { flyTo, flyHome, zoomBy: (g: number) => zoomAbout(g, S.w / 2, S.h / 2) };

    // --- drag-to-pan (mouse) + tap/click discrimination ---------------------
    // Once zoomed into a place you can drag the view around. `suppressClick` is
    // set when a press ends in a real drag, so the drill click browsers fire on
    // release doesn't teleport you into a ZIP/city you were only panning past.
    let suppressClick = false;
    let drag: { sx: number; sy: number; ux: number; uy: number; moved: boolean } | null = null;
    function onDown(ev: MouseEvent) {
      // A fresh press starts a new gesture; clear any leftover suppress flag from
      // a prior pan that never produced a canvas click (e.g. released over a
      // control), so it can't swallow this gesture's click.
      suppressClick = false;
      if (!S.focus || ev.button !== 0) return;
      drag = { sx: ev.clientX, sy: ev.clientY, ux: S.ux, uy: S.uy, moved: false };
      canvas.style.cursor = "grabbing";
    }
    function onDrag(ev: MouseEvent) {
      if (!drag) return;
      const dx = ev.clientX - drag.sx,
        dy = ev.clientY - drag.sy;
      if (!drag.moved && dx * dx + dy * dy > 16) drag.moved = true;
      S.ux = drag.ux + dx;
      S.uy = drag.uy + dy;
      clampPan();
      S.dirty = true;
    }
    function onUp() {
      if (!drag) return;
      if (drag.moved) suppressClick = true;
      drag = null;
      canvas.style.cursor = S.focus ? "grab" : "default";
    }

    // --- touch: pinch-to-zoom + one-finger pan (mobile) ---------------------
    let pinch: { dist: number; cx: number; cy: number } | null = null;
    let tpan: { sx: number; sy: number; ux: number; uy: number; moved: boolean } | null = null;
    const touchMid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
      d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY),
    });
    function onTouchStart(ev: TouchEvent) {
      // New touch gesture: clear a stale suppress flag from a prior pan. A moved
      // touch never synthesizes a click to clear it, so without this the next tap
      // (e.g. tapping a ZIP) would be eaten after every pan.
      suppressClick = false;
      if (!S.focus) return; // unfocused: let the touch scroll the intro scene
      if (ev.touches.length >= 2) {
        const m = touchMid(ev.touches);
        pinch = { dist: m.d, cx: m.x, cy: m.y };
        tpan = null;
        ev.preventDefault();
      } else if (ev.touches.length === 1) {
        // one-finger pan whenever focused; a plain tap (no movement) still
        // drills a ZIP — `moved` gates the click suppression below
        const t = ev.touches[0];
        tpan = { sx: t.clientX, sy: t.clientY, ux: S.ux, uy: S.uy, moved: false };
      }
    }
    function onTouchMove(ev: TouchEvent) {
      if (pinch && ev.touches.length >= 2) {
        ev.preventDefault();
        const m = touchMid(ev.touches);
        zoomAbout(m.d / pinch.dist, m.x, m.y);
        S.ux += m.x - pinch.cx; // also pan with the pinch midpoint
        S.uy += m.y - pinch.cy;
        clampPan();
        pinch = { dist: m.d, cx: m.x, cy: m.y };
        S.dirty = true;
      } else if (tpan && ev.touches.length === 1) {
        const t = ev.touches[0];
        const dx = t.clientX - tpan.sx,
          dy = t.clientY - tpan.sy;
        if (!tpan.moved && dx * dx + dy * dy > 16) tpan.moved = true;
        if (tpan.moved) ev.preventDefault(); // once it's a drag, don't scroll
        S.ux = tpan.ux + dx;
        S.uy = tpan.uy + dy;
        clampPan();
        S.dirty = true;
      }
    }
    function onTouchEnd(ev: TouchEvent) {
      if (tpan?.moved) suppressClick = true;
      if (ev.touches.length === 0) {
        pinch = null;
        tpan = null;
      } else if (ev.touches.length === 1) {
        // lifted one finger of a pinch → keep panning from the finger that remains
        pinch = null;
        const t = ev.touches[0];
        tpan = { sx: t.clientX, sy: t.clientY, ux: S.ux, uy: S.uy, moved: false };
      }
    }

    // ± keys nudge the zoom when a place is focused (ignored while typing a ZIP).
    function onKey(ev: KeyboardEvent) {
      if (!S.focus) return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (ev.key === "+" || ev.key === "=") {
        ev.preventDefault();
        zoomAbout(1.4, S.w / 2, S.h / 2);
      } else if (ev.key === "-" || ev.key === "_") {
        ev.preventDefault();
        zoomAbout(1 / 1.4, S.w / 2, S.h / 2);
      }
    }

    // wheel / trackpad-pinch → zoom, but only once focused (otherwise the wheel
    // must stay free to drive the page scroll that runs the intro scene).
    function onWheel(ev: WheelEvent) {
      if (!S.focus) return;
      ev.preventDefault();
      let d = ev.deltaY;
      if (ev.deltaMode === 1) d *= 16; // lines → px
      else if (ev.deltaMode === 2) d *= S.h; // pages → px
      // ctrlKey => trackpad pinch (small deltas): give it extra gain so a pinch
      // moves the zoom as much as it visually implies. Regular wheel is snappier
      // than before too, but clamped per-event so a big flick can't jump.
      const k = ev.ctrlKey ? 0.0045 : 0.0024;
      const g = clamp(Math.exp(-d * k), 0.4, 2.4);
      zoomAbout(g, ev.clientX, ev.clientY);
    }

    // ---- animation loop ----------------------------------------------------
    let raf = 0;
    function frame(ts: number) {
      const dt = S.last ? (ts - S.last) / 1000 : 0;
      S.last = ts;
      // idle spin only at the very top of the scene and when not focused
      if (!reduced && S.t < 0.05 && !S.focus) {
        S.autoLng = (S.autoLng + SPIN_DEG_PER_SEC * dt) % 360;
        S.dirty = true;
      }
      // ease the focus progress toward its target
      if (S.f !== S.fTarget) {
        const step = dt / (reduced ? 0.001 : FLY_SECONDS);
        S.f =
          S.fTarget > S.f ? Math.min(S.fTarget, S.f + step) : Math.max(S.fTarget, S.f - step);
        if (S.f === 0 && S.fTarget === 0) {
          S.focus = null;
          S.focusView = null;
        }
        S.dirty = true;
      }
      // ease the displayed focus toward its destination — this is what makes a
      // state→city drill (or a city→city hop) glide while already zoomed in.
      if (S.focus && S.focusView && S.f > 0.001) {
        const k = reduced ? 1 : 1 - Math.exp(-dt / RETARGET_TAU);
        const dLng = angDelta(S.focusView.lng, S.focus.lng);
        const dLat = S.focus.lat - S.focusView.lat;
        const lr = Math.log(S.focus.scale / S.focusView.scale);
        if (Math.abs(dLng) > 1e-3 || Math.abs(dLat) > 1e-3 || Math.abs(lr) > 1e-3) {
          S.focusView.lng += dLng * k;
          S.focusView.lat += dLat * k;
          S.focusView.scale *= Math.exp(lr * k);
          S.dirty = true;
        }
      }
      // mirror f to React (throttled) so overlays cross-fade in sync
      if (
        S.f !== S.mirroredF &&
        (Math.abs(S.f - S.mirroredF) > 0.02 || S.f === 0 || S.f === 1)
      ) {
        S.mirroredF = S.f;
        setFocusProg(S.f);
        if (S.f === 0) setFocusPlace(null);
      }
      if (S.dirty) {
        S.dirty = false;
        render();
      }
      raf = requestAnimationFrame(frame);
    }

    // ---- hover hit-test + cursor ------------------------------------------
    let hoverRaf = 0;
    function onMove(ev: MouseEvent) {
      if (drag) return; // panning: skip hover so it doesn't fight the drag
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const mx = ev.clientX,
          my = ev.clientY;
        const z = zips;
        const active = !!z && (S.t >= 0.55 || S.f >= 0.55) && screen.length > 0;

        let best = -1;
        if (active) {
          let bestD = 15 * 15;
          for (const s of screen) {
            const dx = s.x - mx,
              dy = s.y - my;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = s.i;
            }
          }
        }

        // cursor: pointer over a ZIP dot, a city label, or a state label
        let overAnchor = false;
        if (best === -1) {
          for (const a of cityScreen) {
            const dx = a.x - mx,
              dy = a.y - my;
            if (dx * dx + dy * dy < 26 * 26) {
              overAnchor = true;
              break;
            }
          }
          if (!overAnchor)
            for (const s of stateScreen) {
              const dx = s.x - mx,
                dy = s.y - my;
              if (dx * dx + dy * dy < 20 * 20) {
                overAnchor = true;
                break;
              }
            }
        }
        canvas.style.cursor =
          best !== -1 || overAnchor ? "pointer" : S.focus ? "grab" : "default";

        // projection() can return null if the hovered dot rotated to the clipped
        // back hemisphere between the last render and this throttled hit-test
        // (e.g. mid fly-in), so guard it rather than assert non-null.
        const p = best !== -1 && z ? projection([z.lng[best], z.lat[best]]) : null;
        if (!p || !z) {
          if (S.hoverPt) {
            S.hoverPt = null;
            S.hoverIdx = -1;
            setHover(null);
            S.dirty = true;
          }
          return;
        }
        const next: Hover = {
          x: p[0],
          y: p[1],
          zip: z.zip[best],
          place: z.place[best],
          score: z.score[best],
        };
        S.hoverPt = next;
        S.hoverIdx = best;
        setHover(next);
        S.dirty = true;
      });
    }
    function onLeave() {
      canvas.style.cursor = "default";
      if (S.hoverPt) {
        S.hoverPt = null;
        S.hoverIdx = -1;
        setHover(null);
        S.dirty = true;
      }
    }

    // ---- click: state → drill to state, city → drill to city, ZIP → open --
    function onClick(ev: MouseEvent) {
      if (suppressClick) {
        suppressClick = false; // this click closed a drag/pan — swallow it
        return;
      }
      const mx = ev.clientX,
        my = ev.clientY;
      const z = zips;
      const mapReady = S.t >= 0.55 || S.f >= 0.55;
      const hitZip = () => {
        if (!z || !mapReady || !screen.length) return false;
        let best = -1,
          bestD = 14 * 14;
        for (const s of screen) {
          const dx = s.x - mx,
            dy = s.y - my;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = s.i;
          }
        }
        if (best === -1) return false;
        // Only open the dashboard from full city zoom. From farther out (U.S.
        // or state view) a ZIP click zooms INTO that ZIP's city first, so a
        // click never teleports you off the map unexpectedly.
        if (S.focus?.kind !== "city") {
          const city = cityByLabel.get(z.place[best]);
          if (city) {
            flyTo(city);
            return true;
          }
        }
        routerRef.current.push(`/dashboard?zip=${encodeURIComponent(z.zip[best])}`);
        return true;
      };
      const hitCity = () => {
        let bc: Place | null = null,
          bcD = 26 * 26;
        for (const a of cityScreen) {
          const dx = a.x - mx,
            dy = a.y - my;
          const d = dx * dx + dy * dy;
          if (d < bcD) {
            bcD = d;
            bc = a.place;
          }
        }
        if (!bc) return false;
        flyTo(bc);
        return true;
      };
      const hitState = () => {
        let bp: Place | null = null,
          bpD = 22 * 22;
        for (const s of stateScreen) {
          const dx = s.x - mx,
            dy = s.y - my;
          const d = dx * dx + dy * dy;
          if (d < bpD) {
            bpD = d;
            bp = s.place;
          }
        }
        if (!bp) return false;
        flyTo(bp);
        return true;
      };
      // Priority follows the current zoom level: at a city, only ZIPs are live;
      // in a state, a metro drills deeper (else the ZIP under the cursor opens);
      // on the U.S. map, a state label zooms in (else a ZIP fallback opens).
      const kind = S.focus?.kind;
      if (kind === "city") {
        hitZip();
      } else if (kind === "state") {
        if (!hitCity()) hitZip();
      } else {
        if (!hitState()) hitZip();
      }
    }

    // ---- boot --------------------------------------------------------------
    layout();
    canvas.style.cursor = "default";
    raf = requestAnimationFrame(frame);
    const onScroll = () => updateProgress();
    const onResize = () => {
      layout();
      updateProgress();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("click", onClick);
    // wheel on window (not just canvas) so scroll-to-zoom works even when the
    // cursor is over the zoom buttons / Back / rail / copy overlay. onWheel is a
    // no-op until a place is focused, so the intro page-scroll stays untouched.
    window.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);
    updateProgress();

    // land first (fast, drives first meaningful paint), then ZIPs
    // (assets live under public/geo/ — public/data/ is caught by the repo's
    //  root `data/` gitignore and would not be committed or deployed)
    fetch("/geo/land-110m.json")
      .then((r) => r.json())
      .then((geo) => {
        land = geo;
        worldDots = buildWorldDots(geo);
        S.dirty = true;
        setReady(true);
      })
      .catch(() => {});

    // Crisp U.S. borders: a clean national outline + interior state lines.
    fetch("/geo/us-states-10m.json")
      .then((r) => r.json())
      .then((topo: Topology<Objects>) => {
        usNation = topoFeature(topo, topo.objects.nation) as unknown as Feature;
        usBorders = topoMesh(topo, topo.objects.states, (a, b) => a !== b) as Geometry;
        S.dirty = true;
      })
      .catch(() => {});

    fetch("/geo/zip-points.json")
      .then((r) => r.json())
      .then((rows: [number, number, number, string, string][]) => {
        const n = rows.length;
        const z: ZipData = {
          lng: new Float32Array(n),
          lat: new Float32Array(n),
          tier: new Uint8Array(n),
          score: new Uint8Array(n),
          zip: new Array(n),
          place: new Array(n),
          n,
        };
        for (let i = 0; i < n; i++) {
          const r = rows[i];
          z.lng[i] = r[0];
          z.lat[i] = r[1];
          z.score[i] = r[2];
          z.tier[i] = tierOf(r[2]);
          z.zip[i] = r[3];
          z.place[i] = r[4];
        }
        zips = z;
        idxByZip = new Map();
        for (let i = 0; i < n; i++) idxByZip.set(z.zip[i], i);
        // derive the zoomable-city index from the freshly loaded ZIPs, and
        // publish it to React so the state/city rails pick it up
        const built = buildCityIndex(z);
        cityIndex = built.byState;
        cityByLabel = built.byLabel;
        cityIndexRef.current = cityIndex;
        setIndexReady(true);
        S.dirty = true;
      })
      .catch(() => {});

    return () => {
      cancelAnimationFrame(raf);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
      apiRef.current = null;
    };
  }, []);

  // Lock page scroll while a place is focused, so scroll can't fight the fly-to.
  useEffect(() => {
    if (!focusPlace) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [focusPlace]);

  // ---- hero search -----------------------------------------------------------
  function goToZip(zip: string) {
    router.push(`/dashboard?zip=${encodeURIComponent(zip)}`);
  }
  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const clean = query.trim();
    if (/^\d{5}$/.test(clean)) {
      setZipError(false);
      goToZip(clean);
    } else {
      setZipError(true);
    }
  }
  const flyToPlace = (p: Place) => apiRef.current?.flyTo(p);
  const flyToCity = (c: City) => apiRef.current?.flyTo(cityPlace(c));
  // Back steps out one level: a city returns to its parent state (if known),
  // a state returns to the U.S. map.
  function flyBack() {
    const p = focusPlace;
    if (p?.kind === "city" && p.stateAbbr && STATE_BY_ABBR[p.stateAbbr]) {
      apiRef.current?.flyTo(STATE_BY_ABBR[p.stateAbbr]);
    } else {
      apiRef.current?.flyHome();
    }
  }
  // The zoomable cities in the focused place's state (derived from the ZIP data).
  // `indexReady` is read so this recomputes once the index finishes building.
  const stateCities =
    indexReady && focusPlace?.stateAbbr
      ? cityIndexRef.current[focusPlace.stateAbbr] ?? []
      : [];

  // Overlay opacities: intro + map fade out as you scroll AND as you fly into a
  // place; the focus overlay fades in with the fly. focusProg keeps them in sync
  // with the globe animation.
  const introOpacity = (1 - smoothstep(0, 0.22, progress)) * (1 - focusProg);
  const mapOpacity = smoothstep(0.66, 0.92, progress) * (1 - focusProg);
  const focusOpacity = focusProg;
  const introInteractive = introOpacity > 0.15;
  const mapInteractive = mapOpacity > 0.6;
  const focusInteractive = focusOpacity > 0.5;

  return (
    <div className="lgh">
      <style>{LGH_CSS}</style>

      <section
        ref={sceneRef}
        className="lgh-scene"
        style={{ height: `${SCENE_VH}vh` }}
        aria-label="Interactive globe zooming into U.S. ZIP code scores"
      >
        <div className="lgh-sticky">
          <canvas
            ref={canvasRef}
            className="lgh-canvas"
            data-focused={focusPlace ? "true" : undefined}
          />
          {!ready && (
            <div className="lgh-loading" aria-hidden="true">
              <span className="lgh-spinner" />
            </div>
          )}

          {/* Persistent top nav */}
          <nav className="lgh-nav">
            <a href="/" className="lgh-brand" aria-label="NeighborhoodIQ home">
              {/* Identical pin mark and colors as every other page. */}
              <Logo size={28} />
              <span className="lgh-word">NeighborhoodIQ</span>
            </a>
            <div className="lgh-navright">
              <a href="/how-it-works" className="lgh-navlink">How it works</a>
              <a href="/login" className="lgh-navlink lgh-navsignin">Sign in</a>
              <a href="/login" className="lgh-navcta">Analyze a ZIP</a>
            </div>
          </nav>

          {/* INTRO overlay — the landing hero, fades out as you scroll / fly */}
          <div
            className="lgh-overlay lgh-intro"
            style={{ opacity: introOpacity }}
            data-active={introInteractive ? "true" : undefined}
            aria-hidden={introInteractive ? undefined : true}
          >
            <div className="lgh-hero-inner">
              <div className="lgh-kicker">The honest neighborhood dashboard</div>

              <h1 className="lgh-h1">
                Every neighborhood&apos;s
                <br />
                home-value story.
              </h1>

              <p className="lgh-sub">
                Real Zillow data for every U.S. metro ZIP — what homes cost,
                whether prices are rising or cooling, and how it compares to its
                metro. Plus an honest flag when one looks shaky. Search yours, or
                explore the map.
              </p>

              <form onSubmit={handleSearch} className="lgh-form">
                <div className="lgh-inputwrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" stroke="rgba(241,244,238,0.5)" strokeWidth="2" />
                    <path d="m20 20-3.2-3.2" stroke="rgba(241,244,238,0.5)" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (zipError) setZipError(false);
                    }}
                    placeholder="Enter a ZIP code, e.g. 02127"
                    inputMode="numeric"
                    aria-label="ZIP code"
                    className="lgh-input"
                  />
                </div>
                <button type="submit" className="lgh-analyze">
                  Analyze
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </form>

              {zipError && (
                <p className="lgh-error">Enter a 5-digit ZIP code — try 02127 or 78704.</p>
              )}

              <p className="lgh-caption">Or fly to a metro</p>
              <div className="lgh-chips">
                {METROS.map((m) => (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => flyToCity(m)}
                    className="lgh-chip"
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="lgh-scrollcue" aria-hidden="true">
              <span>Scroll to zoom in</span>
              <svg width="14" height="20" viewBox="0 0 14 20" fill="none">
                <rect x="1" y="1" width="12" height="18" rx="6" stroke="currentColor" />
                <circle className="lgh-scrollcue-dot" cx="7" cy="6" r="2" fill="currentColor" />
              </svg>
            </div>
          </div>

          {/* MAP overlay — fades in once the U.S. resolves */}
          <div
            className="lgh-overlay lgh-map"
            style={{ opacity: mapOpacity }}
            data-active={mapInteractive ? "true" : undefined}
            aria-hidden={mapInteractive ? undefined : true}
          >
            <div className="lgh-mapcopy">
              <h2 className="lgh-maptitle">Every ZIP, one score.</h2>
              <p className="lgh-mapsub">
                Brighter means a higher 2-year chance of rising. Click
                anywhere to zoom in.
              </p>
              <div className="lgh-legend">
                <span className="lgh-legend-label">Lower</span>
                <span className="lgh-legend-ramp" />
                <span className="lgh-legend-label">Higher</span>
              </div>
              <StateRail onPick={flyToPlace} />
            </div>
          </div>

          {/* FOCUS overlay — fades in when you fly into a state or a city */}
          <div
            className="lgh-overlay lgh-city"
            style={{ opacity: focusOpacity }}
            data-active={focusInteractive ? "true" : undefined}
            aria-hidden={focusInteractive ? undefined : true}
          >
            <button type="button" className="lgh-back" onClick={flyBack}>
              ←{" "}
              {focusPlace?.kind === "city" &&
              focusPlace.stateAbbr &&
              STATE_BY_ABBR[focusPlace.stateAbbr]
                ? `Back to ${STATE_BY_ABBR[focusPlace.stateAbbr].name}`
                : "Back to U.S. map"}
            </button>

            {/* Free-zoom control — scroll/pinch also work; these make it obvious */}
            <div className="lgh-zoom" role="group" aria-label="Zoom">
              <button
                type="button"
                className="lgh-zoombtn"
                aria-label="Zoom in"
                onClick={() => apiRef.current?.zoomBy(1.8)}
              >
                +
              </button>
              <button
                type="button"
                className="lgh-zoombtn"
                aria-label="Zoom out"
                onClick={() => apiRef.current?.zoomBy(1 / 1.8)}
              >
                −
              </button>
              <span className="lgh-zoomhint">Scroll or pinch to zoom · drag to pan</span>
            </div>

            <div className="lgh-citycopy">
              <div className="lgh-citykicker">Now viewing</div>
              <h2 className="lgh-citytitle">{focusPlace?.name ?? ""}</h2>

              {focusPlace?.kind === "state" ? (
                <>
                  <p className="lgh-citysub">
                    Every scored ZIP in {focusPlace.name}, colored by its
                    2-year chance of rising. Click a city or any ZIP to
                    zoom closer.
                  </p>
                  {stateCities.length > 0 && (
                    <CityRail cities={stateCities} onPick={flyToPlace} />
                  )}
                </>
              ) : (
                <>
                  <p className="lgh-citysub">
                    Each point is a scored ZIP. Hover to inspect it, click to open
                    it on the dashboard.
                  </p>
                  {focusPlace?.zip ? (
                    <a className="lgh-mapcta" href={`/dashboard?zip=${focusPlace.zip}`}>
                      Open {focusPlace.name} on the dashboard →
                    </a>
                  ) : null}
                  {stateCities.length > 1 && (
                    <CityRail
                      cities={stateCities}
                      activeName={focusPlace?.name}
                      onPick={flyToPlace}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {/* Hover tooltip */}
          {hover && (
            <div
              className="lgh-tip"
              style={{
                left: hover.x,
                top: hover.y,
                transform: `translate(${
                  hover.x >
                  (typeof window !== "undefined" ? window.innerWidth : 1200) - 200
                    ? "-108%"
                    : "12px"
                }, -50%)`,
              }}
            >
              <div className="lgh-tip-place">{hover.place}</div>
              <div className="lgh-tip-row">
                <span className="lgh-tip-zip">ZIP {hover.zip}</span>
                <span className="lgh-tip-score" data-tier={tierOf(hover.score)}>
                  {hover.score}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* Scoped styles — everything is namespaced under `.lgh` so it can't collide
   with globals.css or the other landing components. Palette is the landing's
   warm dark-green + gold system; the globe canvas keeps its own cool-blue
   space colors underneath. */
const LGH_CSS = `
.lgh {
  --lgh-mist: #f4f6f8;
  --lgh-ink: #0b1220;
  --lgh-accent: #5b9bff;
  --lgh-coral: #e07856;
  --lgh-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--lgh-mist);
  background: #05070f;
}
.lgh-scene { position: relative; }
.lgh-sticky {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
  background: #05070f;
}
/* Unfocused: allow vertical page scroll so the intro globe still zooms in on
   touch. Focused: hand ALL touch gestures to the JS engine (one-finger pan +
   pinch-zoom), so the mobile browser's native scroll/zoom can't hijack them. */
.lgh-canvas { position: absolute; top: 0; left: 0; display: block; touch-action: pan-y; }
.lgh-canvas[data-focused="true"] { touch-action: none; }

.lgh-loading { position: absolute; inset: 0; display: grid; place-items: center; z-index: 1; pointer-events: none; }
.lgh-spinner {
  width: 34px; height: 34px; border-radius: 50%;
  border: 2px solid rgba(244,246,248,0.18);
  border-top-color: var(--lgh-accent);
  animation: lghSpin 0.9s linear infinite;
}
@keyframes lghSpin { to { transform: rotate(360deg); } }

/* Nav — container passes clicks through to the canvas; only links are live */
.lgh-nav {
  position: absolute; top: 0; left: 0; right: 0; z-index: 5;
  display: flex; align-items: center; gap: 24px;
  padding: 18px clamp(20px, 5vw, 48px);
  pointer-events: none;
}
.lgh-nav a { pointer-events: auto; }
.lgh-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.lgh-word {
  font-family: var(--font-sans-stack); font-weight: 600; font-size: 15px;
  color: var(--lgh-mist); letter-spacing: -0.01em;
}
.lgh-navright { display: flex; align-items: center; gap: 22px; margin-left: auto; }
.lgh-navlink { font-size: 14px; color: rgba(241,244,238,0.66); text-decoration: none; transition: color 0.15s ease; }
.lgh-navlink:hover { color: var(--lgh-mist); }
.lgh-navcta {
  background: var(--lgh-mist); color: var(--lgh-ink); text-decoration: none;
  padding: 9px 18px; border-radius: 999px; font-size: 14px; font-weight: 600;
  transition: opacity 0.15s ease;
}
.lgh-navcta:hover { opacity: 0.88; }
@media (max-width: 480px) { .lgh-navsignin { display: none; } }

/* Overlays — the container never eats pointer events (so the canvas keeps its
   hover/click); only interactive descendants of an ACTIVE overlay do. */
.lgh-overlay {
  position: absolute; inset: 0; z-index: 3;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 0 24px;
  pointer-events: none;
}
.lgh-overlay[data-active="true"] button,
.lgh-overlay[data-active="true"] a,
.lgh-overlay[data-active="true"] input { pointer-events: auto; }
.lgh-intro {
  background: radial-gradient(ellipse 62% 54% at 50% 46%, rgba(5,7,15,0.62), rgba(5,7,15,0) 72%);
}
.lgh-hero-inner { max-width: 620px; width: 100%; }

.lgh-kicker {
  font-family: var(--lgh-mono); font-size: 11px; font-weight: 500;
  letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--lgh-accent); margin-bottom: 22px;
}
.lgh-h1 {
  font-family: var(--font-sans-stack); font-weight: 700;
  font-size: clamp(40px, 6.4vw, 66px); line-height: 1.02; letter-spacing: -0.025em;
  margin: 0 0 22px; color: var(--lgh-mist);
}
.lgh-sub { font-size: 16px; line-height: 1.65; color: rgba(244,246,248,0.68); max-width: 480px; margin: 0 auto 32px; }

.lgh-form { display: flex; gap: 10px; max-width: 470px; margin: 0 auto; }
.lgh-inputwrap {
  flex: 1; display: flex; align-items: center; gap: 9px;
  background: rgba(241,244,238,0.08); border: 1px solid rgba(241,244,238,0.22);
  border-radius: 999px; padding: 13px 18px; transition: border-color 0.15s ease;
}
.lgh-inputwrap:focus-within { border-color: var(--lgh-accent); }
.lgh-input {
  border: none; outline: none; background: transparent; width: 100%;
  font-family: var(--lgh-mono); font-size: 14px; color: var(--lgh-mist);
}
.lgh-input::placeholder { color: rgba(241,244,238,0.42); }
.lgh-analyze {
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  background: var(--lgh-mist); color: var(--lgh-ink); border: none;
  padding: 0 22px; border-radius: 999px; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: transform 0.15s ease, opacity 0.15s ease;
}
.lgh-analyze:hover { opacity: 0.9; }
.lgh-analyze:active { transform: scale(0.98); }

.lgh-error { font-size: 13px; color: var(--lgh-coral); margin: 12px 0 0; }

.lgh-caption {
  font-family: var(--lgh-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(241,244,238,0.45); margin: 26px 0 12px;
}
.lgh-chips { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
.lgh-chip {
  background: transparent; border: 1px solid rgba(244,246,248,0.24); border-radius: 999px;
  padding: 6px 16px; font-family: var(--lgh-mono); font-size: 12.5px;
  color: rgba(244,246,248,0.82);
  cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.lgh-chip:hover { background: rgba(244,246,248,0.08); border-color: var(--lgh-accent); color: var(--lgh-mist); }

.lgh-scrollcue {
  position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(241,244,238,0.5);
}
.lgh-scrollcue-dot { animation: lghCue 1.6s ease-in-out infinite; }
@keyframes lghCue { 0%,100% { transform: translateY(0); opacity: 1; } 50% { transform: translateY(5px); opacity: 0.3; } }

/* Map overlay */
.lgh-map { justify-content: flex-end; padding-bottom: 7vh; }
.lgh-mapcopy { max-width: 620px; }
.lgh-maptitle {
  font-family: var(--font-sans-stack); font-weight: 700;
  font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.015em; margin: 0 0 12px; color: var(--lgh-mist);
}
.lgh-mapsub { font-size: 15px; line-height: 1.55; color: rgba(241,244,238,0.72); margin: 0 auto 16px; max-width: 460px; }
.lgh-mapcta {
  display: inline-block; background: var(--lgh-mist); color: var(--lgh-ink); text-decoration: none;
  padding: 11px 22px; border-radius: 999px; font-size: 14px; font-weight: 600;
}
.lgh-legend { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 0 0 4px; }
.lgh-legend-label { font-family: var(--lgh-mono); font-size: 11px; color: rgba(241,244,238,0.6); }
.lgh-legend-ramp {
  width: 180px; height: 8px; border-radius: 999px;
  background: linear-gradient(90deg, #39506f, #3f6ba6, #2f95cf, #1fbca9, #40d385, #b6e63a);
}

/* City rail — horizontal, scrollable jump-to-metro buttons */
.lgh-rail {
  display: flex; gap: 8px; flex-wrap: nowrap; overflow-x: auto;
  max-width: min(760px, 92vw); padding: 6px 2px; margin: 16px auto 0;
  scrollbar-width: none;
}
.lgh-rail::-webkit-scrollbar { display: none; }
.lgh-railbtn {
  flex: 0 0 auto; background: rgba(241,244,238,0.06); border: 1px solid rgba(241,244,238,0.2);
  color: rgba(241,244,238,0.82); border-radius: 999px; padding: 7px 14px;
  font-family: var(--lgh-mono); font-size: 12.5px; cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.lgh-railbtn:hover { background: rgba(241,244,238,0.12); color: var(--lgh-mist); }
.lgh-railbtn[data-active="true"] { background: var(--lgh-mist); border-color: var(--lgh-mist); color: var(--lgh-ink); font-weight: 600; }

/* City focus overlay */
.lgh-city { justify-content: flex-end; padding-bottom: 7vh; }
.lgh-back {
  position: absolute; top: 74px; left: clamp(20px, 5vw, 48px);
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(10,16,28,0.6); border: 1px solid rgba(241,244,238,0.22);
  color: var(--lgh-mist); border-radius: 999px; padding: 9px 16px;
  font-size: 13px; cursor: pointer; backdrop-filter: blur(6px);
  transition: background 0.15s ease;
}
.lgh-back:hover { background: rgba(10,16,28,0.85); }

/* Free-zoom control, mirrored on the right of the Back button */
.lgh-zoom {
  position: absolute; top: 74px; right: clamp(20px, 5vw, 48px);
  display: flex; align-items: center; gap: 8px;
}
.lgh-zoombtn {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(10,16,28,0.6); border: 1px solid rgba(241,244,238,0.22);
  color: var(--lgh-mist); font-size: 20px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(6px); transition: background 0.15s ease;
}
.lgh-zoombtn:hover { background: rgba(10,16,28,0.9); }
.lgh-zoomhint {
  font-size: 12px; color: rgba(241,244,238,0.6); margin-left: 4px;
}
@media (max-width: 560px) { .lgh-zoomhint { display: none; } }
.lgh-citycopy { max-width: 620px; }
.lgh-citykicker {
  font-family: var(--lgh-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--lgh-accent); margin-bottom: 8px;
}
.lgh-citytitle {
  font-family: var(--font-sans-stack); font-weight: 700;
  font-size: clamp(30px, 4.6vw, 48px); letter-spacing: -0.015em; margin: 0 0 10px; color: var(--lgh-mist);
}
.lgh-citysub { font-size: 14.5px; line-height: 1.55; color: rgba(241,244,238,0.72); margin: 0 auto 18px; max-width: 440px; }

/* Hover tooltip */
.lgh-tip {
  position: absolute; z-index: 4; pointer-events: none;
  background: rgba(10,16,28,0.9); border: 1px solid rgba(241,244,238,0.18);
  border-radius: 10px; padding: 9px 12px; min-width: 130px; backdrop-filter: blur(6px);
}
.lgh-tip-place { font-size: 12.5px; font-weight: 600; color: var(--lgh-mist); margin-bottom: 4px; }
.lgh-tip-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.lgh-tip-zip { font-family: var(--lgh-mono); font-size: 11.5px; color: rgba(241,244,238,0.6); }
.lgh-tip-score { font-family: var(--lgh-mono); font-size: 14px; font-weight: 600; color: var(--lgh-mist); }
.lgh-tip-score[data-tier="5"] { color: #b6e63a; }
.lgh-tip-score[data-tier="4"] { color: #40d385; }
.lgh-tip-score[data-tier="3"] { color: #1fbca9; }

@media (prefers-reduced-motion: reduce) {
  .lgh-scrollcue-dot, .lgh-spinner { animation: none; }
}
`;
