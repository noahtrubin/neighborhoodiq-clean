"use client";

// NeighborhoodIQ — Neighborhood Gentrification Predictor
// Forward-looking 5-year forecast (scored from the latest available data year).
// Model: L2 logistic regression on cheap-for-its-metro/state Zillow features
// (chosen over a RandomForest in an out-of-time A/B for equal skill + far more
// stable rankings). The score is a RELATIVE RANKING, not a calibrated probability.
// Out-of-time skill is modest (AUC ~0.60); raw "accuracy" equals the base rate.
// See model-refresh/evaluate.py + diagnostics.py for the honest validation.

import { useEffect, useState } from "react";
import Header from "./components/Header";
import Icon, { type IconName } from "./components/Icon";
import FavoriteButton from "./FavoriteButton";
import ChatPanel from "./ChatPanel";
import FavoritesList from "./FavoritesList";
import SavedChats from "./SavedChats";
import type { ZipData } from "./lib/types";

type SignalColor = { stroke: string; text: string; bg: string; label: string };

// Colors are CSS variables so they retune automatically between light/dark.
// Tiering is by national RANK (percentile) when available — the honest headline
// metric — falling back to the raw score only if a record predates `rank`.
const STRONG: SignalColor = { stroke: "var(--strong)", text: "var(--strong-ink)", bg: "var(--strong-bg)", label: "TOP 10% NATIONALLY" };
const MODERATE: SignalColor = { stroke: "var(--moderate)", text: "var(--moderate-ink)", bg: "var(--moderate-bg)", label: "TOP 25% NATIONALLY" };
const MODEST: SignalColor = { stroke: "var(--weak)", text: "var(--weak-ink)", bg: "var(--weak-bg)", label: "MODEST OUTLOOK" };
function getColor(d: ZipData): SignalColor {
  if (d.rank != null) return d.rank >= 90 ? STRONG : d.rank >= 75 ? MODERATE : MODEST;
  return d.score >= 44 ? STRONG : d.score >= 30 ? MODERATE : MODEST; // legacy fallback
}
// "ranks above r% of ZIPs" -> "top (100-r)%", floored at 1 so the best reads "Top 1%".
const topPctOf = (rank: number) => Math.max(1, 100 - rank);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fmtPct = (n: number | null) => (n == null ? "n/a" : `${n > 0 ? "+" : ""}${n}%`);
const normMomentum = (n: number) => Math.round(clamp(((n + 10) / 35) * 100, 3, 100));
const normAppr = (n: number) => Math.round(clamp((n / 200) * 100, 3, 100));
const headroomOf = (pctile: number | null) => (pctile == null ? null : 100 - pctile);

function buildSummary(d: ZipData): string {
  const where = d.metro || d.county || "its area";
  let headroom = "";
  if (d.pctileMetro != null) {
    if (d.pctileMetro <= 25)
      headroom = `It's among the cheapest ZIPs in ${where} (about the ${d.pctileMetro}th price percentile), which historically leaves the most room to appreciate. `;
    else if (d.pctileMetro >= 75)
      headroom = `It's already one of the pricier ZIPs in ${where}, so there's less untapped headroom. `;
    else headroom = `It sits mid-range on price within ${where}. `;
  }
  const appr =
    d.appr5yr == null
      ? ""
      : `Home values ${d.appr5yr >= 0 ? "rose" : "fell"} ${Math.abs(d.appr5yr)}% over the last 5 years. `;
  const verdict =
    d.rank != null
      ? `ranks ${d.city} in the top ${Math.max(1, 100 - d.rank)}% of U.S. metro ZIPs for five-year appreciation odds`
      : `scores ${d.city} ${d.score}/100 for five-year appreciation odds`;
  return `${headroom}${appr}The model ${verdict}. It's a relative ranking, not a guarantee of a 60%+ rise.`;
}

