# NeighborhoodIQ

A standalone web app for the NeighborhoodIQ gentrification predictor. Vite + React
front end, with a Vercel serverless function that proxies unknown-ZIP lookups to the
Anthropic API so the API key never reaches the browser.

## Structure

```
neighborhoodiq/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx
│   └── NeighborhoodIQ.jsx     # UI; 24 ZIPs are served from a local lookup table
└── api/
    └── analyze.js             # serverless proxy → api.anthropic.com (holds the key)
```

The 24 trained-model ZIPs render instantly from the in-app table (no API call). Any
other ZIP is sent to `/api/analyze`, which calls Claude server-side and returns a
structured result.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173 — UI + the 24 known ZIPs work
```

`npm run dev` does **not** run the serverless function, so unknown-ZIP lookups won't
work under it. To exercise the full app (including `/api/analyze`) locally:

```bash
npm i -g vercel
cp .env.example .env.local      # then put your real ANTHROPIC_API_KEY in .env.local
vercel dev                      # runs the front end + the API route together
```

## Deploy to Vercel

This environment has no Vercel CLI or login, so run these on your machine.

### Option A — CLI

```bash
cd ~/neighborhoodiq
npm i -g vercel
vercel login
vercel                                   # first run → creates the project (preview URL)
vercel env add ANTHROPIC_API_KEY production   # paste your key when prompted
vercel --prod                            # production deploy
```

### Option B — GitHub + dashboard

```bash
cd ~/neighborhoodiq
git init && git add -A && git commit -m "NeighborhoodIQ"
# push to a new GitHub repo, then:
```

1. In the Vercel dashboard → **Add New → Project** → import the repo. Vercel
   auto-detects Vite (build `npm run build`, output `dist/`) and the `api/` folder.
2. **Settings → Environment Variables** → add `ANTHROPIC_API_KEY` (your real key).
3. **Deploy**. Redeploy after adding the env var if you deployed first.

## Notes / things to know

- **The API key lives only in the `ANTHROPIC_API_KEY` env var**, read server-side in
  `api/analyze.js`. It is never shipped to the browser. Do not hardcode it anywhere.
- **Model:** `api/analyze.js` uses `claude-sonnet-4-6` (the model the original
  component specified). Change the `model` field there if you want a different one.
- **Rate limiting** in `api/analyze.js` is best-effort and in-memory (resets on cold
  starts). For a public site, back it with Vercel KV / Upstash Redis keyed by IP, or
  the `/api/analyze` endpoint can be used to spend your API credits.
- The unknown-ZIP path is clearly labeled **"⚡ AI estimate"** in the UI; the 24
  trained-model ZIPs are labeled **"✓ Trained model."**
