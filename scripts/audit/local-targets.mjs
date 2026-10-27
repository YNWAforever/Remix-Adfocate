// Operates only on the two disposable projects created for this authorized run.
// No SDK import, SQL connection, fixture or migration precedes Docker identity verification.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import { log } from "node:console";
import { assertAcceptanceTargetAllowed, verifyIntegrationIdentity } from "../run-integration-tests.mjs";
import { assertPhaseDependency } from "./b2-fixture-inventory.mjs";
import { FixtureJournal, journalOwnerSql } from "./fixture-journal.mjs";

const runId = "01a16483-e55d-7332-9ddc-7e8a3f68eb11";
const ownerAuthorization = "2026-10-23 user: you decide; local disposable targets only";
const root = process.cwd();
function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 120000, ...options, maxBuffer: 8 * 1024 * 1024 }).trim();
}
const sha = value => createHash("sha256").update(value).digest("hex");
const json = path => JSON.parse(readFileSync(path, "utf8"));
function localPath(path) {
  const absolute = resolve(root, path), rel = relative(root, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("B2 path must stay in the current worktree");
  return absolute;
}
// No Docker/key/client access here. A P0 approval is deliberately not runtime authority.
export function b2ExecutionContext(env = process.env) {
  if (!env.ADFOCATE_B2_MANIFEST_PATH) return null;
  const raw = readFileSync(localPath(env.ADFOCATE_B2_MANIFEST_PATH), "utf8");
  const manifest = JSON.parse(raw), manifestSha256 = sha(raw);
  const approval = env.ADFOCATE_B2_AUTHORIZATION_PATH && json(localPath(env.ADFOCATE_B2_AUTHORIZATION_PATH));
  if (manifest.kind !== "D19_B2_EXECUTION_SPEC" || manifest.schemaVersion !== 2 || manifest.specificationReady !== true
    || approval?.kind !== "B2_RUNTIME_AUTHORIZATION" || approval.approved !== true || !approval.ownerReference
    || approval.manifestSha256 !== manifestSha256 || approval.sourceFingerprint !== manifest.candidate?.fingerprint) {
    throw new Error("B2 runtime authorization must bind the reviewed manifest and source");
  }
  const fingerprint = json(resolve(root, "docs/verification/code-fingerprint.json"));
  if (!Array.isArray(fingerprint.files) || fingerprint.files.length === 0
    || sha(JSON.stringify(fingerprint.files)) !== manifest.candidate.fingerprint
    || fingerprint.fingerprint !== manifest.candidate.fingerprint
    || fingerprint.files.some(f => sha(readFileSync(localPath(f.path), "utf8").replace(/\r\n/g, "\n")) !== f.sha256)) {
    throw new Error("B2 candidate source fingerprint drift");
  }
  const target = manifest.target, phase = env.ADFOCATE_B2_PHASE;
  const plan = manifest.fixture.phases.find(p => p.phase === phase);
  if (!plan || !/^[a-f0-9-]{36}$/.test(plan.plannedNamespace) || !/^adfocate-d19-b2-[a-z0-9-]+$/.test(target.projectId)
    || target.ports.host !== "127.0.0.1" || target.ports.proxy !== "none"
    || new Set([target.ports.web, target.ports.api, target.ports.database]).size !== 3
    || [target.ports.web, target.ports.api, target.ports.database].some(p => !Number.isInteger(p) || p < 1024 || p > 65535)
    || !isDeepStrictEqual(target.resourceCaps, { projects: 1, persistentDataVolumes: 1, networks: 1, containers: 5 })
    || target.databaseVolumeName !== `${target.projectId}-db-data` || target.networkName !== `${target.projectId}-net`) {
    throw new Error("B2 explicit phase, target or resource scope invalid");
  }
  const artifactNamespace = manifest.execution?.artifactNamespace;
  if (artifactNamespace !== undefined && (typeof artifactNamespace !== "string"
    || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(artifactNamespace))) throw new Error("B2 artifact namespace invalid");
  assertAcceptanceTargetAllowed(target);
  const lineage = (selectedPhase = phase) => ({ projectId: target.projectId, ownerRunId: target.plannedOwnerRunId,
    sourceFingerprint: manifest.candidate.fingerprint, manifestSha256, phase: selectedPhase,
    namespace: manifest.fixture.phases.find(p => p.phase === selectedPhase)?.plannedNamespace,
    ...(artifactNamespace ? { executionNamespace: artifactNamespace } : {}) });
  const phasePath = (base, name, selectedPhase) => {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith(".") || !lineage(selectedPhase).namespace) throw new Error("B2 evidence path invalid");
    return resolve(root, base, target.projectId, ...(artifactNamespace ? [artifactNamespace] : []), selectedPhase, name);
  };
  const assertLineage = (value, selectedPhase = phase) => {
    if (!isDeepStrictEqual(value?.lineage, lineage(selectedPhase))) throw new Error("B2 fixture/evidence lineage mismatch");
    return value;
  };
  return { manifest, manifestSha256, approval, phase, plan, lineage: lineage(), lineageFor: lineage, assertLineage,
    origins: [`http://127.0.0.1:${target.ports.web}`, `http://127.0.0.1:${target.ports.api}`],
    publicPath: (name, selectedPhase = phase) => phasePath("docs/verification", name, selectedPhase),
    privatePath: (name, selectedPhase = phase) => phasePath(".codex-tmp", name, selectedPhase),
    readPrivate: (name, selectedPhase = phase) => assertLineage(json(phasePath(".codex-tmp", name, selectedPhase)), selectedPhase) };
}
function verifiedB2Target(bootstrapOnly = false) {
  const context = b2ExecutionContext(), { manifest, manifestSha256, approval } = context, spec = manifest.target;
  if (!bootstrapOnly && context.phase !== "role") assertPhaseDependency(context, context.phase === "core" ? "role" : "core");
  const receipt = json(localPath(process.env.ADFOCATE_B2_TARGET_RECEIPT_PATH ?? "missing-b2-receipt.json"));
  const identity = receipt.identity, ids = receipt.containerIds, services = ["kong", "db", "auth", "rest", "storage"];
  if (receipt.manifestSha256 !== manifestSha256 || receipt.sourceFingerprint !== manifest.candidate.fingerprint
    || identity?.projectId !== spec.projectId || identity.runId !== spec.plannedOwnerRunId
    || identity.ownerAuthorization !== approval.ownerReference || identity.apiPort !== spec.ports.api || identity.proxy !== "none"
    || receipt.createdThisRun !== true || receipt.volumeWasAbsent !== true || receipt.networkWasAbsent !== true
    || receipt.volumeName !== spec.databaseVolumeName || !receipt.databaseCreatedAt || !receipt.volumeCreatedAt
    || !ids || !isDeepStrictEqual(Object.keys(ids).sort(), services.toSorted()) || new Set(Object.values(ids)).size !== 5
    || services.some(s => !/^[a-f0-9]{64}$/.test(ids[s]) || !/^sha256:[a-f0-9]{64}$/.test(spec.serviceImageIds[s]))
    || identity.apiContainerId !== ids.kong || identity.databaseContainerId !== ids.db
    || identity.apiImageId !== spec.serviceImageIds.kong || identity.databaseImageId !== spec.serviceImageIds.db
    || (!bootstrapOnly && (receipt.bootstrap?.verified !== true || receipt.bootstrap.profileDigest !== manifest.bootstrap.profileDigest
      || !/^[a-f0-9]{64}$/.test(receipt.bootstrap.baselineSha256)))
    || (bootstrapOnly && (context.phase !== "role" || receipt.bootstrap?.verified !== false))) throw new Error("B2 target/bootstrap receipt mismatch");
  assertAcceptanceTargetAllowed(receipt);
  const metadata = (args, asJson = true) => {
    const result = spawnSync("docker", args, { encoding: "utf8", timeout: 10000 });
    if (result.status !== 0 || result.error) throw new Error("B2 Docker metadata unavailable");
    return asJson ? JSON.parse(result.stdout) : result.stdout.trim();
  };
  if (metadata(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], false)
    !== "npipe:////./pipe/dockerDesktopLinuxEngine") throw new Error("B2 local engine mismatch");
  const format = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}},"tmpfs":{{json (index .HostConfig "Tmpfs")}},"created":{{json .Created}}}';
  const containers = Object.fromEntries(services.map(s => [s, metadata(["inspect", "--format", format, ids[s]])]));
  for (const s of services) {
    const c = containers[s]; assertAcceptanceTargetAllowed(c);
    if (c.id !== ids[s] || c.image !== spec.serviceImageIds[s] || c.project !== spec.projectId || !c.running
      || Object.keys(c.networks ?? {}).length !== 1 || Object.values(c.networks)[0].NetworkID !== identity.networkId) throw new Error("B2 service/network identity mismatch");
    const volumes = (c.mounts ?? []).filter(m => m.Type !== "tmpfs");
    if (s === "db" ? volumes.length !== 1 || volumes[0].Type !== "volume" || volumes[0].Name !== spec.databaseVolumeName
      || volumes[0].Destination !== "/var/lib/postgresql/data" || !volumes[0].RW : volumes.length !== 0) throw new Error("B2 volume/mount scope mismatch");
    const tmpfs = Object.entries(c.tmpfs ?? {}), temporary = (c.mounts ?? []).filter(m => m.Type === "tmpfs");
    if (s === "storage" ? spec.storageTmpfs?.destination !== "/var/lib/storage" || spec.storageTmpfs.sizeBytes !== 268435456
      || tmpfs.length !== 1 || tmpfs[0][0] !== spec.storageTmpfs.destination || tmpfs[0][1] !== "rw,size=268435456"
      || temporary.length > 1 || (temporary.length === 1 && (temporary[0].Destination !== spec.storageTmpfs.destination || temporary[0].RW !== true))
      : tmpfs.length !== 0 || temporary.length !== 0) throw new Error("B2 storage tmpfs scope mismatch");
    // Docker may omit HostConfig.Tmpfs mounts from Mounts. Require live kernel evidence in that case.
    if (s === "storage" && temporary.length === 0) {
      const entries = metadata(["exec", ids.storage, "cat", "/proc/self/mountinfo"], false).split("\n")
        .map(line => line.split(" - ")).filter(([mount]) => mount.split(" ")[4] === spec.storageTmpfs.destination);
      const [mount, superblock] = entries[0] ?? [], details = superblock?.split(" ") ?? [];
      const mountOptions = mount?.split(" ")[5]?.split(",") ?? [], options = details[2]?.split(",") ?? [];
      const sizes = options.filter(option => option.startsWith("size="));
      const size = sizes.length === 1 && /^size=(\d+)([kmg])?$/i.exec(sizes[0]);
      const bytes = size ? Number(size[1]) * ({ k: 1024, m: 1048576, g: 1073741824 }[size[2]?.toLowerCase()] ?? 1) : 0;
      if (entries.length !== 1 || details[0] !== "tmpfs" || !mountOptions.includes("rw") || mountOptions.includes("ro")
        || !options.includes("rw") || options.includes("ro") || bytes !== spec.storageTmpfs.sizeBytes) throw new Error("B2 storage tmpfs kernel evidence mismatch");
    }
    const bindings = Object.values(c.ports ?? {}).flat().filter(Boolean);
    const expectedPort = s === "db" ? spec.ports.database : s === "kong" ? spec.ports.api : null;
    if (expectedPort ? bindings.length !== 1 || bindings[0].HostIp !== "127.0.0.1" || Number(bindings[0].HostPort) !== expectedPort : bindings.length !== 0) throw new Error("B2 service port scope mismatch");
  }
  const network = metadata(["network", "inspect", "--format", '{"id":{{json .Id}},"internal":{{json .Internal}},"labels":{{json .Labels}},"containers":{{json .Containers}},"options":{{json .Options}}}', identity.networkId]);
  const members = Array.isArray(network.containers) ? network.containers : Object.keys(network.containers ?? {});
  if (network.id !== identity.networkId || network.internal !== false || network.labels?.["adfocate.run"] !== identity.runId
    || network.options?.["com.docker.network.bridge.enable_ip_masquerade"] !== "false"
    || network.options?.["com.docker.network.bridge.host_binding_ipv4"] !== "127.0.0.1"
    || !isDeepStrictEqual([...members].sort(), Object.values(ids).sort())) throw new Error("B2 exclusive network scope mismatch");
  const volume = metadata(["volume", "inspect", "--format", '{"name":{{json .Name}},"created":{{json .CreatedAt}},"labels":{{json .Labels}}}', spec.databaseVolumeName]);
  if (volume.name !== spec.databaseVolumeName || volume.created !== receipt.volumeCreatedAt
    || containers.db.created !== receipt.databaseCreatedAt || volume.labels?.["adfocate.run"] !== identity.runId
    || volume.labels?.["com.supabase.cli.project"] !== spec.projectId) throw new Error("B2 fresh volume identity mismatch");
  const publicEnv = { SUPABASE_URL: context.origins[1], SUPABASE_ANON_KEY: "identity-check-before-key-read", SUPABASE_SERVICE_KEY: "identity-check-before-key-read", INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify(identity) };
  verifyIntegrationIdentity(publicEnv);
  let ownerSql;
  const sql = query => {
    ownerSql ??= journalOwnerSql(q => docker(["exec", "-i", identity.databaseContainerId, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {input:q}), new FixtureJournal(context.privatePath(`owner-transport-${process.pid}.jsonl`), context.lineage, {requests:manifest.fixture.transportWriteCapPerProcess}), context.privatePath);
    return ownerSql(query);
  };
  if (bootstrapOnly) return { identity, context, sql };
  const keys = json(resolve(root, ".codex-tmp", spec.projectId, "keys.private.json"));
  if (keys.API_URL !== publicEnv.SUPABASE_URL || !keys.ANON_KEY || !keys.SERVICE_ROLE_KEY) throw new Error("B2 new key source mismatch");
  return { identity, context, sql, env: { ...publicEnv, SUPABASE_ANON_KEY: keys.ANON_KEY, SUPABASE_SERVICE_KEY: keys.SERVICE_ROLE_KEY } };
}
// Runtime authorization is still mandatory. The return value has no application keys/client.
// Caller must prove public schema/history empty before executing the sealed forward-only profile.
export function verifiedB2BootstrapTarget() {
  if (!process.env.ADFOCATE_B2_MANIFEST_PATH) throw new Error("B2 explicit bootstrap manifest required");
  return verifiedB2Target(true);
}
export function verifiedTarget(kind) {
  if (process.env.ADFOCATE_B2_MANIFEST_PATH) {
    if (kind !== undefined) throw new Error("B2 requires explicit manifest selection; legacy selector refused");
    return verifiedB2Target();
  }
  kind ??= "empty";
  if (!["empty", "shaped"].includes(kind)) throw new Error("unknown disposable target");
  const projectId = `adfocate-r1-${kind}-20261023`;
  assertAcceptanceTargetAllowed({ projectId });
  const port = kind === "empty" ? 56421 : 56521;
  const metadata = (service) => JSON.parse(docker(["inspect", "--format",
    '{"id":{{json .Id}},"image":{{json .Image}},"network":{{json .NetworkSettings.Networks}}}',
    `supabase_${service}_${projectId}`]));
  const api = metadata("kong"), database = metadata("db");
  const network = Object.values(api.network).find((entry) => Object.values(database.network)
    .some((peer) => peer.NetworkID === entry.NetworkID));
  if (!network) throw new Error("target has no exclusive verified network");
  const identity = { runId, ownerAuthorization, disposable: true, projectId, proxy: "none",
    apiPort: port, apiContainerId: api.id, databaseContainerId: database.id,
    apiImageId: api.image, databaseImageId: database.image, networkId: network.NetworkID };
  const publicEnv = { SUPABASE_URL: `http://127.0.0.1:${port}`,
    SUPABASE_SERVICE_KEY: "identity-check-before-key-read", SUPABASE_ANON_KEY: "identity-check-before-key-read",
    INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify(identity) };
  verifyIntegrationIdentity(publicEnv);
  const networkMetadata = JSON.parse(docker(["network", "inspect", "--format",
    '{"labels":{{json .Labels}},"options":{{json .Options}}}', identity.networkId]));
  if (networkMetadata.labels?.["adfocate.run"] !== runId
      || networkMetadata.options?.["com.docker.network.bridge.host_binding_ipv4"] !== "127.0.0.1") {
    throw new Error("target network is not owned by this run or is not loopback-bound");
  }
  const sql = (query) => docker(["exec", "-i", identity.databaseContainerId, "psql", "-X", "-q", "-A", "-t",
    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: query });
  // These are freshly generated keys for this run's local target, never hosted credentials.
  const lines = readFileSync(resolve(root, `.codex-tmp/${kind}-start.private.log`), "utf8").split(/\r?\n/);
  const keys = JSON.parse(lines.filter((line) => line.startsWith('{"DB_URL"')).at(-1));
  if (keys.API_URL !== publicEnv.SUPABASE_URL) throw new Error("local key source target mismatch");
  const env = { ...publicEnv, SUPABASE_ANON_KEY: keys.ANON_KEY, SUPABASE_SERVICE_KEY: keys.SERVICE_ROLE_KEY };
  return { identity, sql, env };
}

