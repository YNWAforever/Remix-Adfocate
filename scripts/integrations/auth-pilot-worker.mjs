/**
 * PREPARED LOCAL WORKER; importing this module never starts clients or listeners.
 * CLI: node scripts/integrations/auth-pilot-worker.mjs --private-dir <pinned dir>
 *      --public-key-file <runtime-public-config.json>.
 * Public config: {projectRef,supabaseUrl,publishableKey,keyType}; no secret key.
 * First/only stdin JSON line: {"serviceKey":"...","controlToken":"..."}; then EOF.
 * Parent creates the protected private directory and control.json first.
 * POST http://127.0.0.1:8786/control with Bearer controlToken:
 *   {"action":"status"|"create-users"|"start-apps"|"login-all"|"cleanup"}
 *
 * Required parent evidence in docs/review/kocmax-stage-4d/d1/auth-permission-execution:
 * application-receipt.json:
 *   {status:"APPLIED_AND_READ_ONLY_POSTCONDITIONS_PASSED",projectRef,sqlSha256}
 * auth-pilot-readonly-gate.json (observed within 15 min at worker startup):
 *   {status:"PASSED",projectRef,runId,sqlSha256,preparedManifestSha256,observedAt,
 *    transactionReadOnly:true,rowSecurityOff:true,sqlApplied:true,backupRestoreVerified:true,
 *    originalDataUnchanged:true,authUserTriggers:0,reservedEmailCollisions:[]}
 *   On recovery, collisions may ONLY be {alias,authId} already in the private
 *   ownership journal (including an interrupted create's preallocated ID).
 *   Only READONLY_GATE_STALE waits: reread complete evidence every second for
 *   at most 60 min, keeping stdin secrets in memory. Parent must replace the
 *   gate JSON atomically; missing/malformed/other invalid evidence fails closed.
 *   startup-status.json reports WAITING_PARENT_PREFLIGHT, STARTING, READY or
 *   FAILED using fixed project/run/status fields only. No client/listener starts
 *   while waiting; full validation and the 15 min freshness limit are unchanged.
 * fixture-seed-receipt.json (required for start-apps AND login-all):
 *   {status:"ROOT_SEEDED",projectRef,runId,sqlSha256,accounts:[{alias,authId}],
 *    workspaces:[{alias,id,slug}],staffRoles:[{alias,workspaceAlias,role}],
 *    brandMembershipAliases:["S-A","S-O","S-R","S-F","B-A"],uXAuthOnly:true}
 * fixture-role-revocation-receipt.json (cleanup after any app exposure):
 *   {status:"ROLES_REVOKED",projectRef,runId,
 *    accounts:[{alias,authId,workspaceAlias:"A"|"B"}]} in prepared account order.
 * Parent verifies/revokes audited roles via MCP before writing this receipt.
 * Receipt assertions attest parent MCP work; this worker never seeds DB rows.
 *
 * Private: accounts.json stores nine UI passwords, worker-state.json ownership
 * journal; no service key or control token is written by this worker, no JWT
 * is persisted. Public: runtime-receipt.json contains allowlisted IDs/statuses;
 * users-created.json contains {phase:"users_created",projectRef,runId,
 * users:[{alias,authId,email,createdThisRun:true}]} for the parent fixture factory.
 * After app exposure cleanup calls POST /api/me/delete {confirm:"DELETE"} with
 * each owned user's JWT and its recorded workspace. This original route already
 * anonymizes and bans; then the worker globally signs out and verifies the ban.
 * Only its exact deleted-<owned-id>@deleted.invalid identity is accepted.
 * Auth parents/audits are retained; no hard Auth delete or manual DB cascade.
 * Refresh revocation does NOT prove outstanding access JWTs immediately invalid.
 * Cleanup may obtain an Auth-only password session to revoke all sessions after
 * a worker restart; it never invokes creator bootstrap. If a product-deleted
 * user's JWT was lost/expired, session revocation needs parent review rather than
 * unbanning/recreating the account or claiming cleanup complete.
 * JS strings/process memory are not a cryptographic zeroization guarantee.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  assertPrivateDirectory, readJsonFile, writeJsonAtomic, removePrivateCredentials,
  verifyCheckout, launchApps, stopApps, runAppChild, acquireLock, enableProductCleanup,
} from './auth-pilot-local.mjs';

export const PROJECT = 'mhkoayftiuojxlrkollf';
export const RUN = '5f694251-c6eb-4f5f-a281-25e91db81c04';
export const SQL_SHA256 = 'ae276f3dfc22539b48e482dceb1aeab8de2774c75f32816fe58665bfef8b7b8d';
export const MANIFEST_SHA256 = '32e41e0aa7febd55bb75516779bca8ac5ce62e796e28ee3a503e1a9a414aaab1';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const REPORT_DIR = path.join(ROOT, 'docs/review/kocmax-stage-4d/d1/auth-permission-execution');
export const PRIVATE_DIR = 'C:/Users/laich/AppData/Local/KOCmax/AuthPilot/' + RUN;
export const ORIGIN = 'http://127.0.0.1:8786';
export const SUPABASE_URL = 'https://' + PROJECT + '.supabase.co';
export const ALIASES = ['C-A', 'C-P', 'C-B', 'S-A', 'S-O', 'S-R', 'S-F', 'B-A', 'U-X'];
export const WORKSPACES = [
  { alias: 'A', id: '00391df1-e411-4a82-a317-4a73bb293f89', slug: 'kocmax-auth-' + RUN + '-a' },
  { alias: 'B', id: '5d92d267-1b2a-4f19-97bd-3c80f1f3b213', slug: 'kocmax-auth-' + RUN + '-b' },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['status', 'create-users', 'start-apps', 'login-all', 'cleanup']);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export class PilotError extends Error {
  constructor(code) { super(code); this.name = 'PilotError'; this.code = code; }
}
export function requirePilot(ok, code) { if (!ok) throw new PilotError(code); }
export function safeCode(error) { return error instanceof PilotError ? error.code : 'PILOT_OPERATION_FAILED'; }
const emailFor = (alias) => 'kocmax-' + RUN + '-' + alias.toLowerCase() + '@example.invalid';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validateEvidence({ manifestBytes, sqlBytes, receipt, gate }, now = Date.now()) {
  requirePilot(sha(manifestBytes) === MANIFEST_SHA256, 'PREPARED_MANIFEST_HASH_MISMATCH');
  requirePilot(sha(sqlBytes) === SQL_SHA256 && sqlBytes.length === 6869, 'SQL_HASH_MISMATCH');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  requirePilot(manifest.runId === RUN && manifest.projectRef === PROJECT &&
    manifest.requiresSqlSha256 === SQL_SHA256 && manifest.maxExecutionHours === 24 &&
    same(manifest.accounts.map((a) => a.alias), ALIASES), 'PREPARED_MANIFEST_MISMATCH');
  requirePilot(manifest.accounts.every((a) => a.email === emailFor(a.alias) &&
    a.authId === null && a.createdThisRun === false), 'PREPARED_ACCOUNT_MISMATCH');
  requirePilot(same(manifest.workspaces.map(({ alias, id, slug }) => ({ alias, id, slug })), WORKSPACES),
    'PREPARED_WORKSPACE_MISMATCH');
  requirePilot(receipt?.status === 'APPLIED_AND_READ_ONLY_POSTCONDITIONS_PASSED' &&
    receipt.projectRef === PROJECT && receipt.sqlSha256 === SQL_SHA256,
  'APPROVED_SQL_RECEIPT_REQUIRED');
  requirePilot(gate?.status === 'PASSED' && gate.projectRef === PROJECT && gate.runId === RUN &&
    gate.sqlSha256 === SQL_SHA256 && gate.preparedManifestSha256 === MANIFEST_SHA256 &&
    gate.transactionReadOnly === true && gate.rowSecurityOff === true && gate.sqlApplied === true &&
    gate.backupRestoreVerified === true && gate.originalDataUnchanged === true &&
    gate.authUserTriggers === 0 && Array.isArray(gate.reservedEmailCollisions),
  'READONLY_GATE_REQUIRED');
  const age = now - Date.parse(gate.observedAt);
  requirePilot(Number.isFinite(age) && age >= -30_000 && age <= 15 * 60_000, 'READONLY_GATE_STALE');
  return manifest;
}

/** Local-only wait; injected reads/clock/sleep/status writer keep tests offline. */
export async function waitForFreshReadonlyEvidence({ readEvidence, writeStatus,
  now = Date.now, monotonicNow = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), deadline = Infinity }) {
  const stopAt = Math.min(deadline, monotonicNow() + 60 * 60_000);
  let waiting = false;
  try {
    for (;;) {
      if (waiting) requirePilot(monotonicNow() < stopAt, 'READONLY_GATE_WAIT_TIMEOUT');
      // One complete JSON read per atomic parent replacement; never reuse gate fields.
      const bundle = await readEvidence();
      let manifest;
      try { manifest = validateEvidence(bundle, now()); }
      catch (error) {
        if (!(error instanceof PilotError) || error.code !== 'READONLY_GATE_STALE') throw error;
        if (!waiting) { await writeStatus('WAITING_PARENT_PREFLIGHT'); waiting = true; }
        const remaining = stopAt - monotonicNow();
        requirePilot(remaining > 0, 'READONLY_GATE_WAIT_TIMEOUT');
        await sleep(Math.min(1000, remaining));
        continue;
      }
      if (waiting) requirePilot(monotonicNow() < stopAt, 'READONLY_GATE_WAIT_TIMEOUT');
      await writeStatus('STARTING');
      return { bundle, manifest };
    }
  } catch (error) {
    await writeStatus('FAILED').catch(() => {});
    throw error;
  }
}

