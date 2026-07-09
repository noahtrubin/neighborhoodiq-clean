// NeighborhoodIQ — Neighborhood Gentrification Predictor
// Built on 727k permit records, 215k Airbnb reviews, Zillow ZHVI data
// 87.5% accuracy on leave-one-out cross validation across 24 zip codes

import { useState, useEffect } from "react";

const ZIPS = {
  "02127": { name: "South Boston", city: "Boston, MA", score: 63, appr: 93.7, momentum: 72, airbnb: 48, affordability: 37, summary: "Classic gentrification story. Strong renovation permit density (2x the city average) preceded a 94% appreciation from 2012–2019. The model correctly flagged this as a buy signal using only pre-2013 data.", source: "model" },
  "02119": { name: "Roxbury", city: "Boston, MA", score: 70, appr: 130.1, momentum: 67, airbnb: 51, affordability: 68, summary: "The highest appreciator in Boston at +130%. Low starting price combined with steady permit activity and growing Airbnb density made this the clearest buy signal in the dataset.", source: "model" },
  "02134": { name: "Allston", city: "Boston, MA", score: 67, appr: 107.9, momentum: 74, airbnb: 51, affordability: 50, summary: "Strong appreciation driven by proximity to universities and a wave of renovation permits from 2012 onward. The model correctly identified this as a high-momentum zip.", source: "model" },
  "02118": { name: "South End", city: "Boston, MA", score: 57, appr: 53.7, momentum: 74, airbnb: 78, affordability: 0, summary: "Already expensive at $590k in 2012. Despite strong momentum and high Airbnb density, limited price upside due to high starting point. Model correctly classified as lower-conviction.", source: "model" },
  "02122": { name: "Dorchester", city: "Boston, MA", score: 68, appr: 106.4, momentum: 70, airbnb: 49, affordability: 62, summary: "Outperformed South Boston in appreciation (+106%). Currently flashing the same signals South Boston showed in 2011 — 525 active Airbnb listings, steady permit growth. Mid-gentrification now.", source: "model" },
  "02130": { name: "Jamaica Plain", city: "Boston, MA", score: 59, appr: 72.9, momentum: 71, airbnb: 44, affordability: 37, summary: "Solid appreciation but below the dataset median. Gentrification occurred here but at a measured pace. Permit activity was consistent without the sharp spike seen in higher-conviction zips.", source: "model" },
  "78702": { name: "East Austin", city: "Austin, TX", score: 80, appr: 124.9, momentum: 75, airbnb: 92, affordability: 71, summary: "The highest-conviction signal in Austin. $206k starting price in 2012, strong momentum, and 2,094 current Airbnb listings. Appreciated 125% by 2019. The model scored this as its strongest buy signal across all cities.", source: "model" },
  "78724": { name: "Austin NE", city: "Austin, TX", score: 67, appr: 112.2, momentum: 56, airbnb: 42, affordability: 88, summary: "Very cheap starting price ($117k) created massive upside room. Despite negative early momentum, the affordability signal was powerful enough to flag this correctly.", source: "model" },
  "78723": { name: "Windsor Park", city: "Austin, TX", score: 72, appr: 103.0, momentum: 66, airbnb: 66, affordability: 71, summary: "Strong appreciation driven by East Austin spillover effects. Reasonable starting price combined with growing Airbnb density made this a solid signal.", source: "model" },
  "78704": { name: "South Austin", city: "Austin, TX", score: 73, appr: 78.6, momentum: 77, airbnb: 87, affordability: 51, summary: "High Airbnb density (1,378 current listings) and strong price momentum. The model correctly identified this as a high-momentum zip despite a higher starting price.", source: "model" },
  "78744": { name: "Austin South", city: "Austin, TX", score: 69, appr: 113.1, momentum: 56, airbnb: 47, affordability: 87, summary: "Despite being labeled a control zip in training, this appreciated 113%. The model correctly classified it as gentrify based on its cheap starting price and affordability score.", source: "model" },
  "78745": { name: "Austin SW", city: "Austin, TX", score: 72, appr: 92.1, momentum: 65, airbnb: 58, affordability: 77, summary: "Strong affordability signal at $173k starting price with growing Airbnb density. Another Austin zip where cheap entry points drove strong appreciation.", source: "model" },
  "60647": { name: "Logan Square", city: "Chicago, IL", score: 57, appr: 57.3, momentum: 45, airbnb: 64, affordability: 50, summary: "Well-known gentrification story but the model found weaker signals than Austin or NYC. Negative price momentum in 2010-2012 dragged the score down despite high Airbnb density.", source: "model" },
  "60622": { name: "Wicker Park", city: "Chicago, IL", score: 58, appr: 45.7, momentum: 49, airbnb: 75, affordability: 39, summary: "Already partially gentrified by 2012. Strong Airbnb density but limited remaining upside. The model correctly gave this a moderate score given the high starting price.", source: "model" },
  "60640": { name: "Uptown", city: "Chicago, IL", score: 63, appr: 45.5, momentum: 38, airbnb: 66, affordability: 75, summary: "One of three misclassifications. Strong affordability and Airbnb density, but severe negative momentum dragged performance. Appreciated only 46% vs the 60% threshold.", source: "model" },
  "60618": { name: "Irving Park", city: "Chicago, IL", score: 60, appr: 51.1, momentum: 49, airbnb: 64, affordability: 53, summary: "Moderate appreciation relative to other cities. Chicago's slower post-2008 recovery muted signals across the board.", source: "model" },
  "60628": { name: "Roseland", city: "Chicago, IL", score: 48, appr: 94.1, momentum: 9, airbnb: 32, affordability: 99, summary: "Very cheap ($54k in 2012) and appreciated 94%, but the model missed it due to severely negative momentum. Affordability alone wasn't enough.", source: "model" },
  "60620": { name: "Auburn Gresham", city: "Chicago, IL", score: 55, appr: 69.5, momentum: 26, airbnb: 34, affordability: 95, summary: "Cheap starting price but deeply negative momentum. The model scored this as a weak signal and it came close to but didn't reach the 60% threshold.", source: "model" },
  "11233": { name: "Bed-Stuy", city: "Brooklyn, NY", score: 71, appr: 124.6, momentum: 77, airbnb: 72, affordability: 46, summary: "One of the strongest signals in the dataset. Positive momentum, high Airbnb density, and a reasonable starting price. Appreciated 125% by 2019.", source: "model" },
  "11216": { name: "Crown Heights", city: "Brooklyn, NY", score: 73, appr: 130.2, momentum: 88, airbnb: 93, affordability: 28, summary: "Tied for highest appreciation at +130%. The strongest momentum signal of any zip at 6.43% YoY in 2010-2012, combined with the highest Airbnb density in NYC.", source: "model" },
  "11221": { name: "Bushwick", city: "Brooklyn, NY", score: 74, appr: 129.3, momentum: 81, airbnb: 100, affordability: 38, summary: "Maximum Airbnb density in the dataset (3,161 current listings) combined with strong momentum. +129% appreciation. One of the clearest buy signals the model produced.", source: "model" },
  "11226": { name: "Flatbush", city: "Brooklyn, NY", score: 65, appr: 112.1, momentum: 69, airbnb: 75, affordability: 33, summary: "Strong appreciation despite a higher starting price. Good momentum and Airbnb density drove a 112% gain.", source: "model" },
  "11207": { name: "East New York", city: "Brooklyn, NY", score: 65, appr: 69.3, momentum: 64, airbnb: 52, affordability: 56, summary: "Appreciated 69% — just below the 60% threshold for the full model but still solid. Moderate gentrification pressure correctly identified.", source: "model" },
  "11212": { name: "Brownsville", city: "Brooklyn, NY", score: 54, appr: 57.1, momentum: 46, airbnb: 50, affordability: 46, summary: "One of three misclassifications. The model predicted gentrify but appreciation was 57% — below the 60% threshold. Signals were present but weaker than comparable Brooklyn zips.", source: "model" },
};

