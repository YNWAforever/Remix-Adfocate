// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDeltaCliArguments, runDeltaCli, runDeltaCliMain } from "./delta-cli";
import { DeltaExecutionFailure, deltaGateReportSetHash, type DeltaExecuteDeps, type DeltaExecuteInput, type DeltaExecutionReport } from "./delta-executor";
import { digestDeltaEvidence } from "./delta-evidence";
import { makeDeltaReleaseFixture, DELTA_FIXTURE_NOW as NOW, deltaFixtureHash as h } from "./delta-release.fixture";

const boundaries = vi.hoisted(() => ({ artifactPath: "", bytes: Buffer.alloc(0), isFile: true, symlink: false, size: undefined as number | undefined,
  outputPath: "", outputDirectory: "", directorySymlink: false, outputExists: false, written: "", mkdir: vi.fn(), writeFile: vi.fn(),
  execute: vi.fn(), actualExecute: undefined as undefined | ((input: DeltaExecuteInput, deps: DeltaExecuteDeps) => Promise<DeltaExecutionReport>),
  native: vi.fn(), github: vi.fn(), provenance: vi.fn<typeof import("./delta-provenance")["verifyDeltaProvenance"]>(),
  proofs: vi.fn<typeof import("./delta-providers.reports")["resolveOwnerAcceptedDeltaReports"]>(), compile: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: boundaries.spawn }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual,
    mkdir: boundaries.mkdir, writeFile: boundaries.writeFile,
    realpath: vi.fn(async (path: string) => path === boundaries.artifactPath || path === boundaries.outputDirectory ? path : actual.realpath(path)),
    lstat: vi.fn(async (path: string) => path === boundaries.artifactPath ? { isFile: () => boundaries.isFile, isSymbolicLink: () => boundaries.symlink,
      isDirectory: (): boolean => false, size: boundaries.size ?? boundaries.bytes.length } : path === boundaries.outputDirectory
      ? { isFile: (): boolean => false, isSymbolicLink: () => boundaries.directorySymlink, isDirectory: (): boolean => true, size: 0 } : actual.lstat(path)),
    readFile: vi.fn(async (path: string, encoding?: BufferEncoding) => path === boundaries.artifactPath
      ? encoding ? boundaries.bytes.toString(encoding) : Buffer.from(boundaries.bytes) : actual.readFile(path, encoding)),
  };
});
vi.mock("./delta-native", () => ({ createManagedDeltaDatabase: boundaries.native }));
vi.mock("./delta-providers.github", () => ({ createGitHubDeltaReaders: boundaries.github }));
vi.mock("./delta-providers.reports", () => ({ committedDeltaProofReader: () => vi.fn(), resolveOwnerAcceptedDeltaReports: boundaries.proofs }));
vi.mock("./delta-program", async importOriginal => ({ ...await importOriginal<typeof import("./delta-program")>(), compileDeltaProgram: boundaries.compile }));
vi.mock("./delta-provenance", async importOriginal => ({ ...await importOriginal<typeof import("./delta-provenance")>(),
  verifyEvidenceFilePath: async () => boundaries.artifactPath, verifyDeltaProvenance: boundaries.provenance }));
