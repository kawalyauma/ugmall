import type { NextConfig } from "next";
import path from "node:path";

const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@ugmall/shared"],
  poweredByHeader: false,
  // In production Nginx routes /api and /media before requests reach Next.
  // These rewrites make `next dev` work on its own.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/:path*` },
      { source: "/media/:path*", destination: `${api}/media/:path*` },
    ];
  },
};

export default config;
