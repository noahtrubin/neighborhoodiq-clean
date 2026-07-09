// Shared, framework-agnostic type for a scored ZIP. Lives in its own module so
// both Server (scores.ts, route handlers) and Client (NeighborhoodIQ.tsx) code
// can import it without pulling server-only deps into the browser bundle.

export type ZipData = {
  zip: string;
  city: string;
  state: string;
  metro: string;
  county: string;
  score: number; // 0-100 relative outlook (prob*100). A RANKING, not a calibrated probability.
  rank?: number; // 0-100 percentile of this ZIP among all scored ZIPs (100 = top). The honest headline.
  prob: number; // 0-1 raw model output — do NOT present as "X% chance" (it is not calibrated)
  appr5yr: number | null; // actual ZHVI appreciation % over the last 5 years
  momentum: number | null; // most recent YoY price change %
  pctileMetro: number | null; // 0-100 price rank within metro (0 = cheapest)
  imputed?: boolean; // true => score leans on >=1 estimated (missing) feature
};
