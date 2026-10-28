import process from "node:process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Static component harness only: no Hono app, DB, fixture seeding, real session or provider.
Object.assign(process.env, { VITE_SUPABASE_URL: "https://offline.invalid", VITE_SUPABASE_ANON_KEY: "offline-anon",
  AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "" });
const server = await createServer({ configFile: false, envDir: "e2e/fixtures", plugins: [react(), tailwindcss(), tsconfigPaths()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 56500, strictPort: true },
});
await server.listen();
console.log("D20 offline component harness: loopback 56500; all API responses mocked by the browser runner");
