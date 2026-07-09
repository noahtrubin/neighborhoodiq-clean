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
    "How NeighborhoodIQ scores every U.S. metro ZIP code for five-year home-price appreciation — the signals, the data, and how to read a score.",
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
    title: "Affordability",
    body: "How much runway is left before prices bump up against local incomes and rents.",
    stroke: "#d97706",
    path: "M3 7h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7zM16 12h4v3h-4a1.5 1.5 0 0 1 0-3z",
  },
  {
    title: "Location & amenities",
    body: "Where a ZIP sits relative to jobs, businesses, and the neighborhoods moving fastest nearby.",
    stroke: "#14b8a6",
    path: "M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10zM12 11h.01",
  },
  {
    title: "Metro context",
    body: "The direction of the wider market, so each ZIP is judged against its true peers — not the whole country.",
    stroke: "#7c3aed",
    path: "M4 11a8 8 0 0 1 8-8M20 13a8 8 0 0 1-8 8M4 11h4M20 13h-4",
  },
];

const TIERS = [
  { c: "#39506f", label: "Quiet", note: "Little forward signal — most ZIPs land here." },
  { c: "#3f6ba6", label: "Soft", note: "Below-average appreciation signal." },
  { c: "#2f95cf", label: "Steady", note: "Around the national middle." },
  { c: "#1fbca9", label: "Warming", note: "Above-average signal building." },
  { c: "#40d385", label: "Strong", note: "Top-decile appreciation signal." },
  { c: "#b6e63a", label: "Standout", note: "The rare, highest-signal ZIPs." },
];

const STATS = [
  { num: "20,306", lbl: "metro ZIP codes scored" },
  { num: "20+ yr", lbl: "of home-value history modeled" },
  { num: "5 yr", lbl: "forward appreciation forecast" },
  { num: "50", lbl: "states + D.C. covered" },
];

const FAQ = [
  {
    q: "What exactly is the score?",
    a: "A single 0–100-style ranking of how likely a ZIP code is to see strong home-price appreciation over the next five years, relative to every other metro ZIP in the country. Higher means a stronger forward signal.",
  },
  {
    q: "Is a high score a guarantee prices will rise?",
    a: "No. It's a model estimate of probability, not a promise. Some lower-priced, distressed markets score high because the model sees room to run off a low base — always pair the score with your own read of a place.",
  },
  {
    q: "How fresh is the data?",
    a: "The model retrains as new Zillow, Census, and market data lands, so scores update over time rather than being frozen at a single snapshot.",
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
            Find the next neighborhood{" "}
            <span className="hiw-em">before the market does.</span>
          </h1>
          <p className="glx-lead">
            NeighborhoodIQ is a model that reads the housing market the way a
            careful analyst would — then does it for every metro ZIP code in the
            country at once. For each of 20,306 ZIPs, it forecasts how likely
            home prices are to appreciate over the next five years, and turns
            that into one score you can compare anywhere on the map.
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
          <h2 className="glx-h2">Five signals, one forward-looking number.</h2>
          <p className="glx-lead">
            No single number tells you where a neighborhood is headed. The score
            blends five families of signals, weighs them against each ZIP&apos;s
            own history and its metro, and projects the result five years out.
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
            The model learns from a long run of Zillow home values, layered with
            Census demographics, business and job patterns, local amenities, and
            migration between neighborhoods. It looks at what actually preceded
            past appreciation — then watches for the same setups forming today.
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
            the quiet majority; greens and lime are where the model sees the
            strongest five-year upside. Here&apos;s the full ramp:
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
            One honest caveat: the score is a probability estimate, not a
            guarantee. A few low-priced, distressed markets rank high because the
            model sees room to run off a low base — so treat a score as a
            starting point for your own research, not financial advice.
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
