// Dedicated owned fixture process. No dotenv, app configuration, ambient credentials or watcher.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL", "CI", "GITHUB_ACTIONS"]);
for (const key of Object.keys(process.env)) if (!allowed.has(key.toUpperCase())) delete process.env[key];
let transformerServer;
try {
  const require = createRequire(import.meta.url), nested = createRequire(require.resolve("vite-node/package.json"));
  const viteRoot = dirname(nested.resolve("vite/package.json"));
  const [{ createServer }, { ViteNodeServer }, { ViteNodeRunner }] = await Promise.all([
    import(pathToFileURL(resolve(viteRoot, "dist/node/index.js")).href), import("vite-node/server"), import("vite-node/client"),
  ]);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  transformerServer = await createServer({ root, configFile: false, envFile: false, plugins: [], logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null } });
  await transformerServer.pluginContainer.buildStart({});
  const transformer = new ViteNodeServer(transformerServer);
  const runner = new ViteNodeRunner({ root, base: transformerServer.config.base, fetchModule: id => transformer.fetchModule(id), resolveId: (id, importer) => transformer.resolveId(id, importer) });
  await runner.executeId("/@vite/env");
  const implementation = await runner.executeFile(fileURLToPath(new URL("./delta-provider-cli.ts", import.meta.url)));
  await implementation.providerRehearsalMain(process.argv.slice(2));
} catch (error) {
  const code = error && typeof error === "object" && typeof error.code === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(error.code) ? error.code : "fixed-provider-runner-refused";
  process.stdout.write(JSON.stringify({ schemaVersion: 1, kind: "owned-provider-refusal", status: "HOLD", validReleaseEvidence: false, reasonCode: code }) + "\n");
  process.exitCode = 1;
} finally {
  if (transformerServer) try { await transformerServer.close(); } catch {
    process.stdout.write(JSON.stringify({ kind: "owned-provider-refusal", status: "HOLD", validReleaseEvidence: false, reasonCode: "provider-transformer-cleanup-unverified" }) + "\n"); process.exitCode = 1;
  }
}