vi.mock("./delta-executor", async importOriginal => {
  const actual = await importOriginal<typeof import("./delta-executor")>(); boundaries.actualExecute = actual.executeBundledDelta;
  return { ...actual, executeBundledDelta: boundaries.execute };
});

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUNDLE = "docs/verification/releases/synthetic-cli.json", MH = "mhkoayftiuojxlrkollf";
const GH_TOKEN = "fixture-private-github-cli-value", VERCEL_TOKEN = "fixture-private-vercel-cli-value";
const PROTECTION_SECRET = "fixture-private-cli-deployment-protection-value";
const PRIVATE_URL = "postgresql://fixture-private-db-value@synthetic.invalid/postgres";
const originalExitCode = process.exitCode;
function fixture() {
  const { evidence, context } = makeDeltaReleaseFixture(); boundaries.artifactPath = resolve(ROOT, BUNDLE); boundaries.bytes = Buffer.from(JSON.stringify(evidence));
  const digest = digestDeltaEvidence(evidence), sourceCiHash = evidence.gates.find(gate => gate.gate === "source-ci")!.reportSha256;
  const policy = { schemaVersion: 1, context, sourceCiRunId: "1001", githubApproverId: "3001",
    proofAcceptance: { schemaVersion: 1, acceptedReportSetHash: deltaGateReportSetHash(evidence), acceptedByGitHubActorId: "3001", acceptanceReference: "synthetic-cli-review" },
    vercel: { projectId: "prj_fixtureAdfocate", teamId: "team_fixture" } };
  const env: NodeJS.ProcessEnv = { RELEASE_DELTA_POLICY_JSON: JSON.stringify(policy), RELEASE_PROJECT_REF: MH, RELEASE_DATABASE_URL: PRIVATE_URL,
    GITHUB_TOKEN: GH_TOKEN, VERCEL_TOKEN, GITHUB_SHA: h("cli-evidence-commit").slice(0, 40), GITHUB_RUN_ID: "2001", GITHUB_RUN_ATTEMPT: "1" };
  const db = { inspect: vi.fn(async () => ({ synthetic: true })), begin: vi.fn(), close: vi.fn(async () => undefined) };
  boundaries.native.mockResolvedValue(db); boundaries.github.mockReturnValue({ currentProductionDeployment: vi.fn() });
  boundaries.provenance.mockImplementation(async input => ({ schemaVersion: 1, kind: "verified-source-evidence-provenance",
    sourceCommit: context.sourceCommit, evidenceCommit: env.GITHUB_SHA!, approvedByGitHubActorId: "3001", protectedRunId: "2001", protectedRunAttempt: 1,
    artifactSha256: createHash("sha256").update(input.bundleBytes).digest("hex"), sourceCiReportHash: sourceCiHash,
    permittedDeploymentCommits: [context.sourceCommit, env.GITHUB_SHA!], reportSha256: h("synthetic-cli-provenance") }));
  boundaries.proofs.mockResolvedValue({ reportSetHash: deltaGateReportSetHash(evidence), sourceCiReportHash: sourceCiHash, deploymentCommit: context.sourceCommit, targetBindingHash: context.targetBindingHash });
  const args = (command: "verify" | "execute" = "verify", apply = false) => [command, "--bundle", BUNDLE, "--bundle-digest", digest, "--project-ref", MH,
    ...(apply ? ["--apply", "--approval", `APPROVE ${MH} ${digest}`] : [])];
  const receipt: DeltaExecutionReport = { schemaVersion: 1, kind: "protected-delta-execution-receipt", status: "applied", sourceCommit: context.sourceCommit,
    evidenceCommit: env.GITHUB_SHA!, evidenceDigest: digest, executionProgramSha256: context.executionProgramSha256, phaseBefore: "before",
    observedBeforeRoot: context.beforeRoot, observedAfterRoot: context.afterRoot, sqlExecutionAttempted: true, commitConfirmed: true, deltaChanged: true, migrationRowsAfter: 18, checkedAt: NOW.toISOString() };
  const useEnvironment = () => { for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value!); };
  return { evidence, context, policy, env, db, digest, args, receipt, useEnvironment };
}
beforeEach(() => {
  for (const value of [boundaries.execute, boundaries.native, boundaries.github, boundaries.provenance, boundaries.proofs, boundaries.compile, boundaries.spawn, boundaries.mkdir, boundaries.writeFile]) value.mockReset();
  boundaries.execute.mockImplementation(boundaries.actualExecute!); boundaries.spawn.mockImplementation(() => { throw new Error("real process forbidden in mock-only CLI tests"); });
  boundaries.isFile = true; boundaries.symlink = false; boundaries.size = undefined;
  boundaries.outputPath = ""; boundaries.outputDirectory = ""; boundaries.directorySymlink = false; boundaries.outputExists = false; boundaries.written = "";
  boundaries.mkdir.mockImplementation(() => { throw new Error("unexpected filesystem mutation forbidden"); });
  boundaries.writeFile.mockImplementation(() => { throw new Error("unexpected filesystem mutation forbidden"); });
  vi.useFakeTimers(); vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); process.exitCode = originalExitCode; });

