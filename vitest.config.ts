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
    env: {
      VITE_SUPABASE_URL: "https://placeholder.supabase.co",
      VITE_SUPABASE_ANON_KEY: "placeholder-anon-key",
    },
  },
});
