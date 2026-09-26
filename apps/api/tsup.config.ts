import { defineConfig } from "tsup";

// Bundle the API + worker together with the workspace packages into plain
// ESM so the production image only needs node_modules for third-party deps.
export default defineConfig({
  entry: { server: "src/server.ts", worker: "src/worker.ts", migrate: "src/scripts/migrate.ts", seed: "src/scripts/seed.ts", "create-admin": "src/scripts/create-admin.ts", "import-products": "src/scripts/import-products.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: true,
  noExternal: [/^@ugmall\//],
  // third-party packages stay in node_modules (native binaries, data files)
  external: ["sharp", "fflate", "pdfkit", "exceljs", "@aws-sdk/client-s3", "postgres", "drizzle-orm", "ioredis", "bullmq", "pino", "hono", "@hono/node-server", "zod"],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