describe("closed protected delta CLI argument surface", () => {
  it("requires an explicit command and keeps verify and ordinary execute in dry-run mode", () => {
    const f = fixture(); expect(parseDeltaCliArguments(["plan"])).toEqual({ command: "plan", approval: "", apply: false, bindings: undefined });
    for (const command of ["verify", "execute"] as const) expect(parseDeltaCliArguments(f.args(command)).apply).toBe(false);
    expect(parseDeltaCliArguments(f.args("execute", true))).toMatchObject({ command: "execute", apply: true, approval: `APPROVE ${MH} ${f.digest}` });
  });
  it("keeps review metadata in its public namespace with no apply or approval authority", () => {
    const subject = "a".repeat(40), input = `docs/verification/phase3-release-review/selection-${subject}.json`, output = `docs/verification/phase3-release-review/review-${subject}.json`;
    const args = ["review", "--input", input, "--output", output];
    expect(parseDeltaCliArguments(args)).toEqual({ command: "review", input, output, approval: "", apply: false });
    for (const extra of [["--apply"], ["--approval", "anything"], ["--bindings", "anything"], ["--bundle", BUNDLE], ["--project-ref", MH]]) expect(() => parseDeltaCliArguments([...args, ...extra])).toThrow();
    for (const path of ["../private.json", "C:/private.json", input.replace("selection-", "../selection-"), input.replace("phase3-release-review", "releases")]) expect(() => parseDeltaCliArguments(["review", "--input", path, "--output", output])).toThrow();
  });
  it.each([
    [], ["apply"], ["evidence"], ["evidence", "--apply"], ["plan", "--output", BUNDLE],
    ["evidence", "--input", "x", "--output", BUNDLE, "--bundle", BUNDLE], ["plan", "--apply"], ["verify", "--apply"], ["plan", "--sql", "arbitrary.sql"], ["plan", "--include-all"],
    ["plan", "--profile", "stock"], ["plan", "--bundle", BUNDLE], ["plan", "--bindings"], ["plan", "--bindings", "one", "--bindings", "two"],
  ].map(args => ({ args })))("rejects implicit command, arbitrary SQL, broad range or duplicate options", ({ args }) => { expect(() => parseDeltaCliArguments(args)).toThrow(); });
  it("rejects execution binding overrides, duplicate apply and wrong bundle/project selectors", () => {
    const f = fixture();
    for (const args of [[...f.args(), "--bindings", "file"], [...f.args("execute", true), "--apply"], [...f.args(), "--bundle", BUNDLE],
      f.args().map(value => value === MH ? "otherproject" : value), f.args().map(value => value === f.digest ? "short" : value),
      f.args().map(value => value === BUNDLE ? "docs/verification/releases/../private.json" : value)]) expect(() => parseDeltaCliArguments(args)).toThrow();
  });
});

