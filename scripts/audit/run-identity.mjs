import process from "node:process";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { verifiedTarget } from "./local-targets.mjs";
import { neutralitySnapshot } from "./neutrality-snapshot.mjs";
const target = verifiedTarget("empty");
const env = { ...process.env, ...target.env, RUN_INTEGRATION: "0", RUN_AUDIT_INTEGRATION: "0", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", RAPIDAPI_KEY: "",
  NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/audit/deny-external-fetch.mjs")).href}` };
const api = spawnSync(process.execPath, ["scripts/audit/run-integration.mjs", "identity"], { env, stdio: "inherit" });
if (api.status !== 0) process.exit(api.status ?? 1);
const fixture = JSON.parse(readFileSync(".codex-tmp/D13-fixture.private.json", "utf8"));
if (!isDeepStrictEqual(fixture.target, target.identity)) throw new Error("D13 target identity drift");
const before = Object.fromEntries(["creator", "fresh", "recoveryActor"].map(key => [key, neutralitySnapshot(target, fixture[key].id, fixture.workspaceId)]));
writeFileSync("docs/verification/D13-browser-before.json", JSON.stringify({ runId: fixture.runId, before }, null, 2) + "\n");
Object.assign(env, { VITE_SUPABASE_URL: target.env.SUPABASE_URL, VITE_SUPABASE_ANON_KEY: target.env.SUPABASE_ANON_KEY, VITE_DEFAULT_WORKSPACE: fixture.slug,
  BOOTSTRAP_WORKSPACE_SLUGS: fixture.slug, VITE_ENABLE_WHATSAPP: "false", VITE_ENABLE_GOOGLE: "false", ADFOCATE_BROWSER_SCOPE: "D13" });
const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "e2e/creator-identity-profile.spec.ts"], { env, stdio: "inherit" });
const raw = JSON.parse(readFileSync(".codex-tmp/browser-results.private.json", "utf8")), tests = [];
function visit(suites) { for (const suite of suites ?? []) { for (const spec of suite.specs ?? []) tests.push({ title: spec.title, ok: spec.ok,
  results: spec.tests.flatMap(test => test.results.map(run => ({ status: run.status, duration: run.duration }))) }); visit(suite.suites); } }
visit(raw.suites);
const checked = verifiedTarget("empty");
const after = Object.fromEntries(["creator", "fresh", "recoveryActor"].map(key => [key, neutralitySnapshot(checked, fixture[key].id, fixture.workspaceId)]));
const nonWelcomeNeutral = isDeepStrictEqual(before.creator, after.creator) && isDeepStrictEqual(before.recoveryActor, after.recoveryActor);
const welcomeUnique = after.fresh.points - before.fresh.points === 100 && after.fresh.pointLedger - before.fresh.pointLedger === 1
  && isDeepStrictEqual({ ...after.fresh, points: before.fresh.points, pointLedger: before.fresh.pointLedger }, before.fresh);
writeFileSync("docs/verification/D13-browser-neutrality.json", JSON.stringify({ runId: fixture.runId, before, after, nonWelcomeNeutral, welcomeUnique,
  note: "Only the existing 100-point welcome bonus may change points/pointLedger; no mission reward, cash, budget, redemption or inventory changes." }, null, 2) + "\n");
writeFileSync("docs/verification/D13-browser-summary.json", JSON.stringify({ runId: fixture.runId, target: target.identity, tests, stats: raw.stats,
  browser: "installed Edge, 390x844 emulated viewport", auth: "real local password login; recovery UI PKCE exchange explicitly mocked; local Auth update real",
  providers: "external HTTP blocked; no email, WhatsApp, paid social/AI or external publication", nonWelcomeNeutral, welcomeUnique }, null, 2) + "\n");
process.exit(result.status === 0 && nonWelcomeNeutral && welcomeUnique ? 0 : result.status || 1);
