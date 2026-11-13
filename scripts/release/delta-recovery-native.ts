import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, realpath, mkdir, writeFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deltaChildEnvironment, deltaLocalDockerEndpoint, runDeltaCommand } from "./delta-child-process";
import { runDeltaPrivateBinary } from "./delta-private-binary";
import { createPrivateRecoveryAttempt } from "./delta-private-artifacts";
import { nativeOwnedResource, assertNativeOwnedContainer, NATIVE_COLLECTOR_IMAGES, NATIVE_COLLECTOR_PROFILES, type NativeOwnedResource } from "./delta-native-collectors";
import { openFramedPsqlSession, parseSinglePsqlJson, PsqlTransportError, type FramedPsqlSession } from "./delta-psql-session";
import { canonicalDeltaJson, digestDeltaProofPayload } from "./delta-evidence";
import { DELTA_DUMP_RESTRICT_KEY } from "./delta-fingerprint";
import { openPairedReadOnlySnapshot } from "./delta-recovery-inspector";
import { capturePairedRecovery, PairedRecoveryFailure, type PairedRecoveryContext, type PairedRecoverySource, type PairedRecoveryOwnedTarget } from "./delta-recovery";

const PROFILE = "source6-17.6.1.081" as const;
const LABEL = "adfocate.native-collectors";
const SERVER_IMAGE = NATIVE_COLLECTOR_PROFILES[PROFILE].serverImage;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
class OwnedRecoveryError extends Error { constructor(readonly stage: string) { super(`Owned paired recovery held: ${stage}`); this.name = "OwnedRecoveryError"; } }
function stop(stage: string): never { throw new OwnedRecoveryError(stage); }
let nativeOperation = "not-started";
let nativePsqlDiagnostic: string | undefined;
export function classifyOwnedRecoveryPsqlStderr(chunk: unknown) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
  if (new RegExp(["pass", "word"].join("") + " file", "i").test(text)) return "credential-file-warning";
  if (/connection refused/i.test(text)) return "connection-refused";
  if (/no pg_hba.conf entry/i.test(text)) return "connection-policy";
  if (/invalid command|syntax error/i.test(text)) return "invalid-fixed-program";
  if (/could not (?:access|load) file|could not load library/i.test(text)) return "extension-binary-unavailable";
  if (/FATAL:/i.test(text)) return "connection-fatal";
  if (/WARNING:/i.test(text)) return "server-warning";
  return "unclassified-stderr";
}
export function createOwnedTemplateDropProbe() {
  const expected = Buffer.from("cannot drop a template database", "ascii"); let offset = 0, observed = false;
  return { seen: () => observed, observe: (chunk: unknown) => {
    if (!Buffer.isBuffer(chunk)) return;
    for (const byte of chunk) {
      offset = byte === expected[offset] ? offset + 1 : byte === expected[0] ? 1 : 0;
      if (offset === expected.length) { observed = true; offset = 0; }
    }
  } };
}
export function pairedRecoverySafeFailure(error: unknown) {
  const operation = nativeOperation === "not-started" ? {} : { nativeOperation, ...(nativePsqlDiagnostic ? { nativePsqlDiagnostic } : {}) };
  if (error instanceof PairedRecoveryFailure) return { ...operation, phase: error.stage, outcome: error.outcome };
  if (error instanceof OwnedRecoveryError) return { ...operation, phase: error.stage };
  if (error instanceof PsqlTransportError) return { ...operation, phase: "psql", transportCode: error.code, ...(error.sqlState ? { sqlState: error.sqlState } : {}) };
  return { ...operation, phase: "unverified-native-operation" };
}
const row = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) stop("metadata"); return value as Record<string, unknown>; };
const dockerHost = deltaLocalDockerEndpoint();
const childEnv = deltaChildEnvironment();
const dockerArgs = (args: readonly string[]) => ["--host", dockerHost, ...args];
const serverScript = `set -eu
umask 077
export HOME=/tmp PGPASSFILE=/tmp/paired-no-credential PGSERVICEFILE=/tmp/paired-no-service
unset PGPASSWORD PGHOSTADDR PGOPTIONS
initdb -D /tmp/fixture-data -U postgres --auth=trust --no-locale -E UTF8 >/tmp/fixture-init.log 2>&1
exec postgres -D /tmp/fixture-data -c listen_addresses='127.0.0.1' -c unix_socket_directories=/tmp/fixture-socket -c shared_preload_libraries='' -c session_preload_libraries='' -c log_statement=none -c logging_collector=off >/tmp/fixture-server.log 2>&1
`;
interface Cluster { readonly server: NativeOwnedResource; readonly tool: NativeOwnedResource; readonly targetBindingHash: string }
const owned = new Set<NativeOwnedResource>();
let nativeRunning = false;
async function docker(args: readonly string[]) {
  const result = await runDeltaCommand("docker", dockerArgs(args), { env: childEnv }); if (result.code !== 0) stop("docker-command"); return result.stdout.trim();
}
export function assertPairedRecoveryOwnedContainer(data: unknown, resource: NativeOwnedResource) {
  const inspected = assertNativeOwnedContainer(data, resource), config = row(inspected.Config), host = row(inspected.HostConfig), tmpfs = row(host.Tmpfs);
  for (const path of resource.tmpfs) {
    const expected = path === "/tmp" ? "rw,nosuid,nodev,noexec,size=128m,mode=1777" : path === "/tmp/fixture-data" ? "rw,nosuid,nodev,noexec,size=1g,mode=0700,uid=100,gid=101"
      : path === "/tmp/fixture-socket" ? "rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=100,gid=101" : "rw,nosuid,nodev,noexec,size=16m,mode=1777";
    if (tmpfs[path] !== expected) stop("tmpfs-options");
  }
  if (!Array.isArray(config.Env) || !config.Env.includes("HOME=/tmp") || config.Env.some(value => typeof value !== "string" || /^(?:PGPASSWORD|DATABASE_URL|NODE_OPTIONS|PGHOSTADDR)=/.test(value))) stop("owned-environment");
  return inspected;
}
async function inspect(resource: NativeOwnedResource) {
  return assertPairedRecoveryOwnedContainer(JSON.parse(await docker(["inspect", resource.id ?? resource.name])), resource);
}
async function createResource(role: "server" | "tool", serverId?: string): Promise<NativeOwnedResource> {
  const image = role === "server" ? SERVER_IMAGE : NATIVE_COLLECTOR_IMAGES.tool;
  const inventory: unknown = JSON.parse(await docker(["image", "inspect", image])); if (!Array.isArray(inventory) || inventory.length !== 1) stop("image-inventory");
  const imageData = row(inventory[0]), config = row(imageData.Config), volumes = config.Volumes == null ? [] : Object.keys(row(config.Volumes));
  if (typeof imageData.Id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(imageData.Id)) stop("image-id");
  const resource = nativeOwnedResource(randomUUID().replaceAll("-", ""), role, imageData.Id, volumes, serverId, PROFILE);
  const args = ["create", "--pull=never", "--name", resource.name, "--label", `${LABEL}=${resource.token}`, "--label", `${LABEL}.role=${role}`,
    "--label", `${LABEL}.profile=${PROFILE}`, "--label", `${LABEL}.namespace=${serverId ?? "none"}`, `--network=${serverId ? `container:${serverId}` : "none"}`,
    "--log-driver=none", "--read-only", "--user=100:101", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=1g", "--cpus=1", "--env", "HOME=/tmp"];
  for (const path of resource.tmpfs) {
    const options = path === "/tmp" ? "rw,nosuid,nodev,noexec,size=128m,mode=1777" : path === "/tmp/fixture-data" ? "rw,nosuid,nodev,noexec,size=1g,mode=0700,uid=100,gid=101"
      : path === "/tmp/fixture-socket" ? "rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=100,gid=101" : "rw,nosuid,nodev,noexec,size=16m,mode=1777";
    args.push("--tmpfs", `${path}:${options}`);
  }
  args.push("--entrypoint", "/bin/sh", image, "-c", role === "server" ? serverScript : "set -eu; exec sleep 3600");
  // Record the name/nonce before CREATE, including a late or ambiguous acknowledgement.
  owned.add(resource); const id = await docker(args); if (!/^[a-f0-9]{64}$/.test(id)) stop("create-id"); resource.id = id;
  await inspect(resource); await docker(["start", id]); return resource;
}
async function remove(resource: NativeOwnedResource) {
  const verified = await inspect(resource); const id = String(verified.Id);
  if (await docker(["rm", "--force", id]) !== id) stop("remove-acknowledgement");
  const absent = await runDeltaCommand("docker", dockerArgs(["inspect", id]), { env: childEnv });
  if (absent.code !== 1 || absent.stdout.trim() !== "[]") stop("owned-absence"); owned.delete(resource);
}
async function removeCluster(cluster: Cluster) {
  let failed = false;
  for (const resource of [cluster.tool, cluster.server]) { if (!owned.has(resource)) continue; try { await remove(resource); } catch { failed = true; } }
  if (failed) stop("cluster-cleanup");
}
async function createCluster(): Promise<Cluster> {
  const server = await createResource("server"), tool = await createResource("tool", server.id);
  for (const toolName of ["pg_dump", "pg_dumpall", "pg_restore"]) {
    await inspect(tool);
    const version = await docker(["exec", "--user=100:101", tool.id!, toolName, "--version"]);
    if (!new RegExp(`^${toolName} \\(PostgreSQL\\) 17\\.11$`).test(version)) stop("native-tool-version");
  }
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await inspect(tool); const result = await runDeltaCommand("docker", dockerArgs(["exec", "--user=100:101", tool.id!, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres"]), { env: childEnv });
    if (result.code === 0) { ready = true; break; }
    await new Promise(resolveReady => setTimeout(resolveReady, 250));
  }
  if (!ready) stop("server-readiness");
  return { server, tool, targetBindingHash: digestDeltaProofPayload({ kind: "owned-paired-recovery-postgres", serverId: server.id, toolId: tool.id, image: SERVER_IMAGE, toolImage: NATIVE_COLLECTOR_IMAGES.tool }) };
}
async function session(cluster: Cluster): Promise<FramedPsqlSession> {
  await inspect(cluster.server); await inspect(cluster.tool);
  // No host/home credential files are read. A character device such as /dev/null
  // itself causes libpq's passfile warning on these trust-authenticated fixtures.
  const opened = await openFramedPsqlSession("docker", dockerArgs(["exec", "-i", "--user=100:101", "--env=PGPASSFILE=/tmp/paired-no-credential", "--env=PGSERVICEFILE=/tmp/paired-no-service", cluster.tool.id!,
    "psql", "-X", "-w", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres"]), { timeoutMs: 60_000 },
  { spawn: (file, args, options) => {
    const child = spawn(file, [...args], { ...options, env: childEnv });
    child.stderr?.on("data", (chunk: unknown) => { nativePsqlDiagnostic = classifyOwnedRecoveryPsqlStderr(chunk); });
    return child;
  } });
  try { await opened.query("SET client_min_messages='warning';"); return opened; }
  catch (error) { await opened.close(); throw error; }
}
async function command(cluster: Cluster, commandName: "schema" | "archive" | "roles" | "inventory" | "restore", input: Buffer = Buffer.alloc(0), snapshot?: string, observer?: { invoked: () => void; stderr: (chunk: unknown) => void }): Promise<Buffer> {
  await inspect(cluster.server); await inspect(cluster.tool);
  if (["schema", "archive"].includes(commandName) && !/^[a-fA-F0-9-]{1,100}$/.test(snapshot ?? "")) stop("exported-snapshot");
  const connection = ["-w", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres"];
  const args = commandName === "schema" ? ["pg_dump", ...connection, "--schema-only", "--create", "--quote-all-identifiers", `--restrict-key=${DELTA_DUMP_RESTRICT_KEY}`, `--snapshot=${snapshot}`, "--lock-wait-timeout=5s"]
    : commandName === "archive" ? ["pg_dump", ...connection, "--format=custom", "--compress=0", "--create", "--quote-all-identifiers", `--snapshot=${snapshot}`, "--lock-wait-timeout=5s"]
    : commandName === "roles" ? ["pg_dumpall", "-w", "-h", "127.0.0.1", "-U", "postgres", "--roles-only", "--no-role-passwords", "--quote-all-identifiers"]
    : commandName === "inventory" ? ["pg_restore", "--list"]
    : ["pg_restore", "-w", "-h", "127.0.0.1", "-U", "postgres", "-d", "template1", "--exit-on-error", "--clean", "--if-exists", "--create"];
  const pgOptions = commandName === "restore" ? "-c client_min_messages=warning" : "-c default_transaction_read_only=on -c row_security=off -c client_min_messages=warning";
  try { return await runDeltaPrivateBinary("docker", dockerArgs(["exec", "-i", "--user=100:101", "--env=PGPASSFILE=/tmp/paired-no-credential", "--env=PGSERVICEFILE=/tmp/paired-no-service", "--env", `PGOPTIONS=${pgOptions}`, cluster.tool.id!, ...args]), input, 64 * 1024 * 1024, childEnv,
    observer ? { spawn: (file, argv, options) => {
      const child = spawn(file, argv, options); child.once("spawn", observer.invoked); child.stderr?.on("data", observer.stderr); return child;
    } } : undefined); }
  finally { input.fill(0); }
}
const sourceFixture = `CREATE SCHEMA extensions;CREATE SCHEMA vault;CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE SCHEMA supabase_migrations;
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE EXTENSION pg_stat_statements WITH SCHEMA extensions VERSION '1.11';CREATE EXTENSION pgcrypto WITH SCHEMA extensions VERSION '1.3';
CREATE EXTENSION supabase_vault WITH SCHEMA vault VERSION '0.3.1';CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions VERSION '1.1';CREATE EXTENSION vector WITH SCHEMA public VERSION '0.8.0';
DO $fixture_oid_offset$ DECLARE n integer; BEGIN FOR n IN 1..32 LOOP CREATE TYPE public.fixture_oid_offset AS ENUM('discarded');DROP TYPE public.fixture_oid_offset;END LOOP;END $fixture_oid_offset$;
CREATE TYPE public.fixture_state AS ENUM('ready','retained');CREATE DOMAIN public.fixture_label AS text CHECK(length(VALUE)>0);
CREATE TABLE public.paired_rows(id bigint PRIMARY KEY,raw_json json,array_bounds integer[],payload bytea,amount numeric,stamp timestamptz,label public.fixture_label,state public.fixture_state,states public.fixture_state[],labels public.fixture_label[]);
INSERT INTO public.paired_rows VALUES(1,'{"a":1,"a":2}','[0:2]={2,NULL,4}',decode('0000ff','hex'),12.3400,'2026-11-13T12:34:56Z','synthetic','ready',ARRAY['ready','retained']::public.fixture_state[],ARRAY['synthetic',NULL]::public.fixture_label[]),(2,'{"x":null}','[-2:-1]={8,9}',decode('ff','hex'),-999.0001,'2026-11-12T11:00:00Z','second','retained','[0:1]={retained,NULL}'::public.fixture_state[],'[-1:0]={second,retained}'::public.fixture_label[]);
CREATE TABLE public.duplicates(value text);INSERT INTO public.duplicates VALUES('same'),('same'),(NULL);
CREATE SEQUENCE public.paired_sequence START 101;SELECT setval('public.paired_sequence',123,true);
CREATE TABLE auth.users(id uuid PRIMARY KEY,synthetic_marker text);INSERT INTO auth.users VALUES('00000000-0000-4000-8000-000000000011','fixture-only-no-provider-auth');
CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean,file_size_limit bigint,allowed_mime_types text[]);INSERT INTO storage.buckets VALUES('fixture-private',false,10000,ARRAY['image/png']);
CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text REFERENCES storage.buckets(id),name text);INSERT INTO storage.objects VALUES('00000000-0000-4000-8000-000000000021','fixture-private','synthetic-no-object-bytes');
CREATE TABLE supabase_migrations.schema_migrations(version varchar PRIMARY KEY,name text,statements text[]);
INSERT INTO supabase_migrations.schema_migrations SELECT '202610010000'||lpad(i::text,2,'0'),'synthetic_executed_'||i,ARRAY['SELECT '||i||'::integer;'] FROM generate_series(0,16)i;
REVOKE ALL ON public.paired_rows FROM PUBLIC;GRANT SELECT ON public.paired_rows TO service_role;
`;
export type PairedNativeDrift = "none" | "restored-row" | "restored-sequence" | "restored-role" | "restored-schema" | "source-sequence" | "source-role" | "archive-tamper" | "restore-error";
const targetDrift: Partial<Record<PairedNativeDrift, string>> = {
  "restored-row": "UPDATE public.paired_rows SET raw_json='{\"a\":2,\"a\":1}' WHERE id=1;",
  "restored-sequence": "SELECT nextval('public.paired_sequence');", "restored-role": "ALTER ROLE service_role NOBYPASSRLS;",
  "restored-schema": "ALTER TABLE public.paired_rows ADD COLUMN forbidden integer;",
};
function restoreRoleDefinitions(bytes: Buffer) {
  const text = bytes.toString("utf8"), marker = 'CREATE ROLE "postgres";';
  if (text.split(marker).length !== 2 || /\bPASSWORD\s+'/.test(text)) stop("role-bootstrap-profile");
  return text.replace(marker, "-- Initial owned postgres role already exists; its exact attributes follow.");
}
export async function runOwnedPairedRecovery(rootInput: string) {
  const root = await realpath(rootInput);
  const paths = ["scripts/release/delta-recovery.ts", "scripts/release/delta-recovery-inspector.ts", "scripts/release/delta-recovery-native.ts", "scripts/release/delta-recovery-data.ts", "scripts/release/delta-recovery-data.sql", "scripts/release/delta-private-binary.ts", "scripts/release/delta-private-artifacts.ts", "scripts/release/delta-private-artifacts.ps1", "scripts/release/delta-semantic-capture.sql", "scripts/release/delta-fingerprint.ts"];
  const inputs = await Promise.all(paths.map(path => readFile(join(root, path), "utf8")));
  const hashes = Object.fromEntries(paths.map((path, i) => [path, hash(inputs[i]!.replace(/\r\n?/g, "\n"))]));
  const semanticSql = inputs[8]!, dataSql = inputs[4]!;
  if (nativeRunning) stop("concurrent-native-run"); nativeRunning = true; nativePsqlDiagnostic = undefined;
  const startedAt = new Date().toISOString(); let cleaned = false;
  try {
  nativeOperation = "source-create"; const sourceCluster = await createCluster();
  let sourceTypeOid = "", physicalEnumOidsDiffer = false;
  nativeOperation = "source-setup"; const setup = await session(sourceCluster);
  try { await setup.query(sourceFixture); sourceTypeOid = (await setup.query("SELECT 'public.fixture_state'::pg_catalog.regtype::pg_catalog.oid::text;"))[0] ?? ""; }
  finally { await setup.close(); }
  const context: PairedRecoveryContext = { schemaVersion: 1, projectRef: "mhkoayftiuojxlrkollf", sourceCommit: hash("synthetic-native-paired-recovery-code/" + canonicalDeltaJson(hashes)).slice(0, 40),
    scopeDigest: digestDeltaProofPayload({ kind: "native-paired-recovery-fixture-scope", hashes }), targetBindingHash: sourceCluster.targetBindingHash, beforeRoot: hash("preflight-before"),
    collectorSha256: hashes[paths[8]!]!, canonicalizerSha256: hashes[paths[9]!]!, dataCollectorSha256: hashes[paths[4]!]!, dataNormalizerSha256: hashes[paths[3]!]!,
    extensionProfileHash: hash("preflight-extensions"), toolProfileHash: digestDeltaProofPayload({ server: SERVER_IMAGE, tool: NATIVE_COLLECTOR_IMAGES.tool, dumpVersion: "17.11" }),
    changeControlReferenceHash: hash("owned-network-none-fixture/no-unrelated-writers"), expiresAt: new Date(Date.now() + 900_000).toISOString(), maximumCaptureMs: 600_000, maximumRestoreMs: 600_000, maximumArchiveBytes: 64 * 1024 * 1024 };
  async function freshGlobals(cluster: Cluster) {
    const fresh = await session(cluster);
    try { await fresh.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL statement_timeout='60s';"); return parseSinglePsqlJson(await fresh.query(semanticSql)); }
    finally { try { await fresh.query("ROLLBACK;"); } finally { await fresh.close(); } }
  }
  async function openSource(ctx: PairedRecoveryContext, drift: PairedNativeDrift): Promise<PairedRecoverySource> {
    const sourceSession = await session(sourceCluster);
    return openPairedReadOnlySnapshot({ session: sourceSession, closeSession: () => sourceSession.close(), context: ctx, semanticSql, dataSql, targetBindingHash: sourceCluster.targetBindingHash,
      tools: { schema: async snapshot => { const bytes = await command(sourceCluster, "schema", Buffer.alloc(0), snapshot); try { return bytes.toString("utf8"); } finally { bytes.fill(0); } },
        archive: async snapshot => { const bytes = await command(sourceCluster, "archive", Buffer.alloc(0), snapshot);
          if (drift === "source-sequence" || drift === "source-role") { const writer = await session(sourceCluster); try { await writer.query(drift === "source-sequence" ? "SELECT nextval('public.paired_sequence');" : "ALTER ROLE service_role NOBYPASSRLS;"); } finally { await writer.close(); } }
          return bytes;
        }, roles: () => command(sourceCluster, "roles"), freshGlobalCollection: () => freshGlobals(sourceCluster) } });
  }
    nativeOperation = "source-preflight"; const preflight = await openSource(context, "none");
    const before = await preflight.inspect(); await preflight.close();
    Object.assign(context, { beforeRoot: before.fingerprint.rootSha256, extensionProfileHash: before.fingerprint.environment.extensionProfileHash });
    const cases: { case: string; result: string; stage?: string; faultEvidence?: Record<string, boolean> }[] = [];
    let successful: Awaited<ReturnType<typeof capturePairedRecovery>> | undefined;
    for (const drift of ["none", "restored-row", "restored-sequence", "restored-role", "restored-schema", "archive-tamper", "restore-error", "source-sequence", "source-role"] as const) {
      // Each case is an independent bounded fixture attempt with its own actual exported snapshot.
      Object.assign(context, { expiresAt: new Date(Date.now() + 900_000).toISOString() });
      nativeOperation = `case-${drift}`; const privateStore = await createPrivateRecoveryAttempt({ repoRoot: root });
      let archiveCluster = sourceCluster;
      let tamperApplied = false, roleInputDelivered = false, restoreFaultInstalled = false, restoreCommandInvoked = false;
      const templateDrop = createOwnedTemplateDropProbe();
      try {
        const store = drift === "archive-tamper" ? { write: privateStore.write, seal: privateStore.seal,
          read: async (name: "database.dump" | "roles.sql" | "toc.list") => { const bytes = await privateStore.read(name);
            if (name === "database.dump") { bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; tamperApplied = true; }
            if (name === "roles.sql") roleInputDelivered = true; return bytes; } } : privateStore;
        const observation = await capturePairedRecovery(context, { now: () => new Date(), store,
          openSource: () => openSource(context, drift), inventoryArchive: input => command(archiveCluster, "inventory", input),
          createOwnedTarget: async (): Promise<PairedRecoveryOwnedTarget> => {
            const target = await createCluster(); archiveCluster = target;
            return { restore: async (archive, roles) => {
              const roleSession = await session(target); try {
                await roleSession.query(restoreRoleDefinitions(roles));
                // Closed owned-fixture fault: pg_restore must fail to DROP this template database.
                if (drift === "restore-error") { await roleSession.query('ALTER DATABASE "postgres" IS_TEMPLATE true;'); restoreFaultInstalled = true; }
              } finally { await roleSession.close(); }
              const restoreOutput = await command(target, "restore", archive, undefined, drift === "restore-error" ? {
                invoked: () => { restoreCommandInvoked = true; }, stderr: templateDrop.observe,
              } : undefined); restoreOutput.fill(0);
              if (targetDrift[drift]) { const mutate = await session(target); try { await mutate.query(targetDrift[drift]!); } finally { await mutate.close(); } }
            }, inspect: async () => {
              const targetSession = await session(target);
              if (drift === "none") { const targetOid = (await targetSession.query("SELECT 'public.fixture_state'::pg_catalog.regtype::pg_catalog.oid::text;"))[0] ?? "";
                physicalEnumOidsDiffer = /^\d+$/.test(sourceTypeOid) && /^\d+$/.test(targetOid) && sourceTypeOid !== targetOid; }
              const snapshot = await openPairedReadOnlySnapshot({ session: targetSession, closeSession: () => targetSession.close(), context, semanticSql, dataSql, targetBindingHash: target.targetBindingHash,
                tools: { schema: async snapshot => { const bytes = await command(target, "schema", Buffer.alloc(0), snapshot); try { return bytes.toString("utf8"); } finally { bytes.fill(0); } },
                  archive: async () => stop("target-dump-unavailable"), roles: async () => stop("target-roles-unavailable"), freshGlobalCollection: () => freshGlobals(target) } });
              try { return await snapshot.inspect(); } finally { await snapshot.close(); }
            }, close: () => removeCluster(target) };
          } });
        if (drift !== "none") stop("native-drift-accepted"); successful = observation; cases.push({ case: drift, result: "ACTUAL_PRIVATE_ARCHIVE_RESTORED_EQUAL" });
      } catch (error) {
        if (drift === "none" || !(error instanceof PairedRecoveryFailure)) throw error;
        if (error.outcome.containmentRequired) stop("native-cleanup-uncertainty");
        const expectedStage = drift === "source-sequence" || drift === "source-role" ? "source-after" : drift === "archive-tamper" ? "private-read" : drift === "restore-error" ? "restore" : "restored-inspection";
        if (error.stage !== expectedStage || error.outcome.targetRestoreAttempted !== (drift !== "archive-tamper" && drift !== "source-sequence" && drift !== "source-role")) stop("unexpected-native-rejection-stage");
        if (drift === "archive-tamper" && (!tamperApplied || !roleInputDelivered)) stop("archive-fault-not-exercised");
        if (drift === "restore-error" && (!restoreFaultInstalled || !restoreCommandInvoked || !templateDrop.seen())) stop("restore-command-fault-not-exercised");
        cases.push({ case: drift, result: "REJECTED_HOLD", stage: error.stage,
          ...(drift === "archive-tamper" ? { faultEvidence: { archiveCopyTamperedAfterRead: true, roleInputDelivered: true, restoreAttempted: false } } : {}),
          ...(drift === "restore-error" ? { faultEvidence: { templateFaultAcknowledged: true, restoreCommandSpawned: true, expectedTemplateDropErrorObserved: true } } : {}) });
      }
    }
    if (!successful || cases.length !== 9 || !physicalEnumOidsDiffer) stop("native-case-coverage");
    await removeCluster(sourceCluster); cleaned = true;
    const afterHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, hash((await readFile(join(root, path), "utf8")).replace(/\r\n?/g, "\n"))] as const)));
    if (canonicalDeltaJson(afterHashes) !== canonicalDeltaJson(hashes)) stop("input-source-drift");
    const receipt = { schemaVersion: 1, kind: "owned-native-paired-recovery-rehearsal", status: "NATIVE_FIXTURE_PASSED_RELEASE_HOLD", validReleaseEvidence: false,
      productionEquivalent: false, sourceLedgerSynthetic: true, sourceCommitSynthetic: true, providerAuthTested: false, databaseRoleFixtureSuperuser: true,
      startedAt, finishedAt: new Date().toISOString(), serverVersionNum: "170006", dumpVersion: "17.11", serverImage: SERVER_IMAGE, toolImage: NATIVE_COLLECTOR_IMAGES.tool,
      sourceRowValuesPublic: false, archiveContentsPublic: false, ownedSourceAndTargetsCleanup: "confirmed", codeInputs: hashes, inputHashesUnchanged: true,
      physicalEnumOidsDiffer, cases, pairedObservation: successful, storageObjectBytesCovered: false, rolePasswordsCovered: false, platformEncryptionKeysCovered: false, walPitrCovered: false, extensionBinariesRecoveredFromArchive: false };
    return { ...receipt, contentDigest: digestDeltaProofPayload(receipt) };
  } finally {
    let failed = false;
    for (const resource of [...owned].reverse()) { try { await remove(resource); } catch { failed = true; } }
    nativeRunning = false;
    if (failed || (!cleaned && owned.size)) stop("final-owned-cleanup");
  }
}

export async function pairedRecoveryNativeMain(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== "--output" || !/^docs\/verification\/phase3-paired-recovery\/native-[a-z0-9-]+\.json$/.test(args[1]!)) stop("fixed-output-path-required");
  const root = await realpath(process.cwd()), output = resolve(root, args[1]!);
  try { await lstat(output); stop("output-already-exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const relative of ["docs", "docs/verification", "docs/verification/phase3-paired-recovery"]) {
    const directory = resolve(root, relative);
    try { const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) stop("output-directory"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await mkdir(directory); }
  }
  const receipt = await runOwnedPairedRecovery(root); await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ status: receipt.status, validReleaseEvidence: false, contentDigest: receipt.contentDigest }));
}
const ownEntry = process.argv[1] ? resolve(process.argv[1]) : "";
if (ownEntry && ownEntry === fileURLToPath(import.meta.url)) pairedRecoveryNativeMain().catch(() => { console.error(JSON.stringify({ status: "HOLD", validReleaseEvidence: false, error: "owned-paired-recovery-failed" })); process.exitCode = 1; });
