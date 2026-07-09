// The ML model as an API endpoint (Phase 4). Serves the forward-looking
// gentrification forecast for any U.S. ZIP from the precomputed national bundle.
//
//   GET /api/predict?zip=66607      -> { data, metroPeers }
//   GET /api/predict?zips=11216,02127 -> { results }   (for resolving favorites)
//
// (Today it reads precomputed scores; later this same endpoint can front a live
// Python model on Cloud Run without the client changing.)

import { getManyZips, getMetroPeers, getZip } from "../../lib/scores";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const many = searchParams.get("zips");
  if (many !== null) {
    const list = many
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{5}$/.test(s))
      .slice(0, 50);
    return Response.json({ results: await getManyZips(list) });
  }

  const zip = (searchParams.get("zip") || "").trim();
  if (!/^\d{5}$/.test(zip)) {
    return Response.json({ error: "Provide a 5-digit ?zip=" }, { status: 400 });
  }

  const data = await getZip(zip);
  if (!data) {
    return Response.json(
      { error: `No forecast available for ${zip}.` },
      { status: 404 },
    );
  }
  return Response.json({ data, metroPeers: await getMetroPeers(zip) });
}
