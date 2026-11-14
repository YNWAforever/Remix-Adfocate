// @vitest-environment node
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPhase3ReviewCli } from "./delta-review-cli";
import { runDeltaCli } from "./delta-cli";
import { PHASE3_REVIEW_SOURCE_PATHS, type Phase3ReviewPacketInput } from "./delta-review-packet";

// Adapter-boundary tests only: every filesystem/process/manifest/builder boundary
// is mocked. The DTOs below are intentionally fake and are never native evidence.
interface Entry { kind: "file" | "dir" | "symlink" | "fifo" | "device"; bytes?: Buffer; size?: number; alias?: string }
const state = vi.hoisted(() => ({ entries: new Map<string, Entry>(), names: [] as string[], events: [] as string[],
  realpath: vi.fn(), lstat: vi.fn(), readFile: vi.fn(), readdir: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(),
  parseManifest: vi.fn(), validateManifest: vi.fn(), command: vi.fn(), build: vi.fn(), spawn: vi.fn(),
  native: vi.fn(), privateStore: vi.fn(), github: vi.fn(), proofReader: vi.fn(), proofs: vi.fn(), compile: vi.fn(), provenance: vi.fn(), execute: vi.fn(),
  onBuild: undefined as undefined | (() => void), onMkdir: undefined as undefined | (() => void) }));
vi.mock("node:fs/promises", () => ({ realpath: state.realpath, lstat: state.lstat, readFile: state.readFile, readdir: state.readdir, mkdir: state.mkdir, writeFile: state.writeFile }));
vi.mock("node:child_process", () => ({ spawn: state.spawn }));
vi.mock("./manifest", () => ({ parseReleaseManifest: state.parseManifest, validateManifest: state.validateManifest }));
vi.mock("./delta-child-process", async original => ({ ...await original<typeof import("./delta-child-process")>(), boundedDeltaCommand: state.command }));
vi.mock("./delta-review-packet", async original => ({ ...await original<typeof import("./delta-review-packet")>(), buildPhase3ReviewPacket: state.build }));
vi.mock("./delta-native", () => ({ createManagedDeltaDatabase: state.native }));
vi.mock("./delta-private-artifacts", () => ({ createPrivateRecoveryAttempt: state.privateStore }));
vi.mock("./delta-providers.github", () => ({ createGitHubDeltaReaders: state.github }));
vi.mock("./delta-providers.reports", () => ({ committedDeltaProofReader: state.proofReader, resolveOwnerAcceptedDeltaReports: state.proofs }));
vi.mock("./delta-program", () => ({ compileDeltaProgram: state.compile }));
vi.mock("./delta-provenance", () => ({ canonicalEvidencePath: vi.fn(), verifyEvidenceFilePath: vi.fn(), verifyDeltaProvenance: state.provenance }));
vi.mock("./delta-executor", async original => ({ ...await original<typeof import("./delta-executor")>(), executeBundledDelta: state.execute }));

