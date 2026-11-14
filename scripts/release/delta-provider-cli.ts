import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deltaChildEnvironment } from "./delta-child-process";
import { canonicalDeltaJson, digestDeltaProofPayload } from "./delta-evidence";
import { ProviderRehearsalFailure, requireProviderFact as check, type ProviderCaseResult } from "./delta-provider-contracts";
import { createOwnedProviderStack, captureProviderTool, type OwnedProviderStack } from "./delta-provider-stack";
import { createProviderRuntime } from "./delta-provider-runtime";
import { runProviderAuthMfa } from "./delta-provider-auth";
import { runProviderJourneys } from "./delta-provider-journey";
import { runProviderStorage } from "./delta-provider-storage";
import { PROVIDER_CASE_NAMES, PROVIDER_NOT_COVERED, validateProviderObservation, type ProviderObservation } from "./delta-provider-observation";

const CODE = Object.freeze(["delta-provider-contracts.ts", "delta-provider-stack.ts", "delta-provider-network.ts", "delta-provider-runtime.ts", "delta-provider-cli.ts", "delta-provider-runner.mjs", "delta-provider-observation.ts", "delta-provider-auth.ts", "delta-provider-journey.ts", "delta-provider-journey-fixtures.ts", "delta-provider-storage.ts", "delta-child-process.ts", "delta-private-artifacts.ts", "delta-private-artifacts.ps1", "delta-psql-session.ts"]);
function safeReason(error: unknown): string { return error instanceof ProviderRehearsalFailure && /^[a-zA-Z0-9_-]{1,100}$/.test(error.code) ? error.code : "owned-provider-run-failed"; }
function phase(name: string) { process.stdout.write(JSON.stringify({ kind: "owned-provider-progress", phase: name, validReleaseEvidence: false }) + "\n"); }
export async function providerRehearsalMain(args: readonly string[]): Promise<void> {
  check(args.length === 1 && ["plan", "run-owned"].includes(args[0]!), "closed-provider-command");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  if (args[0] === "plan") {
    process.stdout.write(canonicalDeltaJson({ schemaVersion: 1, kind: "phase3-owned-provider-plan", status: "HOLD", validReleaseEvidence: false,
      cliVersion: "2.110.0", targets: "new-nonce-local-stack-only", application: "original-createApp-loopback-HTTP", provider: "actual-Auth-MFA-REST-Storage-HTTP",
      cases: PROVIDER_CASE_NAMES, notCovered: PROVIDER_NOT_COVERED, cleanup: "exact-owned-resource-identity-and-absence", authorization: "local-fixtures-only" }) + "\n"); return;
  }
  async function git(arguments_: string[]) {
    const bytes = await captureProviderTool("git", ["-C", root, ...arguments_], deltaChildEnvironment(), undefined, 15_000, root);
    try { return bytes.toString("utf8").trim(); } finally { bytes.fill(0); }
  }
  const sourceCommit = await git(["rev-parse", "HEAD"]); check(/^[a-f0-9]{40}$/.test(sourceCommit), "provider-source-commit");
  const sourceDirty = await git(["status", "--porcelain", "--untracked-files=all"]);
  check(!sourceDirty, "provider-source-not-committed");
  const codeHashes: Record<string, string> = {};
  for (const name of CODE) { const relative = `scripts/release/${name}`; codeHashes[relative] = createHash("sha256").update(await readFile(join(root, relative))).digest("hex"); }
  const startedAt = new Date().toISOString(), attemptId = randomUUID(); let stack: OwnedProviderStack | undefined, runtime: Awaited<ReturnType<typeof createProviderRuntime>> | undefined;
  let checks: ProviderCaseResult[] = [], reasonCode: string | null = null, actualHttpResponses = 0, externalRequestsBlocked = 0;
  let applicationCleanup: "verified" | "not-started" | "unknown" = "not-started", namespaceCleanup: "verified" | "unknown" = "unknown";
  try {
    phase("creating-owned-stack"); stack = await createOwnedProviderStack(root);
    phase("creating-local-fixtures-and-http-application"); runtime = await createProviderRuntime(stack, sourceCommit); applicationCleanup = "unknown";
    const health = await runtime.request(null, "/api/health"); const healthBody = await health.json();
    check(health.status === 200 && healthBody.ok === true && healthBody.applicationCommit === sourceCommit && healthBody.apiProjectRef === null, "actual-application-identity");
    phase("auth-and-mfa"); checks.push(...await runProviderAuthMfa(runtime));
    phase("creator-and-operator-journeys"); checks.push(...await runProviderJourneys(runtime));
    phase("storage-provider-and-isolation"); checks.push(...await runProviderStorage(runtime));
    phase("egress-refusal-prerequisites");
    const before = runtime.httpRequests, positive = await runtime.request(null, "/api/health"); check(positive.status === 200, "egress-positive-prerequisite");
    const count = runtime.httpRequests, blockedBefore = runtime.externalRequestsBlocked(); let refused = false;
    try { await fetch("https://owned-provider-egress.invalid/forbidden"); } catch (error) { refused = error instanceof ProviderRehearsalFailure && error.code === "external-egress-disabled"; }
    check(refused && runtime.httpRequests === count && runtime.externalRequestsBlocked() === blockedBefore + 1, "egress-fault-not-delivered");
    checks.push(runtime.record("provider-hosted-origin-refused", { positiveActualHttp: true, blockedBeforeRequest: true, externalResponses: 0 }, before));
    check(checks.length === PROVIDER_CASE_NAMES.length && new Set(checks.map(row => row.name)).size === checks.length && checks.every(row => PROVIDER_CASE_NAMES.includes(row.name)), "provider-case-inventory");
    await stack.assertOwned();
    check((await git(["rev-parse", "HEAD"])) === sourceCommit && !(await git(["status", "--porcelain", "--untracked-files=all"])), "provider-source-changed-during-run");
    actualHttpResponses = runtime.httpRequests; externalRequestsBlocked = runtime.externalRequestsBlocked();
  } catch (error) { reasonCode = safeReason(error); checks = []; }
  finally {
    if (runtime) { actualHttpResponses = runtime.httpRequests; externalRequestsBlocked = runtime.externalRequestsBlocked(); try { await runtime.close(); applicationCleanup = "verified"; } catch { applicationCleanup = "unknown"; reasonCode = "provider-app-cleanup-unverified"; checks = []; } }
    phase("cleaning-owned-namespace");
    if (stack) try { await stack.close(); namespaceCleanup = "verified"; } catch { namespaceCleanup = "unknown"; reasonCode = "provider-stack-cleanup-unverified"; checks = []; }
  }
  const payload: Omit<ProviderObservation, "contentDigest"> = {
    schemaVersion: 1, kind: "phase3-owned-provider-observation", status: "HOLD", validReleaseEvidence: false, productionEquivalent: false, ownerAccepted: false,
    engineeringStatus: reasonCode === null ? "passed" : "failed", reasonCode, runId: stack?.runId ?? attemptId, sourceCommit, sourceDirty: false,
    platform: process.platform as "linux" | "win32", startedAt, finishedAt: new Date().toISOString(), codeHashes,
    ownedStack: stack ? { projectId: stack.projectId, sourceProfileHash: stack.sourceProfileHash, configurationHash: stack.configurationHash, apiOrigin: stack.apiOrigin,
      applicationOrigin: runtime?.appOrigin ?? null, targetIdentityHash: digestDeltaProofPayload(stack.identities.map(row => ({ id: row.id, image: row.image, networks: row.networks, ports: row.ports }))),
      containers: stack.identities.map(row => ({ id: row.id, image: row.image, imageRef: row.imageRef })), network: "internal-bridge-loopback-published" } : null,
    checks, actualHttpResponses, externalRequestsBlocked, cleanup: { application: applicationCleanup, namespace: namespaceCleanup }, notCovered: PROVIDER_NOT_COVERED,
  };
  const report = validateProviderObservation({ ...payload, contentDigest: digestDeltaProofPayload(payload) });
  const relative = `docs/verification/phase3-provider-rehearsal/owned-${sourceCommit.slice(0, 12)}-${report.runId}.json`;
  await mkdir(join(root, "docs/verification/phase3-provider-rehearsal"), { recursive: true }); await writeFile(join(root, relative), canonicalDeltaJson(report) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ kind: "owned-provider-result", engineeringStatus: report.engineeringStatus, status: "HOLD", validReleaseEvidence: false, reasonCode, report: relative, contentDigest: report.contentDigest }) + "\n");
  if (reasonCode !== null) process.exitCode = 1;
}
