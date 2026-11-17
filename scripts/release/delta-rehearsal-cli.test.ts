// @vitest-environment node
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rehearsalPreflightPaths, runPhase3RehearsalPlanCli } from "./delta-rehearsal-cli";
import { runDeltaCli } from "./delta-cli";
import { DELTA_REQUIRED_GATES } from "./delta-release-contracts";

// Adapter tests only: all filesystem, Git, manifest and plan-builder operations
// are mocks with NO actual filesystem fallback. This is not native evidence.
interface Entry { kind: "file" | "dir" | "symlink" | "fifo" | "device"; bytes?: Buffer; size?: number; alias?: string }
const state = vi.hoisted(() => ({ entries: new Map<string, Entry>(), names: [] as string[], events: [] as string[],
  realpath: vi.fn(), lstat: vi.fn(), readFile: vi.fn(), readdir: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(),
  parseManifest: vi.fn(), validateManifest: vi.fn(), command: vi.fn(), build: vi.fn(), spawn: vi.fn(),
  native: vi.fn(), privateStore: vi.fn(), github: vi.fn(), proofReader: vi.fn(), proofs: vi.fn(), compile: vi.fn(),
  provenance: vi.fn(), evidencePath: vi.fn(), verifyPath: vi.fn(), execute: vi.fn(), review: vi.fn(),
  onBuild: undefined as undefined | (() => void), onMkdir: undefined as undefined | (() => void) }));
vi.mock("node:fs/promises", () => ({ realpath: state.realpath, lstat: state.lstat, readFile: state.readFile, readdir: state.readdir, mkdir: state.mkdir, writeFile: state.writeFile }));
vi.mock("node:child_process", () => ({ spawn: state.spawn }));
vi.mock("./manifest", () => ({ parseReleaseManifest: state.parseManifest, validateManifest: state.validateManifest }));
vi.mock("./delta-child-process", async original => ({ ...await original<typeof import("./delta-child-process")>(), boundedDeltaCommand: state.command }));
vi.mock("./delta-rehearsal-plan", () => ({ buildPhase3RehearsalPlan: state.build }));
vi.mock("./delta-native", () => ({ createManagedDeltaDatabase: state.native }));
vi.mock("./delta-private-artifacts", () => ({ createPrivateRecoveryAttempt: state.privateStore }));
vi.mock("./delta-providers.github", () => ({ createGitHubDeltaReaders: state.github }));
vi.mock("./delta-providers.reports", () => ({ committedDeltaProofReader: state.proofReader, resolveOwnerAcceptedDeltaReports: state.proofs }));
vi.mock("./delta-program", () => ({ compileDeltaProgram: state.compile }));
vi.mock("./delta-provenance", () => ({ canonicalEvidencePath: state.evidencePath, verifyEvidenceFilePath: state.verifyPath, verifyDeltaProvenance: state.provenance }));
vi.mock("./delta-executor", () => ({ DeltaExecutionFailure: class extends Error {}, executeBundledDelta: state.execute }));
vi.mock("./delta-review-cli", () => ({ runPhase3ReviewCli: state.review }));

const ROOT = resolve("offline-rehearsal-adapter-virtual-root"), SUBJECT = "a".repeat(40), OTHER = "b".repeat(40);
const NOW = new Date("2026-11-14T16:00:00.000Z"), PREFIX = "docs/verification/phase3-rehearsal-preflight";
const INPUT = `${PREFIX}/worksheet-${SUBJECT}.json`, OUTPUT = `${PREFIX}/plan-${SUBJECT}.json`;
const MANIFEST = "supabase/release-manifest.json", MIGRATIONS = "supabase/migrations";
const LEGACY = `${MIGRATIONS}/0001_fixture.sql`, REVIEWED = `${MIGRATIONS}/20261114000000_fixture.sql`;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const absolute = (path: string) => resolve(ROOT, path);
const fakePlan = { schemaVersion: 1, kind: "mocked-adapter-HOLD-plan-not-native-evidence", status: "HOLD", validReleaseEvidence: false,
  accepted: false, ownerAccepted: false, captureAuthorized: false, executionAuthorized: false, fixtureOnly: true,
  gates: DELTA_REQUIRED_GATES.map(gate => ({ gate, status: "HOLD" })) };
