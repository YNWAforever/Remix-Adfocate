import { defineConfig } from "@playwright/test";
import process from "node:process";
export default defineConfig({
  testDir: "./e2e", testMatch: "d17-r2-quality.spec.ts", fullyParallel: false, workers: 1, retries: 0,
  timeout: 180000, expect: { timeout: 15000 },
  reporter: [["line"], ["json", { outputFile: `.codex-tmp/D17-R2-browser-${process.env.D17_R2_PHASE}.private.json` }]],
  use: { baseURL: "http://127.0.0.1:56400", channel: "msedge", locale: "en-HK", timezoneId: "Asia/Hong_Kong", actionTimeout: 15000, trace: "off", screenshot: "off", video: "off" },
  webServer: { command: process.env.D17_R2_PHASE === "final" || process.env.D17_R2_PHASE?.startsWith("profile-")
    ? `"${process.execPath}" node_modules/vite-node/vite-node.mjs scripts/audit/serve-quality.ts`
    : `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 56400 --strictPort`,
    url: "http://127.0.0.1:56400/api/health", reuseExistingServer: false, timeout: 90000, stdout: "ignore", stderr: "pipe" },
});