function ScoreGauge({ fill, big, sub, color }: { fill: number; big: string; sub: string; color: SignalColor }) {
  const circ = 2 * Math.PI * 54;
  const [dash, setDash] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDash((fill / 100) * circ), 80);
    return () => clearTimeout(t);
  }, [fill, circ]);
  return (
    <div style={{ position: "relative", width: 152, height: 152 }}>
      <svg width="152" height="152" viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
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
        <div style={{ fontSize: big.length > 3 ? 30 : 42, fontWeight: 800, letterSpacing: "-0.03em", color: color.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{big}</div>
        <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 3, fontWeight: 500 }}>{sub}</div>
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
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
        <span style={{ fontSize: 13.5, color: "var(--ink-soft)", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name={icon} size={15} style={{ color: barColor }} />
          {label}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{display}</span>
      </div>
      <div style={{ height: 8, background: "var(--track)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${width}%`, background: barColor, borderRadius: 999, transition: "width 1s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 6, lineHeight: 1.45 }}>{description}</div>
    </div>
  );
}

// Plain-English guide to reading the 0–100 score. Numbers are from the
// out-of-time backtest (see model-refresh/evaluate.py + diagnostics.py):
// top picks appreciated ~2–3× the ~25% base rate.
const SCORE_MEANING: { lead: string; body: string }[] = [
  {
    lead: "It’s a relative rank, not a prediction.",
    body:
      "A score of 80 means this ZIP ranks in the top 20% for appreciation potential, not that it has an 80% chance of going up.",
  },
  {
    lead: "It favors underpriced areas.",
    body:
      "The model looks for ZIPs that are cheaper than their neighbors but gaining momentum, the classic early-mover signal.",
  },
  {
    lead: "Use it as a starting point.",
    body:
      "Top-scoring ZIPs appreciated at 2 to 3× the base rate in backtesting. But no model beats doing your homework, so check schools, commute, and crime too.",
  },
];

export default function NeighborhoodIQ() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ZipData | null>(null);
  const [peers, setPeers] = useState<ZipData[]>([]);
  const [currentZip, setCurrentZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = async (zip: string, known?: ZipData) => {
    setError(null);
    setQuery(zip);
    setCurrentZip(zip);
    if (known) { setResult(known); setPeers([]); }
    setLoading(true);
    try {
      const r = await fetch(`/api/predict?zip=${zip}`);
      if (r.status === 404) {
        setResult(null);
        setPeers([]);
        setError(`We don't forecast ${zip}. We only score metro-area ZIPs with recent price history, so try a nearby ZIP.`);
      } else if (!r.ok) {
        throw new Error("bad status");
      } else {
        const { data, metroPeers } = (await r.json()) as { data: ZipData; metroPeers: ZipData[] };
        setResult(data);
        setPeers(metroPeers ?? []);
      }
    } catch {
      setError("Couldn't load that ZIP. Try again.");
    }
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
        {/* Compact tool header */}
        <div className="niq-hero">
          <h1>Search any U.S. neighborhood.</h1>
          <p>
            Enter a ZIP code to see its five-year appreciation forecast, the
            signals behind it, and how it ranks against its metro.
          </p>
        </div>

        {/* Search */}
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
          </button>
        </div>

        <div className="niq-subnote">
          Scores update monthly · Based on Zillow price data · Not a guarantee
        </div>

        {loading && <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 10 }}>Loading forecast…</div>}
        {error && (
          <div className="niq-alert">
            <Icon name="alert" size={16} />
            {error}
          </div>
        )}

        {/* Empty state: nothing is loaded until the user searches */}
        {!result && !loading && !error && (
          <div className="niq-empty">
            <span className="niq-empty-icon">
              <Icon name="search" size={22} />
            </span>
            <div className="niq-empty-title">Search a ZIP to see its forecast</div>
            <div className="niq-empty-sub">
              Type any U.S. metro ZIP code above. Try 11216, 78702, or 60647.
            </div>
          </div>
        )}

        {/* Result */}
        {result && col && (
          <>
            <div className="niq-result-grid">
              {/* Score card */}
              <div className="niq-card niq-score-card">
                <ScoreGauge
                  fill={result.rank ?? result.score}
                  big={result.rank != null ? `Top ${topPctOf(result.rank)}%` : String(result.score)}
                  sub={result.rank != null ? "of U.S. metro ZIPs" : "out of 100"}
                  color={col}
                />
                <span className="niq-badge" style={{ background: col.bg, color: col.text }}>{col.label}</span>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>{result.city}, {result.state}</div>
                  <div style={{ fontSize: 13.5, color: "var(--ink-muted)", marginTop: 1 }}>{result.metro || result.county} · {currentZip}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 6 }}>5-year appreciation outlook · outlook score {result.score}/100</div>
                  {result.imputed && (
                    <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6, fontStyle: "italic" }}>
                      Limited price history here, so this score is partly estimated. Treat it with extra caution.
                    </div>
                  )}
                  <div style={{ marginTop: 14 }}><FavoriteButton zip={currentZip} /></div>
                </div>
              </div>

              {/* Signals card */}
              <div className="niq-card niq-signals-card">
                <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 3 }}>Why this score</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 18 }}>5-year outlook, based on the latest available price history</div>
                {headroom != null && (
                  <SignalBar label="Affordability headroom" icon="wallet" value={headroom} display={`${headroom}/100`} barColor="var(--moderate)" description="Cheaper-than-its-metro ZIPs have the most room to rise, a major driver of the model's top picks" delay={100} />
                )}
                {result.appr5yr != null && (
                  <SignalBar label="Past 5-yr appreciation" icon="trending-up" value={normAppr(result.appr5yr)} display={fmtPct(result.appr5yr)} barColor="var(--strong)" description="Actual Zillow home-value change over the last 5 years" delay={200} />
                )}
                {result.momentum != null && (
                  <SignalBar label="Recent momentum" icon="zap" value={normMomentum(result.momentum)} display={fmtPct(result.momentum)} barColor="var(--blue)" description="Year-over-year change in the latest year of our data (not a live price)" delay={300} />
                )}
                <div style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.6, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>{buildSummary(result)}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="check" size={13} style={{ color: "var(--accent-ink)" }} />
                  A ranking of appreciation odds, not a guarantee · out-of-time backtest AUC ≈ 0.63 across past 5-year episodes
                </div>
              </div>
            </div>

            {/* Ask AI about this ZIP */}
            <ChatPanel zip={currentZip} name={`${result.city}, ${result.state}`} city={result.metro || result.county} data={result} />

            {/* Comparable neighborhoods in the same metro */}
            {peers.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div className="niq-city-label" style={{ marginTop: 0 }}>Top ZIPs in {result.metro || "this area"}</div>
                <div className="niq-comp-grid">
                  {peers.map((d) => {
                    const c2 = getColor(d);
                    return (
                      <div key={d.zip} className="niq-zip-card" onClick={() => show(d.zip, d)}>
                        <div className="niq-zip-top">
                          <span className="niq-zip-code">{d.zip}</span>
                          <span className="niq-zip-score" style={{ color: c2.text }} title="U.S. percentile rank">{d.rank != null ? `${d.rank}%` : d.score}</span>
                        </div>
                        <div className="niq-zip-name">{d.city}, {d.state}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* How to read your score — only shown once a result is loaded */}
            <div id="score-meaning" className="niq-guide">
              <div className="niq-guide-title">How to read your score</div>
              <div className="niq-guide-items">
                {SCORE_MEANING.map((s, i) => (
                  <div key={s.lead} className="niq-guide-item">
                    <span className="niq-guide-num">{i + 1}</span>
                    <div>
                      <div className="niq-guide-lead">{s.lead}</div>
                      <p className="niq-guide-body">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div id="favorites" className="niq-section">
          <FavoritesList onSelect={(z) => show(z)} />
        </div>

        <SavedChats />
      </main>
    </>
  );
}