function missing() { return Object.assign(new Error("Virtual path absent; real filesystem fallback forbidden"), { code: "ENOENT" }); }
function entry(path: string) { const item = state.entries.get(absolute(path)); if (!item) throw missing(); return item; }
function directories(path: string) {
  let current = dirname(path);
  for (;;) { if (!state.entries.has(current)) state.entries.set(current, { kind: "dir" }); if (current === ROOT || dirname(current) === current) return; current = dirname(current); }
}
function file(path: string, bytes: string | Buffer) { const target = absolute(path); directories(target); state.entries.set(target, { kind: "file", bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes) }); }
function worksheet(value: unknown) { file(INPUT, `${JSON.stringify(value, null, 2)}\n`); }
function fixture() {
  state.entries.set(ROOT, { kind: "dir" }); state.entries.set(absolute(MIGRATIONS), { kind: "dir" });
  worksheet({ schemaVersion: 1, sourceCommit: SUBJECT, owners: null, budgets: null });
  file(MANIFEST, JSON.stringify({ adapterBoundaryFixtureOnly: true }));
  file(LEGACY, "-- public legacy SQL fixture only\n"); file(REVIEWED, "-- public reviewed SQL fixture only\n");
  state.names = ["0001_fixture.sql", "20261114000000_fixture.sql", ".gitkeep"];
}
function noAuthority() {
  for (const mock of [state.spawn, state.native, state.privateStore, state.github, state.proofReader, state.proofs, state.compile,
    state.provenance, state.evidencePath, state.verifyPath, state.execute, state.review]) expect(mock).not.toHaveBeenCalled();
}
function noOutput() { expect(state.mkdir).not.toHaveBeenCalled(); expect(state.writeFile).not.toHaveBeenCalled(); }
function noReads() { for (const mock of [state.realpath, state.lstat, state.readFile, state.readdir]) expect(mock).not.toHaveBeenCalled(); }
async function beforeValidator(unread?: string) {
  await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow();
  expect(state.validateManifest).not.toHaveBeenCalled(); expect(state.command).not.toHaveBeenCalled(); expect(state.build).not.toHaveBeenCalled(); noOutput();
  if (unread) expect(state.readFile.mock.calls.map(call => call[0])).not.toContain(absolute(unread));
}
function padJson(path: string, maximum: number) { const current = entry(path).bytes!; file(path, Buffer.concat([current, Buffer.alloc(maximum - current.length, 32)])); }