const ROOT = resolve("offline-review-adapter-virtual-root"), SUBJECT = "a".repeat(40), NOW = new Date("2026-11-14T04:00:00.000Z");
const INPUT = `docs/verification/phase3-release-review/selection-${SUBJECT}.json`, OUTPUT = `docs/verification/phase3-release-review/review-${SUBJECT}.json`;
const MANIFEST = "supabase/release-manifest.json", MIGRATIONS = "supabase/migrations", LEGACY = `${MIGRATIONS}/0001_fixture.sql`, REVIEWED = `${MIGRATIONS}/20261114000000_fixture.sql`;
const PROVIDER = `docs/verification/phase3-provider-rehearsal/owned-${SUBJECT.slice(0, 12)}-11111111-1111-4111-8111-111111111111.json`;
const PAIRED = "docs/verification/phase3-paired-recovery/native-20261114-fault-confirmed.json", CI = `docs/verification/phase3-release-review/source-ci-${SUBJECT}.json`;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const fakePacket = { schemaVersion: 1, kind: "offline-adapter-boundary-test-fixture", status: "HOLD", accepted: false, validReleaseEvidence: false, fixtureOnly: true };
const absolute = (path: string) => resolve(ROOT, path);
function entry(path: string) { const value = state.entries.get(absolute(path)); if (!value) throw new Error("Missing virtual test entry"); return value; }
function directories(path: string) {
  let current = dirname(path);
  for (;;) { if (!state.entries.has(current)) state.entries.set(current, { kind: "dir" }); if (current === ROOT || dirname(current) === current) return; current = dirname(current); }
}
function file(path: string, bytes: Buffer | string) { const target = absolute(path); directories(target); state.entries.set(target, { kind: "file", bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes) }); }
function fixture() {
  state.entries.set(ROOT, { kind: "dir" }); state.entries.set(absolute(MIGRATIONS), { kind: "dir" });
  file(MANIFEST, JSON.stringify({ adapterBoundaryFixtureOnly: true })); file(LEGACY, "-- fake legacy public SQL\n"); file(REVIEWED, "-- fake reviewed public SQL\n");
  state.names = ["0001_fixture.sql", "20261114000000_fixture.sql", ".gitkeep"];
  // Artifact payload keys deliberately do not control the adapter's source inventory.
  for (const path of [PROVIDER, PAIRED, CI]) file(path, JSON.stringify({ adapterBoundaryFixtureOnly: true, codeHashes: { "../../private/unread.json": "b".repeat(64) }, sourcePaths: ["../../private/unread.json"] }));
  for (const path of PHASE3_REVIEW_SOURCE_PATHS) file(path, `// fake public source: ${path}\n`);
  const reference = (path: string) => ({ path, sha256: hash(entry(path).bytes!), contentDigest: "c".repeat(64) });
  file(INPUT, JSON.stringify({ schemaVersion: 1, sourceCommit: SUBJECT, provider: reference(PROVIDER), pairedRecovery: reference(PAIRED), sourceCi: reference(CI) }));
}
function selection(change: (row: Record<string, unknown>) => void) { const value = JSON.parse(entry(INPUT).bytes!.toString()) as Record<string, unknown>; change(value); file(INPUT, JSON.stringify(value)); }
function noAuthority() {
  for (const mock of [state.spawn, state.native, state.privateStore, state.github, state.proofReader, state.proofs, state.compile, state.provenance, state.execute]) expect(mock).not.toHaveBeenCalled();
}
function noOutput() { expect(state.mkdir).not.toHaveBeenCalled(); expect(state.writeFile).not.toHaveBeenCalled(); }
async function rejectsBeforeValidator(path?: string) {
  await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow();
  expect(state.validateManifest).not.toHaveBeenCalled(); expect(state.command).not.toHaveBeenCalled(); expect(state.build).not.toHaveBeenCalled(); noOutput(); noAuthority();
  if (path) expect(state.readFile.mock.calls.map(call => call[0])).not.toContain(absolute(path));
}

