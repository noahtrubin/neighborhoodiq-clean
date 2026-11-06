"use client";

// ZipAnalysisPanel — the forecast for one ZIP, floated over the landing globe.
//
// This replaces the old /dashboard page. The score is a CALIBRATED probability
// (0-100%) that a ZIP's Zillow home value is higher in 2 years than today, from
// an isotonic-calibrated gradient-boosted model on real Zillow data
// (affordability vs metro + price momentum). "Calibrated" means honest: ZIPs it
// rates ~80% actually rose ~80% of the time in out-of-time backtest (AUC ~0.66,
// ~0.72 recent). Most neighborhoods rise (high base rate), so the real value is
// the probability spread + flagging the ~10-15% at genuine risk of falling. It
// reads current conditions; it cannot foresee a macro shock. See evaluate.py /
// sanity_check.py for the honest validation you can reproduce.
//
// Like the old dashboard it is sign-in gated: signed-out visitors get a prompt
// that returns them to this ZIP after login (the landing reads `?zip=`).

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/AuthProvider";
import type { SeriesBundle, ZipData } from "../lib/types";
import ChatPanel from "../ChatPanel";
import FavoriteButton from "../FavoriteButton";
import SavedSection from "../SavedSection";
import Icon, { type IconName } from "./Icon";

type SignalColor = { stroke: string; text: string; bg: string; label: string };

// Colors are CSS variables so they retune automatically between light/dark.
// Tiering is by the calibrated % chance of rising (score = prob*100):
//   >=85% likely to rise · 70-84% leans up · <70% elevated risk of stalling/falling.
const STRONG: SignalColor = { stroke: "var(--strong)", text: "var(--strong-ink)", bg: "var(--strong-bg)", label: "LIKELY TO RISE" };
const MODERATE: SignalColor = { stroke: "var(--moderate)", text: "var(--moderate-ink)", bg: "var(--moderate-bg)", label: "LEANS UP" };
const MODEST: SignalColor = { stroke: "var(--weak)", text: "var(--weak-ink)", bg: "var(--weak-bg)", label: "ELEVATED RISK" };
function getColor(d: ZipData): SignalColor {
  return d.score >= 85 ? STRONG : d.score >= 70 ? MODERATE : MODEST;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtPct = (n: number | null) => (n == null ? "n/a" : `${n > 0 ? "+" : ""}${n}%`);
const normMomentum = (n: number) => Math.round(clamp(((n + 10) / 35) * 100, 3, 100));
const normAppr = (n: number) => Math.round(clamp((n / 200) * 100, 3, 100));
const headroomOf = (pctile: number | null) => (pctile == null ? null : 100 - pctile);
const fmtMoney = (n: number | null) =>
  n == null ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (ym: string | null) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return `${MONTHS[+m - 1]} ${y}`;
};
const changeColor = (n: number | null) => (n == null ? "var(--ink)" : n >= 0 ? "var(--strong-ink)" : "var(--danger)");

// The 5-year change, derived from the SAME annual series the chart plots so every
// number in the panel is mutually consistent (the model's own appr5yr uses Jan
// snapshots, which can differ slightly from the chart's endpoints). Falls back to
// the model's appr5yr when the series is unavailable.
function fiveYrChange(data: ZipData, series: SeriesBundle | null): number | null {
  const zs = series?.zip;
  if (zs && zs.length > 5) {
    const a = zs[zs.length - 1], b = zs[zs.length - 6];
    if (a != null && b != null && b > 0) return Math.round((a / b - 1) * 1000) / 10;
  }
  return data.appr5yr;
}

function ScoreGauge({ fill, big, sub, color, size = 132 }: { fill: number; big: string; sub: string; color: SignalColor; size?: number }) {
  const circ = 2 * Math.PI * 54;
  const [dash, setDash] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDash((fill / 100) * circ), 80);
    return () => clearTimeout(t);
  }, [fill, circ]);
  const scale = size / 152; // fonts scale with the ring; geometry stays in the 120 viewBox
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="60" cy="60" r="54" fill="none" stroke="var(--gauge-track)" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ stroke: color.stroke, transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
        <div style={{ fontSize: (big.length > 3 ? 32 : 46) * scale, fontWeight: 800, letterSpacing: "-0.03em", color: color.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{big}</div>
        <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 4, fontWeight: 500 }}>{sub}</div>
      </div>
    </div>
  );
}

