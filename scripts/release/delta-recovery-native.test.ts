// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { digestDeltaProofPayload } from "./delta-evidence";
import { nativeOwnedResource } from "./delta-native-collectors";
import { assertPairedRecoveryOwnedContainer, classifyOwnedRecoveryPsqlStderr, pairedRecoveryNativeMain, pairedRecoverySafeFailure } from "./delta-recovery-native";
import { PairedRecoveryFailure } from "./delta-recovery";
import { PsqlTransportError } from "./delta-psql-session";
import { deltaFixtureHash as h } from "./delta-release.fixture";
function fixture() {
  const resource = nativeOwnedResource(h("owned-fixture-nonce").slice(0, 32), "server", `sha256:${h("image")}`, ["/var/lib/postgresql/data"], undefined, "source6-17.6.1.081");
  resource.id = h("owned-server");
  const tmpfs = Object.fromEntries(resource.tmpfs.map(path => [path, path === "/tmp" ? "rw,nosuid,nodev,noexec,size=128m,mode=1777"
    : path === "/tmp/fixture-data" ? "rw,nosuid,nodev,noexec,size=1g,mode=0700,uid=100,gid=101"
    : path === "/tmp/fixture-socket" ? "rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=100,gid=101" : "rw,nosuid,nodev,noexec,size=16m,mode=1777"]));
  const value = { Id: resource.id, Name: `/${resource.name}`, Image: resource.imageId,
    Config: { Image: resource.image, User: "100:101", Env: ["HOME=/tmp", "PATH=/usr/bin"], Labels: { "adfocate.native-collectors": resource.token, "adfocate.native-collectors.role": "server", "adfocate.native-collectors.profile": resource.profile, "adfocate.native-collectors.namespace": "none" } },
    HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, PublishAllPorts: false, PortBindings: null, CapDrop: ["ALL"], CapAdd: null,
      SecurityOpt: ["no-new-privileges"], LogConfig: { Type: "none" }, Tmpfs: tmpfs, PidsLimit: 256, Memory: 1073741824, NanoCpus: 1000000000, Binds: null, VolumesFrom: null },
    Mounts: resource.tmpfs.map(Destination => ({ Type: "tmpfs", Destination, RW: true })), State: { OOMKilled: false } };
  return { resource, value };
}
describe("owned native recovery guards, metadata only and no operations", () => {
  it("requires the exact nonce/image/namespace and private tmpfs flags", () => {
    const f = fixture(); expect(assertPairedRecoveryOwnedContainer([f.value], f.resource)).toBe(f.value);
  });
  it.each(["flags", "permissions", "capacity", "role", "host-mount", "network", "label", "privilege"])("rejects %s drift before an owned operation", kind => {
    const f = fixture();
    if (kind === "flags") f.value.HostConfig.Tmpfs["/tmp"] = "rw,exec,size=128m,mode=1777";
    if (kind === "permissions") f.value.HostConfig.Tmpfs["/tmp/fixture-data"] = "rw,nosuid,nodev,noexec,size=1g,mode=0777,uid=100,gid=101";
    if (kind === "capacity") f.value.HostConfig.Memory = 0;
    if (kind === "role") f.value.Config.User = "0:0";
    if (kind === "host-mount") f.value.Mounts[0]!.Type = "bind";
    if (kind === "network") f.value.HostConfig.NetworkMode = "bridge";
    if (kind === "label") f.value.Config.Labels["adfocate.native-collectors"] = "wrong-owner";
    if (kind === "privilege") f.value.HostConfig.SecurityOpt = ["no-new-privileges:false"];
    expect(() => assertPairedRecoveryOwnedContainer([f.value], f.resource)).toThrow();
  });
  it.each(["PGPASSWORD", "DATABASE_URL", "NODE_OPTIONS", "PGHOSTADDR"])("refuses inherited %s", key => {
    const f = fixture(); f.value.Config.Env.push(`${key}=synthetic-only`); expect(() => assertPairedRecoveryOwnedContainer([f.value], f.resource)).toThrow();
  });
  it.each([[], ["--source-url", "not-an-allowed-argument"], ["--output", "../escape.json"], ["--output", "docs/verification/releases/unapproved.json"], ["--output", "docs/verification/phase3-paired-recovery/native-ok.json", "--apply"]].map(args => ({ args })))("refuses closed command arguments before resource creation: $args", async ({ args }) => {
    await expect(pairedRecoveryNativeMain(args)).rejects.toThrow("fixed-output-path-required");
  });
  it.each([
    ["WARNING: credential file is not a plain file", "server-warning"],
    [["pass", "word"].join("") + ' file "/private/synthetic-only" is not a plain file', "credential-file-warning"],
    ["connection refused at private fixture endpoint", "connection-refused"],
    ["no pg_hba.conf entry for private fixture address", "connection-policy"],
    ["syntax error near private fixture SQL", "invalid-fixed-program"],
    ["could not load library /private/synthetic-only", "extension-binary-unavailable"],
    ["FATAL: private fixture detail", "connection-fatal"],
    ["private row / credential / SQL / path with no known diagnostic", "unclassified-stderr"],
  ])("classifies fixture stderr into a fixed code without exposing its contents", (text, code) => {
    const result = classifyOwnedRecoveryPsqlStderr(Buffer.from(text)); expect(result).toBe(code); expect(result).not.toMatch(/synthetic|private|SQL|path|endpoint/);
  });
  it("keeps the recorded native proof bound to its exact code and nested private manifest digests", async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const proof = JSON.parse(await readFile(resolve(root, "docs/verification/phase3-paired-recovery/native-20261114-restored.json"), "utf8"));
    const { contentDigest, ...body } = proof; expect(digestDeltaProofPayload(body)).toBe(contentDigest);
    expect(proof).toMatchObject({ status: "NATIVE_FIXTURE_PASSED_RELEASE_HOLD", validReleaseEvidence: false, productionEquivalent: false, sourceCommitSynthetic: true,
      sourceLedgerSynthetic: true, providerAuthTested: false, databaseRoleFixtureSuperuser: true, inputHashesUnchanged: true, physicalEnumOidsDiffer: true, ownedSourceAndTargetsCleanup: "confirmed" });
    expect(Object.keys(proof.codeInputs)).toHaveLength(10);
    for (const [path, expected] of Object.entries(proof.codeInputs)) {
      expect(path).toMatch(/^scripts\/release\/delta-[a-z-]+\.(?:ts|sql|ps1)$/);
      const bytes = (await readFile(resolve(root, path), "utf8")).replace(/\r\n?/g, "\n");
      expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(expected);
    }
    const observation = proof.pairedObservation;
    const { reference, manifestSha256, contentDigest: observedDigest, ...manifest } = observation;
    expect(digestDeltaProofPayload(manifest)).toBe(manifestSha256);
    expect(digestDeltaProofPayload({ ...manifest, reference, manifestSha256 })).toBe(observedDigest);
    expect(observation).toMatchObject({ status: "HOLD", validReleaseEvidence: false, sourceCleanupConfirmed: true, ownedContainerCleanup: "confirmed" });
    expect(reference).toMatch(/^private-recovery:[a-f0-9-]{36}$/); expect(Object.hasOwn(observation, "acceptedBy")).toBe(false); expect(Object.hasOwn(observation, "rpoSeconds")).toBe(false);
    expect(observation.sourceBefore.data).toEqual(observation.restoredBefore.data);
    expect(observation.sourceBefore.data).toMatchObject({ tableCount: 7, rowCount: 25, sequenceCount: 1 });
    expect(observation.sourceBefore.fingerprint.rootSha256).toBe(observation.restoredBefore.fingerprint.rootSha256);
    expect(observation.sourceBefore.fingerprint.snapshotBindingHash).toBe(observation.sourceSnapshotBindingHash);
    expect(observation.sourceBefore.fingerprint.targetBindingHash).not.toBe(observation.restoredBefore.fingerprint.targetBindingHash);
    expect(observation.sourceBefore.fingerprint.snapshotBindingHash).not.toBe(observation.restoredBefore.fingerprint.snapshotBindingHash);
    expect(proof.cases).toHaveLength(7); expect(proof.cases.filter((item: { result: string }) => item.result === "REJECTED_HOLD")).toHaveLength(6);
  });
  it("exposes only safe known failure codes and cleanup facts", () => {
    expect(pairedRecoverySafeFailure(new Error("private row / SQL / credential / host path"))).toEqual({ phase: "unverified-native-operation" });
    expect(pairedRecoverySafeFailure(new PsqlTransportError("protocol-error", "42P01"))).toEqual({ phase: "psql", transportCode: "protocol-error", sqlState: "42P01" });
    const outcome = { sourceCleanupConfirmed: true, targetCleanupConfirmed: false, targetRestoreAttempted: true, containmentRequired: true };
    expect(pairedRecoverySafeFailure(new PairedRecoveryFailure("target-cleanup", outcome))).toEqual({ phase: "target-cleanup", outcome });
  });
});
