import Link from "next/link";
import Logo from "./components/Logo";

// Public landing page. A floating "constellation" hero: abstract real-estate
// data widgets bob around the headline, and five signal glyphs feed a central
// score — mirroring how the model actually works. Motion is pure CSS (honors
// prefers-reduced-motion). The product lives at /dashboard; sign-in is /login.

export default function Landing() {
  return (
    <div className="lh-stage">
      <nav className="lh-nav">
        <Link href="/" className="niq-brand" aria-label="NeighborhoodIQ home">
          <Logo size={24} />
          <span className="niq-wordmark">
            Neighborhood<span>IQ</span>
          </span>
        </Link>

        <span className="lh-navspacer" />
        <div className="lh-navpill">
          <Link className="lh-navlink" data-active="true" href="/login">
            Product
          </Link>
          <Link className="lh-navlink" href="/login">
            Forecasts
          </Link>
          <Link className="lh-navlink" href="/login">
            Method
          </Link>
          <Link className="lh-navlink" href="/login">
            Pricing
          </Link>
        </div>
        <span className="lh-navspacer" />

        <div className="lh-navright">
          <Link href="/login" className="lh-navlink">
            Sign in
          </Link>
          <Link href="/login" className="lh-navcta">
            Get started
          </Link>
        </div>
      </nav>

      {/* Floating abstract real-estate widgets */}
      <div className="lh-floaters" aria-hidden="true">
        {/* median value */}
        <div className="lh-float lh-p1">
          <div className="lh-tile">
            <div className="lh-tlabel">Median value</div>
            <div className="lh-tnum">$438K</div>
            <div className="lh-tdelta">▲ 6.2% YoY</div>
          </div>
        </div>

        {/* house glyph */}
        <div className="lh-float lh-p2">
          <div className="lh-card">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
              <path d="M4 11 12 4l8 7" />
              <path d="M6 10v9h12v-9" />
              <path d="M10 19v-5h4v5" />
            </svg>
          </div>
        </div>

        {/* momentum bars */}
        <div className="lh-float lh-p3">
          <div className="lh-tile">
            <div className="lh-tlabel">Momentum</div>
            <svg width="96" height="34" viewBox="0 0 96 34" style={{ marginTop: 6 }}>
              <g fill="#2563eb">
                <rect x="2" y="20" width="12" height="12" rx="2.5" />
                <rect x="20" y="14" width="12" height="18" rx="2.5" />
                <rect x="38" y="22" width="12" height="10" rx="2.5" />
                <rect x="56" y="9" width="12" height="23" rx="2.5" />
                <rect x="74" y="3" width="12" height="29" rx="2.5" />
              </g>
            </svg>
          </div>
        </div>

        {/* map pin glyph */}
        <div className="lh-float lh-p4">
          <div className="lh-card">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="1.9">
              <path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z" />
              <circle cx="12" cy="11" r="2.2" />
            </svg>
          </div>
        </div>

        {/* rank pill */}
        <div className="lh-float lh-p5">
          <div className="lh-card lh-rank">
            <span className="lh-pill">TOP 6%</span>
            <span className="lh-rank-sub">nationally</span>
          </div>
        </div>

        {/* 5-yr appreciation */}
        <div className="lh-float lh-p6">
          <div className="lh-tile">
            <div className="lh-tlabel">5-yr appreciation</div>
            <div className="lh-trow">
              <div className="lh-tnum" style={{ color: "#16a34a" }}>+41%</div>
              <svg width="62" height="30" viewBox="0 0 62 30" fill="none">
                <polyline points="2,25 13,20 23,22 34,13 44,15 60,3" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="60" cy="3" r="2.6" fill="#16a34a" />
              </svg>
            </div>
          </div>
        </div>

        {/* key glyph */}
        <div className="lh-float lh-p7">
          <div className="lh-card">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d9820b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="4" />
              <path d="M10.8 10.8 20 20M17 17l2.4-2.4M14.4 14.4l2.4-2.4" />
            </svg>
          </div>
        </div>

        {/* mini map */}
        <div className="lh-float lh-p8">
          <div className="lh-card lh-map">
            <svg width="70" height="70" viewBox="0 0 70 70">
              <rect width="70" height="70" fill="#f4f7fb" />
              <g stroke="#dbe2ec" strokeWidth="3">
                <path d="M0 22h70M0 46h70M22 0v70M48 0v70" />
              </g>
              <path d="M40 44s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11z" fill="#2563eb" />
              <circle cx="40" cy="33" r="2.6" fill="#fff" />
            </svg>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="lh-hero">
        <div className="lh-cluster">
          <svg className="lh-lines" viewBox="0 0 560 152" fill="none" aria-hidden="true">
            <path d="M44 122 C130 90 205 90 280 120 S440 150 516 118" stroke="#d5dded" strokeWidth="1.6" />
            <path d="M280 120 L280 56" stroke="#d5dded" strokeWidth="1.6" />
            <g fill="#c2cbe0">
              <circle cx="44" cy="122" r="2.5" />
              <circle cx="160" cy="104" r="2.5" />
              <circle cx="280" cy="120" r="2.5" />
              <circle cx="400" cy="104" r="2.5" />
              <circle cx="516" cy="118" r="2.5" />
            </g>
          </svg>

          {/* central score */}
          <div className="lh-node lh-node--lg" style={{ left: "50%", top: 26 }}>
            <div className="lh-gauge">
              <svg viewBox="0 0 44 44">
                <circle cx="22" cy="22" r="18" fill="none" stroke="#eef1f5" strokeWidth="4.5" />
                <circle cx="22" cy="22" r="18" fill="none" stroke="#2563eb" strokeWidth="4.5" strokeLinecap="round" strokeDasharray="100 113" transform="rotate(-90 22 22)" />
              </svg>
              <span className="lh-gauge-num">88</span>
            </div>
            <span className="lh-cap">Score</span>
          </div>

          {/* signal glyphs */}
          <div className="lh-node lh-node--sm" style={{ left: "8%", top: 122 }} title="Affordability">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d9820b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z" />
              <path d="M16 12h4v3h-4a1.5 1.5 0 0 1 0-3z" />
            </svg>
          </div>
          <div className="lh-node lh-node--sm" style={{ left: "29%", top: 104 }} title="Price">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18M8 7h5.5a2.5 2.5 0 0 1 0 5H10a2.5 2.5 0 0 0 0 5H16" />
            </svg>
          </div>
          <div className="lh-node lh-node--sm" style={{ left: "50%", top: 120 }} title="Momentum">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M21 7h-5M21 7v5" />
            </svg>
          </div>
          <div className="lh-node lh-node--sm" style={{ left: "71%", top: 104 }} title="Location">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="1.9">
              <path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z" />
              <circle cx="12" cy="11" r="2.1" />
            </svg>
          </div>
          <div className="lh-node lh-node--sm" style={{ left: "92%", top: 122 }} title="History">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </div>
        </div>

        <h1>
          Spot the <span className="lh-em">next neighborhood</span> before prices
          move.
        </h1>
        <p className="lh-sub">
          Five-year appreciation forecasts for every metro ZIP code in the U.S. —
          the signals, the ranking, and the map behind each one.
        </p>

        <div className="lh-badge">
          <span className="lh-dot" />
          Now scoring 20,000+ metro ZIP codes
        </div>
        <Link href="/login" className="lh-cta">
          Get started
        </Link>
      </div>
    </div>
  );
}