beforeEach(() => {
  for (const value of Object.values(state)) if (vi.isMockFunction(value)) value.mockReset();
  state.entries.clear(); state.events = []; state.onBuild = undefined; state.onMkdir = undefined; fixture();
  state.realpath.mockImplementation(async (path: string) => { state.events.push(`canonical:${path}`); const item = state.entries.get(path); if (!item) throw missing(); return item.alias ?? path; });
  state.lstat.mockImplementation(async (path: string) => { state.events.push(`stat:${path}`); const item = state.entries.get(path); if (!item) throw missing();
    return { isDirectory: () => item.kind === "dir", isFile: () => item.kind === "file", isSymbolicLink: () => item.kind === "symlink", size: item.size ?? item.bytes?.length ?? 0 }; });
  state.readFile.mockImplementation(async (path: string) => { state.events.push(`read:${path}`); const item = state.entries.get(path);
    if (!item || item.kind !== "file" || !item.bytes) throw new Error("Unexpected virtual read; real filesystem fallback forbidden"); return Buffer.from(item.bytes); });
  state.readdir.mockImplementation(async (path: string) => { expect(path).toBe(absolute(MIGRATIONS)); state.events.push("enumerate-migrations"); return [...state.names]; });
  state.parseManifest.mockReturnValue({ migrations: Array.from({ length: 67 }, (_, index) => ({ version: `mock-${index}` })) });
  state.validateManifest.mockImplementation(async () => { state.events.push("validate-manifest"); return []; });
  state.command.mockImplementation(async () => { state.events.push("git-ancestry"); return { code: 0, stdout: "", stderr: "" }; });
  state.build.mockImplementation(() => { state.events.push("build-HOLD-plan"); state.onBuild?.(); return fakePlan; });
  state.mkdir.mockImplementation(async (path: string, options: { recursive?: boolean }) => {
    expect(path).toBe(dirname(absolute(OUTPUT))); expect(options).toEqual({ recursive: true });
    state.events.push("mkdir-output"); if (!state.entries.has(path)) state.entries.set(path, { kind: "dir" }); state.onMkdir?.();
  });
  state.writeFile.mockImplementation(async (path: string, contents: string, options: { flag?: string }) => {
    state.events.push(`write:${path}`); expect(options).toEqual({ flag: "wx" });
    if (state.entries.has(path)) throw Object.assign(new Error("Virtual exclusive destination exists"), { code: "EEXIST" });
    state.entries.set(path, { kind: "file", bytes: Buffer.from(contents) });
  });
  for (const mock of [state.spawn, state.native, state.privateStore, state.github, state.proofReader, state.proofs, state.compile, state.provenance, state.evidencePath, state.verifyPath, state.execute, state.review]) {
    mock.mockImplementation(() => { throw new Error("Protected runtime capability forbidden in mocked offline adapter tests"); });
  }
  vi.useFakeTimers(); vi.setSystemTime(NOW);
});
afterEach(() => { noAuthority(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("rehearsal adapter and actual CLI dispatch with mocked I/O only", () => {
  it("reads the worksheet first, preflights SQL before validation, then checks ancestry before builder/write", async () => {
    const result = await runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW);
    expect(result).toMatchObject({ kind: "phase3-rehearsal-preflight-result", status: "HOLD", validReleaseEvidence: false, ownerAccepted: false,
      captureAuthorized: false, executionAuthorized: false, sourceSqlExecutionAttempted: false, artifact: OUTPUT, manifestSourceCount: 67, plan: fakePlan });
    expect(state.readFile.mock.calls.map(call => call[0])).toEqual([INPUT, MANIFEST, LEGACY, REVIEWED].map(absolute));
    for (const path of [LEGACY, REVIEWED]) expect(state.events.indexOf(`read:${absolute(path)}`)).toBeLessThan(state.events.indexOf("validate-manifest"));
    expect(state.events.indexOf("validate-manifest")).toBeLessThan(state.events.indexOf("git-ancestry"));
    expect(state.events.indexOf("git-ancestry")).toBeLessThan(state.events.indexOf("build-HOLD-plan"));
    expect(state.events.indexOf("build-HOLD-plan")).toBeLessThan(state.events.indexOf(`write:${absolute(OUTPUT)}`));
    expect(state.command).toHaveBeenCalledWith("git", ["--no-lazy-fetch", "-C", ROOT, "merge-base", "--is-ancestor", SUBJECT, "HEAD"], expect.objectContaining({ timeoutMs: 15_000, maximumOutputBytes: 64 * 1024 }));
    expect(state.mkdir).not.toHaveBeenCalled(); expect(state.writeFile).toHaveBeenCalledWith(absolute(OUTPUT), expect.any(String), { flag: "wx" });
    const written = entry(OUTPUT).bytes!.toString(); expect(JSON.parse(written)).toEqual(fakePlan); expect(written.endsWith("\n")).toBe(true);
    expect(result.plan.gates).toHaveLength(16); expect(result.plan.gates.every(gate => gate.status === "HOLD")).toBe(true);
  });
  it("passes exactly the four metadata fields with the SHA256 of the actual worksheet bytes", async () => {
    padJson(INPUT, 64 * 1024);
    await runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW);
    const [input, metadata] = state.build.mock.calls[0]!;
    expect(input).toEqual(JSON.parse(entry(INPUT).bytes!.toString()));
    expect(metadata).toEqual({ sourceCommit: SUBJECT, preparedAt: NOW.toISOString(), manifestSourceCount: 67, worksheetSha256: hash(entry(INPUT).bytes!) });
    expect(Object.keys(metadata).sort()).toEqual(["manifestSourceCount", "preparedAt", "sourceCommit", "worksheetSha256"]);
    expect(input.owners).toBeNull(); expect(input.budgets).toBeNull();
  });
  it("does not let untrusted worksheet path fields select any additional filesystem input", async () => {
    worksheet({ sourceCommit: SUBJECT, owners: null, budgets: null, sourcePaths: ["../../private/roles.sql"], credentialPath: "C:/private/token.json", output: "../../private/out.json" });
    await runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW);
    expect(state.readFile.mock.calls.map(call => call[0])).toEqual([INPUT, MANIFEST, LEGACY, REVIEWED].map(absolute));
    expect(state.build.mock.calls[0]![0]).toMatchObject({ owners: null, budgets: null, sourcePaths: ["../../private/roles.sql"] });
    // The real pure builder owns unknown-field rejection; this mock proves only IO isolation.
    expect(state.writeFile.mock.calls[0]![0]).toBe(absolute(OUTPUT));
  });
  it("dispatches rehearsal-plan before reading any protected environment or constructing a runtime", async () => {
    const poisoned = new Proxy({} as NodeJS.ProcessEnv, { get() { throw new Error("Protected environment must not be read"); }, ownKeys() { throw new Error("Protected environment must not be enumerated"); } });
    const result = await runDeltaCli(["rehearsal-plan", "--input", INPUT, "--output", OUTPUT], poisoned, ROOT);
    expect(result).toMatchObject({ status: "HOLD", captureAuthorized: false, executionAuthorized: false, sourceSqlExecutionAttempted: false, plan: fakePlan });
    expect(state.build).toHaveBeenCalledOnce();
  });
  it("filters ambient credentials and retains the pinned no-lazy-fetch flag despite an ambient override attempt", async () => {
    for (const name of ["GITHUB_TOKEN", "VERCEL_TOKEN", "VERCEL_AUTOMATION_BYPASS_SECRET", "RELEASE_DATABASE_URL", "RELEASE_DELTA_POLICY_JSON", "SUPABASE_ACCESS_TOKEN", "PGPASSWORD", "DOCKER_HOST", "DOCKER_CONTEXT"]) vi.stubEnv(name, "mock-private-ambient-marker");
    vi.stubEnv("GIT_NO_LAZY_FETCH", "0");
    await runDeltaCli(["rehearsal-plan", "--input", INPUT, "--output", OUTPUT], {}, ROOT);
    expect(state.command).toHaveBeenCalledOnce();
    expect(state.command.mock.calls[0]![1]).toEqual(["--no-lazy-fetch", "-C", ROOT, "merge-base", "--is-ancestor", SUBJECT, "HEAD"]);
    const env = state.command.mock.calls[0]![2].env as Record<string, string>;
    expect(env).not.toHaveProperty("GIT_NO_LAZY_FETCH");
    expect(JSON.stringify(env)).not.toContain("mock-private-ambient-marker");
    for (const name of ["GITHUB_TOKEN", "VERCEL_TOKEN", "RELEASE_DATABASE_URL", "RELEASE_DELTA_POLICY_JSON", "SUPABASE_ACCESS_TOKEN", "PGPASSWORD", "DOCKER_HOST", "DOCKER_CONTEXT"]) expect(env).not.toHaveProperty(name);
  });
  it.each([{ extra: ["--apply"] }, { extra: ["--approval", "anything"] }, { extra: ["--bindings", "private.json"] }, { extra: ["--bundle", "private.json"] }, { extra: ["--database-url", "not-a-connection"] }])("refuses protected selectors before IO when dispatching $extra", async ({ extra }) => {
    await expect(runDeltaCli(["rehearsal-plan", "--input", INPUT, "--output", OUTPUT, ...extra], {}, ROOT)).rejects.toThrow(); noReads(); noOutput();
  });
});

