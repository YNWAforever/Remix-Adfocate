import { spawn } from "node:child_process";
import process from "node:process";
// Local-only preview; no project secrets or server/provider configuration required.
const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "8772", "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, VITE_STUDIO_FIXTURE:"true",VITE_STUDIO_SHELL:"true",VITE_STUDIO_THREADS:"true",VITE_PUBLIC_MISSION_PREVIEW:"true",VITE_SUPABASE_URL:"http://127.0.0.1:1",VITE_SUPABASE_ANON_KEY:"local-fixture-only" },
});
child.on("exit", code=>process.exitCode=code??1);