function SignalBar({
  label, icon, value, display, barColor, description, delay,
}: {
  label: string;
  icon: IconName;
  value: number; // bar width 0-100
  display: string; // right-hand label text
  barColor: string;
  description: string;
  delay: number;
}) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink-soft)", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name={icon} size={14} style={{ color: barColor }} />
          {label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{display}</span>
      </div>
      <div style={{ height: 7, background: "var(--track)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${width}%`, background: barColor, borderRadius: 999, transition: "width 1.1s cubic-bezier(0.16,1,0.3,1)" }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 7, lineHeight: 1.5 }}>{description}</div>
    </div>
  );
}

// Bespoke inline-SVG home-value chart: the ZIP against its metro + national
// medians. Built by hand (no chart lib) so it reads as ours, not a template.
function PriceChart({ series, color }: { series: SeriesBundle; color: SignalColor }) {
  const { years, zip, metro, national } = series;
  const W = 440, H = 220, padL = 48, padR = 62, padT = 18, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseline = padT + plotH;

  const all = [...zip, ...(metro ?? []), ...national].filter((v): v is number => v != null);
  if (all.length < 2) return null;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || hi * 0.12;
  lo = Math.max(0, lo - pad);
  hi = hi + pad;

  const X = (i: number) => padL + (years.length <= 1 ? 0 : (i / (years.length - 1)) * plotW);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const pts = (arr: (number | null)[]) =>
    arr.map((v, i) => (v == null ? null : ([X(i), Y(v)] as [number, number]))).filter(Boolean) as [number, number][];
  const toPath = (p: [number, number][]) => p.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" ");

  const zp = pts(zip);
  const mp = metro ? pts(metro) : [];
  const np = pts(national);
  const area = zp.length ? `${toPath(zp)} L ${zp[zp.length - 1][0].toFixed(1)} ${baseline} L ${zp[0][0].toFixed(1)} ${baseline} Z` : "";
  const last = zp[zp.length - 1];

  const gridN = 3;
  const grid = Array.from({ length: gridN + 1 }, (_, k) => lo + (k / gridN) * (hi - lo));
  const firstIdx = Math.max(0, zip.findIndex((v) => v != null));
  const xTicks = Array.from(new Set([firstIdx, Math.round((firstIdx + years.length - 1) / 2), years.length - 1]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", height: "auto" }} role="img" aria-label="Home value history">
      <defs>
        <linearGradient id="zapChartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color.stroke, stopOpacity: 0.26 }} />
          <stop offset="100%" style={{ stopColor: color.stroke, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {grid.map((v, k) => (
        <g key={k}>
          <line x1={padL} y1={Y(v)} x2={W - padR} y2={Y(v)} style={{ stroke: "var(--border)" }} strokeWidth="1" />
          <text x={padL - 8} y={Y(v) + 3.5} textAnchor="end" style={{ fill: "var(--ink-faint)", fontFamily: "var(--mono)" }} fontSize="10">{fmtMoney(Math.round(v))}</text>
        </g>
      ))}
      {xTicks.map((i) => (
        <text key={i} x={X(i)} y={H - 10} textAnchor="middle" style={{ fill: "var(--ink-faint)", fontFamily: "var(--mono)" }} fontSize="10">{years[i]}</text>
      ))}
      {np.length > 1 && <path d={toPath(np)} fill="none" style={{ stroke: "var(--ink-faint)" }} strokeWidth="1.4" opacity="0.55" />}
      {mp.length > 1 && <path d={toPath(mp)} fill="none" style={{ stroke: "var(--ink-muted)" }} strokeWidth="1.4" strokeDasharray="4 4" />}
      {area && <path d={area} fill="url(#zapChartFill)" />}
      {zp.length > 1 && <path d={toPath(zp)} fill="none" style={{ stroke: color.stroke }} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
      {last && (
        <>
          <circle cx={last[0]} cy={last[1]} r="3.5" style={{ fill: color.stroke, stroke: "var(--surface)" }} strokeWidth="2" />
          <text x={last[0] + 8} y={last[1] - 8} style={{ fill: "var(--ink)", fontFamily: "var(--mono)" }} fontSize="11.5" fontWeight="700">{fmtMoney(series.latest)}</text>
        </>
      )}
    </svg>
  );
}

type Loaded = { data: ZipData; peers: ZipData[]; series: SeriesBundle | null };
// One settled fetch, tagged with the ZIP it answers so a stale one is ignored.
type Settled = { zip: string; loaded: Loaded | null; error: string | null };

export default function ZipAnalysisPanel({
  zip,
  place,
  onSelectZip,
  onClose,
}: {
  zip: string;
  /** "City, ST" label shown while the forecast loads. */
  place?: string;
  onSelectZip: (zip: string) => void;
  onClose: () => void;
}) {
  const { user, loading: authLoading } = useAuth();
  const [settled, setSettled] = useState<Settled | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Load the forecast for this ZIP (signed-in only). `cancelled` guards
  // out-of-order responses: a rapid second pick must win even if the first
  // request resolves last, so a stale response can't paint one ZIP's data
  // under another ZIP's header. Results are keyed by ZIP, so "loading" is
  // simply "no settled result for the ZIP being shown".
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    bodyRef.current?.scrollTo({ top: 0 });
    fetch(`/api/predict?zip=${encodeURIComponent(zip)}`)
      .then(async (r): Promise<Settled> => {
        if (r.status === 404) {
          return {
            zip,
            loaded: null,
            error: `We don't forecast ${zip}. We only score metro-area ZIPs with recent price history, so try a nearby ZIP.`,
          };
        }
        if (!r.ok) throw new Error("bad status");
        const j = (await r.json()) as { data: ZipData; metroPeers: ZipData[]; series: SeriesBundle | null };
        return { zip, loaded: { data: j.data, peers: j.metroPeers ?? [], series: j.series ?? null }, error: null };
      })
      .catch((): Settled => ({ zip, loaded: null, error: "Couldn't load that ZIP. Try again." }))
      .then((next) => {
        if (!cancelled) setSettled(next);
      });
    return () => {
      cancelled = true;
    };
  }, [zip, user]);

  const current = settled?.zip === zip ? settled : null;
  const loading = !current;
  const error = current?.error ?? null;
  const loaded = current?.loaded ?? null;

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const result = loaded?.data ?? null;
  const col = result ? getColor(result) : null;
  const headroom = result ? headroomOf(result.pctileMetro) : null;
  const series = loaded?.series ?? null;
  const fiveYr = result ? fiveYrChange(result, series) : null;
  const peers = loaded?.peers ?? [];

  return (
    <aside
      className={`zap${!authLoading && !user ? " zap--short" : ""}`}
      role="dialog"
      aria-label={`Analysis for ZIP ${zip}`}
      // The globe zooms on window wheel; keep scrolling the panel from also
      // zooming the map underneath it.
      onWheel={(e) => e.stopPropagation()}
    >
      <style>{ZAP_CSS}</style>

      <header className="zap-head">
        <div className="zap-headtext">
          <div className="zap-title">
            {result ? `${result.city}, ${result.state}` : place || `ZIP ${zip}`}
          </div>
          <div className="zap-sub">
            {result ? `${result.metro || result.county} · ${zip}` : `ZIP ${zip}`}
          </div>
        </div>
        <button type="button" className="zap-close" onClick={onClose} aria-label="Close analysis">
          <Icon name="x" size={16} />
        </button>
      </header>

      <div className="zap-body" ref={bodyRef}>
        {authLoading ? (
          <div className="zap-note">Loading…</div>
        ) : !user ? (
          <div className="zap-gate">
            <span className="zap-gate-icon">
              <Icon name="lock" size={20} />
            </span>
            <div className="zap-gate-title">Sign in to analyze {zip}</div>
            <div className="zap-gate-desc">
              Create a free account or sign in to see the forecast, price history, and
              metro comparison for any ZIP.
            </div>
            {/* Plain <a>: see the note on next/link at the top of GlobeLandingHero. */}
            <a
              href={`/login?next=${encodeURIComponent(`/?zip=${zip}`)}`}
              className="niq-btn niq-btn--sm"
            >
              Sign in
            </a>
          </div>
        ) : (
          <>
            {loading && <div className="zap-note">Loading forecast…</div>}
            {error && (
              <div className="niq-alert">
                <Icon name="alert" size={16} />
                {error}
              </div>
            )}

            {result && col && (
              <>
                {/* Score */}
                <section
                  className="niq-card zap-score"
                  style={{
                    background: `linear-gradient(180deg, color-mix(in srgb, ${col.stroke} 13%, var(--surface)), var(--surface) 70%)`,
                    borderColor: `color-mix(in srgb, ${col.stroke} 22%, var(--border))`,
                  }}
                >
                  <ScoreGauge fill={result.score} big={`${result.score}%`} sub="chance of rising" color={col} />
                  <div className="zap-score-side">
                    <span className="niq-badge" style={{ background: col.bg, color: col.text }}>{col.label}</span>
                    <div className="zap-score-line">Chance this ZIP&apos;s home value is higher in 2 years.</div>
                    <FavoriteButton zip={zip} />
                  </div>
                </section>
                {result.imputed && (
                  <div className="zap-imputed">
                    Limited price history here, so this estimate is partly modeled — treat it with extra caution.
                  </div>
                )}

                {/* The numbers that matter, in real dollars */}
                <div className="zap-kpis">
                  {[
                    { label: "Median value", value: fmtMoney(series?.latest ?? null), sub: series?.asOf ? fmtMonth(series.asOf) : "Zillow ZHVI", color: "var(--ink)" },
                    { label: "1-year", value: fmtPct(series?.yoy ?? null), sub: "trailing 12 mo", color: changeColor(series?.yoy ?? null) },
                    { label: "5-year", value: fmtPct(fiveYr), sub: "past 5 years", color: changeColor(fiveYr) },
                  ].map((t) => (
                    <div className="niq-card zap-kpi" key={t.label}>
                      <div className="zap-kpi-label">{t.label}</div>
                      <div className="zap-kpi-value" style={{ color: t.color }}>{t.value}</div>
                      <div className="zap-kpi-sub">{t.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Home-value history — this ZIP vs. its metro & the U.S. */}
                {series && series.zip.some((v) => v != null) && (
                  <section className="niq-card zap-card">
                    <div className="zap-cardhead">
                      <div className="zap-cardtitle">Home-value history</div>
                      <div className="niq-chart-legend">
                        <span className="niq-leg"><i style={{ background: col.stroke }} /> {zip}</span>
                        <span className="niq-leg"><i className="niq-leg--dash" /> Metro</span>
                        <span className="niq-leg"><i style={{ background: "var(--ink-faint)" }} /> U.S.</span>
                      </div>
                    </div>
                    <PriceChart series={series} color={col} />
                  </section>
                )}

                {/* Why this score — the model's inputs */}
                <section className="niq-card zap-card">
                  <div className="zap-cardtitle">Why this score</div>
                  <div className="zap-cardsub">What&apos;s driving the 2-year rise estimate</div>
                  {headroom != null && (
                    <SignalBar label="Affordability headroom" icon="wallet" value={headroom} display={`${headroom}/100`} barColor="var(--moderate)" description="Cheaper-than-its-metro ZIPs have the most room to rise, a major driver of the model's top picks" delay={100} />
                  )}
                  {fiveYr != null && (
                    <SignalBar label="Past 5-yr appreciation" icon="trending-up" value={normAppr(fiveYr)} display={fmtPct(fiveYr)} barColor="var(--strong)" description="Actual Zillow home-value change over the last 5 years" delay={200} />
                  )}
                  {series?.yoy != null && (
                    <SignalBar label="Recent momentum" icon="zap" value={normMomentum(series.yoy)} display={fmtPct(series.yoy)} barColor="var(--blue)" description="Year-over-year change, trailing 12 months" delay={300} />
                  )}
                </section>

                {/* Metro comparison */}
                {peers.length > 0 && (
                  <section className="niq-card zap-card">
                    <div className="niq-peers-title">
                      <Icon name="trending-up" size={13} style={{ color: "var(--accent-ink)" }} />
                      Most likely to rise in {result.metro || "this area"}
                    </div>
                    <div className="niq-peers-list">
                      {peers.map((d) => {
                        const c2 = getColor(d);
                        return (
                          <div key={d.zip} className="niq-zip-card" onClick={() => onSelectZip(d.zip)}>
                            <div className="niq-zip-top">
                              <span className="niq-zip-code">{d.zip}</span>
                              <span className="niq-zip-score" style={{ color: c2.text }} title="chance of rising over the next 2 years">{d.score}%</span>
                            </div>
                            <div className="niq-zip-name">{d.city}, {d.state}</div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Ask AI about this ZIP */}
                <ChatPanel zip={zip} name={`${result.city}, ${result.state}`} city={result.metro || result.county} data={result} />
              </>
            )}

            <SavedSection onSelect={onSelectZip} />
          </>
        )}
      </div>
    </aside>
  );
}

/* Scoped styles — namespaced under `.zap` like the other landing components.
   The cards inside borrow the global niq-* look (surface, borders, badges). */
const ZAP_CSS = `
.zap {
  position: fixed; z-index: 30;
  top: 72px; right: 20px; bottom: 20px;
  width: min(430px, calc(100vw - 32px));
  display: flex; flex-direction: column;
  background: rgba(10,18,32,0.92); backdrop-filter: blur(14px);
  border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  color: var(--ink); text-align: left;
  animation: zapIn 0.35s cubic-bezier(0.16,1,0.3,1) both;
}
/* signed out: just the sign-in prompt, so hug its content */
.zap--short { bottom: auto; }
@keyframes zapIn { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
@media (max-width: 720px) {
  .zap { top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 82vh; }
  @keyframes zapIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
}
@media (prefers-reduced-motion: reduce) { .zap { animation: none; } }

.zap-head {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 16px 14px 20px; border-bottom: 1px solid var(--border);
}
.zap-headtext { flex: 1; min-width: 0; }
.zap-title { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
.zap-sub { font-size: 12.5px; color: var(--ink-muted); margin-top: 3px; }
.zap-close {
  flex-shrink: 0; width: 32px; height: 32px; display: grid; place-items: center;
  background: transparent; border: 1px solid var(--border); border-radius: 9px;
  color: var(--ink-soft); cursor: pointer; transition: background 0.15s ease;
}
.zap-close:hover { background: var(--accent-soft); }

.zap-body {
  flex: 1; overflow-y: auto; overscroll-behavior: contain;
  padding: 16px 16px 20px; display: flex; flex-direction: column; gap: 14px;
}
.zap-note { font-size: 13px; color: var(--ink-muted); }

.zap-gate { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 28px 12px; }
.zap-gate-icon {
  width: 44px; height: 44px; display: grid; place-items: center;
  border-radius: 50%; background: var(--accent-soft); color: var(--accent-ink);
}
.zap-gate-title { font-size: 16px; font-weight: 700; }
.zap-gate-desc { font-size: 13px; line-height: 1.55; color: var(--ink-muted); max-width: 300px; margin-bottom: 4px; }

.zap-score { display: flex; align-items: center; gap: 18px; padding: 18px; }
.zap-score-side { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; }
.zap-score-line { font-size: 12.5px; line-height: 1.5; color: var(--ink-muted); }
.zap-imputed { font-size: 11.5px; font-style: italic; color: var(--ink-faint); margin-top: -4px; }

.zap-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.zap-kpi { padding: 13px 14px; }
.zap-kpi-label {
  font-family: var(--mono); font-size: 9.5px; text-transform: uppercase;
  letter-spacing: 0.12em; color: var(--ink-muted); margin-bottom: 9px;
}
.zap-kpi-value { font-size: 21px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.zap-kpi-sub { font-size: 11px; color: var(--ink-faint); margin-top: 7px; }

.zap-card { padding: 18px; }
.zap-cardhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.zap-cardtitle { font-size: 14.5px; font-weight: 700; letter-spacing: -0.01em; }
.zap-cardsub { font-size: 12px; color: var(--ink-muted); margin: 4px 0 16px; }
.zap-card .niq-peers-title { margin-bottom: 12px; }
`;