describe("offline preparation and execution preconditions (all provider/process boundaries mocked)", () => {
  it("checks the actual public 67-source manifest but returns an offline HOLD with no provider or database construction", async () => {
    fixture(); const result = await runDeltaCli(["plan"], {}, ROOT);
    expect(result).toMatchObject({ kind: "protected-delta-offline-plan", status: "HOLD", validReleaseEvidence: false, sourceCount: 67, sourceSqlExecutionAttempted: false });
    for (const mock of [boundaries.execute, boundaries.native, boundaries.github, boundaries.provenance, boundaries.proofs, boundaries.spawn]) expect(mock).not.toHaveBeenCalled();
  });
  it("passes verify as dry-run and permits apply only on explicit execute", async () => {
    const f = fixture(); boundaries.execute.mockResolvedValue(f.receipt);
    await runDeltaCli(f.args("verify"), f.env, ROOT); expect(boundaries.execute.mock.calls.at(-1)![0].apply).toBe(false);
    await runDeltaCli(f.args("execute"), f.env, ROOT); expect(boundaries.execute.mock.calls.at(-1)![0].apply).toBe(false);
    await runDeltaCli(f.args("execute", true), f.env, ROOT); expect(boundaries.execute.mock.calls.at(-1)![0]).toMatchObject({ apply: true, approval: `APPROVE ${MH} ${f.digest}` });
    expect(boundaries.native).not.toHaveBeenCalled(); expect(boundaries.spawn).not.toHaveBeenCalled();
  });
  it.each([{ label: "unset", value: undefined }, { label: "empty", value: "" }, { label: "configured", value: PROTECTION_SECRET }])("passes optional deployment protection from protected environment only: $label", async ({ value }) => {
    const f = fixture(); f.env.VERCEL_AUTOMATION_BYPASS_SECRET = value; boundaries.execute.mockResolvedValue(f.receipt);
    await runDeltaCli(f.args("verify"), f.env, ROOT);
    const readerOptions = boundaries.github.mock.calls[0]![0];
    expect(readerOptions.deploymentProtectionSecret).toBe(value || undefined);
    expect(Object.hasOwn(readerOptions, "deploymentProtectionSecret")).toBe(Boolean(value));
    expect(JSON.stringify(f.policy)).not.toContain(PROTECTION_SECRET); expect(boundaries.bytes.toString()).not.toContain(PROTECTION_SECRET);
    expect(JSON.stringify(readerOptions.vercel)).not.toContain(PROTECTION_SECRET); expect(boundaries.native).not.toHaveBeenCalled();
  });
  it.each(["policy", "bundle"])("rejects deployment protection credentials placed in %s metadata", async location => {
    const f = fixture();
    if (location === "policy") f.env.RELEASE_DELTA_POLICY_JSON = JSON.stringify({ ...f.policy, deploymentProtectionSecret: PROTECTION_SECRET });
    else boundaries.bytes = Buffer.from(JSON.stringify({ ...f.evidence, deploymentProtectionSecret: PROTECTION_SECRET }));
    await expect(runDeltaCli(f.args(), f.env, ROOT)).rejects.toThrow(); expect(boundaries.github).not.toHaveBeenCalled(); expect(boundaries.native).not.toHaveBeenCalled();
  });
  it("does not accept a deployment-protection credential as a command-line argument", () => {
    const f = fixture(); expect(() => parseDeltaCliArguments([...f.args(), "--deployment-protection-secret", PROTECTION_SECRET])).toThrow("unknown or duplicate");
  });
  it("uses the actual controller to refuse missing exact approval before provenance or database access", async () => {
    const f = fixture(); const args = f.args("execute", true); args[args.length - 1] = "APPROVE without exact digest";
    await expect(runDeltaCli(args, f.env, ROOT)).rejects.toThrow("exact production approval"); expect(boundaries.provenance).not.toHaveBeenCalled(); expect(boundaries.native).not.toHaveBeenCalled();
  });
  it("uses the actual controller to refuse stale evidence and mismatched outer digests before source access", async () => {
    const f = fixture(); vi.setSystemTime(new Date(NOW.valueOf() + 3600_000)); await expect(runDeltaCli(f.args(), f.env, ROOT)).rejects.toThrow("freshness/binding");
    vi.setSystemTime(NOW); const args = f.args(); args[args.indexOf("--bundle-digest") + 1] = h("unapproved-outer"); await expect(runDeltaCli(args, f.env, ROOT)).rejects.toThrow("outer bundle digest");
    expect(boundaries.provenance).not.toHaveBeenCalled(); expect(boundaries.native).not.toHaveBeenCalled();
  });
  it("refuses missing independent policy, wrong project or historical HOLD/v1 artifacts without constructing an adapter", async () => {
    const missing = fixture(); delete missing.env.RELEASE_DELTA_POLICY_JSON; await expect(runDeltaCli(missing.args(), missing.env, ROOT)).rejects.toThrow("policy unavailable");
    const project = fixture(); project.env.RELEASE_PROJECT_REF = "other"; await expect(runDeltaCli(project.args(), project.env, ROOT)).rejects.toThrow("protected project");
    for (const value of [project.evidence.core, { decision: "HOLD", validReleaseEvidence: false }, { status: "AUTH_NOT_TESTED" }]) {
      boundaries.bytes = Buffer.from(JSON.stringify(value)); await expect(runDeltaCli(project.args(), project.env, ROOT)).rejects.toThrow("strict v2 evidence");
    }
    expect(boundaries.native).not.toHaveBeenCalled(); expect(boundaries.execute).not.toHaveBeenCalled();
  });
  it("keeps the database factory lazy through actual-controller provenance and report failures", async () => {
    const f = fixture(); boundaries.provenance.mockRejectedValueOnce(new Error("synthetic provenance refused"));
    await expect(runDeltaCli(f.args(), f.env, ROOT)).rejects.toThrow("provenance refused"); expect(boundaries.proofs).not.toHaveBeenCalled(); expect(boundaries.native).not.toHaveBeenCalled();
    boundaries.proofs.mockRejectedValueOnce(new Error("synthetic report refused"));
    await expect(runDeltaCli(f.args(), f.env, ROOT)).rejects.toThrow("report refused"); expect(boundaries.native).not.toHaveBeenCalled();
  });
  it.each(["symlink", "not-file", "empty", "oversized", "grew", "malformed"])("rejects a %s artifact before provider construction", async kind => {
    const f = fixture();
    if (kind === "symlink") boundaries.symlink = true; if (kind === "not-file") boundaries.isFile = false;
    if (kind === "empty") boundaries.size = 0; if (kind === "oversized") boundaries.size = 8 * 1024 * 1024 + 1;
    if (kind === "grew") { boundaries.size = 1; boundaries.bytes = Buffer.alloc(8 * 1024 * 1024 + 1); }
    if (kind === "malformed") boundaries.bytes = Buffer.from("not-json-private-value");
    await expect(runDeltaCli(f.args(), f.env, ROOT)).rejects.toThrow(); expect(boundaries.github).not.toHaveBeenCalled(); expect(boundaries.native).not.toHaveBeenCalled();
  });
});

