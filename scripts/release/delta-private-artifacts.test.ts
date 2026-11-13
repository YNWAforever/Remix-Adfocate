// @vitest-environment node
import { createHash } from "node:crypto";
import { lstat, readFile, rmdir, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DELTA_PRIVATE_HELPER_SHA256, assertPrivatePosixAncestor, assertPrivatePosixStat, canonicalPrivateBoundary, createPrivateRecoveryAttempt, openPrivateRecoveryAttempt, type DeltaPrivateArtifactsBackend, type PrivateBoundaryFilesystem } from "./delta-private-artifacts";
import { canonicalDeltaJson, digestDeltaProofPayload } from "./delta-evidence";
import { runDeltaPrivateBinary } from "./delta-private-binary";
import type { PairedRecoveryArtifactName } from "./delta-recovery";
const ROOT = fileURLToPath(new URL("../../", import.meta.url)), ID = "11111111-1111-4111-8111-111111111111", PRIVATE = "nonsecret-artifact-fixture";
const NAMES = ["database.dump", "roles.sql", "toc.list"] as const;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const files = new Map<string, Buffer>(), inputs: Buffer[] = [];
  const metadata = (name: string) => { const bytes = files.get(name); if (!bytes) throw new Error(PRIVATE); return { name, bytes: bytes.length, sha256: hash(bytes) }; };
  const backend: DeltaPrivateArtifactsBackend = {
    initialize: vi.fn(async (_id, create) => { if (create && files.size) throw new Error(PRIVATE); }),
    directory: vi.fn(async () => join(tmpdir(), "nonsecret-fixture-private", ID)),
    inventory: vi.fn(async () => [...files.keys()]),
    write: vi.fn(async (name, bytes) => { inputs.push(bytes); if (files.has(name)) throw new Error(PRIVATE); files.set(name, Buffer.from(bytes)); return metadata(name); }),
    read: vi.fn(async name => { const bytes = files.get(name); if (!bytes) throw new Error(PRIVATE); return Buffer.from(bytes); }),
    inspect: vi.fn(async name => metadata(name)),
  };
  const options = { repoRoot: ROOT }, deps = { backend, uuid: () => ID, canonicalBoundary: vi.fn(async (path: string) => resolve(path)) };
  return { files, inputs, backend, options, deps, create: () => createPrivateRecoveryAttempt(options, deps) };
}
async function filled(f: ReturnType<typeof fixture>) {
  const store = await f.create(), artifacts = [];
  for (const name of NAMES) { const input = Buffer.from(`${PRIVATE}:${name}`); artifacts.push(await store.write(name, input)); expect(input.every(byte => byte === 0)).toBe(true); }
  const manifest = { kind: "nonsecret-private-store-fixture", status: "HOLD", validReleaseEvidence: false, artifacts };
  return { store, manifest };
}
async function rejectsSafe(promise: Promise<unknown>) { const error = await promise.then(() => undefined, error => error as Error); expect(error).toBeInstanceOf(Error); expect(`${error!.message}\n${error!.stack}`).not.toContain(PRIVATE); expect(error).not.toHaveProperty("cause"); }
describe("private artifact lease and canonical manifest (mocked storage boundary)", () => {
  it("consumes archive inputs, retains byte identity, seals canonical metadata and reopens durably", async () => {
    const f = fixture(), { store, manifest } = await filled(f); const returned = await store.read("database.dump"); expect(returned.toString()).toBe(`${PRIVATE}:database.dump`); returned.fill(0);
    const seal = await store.seal(manifest); expect(seal).toEqual({ reference: `private-recovery:${ID}`, manifestSha256: digestDeltaProofPayload(manifest) });
    expect(f.files.get("manifest.json")!.toString()).toBe(canonicalDeltaJson(manifest)); expect(f.inputs.every(buffer => buffer.every(byte => byte === 0))).toBe(true);
    expect(JSON.stringify(store)).toBe(JSON.stringify({ reference: `private-recovery:${ID}`, attemptId: ID }));
    const reopened = await openPrivateRecoveryAttempt({ ...f.options, ...seal }, f.deps); expect(await reopened.inspect("roles.sql")).toEqual(manifest.artifacts[1]);
    await rejectsSafe(reopened.write("roles.sql", Buffer.from(PRIVATE))); await rejectsSafe(reopened.seal(manifest));
  });
  it.each(["../escape", "manifest.json", "DATABASE.dump", "database.dump/extra"])("rejects a nonpublic artifact name %s while clearing input", async name => {
    const f = fixture(), store = await f.create(), input = Buffer.from(PRIVATE); await rejectsSafe(store.write(name as PairedRecoveryArtifactName, input));
    expect(input.every(byte => byte === 0)).toBe(true); expect(f.backend.write).not.toHaveBeenCalled();
  });
  it("preserves an existing artifact and holds a duplicate-write attempt", async () => {
    const f = fixture(), { store, manifest } = await filled(f), before = Buffer.from(f.files.get("roles.sql")!);
    await rejectsSafe(store.write("roles.sql", Buffer.from(PRIVATE))); expect(f.files.get("roles.sql")).toEqual(before); await rejectsSafe(store.seal(manifest));
  });
  it("clears copies and prevents sealing after a backend write fails", async () => {
    const f = fixture(), store = await f.create(); vi.mocked(f.backend.write).mockRejectedValueOnce(new Error(PRIVATE)); const input = Buffer.from(PRIVATE);
    await rejectsSafe(store.write("database.dump", input)); expect(input.every(byte => byte === 0)).toBe(true); await rejectsSafe(store.seal({ status: "HOLD", validReleaseEvidence: false, artifacts: [] }));
  });
  it("detects changed artifact bytes before reading or sealing", async () => {
    const f = fixture(), { store, manifest } = await filled(f); f.files.set("roles.sql", Buffer.from("changed")); await rejectsSafe(store.read("roles.sql")); await rejectsSafe(store.seal(manifest));
  });
  it.each(["path", "secret", "authority", "wrong-artifacts"])("rejects unsafe public manifest metadata: %s", async kind => {
    const f = fixture(), { store, manifest } = await filled(f); const value: Record<string, unknown> = { ...manifest };
    if (kind === "path") value.localFile = "C:\\private\\archive.dump"; else if (kind === "secret") value.apiSecret = PRIVATE;
    else if (kind === "authority") value.validReleaseEvidence = true; else value.artifacts = [];
    await rejectsSafe(store.seal(value)); expect(f.files.has("manifest.json")).toBe(false);
  });
  it("does not promote a partial attempt or accept a changed manifest digest", async () => {
    const f = fixture(), { store, manifest } = await filled(f), seal = await store.seal(manifest);
    await rejectsSafe(openPrivateRecoveryAttempt({ ...f.options, ...seal, manifestSha256: "0".repeat(64) }, f.deps));
    f.files.delete("toc.list"); await rejectsSafe(openPrivateRecoveryAttempt({ ...f.options, ...seal }, f.deps));
  });
  it("matches the reviewed helper literal pin against exact raw LF source bytes", async () => {
    const bytes = await readFile(new URL("./delta-private-artifacts.ps1", import.meta.url)); expect(hash(bytes)).toBe(DELTA_PRIVATE_HELPER_SHA256);
    expect(bytes.includes(13)).toBe(false);
  });
  it("clears a returned private buffer when readback content does not match the stored digest", async () => {
    const f = fixture(), { store } = await filled(f), wrong = Buffer.from(PRIVATE); vi.mocked(f.backend.read).mockResolvedValueOnce(wrong);
    await rejectsSafe(store.read("database.dump")); expect(wrong.every(byte => byte === 0)).toBe(true);
  });
  it("snapshots canonical manifest metadata before awaiting file rechecks", async () => {
    const f = fixture(), { store, manifest } = await filled(f), expected = canonicalDeltaJson(manifest), digest = digestDeltaProofPayload(manifest);
    const mutable = { ...manifest, artifacts: manifest.artifacts.map(row => ({ ...row })) };
    const sealing = store.seal(mutable); mutable.status = "CHANGED"; mutable.artifacts[0]!.sha256 = "0".repeat(64);
    expect((await sealing).manifestSha256).toBe(digest); expect(f.files.get("manifest.json")!.toString()).toBe(expected);
  });
  it("rejects a served-root destination before any artifact write", async () => {
    const f = fixture(); vi.mocked(f.backend.directory).mockResolvedValue(resolve(ROOT, "public", ID)); await rejectsSafe(f.create()); expect(f.backend.write).not.toHaveBeenCalled();
  });
});
describe("canonical served-root boundaries before creation", () => {
  function filesystem() {
    const stats = new Map<string, { link?: boolean; missing?: boolean; mode?: number; uid?: number }>();
    const io: PrivateBoundaryFilesystem = { platform: "win32", currentUid: 123,
      lstat: vi.fn(async path => { const row = stats.get(path) ?? {}; if (row.missing) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return { uid: row.uid ?? 0, mode: row.mode ?? 0o40755, isDirectory: () => true, isSymbolicLink: () => row.link === true }; }),
      realpath: vi.fn(async path => path) };
    return { stats, io };
  }
  it("resolves a missing boundary through its longest existing canonical parent", async () => {
    const f = filesystem(), parent = resolve(tmpdir(), "nonsecret-boundary", "served");
    f.stats.set(join(parent, "missing"), { missing: true });
    expect(await canonicalPrivateBoundary(join(parent, "missing", "child"), f.io)).toBe(join(parent, "missing", "child"));
    expect(f.io.realpath).toHaveBeenCalledWith(parent);
  });
  it.each(["served", ".codex", ".dsh"])("rejects a configured/default %s ancestor junction even when the leaf does not exist", async component => {
    const f = filesystem(), alias = resolve(tmpdir(), "nonsecret-boundary", component); f.stats.set(alias, { link: true });
    await rejectsSafe(canonicalPrivateBoundary(join(alias, "visualizations", "missing"), f.io)); expect(f.io.realpath).not.toHaveBeenCalled();
  });
  it("rejects dangling root links rather than treating them as absent directories", async () => {
    const f = filesystem(), path = resolve(tmpdir(), "nonsecret-boundary", "dangling"); f.stats.set(path, { link: true }); await rejectsSafe(canonicalPrivateBoundary(path, f.io));
  });
  it("validates every existing POSIX parent and rejects a writable ancestor above a safe home", async () => {
    const f = filesystem(), home = resolve(tmpdir(), "nonsecret-boundary", "home"); f.stats.set(dirname(home), { uid: 0, mode: 0o40777 });
    await rejectsSafe(canonicalPrivateBoundary(join(home, "missing"), { ...f.io, platform: "linux", requireTrustedAncestors: true }));
  });
  it("allows public boundary writer permissions while requiring trusted permissions for the private chain", async () => {
    const f = filesystem(), path = resolve(tmpdir(), "nonsecret-boundary", "served"); f.stats.set(dirname(path), { uid: 124, mode: 0o40777 });
    expect(await canonicalPrivateBoundary(path, { ...f.io, platform: "linux" })).toBe(path);
    await rejectsSafe(canonicalPrivateBoundary(path, { ...f.io, platform: "linux", requireTrustedAncestors: true }));
  });
  it("rejects an 8.3 or other real-path alias instead of trusting its lexical location", async () => {
    const f = filesystem(), path = resolve(tmpdir(), "NONSEC~1"); vi.mocked(f.io.realpath).mockResolvedValue(resolve(tmpdir(), "nonsecret-expanded"));
    await rejectsSafe(canonicalPrivateBoundary(path, f.io));
  });
  it("does not initialize storage when a served boundary cannot be verified", async () => {
    const f = fixture(); f.deps.canonicalBoundary.mockRejectedValueOnce(new Error(PRIVATE)); await rejectsSafe(f.create()); expect(f.backend.initialize).not.toHaveBeenCalled();
  });
  it("rechecks default served boundaries before a private write and clears input if an alias appears", async () => {
    const f = fixture(), store = await f.create();
    expect(f.deps.canonicalBoundary.mock.calls.some(([path]) => path.includes(`${join(".codex", "visualizations")}`))).toBe(true);
    expect(f.deps.canonicalBoundary.mock.calls.some(([path]) => path.includes(`${join(".dsh", "visualizations")}`))).toBe(true);
    f.deps.canonicalBoundary.mockRejectedValue(new Error(PRIVATE)); const input = Buffer.from(PRIVATE);
    await rejectsSafe(store.write("database.dump", input)); expect(input.every(byte => byte === 0)).toBe(true); expect(f.backend.write).not.toHaveBeenCalled();
  });
});
describe("POSIX trusted ancestor policy", () => {
  const directory = { uid: 0, mode: 0o40755, isDirectory: () => true, isSymbolicLink: () => false };
  it("allows root and current UID ancestors without group/other write", () => { expect(() => assertPrivatePosixAncestor(directory, 123)).not.toThrow(); expect(() => assertPrivatePosixAncestor({ ...directory, uid: 123 }, 123)).not.toThrow(); });
  it.each([{ uid: 124 }, { mode: 0o40775 }, { mode: 0o41777 }, { isSymbolicLink: () => true }, { isDirectory: () => false }])("holds untrusted or replaceable ancestor directories", change => { expect(() => assertPrivatePosixAncestor({ ...directory, ...change }, 123)).toThrow(); });
});
describe("POSIX private stat policy", () => {
  const file = { uid: 123, mode: 0o100600, nlink: 1, isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
  it("accepts only the current UID with exact private mode and a single file link", () => { expect(() => assertPrivatePosixStat(file, 123, false)).not.toThrow(); });
  it.each([{ uid: 124 }, { mode: 0o100644 }, { mode: 0o104600 }, { nlink: 2 }, { isSymbolicLink: () => true }, { isFile: () => false }])("rejects unsafe POSIX file identity", change => { expect(() => assertPrivatePosixStat({ ...file, ...change }, 123, false)).toThrow(); });
  it("requires exact 0700 for directories", () => { const directory = { ...file, mode: 0o40700, isFile: () => false, isDirectory: () => true }; expect(() => assertPrivatePosixStat(directory, 123, true)).not.toThrow(); expect(() => assertPrivatePosixStat({ ...directory, mode: 0o40750 }, 123, true)).toThrow(); });
});

it.skipIf(process.platform !== "win32" || process.env.DELTA_PRIVATE_NONSECRET_FIXTURE !== "1")("validates actual Windows ACLs and durable raw bytes using an explicitly nonsecret owned fixture", async () => {
  const helperBytes = await readFile(new URL("./delta-private-artifacts.ps1", import.meta.url)); expect(hash(helperBytes)).toBe(DELTA_PRIVATE_HELPER_SHA256);
  const policy = helperBytes.toString("utf8").match(/function UnsafeAncestorRule\(\$Rule\) \{[\s\S]*?\n {2}\}/)![0];
  // Exercise the actual reviewed ACL predicate without changing any filesystem ACL.
  const policyProgram = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';foreach($scope in @('MachinePolicy','UserPolicy')){if((Get-ExecutionPolicy -Scope $scope) -notin @('Undefined','Unrestricted','Bypass')){throw 'held'}};$trustedAncestors=@('S-1-5-18');${policy};function Rule($sid,$rights,$flags,$prop){return [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]$rights,[Security.AccessControl.InheritanceFlags]$flags,[Security.AccessControl.PropagationFlags]$prop,[Security.AccessControl.AccessControlType]::Allow)};$result=@((UnsafeAncestorRule (Rule 'S-1-1-0' 'DeleteSubdirectoriesAndFiles' 'None' 'None')),(UnsafeAncestorRule (Rule 'S-1-1-0' 'CreateDirectories' 'None' 'None')),(UnsafeAncestorRule (Rule 'S-1-1-0' 'Delete' 'ContainerInherit' 'InheritOnly')),(UnsafeAncestorRule (Rule 'S-1-5-18' 'FullControl' 'None' 'None')));[Console]::Out.Write((ConvertTo-Json -Compress -InputObject $result))`;
  const ruleResult = await runDeltaPrivateBinary(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(policyProgram, "utf16le").toString("base64")], Buffer.alloc(0), 4096);
  try { expect(JSON.parse(ruleResult.toString("utf8"))).toEqual([true, false, false, false]); } finally { ruleResult.fill(0); }
  const store = await createPrivateRecoveryAttempt({ repoRoot: ROOT }); const artifacts = [];
  const fixtureDirectory = await store.privateDirectory(), alias = resolve(fixtureDirectory, "toc.list");
  expect(alias).toBe(join(fixtureDirectory, "toc.list"));
  await symlink(dirname(fixtureDirectory), alias, "junction");
  try { await rejectsSafe(createPrivateRecoveryAttempt({ repoRoot: ROOT, servedRoots: [alias] })); }
  finally { expect((await lstat(alias)).isSymbolicLink()).toBe(true); await unlink(alias); }
  const content = Buffer.from([80,71,68,77,80,0,255,254,13,10]);
  for (const name of NAMES) artifacts.push(await store.write(name, Buffer.from(content)));
  const read = await store.read("database.dump"); try { expect(read).toEqual(content); } finally { read.fill(0); }
  const manifest = { kind: "nonsecret-private-store-fixture", status: "HOLD", validReleaseEvidence: false, artifacts };
  const seal = await store.seal(manifest), reopened = await openPrivateRecoveryAttempt({ repoRoot: ROOT, ...seal }); expect(await reopened.inspect("toc.list")).toEqual(artifacts[2]);
  // Explicit cleanup applies ONLY to this tiny fixture after every validation passed. Recovery attempts are never automatically deleted.
  const directory = await store.privateDirectory(); expect(basename(directory)).toBe(store.attemptId); expect(directory.startsWith(ROOT)).toBe(false);
  for (const name of [...NAMES, "manifest.json"]) {
    const target = resolve(directory, name); expect(target).toBe(join(directory, name)); const stat = await lstat(target);
    expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1).toBe(true); await unlink(target);
  }
  await rmdir(directory); content.fill(0);
}, 120_000);
