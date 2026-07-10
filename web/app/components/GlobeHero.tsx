"use client";

import { useEffect, useRef, useState } from "react";
import {
  geoOrthographic,
  geoPath,
  geoGraticule10,
  geoBounds,
  type GeoProjection,
} from "d3-geo";

/**
 * GlobeHero — a scroll-driven hero.
 *
 * At the top of the scroll it is a slowly rotating halftone globe (the same
 * d3-orthographic look the project already had). As the visitor scrolls through
 * the pinned scene, the globe eases to face North America, zooms in, and the
 * abstract land dots cross-fade into ~20,000 real U.S. ZIP codes, each colored
 * by its NeighborhoodIQ appreciation score. Hovering a ZIP reveals it.
 *
 * Data (bundled, fetched at runtime so first paint stays light):
 *   /geo/land-110m.json  — Natural Earth land polygons (coastlines + halftone)
 *   /geo/zip-points.json — [lng, lat, score, zip, "City, ST"][] joined from
 *                           Census ZCTA centroids + the model's national scores.
 */

// ----- tunables -------------------------------------------------------------
const SCENE_VH = 320; // total scroll length of the pinned scene
const US_CENTER: [number, number] = [-98.5, 39.5];
const US_ROTATE: [number, number] = [-US_CENTER[0], -US_CENTER[1]]; // [98.5, -39.5]
const START_TILT = -14; // initial latitude tilt of the globe
const SPIN_DEG_PER_SEC = 6; // idle auto-rotation

// Score → color ramp, tuned for a dark backdrop. Cool + quiet for the low
// scores that make up most of the map; warm greens/lime for the standouts.
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

// Neutral geographic anchors — just orientation labels, no score claim.
const ANCHORS: { name: string; lng: number; lat: number }[] = [
  { name: "Seattle", lng: -122.33, lat: 47.61 },
  { name: "San Francisco", lng: -122.42, lat: 37.77 },
  { name: "Los Angeles", lng: -118.24, lat: 34.05 },
  { name: "Denver", lng: -104.99, lat: 39.74 },
  { name: "Houston", lng: -95.37, lat: 29.76 },
  { name: "Chicago", lng: -87.63, lat: 41.88 },
  { name: "Atlanta", lng: -84.39, lat: 33.75 },
  { name: "Miami", lng: -80.19, lat: 25.76 },
  { name: "New York", lng: -74.0, lat: 40.71 },
  { name: "Boston", lng: -71.06, lat: 42.36 },
];

// ----- small math helpers ---------------------------------------------------
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
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

