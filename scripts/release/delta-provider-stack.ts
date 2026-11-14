import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, realpath, lstat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { deltaChildEnvironment } from "./delta-child-process";
import { createPrivateRecoveryAttempt } from "./delta-private-artifacts";
import { openFramedPsqlSession } from "./delta-psql-session";
import { parseReleaseManifest, validateManifest } from "./manifest";
import { digestDeltaProofPayload } from "./delta-evidence";
import { ProviderRehearsalFailure, requireProviderFact as check } from "./delta-provider-contracts";

export const PROVIDER_CLI_VERSION = "2.110.0";
export const PROVIDER_EXCLUDED_SERVICES = "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
const endpoint = process.platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";
const dockerArgs = (args: string[]) => ["--host", endpoint, ...args];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
type Row = Record<string, unknown>;
function object(value: unknown): Row { check(value && typeof value === "object" && !Array.isArray(value), "stack-metadata"); return value as Row; }
export function providerLoopbackOrigin(value: unknown): string {
  check(typeof value === "string", "local-origin"); let url: URL;
  try { url = new URL(value); } catch { throw new ProviderRehearsalFailure("local-origin"); }
  check(url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
    && Number(url.port) >= 1024 && Number(url.port) <= 65535, "local-origin"); return url.origin;
}
export function classifyProviderToolFailure(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  if (/all predefined address pools|could not find an available.*pool|Pool overlaps/i.test(text)) return "ipam-pool";
  if (/network .*already exists/i.test(text)) return "network-collision";
  if (/access is denied|permission denied|operation not permitted/i.test(text)) {
    if (/provider-workdir/i.test(text)) return "private-workdir-access";
    if (/provider-home/i.test(text)) return "private-home-access";
    if (/\.supabase/i.test(text)) return "global-profile-access";
    if (/\.env/i.test(text)) return "dotenv-access";
    if (/npipe|dockerDesktopLinuxEngine/i.test(text)) return "daemon-pipe-access";
    return "access-denied";
  }
  if (/failed to connect to postgres|failed to connect to.*database=|postgres.*connection refused/i.test(text)) return "postgres-connect";
  if (/127\.0\.0\.1|localhost/i.test(text) && /connection refused|connectex|failed to connect/i.test(text)) return "loopback-connect";
  if (/health.?check|unhealthy|not healthy/i.test(text)) return "service-health";
  if (/no route to host|network is unreachable/i.test(text)) return "network-route";
  if (/client version|minimum supported API version|API version.*too old/i.test(text)) return "docker-api-version";
  if (/failed to (?:pull|download).*image|pull access denied|registry.*(?:timeout|failed)|public\.ecr\.aws.*(?:timeout|failed)/i.test(text)) return "image-pull";
  if (/failed to connect|cannot connect|is the docker daemon running|system cannot find the file/i.test(text)) return "daemon-connect";
  if (/invalid.*(?:option|argument)|unknown flag/i.test(text)) return "network-option";
  if (/failed to parse config|decoding failed|invalid keys|unknown.*(?:config|field|key)/i.test(text)) return "config-schema";
  if (/environment variable.*not set|missing.*environment/i.test(text)) return "config-environment";
  if (/invalid.*project.*id|project.*id.*(?:long|length|characters)/i.test(text)) return "config-project-id";
  if (/config\.json|invalid.*config|context.*not found/i.test(text)) return "docker-config";
  if (/plugin.*not found|driver.*not found|not supported/i.test(text)) return "network-driver";
  return "unclassified";
}
/** Output may contain local keys; callers own/clear it. Nothing is printed or put in an exception. */
export async function captureProviderTool(file: string, args: readonly string[], env: NodeJS.ProcessEnv, input: Buffer = Buffer.alloc(0), timeoutMs = 60_000, cwd?: string): Promise<Buffer> {
  return new Promise((resolveOutput, reject) => {
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let total = 0, failure = false, settled = false, launchCode = "";
    const child = spawn(file, [...args], { env, cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const clear = () => { input.fill(0); for (const bytes of [...stdout, ...stderr]) bytes.fill(0); };
    const stop = () => { failure = true; child.kill(); };
    const timer = setTimeout(stop, timeoutMs);
    const deadline = setTimeout(() => { if (!settled) { settled = true; clear(); child.kill(); child.unref(); reject(new ProviderRehearsalFailure("tool-close-unverified")); } }, timeoutMs + 5_000);
    child.once("error", (error: NodeJS.ErrnoException) => { launchCode = ["EPERM", "ENOENT", "EACCES"].includes(error.code ?? "") ? error.code! : "process"; stop(); });
    child.stdin.on("error", stop);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) {
      stream.on("data", (chunk: Buffer) => { total += chunk.length; if (total > 8 * 1024 * 1024) { chunk.fill(0); stop(); } else chunks.push(Buffer.from(chunk)); });
      stream.on("error", stop);
    }
    child.once("close", code => {
      clearTimeout(timer); clearTimeout(deadline); if (settled) { clear(); return; } settled = true;
      const result = !failure && code === 0 ? Buffer.concat(stdout) : undefined;
      const privateError = Buffer.concat(stderr), diagnostic = classifyProviderToolFailure(privateError);
      const sqlState = /SQLSTATE[ :]+([A-Z0-9]{5})/.exec(privateError.toString("utf8"))?.[1]; privateError.fill(0);
      const operation = file === "docker" ? args[2] : args[0];
      const knownOperation = /^(?:--version|start|stop|status|network|volume|inspect|ps)$/.test(operation ?? "") ? operation!.replace(/^--/, "") : "tool";
      clear();
      if (result) resolveOutput(result); else reject(new ProviderRehearsalFailure(`owned-${knownOperation}-failed-${launchCode || code || "launch"}-${diagnostic}${sqlState ? `-${sqlState}` : ""}`));
    });
    child.stdin.end(input, () => input.fill(0));
  });
}
export function chooseProviderSubnet(existing: readonly string[]): string {
  function range(cidr: string): readonly [bigint, bigint] {
    const [address, bits] = cidr.split("/"); const octets = address?.split(".").map(Number), prefix = Number(bits);
    check(octets?.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32, "network-ipam-profile");
    const value = octets.reduce((value, octet) => (value << 8n) + BigInt(octet), 0n), mask = ((1n << 32n) - 1n) ^ ((1n << BigInt(32 - prefix)) - 1n);
    const start = value & mask; return [start, start + (1n << BigInt(32 - prefix)) - 1n];
  }
  const occupied = existing.filter(value => !value.includes(":" )).map(range);
  for (let second = 232; second <= 239; second++) for (let third = 0; third < 256; third++) {
    const candidate = `10.${second}.${third}.0/24`, [start, end] = range(candidate);
    if (occupied.every(([otherStart, otherEnd]) => end < otherStart || start > otherEnd)) return candidate;
  }
  throw new ProviderRehearsalFailure("local-subnet-unavailable");
}
export interface ProviderContainerIdentity {
  readonly id: string; readonly name: string; readonly image: string; readonly imageRef: string;
  readonly networks: Record<string, { NetworkID: string }>; readonly ports: Record<string, { HostIp: string; HostPort: string }[] | null>;
  readonly mounts: readonly { Type: string; Name?: string; Destination: string; Source?: string }[];
}
function parseContainer(value: unknown, project: string, networkId: string, privateWorkdir: string, allowStopped = false): ProviderContainerIdentity {
  const row = object(value); check((allowStopped || row.running === true) && row.project === project && /^[a-f0-9]{64}$/.test(String(row.id))
    && /^sha256:[a-f0-9]{64}$/.test(String(row.image)) && typeof row.name === "string" && row.name.endsWith(`_${project}`), "owned-container");
  const networks = object(row.networks); check(Object.keys(networks).length === 1 && object(Object.values(networks)[0]).NetworkID === networkId, "owned-network");
  const ports = object(row.ports ?? {});
  for (const bindings of Object.values(ports)) if (bindings !== null) {
    check(Array.isArray(bindings), "owned-ports");
    for (const binding of bindings) check(object(binding).HostIp === "127.0.0.1", "loopback-port-binding");
  }
  check(Array.isArray(row.mounts) && row.mounts.every(m => {
    const mount = object(m);
    if (mount.Type === "volume") return String(mount.Name).endsWith(`_${project}`);
    // CLI-generated read-only service configuration lives solely in this fresh private working copy.
    return mount.Type === "bind" && mount.RW === false && typeof mount.Source === "string" && resolve(mount.Source).startsWith(privateWorkdir + (process.platform === "win32" ? "\\" : "/"));
  }), "owned-volume-only");
  return row as unknown as ProviderContainerIdentity;
}
async function freePorts(count: number) {
  const sockets: ReturnType<typeof createServer>[] = [], ports: number[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const server = createServer(); sockets.push(server); await new Promise<void>((ok, no) => { server.once("error", no); server.listen(0, "127.0.0.1", ok); });
      const address = server.address(); check(address && typeof address === "object", "local-port-allocation"); ports.push(address.port);
    }
    return ports;
  } finally { await Promise.all(sockets.map(server => new Promise<void>(ok => server.close(() => ok())))); }
}
export class ProviderStackBootstrapFailure extends ProviderRehearsalFailure {
  constructor(code: string, readonly runId: string, readonly namespaceCleanupVerified: boolean) { super(code); }
}
export interface OwnedProviderStack {
  readonly runId: string; readonly projectId: string; readonly sourceProfileHash: string; readonly configurationHash: string;
  readonly apiOrigin: string; readonly anonKey: string; readonly serviceKey: string; readonly jwtSecret: string;
  readonly identities: readonly ProviderContainerIdentity[];
  assertOwned(): Promise<void>;
  sql(query: string): Promise<readonly string[]>;
  close(): Promise<void>;
}
/** Fresh private working copy and CLI-generated local resources. Never adopts a prior project. */
export async function createOwnedProviderStack(rootInput: string): Promise<OwnedProviderStack> {
  const root = await realpath(rootInput), require = createRequire(join(root, "package.json"));
  const packageName = process.platform === "win32" ? "@supabase/cli-windows-x64" : "@supabase/cli-linux-x64";
  check(["win32", "linux"].includes(process.platform) && process.arch === "x64", "supported-local-platform");
  const cliPackage = require.resolve(`${packageName}/package.json`), packageMetadata = JSON.parse(await readFile(cliPackage, "utf8"));
  check(packageMetadata.version === PROVIDER_CLI_VERSION, "pinned-cli-package");
  // v2 packages contain the pinned Go backend. Invoking it avoids the JS shell's user-profile telemetry.
  const cli = join(dirname(cliPackage), "bin", process.platform === "win32" ? "supabase-go.exe" : "supabase-go");
  check((await lstat(cli)).isFile(), "pinned-cli-backend");
  const privateAttempt = await createPrivateRecoveryAttempt({ repoRoot: root });
  // Keep the recovery store's closed inventory intact. Its empty protected attempt
  // anchors a distinct fresh provider sibling under the same trusted private parent.
  const anchor = await privateAttempt.privateDirectory(), directory = join(dirname(anchor), `provider-${privateAttempt.attemptId}`);
  await mkdir(directory, { mode: 0o700 });
  const workdir = join(directory, "provider-workdir"), home = join(directory, "provider-home");
  await mkdir(join(workdir, "supabase", "migrations"), { recursive: true, mode: 0o700 }); await mkdir(home, { mode: 0o700 });
  await privateAttempt.privateDirectory();
  const privateIdentities = await Promise.all([directory, workdir, home].map(async path => ({ path, stat: await lstat(path) })));
  async function assertPrivateIdentity() {
    for (const expected of privateIdentities) {
      const current = await lstat(expected.path);
      check(current.isDirectory() && !current.isSymbolicLink() && current.dev === expected.stat.dev && current.ino === expected.stat.ino && await realpath(expected.path) === expected.path, "private-working-identity");
    }
  }
  const env = { ...deltaChildEnvironment(process.env), HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    DOCKER_HOST: endpoint, DOCKER_CONFIG: join(home, ".docker"), SUPABASE_ACCESS_TOKEN: `sbp_${"0".repeat(40)}`, SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN: "provider-local-no-sms" };
  async function tool(file: string, args: string[], input?: Buffer, timeout?: number) { await assertPrivateIdentity(); return captureProviderTool(file, args, env, input, timeout, workdir); }
  async function text(file: string, args: string[], timeout?: number) { const bytes = await tool(file, args, undefined, timeout); try { return bytes.toString("utf8").trim(); } finally { bytes.fill(0); } }
  check((await text(cli, ["--version"])) === PROVIDER_CLI_VERSION, "pinned-cli-version");
  const manifest = parseReleaseManifest(JSON.parse(await readFile(join(root, "supabase/release-manifest.json"), "utf8")));
  check((await validateManifest(manifest, root)).length === 0, "complete-source-integrity");
  const files = (await readdir(join(root, "supabase/migrations"))).filter(name => /^(?:\d{4}|\d{14})_[a-z0-9_]+\.sql$/.test(name)).sort();
  check(files.length >= manifest.migrations.length && files.length <= 120, "full-local-forward-source");
  const sourceHashes: Record<string, string> = {};
  for (const name of files) {
    const source = join(root, "supabase/migrations", name); check((await lstat(source)).isFile() && await realpath(source) === source, "source-alias");
    const bytes = await readFile(source); sourceHashes[name] = sha(bytes.toString("utf8").replace(/\r\n?/g, "\n"));
    await writeFile(join(workdir, "supabase/migrations", name), bytes, { flag: "wx", mode: 0o600 }); bytes.fill(0);
  }
  const runId = randomUUID(), projectId = `adfocate-provider-${runId.replaceAll("-", "")}`, networkName = `${projectId}-network`;
  let config = (await readFile(join(root, "supabase/config.toml"), "utf8")).replace(/\r\n?/g, "\n");
  config = config.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`)
    .replace(/(\[db.seed\][\s\S]*?enabled\s*=\s*)true/, "$1false")
    .replace(/(\[auth.mfa.totp\][\s\S]*?enroll_enabled\s*=\s*)false/, "$1true")
    .replace(/(\[auth.mfa.totp\][\s\S]*?verify_enabled\s*=\s*)false/, "$1true")
    .replace(/(\[auth.sms.twilio\][\s\S]*?enabled\s*=\s*)true/, "$1false");
  const portCount = [...config.matchAll(/^(?:port|shadow_port|smtp_port|pop3_port|inspector_port)\s*=\s*\d+$/gm)].length;
  const ports = await freePorts(portCount); let index = 0;
  config = config.replace(/^(port|shadow_port|smtp_port|pop3_port|inspector_port)\s*=\s*\d+$/gm, (_, name: string) => `${name} = ${ports[index++]}`);
  const apiPort = Number(/\[api\][\s\S]*?^port\s*=\s*(\d+)/m.exec(config)?.[1]);
  const apiOrigin = providerLoopbackOrigin(`http://127.0.0.1:${apiPort}`);
  config = config.replace(/^# external_url =.*$/m, `external_url = "${apiOrigin}/auth/v1"`).replace(/^# jwt_issuer =.*$/m, `jwt_issuer = "${apiOrigin}/auth/v1"`);
  await writeFile(join(workdir, "supabase/config.toml"), config, { flag: "wx", mode: 0o600 });
  const configurationHash = sha(config), sourceProfileHash = digestDeltaProofPayload({ cliVersion: PROVIDER_CLI_VERSION, configurationHash, sourceHashes });
  let networkId: string | undefined, started = false, identities: ProviderContainerIdentity[] = [], closed = false;
  const metadataFormat = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"imageRef":{{json .Config.Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}';
  async function docker(args: string[], input?: Buffer) { return tool("docker", dockerArgs(args), input); }
  async function dockerText(args: string[]) { const bytes = await docker(args); try { return bytes.toString("utf8").trim(); } finally { bytes.fill(0); } }
  async function containers(allowStopped = false) {
    const list = await dockerText(["ps", "--all", "--no-trunc", "--filter", `label=com.supabase.cli.project=${projectId}`, "--format", "{{.ID}}"]);
    if (!list) return []; const ids = list.split(/\r?\n/); check(ids.length <= 12 && ids.every(id => /^[a-f0-9]{64}$/.test(id)), "owned-inventory");
    return Promise.all(ids.map(async id => parseContainer(JSON.parse(await dockerText(["inspect", "--format", metadataFormat, id])), projectId, networkId!, workdir, allowStopped)));
  }
  async function emitBootstrapDiagnostics(reasonCode: string) {
    try {
      const ids = (await dockerText(["ps", "--all", "--no-trunc", "--filter", `label=com.supabase.cli.project=${projectId}`, "--format", "{{.ID}}"])).split(/\r?\n/).filter(Boolean);
      check(ids.length <= 12 && ids.every(id => /^[a-f0-9]{64}$/.test(id)), "bounded-bootstrap-diagnostics");
      const summary = await Promise.all(ids.map(async id => {
        const row = object(JSON.parse(await dockerText(["inspect", "--format", metadataFormat, id]))), networks = object(row.networks ?? {}), mounts = Array.isArray(row.mounts) ? row.mounts.map(object) : [];
        const bindings = Object.values(object(row.ports ?? {})).flatMap(value => Array.isArray(value) ? value.map(object) : []);
        return { running: row.running === true, projectMatches: row.project === projectId, nameMatches: typeof row.name === "string" && row.name.endsWith(`_${projectId}`),
          networkCount: Object.keys(networks).length, networkMatches: Object.values(networks).every(value => object(value).NetworkID === networkId),
          loopbackBindings: bindings.every(value => value.HostIp === "127.0.0.1"), mountCount: mounts.length, namedMountsScoped: mounts.every(value => value.Type === "volume" && String(value.Name).endsWith(`_${projectId}`)) };
      }));
      process.stdout.write(JSON.stringify({ kind: "owned-provider-bootstrap-diagnostics", reasonCode, containers: summary, validReleaseEvidence: false }) + "\n");
    } catch { process.stdout.write(JSON.stringify({ kind: "owned-provider-bootstrap-diagnostics", reasonCode, metadataUnavailable: true, validReleaseEvidence: false }) + "\n"); }
  }
  async function assertOwned() {
    check(started && !closed && networkId, "active-owned-stack"); await assertPrivateIdentity();
    const network = object(JSON.parse(await dockerText(["network", "inspect", "--format", '{"id":{{json .Id}},"owner":{{json (index .Labels "adfocate.provider-run")}},"driver":{{json .Driver}},"internal":{{json .Internal}},"options":{{json .Options}},"containers":{{json .Containers}}}', networkId])));
    check(network.id === networkId && network.owner === runId && network.driver === "bridge" && network.internal === false
      && object(network.options)["com.docker.network.bridge.host_binding_ipv4"] === "127.0.0.1" && object(network.options)["com.docker.network.bridge.enable_ip_masquerade"] === "false", "owned-network-identity");
    const current = await containers();
    check(current.length === identities.length && current.every(row => identities.some(expected => expected.id === row.id && expected.image === row.image && expected.name === row.name)), "owned-inventory-drift");
    check(Object.keys(object(network.containers)).sort().join() === identities.map(row => row.id).sort().join(), "unexpected-network-member");
  }
  async function close() {
    if (closed) return; let failed = false;
    try {
      const current = await containers(true);
      if (identities.length) check(current.every(row => identities.some(expected => expected.id === row.id && expected.image === row.image)), "cleanup-container-identity");
      // Direct exact-ID teardown also works when the CLI refused before starting a service.
      for (const row of current) check((await dockerText(["container", "rm", "--force", row.id])) === row.id, "owned-container-cleanup");
      check((await containers(true)).length === 0, "owned-container-cleanup");
      const volumeNames = (await dockerText(["volume", "ls", "--filter", `label=com.supabase.cli.project=${projectId}`, "--format", "{{.Name}}"])).split(/\r?\n/).filter(Boolean);
      for (const name of volumeNames) {
        check(new RegExp(`^supabase_[a-z0-9_]+_${projectId}$`).test(name), "cleanup-volume-name");
        const volume = object(JSON.parse(await dockerText(["volume", "inspect", "--format", '{"name":{{json .Name}},"driver":{{json .Driver}},"project":{{json (index .Labels "com.supabase.cli.project")}}}', name])));
        check(volume.name === name && volume.driver === "local" && volume.project === projectId, "cleanup-volume-owner");
        check((await dockerText(["volume", "rm", name])) === name, "owned-volume-cleanup");
      }
      check(!(await dockerText(["volume", "ls", "--filter", `label=com.supabase.cli.project=${projectId}`, "--format", "{{.Name}}"])), "owned-volume-cleanup");
    } catch { failed = true; }
    if (networkId) {
      try {
        const network = object(JSON.parse(await dockerText(["network", "inspect", "--format", '{"id":{{json .Id}},"owner":{{json (index .Labels "adfocate.provider-run")}},"containers":{{json .Containers}}}', networkId])));
        check(network.owner === runId && network.id === networkId && Object.keys(object(network.containers)).length === 0, "owned-network-cleanup");
        check((await dockerText(["network", "rm", networkId])) === networkId, "owned-network-cleanup");
      } catch { failed = true; }
    }
    try {
      check(!(await dockerText(["network", "ls", "--filter", `label=com.supabase.cli.project=${projectId}`, "--format", "{{.ID}}"])), "unexpected-project-network-remains");
      await privateAttempt.privateDirectory();
    } catch { failed = true; }
    closed = !failed; if (failed) throw new ProviderRehearsalFailure("owned-stack-cleanup-unverified");
  }
  try {
    check((await containers()).length === 0, "fresh-project-only");
    const allNetworks = (await dockerText(["network", "ls", "--no-trunc", "--format", "{{.ID}}"])).split(/\r?\n/).filter(Boolean);
    check(allNetworks.length <= 256 && allNetworks.every(id => /^[a-f0-9]{64}$/.test(id)), "network-inventory-profile");
    const ipamRows = (await dockerText(["network", "inspect", "--format", "{{json .IPAM.Config}}", ...allNetworks])).split(/\r?\n/).filter(Boolean);
    const occupiedSubnets = ipamRows.flatMap(row => (JSON.parse(row) ?? []) as { Subnet?: string }[]).flatMap(row => row.Subnet ? [row.Subnet] : []);
    const subnet = chooseProviderSubnet(occupiedSubnets);
    networkId = await dockerText(["network", "create", "--driver", "bridge", "--subnet", subnet, "--label", `adfocate.provider-run=${runId}`, "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1", "--opt", "com.docker.network.bridge.enable_ip_masquerade=false", networkName]);
    check(/^[a-f0-9]{64}$/.test(networkId), "owned-network-create");
    // All names are current-run nonce names. Mark before start so a partially started stack is cleaned.
    started = true;
    const output = await tool(cli, ["start", "--workdir", workdir, "--network-id", networkName, "--exclude", PROVIDER_EXCLUDED_SERVICES], undefined, 600_000); output.fill(0);
    identities = await containers(); check(identities.length >= 5, "full-provider-stack"); await assertOwned();
    const statusBytes = await tool(cli, ["status", "--workdir", workdir, "--output", "json"]); let status: Row;
    try { status = object(JSON.parse(statusBytes.toString("utf8"))); } finally { statusBytes.fill(0); }
    check(providerLoopbackOrigin(status.API_URL) === apiOrigin && typeof status.ANON_KEY === "string" && typeof status.SERVICE_ROLE_KEY === "string" && typeof status.JWT_SECRET === "string", "local-key-binding");
    return { runId, projectId, sourceProfileHash, configurationHash, apiOrigin, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY, jwtSecret: status.JWT_SECRET, identities,
      assertOwned, close, async sql(query) {
        await assertOwned(); check(typeof query === "string" && !query.includes("\0") && Buffer.byteLength(query) <= 1024 * 1024, "fixed-fixture-sql");
        const database = identities.find(row => row.name === `/supabase_db_${projectId}`); check(database, "owned-database");
        const session = await openFramedPsqlSession("docker", dockerArgs(["exec", "-i", database.id, "psql", "-X", "-w", "-q", "-t", "-A", "-U", "postgres", "-d", "postgres"]), { timeoutMs: 60_000, maxOutputBytes: 8 * 1024 * 1024 },
          { spawn: (file, args, options) => spawn(file, [...args], { ...options, env }) });
        try { await session.query("SET client_min_messages='warning';"); return await session.query(query); } finally { await session.close(); }
      } };
  } catch (error) {
    const code = error instanceof ProviderRehearsalFailure && /^[a-zA-Z0-9_-]{1,75}$/.test(error.code) ? error.code : "owned-stack-bootstrap-failed";
    await emitBootstrapDiagnostics(code);
    try { await close(); } catch { throw new ProviderStackBootstrapFailure(`${code}-cleanup-unverified`, runId, false); }
    throw new ProviderStackBootstrapFailure(code, runId, true);
  }
}
