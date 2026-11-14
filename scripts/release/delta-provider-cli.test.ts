// @vitest-environment node
import { describe, expect, it } from "vitest";
import { digestDeltaProofPayload } from "./delta-evidence";
import { PROVIDER_CASE_NAMES, PROVIDER_NOT_COVERED, validateProviderObservation } from "./delta-provider-observation";
import { chooseProviderSubnet, classifyProviderToolFailure } from "./delta-provider-stack";
function sample() {
  const payload = { schemaVersion: 1, kind: "phase3-owned-provider-observation", status: "HOLD", validReleaseEvidence: false, productionEquivalent: false, ownerAccepted: false, engineeringStatus: "passed", reasonCode: null,
    runId: "00000000-0000-4000-8000-000000000001", sourceCommit: "a".repeat(40), sourceDirty: false, platform: "linux", startedAt: "2026-11-14T00:00:00.000Z", finishedAt: "2026-11-14T00:01:00.000Z",
    codeHashes: Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`scripts/release/delta-synthetic-${index}.ts`, "b".repeat(64)])),
    ownedStack: { projectId: `adfp-${"a".repeat(32)}`, sourceProfileHash: "b".repeat(64), configurationHash: "c".repeat(64), targetIdentityHash: "d".repeat(64), apiOrigin: "http://127.0.0.1:54321", applicationOrigin: "http://127.0.0.1:54322", network: "owned-bridge-loopback-published",
      containers: Array.from({ length: 5 }, (_, index) => ({ id: String(index).repeat(64), image: `sha256:${"a".repeat(64)}`, imageRef: "public.ecr.aws/supabase/postgres:17.6.1.079" })) },
    checks: PROVIDER_CASE_NAMES.map(name => ({ name, status: "passed", actualHttpRequests: 1, evidenceSha256: "e".repeat(64) })), actualHttpResponses: 100, externalRequestsBlocked: 3,
    cleanup: { application: "verified", namespace: "verified" }, notCovered: PROVIDER_NOT_COVERED };
  return { ...payload, contentDigest: digestDeltaProofPayload(payload) };
}
function redigest(report: ReturnType<typeof sample>) { const { contentDigest: _digest, ...payload } = report; void _digest; return { ...report, contentDigest: digestDeltaProofPayload(payload) }; }
describe("local provider observation cannot acquire release authority", () => {
  it("retains factual cases and permanently holds release authority", () => { const report = validateProviderObservation(sample()); expect(report.checks).toHaveLength(27); expect(report.validReleaseEvidence).toBe(false); });
  it.each(["validReleaseEvidence", "productionEquivalent", "ownerAccepted", "sourceDirty"] as const)("refuses a relabelled authority flag %s", key => { const report = sample(); report[key] = true; expect(() => validateProviderObservation(redigest(report))).toThrow(); });
  it("refuses setup failure, duplicate cases, empty prerequisites and unknown cleanup", () => {
    const a = sample(); a.cleanup.namespace = "unknown"; expect(() => validateProviderObservation(redigest(a))).toThrow();
    const b = sample(); b.checks[1] = b.checks[0]!; expect(() => validateProviderObservation(redigest(b))).toThrow();
    const c = sample(); c.checks[0]!.actualHttpRequests = 0; expect(() => validateProviderObservation(redigest(c))).toThrow();
    const d = sample(); d.actualHttpResponses = 5; expect(() => validateProviderObservation(redigest(d))).toThrow();
  });
  it("rejects private extensions, missing coverage limits, hosted targets and stale digests", () => {
    expect(() => validateProviderObservation({ ...sample(), rawResponse: "private" })).toThrow();
    const a = sample(); a.notCovered = []; expect(() => validateProviderObservation(redigest(a))).toThrow();
    const b = sample(); b.ownedStack.apiOrigin = "https://remote.supabase.co"; expect(() => validateProviderObservation(redigest(b))).toThrow();
    const c = sample(); c.actualHttpResponses++; expect(() => validateProviderObservation(c)).toThrow();
  });
});
describe("bounded infrastructure diagnostics and subnet allocation", () => {
  it("allocates a local non-overlapping subnet without pruning unrelated networks", () => { expect(chooseProviderSubnet(["172.16.0.0/12", "192.168.0.0/16", "10.232.0.0/24"])).toBe("10.232.1.0/24"); });
  it("holds if the entire candidate range is occupied", () => { expect(() => chooseProviderSubnet(["10.0.0.0/8"])).toThrow(); });
  it.each([["could not find an available, non-overlapping IPv4 address pool", "ipam-pool"], ["Access is denied: npipe dockerDesktopLinuxEngine", "daemon-pipe-access"], ["Access is denied: provider-workdir", "private-workdir-access"], ["decoding failed due to invalid keys", "config-schema"], ["failed to connect to postgres: private address", "postgres-connect"], ["127.0.0.1 private port: connection refused", "loopback-connect"], ["client version too old for minimum supported API version", "docker-api-version"], ["raw private data with no known classifier", "unclassified"]])("emits only the fixed reason category", (raw, expected) => { expect(classifyProviderToolFailure(Buffer.from(raw!))).toBe(expected); });
});
