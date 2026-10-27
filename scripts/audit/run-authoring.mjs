import process from "node:process";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { verifiedTarget } from "./local-targets.mjs";
import { neutralitySnapshot } from "./neutrality-snapshot.mjs";
const target = verifiedTarget("empty");
const navigation = process.argv[2] === "navigation";
if (process.argv[2] && !navigation) throw new Error("unsupported authoring scope");
const env = { ...process.env, ...target.env, RUN_INTEGRATION: "0", RUN_AUDIT_INTEGRATION: "0",
  OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "",
  NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/audit/deny-external-fetch.mjs")).href}` };
const integration = spawnSync(process.execPath, ["scripts/audit/run-integration.mjs", "authoring"], { env, stdio: "inherit" });
if (integration.status !== 0) process.exit(integration.status ?? 1);
const fixture = JSON.parse(readFileSync(".codex-tmp/D12-fixture.private.json", "utf8"));
if (!isDeepStrictEqual(fixture.target, target.identity)) throw new Error("D12 target identity drift");
Object.assign(env, { VITE_SUPABASE_URL: target.env.SUPABASE_URL, VITE_SUPABASE_ANON_KEY: target.env.SUPABASE_ANON_KEY,
  VITE_DEFAULT_WORKSPACE: fixture.slug, VITE_ENABLE_WHATSAPP: "false", VITE_ENABLE_GOOGLE: "false", ADFOCATE_BROWSER_SCOPE: "D12" });
const args = ["node_modules/@playwright/test/cli.js", "test", "e2e/operator-authoring.spec.ts", ...(navigation ? ["--grep", "unsaved navigation"] : [])];
const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
const raw = JSON.parse(readFileSync(".codex-tmp/browser-results.private.json", "utf8"));
const tests = [];
function visit(suites) { for (const suite of suites ?? []) { for (const spec of suite.specs ?? []) tests.push({ title: spec.title, ok: spec.ok,
  results: spec.tests.flatMap(test => test.results.map(run => ({ status: run.status, duration: run.duration }))) }); visit(suite.suites); } }
visit(raw.suites);
let neutral = false;
if (result.status === 0 && !navigation) {
  const checked = verifiedTarget("empty");
  const before = JSON.parse(readFileSync("docs/verification/D12-browser-before.json", "utf8"));
  if (before.runId !== fixture.runId || ![fixture.creator.id, fixture.workspaceId].every(value => /^[a-f0-9-]{36}$/.test(value))) throw new Error("stale/invalid authoring neutrality baseline");
  const after = neutralitySnapshot(checked, fixture.creator.id, fixture.workspaceId);
  neutral = isDeepStrictEqual(before.snapshot, after);
  writeFileSync("docs/verification/D12-browser-neutrality.json", JSON.stringify({ runId: fixture.runId,
    before: before.snapshot, after, allEqual: neutral, note: "Measured after the existing successful join; raw setup XP remains visible. No completion or payment performed." }, null, 2) + "\n");
}
writeFileSync("docs/verification/D12-browser-summary.json", JSON.stringify({ runId: fixture.runId, target: target.identity,
  tests, stats: raw.stats, browser: "installed Edge; desktop/emulated viewport only", auth: "real local Auth sessions",
  providers: "external HTTP blocked; paid providers disabled; no real social publication", navigationOnly: navigation, neutrality: neutral }, null, 2) + "\n");
process.exit(result.status === 0 && (navigation || neutral) ? 0 : result.status || 1);
