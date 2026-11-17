import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { boundedDeltaCommand, deltaChildEnvironment } from "./delta-child-process";
import { canonicalDeltaJson } from "./delta-evidence";
import { parseReleaseManifest, validateManifest } from "./manifest";
import { buildPhase3RehearsalPlan } from "./delta-rehearsal-plan";

const WORKSHEET = /^docs\/verification\/phase3-rehearsal-preflight\/worksheet-([a-f0-9]{40})\.json$/;
const OUTPUT = /^docs\/verification\/phase3-rehearsal-preflight\/plan-([a-f0-9]{40})(?:-[a-z0-9][a-z0-9-]{0,31})?\.json$/;
const MIGRATION = /^supabase\/migrations\/(?:\d{4}|\d{14})_[a-z0-9_]+\.sql$/;
function held(): never { throw new Error("Offline rehearsal preflight rejected"); }
export function rehearsalPreflightPaths(input: string, output: string): string {
  const subject = WORKSHEET.exec(input)?.[1];
  if (!subject || OUTPUT.exec(output)?.[1] !== subject) held();
  return subject;
}
async function canonicalDirectory(root: string, directory: string) {
  let current = directory;
  for (;;) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== current) held();
    if (current === root) return;
    const parent = dirname(current); if (parent === current) held(); current = parent;
  }
}
async function publicFile(root: string, relative: string, maximum: number): Promise<Buffer> {
  if (!WORKSHEET.test(relative) && !MIGRATION.test(relative) && relative !== "supabase/release-manifest.json") held();
  const path = resolve(root, relative); await canonicalDirectory(root, dirname(path));
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum || await realpath(path) !== path) held();
  const bytes = await readFile(path); if (!bytes.length || bytes.length > maximum) held(); return bytes;
}
async function preflightMigrations(root: string) {
  const directory = resolve(root, "supabase/migrations"); await canonicalDirectory(root, directory);
  const names = await readdir(directory); if (names.length > 256) held();
  const sql = names.filter(name => name.endsWith(".sql")); if (!sql.length || sql.length > 120) held();
  for (const name of sql) {
    const relative = `supabase/migrations/${name}`; if (!MIGRATION.test(relative)) held();
    await publicFile(root, relative, 2 * 1024 * 1024);
  }
}
/** Public metadata and repository source only. This function has no capture or execution capability. */
export async function runPhase3RehearsalPlanCli(rootInput: string, input: string, output: string, now = new Date()) {
  const subject = rehearsalPreflightPaths(input, output);
  if (!Number.isFinite(now.getTime())) held();
  const root = await realpath(rootInput), worksheetBytes = await publicFile(root, input, 64 * 1024);
  const worksheet: unknown = JSON.parse(worksheetBytes.toString("utf8"));
  if (!worksheet || typeof worksheet !== "object" || Array.isArray(worksheet)
    || (worksheet as Record<string, unknown>).sourceCommit !== subject) held();
  const manifest = parseReleaseManifest(JSON.parse((await publicFile(root, "supabase/release-manifest.json", 512 * 1024)).toString("utf8")));
  await preflightMigrations(root);
  if ((await validateManifest(manifest, root)).length) held();
  const ancestry = await boundedDeltaCommand("git", ["--no-lazy-fetch", "-C", root, "merge-base", "--is-ancestor", subject, "HEAD"],
    { env: deltaChildEnvironment(), timeoutMs: 15_000, maximumOutputBytes: 64 * 1024 });
  if (ancestry.code !== 0 || ancestry.stdout || ancestry.stderr) held();
  const plan = buildPhase3RehearsalPlan(worksheet, { sourceCommit: subject, preparedAt: now.toISOString(),
    manifestSourceCount: manifest.migrations.length, worksheetSha256: createHash("sha256").update(worksheetBytes).digest("hex") });
  const destination = resolve(root, output), directory = dirname(destination);
  try { await canonicalDirectory(root, directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await canonicalDirectory(root, dirname(directory)); await mkdir(directory, { recursive: true }); await canonicalDirectory(root, directory);
  }
  await writeFile(destination, canonicalDeltaJson(plan) + "\n", { flag: "wx" });
  return { schemaVersion: 1, kind: "phase3-rehearsal-preflight-result", status: "HOLD", validReleaseEvidence: false,
    ownerAccepted: false, captureAuthorized: false, executionAuthorized: false, artifact: output, sourceSqlExecutionAttempted: false,
    manifestSourceCount: manifest.migrations.length, plan };
}
