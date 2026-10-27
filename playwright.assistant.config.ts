import { defineConfig } from "@playwright/test";
import process from "node:process";
export default defineConfig({ testDir: "./e2e", testMatch: "mission-assist.spec.ts", fullyParallel: false, workers: 1, retries: 0, maxFailures: 1,
  timeout: 45000, expect: { timeout: 15000 }, reporter: [["line"], ["json", { outputFile: ".codex-tmp/D20-browser-results.private.json" }]],
  use: { baseURL: "http://127.0.0.1:56500", channel: "msedge", viewport: { width: 390, height: 844 }, locale: "en-HK", timezoneId: "Asia/Hong_Kong", trace: "off", screenshot: "off", video: "off" },
  webServer: { command: `"${process.execPath}" --experimental-strip-types scripts/audit/serve-assistant.ts`, url: "http://127.0.0.1:56500/e2e/fixtures/mission-assist.html", timeout: 60000, reuseExistingServer: false, stdout: "ignore", stderr: "pipe" },
});
