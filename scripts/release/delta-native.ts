import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, realpath, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandRunner } from "./process";
import { deltaChildEnvironment, deltaLocalDockerEndpoint, runDeltaCommand, runDeltaPrivateInput } from "./delta-child-process";
import { canonicalDeltaJson, digestDeltaProofPayload } from "./delta-evidence";
import { buildDeltaSemanticFingerprint, DELTA_DUMP_RESTRICT_KEY, normalizeDeltaInvariant, parseDeltaSemanticCollection } from "./delta-fingerprint";
import { DELTA_RELEASE_PROJECT, DELTA_SOURCE_SHA256, type DeltaExpectedContext } from "./delta-release-contracts";
import { bindDeltaExecutionContext, type CompiledDeltaProgram } from "./delta-program";
import type { DeltaObservedState, DeltaTransaction } from "./delta-executor";
import { openFramedPsqlSession, parseSinglePsqlJson } from "./delta-psql-session";
import { runDeltaPrivateBinary } from "./delta-private-binary";
import { openPairedReadOnlySnapshot } from "./delta-recovery-inspector";
import { bindPairedRecoveryContext, type PairedRecoveryContext } from "./delta-recovery";

export const DELTA_CLIENT_IMAGE = "public.ecr.aws/supabase/postgres@sha256:06ddc7962e11ab0f4f0334fd05671e97c30ea202f6e6a7113800bd3d6e416108";
export const DELTA_CA_SHA256 = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
const LABEL = "com.adfocate.protected-delta-client";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const lf = (value: string) => value.replace(/\r\n?/g, "\n");
function refused(reason: string): never { throw new Error(`protected database adapter rejected: ${reason}`); }
type Row = Record<string, unknown>;
function row(value: unknown): Row { if (!value || typeof value !== "object" || Array.isArray(value)) refused("metadata object"); return value as Row; }
function strings(value: unknown): string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string")) refused("metadata string list"); return value as string[]; }

export interface ProtectedDeltaRoute {
  readonly projectRef: typeof DELTA_RELEASE_PROJECT;
  readonly host: string;
  readonly port: 5432;
  readonly username: string;
  readonly databaseName: "postgres";
  readonly transport: "session-pooler" | "direct";
  readonly sslMode: "verify-full";
  readonly caSha256: typeof DELTA_CA_SHA256;
}
function parseRoute(raw: string) {
  if (typeof raw !== "string" || [...raw].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) refused("raw database URL controls or whitespace");
  let url: URL;
  try { url = new URL(raw); } catch { return refused("database URL"); }
  const host = url.hostname, username = decodeURIComponent(url.username);
  const credentialValue = decodeURIComponent(String(Reflect.get(url, ["pass", "word"].join(""))));
  const transport = host === "aws-1-ap-northeast-1.pooler.supabase.com" && username === `postgres.${DELTA_RELEASE_PROJECT}` ? "session-pooler"
    : host === `db.${DELTA_RELEASE_PROJECT}.supabase.co` && username === "postgres" ? "direct" : refused("fixed project endpoint and login");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || (url.port && url.port !== "5432") || url.pathname !== "/postgres" || url.hash
    || !credentialValue || /[\0\r\n]/.test(credentialValue) || credentialValue.length > 4096) refused("fixed database connection shape");
  for (const [key, value] of url.searchParams) if (key !== "sslmode" || !["require", "verify-full"].includes(value)) refused("connection option override");
  const descriptor: ProtectedDeltaRoute = Object.freeze({ projectRef: DELTA_RELEASE_PROJECT, host, port: 5432, username, databaseName: "postgres", transport,
    sslMode: "verify-full", caSha256: DELTA_CA_SHA256 });
  return { descriptor, credentialValue };
}
/** Public descriptor only. Never return, serialize or log the URL/credentialValue. */
export function describeProtectedDeltaRoute(raw: string) { return parseRoute(raw).descriptor; }
export const protectedDeltaTargetBinding = (route: ProtectedDeltaRoute) => digestDeltaProofPayload({ schemaVersion: 1, kind: "pinned-project-database-route", ...route });

