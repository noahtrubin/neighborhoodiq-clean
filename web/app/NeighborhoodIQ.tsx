"use client";

// NeighborhoodIQ — will this neighborhood's home value rise?
// The score is a CALIBRATED probability (0-100%) that a ZIP's Zillow home value is
// higher in 2 years than today, from an isotonic-calibrated gradient-boosted model
// on real Zillow data (affordability vs metro + price momentum). "Calibrated" means
// honest: ZIPs it rates ~80% actually rose ~80% of the time in out-of-time backtest
// (AUC ~0.66, ~0.72 recent). Most neighborhoods rise (high base rate), so the real
// value is the probability spread + flagging the ~10-15% at genuine risk of falling.
// It reads current conditions; it cannot foresee a macro shock. See evaluate.py /
// sanity_check.py for the honest validation you can reproduce.

import { useEffect, useRef, useState } from "react";
import Header from "./components/Header";
import Icon, { type IconName } from "./components/Icon";
import FavoriteButton from "./FavoriteButton";
import ChatPanel from "./ChatPanel";
import FavoritesList from "./FavoritesList";
import SavedChats from "./SavedChats";
import type { SeriesBundle, ZipData } from "./lib/types";

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

function ScoreGauge({ fill, big, sub, color, size = 176 }: { fill: number; big: string; sub: string; color: SignalColor; size?: number }) {
  const circ = 2 * Math.PI * 54;
  const [dash, setDash] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDash((fill / 100) * circ), 80);
    return () => clearTimeout(t);
  }, [fill, circ]);
  const scale = size / 152; // fonts scale with the ring; geometry stays in the 120 viewBox
  return (
    <div style={{ position: "relative", width: size, height: size }}>
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
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 4, fontWeight: 500 }}>{sub}</div>
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
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
        <span style={{ fontSize: 14, color: "var(--ink-soft)", fontWeight: 500, display: "flex", alignItems: "center", gap: 9 }}>
          <Icon name={icon} size={15} style={{ color: barColor }} />
          {label}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{display}</span>
      </div>
      <div style={{ height: 8, background: "var(--track)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${width}%`, background: barColor, borderRadius: 999, transition: "width 1.1s cubic-bezier(0.16,1,0.3,1)" }} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-muted)", marginTop: 8, lineHeight: 1.55 }}>{description}</div>
    </div>
  );
}

// ---- Recently viewed (persisted in localStorage) ---------------------------
type RecentZip = { zip: string; city: string; state: string; rank: number | null; score: number };
const RECENT_KEY = "niq:recent";
function loadRecent(): RecentZip[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.slice(0, 6) : [];
  } catch {
    return [];
  }
}
function pushRecent(zip: string, d: ZipData): RecentZip[] {
  const entry: RecentZip = { zip, city: d.city, state: d.state, rank: d.rank ?? null, score: d.score };
  const next = [entry, ...loadRecent().filter((r) => r.zip !== zip)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — non-fatal */
  }
  return next;
}

// Plain-language model explainer, surfaced as a visible popover so the trust +
// coverage story isn't buried in fine print.
function ModelInfo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="niq-modelinfo">
      <button className="niq-info-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="niq-info-i" aria-hidden>i</span>
        How the score works
      </button>
      {open && (
        <>
          <div className="niq-info-backdrop" onClick={() => setOpen(false)} />
          <div className="niq-info-pop" role="dialog" aria-label="How the score works">
            <h4>How the score works</h4>
            <div className="niq-info-row"><span className="niq-info-dot" /><div><b>What it is.</b> The <b>calibrated chance</b> this ZIP's home value is higher in 2 years than today. When we say 80%, about 80% of such ZIPs actually rose in backtest.</div></div>
            <div className="niq-info-row"><span className="niq-info-dot" /><div><b>The data.</b> 20+ years of real Zillow ZIP-level home values: price momentum (how fast it's rising) and affordability versus the local metro. Nothing else.</div></div>
            <div className="niq-info-row"><span className="niq-info-dot" /><div><b>Read it right.</b> Most neighborhoods rise, so most read high — the signal is the number and the <b>Elevated&nbsp;risk</b> flag on the ~10–15% likelier to stall or fall.</div></div>
            <div className="niq-info-row"><span className="niq-info-dot" /><div><b>How good is it?</b> Out-of-time backtest AUC ≈ 0.66 (≈0.72 recent). It reads today's conditions — it can't foresee a rate shock or crash. A guide, not a guarantee.</div></div>
          </div>
        </>
      )}
    </div>
  );
}