function builderFixture() {
  const f = fixture(); const { contentDigest: ignoredDigest, ...body } = f.evidence; void ignoredDigest;
  boundaries.bytes = Buffer.from(JSON.stringify({ context: f.context, evidence: body }));
  const relativeOutput = "docs/verification/releases/synthetic-built-cli.json";
  boundaries.outputPath = resolve(ROOT, relativeOutput); boundaries.outputDirectory = dirname(boundaries.outputPath);
  boundaries.mkdir.mockResolvedValue(undefined);
  boundaries.writeFile.mockImplementation(async (path: string, content: string, options: { encoding: string; flag: string }) => {
    expect(path).toBe(boundaries.outputPath); expect(options).toEqual({ encoding: "utf8", flag: "wx" });
    if (boundaries.outputExists) throw Object.assign(new Error("synthetic existing output"), { code: "EEXIST" });
    boundaries.written = content; boundaries.outputExists = true;
  });
  return { ...f, builderArgs: ["evidence", "--input", boundaries.artifactPath, "--output", relativeOutput] };
}
describe("offline v2 evidence builder with an entirely mocked output filesystem", () => {
  it("writes exact fresh v2 bytes exclusively and returns only structural HOLD preparation", async () => {
    const f = builderFixture(); const result = await runDeltaCli(f.builderArgs, {}, ROOT);
    expect(result).toMatchObject({ kind: "protected-delta-evidence-preparation", status: "HOLD", validReleaseEvidence: false, evidenceDigest: f.digest, sourceSqlExecutionAttempted: false });
    expect(JSON.parse(boundaries.written)).toEqual(f.evidence); expect(boundaries.written.endsWith("\n")).toBe(true);
    expect(boundaries.writeFile).toHaveBeenCalledOnce();
    for (const mock of [boundaries.execute, boundaries.native, boundaries.github, boundaries.provenance, boundaries.spawn]) expect(mock).not.toHaveBeenCalled();
  });
  it.each(["unknown", "stale"])("rejects %s builder input before filesystem mutation", async kind => {
    const f = builderFixture();
    if (kind === "unknown") boundaries.bytes = Buffer.from(JSON.stringify({ ...JSON.parse(boundaries.bytes.toString()), sql: "unreviewed" }));
    else vi.setSystemTime(new Date(NOW.valueOf() + 3600_000));
    await expect(runDeltaCli(f.builderArgs, {}, ROOT)).rejects.toThrow();
    expect(boundaries.mkdir).not.toHaveBeenCalled(); expect(boundaries.writeFile).not.toHaveBeenCalled(); expect(boundaries.native).not.toHaveBeenCalled();
  });
  it("preserves an existing artifact and uses exclusive UTF8 creation rather than overwrite", async () => {
    const f = builderFixture(); boundaries.outputExists = true; boundaries.written = "existing synthetic bytes";
    await expect(runDeltaCli(f.builderArgs, {}, ROOT)).rejects.toThrow("existing output"); expect(boundaries.written).toBe("existing synthetic bytes");
    expect(boundaries.writeFile.mock.calls[0]![2]).toEqual({ encoding: "utf8", flag: "wx" });
  });
  it("rejects a symlink output ancestor before even calling mkdir", async () => {
    const f = builderFixture(); boundaries.directorySymlink = true; await expect(runDeltaCli(f.builderArgs, {}, ROOT)).rejects.toThrow("directory symlink");
    expect(boundaries.mkdir).not.toHaveBeenCalled(); expect(boundaries.writeFile).not.toHaveBeenCalled();
  });
  it("forbids builder input/output flags on verify and execute", () => {
    const f = fixture();
    for (const command of ["verify", "execute"] as const) for (const flag of ["--input", "--output"])
      expect(() => parseDeltaCliArguments([...f.args(command), flag, BUNDLE])).toThrow("cannot override");
  });
  it("checks the original plan-bindings path and refuses a symlink before compiling", async () => {
    fixture(); boundaries.symlink = true; await expect(runDeltaCli(["plan", "--bindings", boundaries.artifactPath], {}, ROOT)).rejects.toThrow("bounded JSON");
    expect(boundaries.compile).not.toHaveBeenCalled(); expect(boundaries.native).not.toHaveBeenCalled();
  });
});