export function validateKeys(serviceKey, publicKey, controlToken) {
  requirePilot(typeof controlToken === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(controlToken),
    'CONTROL_TOKEN_INVALID');
  const check = (key, role, prefix) => {
    requirePilot(typeof key === 'string' && key.length < 16000, 'KEY_FORMAT_INVALID');
    if (key.startsWith(prefix)) return requirePilot(key.length >= prefix.length + 20, 'KEY_FORMAT_INVALID');
    let payload;
    try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); } catch {}
    requirePilot(payload?.role === role && payload?.ref === PROJECT, 'KEY_TARGET_OR_ROLE_MISMATCH');
  };
  check(serviceKey, 'service_role', 'sb_secret_');
  check(publicKey, 'anon', 'sb_publishable_');
  requirePilot(serviceKey !== publicKey && serviceKey !== controlToken, 'KEY_SEPARATION_REQUIRED');
}

export function authorizeControl(request, token) {
  if (request.method !== 'POST' || request.url !== '/control' ||
      request.headers.host !== '127.0.0.1:8786' || request.headers.origin ||
      request.headers['sec-fetch-site'] ||
      request.headers['content-type']?.split(';')[0].trim() !== 'application/json' ||
      request.socket.remoteAddress !== '127.0.0.1') return false;
  const provided = request.headers.authorization;
  if (typeof provided !== 'string') return false;
  const expected = Buffer.from('Bearer ' + token);
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sanitizedState(state) {
  return {
    runId: RUN, projectRef: PROJECT, status: state.phase,
    startedAt: state.startedAt, expiresAt: state.expiresAt,
    accounts: state.accounts.map((a) => ({
      alias: a.alias, authId: a.authId, candidateAuthId: a.attempted && !a.authId ? a.candidateId : null,
      createdThisRun: a.created === true, login: a.login ?? 'NOT_RUN',
      cleanup: a.cleanup ?? 'NOT_RUN',
      productDeletion: a.productDeleted === true ? 'VERIFIED' : 'NOT_VERIFIED',
    })),
    apps: state.apps ?? [],
    lastCode: state.lastCode ?? null,
    accessJwtInvalidation: 'NOT_PROVEN_BY_SESSION_REVOCATION',
    retainedAuthIds: state.accounts.filter((a) => a.cleanup === 'BANNED_SESSIONS_REVOKED').map((a) => a.authId),
  };
}

export function usersCreatedReceipt(state) {
  requirePilot(state.accounts.length === 9 && state.accounts.every((a, i) =>
    a.alias === ALIASES[i] && a.created === true && UUID.test(a.authId)), 'NINE_OWNED_USERS_REQUIRED');
  return { phase: 'users_created', projectRef: PROJECT, runId: RUN,
    users: state.accounts.map(({ alias, authId }) => ({
      alias, authId, email: emailFor(alias), createdThisRun: true,
    })) };
}

export function validateSeed(seed, state) {
  requirePilot(seed?.status === 'ROOT_SEEDED' && seed.projectRef === PROJECT && seed.runId === RUN &&
    seed.sqlSha256 === SQL_SHA256 && seed.uXAuthOnly === true, 'PARENT_SEED_RECEIPT_REQUIRED');
  requirePilot(same(seed.accounts, state.accounts.map(({ alias, authId }) => ({ alias, authId }))) &&
    same(seed.workspaces, WORKSPACES), 'PARENT_SEED_ID_MISMATCH');
  const roles = ['workspace_admin', 'operator', 'reviewer', 'finance_viewer'];
  requirePilot(same(seed.staffRoles, ['S-A', 'S-O', 'S-R', 'S-F'].map((alias, i) => ({
    alias, workspaceAlias: 'A', role: roles[i],
  }))) && same(seed.brandMembershipAliases, ['S-A', 'S-O', 'S-R', 'S-F', 'B-A']),
  'PARENT_SEED_ROLE_MISMATCH');
}

export function assertOwned(user, account, state) {
  const proof = user?.app_metadata?.auth_pilot;
  const expectedId = account.authId || account.candidateId;
  const email = user?.email?.toLowerCase();
  const exactEmail = email === emailFor(account.alias) ||
    (account.productDeletionAttempted === true && email === 'deleted-' + expectedId + '@deleted.invalid');
  requirePilot(user?.id === (account.authId || account.candidateId) && UUID.test(user.id) &&
    exactEmail && user.role === 'authenticated' && proof?.run_id === RUN &&
    proof.alias === account.alias && proof.ownership_nonce === state.ownershipNonce,
  'AUTH_OWNERSHIP_MISMATCH');
}

/** Dependency-injected engine: tests never construct a client or bind a port. */
export class Pilot {
  constructor({ state, credentials, auth, save, removeCredentials, seed, apps, roleRevocation,
    deleteProduct, now = Date.now }) {
    Object.assign(this, { state, credentials, auth, save, removeCredentials, seed, apps,
      roleRevocation, deleteProduct, now });
    this.tokens = new Map();
    this.busy = false;
  }
  async persist() { await this.save(this.state, this.credentials); }
  async action(action) {
    requirePilot(ACTIONS.has(action), 'ACTION_NOT_ALLOWED');
    if (action === 'status') return sanitizedState(this.state);
    requirePilot(!this.busy, 'ACTION_IN_PROGRESS');
    requirePilot(action === 'cleanup' || this.now() < Date.parse(this.state.expiresAt), 'RUN_EXPIRED');
    this.busy = true;
    try {
      if (action === 'create-users') await this.createUsers();
      if (action === 'start-apps') await this.startApps();
      if (action === 'login-all') await this.loginAll();
      if (action === 'cleanup') await this.cleanup();
      this.state.lastCode = null;
      await this.persist();
      return sanitizedState(this.state);
    } catch (error) {
      this.state.lastCode = safeCode(error);
      await this.persist().catch(() => {});
      throw new PilotError(this.state.lastCode);
    } finally { this.busy = false; }
  }
  async createUsers() {
    requirePilot(this.state.phase === 'READY' && !this.state.accounts.some((a) => a.attempted), 'CREATE_ALREADY_ATTEMPTED');
    for (const account of this.state.accounts) {
      requirePilot(this.now() < Date.parse(this.state.expiresAt), 'RUN_EXPIRED');
      const secret = this.credentials.accounts.find((a) => a.alias === account.alias);
      requirePilot(secret?.password, 'PRIVATE_CREDENTIAL_MISSING');
      account.candidateId = randomUUID();
      account.attempted = true;
      this.state.phase = 'CREATING_USERS';
      await this.persist(); // Journal the exact candidate before a possibly ambiguous POST.
      const user = await this.auth.create({
        id: account.candidateId, email: secret.email, password: secret.password, email_confirm: true, role: 'authenticated',
        app_metadata: { auth_pilot: { run_id: RUN, alias: account.alias, ownership_nonce: this.state.ownershipNonce } },
      });
      assertOwned(user, account, this.state);
      account.authId = user.id; account.created = true; secret.authId = user.id;
      await this.persist();
    }
    this.state.phase = 'USERS_CREATED_AWAITING_PARENT_SEED';
  }
  async assertSeed() {
    requirePilot(this.state.accounts.length === 9 && this.state.accounts.every((a) => a.created), 'NINE_OWNED_USERS_REQUIRED');
    validateSeed(await this.seed(), this.state);
  }
  async startApps() {
    requirePilot(['USERS_CREATED_AWAITING_PARENT_SEED', 'APPS_STARTED'].includes(this.state.phase), 'START_APPS_PHASE_INVALID');
    await this.assertSeed();
    requirePilot(!this.state.apps?.length, 'APPS_ALREADY_STARTED');
    this.state.apps = await this.apps.start(this.state.accounts.map((a) => a.authId));
    this.state.appsEverStarted = true;
    this.state.phase = 'APPS_STARTED';
  }
  async loginOne(account) {
    assertOwned(await this.auth.get(account.authId), account, this.state);
    const secret = this.credentials.accounts.find((a) => a.alias === account.alias);
    requirePilot(secret?.password, 'PRIVATE_CREDENTIAL_MISSING');
    const result = await this.auth.login(secret.email, secret.password);
    assertOwned(result.user, account, this.state);
    requirePilot(typeof result.session?.access_token === 'string', 'AUTH_SESSION_MISSING');
    this.tokens.set(account.alias, result.session.access_token);
    assertOwned(await this.auth.verify(result.session.access_token), account, this.state);
    return result.session.access_token;
  }
  async loginAll() {
    requirePilot(['APPS_STARTED', 'LOGIN_PARTIAL', 'LOGINS_VERIFIED'].includes(this.state.phase), 'LOGIN_PHASE_INVALID');
    await this.assertSeed();
    for (const account of this.state.accounts) {
      requirePilot(this.now() < Date.parse(this.state.expiresAt), 'RUN_EXPIRED');
      if (account.login === 'VERIFIED') continue;
      this.state.phase = 'LOGIN_PARTIAL';
      await this.loginOne(account);
      account.login = 'VERIFIED';
      await this.persist();
    }
    this.state.phase = 'LOGINS_VERIFIED';
  }
  async cleanup() {
    if (this.state.phase === 'AUTH_DISABLED_CREDENTIALS_REMOVED') return;
    let cleanupWorkspaces;
    if (this.state.appsEverStarted) {
      const receipt = await this.roleRevocation();
      requirePilot(receipt?.status === 'ROLES_REVOKED' && receipt.projectRef === PROJECT &&
        receipt.runId === RUN && Array.isArray(receipt.accounts) && receipt.accounts.length === 9 &&
        receipt.accounts.every((a, i) => a.alias === this.state.accounts[i].alias &&
          a.authId === this.state.accounts[i].authId && ['A','B'].includes(a.workspaceAlias)),
      'PARENT_ROLE_REVOCATION_RECEIPT_REQUIRED');
      cleanupWorkspaces = new Map(receipt.accounts.map((a) => [a.alias, a.workspaceAlias]));
      const remaining = this.state.accounts.filter((a) => !a.productDeleted);
      if (remaining.length) {
        requirePilot(this.state.apps?.length > 0, 'PRODUCT_CLEANUP_REQUIRES_RUNNING_APPS');
        await this.apps.enableCleanup(remaining.map((a) => a.authId));
      }
    }
    this.state.phase = 'CLEANUP_IN_PROGRESS';
    let incomplete = false;
    for (const account of this.state.accounts) {
      if (!account.attempted || account.cleanup === 'BANNED_SESSIONS_REVOKED') continue;
      try {
        const user = await this.auth.get(account.authId || account.candidateId, true);
        if (!user && !account.created) { account.cleanup = 'CREATE_CONFIRMED_ABSENT'; continue; }
        requirePilot(user, 'OWNED_AUTH_USER_MISSING_REVIEW');
        assertOwned(user, account, this.state); // Also reconciles an interrupted create by exact ID.
        account.authId = user.id; account.created = true;
        const secret = this.credentials.accounts.find((a) => a.alias === account.alias);
        if (secret) secret.authId = user.id;
        await this.persist();
        if (cleanupWorkspaces && !account.productDeleted) {
          // Fresh token before the existing product route changes email and bans.
          const jwt = await this.loginOne(account);
          account.productDeletionAttempted = true;
          await this.persist();
          await this.deleteProduct(account, jwt, cleanupWorkspaces.get(account.alias));
          account.productDeleted = true;
          await this.persist();
        }
        if (!account.sessionsRevoked) {
          requirePilot(!account.productDeleted || this.tokens.has(account.alias),
            'SESSION_REVOCATION_REQUIRES_PARENT');
          const jwt = this.tokens.get(account.alias) || await this.loginOne(account);
          await this.auth.revoke(jwt);
          account.sessionsRevoked = true;
          await this.persist();
        }
        // Never mutate an ID merely because it shares a reserved email prefix.
        assertOwned(await this.auth.get(account.authId), account, this.state);
        const banned = await this.auth.ban(account.authId);
        assertOwned(banned, account, this.state);
        const reread = await this.auth.get(account.authId);
        assertOwned(reread, account, this.state);
        requirePilot(Date.parse(reread.banned_until) > this.now(), 'BAN_READBACK_FAILED');
        account.cleanup = 'BANNED_SESSIONS_REVOKED';
        this.tokens.delete(account.alias);
      } catch (error) {
        account.cleanup = safeCode(error); incomplete = true;
      }
      await this.persist();
    }
    requirePilot(!incomplete, 'CLEANUP_INCOMPLETE_CREDENTIALS_RETAINED');
    await this.apps.stop();
    this.state.apps = [];
    await this.removeCredentials();
    this.credentials.accounts = [];
    this.tokens.clear();
    this.state.phase = 'AUTH_DISABLED_CREDENTIALS_REMOVED';
  }
}

export async function createAuthAdapter(serviceKey, publicKey, fetchImpl = globalThis.fetch) {
  // Only called after local approval/identity/ACL gates. No top-level SDK import.
  const { createClient } = await import('@supabase/supabase-js');
  const guardedFetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    requirePilot(url.origin === SUPABASE_URL && url.pathname.startsWith('/auth/v1/'), 'AUTH_NETWORK_TARGET_DENIED');
    return fetchImpl(input, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  };
  const config = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: guardedFetch } };
  const admin = createClient(SUPABASE_URL, serviceKey, config).auth.admin;
  const checked = (result, code) => {
    if (result.error) throw new PilotError(code);
    return result.data;
  };
  return {
    create: async (attributes) => checked(await admin.createUser(attributes), 'AUTH_CREATE_REJECTED_OR_COLLISION').user,
    get: async (id, allowAbsent = false) => {
      requirePilot(UUID.test(id || ''), 'AUTH_ID_INVALID');
      const r = await admin.getUserById(id);
      if (allowAbsent && r.error?.status === 404) return null;
      return checked(r, 'AUTH_READ_FAILED').user;
    },
    login: async (email, password) => {
      const client = createClient(SUPABASE_URL, publicKey, config);
      const data = checked(await client.auth.signInWithPassword({ email, password }), 'PASSWORD_LOGIN_FAILED');
      return data;
    },
    verify: async (jwt) => checked(await createClient(SUPABASE_URL, publicKey, config).auth.getUser(jwt), 'GET_USER_FAILED').user,
    revoke: async (jwt) => { checked(await admin.signOut(jwt, 'global'), 'SESSION_REVOCATION_FAILED'); },
    ban: async (id) => checked(await admin.updateUserById(id, { ban_duration: '876000h' }), 'AUTH_BAN_FAILED').user,
  };
}

