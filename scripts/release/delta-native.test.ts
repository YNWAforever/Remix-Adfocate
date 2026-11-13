// @vitest-environment node
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagedDeltaDatabase, describeProtectedDeltaRoute, protectedDeltaTargetBinding, DELTA_CA_SHA256, DELTA_CLIENT_IMAGE, type ManagedDeltaDatabaseDeps } from "./delta-native";
import { DELTA_DUMP_RESTRICT_KEY } from "./delta-fingerprint";
import { DELTA_EXPORT_COMPONENTS, type DeltaExpectedContext } from "./delta-release-contracts";
import { bindDeltaExecutionContext, type CompiledDeltaProgram } from "./delta-program";
import { makeDeltaReleaseFixture, DELTA_FIXTURE_NOW as NOW, deltaFixtureHash as h } from "./delta-release.fixture";
import type { FramedPsqlSession } from "./delta-psql-session";
import type { PairedRecoveryContext } from "./delta-recovery";

const processBoundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: processBoundary.spawn }));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MH = "mhkoayftiuojxlrkollf", SECRET = "fixture-private-password-never-report";
const URL_VALUE = `postgresql://postgres.${MH}:${SECRET}@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const DIRECT = `postgresql://postgres:${SECRET}@db.${MH}.supabase.co:5432/postgres`;
const CA = resolve(ROOT, "scripts/integrations/certs/supabase-prod-ca-2021.crt");
const LABEL = "com.adfocate.protected-delta-client";
const IMAGE_ID = `sha256:${h("synthetic-client-image")}`;
const TMPFS = ["/tmp", "/var/lib/postgresql", "/var/lib/postgresql/data"];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const lf = (value: string) => value.replace(/\r\n?/g, "\n");
type Row = Record<string, unknown>;
function set(value: unknown, path: string, replacement: unknown) {
  const parts = path.split("."); let current = value as Row;
  for (const part of parts.slice(0, -1)) current = current[part] as Row;
  current[parts.at(-1)!] = replacement;
}
const dumpSql = `-- PostgreSQL database dump\n-- Dumped from database version 17.6\n-- Dumped by pg_dump version 17.11\n\\restrict ${DELTA_DUMP_RESTRICT_KEY}\nCREATE DATABASE "postgres" WITH TEMPLATE = template0;\n\\unrestrict ${DELTA_DUMP_RESTRICT_KEY}\n\\connect postgres\n\\restrict ${DELTA_DUMP_RESTRICT_KEY}\nCREATE TABLE "public"."synthetic_only" ("id" integer);\n-- PostgreSQL database dump complete\n\\unrestrict ${DELTA_DUMP_RESTRICT_KEY}\n`;
class DumpChild extends EventEmitter {
  constructor(private readonly acknowledgeClose = true) { super(); }
  readonly stdout = new PassThrough(); readonly stderr = new PassThrough();
  readonly inputs: Buffer[] = []; readonly inputReferences: Buffer[] = [];
  readonly stdin = new Writable({ write: (chunk: Buffer, _encoding, done) => {
    this.inputs.push(Buffer.from(chunk)); this.inputReferences.push(chunk); done();
    if (this.acknowledgeClose) queueMicrotask(() => { this.stdout.write(dumpSql); this.emit("close", 0); });
  } });
  readonly kill = vi.fn(() => { if (this.acknowledgeClose) queueMicrotask(() => this.emit("close", 1)); return this.acknowledgeClose; });
}
function collection(context: DeltaExpectedContext) {
  return { schemaVersion: 1, kind: "delta-semantic-components", serverVersionNum: "170006", databaseName: "postgres", transactionReadOnly: true,
    isolationLevel: "repeatable read", extensionProfileHash: context.extensionProfileHash, unsupported: [],
    components: DELTA_EXPORT_COMPONENTS.filter(category => category !== "schema-export").map(category => ({ category, coverage: "complete", objectCount: 1, sha256: h(`synthetic/${category}`) })) };
}
async function fixture() {
  // Public checked-in code and certificate only; never a database or private artifact.
  const { context: original, evidence } = makeDeltaReleaseFixture();
  const collector = lf(await readFile(resolve(ROOT, "scripts/release/delta-semantic-capture.sql"), "utf8"));
  const canonicalizer = lf(await readFile(resolve(ROOT, "scripts/release/delta-fingerprint.ts"), "utf8"));
  const invariantSql = lf(await readFile(resolve(ROOT, "scripts/release/delta-invariant-capture.sql"), "utf8"));
  const context: DeltaExpectedContext = { ...original, targetBindingHash: protectedDeltaTargetBinding(describeProtectedDeltaRoute(URL_VALUE)),
    collectorSha256: sha(collector), canonicalizerSha256: sha(canonicalizer), invariantCollectorSha256: sha(invariantSql) };
  const program: CompiledDeltaProgram = { plan: evidence.plan, planDigest: context.planDigest, requiredCapabilities: [],
    deferredObjects: { "20261103215321": [], "20261104134202": [] }, sessionLockSql: "SELECT pg_advisory_lock(42);",
    beginSql: "BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE;", lockSql: "SELECT pg_advisory_xact_lock(43);",
    expiryGuardSql: "SELECT 'synthetic-clock-guard';", applyDoSql: "DO $$BEGIN NULL; END$$;", invariantSql,
    executionProgramSha256: context.executionProgramSha256 };
  const bindings = { expiresAt: new Date(NOW.valueOf() + 60_000).toISOString(), evidenceDigest: h("native-approved-evidence"),
    programSha256: program.executionProgramSha256, scopeDigest: context.scopeDigest };
  const resources = new Map<string, { nonce: string; args: string[] }>(); const removed: string[] = [], events: string[] = [];
  let inspectMutation: ((metadata: Row) => void) | undefined, queryFailure: string | undefined, openFailure = false;
  let createdOutput: string | undefined, semanticDrift = false, semanticReads = 0;
  const sessions: FramedPsqlSession[] = [], initialCopies: Buffer[] = [], initialReferences: Buffer[] = [], children: DumpChild[] = [];
  const metadata = { database: "postgres", role: "postgres", sessionRole: "postgres", serverVersionNum: "170006", isolationLevel: "repeatable read", readOnly: "on",
    history: Array.from({ length: 17 }, (_, index) => ({ version: `20260101${String(index + 1).padStart(6, "0")}`, name: null, statementCount: 0, statementsSha256: null })) };
  const run = vi.fn<ManagedDeltaDatabaseDeps["run"]>(async (file, suppliedArgs, options) => {
    expect(file).toBe("docker");
    expect(suppliedArgs.slice(0, 2)).toEqual(["--host", process.platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock"]);
    expect(options?.env).toBeDefined();
    for (const key of ["RELEASE_DATABASE_URL", "PGPASSWORD", "GITHUB_TOKEN", "VERCEL_TOKEN", "DOCKER_HOST", "DOCKER_CONTEXT"]) expect(options!.env).not.toHaveProperty(key);
    const args = suppliedArgs.slice(2);
    expect(JSON.stringify(args)).not.toContain(SECRET); expect(JSON.stringify(args)).not.toContain(URL_VALUE);
    let stdout: string;
    if (args[0] === "image" && args[1] === "inspect") stdout = JSON.stringify([{ Id: IMAGE_ID, RepoDigests: [DELTA_CLIENT_IMAGE], Config: { Volumes: { "/var/lib/postgresql/data": {} } } }]);
    else if (args[0] === "create") {
      const id = h(`synthetic-resource-${resources.size}`), label = args[args.indexOf("--label") + 1]!;
      resources.set(id, { nonce: label.slice(`${LABEL}=`.length), args: [...args] }); events.push(`create:${id}`); stdout = createdOutput ?? id;
    } else if (args[0] === "inspect") {
      const id = args[1]!, resource = resources.get(id)!;
      const value: Row = { Id: id, Name: `/adfocate-delta-client-${resource.nonce}`, Image: IMAGE_ID,
        Config: { Image: DELTA_CLIENT_IMAGE, User: "postgres", Labels: { [LABEL]: resource.nonce },
          Env: resource.args.flatMap((value, index) => value === "--env" ? [resource.args[index + 1]!] : []) },
        HostConfig: { NetworkMode: "bridge", ReadonlyRootfs: true, Privileged: false, LogConfig: { Type: "none" }, CapDrop: ["ALL"], CapAdd: null,
          SecurityOpt: ["no-new-privileges"], Binds: null, PortBindings: null, PublishAllPorts: false, PidsLimit: 64, Memory: 1073741824, NanoCpus: 1000000000,
          VolumesFrom: null, Tmpfs: Object.fromEntries(TMPFS.map(path => [path, "rw,noexec,nosuid,nodev,size=16m,mode=1777"])) },
        Mounts: [{ Type: "bind", Source: CA, Destination: "/tls/supabase-root.crt", RW: false }, ...TMPFS.map(Destination => ({ Type: "tmpfs", Destination, RW: true }))] };
      inspectMutation?.(value); stdout = JSON.stringify([value]); events.push(`inspect:${id}`);
    } else if (args[0] === "rm") { removed.push(args[2]!); events.push(`remove:${args[2]}`); stdout = ""; }
    else throw new Error("unreviewed synthetic docker command");
    return { code: 0, stdout, stderr: "" };
  });
  const query = vi.fn(async (sql: string): Promise<readonly string[]> => {
    events.push(`query:${sql}`); if (sql === queryFailure) throw new Error("synthetic query failure");
    if (sql.includes("pg_export_snapshot")) return [JSON.stringify({ snapshot: "00000003-0000001B-1", backendPid: 123 })];
    if (sql === collector) {
      const result = collection(context); if (semanticDrift && semanticReads++ > 0) result.components[0]!.sha256 = h("unexpected-global-drift");
      return [JSON.stringify(result)];
    }
    if (sql.includes("'sessionRole'")) return [JSON.stringify(metadata)];
    return [];
  });
  const open = vi.fn<ManagedDeltaDatabaseDeps["open"]>(async (file, args, options) => {
    expect(file).toBe("docker"); events.push(`open:${args.at(-1)}`);
    const input = options!.initialInputBuffer!; initialCopies.push(Buffer.from(input)); initialReferences.push(input);
    if (openFailure) throw new Error("synthetic open failure");
    const session: FramedPsqlSession = { query: vi.fn(async (sql: string) => query(sql)), close: vi.fn(async () => { events.push(`close:${args.at(-1)}`); }), abort: vi.fn(async () => undefined), closed: false, closePromise: Promise.resolve() };
    sessions.push(session); return session;
  });
  processBoundary.spawn.mockImplementation(() => { const child = new DumpChild(); children.push(child); return child; });
  const options = { databaseUrl: URL_VALUE, rootDir: ROOT, context, now: () => NOW };
  const create = (extra: Partial<ManagedDeltaDatabaseDeps> = {}) => createManagedDeltaDatabase(options, { run, open, ...extra });
  return { context, program, bindings, options, create, run, open, query, resources, removed, events, sessions, children, initialCopies, initialReferences, metadata,
    mutateInspect: (fn: (value: Row) => void) => { inspectMutation = fn; }, failQuery: (sql: string) => { queryFailure = sql; }, failOpen: () => { openFailure = true; },
    outputId: (value: string) => { createdOutput = value; }, globalDrift: () => { semanticDrift = true; } };
}
async function recoveryContext(f: Awaited<ReturnType<typeof fixture>>): Promise<PairedRecoveryContext> {
  return { schemaVersion: 1, projectRef: MH, sourceCommit: f.context.sourceCommit, scopeDigest: f.context.scopeDigest, targetBindingHash: f.context.targetBindingHash,
    beforeRoot: f.context.beforeRoot, collectorSha256: f.context.collectorSha256, canonicalizerSha256: f.context.canonicalizerSha256,
    dataCollectorSha256: sha(lf(await readFile(resolve(ROOT, "scripts/release/delta-recovery-data.sql"), "utf8"))),
    dataNormalizerSha256: sha(lf(await readFile(resolve(ROOT, "scripts/release/delta-recovery-data.ts"), "utf8"))),
    extensionProfileHash: f.context.extensionProfileHash, toolProfileHash: f.context.recoveryToolProfileHash, changeControlReferenceHash: h("synthetic-recovery-freeze"),
    expiresAt: new Date(NOW.getTime() + 60000).toISOString(), maximumCaptureMs: 30000, maximumRestoreMs: 30000, maximumArchiveBytes: 1024 * 1024 };
}
afterEach(() => { processBoundary.spawn.mockReset(); vi.useRealTimers(); });

describe("paired RO recovery on the fixed managed adapter, all process/DB operations mocked", () => {
  it.each(["sourceCommit", "scopeDigest", "targetBindingHash", "beforeRoot", "collectorSha256", "canonicalizerSha256", "extensionProfileHash", "toolProfileHash", "dataCollectorSha256", "dataNormalizerSha256"] as const)("refuses independent recovery %s drift before creating a client", async key => {
    const f = await fixture(), context = await recoveryContext(f), db = await f.create();
    Object.assign(context, { [key]: h("different-recovery-binding") });
    await expect(db.openRecoverySource(context)).rejects.toThrow(); expect(f.run).not.toHaveBeenCalled(); await db.close();
  });
  it("refuses expired or arbitrary recovery overrides before a client is created", async () => {
    const f = await fixture(), context = await recoveryContext(f), db = await f.create();
    await expect(db.openRecoverySource({ ...context, expiresAt: new Date(NOW.getTime() - 1).toISOString() })).rejects.toThrow();
    await expect(db.openRecoverySource({ ...context, sql: "unreviewed SQL" } as PairedRecoveryContext)).rejects.toThrow();
    expect(f.run).not.toHaveBeenCalled(); await db.close();
  });
  it("sends binary custom archive and credential-free role commands on the same one RO exported snapshot", async () => {
    const f = await fixture(), context = await recoveryContext(f);
    const originalQuery = f.query.getMockImplementation()!;
    f.query.mockImplementation(async sql => sql.includes("pg_catalog.pg_export_snapshot()") ? [JSON.stringify({ snapshot: "00000003-0000001B-1", backendPid: 123,
      database: "postgres", role: "postgres", sessionRole: "postgres", version: "170006", isolation: "repeatable read", readOnly: "on", observedAt: NOW.toISOString() })] : originalQuery(sql));
    const privateBinary = vi.fn<NonNullable<ManagedDeltaDatabaseDeps["privateBinary"]>>(async (_file, _args, input) => { input.fill(0); return Buffer.from("PGDMP synthetic private archive"); });
    const db = await f.create({ privateBinary }), source = await db.openRecoverySource(context);
    const archive = await source.dumpArchive(), roles = await source.dumpRolesWithoutCredentials();
    const commands = f.run.mock.calls.filter(([, args]) => args[2] === "create").map(([, args]) => args.at(-1)!);
    expect(commands.some(command => command.includes("pg_dump --no-" + ["pass", "word"].join("")) && command.includes("--format=custom") && command.includes("--snapshot=00000003-0000001B-1"))).toBe(true);
    expect(commands.some(command => command.includes("pg_dumpall") && command.includes("--roles-only --no-role-passwords"))).toBe(true);
    expect(commands.join("\n")).not.toContain(SECRET); expect(commands.join("\n")).not.toContain(URL_VALUE);
    expect(f.query.mock.calls.filter(([sql]) => sql.includes("pg_catalog.pg_export_snapshot()"))).toHaveLength(1);
    expect(f.query.mock.calls.some(([sql]) => sql.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"))).toBe(true);
    expect(privateBinary).toHaveBeenCalledTimes(2); expect(privateBinary.mock.calls.every(([, , bytes]) => bytes.every(byte => byte === 0))).toBe(true);
    archive.fill(0); roles.fill(0); await source.close(); await db.close(); expect(f.initialReferences.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
    expect(f.query.mock.calls.map(([sql]) => sql).join("\n")).not.toMatch(/\b(?:COMMIT|INSERT|UPDATE|DELETE|ALTER|DROP)\b/);
  });
});

describe("fixed managed project route", () => {
  it("accepts only pinned direct/session routes and upgrades input require to verify-full with the checked CA", () => {
    for (const raw of [URL_VALUE, DIRECT]) {
      const route = describeProtectedDeltaRoute(raw); expect(route).toMatchObject({ projectRef: MH, port: 5432, databaseName: "postgres", sslMode: "verify-full", caSha256: DELTA_CA_SHA256 });
      expect(JSON.stringify(route)).not.toContain(SECRET); expect(JSON.stringify(route)).not.toContain("postgresql://");
    }
  });
  it.each([
    URL_VALUE.replace(":5432", ":6543"), URL_VALUE.replace(MH, "otherproject"), URL_VALUE.replace("/postgres?", "/other?"),
    URL_VALUE.replace("sslmode=require", "sslmode=disable"), `${URL_VALUE}&options=-c%20search_path%3Dpublic`, `${URL_VALUE}&host=evil.example`,
    `${URL_VALUE}#fragment`, URL_VALUE.replace(SECRET, ""), URL_VALUE.replace(SECRET, "bad%0Asecond-line"), URL_VALUE.replace(SECRET, "bad%0Dline"),
    URL_VALUE.replace(SECRET, "bad%00line"), URL_VALUE.replace(SECRET, "bad\nsecond-line"), DIRECT.replace("db.", "other."), DIRECT.replace("postgres:", "admin:"),
  ])("rejects route, login, TLS or credential-line overrides", raw => {
    expect(() => describeProtectedDeltaRoute(raw)).toThrow();
  });
});

describe("managed client ownership and transaction boundaries (all processes mocked)", () => {
  it("constructs using public files without connecting or creating resources", async () => {
    const f = await fixture(), db = await f.create(); expect(db.route.projectRef).toBe(MH);
    expect(f.run).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled(); expect(processBoundary.spawn).not.toHaveBeenCalled(); await db.close();
  });
  it("rejects a different target or collector implementation before any process can start", async () => {
    for (const key of ["targetBindingHash", "collectorSha256", "canonicalizerSha256"] as const) {
      const f = await fixture(); set(f.options.context, key, h(`wrong/${key}`)); await expect(f.create()).rejects.toThrow(); expect(f.run).not.toHaveBeenCalled();
    }
  });
  it("keeps the public descriptor from redirecting credentials after the binding was checked", async () => {
    const f = await fixture(), db = await f.create(); Reflect.set(db.route, "host", "unapproved.example");
    const tx = await db.begin(f.program, f.bindings);
    const args = f.run.mock.calls.find(([, args]) => args[2] === "create")![1];
    expect(args).toContain("PGHOST=aws-1-ap-northeast-1.pooler.supabase.com"); expect(args).not.toContain("PGHOST=unapproved.example"); await tx.close(); await db.close();
  });
  it("takes a session lock before RR BEGIN, binds context before transaction checks, and guards each write and commit", async () => {
    const f = await fixture(), db = await f.create(), tx = await db.begin(f.program, f.bindings);
    expect(f.query.mock.calls.map(([sql]) => sql)).toEqual([f.program.sessionLockSql, f.program.beginSql, bindDeltaExecutionContext(f.bindings), f.program.lockSql, f.program.expiryGuardSql]);
    await tx.applyFixedProgram(); await tx.commitWithExpiryGuard(); await tx.close(); await db.close();
    expect(f.query.mock.calls.slice(-3).map(([sql]) => sql)).toEqual([f.program.expiryGuardSql, f.program.applyDoSql, `${f.program.expiryGuardSql}\nCOMMIT;`]);
    expect(f.initialCopies.map(value => value.toString())).toEqual([`${SECRET}\n`]); expect(f.initialReferences.every(value => value.every(byte => byte === 0))).toBe(true);
    expect(f.removed).toHaveLength(1); expect(processBoundary.spawn).not.toHaveBeenCalled();
  });
  it.each(["sessionLockSql", "beginSql", "lockSql", "expiryGuardSql"] as const)("rolls back and removes the verified client when startup fails at %s", async key => {
    const f = await fixture(); f.failQuery(f.program[key]); const db = await f.create();
    await expect(db.begin(f.program, f.bindings)).rejects.toThrow("transaction startup");
    expect(f.query.mock.calls.at(-1)![0]).toBe("ROLLBACK;"); expect(f.query.mock.calls.some(([sql]) => sql === f.program.applyDoSql)).toBe(false);
    expect(f.sessions[0]!.close).toHaveBeenCalledOnce(); expect(f.removed).toHaveLength(1); await db.close();
  });
  it("rolls back a started transaction if dynamic context binding is invalid", async () => {
    const f = await fixture(), db = await f.create();
    await expect(db.begin(f.program, { ...f.bindings, scopeDigest: "unreviewed; COMMIT;" })).rejects.toThrow("startup");
    expect(f.query.mock.calls.map(([sql]) => sql)).toEqual([f.program.sessionLockSql, f.program.beginSql, "ROLLBACK;"]);
    expect(f.removed).toHaveLength(1); await db.close();
  });
  it("captures RW state through a separate read-only backend importing the same exported snapshot", async () => {
    const f = await fixture(), db = await f.create(), tx = await db.begin(f.program, f.bindings);
    const observed = await tx.inspectExportedSnapshot(); expect(observed.migrationRows).toBe(17); expect(f.sessions).toHaveLength(2);
    const parent = vi.mocked(f.sessions[0]!.query), reader = vi.mocked(f.sessions[1]!.query);
    expect(parent.mock.calls.some(([sql]) => sql.includes("pg_export_snapshot"))).toBe(true);
    expect(parent.mock.calls.some(([sql]) => sql.includes("delta-semantic-components"))).toBe(false);
    expect(reader.mock.calls[0]![0]).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(reader.mock.calls[0]![0]).toContain("SET TRANSACTION SNAPSHOT '00000003-0000001B-1'");
    expect(f.sessions[1]!.close).toHaveBeenCalledOnce(); expect(f.removed).toHaveLength(2);
    await tx.rollback(); await tx.close(); await db.close(); expect(f.removed).toHaveLength(3);
  });
  it("does not send a caller-substituted invariant query", async () => {
    const f = await fixture(), db = await f.create(); const program = { ...f.program, invariantSql: "SELECT 'unreviewed';" };
    await expect(db.begin(program, f.bindings)).rejects.toThrow("startup"); expect(f.query.mock.calls.map(([sql]) => sql)).toEqual(["ROLLBACK;"]); await db.close();
  });
  it("rejects invalid create IDs before start or cleanup of an unverified identity", async () => {
    const f = await fixture(); f.outputId("unknown-container"); const db = await f.create();
    await expect(db.begin(f.program, f.bindings)).rejects.toThrow("identifier"); expect(f.open).not.toHaveBeenCalled(); expect(f.removed).toEqual([]);
  });
  it.each([
    ["Id", h("foreign-client")], ["Config.Labels.com.adfocate.protected-delta-client", "foreign"], ["Config.Image", "postgres:latest"], ["Config.User", "root"],
    ["HostConfig.NetworkMode", "host"], ["HostConfig.ReadonlyRootfs", false], ["HostConfig.Privileged", true], ["HostConfig.LogConfig.Type", "json-file"],
    ["HostConfig.CapDrop", []], ["HostConfig.CapAdd", ["SYS_ADMIN"]], ["HostConfig.SecurityOpt", ["no-new-privileges=false"]],
    ["HostConfig.Binds", ["/host:/data"]], ["HostConfig.PortBindings", { "5432/tcp": [{ HostPort: "5432" }] }],
    ["HostConfig.PublishAllPorts", true], ["HostConfig.Memory", 0], ["HostConfig.PidsLimit", 0],
    ["Config.Env", [`PGPASSWORD=${SECRET}`]], ["Config.Env", [`DATABASE_URL=${URL_VALUE}`]], ["Mounts.0.RW", true], ["Mounts.0.Source", "unreviewed-ca"],
  ])("rejects unverified client metadata at %s before any stdin reaches a child", async (path, value) => {
    const f = await fixture(); f.mutateInspect(metadata => {
      if (path === "Config.Labels.com.adfocate.protected-delta-client") set(metadata, "Config.Labels", { [LABEL]: value }); else set(metadata, path as string, value);
    });
    const db = await f.create(); await expect(db.begin(f.program, f.bindings)).rejects.toThrow();
    expect(f.open).not.toHaveBeenCalled(); expect(f.initialCopies).toEqual([]); expect(f.removed).toEqual([]); expect(processBoundary.spawn).not.toHaveBeenCalled();
  });
  it("rejects an unexpected tmpfs destination and incomplete tmpfs isolation", async () => {
    const extra = await fixture(); extra.mutateInspect(value => (value.Mounts as unknown[]).push({ Type: "tmpfs", Destination: "/unreviewed" }));
    await expect((await extra.create()).begin(extra.program, extra.bindings)).rejects.toThrow(); expect(extra.open).not.toHaveBeenCalled();
    const missing = await fixture(); missing.mutateInspect(value => set(value, "HostConfig.Tmpfs", {}));
    await expect((await missing.create()).begin(missing.program, missing.bindings)).rejects.toThrow(); expect(missing.open).not.toHaveBeenCalled();
  });
  it("cleans up an owned client after open failure and ends credential lifetime on database close", async () => {
    const f = await fixture(); f.failOpen(); const db = await f.create();
    await expect(db.begin(f.program, f.bindings)).rejects.toThrow("psql startup"); expect(f.removed).toHaveLength(1);
    await db.close(); const calls = f.run.mock.calls.length; await expect(db.begin(f.program, f.bindings)).rejects.toThrow("credential lifetime ended"); expect(f.run.mock.calls).toHaveLength(calls);
  });
  it("attempts other verified cleanup even if one client identity can no longer be verified", async () => {
    const f = await fixture(), db = await f.create();
    // Independent synthetic sessions exercise cleanup iteration; no actual locks are acquired.
    const first = await db.begin(f.program, f.bindings), second = await db.begin(f.program, f.bindings);
    const [firstId, secondId] = [...f.resources.keys()];
    f.mutateInspect(value => { if (value.Id === firstId) set(value, "Config.Labels", { [LABEL]: "foreign" }); });
    const failure = await db.close().then(() => undefined, error => error as Error);
    const cleanedOther = f.removed.includes(secondId!); expect(f.removed).not.toContain(firstId);
    f.mutateInspect(() => undefined); await first.close(); if (!cleanedOther) await second.close();
    expect(failure).toBeInstanceOf(Error); expect(cleanedOther).toBe(true);
  });
  it("clears the initial credential buffer even when an injected opener rejects without consuming it", async () => {
    const f = await fixture(); f.failOpen(); const db = await f.create();
    await expect(db.begin(f.program, f.bindings)).rejects.toThrow("psql startup");
    expect(f.initialReferences).toHaveLength(1); expect(f.initialReferences[0]!.every(byte => byte === 0)).toBe(true); await db.close();
  });
  it("clears an unconsumed dump credential buffer and removes owned clients when export fails", async () => {
    const f = await fixture(); const references: Buffer[] = [], copies: Buffer[] = [];
    const privateInput = vi.fn<NonNullable<ManagedDeltaDatabaseDeps["privateInput"]>>(async (file, args, input, limit) => {
      expect(file).toBe("docker"); expect(args[0]).toBe("--host"); expect(args.slice(2, 5)).toEqual(["start", "--attach", "--interactive"]); expect(limit).toBe(32 * 1024 * 1024);
      references.push(input); copies.push(Buffer.from(input)); throw new Error("synthetic export failed");
    });
    const db = await f.create({ privateInput }); await expect(db.inspect()).rejects.toThrow("export failed");
    expect(copies.map(value => value.toString())).toEqual([`${SECRET}\n`]); expect(references[0]!.every(byte => byte === 0)).toBe(true);
    expect(f.removed).toHaveLength(2); expect(processBoundary.spawn).not.toHaveBeenCalled(); await db.close();
  });
  it("performs a synthetic RO export with a paired snapshot, clear stdin buffer and owned resource cleanup", async () => {
    const f = await fixture(), db = await f.create(), observed = await db.inspect(); await db.close();
    expect(observed.targetBindingHash).toBe(f.context.targetBindingHash); expect(observed.migrationRows).toBe(17);
    expect(f.query.mock.calls[0]![0]).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    expect(f.query.mock.calls.at(-1)![0]).toBe("ROLLBACK;"); expect(f.removed).toHaveLength(2);
    expect(f.children).toHaveLength(1); expect(f.children[0]!.inputs.map(value => value.toString())).toEqual([`${SECRET}\n`]);
    expect(f.children[0]!.inputReferences.every(value => value.every(byte => byte === 0))).toBe(true);
    for (const [, args] of processBoundary.spawn.mock.calls) { expect(JSON.stringify(args)).not.toContain(SECRET); expect(args).toContain("--interactive"); }
  });
  it("settles a timed-out dump even when the local child never acknowledges kill", async () => {
    const f = await fixture(), child = new DumpChild(false); f.children.push(child); processBoundary.spawn.mockImplementation(() => child);
    const db = await f.create(); vi.useFakeTimers(); let settled = false;
    const outcome = db.inspect().then(() => { settled = true; return undefined; }, error => { settled = true; return error as Error; });
    await vi.advanceTimersByTimeAsync(66_000); const settledByDeadline = settled;
    // Always release the synthetic child after observing the bound, including a failing regression.
    if (!settled) child.emit("close", 1);
    const failure = await outcome; await db.close();
    expect(settledByDeadline).toBe(true); expect(failure).toBeInstanceOf(Error); expect(child.kill).toHaveBeenCalled();
    expect(f.children[0]!.inputReferences.every(value => value.every(byte => byte === 0))).toBe(true);
  });
  it("rejects global catalog drift across the dump and cleans up all verified resources", async () => {
    const f = await fixture(); f.globalDrift(); const db = await f.create();
    await expect(db.inspect()).rejects.toThrow("global catalog/configuration changed"); expect(f.removed).toHaveLength(2); await db.close();
  });
});
