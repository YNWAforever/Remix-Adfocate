import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSanitized } from "./evidence";
import { canonicalDeltaJson, digestDeltaProofPayload } from "./delta-evidence";
import { DELTA_RELEASE_PROJECT } from "./delta-release-contracts";
import type { PairedRecoveryArtifact, PairedRecoveryArtifactName, PairedRecoveryPrivateStore } from "./delta-recovery";
import { DELTA_PRIVATE_BINARY_MAXIMUM, runDeltaPrivateBinary } from "./delta-private-binary";

const NAMES = ["database.dump", "roles.sql", "toc.list"] as const;
const ALL_NAMES = [...NAMES, "manifest.json"] as const;
type InternalName = typeof ALL_NAMES[number];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const HELPER = fileURLToPath(new URL("./delta-private-artifacts.ps1", import.meta.url));
export const DELTA_PRIVATE_HELPER_SHA256 = "dc5818f8842d32dafedbd5f5a82abeadd2f943174469e486eb659eb254efae6e";
function held(): Error { return new Error("private recovery artifact operation held"); }
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function within(path: string, root: string) { const part = relative(root, path); return part === "" || (!part.startsWith("..") && !isAbsolute(part)); }
function outside(path: string, roots: readonly string[]) { if (!isAbsolute(path) || path.startsWith("\\\\") || roots.some(root => within(path, root))) throw held(); }
export interface PrivateRecoveryAttemptOptions { readonly repoRoot: string; readonly servedRoots?: readonly string[] }
/** Testable security boundary. A real backend must validate ACL/mode, identity, links and fixed paths for every operation. */
export interface DeltaPrivateArtifactsBackend {
  initialize(id: string, create: boolean): Promise<void>;
  directory(): Promise<string>;
  write(name: InternalName, bytes: Buffer): Promise<{ name: string; bytes: number; sha256: string }>;
  read(name: InternalName): Promise<Buffer>;
  inspect(name: InternalName): Promise<{ name: string; bytes: number; sha256: string }>;
  inventory(): Promise<readonly string[]>;
}
export interface DeltaPrivateArtifactsDependencies {
  readonly backend?: DeltaPrivateArtifactsBackend; readonly uuid?: () => string;
  readonly canonicalBoundary?: (path: string) => Promise<string>;
}
export interface PrivateRecoveryAttempt extends PairedRecoveryPrivateStore {
  readonly reference: string; readonly attemptId: string;
  inspect(name: PairedRecoveryArtifactName): Promise<PairedRecoveryArtifact>;
  /** Internal native-tool integration only. Never include this value in a receipt. */
  privateDirectory(): Promise<string>;
}
export function assertPrivatePosixStat(stat: Pick<Stats, "uid" | "mode" | "nlink" | "isDirectory" | "isFile" | "isSymbolicLink">, uid: number, directory: boolean) {
  if (stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o7777) !== (directory ? 0o700 : 0o600)
    || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw held();
}
type AncestorStat = Pick<Stats, "uid" | "mode" | "isDirectory" | "isSymbolicLink">;
export function assertPrivatePosixAncestor(stat: AncestorStat, uid: number) {
  if (!stat.isDirectory() || stat.isSymbolicLink() || ![0, uid].includes(stat.uid) || (stat.mode & 0o022) !== 0) throw held();
}
export interface PrivateBoundaryFilesystem {
  readonly lstat: (path: string) => Promise<AncestorStat>;
  readonly realpath: (path: string) => Promise<string>;
  readonly platform?: NodeJS.Platform; readonly currentUid?: number; readonly requireTrustedAncestors?: boolean;
}
/** Reject aliases in every existing ancestor; canonicalize the longest existing directory plus its missing suffix. */
export async function canonicalPrivateBoundary(path: string, io: PrivateBoundaryFilesystem = { lstat, realpath }): Promise<string> {
  const absolute = resolve(path); if (!isAbsolute(path) || absolute.startsWith("\\\\") || absolute.length > 4096) throw held();
  const platform = io.platform ?? process.platform, uid = io.currentUid ?? (platform === "linux" ? userInfo().uid : -1);
  const chain: string[] = []; let cursor = absolute;
  for (;;) { chain.push(cursor); const parent = dirname(cursor); if (parent === cursor) break; cursor = parent; }
  let existing: string | undefined;
  for (const candidate of chain.reverse()) {
    let stat: AncestorStat;
    try { stat = await io.lstat(candidate); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw held(); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw held();
    if (platform === "linux" && io.requireTrustedAncestors) assertPrivatePosixAncestor(stat, uid); existing = candidate;
  }
  if (!existing) throw held(); const canonical = await io.realpath(existing);
  if (!isAbsolute(canonical) || canonical.startsWith("\\\\") || (platform === "win32" ? canonical.toLowerCase() !== existing.toLowerCase() : canonical !== existing)) throw held();
  return resolve(canonical, relative(existing, absolute));
}
async function noLinks(path: string) {
  let cursor = path;
  for (;;) { if ((await lstat(cursor)).isSymbolicLink()) throw held(); const parent = dirname(cursor); if (parent === cursor) break; cursor = parent; }
  if (await realpath(path) !== path) throw held();
}
function posixBackend(roots: readonly string[]): DeltaPrivateArtifactsBackend {
  const user = userInfo(); const home = resolve(user.homedir); const base = join(home, ".kocmax-private-paired-recovery"), project = join(base, DELTA_RELEASE_PROJECT);
  let directory = "", identity = "";
  const id = (stat: Stats) => `${stat.dev}:${stat.ino}`;
  async function check() {
    await noLinks(directory); await canonicalPrivateBoundary(directory, { lstat, realpath, requireTrustedAncestors: true });
    for (const path of [base, project, directory]) assertPrivatePosixStat(await lstat(path), user.uid, true);
    if (id(await lstat(directory)) !== identity) throw held(); outside(directory, roots);
    const names = await readdir(directory); if (names.some(name => !(ALL_NAMES as readonly string[]).includes(name))) throw held();
  }
  async function syncDirectory(path = directory) { const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } }
  async function read(name: InternalName): Promise<Buffer> {
    await check(); const path = join(directory, name); const initial = await lstat(path); assertPrivatePosixStat(initial, user.uid, false);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); let bytes: Buffer | undefined, closed = false;
    try {
      const stat = await handle.stat(); assertPrivatePosixStat(stat, user.uid, false); if (id(stat) !== id(initial) || stat.size < 1 || stat.size > DELTA_PRIVATE_BINARY_MAXIMUM) throw held();
      bytes = Buffer.alloc(stat.size); let offset = 0;
      while (offset < bytes.length) { const result = await handle.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) throw held(); offset += result.bytesRead; }
      const after = await handle.stat(); assertPrivatePosixStat(after, user.uid, false);
      if (id(after) !== id(stat) || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || id(await lstat(path)) !== id(stat)) throw held();
      await check();
    } catch { bytes?.fill(0); throw held(); } finally { try { await handle.close(); closed = true; } catch { bytes?.fill(0); } }
    if (!closed || !bytes) throw held(); return bytes;
  }
  return {
    async initialize(attempt, create) {
      await noLinks(home); await canonicalPrivateBoundary(home, { lstat, realpath, requireTrustedAncestors: true }); const anchor = await lstat(home);
      if (!anchor.isDirectory() || anchor.uid !== user.uid || (anchor.mode & 0o022)) throw held();
      for (const path of [base, project]) {
        outside(path, roots); try { await mkdir(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw held(); }
        await noLinks(path); assertPrivatePosixStat(await lstat(path), user.uid, true); await syncDirectory(dirname(path));
      }
      directory = join(project, attempt); outside(directory, roots);
      if (create) await mkdir(directory, { mode: 0o700 });
      const stat = await lstat(directory); assertPrivatePosixStat(stat, user.uid, true); identity = id(stat); await check();
      if (create && (await readdir(directory)).length) throw held(); await syncDirectory(project); await syncDirectory();
    },
    async directory() { await check(); return directory; },
    async inventory() { await check(); return readdir(directory); },
    async write(name, bytes) {
      await check(); const path = join(directory, name), handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        const before = await handle.stat(); assertPrivatePosixStat(before, user.uid, false);
        await handle.writeFile(bytes); await handle.sync(); const after = await handle.stat(); assertPrivatePosixStat(after, user.uid, false);
        if (id(before) !== id(after) || after.size !== bytes.length || id(await lstat(path)) !== id(after)) throw held(); await check();
      } finally { await handle.close(); }
      await syncDirectory(); const stored = await read(name);
      try { return { name, bytes: stored.length, sha256: hash(stored) }; } finally { stored.fill(0); }
    },
    read,
    async inspect(name) { const bytes = await read(name); try { return { name, bytes: bytes.length, sha256: hash(bytes) }; } finally { bytes.fill(0); } },
  };
}
function windowsBackend(repoRoot: string, roots: readonly string[]): DeltaPrivateArtifactsBackend {
  const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  let attemptId = "", identity = "", directory = "";
  async function invoke(action: string, name?: InternalName, input: Buffer = Buffer.alloc(0)) {
    try {
      for (const path of [HELPER, executable]) { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || (await realpath(path)).toLowerCase() !== path.toLowerCase()) throw held(); }
      const code = await readFile(HELPER); if (hash(code) !== DELTA_PRIVATE_HELPER_SHA256) throw held();
      const parameters = JSON.stringify({ Action: action, AttemptId: attemptId, RepoRoot: repoRoot, ServedRootsJson: JSON.stringify(roots),
        ...(identity ? { ExpectedDirectoryId: identity } : {}), ...(name ? { Name: name } : {}) });
      if (Buffer.byteLength(parameters, "utf8") > 4096) throw held();
      const location = Buffer.from(HELPER, "utf8").toString("base64"), metadata = Buffer.from(parameters, "utf8").toString("base64");
      // Only these fixed public program/configuration bytes enter the command. Archive bytes remain on anonymous stdin.
      const wrapper = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';try{foreach($scope in @('MachinePolicy','UserPolicy')){if((Get-ExecutionPolicy -Scope $scope) -notin @('Undefined','Unrestricted','Bypass')){throw 'held'}};$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${location}'));$code=[IO.File]::ReadAllBytes($path);$sha=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($sha.ComputeHash($code))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};if($digest -cne '${DELTA_PRIVATE_HELPER_SHA256}'){throw 'held'};$config=ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${metadata}')));$values=@{};foreach($property in $config.PSObject.Properties){$values[$property.Name]=$property.Value};& ([ScriptBlock]::Create(([Text.UTF8Encoding]::new($false,$true)).GetString($code))) @values}catch{[Console]::Error.Write('private artifact operation held');exit 1}`;
      return await runDeltaPrivateBinary(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(wrapper, "utf16le").toString("base64")],
        input, action === "Read" ? DELTA_PRIVATE_BINARY_MAXIMUM : 32768);
    } catch { input.fill(0); throw held(); }
  }
  function json(bytes: Buffer): Record<string, unknown> { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Record<string, unknown>; } finally { bytes.fill(0); } }
  return {
    async initialize(id, create) {
      attemptId = id; const result = json(await invoke(create ? "Create" : "Open"));
      if (typeof result.directory !== "string" || typeof result.identity !== "string" || !/^[a-f0-9]{8}:[a-f0-9]{16}$/.test(result.identity)) throw held();
      directory = result.directory; identity = result.identity; outside(directory, roots); if (dirname(directory).split(/[\\/]/).at(-1) !== DELTA_RELEASE_PROJECT || directory.split(/[\\/]/).at(-1) !== attemptId) throw held();
    },
    async directory() { const result = json(await invoke("Check")); if (result.identity !== identity || result.directory !== directory) throw held(); return directory; },
    async inventory() { const result = json(await invoke("Check")); if (result.identity !== identity || !Array.isArray(result.inventory)) throw held(); return result.inventory as string[]; },
    async write(name, input) { return json(await invoke(name === "manifest.json" ? "Seal" : "Write", name, input)) as unknown as { name: string; bytes: number; sha256: string }; },
    async read(name) { return invoke("Read", name); },
    async inspect(name) { return json(await invoke("Inspect", name)) as unknown as { name: string; bytes: number; sha256: string }; },
  };
}
function artifact(name: PairedRecoveryArtifactName, bytes: Buffer): PairedRecoveryArtifact { return { name, bytes: bytes.length, sha256: hash(bytes) }; }
function publicManifest(value: unknown) {
  const canonical = canonicalDeltaJson(value); const snapshot = JSON.parse(canonical) as Record<string, unknown>; assertSanitized(snapshot);
  function walk(item: unknown): void {
    if (typeof item === "string" && (/^(?:[A-Za-z]:[\\/]|\/|\\\\|file:)/.test(item) || item.includes("\0"))) throw held();
    if (Array.isArray(item)) item.forEach(walk); else if (item && typeof item === "object") Object.values(item).forEach(walk);
  }
  walk(snapshot); if (snapshot.status !== "HOLD" || snapshot.validReleaseEvidence !== false || !Array.isArray(snapshot.artifacts)) throw held(); return { canonical, snapshot };
}
async function makeStore(options: PrivateRecoveryAttemptOptions, dependencies: DeltaPrivateArtifactsDependencies, reopen?: { reference: string; manifestSha256: string }): Promise<PrivateRecoveryAttempt> {
  try {
    const repoInput = resolve(options.repoRoot), home = userInfo().homedir;
    const inputs = Object.freeze([...new Set([repoInput, fileURLToPath(new URL("../../", import.meta.url)),
      join(home, ".codex", "visualizations"), join(home, ".dsh", "visualizations"), ...(options.servedRoots ?? []).map(root => resolve(root))])]);
    const canonicalize = dependencies.canonicalBoundary ?? canonicalPrivateBoundary;
    const roots = Object.freeze(await Promise.all(inputs.map(path => canonicalize(path)))); const repoRoot = roots[0]!;
    async function recheckRoots() {
      const current = await Promise.all(inputs.map(path => canonicalize(path)));
      if (canonicalDeltaJson(current) !== canonicalDeltaJson(roots)) throw held();
    }
    await recheckRoots();
    const attemptId = reopen ? reopen.reference.replace(/^private-recovery:/, "") : (dependencies.uuid ?? randomUUID)();
    if (!UUID.test(attemptId) || (reopen && (reopen.reference !== `private-recovery:${attemptId}` || !SHA.test(reopen.manifestSha256)))) throw held();
    const candidateBackend = dependencies.backend ?? (process.platform === "win32" ? windowsBackend(repoRoot, roots) : process.platform === "linux" ? posixBackend(roots) : undefined);
    if (!candidateBackend) throw held(); const backend = candidateBackend; await backend.initialize(attemptId, !reopen); outside(await backend.directory(), roots);
    const reference = `private-recovery:${attemptId}`, records = new Map<PairedRecoveryArtifactName, PairedRecoveryArtifact>(); let sealed = Boolean(reopen), failed = false, busy = false;
    const validName = (name: string): name is PairedRecoveryArtifactName => (NAMES as readonly string[]).includes(name);
    async function inspect(name: PairedRecoveryArtifactName) { await recheckRoots(); const actual = await backend.inspect(name), expected = records.get(name); if (!expected || canonicalDeltaJson(actual) !== canonicalDeltaJson(expected)) throw held(); return Object.freeze({ ...expected }); }
    if (reopen) {
      const inventory = [...await backend.inventory()].sort(); if (canonicalDeltaJson(inventory) !== canonicalDeltaJson([...ALL_NAMES].sort())) throw held();
      const bytes = await backend.read("manifest.json");
      try {
        if (hash(bytes) !== reopen.manifestSha256) throw held(); const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); const manifest = publicManifest(JSON.parse(text));
        if (manifest.canonical !== text) throw held();
        for (const row of manifest.snapshot.artifacts as PairedRecoveryArtifact[]) {
          if (!row || !validName(row.name) || records.has(row.name) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || !SHA.test(row.sha256)) throw held(); records.set(row.name, { name: row.name, bytes: row.bytes, sha256: row.sha256 });
        }
        if (records.size !== 3) throw held(); for (const name of NAMES) await inspect(name);
      } finally { bytes.fill(0); }
    }
    return Object.freeze({ reference, attemptId,
      async privateDirectory() { try { await recheckRoots(); const directory = await backend.directory(); outside(directory, roots); return directory; } catch { throw held(); } },
      async inspect(name: PairedRecoveryArtifactName) { try { if (!validName(name)) throw held(); return await inspect(name); } catch { throw held(); } },
      async write(name: PairedRecoveryArtifactName, input: Buffer) {
        let bytes: Buffer | undefined, acquired = false;
        try {
          if (!Buffer.isBuffer(input) || !input.length || input.length > DELTA_PRIVATE_BINARY_MAXIMUM
            || !validName(name) || sealed || failed || busy || records.has(name)) throw held();
          bytes = Buffer.from(input); input.fill(0);
          busy = true; acquired = true; await recheckRoots(); const expected = artifact(name, bytes), actual = await backend.write(name, bytes);
          await recheckRoots();
          if (failed || canonicalDeltaJson(actual) !== canonicalDeltaJson(expected)) throw held(); records.set(name, expected); return Object.freeze({ ...expected });
        } catch { failed = true; throw held(); } finally { if (Buffer.isBuffer(input)) input.fill(0); bytes?.fill(0); if (acquired) busy = false; }
      },
      async read(name: PairedRecoveryArtifactName) {
        let bytes: Buffer | undefined;
        try { if (!validName(name) || failed || busy || !records.has(name)) throw held(); await inspect(name); bytes = await backend.read(name);
          if (!Buffer.isBuffer(bytes) || canonicalDeltaJson(artifact(name, bytes)) !== canonicalDeltaJson(records.get(name))) throw held(); await recheckRoots(); return bytes;
        } catch { if (Buffer.isBuffer(bytes)) bytes.fill(0); throw held(); }
      },
      async seal(manifest: unknown) {
        let bytes: Buffer | undefined, acquired = false;
        try {
          if (sealed || failed || busy || records.size !== 3) throw held(); busy = true; acquired = true;
          const prepared = publicManifest(manifest), expectedRows = [...records.values()].sort((a, b) => a.name < b.name ? -1 : 1);
          const suppliedRows = [...prepared.snapshot.artifacts as PairedRecoveryArtifact[]].sort((a, b) => a.name < b.name ? -1 : 1);
          if (canonicalDeltaJson(expectedRows) !== canonicalDeltaJson(suppliedRows)) throw held();
          for (const name of NAMES) await inspect(name); bytes = Buffer.from(prepared.canonical, "utf8");
          if (failed) throw held();
          const digest = digestDeltaProofPayload(prepared.snapshot), actual = await backend.write("manifest.json", bytes);
          if (failed || actual.name !== "manifest.json" || actual.bytes !== Buffer.byteLength(prepared.canonical) || actual.sha256 !== digest) throw held();
          sealed = true; return { reference, manifestSha256: digest };
        } catch { failed = true; throw held(); } finally { bytes?.fill(0); if (acquired) busy = false; }
      },
    });
  } catch { throw held(); }
}
export function createPrivateRecoveryAttempt(options: PrivateRecoveryAttemptOptions, dependencies: DeltaPrivateArtifactsDependencies = {}): Promise<PrivateRecoveryAttempt> { return makeStore(options, dependencies); }
export function openPrivateRecoveryAttempt(options: PrivateRecoveryAttemptOptions & { readonly reference: string; readonly manifestSha256: string }, dependencies: DeltaPrivateArtifactsDependencies = {}): Promise<PrivateRecoveryAttempt> { return makeStore(options, dependencies, options); }
