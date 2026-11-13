// Owned fixture entry only. No app config, dotenv, routes, watcher or listener.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let server, recoveryModule;
try {
  const require = createRequire(import.meta.url);
  const nodeRequire = createRequire(require.resolve("vite-node/package.json"));
  const viteRoot = dirname(nodeRequire.resolve("vite/package.json"));
  const [{ createServer }, { ViteNodeServer }, { ViteNodeRunner }] = await Promise.all([
    import(pathToFileURL(resolve(viteRoot, "dist/node/index.js")).href), import("vite-node/server"), import("vite-node/client"),
  ]);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const entry = fileURLToPath(new URL("./delta-recovery-native.ts", import.meta.url));
  server = await createServer({ root, configFile: false, envFile: false, plugins: [], logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null } });
  await server.pluginContainer.buildStart({});
  const transformer = new ViteNodeServer(server);
  const runner = new ViteNodeRunner({ root, base: server.config.base, fetchModule: id => transformer.fetchModule(id), resolveId: (id, importer) => transformer.resolveId(id, importer) });
  await runner.executeId("/@vite/env");
  recoveryModule = await runner.executeFile(entry);
  await recoveryModule.pairedRecoveryNativeMain(process.argv.slice(2));
} catch (error) {
  console.error(JSON.stringify({ schemaVersion: 1, kind: "paired-recovery-fixture-refusal", status: "HOLD", validReleaseEvidence: false, reasonCode: "owned_paired_recovery_failed",
    ...(recoveryModule ? recoveryModule.pairedRecoverySafeFailure(error) : { phase: "fixed-runner-bootstrap" }) }));
  process.exitCode = 1;
} finally {
  if (server) { try { await server.close(); } catch { process.stderr.write("Paired recovery transformer cleanup unverified; retain the recovery receipt.\n"); process.exitCode = 1; } }
}