beforeEach(() => {
  for (const value of Object.values(state)) if (vi.isMockFunction(value)) value.mockReset();
  state.entries.clear(); state.events = []; state.onBuild = undefined; state.onMkdir = undefined; fixture();
  state.realpath.mockImplementation(async (path: string) => { const item = state.entries.get(path); if (!item) throw new Error("Virtual path absent"); return item.alias ?? path; });
  state.lstat.mockImplementation(async (path: string) => { const item = state.entries.get(path); if (!item) throw new Error("Virtual stat absent"); return { isDirectory: () => item.kind === "dir", isFile: () => item.kind === "file", isSymbolicLink: () => item.kind === "symlink", size: item.size ?? item.bytes?.length ?? 0 }; });
  state.readFile.mockImplementation(async (path: string) => { state.events.push(`read:${path}`); const item = state.entries.get(path); if (!item || item.kind !== "file" || !item.bytes) throw new Error("Unexpected or private virtual read forbidden"); return Buffer.from(item.bytes); });
  state.readdir.mockImplementation(async (path: string) => { expect(path).toBe(absolute(MIGRATIONS)); return [...state.names]; });
  state.parseManifest.mockReturnValue({ migrations: Array.from({ length: 67 }, (_, index) => ({ version: `fake-${index}` })) });
  state.validateManifest.mockImplementation(async () => { state.events.push("validate-manifest"); return []; });
  state.command.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  state.build.mockImplementation(() => { state.onBuild?.(); return fakePacket; });
  state.mkdir.mockImplementation(async (path: string) => { state.onMkdir?.(); if (!state.entries.has(path)) state.entries.set(path, { kind: "dir" }); });
  state.writeFile.mockImplementation(async (path: string, contents: string, options: { flag?: string }) => {
    if (options.flag === "wx" && state.entries.has(path)) throw Object.assign(new Error("Virtual exclusive destination exists"), { code: "EEXIST" });
    state.entries.set(path, { kind: "file", bytes: Buffer.from(contents) });
  });
  state.spawn.mockImplementation(() => { throw new Error("Real child process forbidden in offline adapter tests"); });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("actual offline review adapter with mocked I/O (not native evidence)", () => {
  it("preflights every legacy/reviewed SQL read before the unchanged validator and writes a fresh HOLD exclusively", async () => {
    const result = await runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW);
    expect(result).toMatchObject({ status: "HOLD", validReleaseEvidence: false, sourceSqlExecutionAttempted: false, manifestSourceCount: 67, packet: fakePacket });
    const validated = state.events.indexOf("validate-manifest");
    for (const path of [LEGACY, REVIEWED]) expect(state.events.indexOf(`read:${absolute(path)}`)).toBeLessThan(validated);
    expect(state.command).toHaveBeenCalledWith("git", ["-C", ROOT, "merge-base", "--is-ancestor", SUBJECT, "HEAD"], expect.objectContaining({ timeoutMs: 15_000, maximumOutputBytes: 64 * 1024 }));
    expect(state.writeFile).toHaveBeenCalledWith(absolute(OUTPUT), expect.stringContaining('"fixtureOnly":true'), { flag: "wx" });
    expect(entry(OUTPUT).bytes!.toString()).toBe(`${JSON.stringify(fakePacket, Object.keys(fakePacket).sort())}\n`); noAuthority();
  });
  it("dispatches review before protected providers, database, policy and approval constructors", async () => {
    const result = await runDeltaCli(["review", "--input", INPUT, "--output", OUTPUT], { RELEASE_DELTA_POLICY_JSON: "not trusted", RELEASE_DATABASE_URL: "not a connection" }, ROOT);
    expect(result).toMatchObject({ kind: "phase3-release-review-preparation", status: "HOLD", sourceSqlExecutionAttempted: false }); noAuthority();
  });
  it("reads exactly the fixed 23 sources regardless of artifact codeHashes/sourcePaths", async () => {
    await runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW);
    const captured = state.build.mock.calls[0]![0] as Phase3ReviewPacketInput;
    expect(captured.currentSources.map(row => row.path)).toEqual([...PHASE3_REVIEW_SOURCE_PATHS]); expect(captured.currentSources).toHaveLength(23);
    for (const source of captured.currentSources) expect(source.sha256).toBe(hash(entry(source.path).bytes!));
    const sourceReads = state.readFile.mock.calls.map(call => call[0]).filter(path => typeof path === "string" && path.startsWith(absolute("scripts/release")));
    expect(sourceReads.sort()).toEqual(PHASE3_REVIEW_SOURCE_PATHS.map(absolute).sort());
    expect(state.readFile.mock.calls.map(call => call[0]).sort()).toEqual([MANIFEST, LEGACY, REVIEWED, INPUT, PROVIDER, PAIRED, CI, ...PHASE3_REVIEW_SOURCE_PATHS].map(absolute).sort());
    expect(state.readFile.mock.calls.map(call => call[0])).not.toContain(absolute("../../private/unread.json"));
  });
  it("retains the unchanged manifest validator as a mandatory gate after safe SQL preflight", async () => {
    state.validateManifest.mockResolvedValue(["fake checksum drift"]);
    await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow();
    expect(state.validateManifest).toHaveBeenCalledTimes(1); expect(state.command).not.toHaveBeenCalled(); expect(state.build).not.toHaveBeenCalled(); noOutput(); noAuthority();
  });
  it("rejects malformed manifest JSON before enumerating SQL or invoking the validator", async () => {
    file(MANIFEST, "not JSON"); await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow();
    expect(state.parseManifest).not.toHaveBeenCalled(); expect(state.readdir).not.toHaveBeenCalled(); expect(state.validateManifest).not.toHaveBeenCalled(); noOutput(); noAuthority();
  });
  it("filters ambient credentials from the mocked Git child's environment", async () => {
    vi.stubEnv("GITHUB_TOKEN", "offline-private-marker"); vi.stubEnv("RELEASE_DATABASE_URL", "offline-private-marker");
    await runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW);
    const options = state.command.mock.calls[0]![2] as { env: Record<string, string> };
    expect(options.env).not.toHaveProperty("GITHUB_TOKEN"); expect(options.env).not.toHaveProperty("RELEASE_DATABASE_URL"); noAuthority();
  });
});

