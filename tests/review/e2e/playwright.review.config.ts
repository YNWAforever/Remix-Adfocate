import { defineConfig } from "@playwright/test";
import process from "node:process";

// Review E2E: Vite dev server (SPA + in-process Hono API) against the local Supabase stack.
// Run via `node tests/review/run-review-e2e.mjs`, which injects loopback-only env.
const port = 56410;
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90000,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-HK",
    timezoneId: "Asia/Hong_Kong",
    viewport: { width: 1280, height: 900 },
    launchOptions: { executablePath: process.env.REVIEW_CHROMIUM || undefined },
    trace: "off", screenshot: "only-on-failure", video: "off",
  },
  outputDir: "../../../.review-tmp/e2e-results",
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "../../../",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 90000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
