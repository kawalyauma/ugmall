import { defineConfig } from "tsup";

// Bundle the API + worker together with the workspace packages into plain
// ESM so the production image only needs node_modules for third-party deps.
export default defineConfig({
  entry: { server: "src/server.ts", worker: "src/worker.ts", migrate: "src/scripts/migrate.ts", seed: "src/scripts/seed.ts", "create-admin": "src/scripts/create-admin.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: true,
  noExternal: [/^@ugmall\//],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