describe("migration preflight rejects before any unsafe source read or manifest validation", () => {
  it.each(["symlink", "file", "fifo", "device"] as const)("rejects a migration directory of kind %s before enumeration", async kind => {
    entry(MIGRATIONS).kind = kind; await rejectsBeforeValidator(); expect(state.readdir).not.toHaveBeenCalled();
  });
  it("rejects a canonical migration-directory alias before enumeration", async () => {
    entry(MIGRATIONS).alias = absolute("../../private/source"); await rejectsBeforeValidator(); expect(state.readdir).not.toHaveBeenCalled();
  });
  it.each([LEGACY, REVIEWED])("rejects a symlinked SQL file %s before reading it", async path => { entry(path).kind = "symlink"; await rejectsBeforeValidator(path); });
  it.each(["dir", "fifo", "device"] as const)("rejects a non-regular SQL %s before reading it", async kind => { entry(REVIEWED).kind = kind; await rejectsBeforeValidator(REVIEWED); });
  it.each(["empty", "oversized", "alias"])("rejects %s SQL before reading it", async kind => {
    if (kind === "empty") entry(REVIEWED).size = 0; if (kind === "oversized") entry(REVIEWED).size = 2 * 1024 * 1024 + 1;
    if (kind === "alias") entry(REVIEWED).alias = absolute("../../private/roles.sql"); await rejectsBeforeValidator(REVIEWED);
  });
  it("rejects SQL that grows after stat before the manifest validator", async () => {
    entry(REVIEWED).size = 1; entry(REVIEWED).bytes = Buffer.alloc(2 * 1024 * 1024 + 1); await rejectsBeforeValidator();
  });
  it.each(["ordinary.sql", "00001_bad.sql", "20261114000000_Upper.sql", "20261114000000_bad-name.sql", "../private.sql", ".sql"])("refuses nonclosed migration name %s without reading it", async name => {
    state.names.push(name); await rejectsBeforeValidator(`${MIGRATIONS}/${name}`);
  });
  it.each(["empty", "121-sql", "257-entries"])("bounds migration enumeration: %s", async mode => {
    state.names = mode === "empty" ? [".gitkeep"] : mode === "121-sql" ? Array.from({ length: 121 }, (_, i) => `${String(i).padStart(4, "0")}_fixture.sql`) : Array.from({ length: 257 }, (_, i) => `file-${i}`);
    await rejectsBeforeValidator();
  });
  it("accepts the 120-SQL/256-total boundary while reading every allowed SQL before validation", async () => {
    state.names = Array.from({ length: 120 }, (_, i) => `${String(i).padStart(4, "0")}_fixture.sql`);
    for (const name of state.names) file(`${MIGRATIONS}/${name}`, "-- fake public bounded SQL\n"); state.names.push(...Array.from({ length: 136 }, (_, i) => `note-${i}`));
    await runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW);
    const beforeValidation = state.events.slice(0, state.events.indexOf("validate-manifest"));
    expect(beforeValidation.filter(event => event.startsWith(`read:${absolute(MIGRATIONS)}`))).toHaveLength(120); noAuthority();
  });
});