function saveIdentity(target, kind) {
  writeFileSync(resolve(root, `docs/verification/target-${kind}.json`), JSON.stringify({
    verifiedAt: new Date().toISOString(), identity: target.identity, clientSetupAfterVerification: true,
    externalProviders: "disabled", keys: "not retained in evidence" }, null, 2) + "\n");
  writeFileSync(resolve(root, `.codex-tmp/target-${kind}.private.json`), JSON.stringify(target.env));
}
function applyEmpty(target) {
  const existing = Number(target.sql("select count(*) from pg_tables where schemaname='public';"));
  if (existing !== 0) throw new Error("empty target is not empty; refusing reset/replay");
  target.sql("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);");
  const results = [];
  for (const file of readdirSync(resolve(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    const match = /^(\d+)_([a-z0-9_]+)\.sql$/.exec(file);
    if (!match) throw new Error("invalid local migration filename");
    const source = readFileSync(resolve(root, "supabase/migrations", file), "utf8");
    // Flatten only explicit top-level transaction lines, keeping file bytes/checksums unchanged.
    const transactionalSource = source.replace(/^begin;\s*$/gmi, "").replace(/^commit;\s*$/gmi, "");
    target.sql(`begin;\n${transactionalSource}\ninsert into supabase_migrations.schema_migrations(version,name) values ('${match[1]}','${match[2]}');\ncommit;`);
    results.push({ file, status: "applied-transactionally" });
  }
  target.sql("notify pgrst, 'reload schema';");
  writeFileSync(resolve(root, "docs/verification/empty-replay.json"), JSON.stringify({
    target: target.identity, migrations: results, replayPolicy: "history_noop; no SQL reapplied",
    pendingOnSecondPass: readdirSync(resolve(root,"supabase/migrations")).filter((f)=>f.endsWith(".sql"))
      .filter((f)=>!target.sql(`select 1 from supabase_migrations.schema_migrations where version='${f.split('_')[0]}';`)),
  }, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(root, "scripts/audit/local-targets.mjs")) {
  const action = process.argv[2] ?? "identity";
  for (const kind of ["empty", "shaped"]) {
    const target = verifiedTarget(kind);
    saveIdentity(target, kind);
    if (action === "apply-empty" && kind === "empty") applyEmpty(target);
    log(`${kind}: Docker identity verified; ${action}`);
  }
}