describe("managed cleanup cannot erase the controller's commit outcome", () => {
  it("preserves a committed result as committed when client cleanup cannot be acknowledged", async () => {
    const f = fixture(); f.db.close.mockRejectedValue(new Error("synthetic cleanup failure"));
    boundaries.execute.mockImplementation(async (_input, deps: DeltaExecuteDeps) => { await deps.inspect(); return f.receipt; });
    await expect(runDeltaCli(f.args("execute", true), f.env, ROOT)).rejects.toMatchObject({ code: "managed-client-cleanup-unverified",
      outcome: { sqlExecutionAttempted: true, commitAttempted: true, commitConfirmed: true, rollbackAcknowledged: false, containmentRequired: true } });
    expect(f.db.close).toHaveBeenCalledOnce(); expect(boundaries.native).toHaveBeenCalledOnce();
  });
  it.each([
    { sqlExecutionAttempted: true, commitAttempted: true, commitConfirmed: false, rollbackAcknowledged: false, containmentRequired: true },
    { sqlExecutionAttempted: true, commitAttempted: false, commitConfirmed: false, rollbackAcknowledged: true, containmentRequired: false },
  ])("preserves an uncertain or rolled-back write outcome across cleanup failure", async outcome => {
    const f = fixture(); f.db.close.mockRejectedValue(new Error("synthetic cleanup failure"));
    boundaries.execute.mockImplementation(async (_input, deps: DeltaExecuteDeps) => { await deps.inspect(); throw new DeltaExecutionFailure("original-stage", outcome); });
    await expect(runDeltaCli(f.args("execute", true), f.env, ROOT)).rejects.toMatchObject({ code: "managed-client-cleanup-unverified", outcome: { ...outcome, containmentRequired: true } });
  });
  it("preserves the original controller failure when cleanup succeeds", async () => {
    const f = fixture(); const failure = new DeltaExecutionFailure("original-stage", { sqlExecutionAttempted: true, commitAttempted: true, commitConfirmed: false, rollbackAcknowledged: false, containmentRequired: true });
    boundaries.execute.mockImplementation(async (_input, deps: DeltaExecuteDeps) => { await deps.inspect(); throw failure; });
    await expect(runDeltaCli(f.args("execute", true), f.env, ROOT)).rejects.toBe(failure); expect(f.db.close).toHaveBeenCalledOnce();
  });
  it("prints a bounded HOLD receipt retaining commit-confirmed state and no private inputs", async () => {
    const f = fixture(); f.useEnvironment(); f.db.close.mockRejectedValue(new Error(PRIVATE_URL));
    boundaries.execute.mockImplementation(async (_input, deps: DeltaExecuteDeps) => { await deps.inspect(); return f.receipt; });
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined); await runDeltaCliMain(f.args("execute", true));
    expect(output).toHaveBeenCalledOnce(); const text = String(output.mock.calls[0]![0]); const value = JSON.parse(text);
    expect(value).toMatchObject({ status: "HOLD", validReleaseEvidence: false, reasonCode: "managed-client-cleanup-unverified", outcome: { commitConfirmed: true, containmentRequired: true } });
    for (const privateValue of [PRIVATE_URL, GH_TOKEN, VERCEL_TOKEN]) expect(text).not.toContain(privateValue); expect(process.exitCode).toBe(1);
  });
});

describe("fixed offline TypeScript bootstrap", () => {
  it("pins vite-node's matching Vite runtime and disables app configuration, dotenv, plugins, watchers and listening", async () => {
    const source = await readFile(resolve(ROOT, "scripts/release/delta-runner.mjs"), "utf8");
    expect(source).toContain('createRequire(require.resolve("vite-node/package.json"))');
    expect(source).toContain('nodeRequire.resolve("vite/package.json")'); expect(source).toContain('new URL("./delta-cli.ts", import.meta.url)');
    for (const required of ["configFile: false", "envFile: false", "plugins: []", "middlewareMode: true", "hmr: false", "watch: null"]) expect(source).toContain(required);
    expect(source).not.toMatch(/\.listen\s*\(/); expect(source).not.toMatch(/(?:dotenv|router-plugin)["']/); expect(boundaries.spawn).not.toHaveBeenCalled();
  });
});
