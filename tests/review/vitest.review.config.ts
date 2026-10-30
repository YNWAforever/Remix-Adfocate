import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Review suite: static contract checks run anywhere; integration specs need the local stack
// (run via tests/review/run-review-tests.mjs). `it.fails("[F-xx] …")` marks a confirmed defect:
// it passes while the bug exists and turns red once fixed, so the marker must be removed.
const integration = process.env.REVIEW_DISPOSABLE_DB === "1";
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: integration ? ["tests/review/**/*.test.ts"] : ["tests/review/static/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
