// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalDeltaJson, digestDeltaProofPayload, digestDeltaSemanticFingerprint, parseDeltaEvidence } from "./delta-evidence";
import { DELTA_RELEASE_PROFILE, DELTA_REQUIRED_GATES } from "./delta-release-contracts";
import { PROVIDER_CASE_NAMES, PROVIDER_NOT_COVERED, type ProviderObservation } from "./delta-provider-observation";
import type { PairedRecoveryObservation } from "./delta-recovery";
import { buildPhase3ReviewPacket, PHASE3_PAIRED_RECEIPT_PATH, PHASE3_PAIRED_RECEIPT_DIGEST, PHASE3_PROVIDER_SOURCE_PATHS, PHASE3_REVIEW_SOURCE_PATHS,
  Phase3ReviewPacketFailure, type CapturedPublicArtifact, type Phase3ReviewPacketInput, type Phase3SourceCi } from "./delta-review-packet";
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Native = Record<string, unknown> & { codeInputs: Record<string, string>; cases: Array<{ case: string; result: string; stage?: string; faultEvidence?: Record<string, boolean> }>; pairedObservation: Mutable<PairedRecoveryObservation>; contentDigest: string };
const COMMIT = createHash("sha256").update("offline-provider-subject").digest("hex").slice(0, 40), RUN = "11111111-1111-4111-8111-111111111111";
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function publicArtifact(path: string, payload: unknown): CapturedPublicArtifact {
  const bytes = Buffer.from(`${canonicalDeltaJson(payload)}\n`), digest = (payload as { contentDigest?: string }).contentDigest ?? digestDeltaProofPayload(payload);
  return { path, bytes, sha256: hash(bytes), contentDigest: digest };
}
function withDigest<T extends object>(payload: T) { const { contentDigest: ignored, ...body } = payload as T & { contentDigest?: string }; void ignored; return { ...body, contentDigest: digestDeltaProofPayload(body) }; }
function json<T>(artifact: CapturedPublicArtifact): T { return JSON.parse(Buffer.from(artifact.bytes).toString("utf8")) as T; }
let baseline: Phase3ReviewPacketInput;
beforeAll(async () => {
  // These are bounded known PUBLIC source/receipt reads for unit fixtures only; no driver, provider, private archive or live CI runs here.
  const currentSources = await Promise.all(PHASE3_REVIEW_SOURCE_PATHS.map(async path => { const bytes = await readFile(new URL(`../../${path}`, import.meta.url)); return { path, bytes, sha256: hash(bytes) }; }));
  const receiptBytes = await readFile(new URL(`../../${PHASE3_PAIRED_RECEIPT_PATH}`, import.meta.url)), receipt: Native = JSON.parse(receiptBytes.toString("utf8"));
  const sourceMap = Object.fromEntries(currentSources.map(source => [source.path, source.sha256]));
  const validator = currentSources.find(source => source.path === "scripts/release/delta-provider-observation.ts")!;
  const network = Buffer.from(validator.bytes).toString("utf8").match(/stack\.network === "([a-z-]+)"/)![1] as NonNullable<ProviderObservation["ownedStack"]>["network"];
  // DELIBERATELY fabricated offline provider/CI DTOs test validation, never real provider evidence or a published packet.
  const provider = withDigest({ schemaVersion: 1 as const, kind: "phase3-owned-provider-observation" as const, status: "HOLD" as const, validReleaseEvidence: false as const,
    productionEquivalent: false as const, ownerAccepted: false as const, engineeringStatus: "passed" as const, reasonCode: null, runId: RUN, sourceCommit: COMMIT, sourceDirty: false as const,
    platform: "linux" as const, startedAt: "2026-11-14T04:00:00.000Z", finishedAt: "2026-11-14T04:10:00.000Z",
    codeHashes: Object.fromEntries(PHASE3_PROVIDER_SOURCE_PATHS.map(path => [path, sourceMap[path]])),
    ownedStack: { projectId: `adfp-${RUN.replaceAll("-", "")}`, sourceProfileHash: hash("offline-profile"), configurationHash: hash("offline-config"), targetIdentityHash: hash("offline-target"),
      apiOrigin: "http://127.0.0.1:54321", applicationOrigin: "http://127.0.0.1:54322", network, containers: Array.from({ length: 5 }, (_, i) => ({ id: hash(`offline-container-${i}`), image: `sha256:${hash(`offline-image-${i}`)}`, imageRef: "supabase/postgres:17.6" })) },
    checks: PROVIDER_CASE_NAMES.map(name => ({ name, status: "passed" as const, evidenceSha256: hash(`offline-case-${name}`), actualHttpRequests: 1 })), actualHttpResponses: 100, externalRequestsBlocked: 2,
    cleanup: { application: "verified" as const, namespace: "verified" as const }, notCovered: PROVIDER_NOT_COVERED });
  const ci: Phase3SourceCi = { repository: "YNWAforever/Remix-Adfocate", workflow: "CI", branch: "main", event: "push", runId: "123456789", sourceCommit: COMMIT,
    url: "https://github.com/YNWAforever/Remix-Adfocate/actions/runs/123456789", conclusion: "success", jobs: ["build-test", "integration", "provider-acceptance"].map(name => ({ name: name as Phase3SourceCi["jobs"][number]["name"], conclusion: "success", sourceCommit: COMMIT })) };
  baseline = { sourceCommit: COMMIT, preparedAt: "2026-11-14T05:00:00.000Z", currentSources,
    provider: publicArtifact(`docs/verification/phase3-provider-rehearsal/owned-${COMMIT.slice(0, 12)}-${RUN}.json`, provider),
    pairedRecovery: { path: PHASE3_PAIRED_RECEIPT_PATH, bytes: receiptBytes, sha256: hash(receiptBytes), contentDigest: receipt.contentDigest },
    sourceCi: publicArtifact("docs/verification/phase3-release-review/source-ci-main.json", ci) };
});
function rewriteProvider(change: (row: Mutable<ProviderObservation>) => void): Phase3ReviewPacketInput {
  const row = json<Mutable<ProviderObservation>>(baseline.provider); change(row); return { ...baseline, provider: publicArtifact(baseline.provider.path, withDigest(row)) };
}
function rewriteCi(change: (row: Mutable<Phase3SourceCi>) => void): Phase3ReviewPacketInput {
  const row = json<Mutable<Phase3SourceCi>>(baseline.sourceCi); change(row); return { ...baseline, sourceCi: publicArtifact(baseline.sourceCi.path, row) };
}
function rewriteNative(change: (row: Native) => void): Phase3ReviewPacketInput {
  const row = json<Native>(baseline.pairedRecovery); change(row);
  const { contentDigest: old, reference, manifestSha256: oldManifest, ...manifest } = row.pairedObservation; void old; void oldManifest;
  row.pairedObservation = withDigest({ ...manifest, reference, manifestSha256: digestDeltaProofPayload(manifest) });
  return { ...baseline, pairedRecovery: publicArtifact(baseline.pairedRecovery.path, withDigest(row)) };
}
function rejected(input: Phase3ReviewPacketInput, code?: string) {
  try { buildPhase3ReviewPacket(input); throw new Error("offline validation unexpectedly accepted input"); }
  catch (error) { expect(error).toBeInstanceOf(Phase3ReviewPacketFailure); if (code) expect((error as Phase3ReviewPacketFailure).code).toBe(code); expect(String(error)).not.toContain("nonsecret-private-marker"); expect(error).not.toHaveProperty("cause"); }
}
describe("pure phase 3 review packet (offline DTO validation, not native provider evidence)", () => {
  it("validates actual public recovery receipt/current source bytes and keeps sixteen independent gates on HOLD", () => {
    const packet = buildPhase3ReviewPacket(baseline);
    expect(packet.engineeringStatus).toBe("complete"); expect(packet.provider.validatedPassedCases).toBe(27);
    expect(packet.inputs.pairedRecovery.contentDigest).toBe(PHASE3_PAIRED_RECEIPT_DIGEST); expect(packet.recovery).toMatchObject({ nativeCases: 9, semanticComponents: 7, portableDataEqual: true, sourceLedgerSynthetic: true, sourceCommitSynthetic: true, productionFreshnessAccepted: false });
    expect(packet.gates.map(gate => gate.gate)).toEqual(DELTA_REQUIRED_GATES); expect(packet.gates.every(gate => gate.status === "HOLD" && gate.accepted === false && gate.missing.length > 0)).toBe(true);
    expect(packet.ownerInputs).toEqual({ rpoSeconds: null, rtoSeconds: null, freeze: null, roles: null, reportSet: null, outerApproval: null });
    expect(packet.ownerAccepted).toBe(false); expect(packet.validReleaseEvidence).toBe(false); expect(packet.status).toBe("HOLD");
    const { contentDigest, ...body } = packet; expect(contentDigest).toBe(digestDeltaProofPayload(body)); expect(JSON.stringify(packet)).not.toContain("private-recovery:");
  });
  it("cannot pass protected v2 parsing, including after superficial kind/version relabelling", () => {
    const packet = buildPhase3ReviewPacket(baseline); expect(parseDeltaEvidence(packet).evidence).toBeUndefined();
    expect(parseDeltaEvidence(withDigest({ ...packet, schemaVersion: 2, kind: "protected-bundled-xp-release", profile: DELTA_RELEASE_PROFILE })).evidence).toBeUndefined();
  });
  it("has deterministic output and does not mutate captured inputs", () => {
    const first = buildPhase3ReviewPacket(baseline), second = buildPhase3ReviewPacket(baseline); expect(first).toEqual(second);
    expect(hash(baseline.provider.bytes)).toBe(baseline.provider.sha256); expect(hash(baseline.pairedRecovery.bytes)).toBe(baseline.pairedRecovery.sha256);
  });
  it("allows a truthful failed CLI attempt only as incomplete with zero counted provider cases", () => {
    const input = rewriteProvider(row => { row.engineeringStatus = "failed"; row.reasonCode = "owned-provider-command-failed"; row.checks = []; row.ownedStack = null; row.actualHttpResponses = 0; row.externalRequestsBlocked = 0; row.cleanup = { application: "not-started", namespace: "unknown" }; });
    const packet = buildPhase3ReviewPacket(input); expect(packet.engineeringStatus).toBe("incomplete"); expect(packet.provider).toMatchObject({ complete: false, validatedPassedCases: 0, cleanupConfirmed: false });
    expect(packet.gates.every(gate => gate.status === "HOLD" && !gate.accepted)).toBe(true); expect(packet.gates.find(gate => gate.gate === "active-mission")!.missing.join()).toContain("all 27");
  });
  it.each(["pull_request", "workflow_dispatch"] as const)("does not promote green %s CI to exact main-push engineering proof", event => {
    const packet = buildPhase3ReviewPacket(rewriteCi(row => { row.event = event; })); expect(packet.engineeringStatus).toBe("incomplete"); expect(packet.sourceCi.complete).toBe(false);
  });
  it("does not count failed/skipped CI or non-main branches as complete engineering proof", () => {
    expect(buildPhase3ReviewPacket(rewriteCi(row => { row.jobs[2]!.conclusion = "skipped"; })).engineeringStatus).toBe("incomplete");
    expect(buildPhase3ReviewPacket(rewriteCi(row => { row.conclusion = "failure"; })).engineeringStatus).toBe("incomplete");
    expect(buildPhase3ReviewPacket(rewriteCi(row => { row.branch = "topic/review"; })).engineeringStatus).toBe("incomplete");
  });
  it("preserves specific coverage gaps and never infers reward issuance, settlement or publication", () => {
    const packet = buildPhase3ReviewPacket(baseline); expect(packet.provider.notCovered).toEqual(PROVIDER_NOT_COVERED);
    expect(packet.gates.find(gate => gate.gate === "legacy-integration")!.missing.join()).toContain("NULL-mode");
    expect(packet.gates.find(gate => gate.gate === "reward-handoff")!.missing.join()).toContain("settlement");
    expect(packet.limitations.join()).toContain("do not establish external publication"); expect(packet.limitations.join()).toContain("container egress firewall");
  });
});
describe("provider, CI and byte provenance fail closed", () => {
  it.each(["application", "namespace"] as const)("rejects relabelled positive provider observations with unknown %s cleanup", key => rejected(rewriteProvider(row => { row.cleanup[key] = "unknown"; })));
  it("rejects 26 cases, empty cases, a repeated case or fake cases even with refreshed content digests", () => {
    rejected(rewriteProvider(row => { row.checks.pop(); })); rejected(rewriteProvider(row => { row.checks = []; }));
    rejected(rewriteProvider(row => { row.checks[1]!.name = row.checks[0]!.name; })); rejected(rewriteProvider(row => { row.checks[0]!.name = "offline-simulation-passed"; }));
  });
  it("rejects a positive packet without actual HTTP evidence or external guard activity", () => {
    rejected(rewriteProvider(row => { row.actualHttpResponses = 0; })); rejected(rewriteProvider(row => { row.externalRequestsBlocked = 0; }));
    rejected(rewriteProvider(row => { row.checks[0]!.actualHttpRequests = 0; }));
  });
  it("rejects a passed DTO lacking the original application origin", () => rejected(rewriteProvider(row => { row.ownedStack!.applicationOrigin = null; }), "provider-binding"));
  it("binds provider and every CI job to the exact tested subject", () => {
    rejected({ ...baseline, sourceCommit: "a".repeat(40) }, "provider-binding"); rejected(rewriteCi(row => { row.sourceCommit = "a".repeat(40); }), "ci-binding");
    rejected(rewriteCi(row => { row.jobs[0]!.sourceCommit = "a".repeat(40); }), "ci-binding");
  });
  it("rejects repository/run URL substitution and missing or duplicate required CI jobs", () => {
    rejected(rewriteCi(row => { row.url += "?redirect=nonsecret-private-marker"; }), "ci-binding");
    rejected(rewriteCi(row => { row.jobs.pop(); }), "ci-shape"); rejected(rewriteCi(row => { row.jobs[2]!.name = "build-test"; }), "ci-shape");
  });
  it("checks actual artifact bytes, reported canonical digests and relative public paths", () => {
    rejected({ ...baseline, provider: { ...baseline.provider, bytes: Buffer.from("nonsecret-private-marker") } }, "artifact-digest");
    rejected({ ...baseline, provider: { ...baseline.provider, contentDigest: "0".repeat(64) } }, "artifact-digest");
    rejected({ ...baseline, pairedRecovery: { ...baseline.pairedRecovery, path: "../../nonsecret-private-marker" } }, "artifact-path");
    rejected({ ...baseline, sourceCi: { ...baseline.sourceCi, path: "C:/private/source-ci.json" } }, "artifact-path");
  });
  it("checks captured current source bytes and all required declared code hashes", () => {
    const source = baseline.currentSources[0]!, bytes = Buffer.from("changed public source");
    rejected({ ...baseline, currentSources: [{ ...source, bytes }, ...baseline.currentSources.slice(1)] }, "source-binding");
    rejected({ ...baseline, currentSources: [{ ...source, bytes, sha256: hash(bytes) }, ...baseline.currentSources.slice(1)] }, "source-binding");
    rejected({ ...baseline, currentSources: baseline.currentSources.slice(1) }, "source-binding");
    rejected(rewriteProvider(row => { delete row.codeHashes[PHASE3_PROVIDER_SOURCE_PATHS[0]!]; }), "source-binding");
  });
  it("rejects private/unknown fields before they can appear in a review packet", () => {
    rejected(rewriteProvider(row => { (row as unknown as Record<string, unknown>).accessToken = "nonsecret-private-marker"; }));
    rejected(rewriteNative(row => { row.privateArchivePath = "C:/nonsecret-private-marker"; }), "paired-shape");
    rejected(rewriteCi(row => { (row as unknown as Record<string, unknown>).actorEmail = "nonsecret-private-marker@example.test"; }), "ci-shape");
  });
});
describe("native recovery fault and semantic prerequisites", () => {
  it.each(["archiveCopyTamperedAfterRead", "roleInputDelivered"])("requires archive tamper prerequisite %s", key => rejected(rewriteNative(row => { row.cases.find(item => item.case === "archive-tamper")!.faultEvidence![key] = false; }), "paired-fault-prerequisite"));
  it("requires no restore attempt for archive tamper", () => rejected(rewriteNative(row => { row.cases.find(item => item.case === "archive-tamper")!.faultEvidence!.restoreAttempted = true; }), "paired-fault-prerequisite"));
  it.each(["templateFaultAcknowledged", "restoreCommandSpawned", "expectedTemplateDropErrorObserved"])("requires actual restore-error prerequisite %s", key => rejected(rewriteNative(row => { row.cases.find(item => item.case === "restore-error")!.faultEvidence![key] = false; }), "paired-fault-prerequisite"));
  it("rejects nine relabelled cases with duplicates, incorrect stages or missing positive recovery", () => {
    rejected(rewriteNative(row => { row.cases[0]!.result = "REJECTED_HOLD"; }), "paired-cases");
    rejected(rewriteNative(row => { row.cases[1]!.case = "restored-sequence"; }), "paired-cases");
    rejected(rewriteNative(row => { row.cases.find(item => item.case === "restore-error")!.stage = "context"; }), "paired-cases");
  });
  it("rejects release/production/provider-auth equivalence relabelling of the local fixture", () => {
    for (const key of ["validReleaseEvidence", "productionEquivalent", "providerAuthTested"]) rejected(rewriteNative(row => { row[key] = true; }), "paired-markers");
    rejected(rewriteNative(row => { row.sourceLedgerSynthetic = false; }), "paired-markers");
  });
  it("checks root, nested observation and manifest digests independently", () => {
    const root = json<Native>(baseline.pairedRecovery); root.contentDigest = "a".repeat(64); rejected({ ...baseline, pairedRecovery: publicArtifact(baseline.pairedRecovery.path, root) }, "artifact-digest");
    const nested = json<Native>(baseline.pairedRecovery); nested.pairedObservation.contentDigest = "a".repeat(64); rejected({ ...baseline, pairedRecovery: publicArtifact(baseline.pairedRecovery.path, withDigest(nested)) }, "paired-digest");
    const manifest = json<Native>(baseline.pairedRecovery); manifest.pairedObservation.manifestSha256 = "a".repeat(64); manifest.pairedObservation = withDigest(manifest.pairedObservation);
    rejected({ ...baseline, pairedRecovery: publicArtifact(baseline.pairedRecovery.path, withDigest(manifest)) }, "paired-digest");
  });
  it("rejects partial semantic coverage and mismatched recomputed complete fingerprints", () => {
    rejected(rewriteNative(row => { row.pairedObservation.restoredBefore.fingerprint.components.pop(); }));
    rejected(rewriteNative(row => { const fp = row.pairedObservation.restoredBefore.fingerprint; fp.components.find(item => item.category === "schema-export")!.sha256 = hash("different schema"); fp.rootSha256 = digestDeltaSemanticFingerprint(fp); }), "paired-semantic");
  });
  it.each(["rowCount", "tableCount", "sequenceCount"] as const)("compares full portable data summary %s", key => rejected(rewriteNative(row => { row.pairedObservation.restoredBefore.data[key] += 1; }), "paired-data"));
  it("compares portable data root and collector identities", () => {
    rejected(rewriteNative(row => { row.pairedObservation.restoredBefore.data.rootSha256 = hash("different rows"); }), "paired-data");
    rejected(rewriteNative(row => { row.pairedObservation.sourceBefore.data.normalizerSha256 = hash("wrong normalizer"); }), "paired-data");
  });
  it("requires confirmed root/source/target cleanup", () => {
    rejected(rewriteNative(row => { row.ownedSourceAndTargetsCleanup = "unknown"; }), "paired-cleanup");
    rejected(rewriteNative(row => { (row.pairedObservation as unknown as Record<string, unknown>).sourceCleanupConfirmed = false; }), "paired-cleanup");
  });
  it("rejects altered paired code hashes and rerooted frozen-receipt substitutions", () => {
    rejected(rewriteNative(row => { row.codeInputs["scripts/release/delta-recovery.ts"] = hash("changed collector"); }), "source-binding");
    rejected(rewriteNative(row => { for (const inspection of [row.pairedObservation.sourceBefore, row.pairedObservation.restoredBefore]) inspection.data.rootSha256 = hash("both forged summaries"); }), "paired-digest");
  });
});
