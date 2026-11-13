// Fixed release entry only. No application config, dotenv, router generation,
// file watching, or listening application server participates in this runner.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let server;
try {
  // vite-node 2 is locked to Vite 5; keep its runtime separate from app Vite 7.
  const require = createRequire(import.meta.url);
  const nodeRequire = createRequire(require.resolve("vite-node/package.json"));
  const viteRoot = dirname(nodeRequire.resolve("vite/package.json"));
  const [{ createServer }, { ViteNodeServer }, { ViteNodeRunner }] = await Promise.all([
    import(pathToFileURL(resolve(viteRoot, "dist/node/index.js")).href),
    import("vite-node/server"), import("vite-node/client"),
  ]);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const entry = fileURLToPath(new URL("./delta-cli.ts", import.meta.url));
  server = await createServer({ root, configFile: false, envFile: false, plugins: [], logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null } });
  await server.pluginContainer.buildStart({});
  const transformer = new ViteNodeServer(server);
  const runner = new ViteNodeRunner({ root, base: server.config.base,
    fetchModule: id => transformer.fetchModule(id), resolveId: (id, importer) => transformer.resolveId(id, importer) });
  await runner.executeId("/@vite/env");
  const module = await runner.executeFile(entry);
  await module.runDeltaCliMain(process.argv.slice(2));
} catch {
  console.log(JSON.stringify({ schemaVersion: 1, kind: "protected-delta-bootstrap-refusal", status: "HOLD",
    validReleaseEvidence: false, reasonCode: "fixed_release_runner_failed", executionState: "consult_execution_receipt_or_independent_readonly_state" }, null, 2));
  process.exitCode = 1;
} finally {
  if (server) {
    try { await server.close(); }
    catch {
      // Transformation cleanup cannot erase an authoritative database receipt.
      process.stderr.write("Protected release transformer cleanup unverified; retain the execution receipt.\n");
      process.exitCode = 1;
    }
  }
}
