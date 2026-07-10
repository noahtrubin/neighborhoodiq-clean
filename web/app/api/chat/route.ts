// Server-side chat proxy to Claude. Lets a user ASK QUESTIONS about a ZIP,
// grounded in the data we actually have for it. It is explicitly instructed NOT
// to invent statistics — if it doesn't have a number, it says so.
//
// This replaces the old "estimate a score" route: we no longer fabricate scores.
//
// Required env var: ANTHROPIC_API_KEY  (server-only)

import Anthropic from "@anthropic-ai/sdk";

// claude-opus-4-8 is the default. For a chat feature, "claude-haiku-4-5" is
// ~5x cheaper — change this one line if you want lower cost per message.
const MODEL = "claude-opus-4-8";

type Msg = { role: "user" | "assistant"; content: string };

// --- Best-effort in-memory rate limiting (light guard) ------------------------
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, { start: number; count: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json(
      { error: "Server is not configured (ANTHROPIC_API_KEY missing)." },
      { status: 500 },
    );
  }

  const ip =
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  if (rateLimited(ip)) {
    return Response.json({ error: "Too many messages — slow down." }, { status: 429 });
  }

  let body: { zip?: string; context?: unknown; messages?: Msg[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const zip = String(body?.zip ?? "").trim();
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!/^\d{5}$/.test(zip)) {
    return Response.json({ error: "Missing or invalid ZIP." }, { status: 400 });
  }
  if (messages.length === 0) {
    return Response.json({ error: "No message provided." }, { status: 400 });
  }
  // Validate each message's shape before handing it to the SDK, so a malformed
  // client payload is a clean 400 rather than a thrown SDK error surfaced as 502.
  const messagesValid = messages.every(
    (m) =>
      m != null &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string",
  );
  if (!messagesValid) {
    return Response.json({ error: "Malformed messages." }, { status: 400 });
  }

  const system =
    `You are a real estate analyst assistant for NeighborhoodIQ. The user is ` +
    `asking about ZIP code ${zip}.\n\n` +
    `Here is ALL the data we have for this ZIP (JSON):\n` +
    `${JSON.stringify(body?.context ?? {}, null, 2)}\n\n` +
    `What the fields mean:\n` +
    `- score / prob: the CALIBRATED probability (score = prob as a %) that this ZIP's ` +
    `home value is HIGHER in 2 years than today. It is calibrated — ZIPs rated ~80% ` +
    `actually rose ~80% of the time in backtest — so a score of 70 DOES mean ~70% chance.\n` +
    `- rank: percentile of this ZIP's rise-likelihood vs all metro ZIPs (secondary).\n` +
    `- appr5yr: the ACTUAL Zillow home-value change over the most recent 5 years (past, real).\n` +
    `- momentum: most recent year-over-year price change (%).\n` +
    `- pctileMetro: price rank within the ZIP's metro (0 = cheapest, 100 = priciest).\n` +
    `The model uses ONLY Zillow price history (momentum + how cheap the ZIP is vs its ` +
    `metro). It does NOT use crime, schools, demographics, or permits.\n\n` +
    `Rules:\n` +
    `- Answer using the data above plus widely-known, durable facts about the area.\n` +
    `- Be honest about uncertainty: MODEST out-of-time skill (backtested AUC ~0.66, ~0.72 ` +
    `recent). Most neighborhoods rise, so most scores are high — the real signal is a LOW ` +
    `score flagging elevated risk. It reads current conditions and cannot foresee a market ` +
    `crash. Never imply it predicts the future reliably.\n` +
    `- Do NOT invent specific statistics (prices, percentages, counts, dates) that ` +
    `are not in the data. If asked for a number we don't have, say plainly that you ` +
    `don't have that data — do not guess.\n` +
    `- Be concise (a short paragraph) and helpful.`;

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    if (msg.stop_reason === "refusal") {
      return Response.json(
        { error: "The model declined to answer that." },
        { status: 422 },
      );
    }
    const reply = msg.content.find((b) => b.type === "text")?.text ?? "";
    return Response.json({ reply });
  } catch (e) {
    console.error("Claude chat error", e);
    return Response.json(
      { error: "Failed to reach the AI." },
      { status: 502 },
    );
  }
}