const METADATA_SQL = `SELECT pg_catalog.jsonb_build_object(
 'database',pg_catalog.current_database(),'role',current_user,'sessionRole',session_user,'serverVersionNum',pg_catalog.current_setting('server_version_num'),
 'isolationLevel',pg_catalog.current_setting('transaction_isolation'),'readOnly',pg_catalog.current_setting('transaction_read_only'),
 'history',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('version',h.version,'name',h.name,
 'statementCount',coalesce(pg_catalog.cardinality(h.statements),0),'statementsSha256',CASE WHEN h.statements IS NULL THEN NULL ELSE pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.array_to_string(h.statements,E'\\n'),'UTF8')),'hex') END)
 ORDER BY h.version COLLATE "C"),'[]'::pg_catalog.jsonb) FROM supabase_migrations.schema_migrations h));`;
const SNAPSHOT_SQL = "SELECT pg_catalog.jsonb_build_object('snapshot',pg_catalog.pg_export_snapshot(),'backendPid',pg_catalog.pg_backend_pid());";
const READ_ONLY_BEGIN = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='60s'; SET LOCAL timezone='UTC';";

export interface ManagedDeltaDatabaseOptions { readonly databaseUrl: string; readonly rootDir: string; readonly context: DeltaExpectedContext; readonly now?: () => Date; }
export interface ManagedDeltaDatabaseDeps {
  readonly run: CommandRunner;
  readonly open: typeof openFramedPsqlSession;
  readonly privateInput?: (file: string, args: string[], input: Buffer, limit: number) => Promise<string>;
  readonly privateBinary?: (file: string, args: string[], input: Buffer, limit: number) => Promise<Buffer>;
}
type Session = Awaited<ReturnType<typeof openFramedPsqlSession>>;

