import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import { verifiedTarget } from "./local-targets.mjs";
import { neutralitySnapshot } from "./neutrality-snapshot.mjs";
const target = verifiedTarget("empty");
const env = { ...process.env, ...target.env, RUN_INTEGRATION: "0", RUN_AUDIT_INTEGRATION: "0", ADFOCATE_BROWSER_SCOPE: "R2_UI",
  OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "",
  NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/audit/deny-external-fetch.mjs")).href}` };
const run = args => spawnSync(process.execPath, args, { env, stdio: "inherit" }).status ?? 1;
if (!process.argv.includes("--resume")) {
  const prepared = run(["node_modules/vite-node/vite-node.mjs", "scripts/audit/prepare-r2-support-browser.ts"]);
  if (prepared) process.exit(prepared);
}
const fx = JSON.parse(readFileSync(".codex-tmp/R2-ui-fixture.private.json", "utf8"));
if (!isDeepStrictEqual(fx.target, target.identity)) throw new Error("R2 fixture identity drift");
Object.assign(env, { VITE_SUPABASE_URL: target.env.SUPABASE_URL, VITE_SUPABASE_ANON_KEY: target.env.SUPABASE_ANON_KEY,
  VITE_DEFAULT_WORKSPACE: fx.slug, VITE_ENABLE_WHATSAPP: "false", VITE_ENABLE_GOOGLE: "false" });
const actors = [fx.creator.id, fx.other.id];
const before = actors.map(id => neutralitySnapshot(target, id, fx.workspaceId));
const exit = run(["node_modules/@playwright/test/cli.js", "test", "--config=playwright.r2-support.config.ts"]);
const checked = verifiedTarget("empty"), after = actors.map(id => neutralitySnapshot(checked, id, fx.workspaceId));
writeFileSync("docs/verification/R2-ui-neutrality.json", JSON.stringify({ runId: fx.runId, target: checked.identity, before, after,
  allEqual: isDeepStrictEqual(before, after), scope: "Only this R2 UI/metadata fixture; historical D19 funded pending/cancel/reapproval remains separate." }, null, 2) + "\n");
if (exit === 0) {
  const raw = JSON.parse(readFileSync(".codex-tmp/R2-ui-browser-results.private.json", "utf8")), tests = [];
  const visit = s => { for (const spec of s.specs ?? []) tests.push({ title: spec.title, ok: spec.ok,
    results: spec.tests.flatMap(t => t.results.map(r => ({ status: r.status, duration: r.duration }))) }); for (const c of s.suites ?? []) visit(c); };
  for (const s of raw.suites) visit(s);
  writeFileSync("docs/verification/R2-ui-browser-summary.json", JSON.stringify({ runId: fx.runId, target: checked.identity, tests, stats: raw.stats,
    passed: tests.filter(t => t.ok).length, emptyReadCounts: fx.emptyReadCounts,
    browser: "Installed desktop Edge; 390x844 and 1280x900 CSS viewports; not physical mobile/Safari",
    scope: "Real local Auth/API/RLS/DB successful reads and metadata writes; explicit fault/empty mocks labelled in each UI record; no curriculum, external provider or formal staff cutover." }, null, 2) + "\n");
}
process.exit(exit || (isDeepStrictEqual(before, after) ? 0 : 1));
