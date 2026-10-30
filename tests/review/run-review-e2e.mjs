// Runs the review Playwright specs against the disposable LOCAL Supabase stack.
// Usage: npx supabase start   then   node tests/review/run-review-e2e.mjs [playwright args]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const status = JSON.parse(raw.slice(raw.indexOf("{")));
for (const u of [new URL(status.API_URL), new URL(status.DB_URL)]) {
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error(`refusing non-loopback target ${u.hostname}`);
}
const chromium = [process.env.REVIEW_CHROMIUM, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find(p => p && existsSync(p));
const env = {
  ...process.env,
  REVIEW_DISPOSABLE_DB: "1",
  REVIEW_DB_URL: status.DB_URL,
  SUPABASE_URL: status.API_URL,
  SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_KEY: status.SERVICE_ROLE_KEY,
  VITE_SUPABASE_URL: status.API_URL,
  VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
  VITE_DEFAULT_WORKSPACE: "demo",
  BOOTSTRAP_WORKSPACE_SLUGS: "",
  VITE_ENABLE_GOOGLE: "",
  VITE_ENABLE_WHATSAPP: "",
  AI_GATEWAY_API_KEY: "",
  ...(chromium ? { REVIEW_CHROMIUM: chromium } : {}),
};
const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "-c", "tests/review/e2e/playwright.review.config.ts", ...process.argv.slice(2)], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