// The "numbers that matter" band — actual dollars, not abstractions.
// The 5-year change, derived from the SAME annual series the chart plots so every
// number on the page is mutually consistent (the model's own appr5yr uses Jan
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

function KpiBand({ data, series, col }: { data: ZipData; series: SeriesBundle | null; col: SignalColor }) {
  const fiveYr = fiveYrChange(data, series);
  const tiles = [
    { label: "Median home value", value: fmtMoney(series?.latest ?? null), sub: series?.asOf ? `Zillow ZHVI · ${fmtMonth(series.asOf)}` : "Zillow ZHVI", color: "var(--ink)" },
    { label: "1-year change", value: fmtPct(series?.yoy ?? null), sub: "trailing 12 months", color: changeColor(series?.yoy ?? null) },
    { label: "5-year change", value: fmtPct(fiveYr), sub: "past 5 years", color: changeColor(fiveYr) },
    { label: "Chance of rising", value: `${data.score}%`, sub: "next 2 years", color: col.text },
  ];
  return (
    <div className="niq-kpiband">
      {tiles.map((t) => (
        <div className="niq-card niq-kpi" key={t.label}>
          <div className="niq-kpi-label">{t.label}</div>
          <div className="niq-kpi-value" style={{ color: t.color }}>{t.value}</div>
          <div className="niq-kpi-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// Secondary context: where this ZIP's rise-likelihood sits in the national spread.
function PercentileStrip({ rank, color }: { rank: number; color: SignalColor }) {
  return (
    <div className="niq-pctile">
      <div className="niq-pctile-cap">
        More likely to rise than <b style={{ color: color.text }}>{Math.min(99, rank)}%</b> of U.S. metro ZIPs
      </div>
      <div className="niq-pctile-track">
        <span className="niq-pctile-marker" style={{ left: `${rank}%`, background: color.stroke }} />
      </div>
      <div className="niq-pctile-ends">
        <span>most at risk</span>
        <span>most likely to rise</span>
      </div>
    </div>
  );
}

// Bespoke inline-SVG home-value chart: the ZIP against its metro + national
// medians. Built by hand (no chart lib) so it reads as ours, not a template.
function PriceChart({ series, color }: { series: SeriesBundle; color: SignalColor }) {
  const { years, zip, metro, national } = series;
  const W = 860, H = 300, padL = 62, padR = 78, padT = 22, padB = 40;
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

  const gridN = 4;
  const grid = Array.from({ length: gridN + 1 }, (_, k) => lo + (k / gridN) * (hi - lo));
  const firstIdx = Math.max(0, zip.findIndex((v) => v != null));
  const xTicks = Array.from(new Set([firstIdx, Math.round((firstIdx + years.length - 1) / 2), years.length - 1]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", height: "auto" }} role="img" aria-label="Home value history">
      <defs>
        <linearGradient id="niqChartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color.stroke, stopOpacity: 0.26 }} />
          <stop offset="100%" style={{ stopColor: color.stroke, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {grid.map((v, k) => (
        <g key={k}>
          <line x1={padL} y1={Y(v)} x2={W - padR} y2={Y(v)} style={{ stroke: "var(--border)" }} strokeWidth="1" />
          <text x={padL - 10} y={Y(v) + 3.5} textAnchor="end" style={{ fill: "var(--ink-faint)", fontFamily: "var(--mono)" }} fontSize="10.5">{fmtMoney(Math.round(v))}</text>
        </g>
      ))}
      {xTicks.map((i) => (
        <text key={i} x={X(i)} y={H - 14} textAnchor="middle" style={{ fill: "var(--ink-faint)", fontFamily: "var(--mono)" }} fontSize="10.5">{years[i]}</text>
      ))}
      {np.length > 1 && <path d={toPath(np)} fill="none" style={{ stroke: "var(--ink-faint)" }} strokeWidth="1.5" opacity="0.55" />}
      {mp.length > 1 && <path d={toPath(mp)} fill="none" style={{ stroke: "var(--ink-muted)" }} strokeWidth="1.5" strokeDasharray="4 4" />}
      {area && <path d={area} fill="url(#niqChartFill)" />}
      {zp.length > 1 && <path d={toPath(zp)} fill="none" style={{ stroke: color.stroke }} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />}
      {last && (
        <>
          <circle cx={last[0]} cy={last[1]} r="4" style={{ fill: color.stroke, stroke: "var(--surface)" }} strokeWidth="2.5" />
          <text x={last[0] + 9} y={last[1] - 9} style={{ fill: "var(--ink)", fontFamily: "var(--mono)" }} fontSize="12.5" fontWeight="700">{fmtMoney(series.latest)}</text>
        </>
      )}
    </svg>
  );
}

export default function NeighborhoodIQ() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ZipData | null>(null);
  const [peers, setPeers] = useState<ZipData[]>([]);
  const [currentZip, setCurrentZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Home-value history for the chart + KPI row (loaded with each result).
  const [series, setSeries] = useState<SeriesBundle | null>(null);
  // Persisted recently-viewed ZIPs, shown as quick-return chips pre-search.
  const [recent, setRecent] = useState<RecentZip[]>([]);

  // Hydrate recently-viewed, and honor deep links from the landing globe
  // (/dashboard?zip=48430 → load that ZIP's full forecast immediately).
  // Monotonic id for the in-flight /api/predict request, so a superseded
  // response can't overwrite the latest search's data (see `show`).
  const reqIdRef = useRef(0);

  useEffect(() => {
    setRecent(loadRecent());
    const z = new URLSearchParams(window.location.search).get("zip");
    if (z && /^\d{5}$/.test(z)) show(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const show = async (zip: string, known?: ZipData) => {
    // Guard against out-of-order responses: a rapid second search must win even
    // if the first request resolves last, so a stale response can't paint one
    // ZIP's data under another ZIP's header. Every setter past an `await` is
    // gated on this request still being the latest.
    const reqId = ++reqIdRef.current;
    setError(null);
    setSeries(null);
    setQuery(zip);
    setCurrentZip(zip);
    if (known) { setResult(known); setPeers([]); }
    setLoading(true);
    try {
      const r = await fetch(`/api/predict?zip=${zip}`);
      if (reqIdRef.current !== reqId) return; // superseded by a newer search
      if (r.status === 404) {
        setResult(null);
        setPeers([]);
        setError(`We don't forecast ${zip}. We only score metro-area ZIPs with recent price history, so try a nearby ZIP.`);
      } else if (!r.ok) {
        throw new Error("bad status");
      } else {
        const { data, metroPeers, series: hist } = (await r.json()) as {
          data: ZipData;
          metroPeers: ZipData[];
          series: SeriesBundle | null;
        };
        if (reqIdRef.current !== reqId) return; // superseded while parsing
        setResult(data);
        setPeers(metroPeers ?? []);
        setSeries(hist ?? null);
        setRecent(pushRecent(zip, data));
      }
    } catch {
      if (reqIdRef.current !== reqId) return;
      setError("Couldn't load that ZIP. Try again.");
    }
    if (reqIdRef.current !== reqId) return; // let the winning request own loading/scroll
    setLoading(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSearch = () => {
    const zip = query.trim();
    setError(null);
    if (!/^\d{5}$/.test(zip)) { setError("Enter a 5-digit zip code."); return; }
    show(zip);
  };

  const col = result ? getColor(result) : null;
  const headroom = result ? headroomOf(result.pctileMetro) : null;

  return (
    <>
      <Header />
      <main className="niq-shell">
        {/* Top command area: centered hero + search */}
        <div className="niq-toolbar">
          <div className="niq-hero">
            <span className="niq-eyebrow">
              <span className="niq-eyebrow-dot" />
              The honest neighborhood dashboard
            </span>
            <h1>Search any U.S. neighborhood.</h1>
            <p>
              Enter a ZIP code to see what homes cost, whether prices are rising
              or cooling, and how it compares to its metro — plus an honest read
              on the risk. Real Zillow data, no hype.
            </p>
          </div>

          <div className="niq-search">
            <div className="niq-input-wrap">
              <Icon name="search" size={18} />
              <input
                className="niq-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Enter any U.S. zip code, e.g. 66607, 08104, 11216"
                maxLength={5}
                aria-label="U.S. ZIP code"
              />
            </div>
            <button className="niq-btn" onClick={handleSearch}>
              Analyze
              <span className="niq-btn-ico">
                <Icon name="arrow-right" size={14} />
              </span>
            </button>
          </div>

          <div className="niq-trust">
            <ModelInfo />
            <div className="niq-subnote">
              Updated monthly · Zillow price history · Not a guarantee
            </div>
          </div>
        </div>

        {loading && <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 10 }}>Loading forecast…</div>}
        {error && (
          <div className="niq-alert">
            <Icon name="alert" size={16} />
            {error}
          </div>
        )}

        {/* Empty state: quiet — quick jumps + your recent ZIPs */}
        {!result && !loading && !error && (
          <div className="niq-empty">
            <div className="niq-empty-block">
              <div className="niq-empty-label">Try a ZIP</div>
              <div className="niq-empty-chips">
                {["78702", "60647", "66607", "08104"].map((z) => (
                  <button key={z} className="niq-example-chip" onClick={() => show(z)}>
                    <Icon name="search" size={13} />
                    {z}
                  </button>
                ))}
              </div>
            </div>

            {recent.length > 0 && (
              <div className="niq-empty-block">
                <div className="niq-empty-label">Recently viewed</div>
                <div className="niq-recent-chips">
                  {recent.map((r) => (
                    <button key={r.zip} className="niq-recent-chip" onClick={() => show(r.zip)}>
                      <b>{r.zip}</b>
                      {r.city ? `${r.city}, ${r.state}` : r.state}
                      <span className="niq-recent-rank">{r.score}%</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {result && col && (
          <div className="niq-dash">
            {/* KPI band — the numbers that matter, in real dollars */}
            <KpiBand data={result} series={series} col={col} />

            {/* Home-value history — facts first: this ZIP vs. its metro & the U.S. */}
            {series && series.zip.some((v) => v != null) && (
              <div className="niq-card niq-chart-card">
                <div className="niq-chart-head">
                  <div>
                    <div className="niq-chart-title">Home-value history</div>
                    <div className="niq-chart-sub">Zillow Home Value Index · {result.city} vs. its metro &amp; the U.S.</div>
                  </div>
                  <div className="niq-chart-legend">
                    <span className="niq-leg"><i style={{ background: col.stroke }} /> {currentZip}</span>
                    <span className="niq-leg"><i className="niq-leg--dash" /> Metro</span>
                    <span className="niq-leg"><i style={{ background: "var(--ink-faint)" }} /> U.S.</span>
                  </div>
                </div>
                <PriceChart series={series} color={col} />
              </div>
            )}

            {/* The read: calibrated chance of rising · why · metro comparison */}
            <div className={`niq-dash-top${peers.length > 0 ? " has-rail" : ""}`}>
              {/* Score card */}
              <div
                className="niq-card niq-score-card"
                style={{
                  background: `linear-gradient(180deg, color-mix(in srgb, ${col.stroke} 13%, var(--surface)), var(--surface) 60%)`,
                  borderColor: `color-mix(in srgb, ${col.stroke} 22%, var(--border))`,
                }}
              >
                <ScoreGauge
                  fill={result.score}
                  big={`${result.score}%`}
                  sub="chance of rising · next 2 yrs"
                  color={col}
                />
                <span className="niq-badge" style={{ background: col.bg, color: col.text }}>{col.label}</span>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>{result.city}, {result.state}</div>
                  <div style={{ fontSize: 13.5, color: "var(--ink-muted)", marginTop: 2 }}>{result.metro || result.county} · {currentZip}</div>
                </div>
                {result.rank != null && <PercentileStrip rank={result.rank} color={col} />}
                {result.imputed && (
                  <div style={{ fontSize: 11, color: "var(--ink-faint)", fontStyle: "italic", textAlign: "center", maxWidth: 240 }}>
                    Limited price history here, so this estimate is partly modeled — treat it with extra caution.
                  </div>
                )}
                <FavoriteButton zip={currentZip} />
              </div>

              {/* Why this score — the model's inputs (paragraph trimmed away) */}
              <div className="niq-card niq-signals-card">
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 5 }}>Why this score</div>
                <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 24 }}>What's driving the 2-year rise estimate</div>
                {headroom != null && (
                  <SignalBar label="Affordability headroom" icon="wallet" value={headroom} display={`${headroom}/100`} barColor="var(--moderate)" description="Cheaper-than-its-metro ZIPs have the most room to rise, a major driver of the model's top picks" delay={100} />
                )}
                {fiveYrChange(result, series) != null && (
                  <SignalBar label="Past 5-yr appreciation" icon="trending-up" value={normAppr(fiveYrChange(result, series)!)} display={fmtPct(fiveYrChange(result, series))} barColor="var(--strong)" description="Actual Zillow home-value change over the last 5 years" delay={200} />
                )}
                {series?.yoy != null && (
                  <SignalBar label="Recent momentum" icon="zap" value={normMomentum(series.yoy)} display={fmtPct(series.yoy)} barColor="var(--blue)" description="Year-over-year change, trailing 12 months" delay={300} />
                )}
                <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 12, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="check" size={13} style={{ color: "var(--accent-ink)" }} />
                  A calibrated chance of rising, not a guarantee · out-of-time backtest AUC ≈ 0.66
                </div>
              </div>

              {/* Metro comparison rail */}
              {peers.length > 0 && (
                <aside className="niq-card niq-peers-card">
                  <div className="niq-peers-title">
                    <Icon name="trending-up" size={13} style={{ color: "var(--accent-ink)" }} />
                    Most likely to rise in {result.metro || "this area"}
                  </div>
                  <div className="niq-peers-list">
                    {peers.map((d) => {
                      const c2 = getColor(d);
                      return (
                        <div key={d.zip} className="niq-zip-card" onClick={() => show(d.zip, d)}>
                          <div className="niq-zip-top">
                            <span className="niq-zip-code">{d.zip}</span>
                            <span className="niq-zip-score" style={{ color: c2.text }} title="chance of rising over the next 2 years">{d.score}%</span>
                          </div>
                          <div className="niq-zip-name">{d.city}, {d.state}</div>
                        </div>
                      );
                    })}
                  </div>
                </aside>
              )}
            </div>

            {/* Ask AI about this ZIP — full width */}
            <ChatPanel zip={currentZip} name={`${result.city}, ${result.state}`} city={result.metro || result.county} data={result} />
          </div>
        )}

        <div id="favorites" className="niq-section">
          <FavoritesList onSelect={(z) => show(z)} />
        </div>

        <SavedChats />
      </main>
    </>
  );
}
