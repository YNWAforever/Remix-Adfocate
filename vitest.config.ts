import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const integration = process.env.RUN_INTEGRATION === "1";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["api/**/*.test.ts", "src/**/*.test.ts?(x)"],
    exclude: integration ? [] : ["api/test/rls.test.ts"],
  },
});
