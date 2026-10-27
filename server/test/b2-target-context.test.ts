import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const io = vi.hoisted(() => ({ read: vi.fn(), exec: vi.fn(), inspect: vi.fn() }));
vi.mock("node:child_process", async original => {
  const cp = await original<typeof import("node:child_process")>();
  return { ...cp, default: { ...cp, execFileSync: io.exec, spawnSync: io.inspect }, execFileSync: io.exec, spawnSync: io.inspect };
});
vi.mock("node:fs", async original => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, default: { ...fs, readFileSync: io.read }, readFileSync: io.read };
});
// @ts-expect-error Existing executable target module is native ESM.
const { verifiedTarget, verifiedB2BootstrapTarget, b2ExecutionContext } = await import("../../scripts/audit/local-targets.mjs");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(() => vi.unstubAllEnvs());

function scenario() {
  const projectId = "adfocate-d19-b2-20261025-12345678", runId = "11111111-1111-4111-8111-111111111111";
  const created = "2026-10-25T01:00:00Z", networkId = "f".repeat(64);
  const containerIds = { kong: "a".repeat(64), db: "b".repeat(64), auth: "c".repeat(64), rest: "d".repeat(64), storage: "e".repeat(64) };
  const serviceImageIds = Object.fromEntries(Object.keys(containerIds).map((s, i) => [s, "sha256:" + String(i + 1).repeat(64)]));
  const files = [{ path: ".codex-tmp/b2-unit-source.txt", sha256: hash("unit source") }];
  const fingerprint = hash(JSON.stringify(files));
  const manifest = {
    kind: "D19_B2_EXECUTION_SPEC", schemaVersion: 2, specificationReady: true,
    candidate: { fingerprint }, target: { projectId, plannedOwnerRunId: runId, databaseVolumeName: projectId + "-db-data", networkName: projectId + "-net", serviceImageIds,
      resourceCaps: { projects: 1, persistentDataVolumes: 1, networks: 1, containers: 5 },storageTmpfs:{destination:"/var/lib/storage",sizeBytes:268435456},
      ports: { host: "127.0.0.1", api: 56821, database: 56822, web: 56800, proxy: "none" } },
    fixture: { phases: [{ phase: "role", plannedNamespace: "22222222-2222-4222-8222-222222222222" }, { phase: "core", plannedNamespace: "33333333-3333-4333-8333-333333333333" }, { phase: "browser", plannedNamespace: "44444444-4444-4444-8444-444444444444" }] },
    bootstrap: { profileDigest: "9".repeat(64) }, execution: {} as { artifactNamespace?: unknown },
  };
  const raw = JSON.stringify(manifest), digest = hash(raw), privateRoot = resolve(".codex-tmp", projectId);
  const approval = { kind: "B2_RUNTIME_AUTHORIZATION", approved: true, manifestSha256: digest, sourceFingerprint: fingerprint, ownerReference: "Unit authority only, no real permission" };
  const identity = { disposable: true, projectId, runId, proxy: "none", ownerAuthorization: approval.ownerReference,
    apiPort: 56821, apiContainerId: containerIds.kong, databaseContainerId: containerIds.db, apiImageId: serviceImageIds.kong, databaseImageId: serviceImageIds.db, networkId };
  const receipt = { manifestSha256: digest, sourceFingerprint: fingerprint, identity, containerIds, createdThisRun: true, volumeWasAbsent: true, networkWasAbsent: true,
    databaseCreatedAt: created, volumeCreatedAt: created, volumeName: manifest.target.databaseVolumeName,
    bootstrap: { verified: true, profileDigest: manifest.bootstrap.profileDigest, baselineSha256: "8".repeat(64) } };
  const store = new Map<string, string>([
    [resolve(".codex-tmp/b2-unit-manifest.json"), raw], [resolve(".codex-tmp/b2-unit-approval.json"), JSON.stringify(approval)],
    [resolve(".codex-tmp/b2-unit-receipt.json"), JSON.stringify(receipt)],
    [resolve("docs/verification/code-fingerprint.json"), JSON.stringify({ fingerprint, files })],
    [resolve(files[0].path), "unit source"], [resolve(privateRoot, "keys.private.json"), JSON.stringify({ API_URL: "http://127.0.0.1:56821", ANON_KEY: "unit-anon", SERVICE_ROLE_KEY: "unit-service" })],
  ]);
  io.read.mockReset().mockImplementation((p: string) => {
    const key = resolve(String(p)); if (store.has(key)) return store.get(key);
    if (key.endsWith("empty-start.private.log")) return JSON.stringify({ DB_URL: "unit", API_URL: "http://127.0.0.1:56421", ANON_KEY: "unit-anon", SERVICE_ROLE_KEY: "unit-service" });
    throw Error("Unexpected file read: " + key);
  });
  const metadata = Object.fromEntries(Object.entries(containerIds).map(([service, id]) => [id, {
    id, image: serviceImageIds[service], running: true, project: projectId, created, networks: { only: { NetworkID: networkId } },
    ports: service === "kong" ? { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "56821" }] } : service === "db" ? { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "56822" }] } : {},
    mounts: service === "db" ? [{ Type: "volume", Name: receipt.volumeName, Destination: "/var/lib/postgresql/data", RW: true }] : service === "storage" ? [{Type:"tmpfs",Destination:"/var/lib/storage",RW:true}]:[],
    tmpfs:service==="storage"?{"/var/lib/storage":"rw,size=268435456"}:{},
  }]));
  const network = { id: networkId, internal: false, labels: { "adfocate.run": runId }, containers: Object.values(containerIds), options: { "com.docker.network.bridge.enable_ip_masquerade": "false", "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" } };
  const volume = { name: receipt.volumeName, created, labels: { "adfocate.run": runId, "com.supabase.cli.project": projectId } };
  const inspect = (_command: string, args: string[]) => {
    if (args[0] === "context") return { status: 0, stdout: "npipe:////./pipe/dockerDesktopLinuxEngine" };
    const value = args[0] === "network" ? network : args[0] === "volume" ? volume : metadata[args.at(-1)!];
    if (!value) throw Error("Unexpected metadata command");
    return { status: 0, stdout: JSON.stringify(value) };
  };
  io.inspect.mockReset().mockImplementation(inspect);
  // The old loader would reach its old target; retain a complete old-shape double for RED.
  io.exec.mockReset().mockImplementation((_command: string, args: string[]) => {
    if (args[0] === "network") return JSON.stringify({ labels: { "adfocate.run": "01a16483-e55d-7332-9ddc-7e8a3f68eb11" }, options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" } });
    const isDb = args.at(-1)?.startsWith("supabase_db_");
    return JSON.stringify({ id: isDb ? "b".repeat(64) : "a".repeat(64), image: isDb ? serviceImageIds.db : serviceImageIds.kong,
      network: { only: { NetworkID: networkId } } });
  });
  vi.stubEnv("ADFOCATE_B2_MANIFEST_PATH", ".codex-tmp/b2-unit-manifest.json");
  vi.stubEnv("ADFOCATE_B2_AUTHORIZATION_PATH", ".codex-tmp/b2-unit-approval.json");
  vi.stubEnv("ADFOCATE_B2_TARGET_RECEIPT_PATH", ".codex-tmp/b2-unit-receipt.json");
  vi.stubEnv("ADFOCATE_B2_PHASE", "role");
  const sync = () => { store.set(resolve(".codex-tmp/b2-unit-approval.json"), JSON.stringify(approval)); store.set(resolve(".codex-tmp/b2-unit-receipt.json"), JSON.stringify(receipt)); };
  return { store, manifest, approval, receipt, identity, metadata, network, volume, privateRoot, sync };
}
function rebindManifest(h: ReturnType<typeof scenario>) {
  const raw = JSON.stringify(h.manifest), digest = hash(raw);
  h.store.set(resolve(".codex-tmp/b2-unit-manifest.json"), raw);
  h.approval.manifestSha256 = digest; h.receipt.manifestSha256 = digest; h.sync();
}

describe("B2 explicit execution binding before client setup", () => {
  it("keeps reviewed continuation evidence separate while retaining the same physical project", () => {
    const h = scenario(), recovery = "55555555-5555-4555-8555-555555555555";
    h.manifest.execution.artifactNamespace = recovery; rebindManifest(h);
    const context = b2ExecutionContext();
    expect(context.privatePath("fixture.private.json")).toBe(resolve(".codex-tmp", h.identity.projectId, recovery, "role", "fixture.private.json"));
    expect(context.publicPath("phase-result.json", "core")).toBe(resolve("docs/verification", h.identity.projectId, recovery, "core", "phase-result.json"));
    expect(context.lineage.executionNamespace).toBe(recovery);
    expect(context.lineage.projectId).toBe(h.identity.projectId);
    expect(io.inspect).not.toHaveBeenCalled();
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it.each(["../escape", "C:/outside", "", null, 42])("rejects an invalid artifact namespace %s before Docker or keys", value => {
    const h = scenario(); h.manifest.execution.artifactNamespace = value; rebindManifest(h);
    expect(() => b2ExecutionContext()).toThrow(/B2.*artifact/i);
    expect(io.inspect).not.toHaveBeenCalled();
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it("refuses P0-only authority before any Docker or key-file access", () => {
    const h = scenario(); h.approval.kind = "B2_P0_AUTHORIZATION"; h.sync();
    expect(() => verifiedTarget()).toThrow(/B2.*runtime.*author/i);
    expect(io.exec).not.toHaveBeenCalled(); expect(io.inspect).not.toHaveBeenCalled();
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it("does not silently interpret an old empty selector inside a B2 run", () => {
    scenario(); expect(() => verifiedTarget("empty")).toThrow(/B2.*explicit/i);
    expect(io.exec).not.toHaveBeenCalled(); expect(io.inspect).not.toHaveBeenCalled();
  });
  it("returns the new target only after source, approval, five services and bootstrap receipt match", () => {
    const h = scenario(); const target = verifiedTarget();
    expect(target.identity).toEqual(h.identity); expect(target.env.SUPABASE_URL).toBe("http://127.0.0.1:56821");
    expect(target.context.phase).toBe("role"); expect(target.context.origins).toEqual(["http://127.0.0.1:56800", "http://127.0.0.1:56821"]);
    expect(target.context.publicPath("receipt.json")).toBe(resolve("docs/verification", h.manifest.target.projectId, "role", "receipt.json"));
    expect(io.exec).not.toHaveBeenCalled();
  });
  it.each(["manifest-digest", "source-drift", "bootstrap-missing"])("rejects %s before reading service keys", kind => {
    const h = scenario();
    if (kind === "manifest-digest") h.approval.manifestSha256 = "0".repeat(64);
    if (kind === "source-drift") h.store.set(resolve(".codex-tmp/b2-unit-source.txt"), "changed source");
    if (kind === "bootstrap-missing") h.receipt.bootstrap.verified = false;
    h.sync(); expect(() => verifiedTarget()).toThrow(/B2/i);
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it("rejects an observed extra data volume even under a new project name", () => {
    const h = scenario(); h.metadata[h.receipt.containerIds.storage].mounts.push({ Type: "volume", Name: "unapproved-volume", Destination: "/var/lib/storage", RW: true });
    expect(() => verifiedTarget()).toThrow(/B2.*mount|B2.*volume/i);
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it("rejects missing or oversized storage tmpfs instead of accepting image-created anonymous volumes",()=>{
    const h=scenario();h.metadata[h.receipt.containerIds.storage].tmpfs["/var/lib/storage"]="rw,size=536870912";
    expect(()=>verifiedTarget()).toThrow(/B2.*tmpfs/i);
  });
  it("rejects a shared network member rather than trusting loopback labels", () => {
    const h = scenario(); h.network.containers.push("0".repeat(64));
    expect(() => verifiedTarget()).toThrow(/B2.*network/i);
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it("verifies new infrastructure for owner bootstrap without reading application keys or constructing a client",()=>{
    const h=scenario();h.receipt.bootstrap.verified=false;h.sync();
    const target=verifiedB2BootstrapTarget();expect(target.identity).toEqual(h.identity);expect(target.env).toBeUndefined();
    expect(io.exec).not.toHaveBeenCalled();expect(io.read.mock.calls.some(([p])=>String(p).endsWith("keys.private.json"))).toBe(false);
    expect(()=>verifiedTarget()).toThrow(/bootstrap/i);
  });
  it("accepts omitted optional Tmpfs metadata without letting Docker's Go template fail before identity verification", () => {
    const h = scenario(), inspect = io.inspect.getMockImplementation()!;
    h.receipt.bootstrap.verified = false; h.sync();
    io.inspect.mockImplementation((command: string, args: string[]) => {
      if (args[0] === "inspect" && args.at(-1) !== h.receipt.containerIds.storage
        && args[2].includes(".HostConfig.Tmpfs")) {
        return { status: 1, stderr: 'map has no entry for key "Tmpfs"' };
      }
      return inspect(command, args);
    });
    expect(verifiedB2BootstrapTarget().identity).toEqual(h.identity);
    expect(io.exec).not.toHaveBeenCalled();
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it("verifies the real kernel tmpfs when Docker omits it from Mounts", () => {
    const h = scenario(), inspect = io.inspect.getMockImplementation()!;
    h.receipt.bootstrap.verified = false; h.sync();
    h.metadata[h.receipt.containerIds.storage].mounts = [];
    io.inspect.mockImplementation((command: string, args: string[]) => {
      if (args[0] === "exec" && args.join(" ") === `exec ${h.receipt.containerIds.storage} cat /proc/self/mountinfo`) {
        return { status: 0, stdout: "2191 2179 0:337 / /var/lib/storage rw,nosuid,nodev,noexec,relatime - tmpfs tmpfs rw,size=262144k\n" };
      }
      return inspect(command, args);
    });
    expect(verifiedB2BootstrapTarget().identity).toEqual(h.identity);
    expect(io.exec).not.toHaveBeenCalled();
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it.each([
    ["missing", ""],
    ["wrong filesystem", "1 0 0:1 / /var/lib/storage rw - ext4 /dev/root rw,size=262144k"],
    ["read-only mount", "1 0 0:1 / /var/lib/storage ro - tmpfs tmpfs rw,size=262144k"],
    ["read-only superblock", "1 0 0:1 / /var/lib/storage rw - tmpfs tmpfs ro,size=262144k"],
    ["oversized", "1 0 0:1 / /var/lib/storage rw - tmpfs tmpfs rw,size=524288k"],
    ["unbounded", "1 0 0:1 / /var/lib/storage rw - tmpfs tmpfs rw"],
    ["wrong mountpoint", "1 0 0:1 / /var/lib/storage-other rw - tmpfs tmpfs rw,size=262144k"],
    ["duplicate", "1 0 0:1 / /var/lib/storage rw - tmpfs tmpfs rw,size=262144k\n2 0 0:2 / /var/lib/storage rw - tmpfs tmpfs rw,size=262144k"],
  ])("rejects %s kernel mount evidence before reading application keys", (_reason, mountinfo) => {
    const h = scenario(), inspect = io.inspect.getMockImplementation()!;
    h.metadata[h.receipt.containerIds.storage].mounts = [];
    io.inspect.mockImplementation((command: string, args: string[]) => args[0] === "exec"
      ? { status: 0, stdout: mountinfo } : inspect(command, args));
    expect(() => verifiedTarget()).toThrow(/B2.*tmpfs/i);
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it("does not accept a read-only tmpfs descriptor even if the configured options claim rw", () => {
    const h = scenario(); h.metadata[h.receipt.containerIds.storage].mounts[0].RW = false;
    expect(() => verifiedTarget()).toThrow(/B2.*tmpfs/i);
    expect(io.read.mock.calls.some(([p]) => String(p).endsWith("keys.private.json"))).toBe(false);
  });
  it("binds borrowed role evidence to the exact global run, target and candidate rather than a fixed D19 filename",()=>{
    const h=scenario(),context=verifiedTarget().context;
    expect(()=>context.assertLineage({lineage:{...context.lineage,projectId:"old-empty"}})).toThrow(/lineage/i);
    expect(()=>context.publicPath("../../D19-browser-summary.json")).toThrow(/path/i);
    expect(()=>context.assertLineage({lineage:context.lineage})).not.toThrow();
    expect(h.store.has(context.publicPath("anything.json"))).toBe(false);
  });
});
