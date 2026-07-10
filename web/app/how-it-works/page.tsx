import type { Metadata } from "next";
import Logo from "../components/Logo";

// "What we're doing" — a plain-language explainer for the NeighborhoodIQ model:
// what the score is, the signals behind it, the data it's trained on, how to read
// it, and who it's for. Static server component; uses the light glx-* design
// system already in globals.css. Plain <a> for links (full navigations are fine
// on a marketing page, and it avoids the next/link Turbopack quirk in 16.2.9).

export const metadata: Metadata = {
  title: "How it works · NeighborhoodIQ",
  description:
    "How NeighborhoodIQ estimates the chance every U.S. metro ZIP's home values rise over 2 years — the signals, the data, and how to read a score.",
};

const SIGNALS = [
  {
    title: "Home values",
    body: "Over two decades of Zillow home-value history per ZIP — the level, the trend, and the shape of the curve.",
    stroke: "#2563eb",
    path: "M3 17l6-6 4 4 8-8M21 7h-5M21 7v5",
  },
  {
    title: "Momentum",
    body: "Whether prices are accelerating or cooling right now, measured against the metro around them.",
    stroke: "#16a34a",
    path: "M4 20V10M10 20V4M16 20v-7M22 20V8",
  },
  {
    title: "Affordability vs its metro",
    body: "How cheap or expensive a ZIP is relative to its metro and state — expensive, established areas tend to hold up; the very cheapest carry more risk.",
    stroke: "#d97706",
    path: "M3 7h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7zM16 12h4v3h-4a1.5 1.5 0 0 1 0-3z",
  },
  {
    title: "Metro context",
    body: "The direction of the wider market, so each ZIP is judged against its true peers — not the whole country.",
    stroke: "#7c3aed",
    path: "M4 11a8 8 0 0 1 8-8M20 13a8 8 0 0 1-8 8M4 11h4M20 13h-4",
  },
];

const TIERS = [
  { c: "#39506f", label: "Quiet", note: "Least likely to rise — but rare." },
  { c: "#3f6ba6", label: "Soft", note: "Below-average chance of rising." },
  { c: "#2f95cf", label: "Steady", note: "Around the national middle." },
  { c: "#1fbca9", label: "Warming", note: "Above-average chance of rising." },
  { c: "#40d385", label: "Strong", note: "Among the most likely to rise." },
  { c: "#b6e63a", label: "Standout", note: "The highest chance of rising." },
];

const STATS = [
  { num: "20,892", lbl: "metro ZIP codes scored" },
  { num: "20+ yr", lbl: "of home-value history modeled" },
  { num: "2 yr", lbl: "rise-likelihood estimate" },
  { num: "50", lbl: "states + D.C. covered" },
];

const FAQ = [
  {
    q: "What exactly is the score?",
    a: "The calibrated chance (0–100%) that a ZIP's Zillow home value is higher two years from now than today. “Calibrated” means it's honest: ZIPs the model rates around 80% actually rose about 80% of the time in out-of-time backtests.",
  },
  {
    q: "Is a high score a guarantee prices will rise?",
    a: "No — it's a probability, not a promise. Most neighborhoods do rise, so most scores are high; the real signal is a low score flagging elevated risk. Out-of-time skill is modest (backtest AUC ≈ 0.66, ≈0.72 recent), and it reads today's conditions — it can't foresee a rate shock or crash. A well-informed guide, not a certainty.",
  },
  {
    q: "How fresh is the data?",
    a: "The model retrains monthly as new Zillow home-value data lands, so scores track the current market rather than being frozen at a single snapshot.",
  },
  {
    q: "Who is this built for?",
    a: "Buyers and independent investors who want the kind of forward-looking read that institutional funds build in-house — without the institutional budget.",
  },
];

