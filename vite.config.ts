import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: { output: { manualChunks(moduleId) {
      const id = moduleId.replaceAll("\\", "/");
      if (!id.includes("/node_modules/")) return;
      // D17 module analysis identified these shared dependencies in the entry chunk.
      if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
      if (id.includes("/node_modules/@supabase/")) return "vendor-supabase";
      if (id.includes("/node_modules/@tanstack/")) return "vendor-router";
    } } },
  },
  plugins: [
    {
      name: "local-hono-api",
      apply: "serve",
      transformIndexHtml(html) {
        return process.env.VITE_STUDIO_FIXTURE === "true"
          ? html.replace('/src/main.tsx', '/src/studio-preview.tsx') : html;
      },
      async configureServer(server) {
        if (process.env.VITE_STUDIO_FIXTURE === "true") return;
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
