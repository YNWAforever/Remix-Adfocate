import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => {
  // Each config instance owns only its runtime; old close hooks must not close
  // the replacement created during a restart.
  let closePilot: (()=>Promise<void>) | undefined;
  let pilotClosing: Promise<void> | undefined;
  const closeLocalPilot = () => pilotClosing ??= Promise.resolve().then(() => closePilot?.());
  return ({
  server: {watch: {ignored: ["**/.superpowers/**"]}},
  resolve: {
    alias: {
      "@/components/studio/GrowthImageWorkspaceDev": fileURLToPath(
        new URL(
          command === "serve"
            ? "./src/components/studio/GrowthImageWorkspaceDev.tsx"
            : "./src/components/studio/GrowthImageWorkspaceProduction.tsx",
          import.meta.url,
        ),
      ),
    },
  },
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
      async closeBundle() {await closeLocalPilot();},
      async configureServer(server) {
        if (process.env.VITE_STUDIO_FIXTURE === "true") {
          const [{createControlledPilotMockApp},{createViteApiMiddleware}]=await Promise.all([
            import("./server/lib/creatorGrowth/pilot/mockApp.js"),import("./server/devApi.js"),
          ]);
          const {openDurablePilot}=await import("./server/lib/creatorGrowth/pilot/durableRuntime.js");
          const runtime=await openDurablePilot(process.env.KOCMAX_LOCAL_PILOT_DIRECTORY ?? ".superpowers/controlled-pilot-local-v2-db");
          closePilot=runtime.close;
          // Vite configures the replacement before invoking old closeBundle.
          // Release this owner first; a failed close must abort the restart.
          const restart=server.restart.bind(server);
          server.restart=async(forceOptimize)=>{await closeLocalPilot();await restart(forceOptimize);};
          const fixtureMiddleware=createViteApiMiddleware(createControlledPilotMockApp(runtime.pilot,runtime.journey,runtime.privateWorkspace));
          server.middlewares.use((req,res,next)=>{
            if(!req.url?.startsWith("/api/controlled-pilot-mock/"))return next();
            if(pilotClosing){res.statusCode=503;res.end('LOCAL_PILOT_RESTARTING');return;}
            return fixtureMiddleware(req,res,next);
          });
          return;
        }
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
});