const COMPARABLES = {
  "02": ["02127","02119","02134","02122"],
  "78": ["78702","78723","78704","78745"],
  "60": ["60647","60622","60640","60618"],
  "11": ["11233","11216","11221","11226"],
};

const CITY_ORDER = ["Boston, MA", "Austin, TX", "Chicago, IL", "Brooklyn, NY"];
const BY_CITY = CITY_ORDER.map((city) => ({
  city,
  zips: Object.entries(ZIPS)
    .filter(([, d]) => d.city === city)
    .map(([z, d]) => ({ z, ...d })),
}));

function getColor(score) {
  if (score >= 68) return { stroke: "#1D9E75", text: "#138a64", bg: "var(--strong-bg)", label: "STRONG SIGNAL" };
  if (score >= 55) return { stroke: "#BA7517", text: "#a4660f", bg: "var(--moderate-bg)", label: "MODERATE" };
  return { stroke: "#8b897f", text: "#6f6d63", bg: "var(--weak-bg)", label: "WEAK SIGNAL" };
}

function ScoreGauge({ score, color }) {
  const circ = 2 * Math.PI * 54;
  const [dash, setDash] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDash((score / 100) * circ), 80);
    return () => clearTimeout(t);
  }, [score, circ]);

  return (
    <div style={{ position: "relative", width: 152, height: 152 }}>
      <svg width="152" height="152" viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="60" cy="60" r="54" fill="none" stroke="#ecebe4" strokeWidth="9" />
        <circle
          cx="60" cy="60" r="54" fill="none"
          stroke={color.stroke} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em", color: color.text, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 3, fontWeight: 500 }}>out of 100</div>
      </div>
    </div>
  );
}

