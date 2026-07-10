// Shared, framework-agnostic type for a scored ZIP. Lives in its own module so
// both Server (scores.ts, route handlers) and Client (NeighborhoodIQ.tsx) code
// can import it without pulling server-only deps into the browser bundle.

export type ZipData = {
  zip: string;
  city: string;
  state: string;
  metro: string;
  county: string;
  score: number; // 0-100 = calibrated % chance the home value RISES over the next 2 years (prob*100). The headline.
  rank?: number; // 0-100 percentile of this ZIP's rise-likelihood among all scored ZIPs (100 = highest). Secondary.
  prob: number; // 0-1 calibrated probability of rising (isotonic-calibrated: 0.80 => ~80% of such ZIPs rose in backtest)
  appr5yr: number | null; // actual ZHVI appreciation % over the last 5 years
  momentum: number | null; // most recent YoY price change %
  pctileMetro: number | null; // 0-100 price rank within metro (0 = cheapest)
  imputed?: boolean; // true => score leans on >=1 estimated (missing) feature
};

// Compact home-value history for the chart + KPI row. Derived from the full
// monthly Zillow ZHVI (see app-data/zhvi_series.json): one $ point per year for
// the ZIP, plus metro and national medians as reference lines.
export type SeriesBundle = {
  years: number[];
  zip: (number | null)[];
  metro: (number | null)[] | null;
  national: (number | null)[];
  latest: number | null; // most recent monthly ZHVI ($)
  asOf: string | null; // "YYYY-MM" of the latest value
  yoy: number | null; // % change over the trailing 12 months
};