export default function HowItWorks() {
  return (
    <div className="glx-page hiw">
      <header className="hiw-nav">
        <a href="/" className="niq-brand" aria-label="NeighborhoodIQ home">
          <Logo size={26} />
          <span className="niq-wordmark">
            Neighborhood<span>IQ</span>
          </span>
        </a>
        <span className="hiw-navspacer" />
        <a href="/" className="hiw-navlink">
          Home
        </a>
        <a href="/login" className="hiw-navcta">
          Analyze a ZIP
        </a>
      </header>

      <main className="glx-content">
        {/* Hero */}
        <section className="glx-section hiw-hero">
          <p className="glx-kicker">What we&apos;re doing</p>
          <h1 className="hiw-h1">
            See any neighborhood{" "}
            <span className="hiw-em">for what it really is.</span>
          </h1>
          <p className="glx-lead">
            NeighborhoodIQ is an honest home-value dashboard for every metro ZIP
            code in the country. For each of 20,892 ZIPs it shows what homes cost,
            whether prices are rising or cooling, and how the place compares to its
            metro — plus one honest signal: the calibrated chance its value is
            higher in 2 years. Real Zillow data, openly backtested, no hype.
          </p>
          <div className="hiw-herolinks">
            <a href="/login" className="glx-cta-btn">
              Analyze a ZIP
            </a>
            <a href="/" className="hiw-textlink">
              ← Back to the map
            </a>
          </div>
        </section>

        {/* Signals */}
        <section className="glx-section" style={{ paddingTop: 0 }}>
          <p className="glx-kicker">How the score works</p>
          <h2 className="glx-h2">A few honest signals, one calibrated number.</h2>
          <p className="glx-lead">
            No single number tells you where a neighborhood is headed. The score
            reads each ZIP&apos;s price history, its momentum, and how it&apos;s
            priced against its metro — all from real Zillow data — and turns them
            into a calibrated chance of rising over the next two years.
          </p>
          <div className="glx-signals">
            {SIGNALS.map((s) => (
              <div className="glx-signal" key={s.title}>
                <div className="glx-signal-ic">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={s.stroke}
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={s.path} />
                  </svg>
                </div>
                <div className="glx-signal-h">{s.title}</div>
                <p className="glx-signal-p">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Data */}
        <section className="glx-section" style={{ paddingTop: 0 }}>
          <p className="glx-kicker">The data behind it</p>
          <h2 className="glx-h2">Trained on decades of real market history.</h2>
          <p className="glx-lead">
            The model learns from 20+ years of real Zillow ZIP-level home values —
            the level, the trend, recent momentum, and how each ZIP is priced
            against its metro. We tested adding Census income, jobs, migration, and
            market-demand data; none reliably improved the forecast out-of-time, so
            we keep the model honest and use only what actually helps.
          </p>
          <div className="glx-stats">
            {STATS.map((s) => (
              <div key={s.lbl}>
                <div className="glx-stat-num">{s.num}</div>
                <div className="glx-stat-lbl">{s.lbl}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Reading a score */}
        <section className="glx-section" style={{ paddingTop: 0 }}>
          <p className="glx-kicker">Reading a score</p>
          <h2 className="glx-h2">Brighter means a stronger signal.</h2>
          <p className="glx-lead">
            On the map, every ZIP is a dot colored by its score. Cool blues are
            the quiet majority; greens and lime are the highest chance of
            rising. Here&apos;s the full ramp:
          </p>
          <div className="hiw-tiers">
            {TIERS.map((t) => (
              <div className="hiw-tier" key={t.label}>
                <span
                  className="hiw-tier-sw"
                  style={{ background: t.c, boxShadow: `0 0 16px ${t.c}55` }}
                />
                <div>
                  <div className="hiw-tier-label">{t.label}</div>
                  <div className="hiw-tier-note">{t.note}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="hiw-caveat">
            One honest caveat: the score is a relative ranking, not a
            guarantee. It rewards affordable neighborhoods whose prices are
            actually rising — not merely the cheapest ZIPs — but its out-of-time
            skill is modest, so treat a score as a starting point for your own
            research, not financial advice.
          </p>
        </section>

        {/* FAQ */}
        <section className="glx-section" style={{ paddingTop: 0 }}>
          <p className="glx-kicker">Questions</p>
          <h2 className="glx-h2">The short version.</h2>
          <div className="hiw-faq">
            {FAQ.map((f) => (
              <div className="hiw-faq-item" key={f.q}>
                <div className="hiw-faq-q">{f.q}</div>
                <p className="hiw-faq-a">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="glx-section glx-cta-band">
          <p className="glx-kicker">See it for yourself</p>
          <h2 className="glx-h2">Look up any ZIP on the map.</h2>
          <p className="glx-lead" style={{ marginInline: "auto" }}>
            Zoom into your metro, compare neighborhoods, and see which ZIPs the
            model thinks are heating up.
          </p>
          <a href="/login" className="glx-cta-btn">
            Get started free
          </a>
        </section>

        <footer className="glx-footer">
          © 2026 NeighborhoodIQ · Forecasts are model estimates, not financial
          advice.
        </footer>
      </main>
    </div>
  );
}