export default function GlobeHero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0); // t 0..1, mirrored to React for overlays
  const [hover, setHover] = useState<Hover>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const sceneEl = sceneRef.current;
    if (!canvasEl || !sceneEl) return;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    // non-null aliases so nested closures keep the narrowed types
    const canvas: HTMLCanvasElement = canvasEl;
    const scene: HTMLDivElement = sceneEl;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // mutable render state (kept in refs-of-closure to avoid re-creating rAF)
    const S = {
      w: 0,
      h: 0,
      dpr: 1,
      R: 300,
      usScale: 900,
      t: 0,
      autoLng: reduced ? 70 : 20,
      hoverPt: null as Hover,
      dirty: true,
      last: 0,
    };

    let land: any = null;
    let worldDots: [number, number][] = [];
    let zips: ZipData | null = null;
    // last-rendered on-screen positions of visible ZIP dots, for hover hit-test
    let screen: { x: number; y: number; i: number }[] = [];

    const projection: GeoProjection = geoOrthographic().clipAngle(90);
    const path = geoPath(projection, ctx);
    const graticule = geoGraticule10();

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
      projection.translate([w / 2, h / 2]);
      S.dirty = true;
    }

    // ---- render ------------------------------------------------------------
    function render() {
      const c = ctx!;
      const { w, h, t } = S;
      const e = smoothstep(0, 1, t); // eased zoom
      const scale = lerp(S.R, S.usScale, e);
      projection.scale(scale);

      // rotation: idle spin at the top, easing to face the U.S. as we zoom
      let dl = (((US_ROTATE[0] - S.autoLng) % 360) + 540) % 360 - 180;
      const lng = S.autoLng + dl * e;
      const lat = lerp(START_TILT, US_ROTATE[1], e);
      projection.rotate([lng, lat, 0]);

      const worldAlpha = 1 - smoothstep(0.32, 0.66, t);
      const zipAlpha = smoothstep(0.42, 0.82, t);
      const coastAlpha = 0.5 - 0.34 * e;

      // backdrop: deep space, with the planet disc on top
      c.clearRect(0, 0, w, h);
      c.fillStyle = "#05070f";
      c.fillRect(0, 0, w, h);

      const cx = w / 2,
        cy = h / 2;

      // atmosphere halo (only meaningful while the globe is small)
      if (scale < Math.max(w, h)) {
        const halo = c.createRadialGradient(cx, cy, scale * 0.85, cx, cy, scale * 1.16);
        halo.addColorStop(0, "rgba(56,120,200,0.18)");
        halo.addColorStop(1, "rgba(56,120,200,0)");
        c.fillStyle = halo;
        c.beginPath();
        c.arc(cx, cy, scale * 1.16, 0, 2 * Math.PI);
        c.fill();
      }

      // ocean / planet disc
      c.beginPath();
      c.arc(cx, cy, scale, 0, 2 * Math.PI);
      const ocean = c.createRadialGradient(
        cx - scale * 0.3,
        cy - scale * 0.3,
        scale * 0.1,
        cx,
        cy,
        scale,
      );
      ocean.addColorStop(0, "#12203c");
      ocean.addColorStop(1, "#070d1c");
      c.fillStyle = ocean;
      c.fill();

      // graticule + coastlines + halftone land dots (fade out as we zoom in)
      if (land && worldAlpha > 0.01) {
        c.save();
        c.globalAlpha = worldAlpha * 0.12;
        c.beginPath();
        path(graticule);
        c.strokeStyle = "#93b2e6";
        c.lineWidth = 1;
        c.stroke();

        c.globalAlpha = worldAlpha * coastAlpha;
        c.beginPath();
        for (const f of land.features) path(f);
        c.strokeStyle = "#9db4d8";
        c.lineWidth = 1;
        c.stroke();

        c.globalAlpha = worldAlpha;
        c.fillStyle = "#546a86";
        const dotR = 1.1;
        for (const d of worldDots) {
          const p = projection(d);
          if (!p) continue;
          c.fillRect(p[0] - dotR, p[1] - dotR, dotR * 2, dotR * 2);
        }
        c.restore();
      }

      // ZIP score dots
      screen = [];
      if (zips && zipAlpha > 0.01) {
        const size = lerp(1.0, 1.7, e);
        const half = size / 2;
        c.save();
        c.globalAlpha = zipAlpha;
        let curTier = -1;
        let lit = false;
        for (let i = 0; i < zips.n; i++) {
          const p = projection([zips.lng[i], zips.lat[i]]);
          if (!p) continue;
          const x = p[0],
            y = p[1];
          if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
          const tier = zips.tier[i];
          if (tier !== curTier) {
            curTier = tier;
            const glow = tier >= 4;
            if (glow !== lit) {
              c.globalCompositeOperation = glow ? "lighter" : "source-over";
              lit = glow;
            }
            c.fillStyle = TIER_COLORS[tier];
          }
          const s = tier >= 4 ? size + 0.8 : size;
          c.fillRect(x - s / 2, y - s / 2, s, s);
          screen.push({ x, y, i });
        }
        c.restore();
      }

      // orientation anchors + hover callout (only once the map has resolved)
      if (zipAlpha > 0.35) {
        const la = smoothstep(0.72, 0.92, t);
        c.save();
        c.globalAlpha = la * 0.85;
        c.font =
          '600 11px var(--font-sans, ui-sans-serif), system-ui, sans-serif';
        c.textBaseline = "middle";
        for (const a of ANCHORS) {
          const p = projection([a.lng, a.lat]);
          if (!p) continue;
          c.beginPath();
          c.arc(p[0], p[1], 2.6, 0, 2 * Math.PI);
          c.fillStyle = "rgba(255,255,255,0.9)";
          c.fill();
          c.beginPath();
          c.arc(p[0], p[1], 5.2, 0, 2 * Math.PI);
          c.strokeStyle = "rgba(255,255,255,0.35)";
          c.lineWidth = 1;
          c.stroke();
          c.fillStyle = "rgba(226,232,240,0.9)";
          c.fillText(a.name, p[0] + 9, p[1]);
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
      const rect = scene.getBoundingClientRect();
      const total = scene.offsetHeight - window.innerHeight;
      const t = clamp(total > 0 ? -rect.top / total : 0, 0, 1);
      if (Math.abs(t - S.t) > 0.0005) {
        S.t = t;
        S.dirty = true;
        setProgress(t);
      }
    }

    // ---- animation loop ----------------------------------------------------
    let raf = 0;
    function frame(ts: number) {
      const dt = S.last ? (ts - S.last) / 1000 : 0;
      S.last = ts;
      // idle spin only while at the top of the scene
      if (!reduced && S.t < 0.05) {
        S.autoLng = (S.autoLng + SPIN_DEG_PER_SEC * dt) % 360;
        S.dirty = true;
      }
      if (S.dirty) {
        S.dirty = false;
        render();
      }
      raf = requestAnimationFrame(frame);
    }

    // ---- hover hit-test ----------------------------------------------------
    let hoverRaf = 0;
    function onMove(ev: MouseEvent) {
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        if (!zips || S.t < 0.6 || screen.length === 0) {
          if (S.hoverPt) {
            S.hoverPt = null;
            setHover(null);
            S.dirty = true;
          }
          return;
        }
        const mx = ev.clientX,
          my = ev.clientY;
        let best = -1,
          bestD = 15 * 15;
        for (const s of screen) {
          const dx = s.x - mx,
            dy = s.y - my;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = s.i;
          }
        }
        if (best === -1) {
          if (S.hoverPt) {
            S.hoverPt = null;
            setHover(null);
            S.dirty = true;
          }
          return;
        }
        const p = projection([zips.lng[best], zips.lat[best]])!;
        const next: Hover = {
          x: p[0],
          y: p[1],
          zip: zips.zip[best],
          place: zips.place[best],
          score: zips.score[best],
        };
        S.hoverPt = next;
        setHover(next);
        S.dirty = true;
      });
    }
    function onLeave() {
      if (S.hoverPt) {
        S.hoverPt = null;
        setHover(null);
        S.dirty = true;
      }
    }

    // ---- boot --------------------------------------------------------------
    layout();
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
    updateProgress();

    // land first (fast, drives first meaningful paint), then ZIPs
    fetch("/geo/land-110m.json")
      .then((r) => r.json())
      .then((geo) => {
        land = geo;
        worldDots = buildWorldDots(geo);
        S.dirty = true;
        setReady(true);
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
    };
  }, []);

  const introOpacity = 1 - smoothstep(0, 0.22, progress);
  const mapOpacity = smoothstep(0.66, 0.92, progress);

  return (
    <section
      ref={sceneRef}
      className="globe-scene"
      style={{ height: `${SCENE_VH}vh` }}
      aria-label="Interactive globe zooming into U.S. ZIP code scores"
    >
      <div className="globe-sticky">
        <canvas ref={canvasRef} className="globe-canvas" />
        {!ready && (
          <div className="globe-loading" aria-hidden="true">
            <span className="globe-spinner" />
          </div>
        )}

        {/* Intro overlay — fades out as you start scrolling */}
        <div
          className="globe-overlay globe-overlay--intro"
          style={{
            opacity: introOpacity,
            pointerEvents: introOpacity < 0.15 ? "none" : "auto",
          }}
        >
          <span className="globe-eyebrow">
            <span className="globe-eyebrow-dot" />
            20,892 ZIP codes, one dashboard
          </span>
          <h1 className="globe-title">
            The whole country,
            <br />
            <span className="globe-title-em">neighborhood by neighborhood.</span>
          </h1>
          <p className="globe-lede">
            Real Zillow home-value trends for every metro ZIP in America — what
            homes cost, where prices are heading, and how each place compares.
          </p>
          <div className="globe-scrollcue">
            <span>Scroll to zoom in</span>
            <svg width="14" height="20" viewBox="0 0 14 20" fill="none">
              <rect x="1" y="1" width="12" height="18" rx="6" stroke="currentColor" />
              <circle className="globe-scrollcue-dot" cx="7" cy="6" r="2" fill="currentColor" />
            </svg>
          </div>
        </div>

        {/* Map overlay — fades in once the U.S. resolves */}
        <div
          className="globe-overlay globe-overlay--map"
          style={{
            opacity: mapOpacity,
            pointerEvents: mapOpacity > 0.6 ? "auto" : "none",
          }}
        >
          <div className="globe-mapcopy">
            <h2 className="globe-maptitle">Every ZIP, one score.</h2>
            <p className="globe-mapsub">
              Brighter means a higher 2-year chance of rising. Hover any point
              to inspect it.
            </p>
            <a href="/login" className="globe-mapcta">
              Explore the map →
            </a>
          </div>
          <div className="globe-legend">
            <span className="globe-legend-label">Lower</span>
            <span className="globe-legend-ramp" />
            <span className="globe-legend-label">Higher</span>
          </div>
        </div>

        {/* Hover tooltip */}
        {hover && (
          <div
            className="globe-tip"
            style={{
              left: hover.x,
              top: hover.y,
              transform: `translate(${hover.x > (typeof window !== "undefined" ? window.innerWidth : 1200) - 200 ? "-108%" : "12px"}, -50%)`,
            }}
          >
            <div className="globe-tip-place">{hover.place}</div>
            <div className="globe-tip-row">
              <span className="globe-tip-zip">ZIP {hover.zip}</span>
              <span className="globe-tip-score" data-tier={tierOf(hover.score)}>
                {hover.score}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
