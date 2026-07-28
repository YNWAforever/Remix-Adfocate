import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    {
      name: "local-hono-api",
      apply: "serve",
      async configureServer(server) {
        const [{ createApp }, { createViteApiMiddleware }] = await Promise.all([
          import("./server/app.js"),
          import("./server/devApi.js"),
        ]);
        server.middlewares.use(createViteApiMiddleware(createApp().app));
      },
    },
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
});
