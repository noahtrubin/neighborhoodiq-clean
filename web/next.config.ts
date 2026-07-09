import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root to this app dir. A stale root-level package-lock.json
  // (from the old Vite app) otherwise makes Next infer the parent as the root,
  // which also throws off output file tracing on deploy.
  turbopack: { root },
  outputFileTracingRoot: root,

  // scores.ts reads app-data/national_scores.json with fs at runtime. Next only
  // ships files it can trace from imports, so force-include the data bundle in
  // the production output for the routes that read it (page + predict API).
  outputFileTracingIncludes: {
    "/": ["./app-data/**"],
    "/api/predict": ["./app-data/**"],
  },

  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