describe("input-first closed paths, clock and public file bounds", () => {
  it.each(["../private.json", "C:/private.json", INPUT.replaceAll("/", "\\"), `${INPUT}\n`, INPUT.replace("worksheet-", "../worksheet-"), INPUT.replace(SUBJECT, SUBJECT.toUpperCase()), INPUT.replace("phase3-rehearsal-preflight", "releases")])("rejects invalid worksheet path %s before all filesystem access", async input => {
    await expect(runPhase3RehearsalPlanCli(ROOT, input, OUTPUT, NOW)).rejects.toThrow(); noReads(); noOutput(); expect(state.command).not.toHaveBeenCalled();
  });
  it.each([OUTPUT.replace(SUBJECT, OTHER), OUTPUT.replace("plan-", "worksheet-"), `${OUTPUT}.bak`, OUTPUT.replace(".json", "-Upper.json"), OUTPUT.replace(".json", "-_bad.json"), OUTPUT.replace(".json", `-${"a".repeat(33)}.json`), OUTPUT.replace(".json", "-../private.json"), `${OUTPUT}\0`])("rejects invalid output %s before all filesystem access", async output => {
    await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, output, NOW)).rejects.toThrow(); noReads(); noOutput(); expect(state.command).not.toHaveBeenCalled();
  });
  it("validates paths before even reading the clock", async () => {
    const now = new Date(NOW), getTime = vi.spyOn(now, "getTime").mockImplementation(() => { throw new Error("Clock must not be read yet"); });
    await expect(runPhase3RehearsalPlanCli(ROOT, "../private.json", OUTPUT, now)).rejects.toThrow(); expect(getTime).not.toHaveBeenCalled(); noReads(); noOutput();
  });
  it("rejects an invalid clock before canonicalizing the root or reading any worksheet", async () => {
    await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, new Date(Number.NaN))).rejects.toThrow(); noReads(); noOutput(); expect(state.build).not.toHaveBeenCalled();
  });
  it.each([null, [], "text", 42, {}, { sourceCommit: OTHER }, { sourceCommit: SUBJECT.toUpperCase() }, { sourceCommit: 123 }])("rejects invalid worksheet header %j before manifest or SQL reads", async value => {
    worksheet(value); await beforeValidator(MANIFEST);
    expect(state.parseManifest).not.toHaveBeenCalled(); expect(state.readdir).not.toHaveBeenCalled();
  });
  it("rejects malformed worksheet JSON before any manifest read", async () => { file(INPUT, "not-json"); await beforeValidator(MANIFEST); expect(state.parseManifest).not.toHaveBeenCalled(); });
  it("rejects malformed manifest JSON before SQL enumeration or validation", async () => { file(MANIFEST, "not-json"); await beforeValidator(); expect(state.parseManifest).not.toHaveBeenCalled(); expect(state.readdir).not.toHaveBeenCalled(); });
  it.each([INPUT, MANIFEST])("rejects a symlinked public JSON file %s before reading it", async path => { entry(path).kind = "symlink"; await beforeValidator(path); });
  it.each(["dir", "fifo", "device"] as const)("rejects a non-regular worksheet kind %s before reading it", async kind => { entry(INPUT).kind = kind; await beforeValidator(INPUT); });
  it.each(["dir", "fifo", "device"] as const)("rejects a non-regular manifest kind %s before reading it", async kind => { entry(MANIFEST).kind = kind; await beforeValidator(MANIFEST); });
  it.each([[INPUT, 64 * 1024], [MANIFEST, 512 * 1024]] as const)("rejects oversized %s before its read", async (path, maximum) => { entry(path).size = maximum + 1; await beforeValidator(path); });
  it.each([INPUT, MANIFEST])("rejects empty stat size for %s before its read", async path => { entry(path).size = 0; await beforeValidator(path); });
  it.each([[INPUT, 64 * 1024], [MANIFEST, 512 * 1024]] as const)("rejects %s growing beyond its limit after stat", async (path, maximum) => { entry(path).size = 1; entry(path).bytes = Buffer.alloc(maximum + 1); await beforeValidator(); expect(state.readFile.mock.calls.map(call => call[0])).toContain(absolute(path)); });
  it.each([INPUT, MANIFEST])("rejects %s becoming empty after stat", async path => { entry(path).size = 1; entry(path).bytes = Buffer.alloc(0); await beforeValidator(); });
  it.each([INPUT, MANIFEST])("rejects a regular public file whose canonical target is aliased: %s", async path => { entry(path).alias = absolute("../../private/input.json"); await beforeValidator(path); });
  it.each(["docs", "docs/verification", PREFIX, "supabase"])("rejects an aliased input ancestor %s before following it", async path => { entry(path).alias = absolute("../../private/input-parent"); await beforeValidator(path.startsWith("docs") ? INPUT : MANIFEST); });
  it.each(["symlink", "file", "fifo", "device"] as const)("rejects an invalid canonical root kind %s before reading input", async kind => { entry(".").kind = kind; await beforeValidator(INPUT); });
  it("accepts exactly the inclusive JSON limits", async () => { padJson(INPUT, 64 * 1024); padJson(MANIFEST, 512 * 1024); await runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW); expect(state.build).toHaveBeenCalledOnce(); });
});

