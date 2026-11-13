import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeltaPacket, ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256, type DeltaFunctionExpectation } from "./delta-packet";
import { buildDeltaSemanticFingerprint, canonicalizeDeltaSchemaExport, DELTA_DUMP_RESTRICT_KEY,
  assertDeltaInvariantTransition, normalizeDeltaInvariant, parseDeltaSemanticCollection } from "./delta-fingerprint";
import { digestDeltaProofPayload } from "./delta-evidence";
import { DELTA_FINALIZE_CONSTRAINTS_SQL } from "./delta-program";
import { openFramedPsqlSession, parseSinglePsqlJson, PsqlTransportError, type FramedPsqlSession } from "./delta-psql-session";
// @ts-expect-error The existing pure executable SQL parser has no declaration file.
import { topLevelStatements } from "../audit/b2-bootstrap-profile.mjs";

export const NATIVE_COLLECTOR_IMAGES = Object.freeze({
  server: "public.ecr.aws/supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00",
  tool: "public.ecr.aws/supabase/postgres@sha256:06ddc7962e11ab0f4f0334fd05671e97c30ea202f6e6a7113800bd3d6e416108",
});
export type NativeCollectorProfile = "cached-17.6-partial" | "source6-17.6.1.081";
export const NATIVE_COLLECTOR_PROFILES = Object.freeze({
  "cached-17.6-partial": Object.freeze({serverImage:NATIVE_COLLECTOR_IMAGES.server,receipt:"docs/verification/phase3-protected-delta/native-collectors-20261114.json"}),
  "source6-17.6.1.081": Object.freeze({serverImage:"public.ecr.aws/supabase/postgres@sha256:b7c9e3315b351a747af1763d3e78e990b2ae97fbdcf5d538d08a3dd6723a88a4",receipt:"docs/verification/phase3-protected-delta/native-collectors-source6-20261114.json"}),
});
function profileSpec(profile:unknown) {
  if(profile!=="cached-17.6-partial"&&profile!=="source6-17.6.1.081")reject("fixture-profile");
  return NATIVE_COLLECTOR_PROFILES[profile];
}
const LABEL = "adfocate.native-collectors";
const DOCKER = process.platform === "win32" ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe" : "docker";
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
const UUID = /^[a-f0-9]{32}$/;
const ID = /^[a-f0-9]{64}$/;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const signatures = ["private.join_mission(uuid)", "public.accept_application(uuid)"] as const;
const extensionProfile = [
  { name: "pg_stat_statements", schema: "extensions", version: "1.11" }, { name: "pgcrypto", schema: "extensions", version: "1.3" },
  { name: "plpgsql", schema: "pg_catalog", version: "1.0" }, { name: "supabase_vault", schema: "vault", version: "0.3.1" },
  { name: "uuid-ossp", schema: "extensions", version: "1.1" }, { name: "vector", schema: "public", version: "0.8.0" },
] as const;
let nativeHost: string | undefined;
let nativeRunning = false;
const isLocalDockerHost = (value: string) => /^npipe:\/{2,}\.\/pipe\/[A-Za-z0-9_.-]+$/.test(value) || /^unix:\/\/\/[A-Za-z0-9_./-]+$/.test(value);
function dockerEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA"])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  // Context selection is used only for the initial public endpoint lookup. Every
  // later operation pins that local endpoint explicitly and drops context env.
  if (!nativeHost) for (const key of ["DOCKER_CONTEXT", "DOCKER_HOST"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}
const dockerPrefix = () => nativeHost ? ["--host", nativeHost] : [];
class NativeCollectorError extends Error {
  constructor(readonly stage: string) { super(`Owned native collector fixture stopped: ${stage}`); this.name = "NativeCollectorError"; }
}
function reject(stage: string): never { throw new NativeCollectorError(stage); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("metadata-shape");
  return value as Record<string, unknown>;
}
function one(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) reject("one-owned-resource-required");
  return record(value[0]);
}
export interface NativeOwnedResource {
  readonly token: string; readonly role: "server" | "tool"; readonly profile: NativeCollectorProfile; readonly name: string; readonly image: string; readonly imageId: string;
  readonly tmpfs: readonly string[]; readonly serverId?: string; id?: string;
}
export function nativeOwnedResource(token: string, role: "server" | "tool", imageId: string, imageVolumes: readonly string[], serverId?: string, profile:NativeCollectorProfile="cached-17.6-partial"): NativeOwnedResource {
  const spec=profileSpec(profile);
  if (!UUID.test(token) || !IMAGE.test(imageId) || !["server", "tool"].includes(role)
    || imageVolumes.some(volume => !["/var/lib/postgresql", "/var/lib/postgresql/data"].includes(volume))
    || new Set(imageVolumes).size !== imageVolumes.length || (role === "tool" ? !ID.test(serverId ?? "") : serverId !== undefined)) reject("ownership-profile");
  return { token, role, profile, name: `adfocate-native-collectors-${token}-${role}`, image: role==="server"?spec.serverImage:NATIVE_COLLECTOR_IMAGES.tool, imageId,
    tmpfs: ["/tmp", "/tmp/fixture-data", "/tmp/fixture-socket", ...imageVolumes].sort(), ...(serverId ? { serverId } : {}) };
}
/** This validator is required before start, every session opening and cleanup. */
export function assertNativeOwnedContainer(value: unknown, owned: NativeOwnedResource): Record<string, unknown> {
  const row = one(value), config = record(row.Config), host = record(row.HostConfig), state = record(row.State);
  const labels = record(config.Labels), logging = record(host.LogConfig), tmpfs = record(host.Tmpfs);
  const mounts = row.Mounts;
  if (typeof row.Id !== "string" || !ID.test(row.Id) || (owned.id !== undefined && row.Id !== owned.id)
    || row.Name !== `/${owned.name}` || row.Image !== owned.imageId || config.Image !== owned.image || config.User !== "100:101"
    || labels[LABEL] !== owned.token || labels[`${LABEL}.role`] !== owned.role || labels[`${LABEL}.profile`] !== owned.profile || labels[`${LABEL}.namespace`] !== (owned.serverId ?? "none")
    || host.NetworkMode !== (owned.role === "server" ? "none" : `container:${owned.serverId}`)
    || logging.Type !== "none" || host.ReadonlyRootfs !== true || host.Privileged !== false || host.PublishAllPorts !== false
    || (host.PortBindings !== null && Object.keys(record(host.PortBindings)).length !== 0)
    || !Array.isArray(host.CapDrop) || host.CapDrop.length !== 1 || host.CapDrop[0] !== "ALL"
    || (Array.isArray(host.CapAdd) && host.CapAdd.length !== 0)
    || !Array.isArray(host.SecurityOpt) || host.SecurityOpt.length !== 1 || !["no-new-privileges", "no-new-privileges:true"].includes(String(host.SecurityOpt[0]))
    || !Array.isArray(mounts) || mounts.some(mount => record(mount).Type !== "tmpfs")
    || Object.keys(tmpfs).sort().join("\n") !== [...owned.tmpfs].sort().join("\n")
    || host.PidsLimit !== 256 || host.Memory !== 1073741824 || host.NanoCpus !== 1000000000
    || state.OOMKilled !== false || (Array.isArray(host.Binds) && host.Binds.length !== 0)
    || (Array.isArray(host.VolumesFrom) && host.VolumesFrom.length !== 0)) reject("owned-container-isolation");
  return row;
}
interface Command { readonly ok: boolean; readonly code: number | null; readonly stdout: string }
async function docker(args: readonly string[], timeout = 30000): Promise<Command> {
  // Docker is restricted to the locally verified context; never forward libpq credentials.
  const env = dockerEnvironment();
  return new Promise(resolveCommand => {
    execFile(DOCKER, [...dockerPrefix(), ...args], { encoding: "utf8", windowsHide: true, shell: false, env, timeout,
      maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      resolveCommand({ ok: !error, code: error ? (typeof error.code === "number" ? error.code : null) : 0, stdout: String(stdout) });
    });
  });
}
async function requireDocker(args: readonly string[], stage: string, timeout?: number) {
  const result = await docker(args, timeout); if (!result.ok) reject(stage); return result.stdout.trim();
}
async function inspect(owned: NativeOwnedResource) {
  const output = await requireDocker(["container", "inspect", owned.id ?? owned.name], "owned-inspect");
  let parsed: unknown; try { parsed = JSON.parse(output); } catch { reject("owned-inspect-json"); }
  return assertNativeOwnedContainer(parsed, owned);
}
const serverScript = `set -eu
umask 077
test "$(id -u)" = 100
test "$(id -g)" = 101
unset PGPASSWORD PGOPTIONS PGSERVICE PGSERVICEFILE PGHOSTADDR PGSSLCERT PGSSLKEY
export HOME=/tmp PGPASSFILE=/tmp/fixture-no-passfile
initdb -D /tmp/fixture-data -U postgres --auth=trust --no-locale -E UTF8 >/tmp/fixture-init.log 2>&1
exec postgres -D /tmp/fixture-data -c listen_addresses='127.0.0.1' -c unix_socket_directories=/tmp/fixture-socket -c shared_preload_libraries='' -c session_preload_libraries='' -c log_statement=none -c logging_collector=off >/tmp/fixture-server.log 2>&1
`;
async function createOwned(owned: NativeOwnedResource) {
  const args = ["container", "create", "--pull=never", "--name", owned.name, "--label", `${LABEL}=${owned.token}`,
    "--label", `${LABEL}.role=${owned.role}`, "--label", `${LABEL}.profile=${owned.profile}`, "--label", `${LABEL}.namespace=${owned.serverId ?? "none"}`,
    `--network=${owned.role === "server" ? "none" : `container:${owned.serverId}`}`, "--log-driver=none", "--read-only", "--user=100:101", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=1g", "--cpus=1", "--env", "HOME=/tmp"];
  for (const path of owned.tmpfs) {
    const options = path === "/tmp" ? "rw,nosuid,nodev,noexec,size=128m,mode=1777" : path === "/tmp/fixture-data"
      ? "rw,nosuid,nodev,noexec,size=1g,mode=0700,uid=100,gid=101" : path === "/tmp/fixture-socket"
      ? "rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=100,gid=101" : "rw,nosuid,nodev,noexec,size=16m,mode=1777";
    args.push("--tmpfs", `${path}:${options}`);
  }
  args.push("--entrypoint", "/bin/sh", owned.image, "-c", owned.role === "server" ? serverScript : "set -eu; exec sleep 3600");
  const id = await requireDocker(args, "owned-create"); if (!ID.test(id)) reject("owned-create-id"); owned.id = id;
  await inspect(owned);
}
async function removeOwned(owned: NativeOwnedResource): Promise<boolean> {
  try {
    const row = await inspect(owned); const id = String(row.Id); owned.id = id;
    const removed = await requireDocker(["container", "rm", "--force", id], "owned-remove");
    if (removed !== id) return false;
    const absent = await docker(["container", "inspect", id]);
    return !absent.ok && absent.code === 1 && absent.stdout.trim() === "[]";
  } catch { return false; }
}
async function psql(owned: NativeOwnedResource): Promise<FramedPsqlSession> {
  await inspect(owned);
  const session = await openFramedPsqlSession(DOCKER, [...dockerPrefix(), "exec", "-i", "--user=100:101", owned.id!, "psql", "-X", "-w", "-q", "-t", "-A",
    "-v", "ON_ERROR_STOP=1", "-h", "/tmp/fixture-socket", "-U", "postgres", "-d", "postgres"], { timeoutMs: 60000, maxOutputBytes: 32 * 1024 * 1024 },
    { spawn: (file,args,options) => spawn(file,[...args],{...options,env:dockerEnvironment()}) });
  await session.query("SET client_min_messages='warning';");
  return session;
}
async function jsonQuery(session: FramedPsqlSession, sql: string): Promise<Record<string, unknown>> { return record(parseSinglePsqlJson(await session.query(sql))); }
async function readInput(root: string) {
  const paths = ["scripts/release/delta-fingerprint.ts", "scripts/release/delta-fingerprint.test.ts", "scripts/release/delta-semantic-capture.sql", "scripts/release/delta-invariant-capture.sql",
    "scripts/release/delta-native-collectors.ts", "supabase/migrations/20261113090001_active_assignment_xp_neutrality.sql",
    "supabase/migrations/20260805120000_review_hardening.sql", "supabase/migrations/0010_applications.sql",
    "docs/verification/2026-11-13-phase3-delta-catalog.snapshot.json", "scripts/release/delta-packet.ts", "scripts/release/delta-release-contracts.ts",
    "scripts/release/delta-evidence.ts", "scripts/release/delta-psql-session.ts", "scripts/release/delta-program.ts"];
  if(DELTA_FINALIZE_CONSTRAINTS_SQL!=="SET CONSTRAINTS ALL IMMEDIATE;")reject("fixed-constraint-finalization-sql");
  const values = await Promise.all(paths.map(path => readFile(join(root,path),"utf8")));
  const sourceSql = values[5]!.replace(/\r\n?/g,"\n");
  if (hash(sourceSql) !== ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256) reject("reviewed-source-hash");
  const sourceExtensions = record(JSON.parse(values[8]!)).extensions;
  if (digestDeltaProofPayload(sourceExtensions) !== digestDeltaProofPayload(extensionProfile)) reject("public-extension-profile");
  const names = ["private.join_mission", "public.accept_application"];
  const predecessorSql = values.slice(6,8).map((sql,index) => {
    const found = (topLevelStatements(sql.replace(/\r\n?/g,"\n")) as string[]).filter(statement => statement.startsWith(`create or replace function ${names[index]}(`));
    if (found.length !== 1) reject("canonical-predecessor-extraction"); return found[0]!;
  });
  const predecessors: DeltaFunctionExpectation[] = signatures.map((signature,index) => {
    const match = /as \$\$([\s\S]*)\$\$$/i.exec(predecessorSql[index]!); if (!match) reject("canonical-predecessor-body");
    return { signature, bodySha256: hash(match[1]!), owner: "postgres", securityDefiner: true, config: ["search_path=public"],
      execute: { public: false, anon: false, authenticated: false, service_role: index === 1 } };
  });
  const checkpoints = Array.from({length:17},(_,i) => ({ version: `202610010000${String(i).padStart(2,"0")}`, name: `native_synthetic_checkpoint_${String(i).padStart(2,"0")}`,
    sql: `SELECT ${i}::integer AS synthetic_native_checkpoint;` }));
  const packet = buildDeltaPacket({ baselineHistory: checkpoints.map(row => ({ version:row.version,name:row.name,statementCount:1,statementsSha256:hash(row.sql) })),
    predecessors,delta:{version:"20261113090001",name:"active_assignment_xp_neutrality",sourceSql,sourceSha256:ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256} });
  const statements = topLevelStatements(packet.sql) as string[];
  if (statements.length!==6 || statements[0]!=="BEGIN" || statements.at(-1)!=="COMMIT") reject("packet-envelope");
  const dos=statements.filter(statement=>statement.startsWith("DO $delta_packet_")); if(dos.length!==1)reject("packet-one-do");
  const setup = `create schema auth;create schema private;create schema storage;create schema supabase_migrations;create schema extensions;create schema vault;
    create role anon;create role authenticated;create role service_role bypassrls;
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create table public.creators(id uuid primary key,xp integer not null default 217);
    create table public.mission_submissions(id uuid primary key,xp_awarded integer not null default 93,status text default 'joined');
    insert into public.creators(id)values('00000000-0000-4000-8000-000000000011');
    insert into public.mission_submissions(id)values('00000000-0000-4000-8000-000000000021');
    create function public.native_alias(integer) returns integer language sql immutable as $$select $1$$;
    create function public.native_alias(text) returns text language sql immutable as $$select $1$$;
    create type public.native_ref_box as(value regproc);create domain public.native_ref_domain as regproc;
    create table public.native_refs(s regproc,c public.native_ref_box,a regproc[],d public.native_ref_domain);
    insert into public.native_refs select r,row(r)::public.native_ref_box,array[r],r::public.native_ref_domain from(select 'public.native_alias(integer)'::regprocedure::oid::regproc r)t;
    create table public.native_probe(id integer primary key,marker text,values_array integer[],raw_json json);
    insert into public.native_probe values(1,'synthetic',array[1,2],'{"a":1,"a":2}');
    create table storage.buckets(id text primary key,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    insert into storage.buckets values('native-synthetic',false,1000,array['image/png']);
    create table supabase_migrations.schema_migrations(version varchar primary key,name text,statements text[]);
    ${predecessorSql.map(sql=>sql+';').join("\n")}
    revoke all on function private.join_mission(uuid)from public,anon,authenticated,service_role;
    revoke all on function public.accept_application(uuid)from public,anon,authenticated;
    grant execute on function public.accept_application(uuid)to service_role;
    ${checkpoints.map(row=>`${row.sql}\nINSERT INTO supabase_migrations.schema_migrations VALUES(${literal(row.version)},${literal(row.name)},ARRAY[${literal(row.sql)}]);`).join("\n")}`;
  return { paths, values, sourceSql, predecessors, packet, packetDo:dos[0]!+";", setup, checkpoints,
    semanticSql:values[2]!,invariantSql:values[3]!,hashes:Object.fromEntries(paths.map((path,i)=>[path,hash(values[i]!)])) };
}
async function captureInvariant(session: FramedPsqlSession, sql: string) { return normalizeDeltaInvariant(parseSinglePsqlJson(await session.query(sql))); }
async function checkedTransition(owned:NativeOwnedResource, invariantSql:string, packetDo:string,phase:"first"|"replay") {
  const session=await psql(owned);
  try {
    await session.query("BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';");
    const before=await captureInvariant(session,invariantSql);
    await session.query(`${packetDo}\n${DELTA_FINALIZE_CONSTRAINTS_SQL}`);
    const after=await captureInvariant(session,invariantSql);
    const proof=assertDeltaInvariantTransition(before,after,phase);await session.query("COMMIT;");
    return {before,after,proof,assertedBeforeCommit:true,constraintsFinalizedBeforeInvariant:true,finalizeConstraintsSha256:hash(DELTA_FINALIZE_CONSTRAINTS_SQL)};
  }catch(error){if(!session.closed)await session.query("ROLLBACK;").catch(()=>undefined);throw error;}
  finally{if(!session.closed)await session.close();}
}
async function deferredConstraintRegression(owned:NativeOwnedResource,invariantSql:string) {
  const session=await psql(owned);
  try {
    await session.query("BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL statement_timeout='60s';");
    const baseline=await captureInvariant(session,invariantSql);
    await session.query(`CREATE TEMP TABLE native_deferred_ledger(id integer);
      CREATE FUNCTION pg_temp.native_deferred_update() RETURNS trigger LANGUAGE plpgsql AS $native_deferred$
      BEGIN UPDATE public.creators SET xp=xp+1; RETURN NEW; END; $native_deferred$;
      CREATE CONSTRAINT TRIGGER native_deferred_writer AFTER INSERT ON pg_temp.native_deferred_ledger
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.native_deferred_update();`);
    const before=await captureInvariant(session,invariantSql);
    await session.query("INSERT INTO pg_temp.native_deferred_ledger VALUES(1);");
    const unflushed=await captureInvariant(session,invariantSql);
    // Temp rows are outside the application-data scope. This must reproduce the
    // original gap: queued trigger work is invisible until explicitly finalized.
    assertDeltaInvariantTransition(before,unflushed,"replay");
    await session.query(DELTA_FINALIZE_CONSTRAINTS_SQL);
    const flushed=await captureInvariant(session,invariantSql);
    if(flushed.dataSha256===before.dataSha256||flushed.catalogSha256!==before.catalogSha256)reject("deferred-flush-did-not-isolate-application-data-change");
    let rejected=false;try{assertDeltaInvariantTransition(before,flushed,"replay");}catch{rejected=true;}
    if(!rejected)reject("deferred-trigger-change-not-rejected");
    await session.query("ROLLBACK;BEGIN ISOLATION LEVEL REPEATABLE READ;");
    const restored=await captureInvariant(session,invariantSql);
    if(restored.dataSha256!==baseline.dataSha256||restored.migrationRows!==18)reject("deferred-trigger-rollback-did-not-restore-data");
    await session.query("ROLLBACK;");
    return {case:"deferred-constraint-trigger",result:"REJECTED_BEFORE_COMMIT",rollbackAcknowledged:true,
      withoutFlushInvariantPassed:true,flushChangedApplicationData:true,restoredAfterRollback:true,
      finalizeConstraintsSha256:hash(DELTA_FINALIZE_CONSTRAINTS_SQL)};
  }catch(error){if(!session.closed)await session.query("ROLLBACK;").catch(()=>undefined);throw error;}
  finally{if(!session.closed)await session.close();}
}
async function imageMetadata(role:"server"|"tool",profile:NativeCollectorProfile) {
  const image=role==="server"?profileSpec(profile).serverImage:NATIVE_COLLECTOR_IMAGES.tool;
  const output=await requireDocker(["image","inspect","--format","{{.Id}}|{{json (index .Config \"Volumes\")}}",image],"cached-image-inspect");
  const split=output.indexOf("|");if(split<0)reject("cached-image-format");const id=output.slice(0,split);const raw=JSON.parse(output.slice(split+1)) as unknown;
  const volumes=raw===null?[]:Object.keys(record(raw));if(!IMAGE.test(id))reject("cached-image-id");return{id,volumes};
}
async function waitReady(owned:NativeOwnedResource) {
  for(let attempt=0;attempt<30;attempt++){
    const probe=await docker(["exec",owned.id!,"pg_isready","-q","-h","/tmp/fixture-socket","-U","postgres","-d","postgres"],5000);
    if(probe.ok)return;
    const row=await inspect(owned);if(record(row.State).Running!==true)reject("owned-server-exited-before-ready");
    await new Promise(resolveWait=>setTimeout(resolveWait,250));
  }reject("owned-server-ready-timeout");
}
async function nativeNamespace(owned:NativeOwnedResource) {
  await inspect(owned);
  const output=await requireDocker(["exec",owned.id!,"/bin/sh","-c","printf '%s\\n' /sys/class/net/*; wc -l < /proc/net/route; readlink /proc/self/ns/net"],"owned-network-namespace");
  const lines=output.split(/\r?\n/).map(value=>value.trim());
  if(lines.length!==3||lines[0]!=="/sys/class/net/lo"||lines[1]!=="1"||!/^net:\[[0-9]+\]$/.test(lines[2]!))reject("external-network-route-or-interface");
  return lines[2]!;
}

/**
 * Explicitly invoked LOCAL synthetic test. No URLs, backups, credentials or target refs.
 * Reproduce through ViteNodeServer/ViteNodeRunner with createServer options
 * { configFile:false, envFile:false, plugins:[], server:{hmr:false,watch:null} }.
 * Do not use vite-node's default --script launcher: it loads project config/env.
 * Set process.argv to this file plus --run-owned-native-collectors, then executeFile.
 */
export async function runOwnedNativeCollectorFixture(rootDirectory:string,profile:NativeCollectorProfile="cached-17.6-partial") {
  const spec=profileSpec(profile);
  const root=await realpath(rootDirectory),startedAt=new Date().toISOString(),token=randomUUID().replaceAll("-","");
  const input=await readInput(root);const resources:NativeOwnedResource[]=[];let session:FramedPsqlSession|undefined;
  const receipt:Record<string,unknown>={schemaVersion:1,kind:"owned-native-collector-fixture",validReleaseEvidence:false,productionApplied:false,productionEquivalent:false,
    status:"ATTEMPTED_NOT_VERIFIED",profile,startedAt,images:{server:spec.serverImage,tool:NATIVE_COLLECTOR_IMAGES.tool},inputSha256:input.hashes,
    scope:{syntheticOnly:true,sourceDatabaseContacted:false,privateArchiveRead:false,credentialsSuppliedToFixture:false,network:"effective-external-none",serverNetworkMode:"none",toolNetworkMode:"container:owned-server",providerAuthTested:false,
      actualProductionBaseline:false,syntheticCheckpointCount:17,checkpointStatementsActuallyExecuted:false,fixturePostgresSuperuser:true},
    checks:{},limitations:["Synthetic checkpoint history is not the approved production 62-source/17-row baseline.",
      "initdb creates a local postgres superuser; this is not production-role privilege or provider HTTP/Auth proof.",
      "External schema-change control, recovery, deployment and release/pilot approval remain separate gates."],cleanup:{containers:"PENDING",publicTemporaryFiles:"NOT_USED_SHARED_NATIVE_NAMESPACE"}};
  const checks=receipt.checks as Record<string,unknown>;let stage="local-docker-context";
  if(nativeRunning)reject("native-fixture-already-running");nativeRunning=true;nativeHost=undefined;
  try{
    if(process.env.DOCKER_HOST&&!isLocalDockerHost(process.env.DOCKER_HOST))reject("nonlocal-docker-endpoint");
    const endpoint=await requireDocker(["context","inspect","--format","{{.Endpoints.docker.Host}}"],stage);
    if(!isLocalDockerHost(endpoint))reject("nonlocal-docker-endpoint");
    nativeHost=process.env.DOCKER_CONTEXT?endpoint:(process.env.DOCKER_HOST??endpoint);
    stage="server-create";const serverImage=await imageMetadata("server",profile);const owned=nativeOwnedResource(token,"server",serverImage.id,serverImage.volumes,undefined,profile);resources.push(owned);
    await createOwned(owned);await inspect(owned);await requireDocker(["container","start",owned.id!],"owned-server-start");await waitReady(owned);
    const uid=await requireDocker(["exec",owned.id!,"id","-u"],"fixture-uid"),gid=await requireDocker(["exec",owned.id!,"id","-g"],"fixture-gid");
    if(uid!=="100"||gid!=="101")reject("fixture-uid-gid");checks.isolation={network:"none",readOnlyRoot:true,noHostMounts:true,noPorts:true,capDropAll:true,noNewPrivileges:true,logDriver:"none",uid:100,gid:101,ownershipVerified:true};
    stage="native-bootstrap";session=await psql(owned);
    const identity=await jsonQuery(session,"SELECT jsonb_build_object('database',current_database(),'serverVersionNum',current_setting('server_version_num'),'currentRole',current_user,'sessionRole',session_user,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user));");
    if(identity.database!=="postgres"||identity.serverVersionNum!=="170006"||identity.currentRole!=="postgres"||identity.sessionRole!=="postgres"||identity.superuser!==true)reject("native-server-identity");checks.identity=identity;
    const checkpointResults=await session.query(input.setup);
    if(checkpointResults.length!==17||checkpointResults.some((row,index)=>row!==String(index)))reject("synthetic-checkpoint-execution");
    (receipt.scope as Record<string,unknown>).checkpointStatementsActuallyExecuted=true;
    checks.syntheticHistory={rows:17,kind:"actually-executed-select-checkpoints",metadataSha256:input.packet.baselineHistorySha256,productionEquivalent:false};
    stage="native-extension-install";
    const available=parseSinglePsqlJson(await session.query(`SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'version',version)ORDER BY name,version),'[]'::jsonb)FROM pg_available_extension_versions WHERE name IN (${extensionProfile.map(ext=>literal(ext.name)).join(",")});`));
    if(!Array.isArray(available))reject("extension-available-shape");
    const missing=extensionProfile.filter(ext=>!available.some(value=>record(value).name===ext.name&&record(value).version===ext.version));checks.extensionAvailability={expected:extensionProfile,available,missing,sourceProfileVerified:missing.length===0};
    // Missing source versions remain HOLD. Continue independent kernel checks
    // with exact available versions; never substitute or relabel another version.
    const availableExact=extensionProfile.filter(ext=>!missing.some(row=>row.name===ext.name));
    for(const ext of availableExact)if(ext.name!=="plpgsql")await session.query(`CREATE EXTENSION ${'"'+ext.name+'"'} WITH SCHEMA ${'"'+ext.schema+'"'} VERSION ${literal(ext.version)};`);
    const installed=parseSinglePsqlJson(await session.query("SELECT jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion)ORDER BY e.extname)FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace;"));
    if(digestDeltaProofPayload(installed)!==digestDeltaProofPayload(availableExact))reject("installed-extension-profile");checks.installedExtensions=installed;
    await session.close();session=undefined;
    stage="native-semantic-before";
    const semanticOnly=async()=>{const s=await psql(owned);try{await s.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");const raw=parseSinglePsqlJson(await s.query(input.semanticSql));const unsupported=record(raw).unsupported;
      if(Array.isArray(unsupported)&&unsupported.every(value=>typeof value==='string'&&/^[a-zA-Z0-9_:.-]{1,200}$/.test(value)))checks.nativeSemanticUnsupportedBefore=unsupported;
      const parsed=parseDeltaSemanticCollection(raw);await s.query("ROLLBACK;");return parsed;}finally{if(!s.closed)await s.close();}};
    const semanticBefore=await semanticOnly();checks.nativeSqlSemanticBefore={components:semanticBefore.components,extensionProfileHash:semanticBefore.extensionProfileHash};
    stage="owned-native-dumper";let dumpPath:string|undefined;let tool:NativeOwnedResource|undefined;
    try{
      await inspect(owned);const serverNamespace=await nativeNamespace(owned);
      const toolImage=await imageMetadata("tool",profile);tool=nativeOwnedResource(token,"tool",toolImage.id,toolImage.volumes,owned.id!,profile);resources.push(tool);
      await createOwned(tool);await inspect(tool);await requireDocker(["container","start",tool.id!],"owned-tool-start");
      const toolNamespace=await nativeNamespace(tool);if(toolNamespace!==serverNamespace)reject("owned-network-namespace-binding");
      checks.dumpNetwork={serverMode:"none",toolMode:"container:inspect-verified-owned-server",onlyLoopback:true,externalRoutes:0,namespaceHash:hash(serverNamespace),sameNamespaceVerified:true};
      const location="/nix/var/nix/profiles/default/bin/pg_dump";
      const version=await requireDocker(["exec",tool.id!,location,"--version"],"dump17-11-version");
      if(!/^pg_dump \(PostgreSQL\) 17\.11(?:\s|$)/.test(version))reject("dump17-11-version");
      const checksum=await requireDocker(["exec",tool.id!,"sha256sum",location],"public-dump-binary-hash");
      if(!/^[a-f0-9]{64}\s/.test(checksum))reject("public-dump-binary-hash-shape");checks.dumpBinarySha256=checksum.slice(0,64);
      dumpPath=location;checks.dumpVersion="17.11";
    }catch(error){checks.exportHold=error instanceof NativeCollectorError?error.stage:"public-dumper-unavailable";}
    const capture=async()=>{const s=await psql(owned);try{await s.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");const snapshot=parseSinglePsqlJson(await s.query("SELECT jsonb_build_object('snapshot',pg_export_snapshot());")) as {snapshot:string};
      const collection=parseDeltaSemanticCollection(parseSinglePsqlJson(await s.query(input.semanticSql)));
      if(!dumpPath){await s.query("ROLLBACK;");return {collection,fingerprint:null};}
      if(!/^[0-9A-F-]+$/i.test(snapshot.snapshot))reject("exported-snapshot-format");
      const exported=await docker(["exec",tool!.id!,dumpPath,"-h","127.0.0.1","-p","5432","-U","postgres","-d","postgres","-w","--schema-only","--create","--quote-all-identifiers",`--restrict-key=${DELTA_DUMP_RESTRICT_KEY}`,`--snapshot=${snapshot.snapshot}`],60000);
      if(!exported.ok)reject("full-schema-export");
      checks.dumpEnvelope={bytes:Buffer.byteLength(exported.stdout,'utf8'),sha256:hash(exported.stdout),
        simpleConnect:/^\\connect postgres\r?$/m.test(exported.stdout),quotedConnect:/^\\connect "postgres"\r?$/m.test(exported.stdout),
        reuseQuotedConninfo:/^\\connect -reuse-previous=on "dbname='postgres'"\r?$/m.test(exported.stdout),
        framingSequence:exported.stdout.split(/\r?\n/).flatMap(line=>line===`\\restrict ${DELTA_DUMP_RESTRICT_KEY}`?['restrict']:line===`\\unrestrict ${DELTA_DUMP_RESTRICT_KEY}`?['unrestrict']:/^\\connect (?:postgres|"postgres")$/.test(line)?['connect-postgres']:[])};
      canonicalizeDeltaSchemaExport(exported.stdout);
      const observedAt=new Date().toISOString();const fingerprint=buildDeltaSemanticFingerprint(exported.stdout,collection,{scopeDigest:hash("owned-native-synthetic-fixture-v1"),collectorSha256:hash(input.semanticSql),canonicalizerSha256:input.hashes[input.paths[0]!]!,
        targetBindingHash:hash(owned.id!),snapshotBindingHash:hash(snapshot.snapshot),observedAt,expiresAt:new Date(Date.parse(observedAt)+30*60000).toISOString(),environment:{serverVersionNum:"170006",dumpVersion:"17.11",extensionProfileHash:collection.extensionProfileHash,databaseName:"postgres"}});
      await s.query("ROLLBACK;");return {collection,fingerprint};}finally{if(!s.closed)await s.close();}};
    stage="native-before-export";let beforeCapture:Awaited<ReturnType<typeof capture>>;
    try{beforeCapture=await capture();}catch(error){checks.exportHold=error instanceof NativeCollectorError?error.stage:error instanceof Error&&/^Delta fingerprint rejected: [a-zA-Z0-9 ,()_-]+$/.test(error.message)?error.message:"schema-canonicalization-hold";dumpPath=undefined;beforeCapture=await capture();}
    stage="native-first-transaction";const first=await checkedTransition(owned,input.invariantSql,input.packetDo,"first");checks.first={beforeRows:first.before.migrationRows,afterRows:first.after.migrationRows,assertedBeforeCommit:first.assertedBeforeCommit,constraintsFinalizedBeforeInvariant:first.constraintsFinalizedBeforeInvariant,finalizeConstraintsSha256:first.finalizeConstraintsSha256,...first.proof};
    stage="native-after-export";const afterCapture=await capture();
    stage="native-replay-transaction";const replay=await checkedTransition(owned,input.invariantSql,input.packetDo,"replay");checks.replay={beforeRows:replay.before.migrationRows,afterRows:replay.after.migrationRows,assertedBeforeCommit:replay.assertedBeforeCommit,constraintsFinalizedBeforeInvariant:replay.constraintsFinalizedBeforeInvariant,finalizeConstraintsSha256:replay.finalizeConstraintsSha256,...replay.proof};
    stage="native-replay-export";const replayCapture=await capture();
    const stableCategories=["roles-and-memberships","database-role-settings","storage-configuration","extension-configuration","extension-members"];
    for(const category of stableCategories){const rows=[beforeCapture,afterCapture,replayCapture].map(c=>c.collection.components.find(v=>v.category===category));if(rows.some(row=>!row)||rows.some(row=>digestDeltaProofPayload(row)!==digestDeltaProofPayload(rows[0])))reject("unexpected-semantic-component-transition");}
    const fingerprints=[beforeCapture.fingerprint,afterCapture.fingerprint,replayCapture.fingerprint];
    if(fingerprints.every(value=>value!==null)){
      if(fingerprints[0]!.rootSha256===fingerprints[1]!.rootSha256||fingerprints[1]!.rootSha256!==fingerprints[2]!.rootSha256)reject("native-semantic-root-transition");
      checks.semanticRoots={before:fingerprints[0]!.rootSha256,after:fingerprints[1]!.rootSha256,replay:fingerprints[2]!.rootSha256,algorithm:"pg17-canonical-export-v1",snapshotBound:true};
    }
    stage="native-drift-rejection";const driftResults=[];
    const drifts=[{name:"catalog-type",sql:"CREATE TYPE public.native_drift AS ENUM('one','two');"},{name:"data",sql:"UPDATE public.native_probe SET marker='changed';"},
      {name:"array-lower-bound",sql:"UPDATE public.native_probe SET values_array='[0:1]={1,2}'::integer[];"},{name:"json-duplicate-key",sql:`UPDATE public.native_probe SET raw_json='{"a":2}'::json;`},
      {name:"regproc-scalar",sql:"UPDATE public.native_refs SET s='public.native_alias(text)'::regprocedure::oid::regproc;"},
      {name:"regproc-composite",sql:"UPDATE public.native_refs SET c=ROW('public.native_alias(text)'::regprocedure::oid::regproc)::public.native_ref_box;"},
      {name:"regproc-array",sql:"UPDATE public.native_refs SET a=ARRAY['public.native_alias(text)'::regprocedure::oid::regproc];"},
      {name:"regproc-domain",sql:"UPDATE public.native_refs SET d=('public.native_alias(text)'::regprocedure::oid::regproc)::public.native_ref_domain;"}];
    for(const drift of drifts){const s=await psql(owned);try{await s.query("BEGIN ISOLATION LEVEL REPEATABLE READ;");const before=await captureInvariant(s,input.invariantSql);
      const textHashSql="SELECT jsonb_build_object('sha256',encode(sha256(convert_to(t::text,'UTF8')),'hex')) FROM public.native_refs t;";
      const textBefore=drift.name.startsWith('regproc-')?await jsonQuery(s,textHashSql):null;
      await s.query(drift.sql);const after=await captureInvariant(s,input.invariantSql);
      if(textBefore){const textAfter=await jsonQuery(s,textHashSql);if(textBefore.sha256!==textAfter.sha256||before.catalogSha256!==after.catalogSha256||before.dataSha256===after.dataSha256)reject('native-regproc-collision-not-covered');}
      let rejected=false;try{assertDeltaInvariantTransition(before,after,"replay");}catch{rejected=true;}if(!rejected)reject("native-drift-not-rejected");await s.query("ROLLBACK;");driftResults.push({case:drift.name,result:"REJECTED_BEFORE_COMMIT",rollbackAcknowledged:true});
    }finally{if(!s.closed)await s.close();}}
    stage="native-deferred-constraint-rejection";
    driftResults.push(await deferredConstraintRegression(owned,input.invariantSql));
    checks.driftRejection=driftResults;
    checks.source= {sha256:ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256,packetSha256:input.packet.sqlSha256,doSha256:hash(input.packetDo),
      applySqlSha256:hash(`${input.packetDo}\n${DELTA_FINALIZE_CONSTRAINTS_SQL}`),finalizeConstraintsExport:"DELTA_FINALIZE_CONSTRAINTS_SQL",finalizeConstraintsSha256:hash(DELTA_FINALIZE_CONSTRAINTS_SQL),
      predecessorBodySha256:input.predecessors.map(v=>({signature:v.signature,sha256:v.bodySha256})),packetWrapperCommitExecuted:false};
    const current=await Promise.all(input.paths.map(path=>readFile(join(root,path),"utf8")));if(current.some((value,i)=>hash(value)!==hash(input.values[i]!)))reject("inputs-changed-during-native-test");checks.inputHashesAfter="UNCHANGED";
    receipt.status=missing.length?(dumpPath?"NATIVE_SQL_EXPORT_AND_DELTA_REPLAY_VERIFIED_SOURCE_PROFILE_HOLD":"NATIVE_SQL_AND_DELTA_REPLAY_VERIFIED_SOURCE_PROFILE_HOLD")
      :dumpPath?"NATIVE_SQL_EXPORT_AND_DELTA_REPLAY_VERIFIED":"NATIVE_SQL_AND_DELTA_REPLAY_VERIFIED_EXPORT_HOLD";
    const holdReasons=[];
    if(missing.length)holdReasons.push("Exact source extension versions are unavailable; source-six equivalence is unverified.");
    if(!dumpPath)holdReasons.push("Full-schema export or canonicalization remains unverified.");
    if(holdReasons.length)receipt.holdReasons=holdReasons;
  }catch(error){receipt.status="HOLD";receipt.failure={stage,code:error instanceof NativeCollectorError?error.stage:error instanceof PsqlTransportError?error.code:"collector-or-fixture-verification",...(error instanceof PsqlTransportError&&error.sqlState?{sqlState:error.sqlState}:{})};}
  finally{
    if(session&&!session.closed)await session.abort().catch(()=>undefined);
    const cleanup=[];for(const owned of [...resources].reverse())cleanup.push({role:owned.role,resourceHash:hash(owned.id??owned.name),confirmed:await removeOwned(owned)});
    (receipt.cleanup as Record<string,unknown>).containers=cleanup;
    if(cleanup.some(row=>!row.confirmed))receipt.status="HOLD";
    receipt.finishedAt=new Date().toISOString();receipt.contentDigest=digestDeltaProofPayload(receipt);nativeHost=undefined;nativeRunning=false;
  }
  return receipt;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);let profile:NativeCollectorProfile="cached-17.6-partial";
  if(args[0]!=="--run-owned-native-collectors"||args.length>2)throw new NativeCollectorError("explicit-native-fixture-flag-required");
  if(args.length===2){if(args[1]!=="--profile=source6-17.6.1.081"&&args[1]!=="--profile=cached-17.6-partial")reject("fixture-profile");profile=args[1].slice("--profile=".length)as NativeCollectorProfile;}
  const root=await realpath(process.cwd());const result=await runOwnedNativeCollectorFixture(root,profile);const receiptPath=profileSpec(profile).receipt;const target=join(root,receiptPath);
  try{const old=record(JSON.parse(await readFile(target,"utf8")));if(old.kind!=="owned-native-collector-fixture"||old.validReleaseEvidence!==false)reject("existing-receipt-profile");
    result.previousAttempts=[...(Array.isArray(old.previousAttempts)?old.previousAttempts:[]),{startedAt:old.startedAt,finishedAt:old.finishedAt,status:old.status,
      failure:old.failure??null,contentDigest:old.contentDigest,cleanup:old.cleanup,
      ...(Object.hasOwn(record(old.scope),"credentialsRead")?{launcher:"default-vite-node-config-unverified-no-native-container-created"}:{})}];
    delete result.contentDigest;result.contentDigest=digestDeltaProofPayload(result);
  }catch(error){if(record(error).code!=="ENOENT")throw error;}
  await mkdir(dirname(target),{recursive:true});await writeFile(target,JSON.stringify(result,null,2)+"\n",{encoding:"utf8"});
  console.log(JSON.stringify({status:result.status,validReleaseEvidence:false,receipt:receiptPath,contentDigest:result.contentDigest}));
  if(String(result.status).includes("HOLD"))process.exitCode=1;
}
