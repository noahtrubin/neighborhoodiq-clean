// Serverless proxy to the Anthropic API.
//
// Why this exists: the browser must NEVER hold an Anthropic API key — it would
// be visible to every visitor and anyone could spend your credits. This runs
// server-side on Vercel, reads the key from an environment variable, and is the
// only place that talks to api.anthropic.com.
//
// Required env var (set in Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY

// --- Best-effort rate limiting -------------------------------------------------
// NOTE: this Map lives in a single warm serverless instance and resets on cold
// starts, so it is a light guard, not real protection. For production, back this
// with a shared store (Vercel KV / Upstash Redis) keyed by IP.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_PER_WINDOW;
}

// Structured-output schema: guarantees the model returns exactly these fields.
const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    city: { type: "string" },
    score: { type: "integer" },
    momentum: { type: "integer" },
    airbnb: { type: "integer" },
    affordability: { type: "integer" },
    summary: { type: "string" },
  },
  required: [
    "name",
    "city",
    "score",
    "momentum",
    "airbnb",
    "affordability",
    "summary",
  ],
  additionalProperties: false,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res
      .status(500)
      .json({ error: "Server is not configured (ANTHROPIC_API_KEY missing)." });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests — slow down." });
  }

  const zip = String((req.body && req.body.zip) || "").trim();
  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: "Provide a valid 5-digit ZIP code." });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content:
              `You are a real estate analyst. Analyze ZIP code ${zip} for ` +
              `gentrification potential using public neighborhood knowledge. ` +
              `Give the neighborhood name, "City, ST", a 0-100 gentrification ` +
              `score, and 0-100 sub-scores for price momentum, Airbnb/investor ` +
              `density, and affordability upside, plus a 2-3 sentence summary of ` +
              `current signals. If the ZIP is unknown, give your best estimate.`,
          },
        ],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("Anthropic error", upstream.status, detail.slice(0, 300));
      return res
        .status(502)
        .json({ error: "Upstream analysis service error." });
    }

    const data = await upstream.json();
    if (data.stop_reason === "refusal") {
      return res
        .status(422)
        .json({ error: "The model declined to analyze this input." });
    }

    const text = (data.content || []).find((b) => b.type === "text")?.text || "";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "Could not parse analysis result." });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    console.error("Proxy error", e);
    return res.status(502).json({ error: "Failed to reach the analysis service." });
  }
}
