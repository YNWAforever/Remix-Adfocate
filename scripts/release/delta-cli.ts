import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSanitized } from "./evidence";
import { buildDeltaEvidence, digestDeltaEvidence, parseDeltaEvidence, verifyDeltaEvidence } from "./delta-evidence";
import { DeltaExecutionFailure, executeBundledDelta, type DeltaExecutionReport } from "./delta-executor";
import { createManagedDeltaDatabase } from "./delta-native";
import { compileDeltaProgram, type DeltaProgramBindings } from "./delta-program";
import { createGitHubDeltaReaders } from "./delta-providers.github";
import { committedDeltaProofReader, resolveOwnerAcceptedDeltaReports, type DeltaOwnerProofAcceptance } from "./delta-providers.reports";
import { canonicalEvidencePath, verifyDeltaProvenance, verifyEvidenceFilePath } from "./delta-provenance";
import { DELTA_RELEASE_PROFILE, DELTA_RELEASE_PROJECT, DELTA_REQUIRED_GATES, DELTA_SOURCE_SHA256, type DeltaExpectedContext, type DeltaReleaseEvidence } from "./delta-release-contracts";
import { parseReleaseManifest, validateManifest } from "./manifest";

export interface DeltaCliArguments {
  readonly command: "plan" | "evidence" | "verify" | "execute";
  readonly input?: string;
  readonly output?: string;
  readonly bundle?: string;
  readonly bundleDigest?: string;
  readonly projectRef?: string;
  readonly approval: string;
  readonly apply: boolean;
  readonly bindings?: string;
}
function refused(reason: string): never { throw new Error(`protected delta CLI rejected: ${reason}`); }
export function parseDeltaCliArguments(args: readonly string[]): DeltaCliArguments {
  const command = args[0];
  if (command !== "plan" && command !== "evidence" && command !== "verify" && command !== "execute") refused("explicit command");
  const values = new Map<string, string>(); let apply = false;
  for (let index = 1; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === "--apply") { if (apply || command !== "execute") refused("explicit apply mode"); apply = true; continue; }
    if (!["--bundle", "--bundle-digest", "--project-ref", "--approval", "--bindings", "--input", "--output"].includes(flag) || values.has(flag)) refused("unknown or duplicate option");
    const value = args[++index];
    if (!value || value.startsWith("--") || value.includes("\0") || value.length > 4096) refused("option value");
    values.set(flag, value);
  }
  if (command === "plan") {
    if ([...values.keys()].some(key => key !== "--bindings")) refused("offline plan options");
    return { command, approval: "", apply: false, bindings: values.get("--bindings") };
  }
  if (command === "evidence") {
    if ([...values.keys()].some(key => !["--input", "--output"].includes(key)) || !values.get("--input") || !values.get("--output")) refused("offline evidence input and output required");
    return { command, approval: "", apply: false, input: values.get("--input"), output: canonicalEvidencePath(values.get("--output")!) };
  }
  if (values.has("--bindings") || values.has("--input") || values.has("--output")) refused("execution cannot override plan bindings or artifacts");
  const bundle = canonicalEvidencePath(values.get("--bundle") ?? "");
  const bundleDigest = values.get("--bundle-digest") ?? "", projectRef = values.get("--project-ref");
  if (!/^[a-f0-9]{64}$/.test(bundleDigest) || projectRef !== DELTA_RELEASE_PROJECT) refused("exact bundle digest and project");
  return { command, bundle, bundleDigest, projectRef, approval: values.get("--approval") ?? "", apply };
}
interface TrustedPolicy {
  readonly schemaVersion: 1;
  readonly context: DeltaExpectedContext;
  readonly sourceCiRunId: string;
  readonly githubApproverId: string;
  readonly proofAcceptance: DeltaOwnerProofAcceptance;
  readonly vercel: { readonly projectId: string; readonly teamId?: string };
}
function trustedPolicy(text: string | undefined): TrustedPolicy {
  if (!text || text.length > 48000) refused("independent protected policy unavailable");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return refused("protected policy JSON"); }
  assertSanitized(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) refused("protected policy object");
  const row = value as Record<string, unknown>, keys = ["schemaVersion", "context", "sourceCiRunId", "githubApproverId", "proofAcceptance", "vercel"];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) || row.schemaVersion !== 1
    || typeof row.sourceCiRunId !== "string" || !/^\d+$/.test(row.sourceCiRunId) || typeof row.githubApproverId !== "string" || !/^\d+$/.test(row.githubApproverId)) refused("closed protected policy");
  return value as TrustedPolicy;
}
async function boundedJson(path: string, limit: number) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit || await realpath(path) !== path) refused("regular bounded JSON file");
  const bytes = await readFile(path);
  if (bytes.length > limit) refused("JSON grew during read");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return refused("artifact JSON"); }
  return { bytes, value };
}