export async function createGuardedAuth(bundle, keys, factory = createAuthAdapter, now = Date.now()) {
  validateEvidence(bundle, now);
  validateKeys(keys.serviceKey, keys.publicKey, keys.controlToken);
  return factory(keys.serviceKey, keys.publicKey);
}

export async function readStartupInput(stream) {
  let bytes = 0; const chunks = [];
  for await (const chunk of stream) {
    bytes += Buffer.byteLength(chunk);
    requirePilot(bytes <= 32768, 'STDIN_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  let parsed;
  try {
    const lines = Buffer.concat(chunks).toString('utf8').trim().split(/\r?\n/);
    requirePilot(lines.length === 1, 'ONE_STDIN_LINE_REQUIRED');
    parsed = JSON.parse(lines[0]);
  } finally { for (const b of chunks) b.fill(0); }
  requirePilot(parsed && same(Object.keys(parsed).sort(), ['controlToken', 'serviceKey']), 'STDIN_FIELDS_INVALID');
  return parsed;
}

export function parseArguments(args) {
  requirePilot(args.length === 4, 'USAGE_PRIVATE_DIR_AND_PUBLIC_KEY_FILE');
  const values = Object.fromEntries([[args[0], args[1]], [args[2], args[3]]]);
  requirePilot(typeof values['--private-dir'] === 'string' && typeof values['--public-key-file'] === 'string',
    'USAGE_PRIVATE_DIR_AND_PUBLIC_KEY_FILE');
  requirePilot(path.resolve(values['--private-dir']).replaceAll('\\', '/').toLowerCase() === PRIVATE_DIR.toLowerCase(),
    'PRIVATE_DIRECTORY_NOT_PINNED');
  return { privateDir: values['--private-dir'], publicKeyFile: values['--public-key-file'] };
}

async function startWorker() {
  const options = parseArguments(process.argv.slice(2));
  let { serviceKey, controlToken } = await readStartupInput(process.stdin);
  await assertPrivateDirectory(options.privateDir).catch(() => {
    throw new PilotError('PRIVATE_DIRECTORY_CHECK_FAILED');
  });
  await verifyCheckout(ROOT).catch(() => {
    throw new PilotError('CHECKOUT_CHECK_FAILED');
  });
  const control = await readJsonFile(path.join(options.privateDir, 'control.json'));
  requirePilot(control.origin === ORIGIN && control.token === controlToken, 'PRIVATE_CONTROL_MISMATCH');
  const keyPath = await fs.realpath(options.publicKeyFile);
  requirePilot(keyPath.toLowerCase().startsWith((path.resolve(ROOT) + path.sep).toLowerCase()) && path.extname(keyPath) === '.json',
    'PUBLIC_KEY_FILE_MUST_BE_WORKSPACE_JSON');
  const keyConfig = await readJsonFile(keyPath);
  requirePilot(same(Object.keys(keyConfig).sort(), ['keyType', 'projectRef', 'publishableKey', 'supabaseUrl']) &&
    keyConfig.projectRef === PROJECT && keyConfig.supabaseUrl === SUPABASE_URL &&
    typeof keyConfig.keyType === 'string', 'PUBLIC_KEY_FILE_FIELDS_INVALID');
  const publicKey = keyConfig.publishableKey;
  validateKeys(serviceKey, publicKey, controlToken);
  const writeStartupStatus = (status) => writeJsonAtomic(path.join(REPORT_DIR, 'startup-status.json'), {
    status, projectRef: PROJECT, runId: RUN, updatedAt: new Date().toISOString(),
  });
  const preflight = { writeStatus: writeStartupStatus, deadline: performance.now() + 60 * 60_000,
    readEvidence: async () => ({
    manifestBytes: await fs.readFile(path.join(REPORT_DIR, 'fixture-manifest.prepared.json')),
    sqlBytes: await fs.readFile(path.join(REPORT_DIR, '22-proposed-auth-boundary-apply.sql')),
    receipt: await readJsonFile(path.join(REPORT_DIR, 'application-receipt.json')),
    gate: await readJsonFile(path.join(REPORT_DIR, 'auth-pilot-readonly-gate.json')),
  }) };
  let { bundle, manifest } = await waitForFreshReadonlyEvidence(preflight);
  const stateFile = path.join(options.privateDir, 'worker-state.json');
  let state = await readJsonFile(stateFile, true);
  let credentials = await readJsonFile(path.join(options.privateDir, 'accounts.json'), true);
  if (state) {
    requirePilot(state.runId === RUN && state.projectRef === PROJECT && state.manifestSha256 === MANIFEST_SHA256 &&
      same(state.accounts.map((a) => a.alias), ALIASES) && /^[A-Za-z0-9_-]{43}$/.test(state.ownershipNonce),
    'PRIVATE_JOURNAL_MISMATCH');
    requirePilot(state.accounts.every((a) => (!a.authId || UUID.test(a.authId)) &&
      (!a.candidateId || UUID.test(a.candidateId))), 'PRIVATE_JOURNAL_ID_INVALID');
    state.apps = []; // Never kill a PID restored from disk; strict ports detect surviving apps.
    requirePilot(['READY','CREATING_USERS','USERS_CREATED_AWAITING_PARENT_SEED','APPS_STARTED',
      'LOGIN_PARTIAL','LOGINS_VERIFIED','CLEANUP_IN_PROGRESS','AUTH_DISABLED_CREDENTIALS_REMOVED'].includes(state.phase) &&
      Number.isFinite(Date.parse(state.startedAt)) && Number.isFinite(Date.parse(state.expiresAt)) &&
      Date.parse(state.expiresAt) - Date.parse(state.startedAt) === 24 * 3600000 &&
      (!state.lastCode || /^[A-Z0-9_]{1,80}$/.test(state.lastCode)), 'PRIVATE_JOURNAL_STATE_INVALID');
    if (['APPS_STARTED','LOGIN_PARTIAL','LOGINS_VERIFIED'].includes(state.phase)) {
      state.phase = 'USERS_CREATED_AWAITING_PARENT_SEED';
      for (const account of state.accounts) account.login = 'NOT_RUN';
    }
  } else {
    requirePilot(!credentials, 'UNOWNED_PRIVATE_CREDENTIALS_COLLISION');
    const now = Date.now();
    state = { runId: RUN, projectRef: PROJECT, manifestSha256: MANIFEST_SHA256,
      ownershipNonce: randomBytes(32).toString('base64url'), phase: 'READY',
      startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 24 * 3600000).toISOString(),
      accounts: manifest.accounts.map((a) => ({ alias: a.alias, authId: null, created: false, attempted: false })), apps: [] };
    credentials = { accounts: manifest.accounts.map((a) => ({
      alias: a.alias, email: a.email, password: randomBytes(32).toString('base64url') + 'Aa1!', authId: null,
    })) };
  }
  if (!credentials && state.accounts.every((a) => !a.attempted ||
      ['BANNED_SESSIONS_REVOKED', 'CREATE_CONFIRMED_ABSENT'].includes(a.cleanup))) {
    requirePilot(state.phase !== 'READY', 'PRIVATE_CREDENTIALS_MISSING');
    state.phase = 'AUTH_DISABLED_CREDENTIALS_REMOVED';
  }
  if (state.phase !== 'AUTH_DISABLED_CREDENTIALS_REMOVED') {
    requirePilot(credentials?.accounts?.length === 9 && credentials.accounts.every((a, i) =>
      a.alias === ALIASES[i] && a.email === emailFor(a.alias) && typeof a.password === 'string' &&
      a.password.length >= 40 && a.authId === state.accounts[i].authId), 'PRIVATE_CREDENTIALS_MISMATCH');
  } else credentials = { accounts: [] };
  const checkCollisions = () => {
    for (const collision of bundle.gate.reservedEmailCollisions) {
      requirePilot(state.accounts.some((a) => a.attempted && a.alias === collision.alias &&
        (a.authId || a.candidateId) === collision.authId), 'RESERVED_EMAIL_COLLISION');
    }
  };
  checkCollisions();
  const releaseLock = await acquireLock(options.privateDir);
  const children = new Map();
  try {
  const save = async (nextState, secrets) => {
    await assertPrivateDirectory(options.privateDir);
    if (nextState.phase !== 'AUTH_DISABLED_CREDENTIALS_REMOVED') {
      await writeJsonAtomic(path.join(options.privateDir, 'accounts.json'), secrets);
    }
    await writeJsonAtomic(stateFile, nextState);
    await writeJsonAtomic(path.join(REPORT_DIR, 'runtime-receipt.json'), sanitizedState(nextState));
    if (nextState.phase === 'USERS_CREATED_AWAITING_PARENT_SEED' &&
        nextState.accounts.every((a) => a.created)) {
      const factoryFile = path.join(REPORT_DIR, 'users-created.json');
      const expected = usersCreatedReceipt(nextState);
      const existing = await readJsonFile(factoryFile, true);
      requirePilot(!existing || same(existing, expected), 'USERS_CREATED_RECEIPT_COLLISION');
      if (!existing) await writeJsonAtomic(factoryFile, expected);
    }
  };
  // The readonly gate and private-directory checks precede this first client.
  let auth;
  for (;;) {
    try {
      auth = await createGuardedAuth(bundle, { serviceKey, publicKey, controlToken });
      break;
    } catch (error) {
      if (!(error instanceof PilotError) || error.code !== 'READONLY_GATE_STALE') throw error;
      // If setup crossed the freshness boundary, retain secrets and the same deadline.
      ({ bundle } = await waitForFreshReadonlyEvidence(preflight));
      checkCollisions();
    }
  }
  const pilot = new Pilot({ state, credentials, auth, save,
    removeCredentials: () => removePrivateCredentials(options.privateDir),
    seed: () => readJsonFile(path.join(REPORT_DIR, 'fixture-seed-receipt.json')),
    roleRevocation: () => readJsonFile(path.join(REPORT_DIR, 'fixture-role-revocation-receipt.json')),
    deleteProduct: async (_account, jwt, workspaceAlias) => {
      const workspace = WORKSPACES.find((w) => w.alias === workspaceAlias);
      requirePilot(workspace, 'CLEANUP_WORKSPACE_INVALID');
      const origin = workspaceAlias === 'A' ? 'http://127.0.0.1:8784' : 'http://127.0.0.1:8785';
      const response = await fetch(origin + '/api/me/delete', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { authorization: 'Bearer ' + jwt, 'content-type': 'application/json',
          'X-Workspace-Slug': workspace.slug },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      requirePilot(response.ok && response.headers.get('content-type')?.includes('application/json'),
        'PRODUCT_ANONYMIZATION_FAILED');
      const result = await response.json();
      requirePilot(result?.deleted === true, 'PRODUCT_ANONYMIZATION_NOT_VERIFIED');
    },
    apps: {
      start: (authIds) => launchApps(children, { root: ROOT, privateDir: options.privateDir,
        serviceKey, publicKey, supabaseUrl: SUPABASE_URL, workspaces: WORKSPACES, authIds }),
      stop: () => stopApps(children),
      enableCleanup: (ids) => enableProductCleanup(children, ids),
    },
  });
  await pilot.persist();
  // No HTTP server/request module is imported before stdin, receipt and readonly gates.
  const { createServer } = await import('node:http');
  const server = createServer(async (req, res) => {
    const respond = (status, data) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'connection': 'close' });
      res.end(JSON.stringify(data));
    };
    if (!authorizeControl(req, controlToken)) { req.resume(); respond(403, { ok: false, code: 'CONTROL_DENIED' }); return; }
    try {
      let body = ''; for await (const part of req) {
        body += part.toString('utf8'); requirePilot(Buffer.byteLength(body) <= 2048, 'CONTROL_BODY_TOO_LARGE');
      }
      let input; try { input = JSON.parse(body); } catch { throw new PilotError('CONTROL_JSON_INVALID'); }
      requirePilot(input && same(Object.keys(input), ['action']) && ACTIONS.has(input.action), 'ACTION_NOT_ALLOWED');
      const result = await pilot.action(input.action);
      respond(200, { ok: true, ...result });
    } catch (error) { respond(409, { ok: false, code: safeCode(error), ...sanitizedState(pilot.state) }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.maxHeadersCount = 20;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8786, '127.0.0.1', resolve); });
  const expiry = setTimeout(() => {
    // Do not race private credential/journal writes with an in-flight action.
    state.lastCode = 'RUN_EXPIRED';
    void stopApps(children).then(() => { state.apps = []; }).catch(() => {});
  }, Math.max(1, Date.parse(state.expiresAt) - Date.now()));
  expiry.unref();
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    server.close(); clearTimeout(expiry);
    await stopApps(children).catch(() => {});
    serviceKey = ''; controlToken = ''; pilot.tokens.clear();
    await releaseLock().catch(() => {});
    process.exit(0); // Remote cleanup requires the explicit cleanup action, never a signal.
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  await writeStartupStatus('READY').catch((error) => {
    server.close(); clearTimeout(expiry); throw error;
  });
  process.stdout.write(JSON.stringify({ ok: true, status: 'WORKER_READY', runId: RUN, origin: ORIGIN }) + '\n');
  } catch (error) {
    await writeStartupStatus('FAILED').catch(() => {});
    await stopApps(children).catch(() => {});
    await releaseLock().catch(() => {});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) console[method] = () => {};
  const operation = process.argv[2] === '--app-child' ? runAppChild() : startWorker();
  operation.catch((error) => {
    // Only fixed PilotError codes leave the process; raw exceptions may contain
    // command/input details and must never reach launcher output or reports.
    process.stderr.write(JSON.stringify({ ok: false, code: safeCode(error) }) + '\n');
    process.exitCode = 1;
  });
}
