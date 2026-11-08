import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command, mode }) => {
  if (command !== "build" || mode !== "p5-candidate-offline") {
    throw new Error("P5_FIXTURE_BUILD_ONLY");
  }
  return {
    envDir: false,
    envPrefix: [],
    define: {
      // Only this isolated test build can enter the development fixture.
      "import.meta.env.DEV": "true",
      "import.meta.env.VITE_STUDIO_FIXTURE": '"true"',
      "import.meta.env.VITE_STUDIO_SHELL": '"true"',
      "import.meta.env.VITE_STUDIO_THREADS": '"true"',
      "import.meta.env.VITE_PUBLIC_MISSION_PREVIEW": '"true"',
      "import.meta.env.VITE_SUPABASE_URL": '"http://127.0.0.1:1"',
      "import.meta.env.VITE_SUPABASE_ANON_KEY": '"offline-candidate-browser-only"',
    },
    build: { outDir: ".superpowers/p5-candidate-browser-dist", emptyOutDir: true },
    resolve: {
      alias: {
        "@/components/studio/GrowthImageWorkspaceDev": fileURLToPath(
          new URL("./src/components/studio/GrowthImageWorkspaceDev.tsx", import.meta.url),
        ),
      },
    },
    plugins: [
      {
        name: "p5-candidate-offline-entry",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            if (!html.includes("/src/main.tsx")) throw new Error("P5_FIXTURE_ENTRY_MISSING");
            return html.replace("/src/main.tsx", "/src/studio-preview.tsx")
              .replace(/<link\b[^>]*\bhref="https?:\/\/[^"]+"[^>]*>/g, "");
          },
        },
      },
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      tsconfigPaths(),
    ],
  };
});
