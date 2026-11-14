import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertSanitized } from "./evidence";
import { canonicalDeltaJson } from "./delta-evidence";
import { boundedDeltaCommand, deltaChildEnvironment } from "./delta-child-process";
import { parseReleaseManifest, validateManifest } from "./manifest";
import { buildPhase3ReviewPacket, PHASE3_REVIEW_SOURCE_PATHS, type Phase3ReviewPacketInput } from "./delta-review-packet";

type CapturedArtifact = Phase3ReviewPacketInput["provider"];
interface ArtifactReference { readonly path: string; readonly sha256: string; readonly contentDigest: string }
const SHA = /^[a-f0-9]{64}$/;
const DOC = /^docs\/verification\/(?:phase3-provider-rehearsal|phase3-paired-recovery|phase3-release-review)\/[a-zA-Z0-9._-]+\.json$/;
const SOURCE = /^scripts\/release\/delta-[a-z0-9-]+\.(?:ts|mjs|ps1|sql)$/;
function held(): never { throw new Error("Offline release review rejected"); }
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) held(); const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== [...keys].sort().join()) held(); return row;
}
async function boundedPublicFile(root: string, relative: string, maximum: number): Promise<Buffer> {
  if (!DOC.test(relative) && !SOURCE.test(relative) && relative !== "supabase/release-manifest.json") held(); const path = resolve(root, relative);
  let ancestor = dirname(path);
  for (;;) {
    const stat = await lstat(ancestor); if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(ancestor) !== ancestor) held();
    if (ancestor === root) break; const parent = dirname(ancestor); if (parent === ancestor) held(); ancestor = parent;
  }
  const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum || await realpath(path) !== path) held();
  const bytes = await readFile(path); if (bytes.length < 1 || bytes.length > maximum) held(); return bytes;
}
function reference(value: unknown): ArtifactReference {
  const row = object(value, ["path", "sha256", "contentDigest"]);
  if (typeof row.path !== "string" || !DOC.test(row.path) || typeof row.sha256 !== "string" || !SHA.test(row.sha256) || typeof row.contentDigest !== "string" || !SHA.test(row.contentDigest)) held();
  return row as unknown as ArtifactReference;
}
/** Metadata/public source only. No provider, database, private-store or approval operation. */
export async function runPhase3ReviewCli(rootInput: string, input: string, output: string, now = new Date()) {
  const root = await realpath(rootInput);
  const manifest = parseReleaseManifest(JSON.parse((await boundedPublicFile(root, "supabase/release-manifest.json", 512 * 1024)).toString("utf8")));
  if ((await validateManifest(manifest, root)).length) held();
  if (!/^docs\/verification\/phase3-release-review\/selection-[a-f0-9]{40}\.json$/.test(input) || !Number.isFinite(now.getTime())) held();
  const selection = object(JSON.parse((await boundedPublicFile(root, input, 64 * 1024)).toString("utf8")), ["schemaVersion", "sourceCommit", "provider", "pairedRecovery", "sourceCi"]); assertSanitized(selection);
  if (selection.schemaVersion !== 1 || typeof selection.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(selection.sourceCommit)
    || input !== `docs/verification/phase3-release-review/selection-${selection.sourceCommit}.json` || output !== `docs/verification/phase3-release-review/review-${selection.sourceCommit}.json`) held();
  const ancestry = await boundedDeltaCommand("git", ["-C", root, "merge-base", "--is-ancestor", selection.sourceCommit, "HEAD"], { env: deltaChildEnvironment(), timeoutMs: 15_000, maximumOutputBytes: 64 * 1024 });
  if (ancestry.code !== 0 || ancestry.stdout || ancestry.stderr) held();
  const refs = [reference(selection.provider), reference(selection.pairedRecovery), reference(selection.sourceCi)];
  if (!refs[0]!.path.startsWith("docs/verification/phase3-provider-rehearsal/owned-") || !refs[1]!.path.startsWith("docs/verification/phase3-paired-recovery/native-")
    || refs[2]!.path !== `docs/verification/phase3-release-review/source-ci-${selection.sourceCommit}.json`) held();
  const captured = await Promise.all(refs.map(async row => ({ ...row, bytes: await boundedPublicFile(root, row.path, 2 * 1024 * 1024) })));
  const currentSources = await Promise.all(PHASE3_REVIEW_SOURCE_PATHS.map(async path => {
    const bytes = await boundedPublicFile(root, path, 2 * 1024 * 1024);
    return { path, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  }));
  const packet = buildPhase3ReviewPacket({ sourceCommit: selection.sourceCommit, preparedAt: now.toISOString(), provider: captured[0]! as CapturedArtifact,
    pairedRecovery: captured[1]! as CapturedArtifact, sourceCi: captured[2]! as CapturedArtifact, currentSources });
  const destination = resolve(root, output), directory = dirname(destination), parent = dirname(directory);
  if (await realpath(parent) !== parent || (await lstat(parent)).isSymbolicLink()) held();
  await mkdir(directory, { recursive: true }); if (await realpath(directory) !== directory || (await lstat(directory)).isSymbolicLink()) held();
  await writeFile(destination, canonicalDeltaJson(packet) + "\n", { flag: "wx" });
  return { schemaVersion: 1, kind: "phase3-release-review-preparation", status: "HOLD", validReleaseEvidence: false, artifact: output, sourceSqlExecutionAttempted: false, manifestSourceCount: manifest.migrations.length, packet };
}