/** Explicit offline plan and protected execution are separate commands. No SQL is run by plan. */
export async function runDeltaCli(args: readonly string[], env: NodeJS.ProcessEnv = process.env, rootDir = fileURLToPath(new URL("../../", import.meta.url))) {
  const options = parseDeltaCliArguments(args);
  const root = await realpath(rootDir);
  if (options.command === "plan") {
    const manifest = parseReleaseManifest(JSON.parse(await readFile(resolve(root, "supabase/release-manifest.json"), "utf8")));
    const errors = await validateManifest(manifest, root);
    if (errors.length) refused("complete repository source integrity");
    const base = { schemaVersion: 1, kind: "protected-delta-offline-plan", status: "HOLD", validReleaseEvidence: false,
      profile: DELTA_RELEASE_PROFILE, projectRef: DELTA_RELEASE_PROJECT, sourceCount: manifest.migrations.length,
      deltaSourceSha256: DELTA_SOURCE_SHA256, requiredGates: DELTA_REQUIRED_GATES, sourceSqlExecutionAttempted: false };
    if (!options.bindings) return { ...base, reason: "Source integrity verified; fresh target/reference/recovery/provider/owner inputs are still required.",
      next: "Optional --bindings supplies a reviewed metadata-only DeltaProgramBindings file; output remains offline preparation." };
    const file = await boundedJson(resolve(options.bindings), 64 * 1024);
    assertSanitized(file.value);
    const compiled = await compileDeltaProgram(root, file.value as DeltaProgramBindings);
    return { ...base, plan: compiled.plan, planDigest: compiled.planDigest, program: {
      executionProgramSha256: compiled.executionProgramSha256, sessionLockSql: compiled.sessionLockSql, beginSql: compiled.beginSql,
      lockSql: compiled.lockSql, expiryGuardSql: compiled.expiryGuardSql, applyDoSql: compiled.applyDoSql,
      invariantCollectorSha256: compiled.plan.invariantCollectorSha256,
    }, reason: "Offline program derivation only; no fresh source capture, gate acceptance, approval or SQL execution is implied." };
  }
  if (options.command === "evidence") {
    const input = await boundedJson(resolve(options.input!), 8 * 1024 * 1024);
    assertSanitized(input.value);
    if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) refused("offline evidence input object");
    const payload = input.value as Record<string, unknown>;
    if (Object.keys(payload).sort().join() !== "context,evidence") refused("closed offline evidence input");
    const evidence = buildDeltaEvidence(payload.evidence as Omit<DeltaReleaseEvidence, "contentDigest">);
    if (verifyDeltaEvidence(evidence, payload.context as DeltaExpectedContext, new Date()).length) refused("offline evidence bindings or freshness");
    const destination = resolve(root, options.output!), directory = dirname(destination);
    let ancestor = directory;
    for (;;) {
      try {
        const existing = await lstat(ancestor);
        if (!existing.isDirectory() || existing.isSymbolicLink() || await realpath(ancestor) !== ancestor) refused("evidence directory symlink");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || ancestor === root) throw error;
        ancestor = dirname(ancestor);
      }
    }
    await mkdir(directory, { recursive: true });
    if (await realpath(directory) !== directory) refused("evidence directory symlink");
    await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { schemaVersion: 1, kind: "protected-delta-evidence-preparation", status: "HOLD", validReleaseEvidence: false,
      artifact: options.output, evidenceDigest: digestDeltaEvidence(evidence), sourceSqlExecutionAttempted: false,
      reason: "Offline structural/freshness checks only; commit these bytes and obtain independent protected policy, live provider checks and exact approval." };
  }
  const path = await verifyEvidenceFilePath(root, options.bundle!, { lstat, realpath });
  const file = await boundedJson(path, 8 * 1024 * 1024);
  const parsed = parseDeltaEvidence(file.value);
  if (!parsed.evidence) refused("strict v2 evidence required; historical HOLD/v1 artifacts are not release evidence");
  const evidence = parsed.evidence;
  const policy = trustedPolicy(env.RELEASE_DELTA_POLICY_JSON);
  if (env.RELEASE_PROJECT_REF !== DELTA_RELEASE_PROJECT || policy.context.projectRef !== DELTA_RELEASE_PROJECT
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")) refused("independent protected project and execution commit");
  const github = createGitHubDeltaReaders({ token: env.GITHUB_TOKEN ?? "", rootDir: root, sourceCiRunId: policy.sourceCiRunId, environment: env,
    vercel: { token: env.VERCEL_TOKEN ?? "", projectId: policy.vercel.projectId, teamId: policy.vercel.teamId } });
  let database: Awaited<ReturnType<typeof createManagedDeltaDatabase>> | undefined;
  const db = async () => database ??= await createManagedDeltaDatabase({ databaseUrl: env.RELEASE_DATABASE_URL ?? "", rootDir: root, context: policy.context });
  const compile = () => compileDeltaProgram(root, { sourceCommit: policy.context.sourceCommit, targetBindingHash: policy.context.targetBindingHash,
    collectorSha256: policy.context.collectorSha256, canonicalizerSha256: policy.context.canonicalizerSha256,
    invariantCollectorSha256: policy.context.invariantCollectorSha256,
    deferredAbsenceHashes: { "20261103215321": evidence.plan.deferred.find(value => value.version === "20261103215321")!.absenceProofHash,
      "20261104134202": evidence.plan.deferred.find(value => value.version === "20261104134202")!.absenceProofHash },
    retiredConstraintAbsenceHash: evidence.plan.retiredConstraint.absenceProofHash });
  let report: DeltaExecutionReport | undefined, executionError: unknown;
  try {
    report = await executeBundledDelta({ evidence, committedBundleBytes: file.bytes, evidenceDigest: options.bundleDigest!, context: policy.context,
      apply: options.apply, approval: options.approval }, {
      now: () => new Date(), compile,
      verifyProvenance: current => verifyDeltaProvenance({ sourceCommit: policy.context.sourceCommit, evidenceCommit: env.GITHUB_SHA!,
        bundlePath: options.bundle!, bundleBytes: file.bytes, expectedSourceCiReportHash: current.gates.find(value => value.gate === "source-ci")!.reportSha256,
        expectedGitHubApproverId: policy.githubApproverId, runId: env.GITHUB_RUN_ID ?? "", runAttempt: Number(env.GITHUB_RUN_ATTEMPT), now: new Date() }, github),
      verifyProofs: (current, provenance) => resolveOwnerAcceptedDeltaReports(current, policy.context, provenance, policy.proofAcceptance,
        { readCommittedProof: committedDeltaProofReader(root), currentDeployment: commits => github.currentProductionDeployment(commits) }, new Date()),
      inspect: async () => (await db()).inspect(), begin: async (program, bindings) => (await db()).begin(program, bindings),
    });
  } catch (error) { executionError = error; }
  let cleanupFailed = false;
  if (database) { try { await database.close(); } catch { cleanupFailed = true; } }
  if (cleanupFailed) {
    const previous = executionError instanceof DeltaExecutionFailure ? executionError.outcome : undefined;
    const attempted = previous?.sqlExecutionAttempted ?? report?.sqlExecutionAttempted ?? false;
    const committed = previous?.commitConfirmed ?? report?.commitConfirmed ?? false;
    throw new DeltaExecutionFailure("managed-client-cleanup-unverified", {
      sqlExecutionAttempted: attempted, commitAttempted: previous?.commitAttempted ?? committed, commitConfirmed: committed,
      rollbackAcknowledged: previous?.rollbackAcknowledged ?? false,
      containmentRequired: previous?.containmentRequired === true || attempted || committed,
    });
  }
  if (executionError) throw executionError;
  if (!report) refused("execution receipt unavailable");
  return report;
}

export async function runDeltaCliMain(args = process.argv.slice(2)) {
  try { console.log(JSON.stringify(await runDeltaCli(args), null, 2)); }
  catch (error) {
    const outcome = error instanceof DeltaExecutionFailure ? error.outcome : undefined;
    console.log(JSON.stringify({ schemaVersion: 1, kind: "protected-delta-refusal", status: "HOLD", validReleaseEvidence: false,
      reasonCode: error instanceof DeltaExecutionFailure ? error.code : "protected_preconditions_not_satisfied", ...(outcome ? { outcome } : {}) }, null, 2));
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void runDeltaCliMain();
