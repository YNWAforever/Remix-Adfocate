import process from "node:process";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { verifiedTarget } from "./local-targets.mjs";
import { neutralitySnapshot } from "./neutrality-snapshot.mjs";

// Identity precedes reading fixture credentials, browser setup and application clients.
const target = verifiedTarget("empty");
const fixture = JSON.parse(readFileSync(".codex-tmp/D15-fixture.private.json", "utf8"));
if (!isDeepStrictEqual(fixture.target, target.identity)) throw new Error("D15 fixture target identity drift");
const actors = [fixture.creator.id, fixture.other.id];
const before = actors.map(id => neutralitySnapshot(target, id, fixture.workspaceId));
const env = { ...process.env, ...target.env, RUN_INTEGRATION: "0", RUN_AUDIT_INTEGRATION: "0", ADFOCATE_BROWSER_SCOPE: "D15",
  OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "",
  VITE_SUPABASE_URL: target.env.SUPABASE_URL, VITE_SUPABASE_ANON_KEY: target.env.SUPABASE_ANON_KEY,
  VITE_DEFAULT_WORKSPACE: fixture.slug, VITE_ENABLE_WHATSAPP: "false", VITE_ENABLE_GOOGLE: "false",
  NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/audit/deny-external-fetch.mjs")).href}` };
const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "e2e/academy-learning.spec.ts"], { env, stdio: "inherit" });
const checked = verifiedTarget("empty");
const after = actors.map(id => neutralitySnapshot(checked, id, fixture.workspaceId));
const neutral = isDeepStrictEqual(before, after);
writeFileSync("docs/verification/D15-browser-neutrality.json", JSON.stringify({ runId: fixture.runId, actorIds: actors, before, after, allEqual: neutral,
  note: "Raw balances, XP, ledger counts and reward inventory; no normalization. No reward is awarded for learning." }, null, 2) + "\n");
const raw = JSON.parse(readFileSync(".codex-tmp/browser-results.private.json", "utf8"));
const tests = [];
function visit(suites) { for (const suite of suites ?? []) { for (const spec of suite.specs ?? []) tests.push({ title: spec.title, ok: spec.ok,
  results: spec.tests.flatMap(test => test.results.map(run => ({ status: run.status, duration: run.duration }))) }); visit(suite.suites); } }
visit(raw.suites);
if (!/^[a-f0-9-]{36}$/.test(fixture.browserTrack.id)) throw new Error("invalid exact course ID");
const persisted = JSON.parse(checked.sql(`select jsonb_build_object(
  'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',id,'version',content_version,'revision',revision,'status',status,'position',position,'approvalRef',approval_ref) order by position,content_version) from public.academy_lessons where track_id='${fixture.browserTrack.id}'),'[]'::jsonb),
  'progress',coalesce((select jsonb_agg(jsonb_build_object('creatorId',p.creator_id,'lessonId',p.lesson_id,'version',p.content_version,'completedAt',p.completed_at)) from public.creator_lesson_progress p join public.academy_lessons l on (l.id,l.content_version)=(p.lesson_id,p.content_version) where l.track_id='${fixture.browserTrack.id}'),'[]'::jsonb));`));
writeFileSync("docs/verification/D15-browser-summary.json", JSON.stringify({ target: target.identity, runId: fixture.runId, tests, stats: raw.stats, persisted,
  auth: "Real local Auth sessions from the identity-gated API fixture; separate Creator contexts.",
  browser: "Installed Microsoft Edge; 1280x900 operator and 390x844 Creator viewport emulation.",
  content: "Two explicitly synthetic lesson units; test approval references only. No approved curriculum claimed.",
  limitations: ["No deployment, hosted runtime, physical device or Safari/WebKit acceptance.", "One completion 503 is an explicit transport mock; successful completion and version-conflict 409 use the real local API and database."] }, null, 2) + "\n");
process.exit(result.status === 0 && neutral ? 0 : result.status || 1);