describe("fixed migration inventory before the existing validator", () => {
  it.each(["symlink", "file", "fifo", "device"] as const)("refuses a migration directory kind %s before enumeration", async kind => { entry(MIGRATIONS).kind = kind; await beforeValidator(); expect(state.readdir).not.toHaveBeenCalled(); });
  it("refuses a canonical migration-directory alias before enumeration", async () => { entry(MIGRATIONS).alias = absolute("../../private/sql"); await beforeValidator(); expect(state.readdir).not.toHaveBeenCalled(); });
  it.each([LEGACY, REVIEWED])("refuses symlinked migration %s before its data read or validator", async path => { entry(path).kind = "symlink"; await beforeValidator(path); });
  it.each(["dir", "fifo", "device"] as const)("refuses a non-regular SQL kind %s before its data read", async kind => { entry(REVIEWED).kind = kind; await beforeValidator(REVIEWED); });
  it.each(["empty", "oversized", "alias"])("refuses %s SQL before its data read", async kind => { if (kind === "empty") entry(REVIEWED).size = 0; if (kind === "oversized") entry(REVIEWED).size = 2 * 1024 * 1024 + 1; if (kind === "alias") entry(REVIEWED).alias = absolute("../../private/roles.sql"); await beforeValidator(REVIEWED); });
  it("refuses SQL growing after stat before invoking the existing validator", async () => { entry(REVIEWED).size = 1; entry(REVIEWED).bytes = Buffer.alloc(2 * 1024 * 1024 + 1); await beforeValidator(); });
  it("refuses SQL becoming empty after stat before invoking the existing validator", async () => { entry(REVIEWED).size = 1; entry(REVIEWED).bytes = Buffer.alloc(0); await beforeValidator(); });
  it.each(["ordinary.sql", "00001_bad.sql", "2026111400000_bad.sql", "20261114000000_Upper.sql", "20261114000000_bad-name.sql", "../private.sql", "0001_private/other.sql", ".sql"])("refuses unclosed SQL filename %s before reading it", async name => { state.names.push(name); await beforeValidator(`${MIGRATIONS}/${name}`); });
  it.each(["empty", "121-sql", "257-entries"])("bounds directory inventory %s before reading SQL", async mode => {
    state.names = mode === "empty" ? [".gitkeep"] : mode === "121-sql" ? Array.from({ length: 121 }, (_, index) => `${String(index).padStart(4, "0")}_fixture.sql`) : Array.from({ length: 257 }, (_, index) => `note-${index}`);
    await beforeValidator(); expect(state.readFile.mock.calls.map(call => call[0]).filter(path => String(path).startsWith(absolute(MIGRATIONS)))).toEqual([]);
  });
  it("accepts all 120 SQL files plus 136 other entries and the inclusive 2MiB source limit", async () => {
    state.names = Array.from({ length: 120 }, (_, index) => `${String(index).padStart(4, "0")}_fixture.sql`);
    for (const name of state.names) file(`${MIGRATIONS}/${name}`, "-- public bounded SQL fixture\n");
    file(`${MIGRATIONS}/${state.names[0]}`, Buffer.alloc(2 * 1024 * 1024, 32)); state.names.push(...Array.from({ length: 136 }, (_, index) => `note-${index}`));
    await runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW);
    expect(state.events.slice(0, state.events.indexOf("validate-manifest")).filter(event => event.startsWith(`read:${absolute(MIGRATIONS)}`))).toHaveLength(120);
  });
  it("retains the existing validator as a mandatory gate after safe reads", async () => {
    state.validateManifest.mockResolvedValue(["mock checksum drift"]); await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow();
    expect(state.validateManifest).toHaveBeenCalledOnce(); expect(state.command).not.toHaveBeenCalled(); expect(state.build).not.toHaveBeenCalled(); noOutput();
  });
});

