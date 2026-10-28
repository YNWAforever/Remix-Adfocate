import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Standalone verification only; no root plugins, dotenv, real client or target.
export default defineConfig({
  envDir: false,
  resolve: { alias: { "@": fileURLToPath(new URL("../../../src", import.meta.url)) } },
  test: {
    environment: "jsdom", globals: true, setupFiles: ["src/test/setup.ts"],
    include: ["docs/verification/D19-wallet-notifications-offline-20261026/wallet-notifications.test.tsx"],
    minWorkers: 1, maxWorkers: 1,
    env: { RUN_INTEGRATION: "0", RUN_AUDIT_INTEGRATION: "0", VITE_SUPABASE_URL: "https://offline.invalid", VITE_SUPABASE_ANON_KEY: "offline-placeholder" },
  },
});
