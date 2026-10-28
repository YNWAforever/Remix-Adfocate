import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Standalone evidence only: no root Vite/TanStack plugins or dotenv loading.
export default defineConfig({
  envDir: false,
  resolve: { alias: { "@": fileURLToPath(new URL("../../../src", import.meta.url)) } },
  test: {
    environment: "jsdom", globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["docs/verification/D19-assistant-offline-20261026/assistant-boundary.test.tsx"],
    maxWorkers: 1, minWorkers: 1,
    env: { RUN_INTEGRATION: "0", RUN_AUDIT_INTEGRATION: "0", VITE_SUPABASE_URL: "https://offline.invalid", VITE_SUPABASE_ANON_KEY: "offline-placeholder" },
  },
});