describe("public artifact, fixed-source, ancestry and output boundaries", () => {
  it.each([MANIFEST, INPUT, PROVIDER, PHASE3_REVIEW_SOURCE_PATHS[0]!])("refuses a symlinked public input %s before its read", async path => {
    entry(path).kind = "symlink"; await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow();
    expect(state.readFile.mock.calls.map(call => call[0])).not.toContain(absolute(path)); expect(state.writeFile).not.toHaveBeenCalled(); noAuthority();
  });
  it.each([CI, PHASE3_REVIEW_SOURCE_PATHS[0]!])("refuses a regular public file whose canonical identity is aliased: %s", async path => {
    entry(path).alias = absolute("../../private/aliased-file");
    await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow();
    expect(state.readFile.mock.calls.map(call => call[0])).not.toContain(absolute(path)); expect(state.writeFile).not.toHaveBeenCalled(); noAuthority();
  });
  it.each([[MANIFEST, 512 * 1024], [INPUT, 64 * 1024], [PAIRED, 2 * 1024 * 1024], [PHASE3_REVIEW_SOURCE_PATHS[0]!, 2 * 1024 * 1024]] as const)("rejects oversized public input %s without reading it", async (path, limit) => {
    entry(path).size = limit + 1; await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow(); expect(state.readFile.mock.calls.map(call => call[0])).not.toContain(absolute(path)); expect(state.writeFile).not.toHaveBeenCalled(); noAuthority();
  });
  it.each(["scripts", "scripts/release", "docs", "docs/verification/phase3-provider-rehearsal"])("refuses public ancestor alias %s", async path => {
    entry(path).alias = absolute("../../private/alias"); await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow(); expect(state.writeFile).not.toHaveBeenCalled(); noAuthority();
  });
  it.each([{ code: 1, stdout: "", stderr: "" }, { code: 0, stdout: "unexpected", stderr: "" }, { code: 0, stdout: "", stderr: "unexpected" }])("requires quiet successful offline ancestry %j before artifact/source reads", async result => {
    state.command.mockResolvedValue(result); await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow();
    for (const path of [PROVIDER, PAIRED, CI, ...PHASE3_REVIEW_SOURCE_PATHS]) expect(state.readFile.mock.calls.map(call => call[0])).not.toContain(absolute(path));
    expect(state.build).not.toHaveBeenCalled(); noOutput(); noAuthority();
  });
  it.each(["../private.json", "C:/private.json", INPUT.replace("selection-", "../selection-")])("refuses arbitrary selection path %s", async input => {
    await expect(runPhase3ReviewCli(ROOT, input, OUTPUT, NOW)).rejects.toThrow(); expect(state.readFile.mock.calls.map(call => call[0])).not.toContain(absolute(input)); noOutput(); noAuthority();
  });
  it.each(["root-unknown", "private-ref", "role-swap", "subject-mismatch"])("requires closed selection/reference/subject: %s", async mode => {
    selection(row => { if (mode === "root-unknown") row.sourcePaths = ["../../private/unread.json"];
      if (mode === "private-ref") (row.provider as Record<string, unknown>).path = "../../private/unread.json";
      if (mode === "role-swap") (row.provider as Record<string, unknown>).path = PAIRED;
      if (mode === "subject-mismatch") row.sourceCommit = "b".repeat(40); });
    await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow(); expect(state.readFile.mock.calls.map(call => call[0])).not.toContain(absolute("../../private/unread.json")); noOutput(); noAuthority();
  });
  it("never overwrites an existing output", async () => {
    file(OUTPUT, "existing public bytes\n"); await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow("exclusive");
    expect(entry(OUTPUT).bytes!.toString()).toBe("existing public bytes\n"); expect(state.writeFile.mock.calls[0]![2]).toEqual({ flag: "wx" }); noAuthority();
  });
  it.each(["parent-alias", "directory-symlink", "after-mkdir-alias"])("refuses an output boundary changed after input validation: %s", async mode => {
    const directory = dirname(absolute(OUTPUT)), parent = dirname(directory);
    if (mode === "parent-alias") state.onBuild = () => { state.entries.get(parent)!.alias = absolute("../../private/output"); };
    if (mode === "directory-symlink") state.onBuild = () => { state.entries.get(directory)!.kind = "symlink"; };
    if (mode === "after-mkdir-alias") state.onMkdir = () => { state.entries.get(directory)!.alias = absolute("../../private/output"); };
    await expect(runPhase3ReviewCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow(); expect(state.writeFile).not.toHaveBeenCalled(); noAuthority();
  });
});