describe("quiet ancestry and exclusive output boundaries", () => {
  it.each([{ code: 1, stdout: "", stderr: "" }, { code: 128, stdout: "", stderr: "" }, { code: 0, stdout: "unexpected", stderr: "" }, { code: 0, stdout: "", stderr: "unexpected" }, { code: 0, stdout: "\n", stderr: "" }])("refuses nonquiet or failed Git ancestry %j before builder or writes", async value => {
    state.command.mockResolvedValue(value); await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow(); expect(state.build).not.toHaveBeenCalled(); noOutput();
  });
  it("refuses a Git command exception without invoking a builder or write", async () => { state.command.mockRejectedValue(new Error("Mock Git unavailable")); await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow(); expect(state.build).not.toHaveBeenCalled(); noOutput(); });
  it("does not create a directory or write an output when the pure builder refuses the worksheet", async () => { state.build.mockImplementation(() => { throw new Error("Mock pure worksheet refusal"); }); await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow(); noOutput(); });
  it("keeps existing output bytes unchanged through exclusive wx creation", async () => {
    file(OUTPUT, "existing public result bytes\n"); await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow("exclusive");
    expect(entry(OUTPUT).bytes!.toString()).toBe("existing public result bytes\n"); expect(state.writeFile.mock.calls[0]![2]).toEqual({ flag: "wx" });
  });
  it.each(["dir", "symlink", "fifo", "device"] as const)("does not overwrite an existing output entry kind %s", async kind => {
    state.entries.set(absolute(OUTPUT), { kind }); await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow("exclusive"); expect(entry(OUTPUT).kind).toBe(kind);
  });
  it.each(["parent-alias", "directory-alias", "directory-symlink", "directory-file", "directory-fifo", "directory-device"])("rejects output directory changes after building: %s", async mode => {
    const directory = dirname(absolute(OUTPUT)), parent = dirname(directory);
    state.onBuild = () => { if (mode === "parent-alias") state.entries.get(parent)!.alias = absolute("../../private/out");
      else if (mode === "directory-alias") state.entries.get(directory)!.alias = absolute("../../private/out");
      else state.entries.get(directory)!.kind = mode.slice("directory-".length) as Entry["kind"]; };
    await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow(); noOutput();
  });
  it("creates a missing output directory only after rechecking its canonical parent and checks the new directory before writing", async () => {
    const directory = dirname(absolute(OUTPUT)); state.onBuild = () => { state.entries.delete(directory); };
    await runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW);
    expect(state.mkdir).toHaveBeenCalledWith(directory, { recursive: true });
    const made = state.events.indexOf("mkdir-output"), written = state.events.indexOf(`write:${absolute(OUTPUT)}`);
    expect(state.events.slice(made + 1, written)).toContain(`canonical:${directory}`); expect(entry(OUTPUT).kind).toBe("file");
  });
  it.each(["directory-alias", "directory-symlink", "parent-alias"])("rejects a post-mkdir boundary mutation %s before writing", async mode => {
    const directory = dirname(absolute(OUTPUT)); state.onBuild = () => { state.entries.delete(directory); };
    state.onMkdir = () => { if (mode === "parent-alias") state.entries.get(dirname(directory))!.alias = absolute("../../private/out");
      else if (mode === "directory-alias") state.entries.get(directory)!.alias = absolute("../../private/out"); else state.entries.get(directory)!.kind = "symlink"; };
    await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, OUTPUT, NOW)).rejects.toThrow(); expect(state.mkdir).toHaveBeenCalledOnce(); expect(state.writeFile).not.toHaveBeenCalled();
  });
  it("writes distinct labelled plans for repeated preparation without clobbering the earlier artifact", async () => {
    const first = `${PREFIX}/plan-${SUBJECT}-owner-review1.json`, second = `${PREFIX}/plan-${SUBJECT}-owner-review2.json`;
    await runPhase3RehearsalPlanCli(ROOT, INPUT, first, NOW); const original = entry(first).bytes!.toString();
    await runDeltaCli(["rehearsal-plan", "--input", INPUT, "--output", second], {}, ROOT);
    expect(entry(first).bytes!.toString()).toBe(original); expect(JSON.parse(entry(second).bytes!.toString())).toEqual(fakePlan);
    expect(state.writeFile.mock.calls.map(call => call[0])).toEqual([first, second].map(absolute));
    await expect(runPhase3RehearsalPlanCli(ROOT, INPUT, first, NOW)).rejects.toThrow("exclusive"); expect(entry(first).bytes!.toString()).toBe(original);
  });
  it("keeps the optional output label bounded to lower-case metadata while preserving subject identity", () => {
    expect(rehearsalPreflightPaths(INPUT, OUTPUT)).toBe(SUBJECT);
    expect(rehearsalPreflightPaths(INPUT, `${PREFIX}/plan-${SUBJECT}-${"a".repeat(32)}.json`)).toBe(SUBJECT);
    expect(() => rehearsalPreflightPaths(INPUT, `${PREFIX}/plan-${SUBJECT}-${"a".repeat(33)}.json`)).toThrow();
  });
});
