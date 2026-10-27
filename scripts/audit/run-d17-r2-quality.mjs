import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import { verifiedTarget } from "./local-targets.mjs";
import { neutralitySnapshot } from "./neutrality-snapshot.mjs";

const phase = process.argv[2];
if (!/^(red|interim|profile-[a-z0-9-]+|final)$/.test(phase ?? "")) throw new Error("Explicit D17 R2 phase required");
const production = phase === "final" || phase.startsWith("profile-");
const target = verifiedTarget("empty");
const fx = JSON.parse(readFileSync(".codex-tmp/R2-ui-fixture.private.json", "utf8"));
if (!isDeepStrictEqual(fx.target, target.identity)) throw new Error("Reused owned fixture identity drift");
const env = { ...process.env, ...target.env, RUN_INTEGRATION: "0", RUN_AUDIT_INTEGRATION: "0", ADFOCATE_BROWSER_SCOPE: "D17_R2", D17_R2_PHASE: phase,
  VITE_SUPABASE_URL: target.env.SUPABASE_URL, VITE_SUPABASE_ANON_KEY: target.env.SUPABASE_ANON_KEY, VITE_DEFAULT_WORKSPACE: fx.slug,
  VITE_ENABLE_WHATSAPP: "false", VITE_ENABLE_GOOGLE: "false", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "",
  NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/audit/deny-external-fetch.mjs")).href}` };
if (production) {
  env.NODE_ENV = "production";
  const build = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--mode", "production"], { env, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const before = [fx.creator.id, fx.other.id].map(id => neutralitySnapshot(target, id, fx.workspaceId));
const run = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.d17-r2.config.ts", ...(phase.startsWith("profile-") ? ["--grep", "records current production-asset"] : [])], { env, stdio: "inherit" });
const checked = verifiedTarget("empty"), after = [fx.creator.id, fx.other.id].map(id => neutralitySnapshot(checked, id, fx.workspaceId));
writeFileSync(`docs/verification/D17-R2-neutrality-${phase}.json`, JSON.stringify({ runId: fx.runId, target: checked.identity, before, after, allEqual: isDeepStrictEqual(before, after),
  scope: "Read-only quality review of prior R2 owned fixtures; no new fixture, content save, membership, reward or financial action. D19 funded neutrality remains historical." }, null, 2) + "\n");
const raw = JSON.parse(readFileSync(`.codex-tmp/D17-R2-browser-${phase}.private.json`, "utf8")), tests = [];
const visit = suite => {
  for (const spec of suite.specs ?? []) tests.push({ title: spec.title, ok: spec.ok, results: spec.tests.flatMap(t => t.results.map(r => ({ status: r.status, duration: r.duration }))) });
  for (const child of suite.suites ?? []) visit(child);
};
for (const suite of raw.suites ?? []) visit(suite);
writeFileSync(`docs/verification/D17-R2-browser-${phase}.json`, JSON.stringify({ target: checked.identity, runId: fx.runId, tests, stats: raw.stats,
  productionAssets: production,
  browser: "Installed desktop Edge; real owned Auth/API/RLS reads; explicit 503 recovery mock. No native browser zoom, physical device, Safari, manual AT, hosted or field-performance acceptance." }, null, 2) + "\n");
process.exit(run.status || (isDeepStrictEqual(before, after) ? 0 : 1));
