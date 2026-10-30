// Runs the review test suite against the disposable LOCAL Supabase stack.
// Usage: npx supabase start   then   node tests/review/run-review-tests.mjs [vitest args]
// Reads keys from `supabase status`, refuses non-loopback targets, never prints secrets.
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";

const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const status = JSON.parse(raw.slice(raw.indexOf("{")));
const api = new URL(status.API_URL), db = new URL(status.DB_URL);
for (const u of [api, db]) {
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error(`refusing non-loopback target ${u.hostname}`);
}
const env = {
  ...process.env,
  REVIEW_DISPOSABLE_DB: "1",
  REVIEW_DB_URL: status.DB_URL,
  SUPABASE_URL: status.API_URL,
  SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_KEY: status.SERVICE_ROLE_KEY,
  CRON_SECRET: "review-cron-secret",
  VITE_DEFAULT_WORKSPACE: "demo",
  BOOTSTRAP_WORKSPACE_SLUGS: "",
  AI_GATEWAY_API_KEY: "", // LLM calls fall back to templates; no paid AI in review tests
};
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/review/vitest.review.config.ts", ...process.argv.slice(2)], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
