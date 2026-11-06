"use client";

import { useEffect, useRef } from "react";
import { geoOrthographic, geoPath, geoGraticule10, geoBounds, type GeoProjection } from "d3-geo";

/**
 * Globe — a standalone rotating halftone globe on a <canvas>.
 * Auto-spins when idle, drag to rotate manually, wheel/pinch to zoom.
 *
 * Data: fetches Natural Earth land polygons from `/geo/land-110m.json`
 * (place that file under your public/ dir — any Natural Earth 110m
 * land GeoJSON works, e.g. https://github.com/d3/d3.github.com/blob/master/geo/land.geojson).
 */

const SPIN_DEG_PER_SEC = 6;
const DOT_STEP = 1.35; // deg spacing of the halftone land dots

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function pointInRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInFeature(x: number, y: number, geom: any): boolean {
  const polys =
    geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
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
function buildWorldDots(land: any, step = DOT_STEP): [number, number][] {
  const dots: [number, number][] = [];
  for (const f of land.features) {
    const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(f);
    for (let lng = minLng; lng <= maxLng; lng += step)
      for (let lat = minLat; lat <= maxLat; lat += step)
        if (pointInFeature(lng, lat, f.geometry)) dots.push([lng, lat]);
  }
  return dots;
}

export default function Globe({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    const canvas = canvasEl;

    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const S = {
      w: 0,
      h: 0,
      R: 300,
      lng: 20,
      lat: -14,
      zoom: 1,
      dirty: true,
      last: 0,
    };
    let land: any = null;
    let worldDots: [number, number][] = [];

    const projection: GeoProjection = geoOrthographic().clipAngle(90);
    const path = geoPath(projection, ctx);
    const graticule = geoGraticule10();

    function layout() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      S.w = w;
      S.h = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      S.R = Math.min(w, h) * 0.42;
      projection.translate([w / 2, h / 2]);
      S.dirty = true;
    }

    function render() {
      const c = ctx!;
      const { w, h } = S;
      const scale = S.R * S.zoom;
      projection.scale(scale);
      projection.rotate([S.lng, S.lat, 0]);

      c.clearRect(0, 0, w, h);
      c.fillStyle = "#05070f";
      c.fillRect(0, 0, w, h);

      const cx = w / 2,
        cy = h / 2;

      // atmosphere halo
      const halo = c.createRadialGradient(cx, cy, scale * 0.85, cx, cy, scale * 1.16);
      halo.addColorStop(0, "rgba(56,120,200,0.18)");
      halo.addColorStop(1, "rgba(56,120,200,0)");
      c.fillStyle = halo;
      c.beginPath();
      c.arc(cx, cy, scale * 1.16, 0, 2 * Math.PI);
      c.fill();

      // ocean disc
      c.beginPath();
      c.arc(cx, cy, scale, 0, 2 * Math.PI);
      const ocean = c.createRadialGradient(cx - scale * 0.3, cy - scale * 0.3, scale * 0.1, cx, cy, scale);
      ocean.addColorStop(0, "#12203c");
      ocean.addColorStop(1, "#070d1c");
      c.fillStyle = ocean;
      c.fill();

      if (land) {
        c.save();
        c.globalAlpha = 0.12;
        c.beginPath();
        path(graticule);
        c.strokeStyle = "#93b2e6";
        c.lineWidth = 1;
        c.stroke();

        c.globalAlpha = 0.5;
        c.beginPath();
        for (const ft of land.features) path(ft);
        c.strokeStyle = "#9db4d8";
        c.lineWidth = 1;
        c.stroke();

        c.globalAlpha = 1;
        c.fillStyle = "#546a86";
        const dotR = 1.1;
        for (const d of worldDots) {
          const p = projection(d);
          if (!p) continue;
          c.fillRect(p[0] - dotR, p[1] - dotR, dotR * 2, dotR * 2);
        }
        c.restore();
      }
    }

    // ---- animation loop: idle auto-spin ----
    let raf = 0;
    function frame(ts: number) {
      const dt = S.last ? (ts - S.last) / 1000 : 0;
      S.last = ts;
      if (!reduced && !dragging) {
        S.lng = (S.lng + SPIN_DEG_PER_SEC * dt) % 360;
        S.dirty = true;
      }
      if (S.dirty) {
        S.dirty = false;
        render();
      }
      raf = requestAnimationFrame(frame);
    }

    // ---- drag to rotate ----
    let dragging = false;
    let dragStart = { x: 0, y: 0, lng: 0, lat: 0 };
    function onDown(ev: MouseEvent) {
      dragging = true;
      dragStart = { x: ev.clientX, y: ev.clientY, lng: S.lng, lat: S.lat };
      canvas.style.cursor = "grabbing";
    }
    function onDrag(ev: MouseEvent) {
      if (!dragging) return;
      const dx = ev.clientX - dragStart.x;
      const dy = ev.clientY - dragStart.y;
      S.lng = dragStart.lng + dx * 0.25;
      S.lat = clamp(dragStart.lat - dy * 0.25, -85, 85);
      S.dirty = true;
    }
    function onUp() {
      dragging = false;
      canvas.style.cursor = "grab";
    }

    // ---- wheel to zoom ----
    function onWheel(ev: WheelEvent) {
      ev.preventDefault();
      const k = ev.ctrlKey ? 0.0045 : 0.0024;
      const g = clamp(Math.exp(-ev.deltaY * k), 0.4, 2.4);
      S.zoom = clamp(S.zoom * g, 0.5, 4);
      S.dirty = true;
    }

    const onResize = () => layout();

    layout();
    canvas.style.cursor = "grab";
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", onResize);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    fetch("/geo/land-110m.json")
      .then((r) => r.json())
      .then((geo) => {
        land = geo;
        worldDots = buildWorldDots(geo);
        S.dirty = true;
      })
      .catch(() => {});

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", height: "100%", display: "block" }} />;
}