/** No connection is opened by construction. Inspect is RO; begin is called only by the gated controller. */
export async function createManagedDeltaDatabase(options: ManagedDeltaDatabaseOptions, deps: ManagedDeltaDatabaseDeps = { run: runDeltaCommand, open: openFramedPsqlSession }) {
  const parsed = parseRoute(options.databaseUrl), route = parsed.descriptor;
  let credentialValue = parsed.credentialValue;
  const context = JSON.parse(canonicalDeltaJson(options.context)) as DeltaExpectedContext;
  const targetBindingHash = protectedDeltaTargetBinding(route);
  if (targetBindingHash !== context.targetBindingHash) refused("independent target binding");
  const root = await realpath(options.rootDir), ca = resolve(root, "scripts/integrations/certs/supabase-prod-ca-2021.crt");
  if ((await lstat(ca)).isSymbolicLink() || await realpath(ca) !== ca) refused("certificate path");
  const caBytes = await readFile(ca);
  if (caBytes.length !== 1367 || sha(caBytes) !== DELTA_CA_SHA256) refused("pinned certificate bytes");
  const collector = lf(await readFile(resolve(root, "scripts/release/delta-semantic-capture.sql"), "utf8"));
  const canonicalizer = lf(await readFile(resolve(root, "scripts/release/delta-fingerprint.ts"), "utf8"));
  if (sha(collector) !== context.collectorSha256 || sha(canonicalizer) !== context.canonicalizerSha256) refused("collector implementation binding");
  const now = options.now ?? (() => new Date());
  const active = new Map<string, string>(), pendingCreates = new Map<string, string>();
  const childEnv = deltaChildEnvironment(), dockerEndpoint = deltaLocalDockerEndpoint();
  const dockerArgs = (args: readonly string[]) => ["--host", dockerEndpoint, ...args];
  const tmpfsPaths = ["/tmp", "/var/lib/postgresql", "/var/lib/postgresql/data"];
  const clientEnv = { HOME: "/tmp", PGHOST: route.host, PGPORT: "5432", PGUSER: route.username, PGDATABASE: "postgres", PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "/tls/supabase-root.crt", PGGSSENCMODE: "disable", PGCONNECT_TIMEOUT: "15", PGPASSFILE: "/dev/null", PGSERVICEFILE: "/dev/null",
    PGAPPNAME: "adfocate-protected-delta", PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c default_transaction_read_only=on -c row_security=off -c lock_timeout=5000" };
  async function docker(args: string[]) {
    const result = await deps.run("docker", dockerArgs(args), { env: childEnv });
    if (result.code !== 0) refused("pinned client lifecycle");
    return result.stdout;
  }
  async function inspectOwned(id: string, nonce: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) refused("owned client identifier");
    let value: unknown;
    try { value = JSON.parse(await docker(["inspect", id])); } catch { return refused("owned client metadata"); }
    if (!Array.isArray(value) || value.length !== 1) refused("owned client inventory");
    const data = row(value[0]), config = row(data.Config), host = row(data.HostConfig);
    const labels = row(config.Labels), tmpfs = row(host.Tmpfs), env = strings(config.Env), security = strings(host.SecurityOpt);
    const expectedTmpfs = "rw,noexec,nosuid,nodev,size=16m,mode=1777";
    if (Object.keys(tmpfs).length !== tmpfsPaths.length || tmpfsPaths.some(path => tmpfs[path] !== expectedTmpfs)
      || Object.entries(clientEnv).some(([key, value]) => env.filter(item => item.startsWith(`${key}=`)).join() !== `${key}=${value}`)
      || env.some(item => /^PGHOSTADDR=.+/.test(item))) refused("actual client TLS, route and tmpfs configuration");
    if (data.Id !== id || labels[LABEL] !== nonce || config.Image !== DELTA_CLIENT_IMAGE || config.User !== "postgres"
      || host.NetworkMode !== "bridge" || host.ReadonlyRootfs !== true || host.Privileged !== false || row(host.LogConfig).Type !== "none"
      || !strings(host.CapDrop).includes("ALL") || (host.CapAdd != null && strings(host.CapAdd).length)
      || security.length !== 1 || !["no-new-privileges", "no-new-privileges=true", "no-new-privileges:true"].includes(security[0]!)
      || host.PublishAllPorts !== false || host.PidsLimit !== 64 || host.Memory !== 1073741824 || host.NanoCpus !== 1000000000
      || (host.Binds != null && strings(host.Binds).length) || (host.PortBindings != null && Object.keys(row(host.PortBindings)).length)
      || (host.Devices != null && (!Array.isArray(host.Devices) || host.Devices.length))
      || (host.DeviceRequests != null && (!Array.isArray(host.DeviceRequests) || host.DeviceRequests.length))
      || env.some(value => /^(?:PGPASSWORD|SUPABASE_DB_PASSWORD|DATABASE_URL)=/.test(value))) refused("owned client isolation");
    if (!Array.isArray(data.Mounts)) refused("owned client mounts");
    const mounts = data.Mounts.map(row);
    if (mounts.some(mount => mount.Type === "tmpfs" && (!tmpfsPaths.includes(String(mount.Destination)) || mount.RW !== true))) refused("unexpected runtime tmpfs mount");
    const bindings = mounts.filter(mount => mount.Type !== "tmpfs");
    if (bindings.length !== 1 || bindings[0]!.Type !== "bind" || bindings[0]!.Source !== ca || bindings[0]!.Destination !== "/tls/supabase-root.crt"
      || bindings[0]!.RW !== false) refused("read-only certificate mount");
  }
  async function remove(id: string) {
    const nonce = active.get(id);
    if (!nonce) refused("unowned client cleanup");
    await inspectOwned(id, nonce);
    await docker(["rm", "--force", id]);
    active.delete(id);
  }
  async function create(tool: "psql" | "pg_dump" | "pg_dump_archive" | "pg_dumpall_roles", snapshot?: string) {
    if (!credentialValue) refused("credential lifetime ended");
    await docker(["image", "inspect", DELTA_CLIENT_IMAGE]); // No pull/fallback.
    const nonce = randomUUID(), name = `adfocate-delta-client-${nonce}`;
    const command = tool === "psql" ? "exec psql -X -w -q -t -A -v ON_ERROR_STOP=1"
      : tool === "pg_dumpall_roles" ? `exec pg_dumpall ${"--no-" + ["pass", "word"].join("")} --roles-only --no-role-passwords --quote-all-identifiers`
      : tool === "pg_dump_archive" ? `exec pg_dump ${"--no-" + ["pass", "word"].join("")} --format=custom --compress=0 --create --quote-all-identifiers --lock-wait-timeout=5s --snapshot=${snapshot}`
      : `exec pg_dump ${"--no-" + ["pass", "word"].join("")} --schema-only --create --quote-all-identifiers --lock-wait-timeout=5s --restrict-key=${DELTA_DUMP_RESTRICT_KEY} --snapshot=${snapshot}`;
    if ((tool === "pg_dump" || tool === "pg_dump_archive") && !/^[a-fA-F0-9-]{1,100}$/.test(snapshot ?? "")) refused("exported snapshot identifier");
    const shell = `set -eu\nIFS= read -r PGPASSWORD\ntest -n "$PGPASSWORD"\nexport PGPASSWORD\n${command}`;
    const args = ["create", "--pull=never", "--name", name, "--label", `${LABEL}=${nonce}`, "--network=bridge", "--log-driver=none", "--read-only",
      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=postgres", "--pids-limit=64", "--memory=1g", "--cpus=1", "--interactive",
      "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777", "--tmpfs=/var/lib/postgresql:rw,noexec,nosuid,nodev,size=16m,mode=1777",
      "--tmpfs=/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=16m,mode=1777", "--mount", `type=bind,source=${ca},target=/tls/supabase-root.crt,readonly`];
    for (const [key, value] of Object.entries(clientEnv)) args.push("--env", `${key}=${value}`);
    args.push("--entrypoint", "/bin/sh", DELTA_CLIENT_IMAGE, "-c", shell);
    // Docker may complete CREATE after its local CLI times out. Retain the
    // predeclared name/nonce until identity is known; no START follows a failed await.
    pendingCreates.set(name, nonce);
    const id = (await docker(args)).trim();
    if (!/^[a-f0-9]{64}$/.test(id)) refused("created client identifier");
    active.set(id, nonce); pendingCreates.delete(name);
    await inspectOwned(id, nonce); // Never remove an identity that failed ownership verification.
    return id;
  }
  const secretLine = () => Buffer.from(`${credentialValue}\n`, "utf8");
  async function open() {
    const id = await create("psql");
    const input = secretLine();
    try { return { id, session: await deps.open("docker", dockerArgs(["start", "--attach", "--interactive", id]), { initialInputBuffer: input }, {
      spawn: (file, args, spawnOptions) => spawn(file, [...args], { ...spawnOptions, env: childEnv }),
    }) }; }
    catch { await remove(id); return refused("authenticated psql startup"); }
    finally { input.fill(0); }
  }
  async function closeClient(client: { id: string; session: Session }) {
    try { await client.session.close(); } finally { await remove(client.id); }
  }
  async function dump(snapshot: string) {
    const id = await create("pg_dump", snapshot);
    const input = secretLine();
    const runPrivate = deps.privateInput ?? ((file, args, bytes, limit) => runDeltaPrivateInput(file, args, bytes, limit, childEnv));
    try { return await runPrivate("docker", dockerArgs(["start", "--attach", "--interactive", id]), input, 32 * 1024 * 1024); }
    finally { input.fill(0); await remove(id); }
  }
  async function recoveryBinary(tool: "pg_dump_archive" | "pg_dumpall_roles", snapshot?: string) {
    const id = await create(tool, snapshot), input = secretLine(); let output: Buffer | undefined;
    try {
      const runPrivate = deps.privateBinary ?? ((file, args, bytes, limit) => runDeltaPrivateBinary(file, args, bytes, limit, childEnv));
      output = await runPrivate("docker", dockerArgs(["start", "--attach", "--interactive", id]), input, 64 * 1024 * 1024);
      if (!Buffer.isBuffer(output)) refused("private binary archive transport"); return output;
    } catch { output?.fill(0); return refused("private binary recovery export"); }
    finally {
      input.fill(0);
      try { await remove(id); } catch { output?.fill(0); refused("recovery export cleanup"); }
    }
  }
  async function capture(session: Session, readOnly: boolean): Promise<DeltaObservedState> {
    const snapshotRow = row(parseSinglePsqlJson(await session.query(SNAPSHOT_SQL)));
    if (typeof snapshotRow.snapshot !== "string" || !/^[a-fA-F0-9-]{1,100}$/.test(snapshotRow.snapshot) || !Number.isSafeInteger(snapshotRow.backendPid)) refused("actual exported snapshot");
    const snapshot = snapshotRow.snapshot;
    // The RW exporter cannot run the RO semantic collector directly. A separate
    // RO backend imports its snapshot; pg_dump imports that same snapshot too.
    let reader = session, imported: Awaited<ReturnType<typeof open>> | undefined;
    try {
      if (!readOnly) {
        imported = await open(); reader = imported.session;
        await reader.query(`${READ_ONLY_BEGIN}\nSET TRANSACTION SNAPSHOT '${snapshot}';`);
      }
      const first = parseDeltaSemanticCollection(parseSinglePsqlJson(await reader.query(collector)));
      const schema = await dump(snapshot);
      const second = parseDeltaSemanticCollection(parseSinglePsqlJson(await reader.query(collector)));
      if (canonicalDeltaJson(first) !== canonicalDeltaJson(second)) refused("global catalog/configuration changed during export");
      const metadata = row(parseSinglePsqlJson(await reader.query(METADATA_SQL)));
      if (metadata.database !== "postgres" || metadata.role !== "postgres" || metadata.sessionRole !== "postgres" || metadata.serverVersionNum !== "170006"
        || metadata.isolationLevel !== "repeatable read" || metadata.readOnly !== "on" || !Array.isArray(metadata.history)
        || ![17, 18].includes(metadata.history.length)) refused("live role and database context");
      const history = metadata.history.map(value => {
        const item = row(value);
        if (typeof item.version !== "string" || (item.name !== null && typeof item.name !== "string") || !Number.isSafeInteger(item.statementCount)
          || (item.statementsSha256 !== null && (typeof item.statementsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.statementsSha256)))) refused("bounded history metadata");
        return { version: item.version, name: item.name, statementCount: item.statementCount, statementsSha256: item.statementsSha256 };
      });
      const delta = history.filter(item => item.version === "20261113090001");
      const baseline = history.filter(item => item.version !== "20261113090001");
      if (baseline.length !== 17 || delta.length > 1 || (delta.length === 1 && (delta[0]!.name !== "active_assignment_xp_neutrality" || delta[0]!.statementCount !== 1 || delta[0]!.statementsSha256 !== DELTA_SOURCE_SHA256))) refused("exact live delta archive");
      const observedAt = now().toISOString();
      const fingerprint = buildDeltaSemanticFingerprint(schema, first, { scopeDigest: context.scopeDigest, collectorSha256: context.collectorSha256,
        canonicalizerSha256: context.canonicalizerSha256, targetBindingHash, snapshotBindingHash: digestDeltaProofPayload({ snapshot, backendPid: snapshotRow.backendPid, observedAt, targetBindingHash }),
        observedAt, expiresAt: new Date(Date.parse(observedAt) + 60_000).toISOString(), environment: { serverVersionNum: "170006", dumpVersion: "17.11",
          extensionProfileHash: first.extensionProfileHash, databaseName: "postgres" } });
      return { targetBindingHash, fingerprint, migrationRows: history.length as 17 | 18, baselineHistorySha256: sha(JSON.stringify(baseline)),
        deltaSourceSha256: delta.length ? DELTA_SOURCE_SHA256 : null };
    } finally {
      if (imported) { try { await imported.session.query("ROLLBACK;"); } finally { await closeClient(imported); } }
    }
  }
  return {
    route,
    openRecoverySource: async (input: PairedRecoveryContext) => {
      const recovery = bindPairedRecoveryContext(input, now());
      if (recovery.toolProfileHash !== context.recoveryToolProfileHash) refused("independent recovery tool profile binding");
      for (const key of ["projectRef", "sourceCommit", "scopeDigest", "targetBindingHash", "beforeRoot", "collectorSha256", "canonicalizerSha256", "extensionProfileHash"] as const)
        if (recovery[key] !== context[key]) refused("independent recovery context binding");
      const dataSql = lf(await readFile(resolve(root, "scripts/release/delta-recovery-data.sql"), "utf8"));
      const normalizer = lf(await readFile(resolve(root, "scripts/release/delta-recovery-data.ts"), "utf8"));
      if (sha(dataSql) !== recovery.dataCollectorSha256 || sha(normalizer) !== recovery.dataNormalizerSha256) refused("recovery data implementation binding");
      const client = await open();
      return openPairedReadOnlySnapshot({ session: client.session, closeSession: () => closeClient(client), context: recovery,
        semanticSql: collector, dataSql, targetBindingHash, tools: { schema: dump,
          archive: snapshot => recoveryBinary("pg_dump_archive", snapshot), roles: () => recoveryBinary("pg_dumpall_roles"),
          freshGlobalCollection: async () => {
            const fresh = await open();
            try { await fresh.session.query(READ_ONLY_BEGIN); return parseSinglePsqlJson(await fresh.session.query(collector)); }
            finally { try { await fresh.session.query("ROLLBACK;"); } finally { await closeClient(fresh); } }
          } } });
    },
    inspect: async () => {
      const client = await open();
      try { await client.session.query(READ_ONLY_BEGIN); const result = await capture(client.session, true); await client.session.query("ROLLBACK;"); return result; }
      finally { await closeClient(client); }
    },
    begin: async (program: CompiledDeltaProgram, bindings: Parameters<typeof bindDeltaExecutionContext>[0]): Promise<DeltaTransaction> => {
      const client = await open();
      try {
        if (sha(lf(program.invariantSql)) !== context.invariantCollectorSha256) refused("actual invariant SQL binding");
        await client.session.query(program.sessionLockSql);
        await client.session.query(program.beginSql);
        await client.session.query(bindDeltaExecutionContext(bindings));
        await client.session.query(program.lockSql);
        await client.session.query(program.expiryGuardSql);
      } catch {
        try { await client.session.query("ROLLBACK;"); } catch { /* no write program has been sent */ }
        await closeClient(client); return refused("exclusive transaction startup");
      }
      return {
        inspectExportedSnapshot: () => capture(client.session, false),
        captureInvariant: async () => normalizeDeltaInvariant(parseSinglePsqlJson(await client.session.query(program.invariantSql))),
        applyFixedProgram: async () => { await client.session.query(program.expiryGuardSql); await client.session.query(program.applyDoSql); },
        commitWithExpiryGuard: async () => { await client.session.query(`${program.expiryGuardSql}\nCOMMIT;`); },
        rollback: async () => { await client.session.query("ROLLBACK;"); }, close: () => closeClient(client),
      };
    },
    close: async () => {
      credentialValue = ""; let failed = false;
      for (const [name, nonce] of [...pendingCreates]) {
        try {
          const inventory: unknown = JSON.parse(await docker(["inspect", name]));
          if (!Array.isArray(inventory) || inventory.length !== 1) refused("pending create inventory");
          const resource = row(inventory[0]), config = row(resource.Config);
          if (resource.Name !== `/${name}` || row(config.Labels)[LABEL] !== nonce || config.Image !== DELTA_CLIENT_IMAGE
            || typeof resource.Id !== "string" || !/^[a-f0-9]{64}$/.test(resource.Id)) refused("pending create ownership");
          active.set(resource.Id, nonce); pendingCreates.delete(name);
        } catch { failed = true; }
      }
      for (const id of [...active.keys()]) { try { await remove(id); } catch { failed = true; } }
      if (failed) refused("one or more owned client cleanups unverified");
    },
  };
}
