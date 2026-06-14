import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const integration = process.env.RUN_INTEGRATION === "1";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["server/**/*.test.ts", "src/**/*.test.ts?(x)"],
    exclude: integration ? [] : ["server/test/rls.test.ts"],
    // Integration setup/teardown hooks do many sequential DB round-trips (cleanup,
    // seed creator+mission, join, submit). The 10s default hook timeout is too tight
    // on a slow local stack; give them headroom (no effect on the fast unit suites).
    ...(integration ? { hookTimeout: 45000, testTimeout: 30000 } : {}),
    env: {
      VITE_SUPABASE_URL: "https://placeholder.supabase.co",
      VITE_SUPABASE_ANON_KEY: "placeholder-anon-key",
    },
  },
});
