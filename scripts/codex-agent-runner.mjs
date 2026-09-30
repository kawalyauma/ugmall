#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const socketPath = process.env.CODEX_RUNNER_SOCKET || "/opt/shop/agent-runtime/codex.sock";
const codexPath = process.env.CODEX_CLI_PATH || "/usr/bin/codex";

async function runCodex(prompt, schema) {
  const dir = await mkdtemp(join(tmpdir(), "ugmall-codex-host-"));
  const schemaPath = join(dir, "schema.json");
  const outputPath = join(dir, "result.json");
  await writeFile(schemaPath, JSON.stringify(schema));
  try {
    await new Promise((resolve, reject) => {
      const home = process.env.HOME || "/home/ubuntu";
      const child = spawn(codexPath, ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--output-schema", schemaPath, "-o", outputPath, "-"], {
        cwd: dir,
        env: { HOME: home, CODEX_HOME: process.env.CODEX_HOME || join(home, ".codex"), PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-8000); });
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Codex timed out")); }, 4 * 60_000);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Codex exited ${code}: ${stderr}`)); });
      child.stdin.end(prompt);
    });
    return JSON.parse(await readFile(outputPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/run") { res.writeHead(404).end(); return; }
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 2_000_000) req.destroy(new Error("Request too large"));
  });
  req.on("end", async () => {
    try {
      const body = JSON.parse(raw);
      if (typeof body.prompt !== "string" || !body.prompt || typeof body.schema !== "object" || !body.schema) throw new Error("Invalid runner request");
      const result = await runCodex(body.prompt, body.schema);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result }));
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 4000) : "Runner failed";
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
    }
  });
});

await unlink(socketPath).catch(() => {});
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o660);
  console.log(`UG Mall Codex runner listening on ${socketPath}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
