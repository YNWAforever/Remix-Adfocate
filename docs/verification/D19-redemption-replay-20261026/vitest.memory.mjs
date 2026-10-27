import { defineConfig } from "vitest/config";
export default defineConfig({ envDir: false, test: {
  environment: "node", globals: true,
  include: ["server/test/redemption-intent-memory.test.ts"],
  minWorkers: 1, maxWorkers: 1, hookTimeout: 60000, testTimeout: 30000,
  env: { RUN_INTEGRATION: "0", RUN_AUDIT_INTEGRATION: "0" },
} });