function SignalBar({ label, icon, value, barColor, description, delay }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13.5, color: "var(--ink-soft)", fontWeight: 500, display: "flex", alignItems: "center", gap: 7 }}>
          <span>{icon}</span>{label}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{value}<span style={{ color: "var(--ink-faint)", fontWeight: 500 }}>/100</span></span>
      </div>
      <div style={{ height: 7, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${width}%`, background: barColor, borderRadius: 999, transition: "width 1s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 5, lineHeight: 1.45 }}>{description}</div>
    </div>
  );
}

export default function NeighborhoodIQ() {
  const [query, setQuery] = useState("02127");
  const [result, setResult] = useState(ZIPS["02127"]);
  const [currentZip, setCurrentZip] = useState("02127");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cityFilter, setCityFilter] = useState("All");

  const selectZip = (z) => {
    setError(null);
    setQuery(z);
    setResult(ZIPS[z]);
    setCurrentZip(z);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSearch = async () => {
    const zip = query.trim();
    setError(null);
    if (!zip || zip.length < 5) { setError("Enter a 5-digit zip code."); return; }

    if (ZIPS[zip]) {
      setResult(ZIPS[zip]);
      setCurrentZip(zip);
      return;
    }

    // Unknown zip → ask the server-side proxy (which holds the API key).
    setLoading(true);
    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${resp.status})`);
      }
      const parsed = await resp.json();
      parsed.source = "ai";
      setResult(parsed);
      setCurrentZip(zip);
    } catch (e) {
      setError(`Could not analyze ${zip}. Try: 02127, 78702, 11233, or 60647.`);
    }
    setLoading(false);
  };

  const col = result ? getColor(result.score) : null;
  const comps = COMPARABLES[currentZip?.slice(0,2)] || [];
  const visibleCities = cityFilter === "All" ? BY_CITY : BY_CITY.filter((g) => g.city === cityFilter);

  return (
    <div className="niq-shell">
      {/* Brand */}
      <div className="niq-brand">
        <div className="niq-logo">N</div>
        <span className="niq-wordmark">NeighborhoodIQ</span>
      </div>

      {/* Hero */}
      <div className="niq-hero">
        <h1>Spot the next neighborhood before prices move.</h1>
        <p>
          A model trained on 727k building permits, 215k Airbnb reviews, and Zillow home
          values — scoring where appreciation is most likely to happen next.
        </p>
        <div className="niq-chips">
          <span className="niq-chip"><b>87.5%</b> LOO-CV accuracy</span>
          <span className="niq-chip"><b>24</b> ZIP codes</span>
          <span className="niq-chip"><b>4</b> cities</span>
          <span className="niq-chip">Zillow · Permits · Airbnb</span>
        </div>
      </div>

      {/* Search */}
      <div className="niq-search">
        <input
          className="niq-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="Enter any U.S. zip code — e.g. 02127, 78702, 11233"
          maxLength={5}
        />
        <button className="niq-btn" onClick={handleSearch}>Analyze →</button>
      </div>

      {error && <div className="niq-alert">{error}</div>}
      {loading && <div className="niq-loading">Analyzing {query} with AI…</div>}

      {/* Result */}
      {result && !loading && (
        <>
          <div className="niq-result-grid">
            {/* Score card */}
            <div className="niq-card niq-score-card">
              <ScoreGauge score={result.score} color={col} />
              <span className="niq-badge" style={{ background: col.bg, color: col.text }}>
                {col.label}
              </span>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>{result.name}</div>
                <div style={{ fontSize: 13.5, color: "var(--ink-muted)", marginTop: 1 }}>{result.city}</div>
                {result.appr && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 6 }}>Historical: +{result.appr}% (2012–2019)</div>}
              </div>
            </div>

            {/* Signals card */}
            <div className="niq-card niq-signals-card">
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 3 }}>Signal breakdown</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 18 }}>Using only 2010–2012 data — no future information used</div>
              <SignalBar label="Price momentum" icon="📈" value={result.momentum} barColor="var(--strong)" description="How fast prices were already moving — #1 predictor (34% importance)" delay={100} />
              <SignalBar label="Airbnb density" icon="🏠" value={result.airbnb} barColor="var(--blue)" description="Investor interest proxy from 215k Airbnb reviews (17% importance)" delay={200} />
              <SignalBar label="Affordability upside" icon="💰" value={result.affordability} barColor="var(--moderate)" description="Room to appreciate — cheaper neighborhoods score higher (19% importance)" delay={300} />
              <div style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.6, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>{result.summary}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 10 }}>
                {result.source === "model" ? "✓ Trained model — real Zillow + permit + Airbnb data" : "⚡ AI estimate — based on public neighborhood knowledge"}
              </div>
            </div>
          </div>

          {/* Comparables */}
          {comps.filter(z => z !== currentZip).length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Comparable neighborhoods</div>
              <div className="niq-comp-grid">
                {comps.filter(z => z !== currentZip).map(z => {
                  const d = ZIPS[z];
                  if (!d) return null;
                  const c2 = getColor(d.score);
                  return (
                    <div key={z} className="niq-zip-card" onClick={() => selectZip(z)}>
                      <div className="niq-zip-top">
                        <span className="niq-zip-code">{z}</span>
                        <span className="niq-zip-score" style={{ color: c2.text }}>{d.score}</span>
                      </div>
                      <div className="niq-zip-name">{d.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Browse / select all 24 ZIPs */}
      <div className="niq-section">
        <div className="niq-section-title">Browse all 24 neighborhoods</div>
        <div className="niq-section-sub">Every ZIP scored by the trained model — filter by city and click any to view its breakdown.</div>

        <div className="niq-tabs">
          <button className="niq-tab" data-active={cityFilter === "All"} onClick={() => setCityFilter("All")}>
            All <span style={{ opacity: 0.6 }}>· 24</span>
          </button>
          {BY_CITY.map((g) => (
            <button key={g.city} className="niq-tab" data-active={cityFilter === g.city} onClick={() => setCityFilter(g.city)}>
              {g.city.split(",")[0]} <span style={{ opacity: 0.6 }}>· {g.zips.length}</span>
            </button>
          ))}
        </div>

        {visibleCities.map((group) => (
          <div key={group.city}>
            <div className="niq-city-label">{group.city}</div>
            <div className="niq-dir-grid">
              {group.zips.map((d) => {
                const c = getColor(d.score);
                const active = d.z === currentZip;
                return (
                  <div key={d.z} className="niq-zip-card" data-active={active} onClick={() => selectZip(d.z)}>
                    <div className="niq-zip-top">
                      <span className="niq-zip-code">{d.z}</span>
                      <span className="niq-zip-score" style={{ color: c.text }}>{d.score}</span>
                    </div>
                    <div className="niq-zip-name">{d.name}</div>
                    <div className="niq-zip-meter">
                      <span style={{ width: `${d.score}%`, background: c.stroke }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="niq-footer">
        Built by Noah — 87.5% LOO-CV accuracy · 24 ZIP codes · Boston · Austin · Chicago · NYC<br />
        Real Zillow ZHVI + building-permit + Airbnb data.
      </div>
    </div>
  );
}
