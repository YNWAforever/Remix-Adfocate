// Pure/mocked tests only: no SDK, network, listener, child process, account or fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  Pilot, PilotError, PROJECT, RUN, SQL_SHA256, MANIFEST_SHA256, ALIASES,
  WORKSPACES, REPORT_DIR, SUPABASE_URL, validateEvidence, validateKeys,
  authorizeControl, sanitizedState, createGuardedAuth, readStartupInput, usersCreatedReceipt,
  waitForFreshReadonlyEvidence,
} from './auth-pilot-worker.mjs';
import { allowedAppFetch, allowedProductCleanup, appEnvironment, cleanEnvironment } from './auth-pilot-local.mjs';

test('private path allows only the exact native or known packaged-app location for this run', async () => {
  const { isPinnedPrivateDirectoryResolution } = await import('./auth-pilot-local.mjs');
  const logical = 'C:/Users/laich/AppData/Local/KOCmax/AuthPilot/5f694251-c6eb-4f5f-a281-25e91db81c04';
  const packaged = 'C:/Users/laich/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/KOCmax/AuthPilot/5f694251-c6eb-4f5f-a281-25e91db81c04';
  assert.equal(isPinnedPrivateDirectoryResolution?.(logical, logical), true);
  assert.equal(isPinnedPrivateDirectoryResolution?.(logical, packaged), true);
  assert.equal(isPinnedPrivateDirectoryResolution?.(logical, packaged.replace('OpenAI.Codex_', 'Other.Package_')), false);
  assert.equal(isPinnedPrivateDirectoryResolution?.(logical, packaged.replace('/laich/', '/other-user/')), false);
  assert.equal(isPinnedPrivateDirectoryResolution?.(logical, packaged + '/nested'), false);
  assert.equal(isPinnedPrivateDirectoryResolution?.(logical + '/other-run', packaged), false);
  assert.equal(isPinnedPrivateDirectoryResolution?.(logical, 'C:/somewhere-else'), false);
});
test('Vite cache resolution permits only the two exact private cache directories', async () => {
  const { isPinnedPrivateCacheResolution } = await import('./auth-pilot-local.mjs');
  const logical = 'C:/Users/laich/AppData/Local/KOCmax/AuthPilot/5f694251-c6eb-4f5f-a281-25e91db81c04';
  const packaged = 'C:/Users/laich/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/KOCmax/AuthPilot/5f694251-c6eb-4f5f-a281-25e91db81c04';
  for (const alias of ['A','B']) {
    assert.equal(isPinnedPrivateCacheResolution?.(`${logical}/vite-cache-${alias}`, `${packaged}/vite-cache-${alias}`), true);
    assert.equal(isPinnedPrivateCacheResolution?.(`${logical}/vite-cache-${alias}`, `${logical}/vite-cache-${alias}`), true);
  }
  assert.equal(isPinnedPrivateCacheResolution?.(`${logical}/vite-cache-C`, `${packaged}/vite-cache-C`), false);
  assert.equal(isPinnedPrivateCacheResolution?.(`${logical}/vite-cache-A`, `${packaged}/vite-cache-B`), false);
  assert.equal(isPinnedPrivateCacheResolution?.(`${logical}/vite-cache-A`, 'C:/unrelated-cache'), false);
});

const now = Date.parse('2026-11-01T10:00:00Z');
const manifestBytes = await fs.readFile(path.join(REPORT_DIR, 'fixture-manifest.prepared.json'));
const sqlBytes = await fs.readFile(path.join(REPORT_DIR, '22-proposed-auth-boundary-apply.sql'));
const email = (alias) => 'kocmax-' + RUN + '-' + alias.toLowerCase() + '@example.invalid';
const keys = {
  serviceKey: 'sb_secret_' + 's'.repeat(40),
  publicKey: 'sb_publishable_' + 'p'.repeat(40),
  controlToken: 't'.repeat(64),
};
function evidence() {
  return { manifestBytes, sqlBytes,
    receipt: { status: 'APPLIED_AND_READ_ONLY_POSTCONDITIONS_PASSED', projectRef: PROJECT, sqlSha256: SQL_SHA256 },
    gate: { status: 'PASSED', projectRef: PROJECT, runId: RUN, sqlSha256: SQL_SHA256,
      preparedManifestSha256: MANIFEST_SHA256, observedAt: new Date(now).toISOString(),
      transactionReadOnly: true, rowSecurityOff: true, sqlApplied: true, backupRestoreVerified: true,
      originalDataUnchanged: true, authUserTriggers: 0, reservedEmailCollisions: [] },
  };
}

test('approval/hash/readonly gates run before the client factory', async () => {
  let factories = 0;
  const factory = async () => { factories++; return {}; };
  const bad = [
    (b) => { b.receipt.status = 'REVIEW_ONLY_NOT_APPLIED'; },
    (b) => { b.receipt.sqlSha256 = 'f'.repeat(64); },
    (b) => { b.gate.projectRef = 'wrong-project'; },
    (b) => { b.gate.runId = randomUUID(); },
    (b) => { b.gate.transactionReadOnly = false; },
    (b) => { b.gate.rowSecurityOff = false; },
    (b) => { b.gate.authUserTriggers = 1; },
    (b) => { b.gate.backupRestoreVerified = false; },
    (b) => { b.gate.observedAt = new Date(now - 16 * 60000).toISOString(); },
    (b) => { b.manifestBytes = Buffer.concat([manifestBytes, Buffer.from(' ')]); },
    (b) => { b.sqlBytes = Buffer.concat([sqlBytes, Buffer.from(' ')]); },
  ];
  for (const change of bad) {
    const bundle = evidence(); change(bundle);
    await assert.rejects(createGuardedAuth(bundle, keys, factory, now), PilotError);
  }
  assert.equal(factories, 0);
  await createGuardedAuth(evidence(), keys, factory, now);
  assert.equal(factories, 1);
});

test('stale preflight retains in-memory inputs until fresh evidence; no client starts while waiting', async () => {
  let elapsed = 0, reads = 0, factories = 0;
  const statuses = [], sleeps = [];
  const result = await waitForFreshReadonlyEvidence({
    now: () => now + elapsed, monotonicNow: () => elapsed,
    readEvidence: async () => {
      assert.equal(factories, 0);
      const bundle = evidence();
      bundle.gate.observedAt = new Date(++reads < 3 ? now - 16 * 60000 : now + elapsed).toISOString();
      return bundle;
    },
    sleep: async (ms) => { assert.equal(factories, 0); sleeps.push(ms); elapsed += ms; },
    writeStatus: async (status) => { statuses.push(status); },
  });
  assert.equal(reads, 3);
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.deepEqual(statuses, ['WAITING_PARENT_PREFLIGHT', 'STARTING']);
  for (const secret of Object.values(keys)) assert.equal(JSON.stringify(statuses).includes(secret), false);
  await createGuardedAuth(result.bundle, keys, async (serviceKey, publicKey) => {
    assert.equal(serviceKey, keys.serviceKey); assert.equal(publicKey, keys.publicKey); factories++;
    return {};
  }, now + elapsed);
  assert.equal(factories, 1);
});

test('invalid target/hash/readonly evidence fails immediately even when its timestamp is stale', async () => {
  for (const change of [
    (b) => { b.gate.projectRef = 'wrong-project'; },
    (b) => { b.gate.transactionReadOnly = false; },
    (b) => { b.receipt.sqlSha256 = 'f'.repeat(64); },
    (b) => { b.sqlBytes = Buffer.concat([sqlBytes, Buffer.from(' ')]); },
    (b) => { b.manifestBytes = Buffer.concat([manifestBytes, Buffer.from(' ')]); },
  ]) {
    let reads = 0, sleeps = 0, factories = 0;
    const statuses = [];
    const bundle = evidence(); change(bundle);
    bundle.gate.observedAt = new Date(now - 16 * 60000).toISOString();
    await assert.rejects(async () => {
      const result = await waitForFreshReadonlyEvidence({
        now: () => now, monotonicNow: () => 0,
        readEvidence: async () => { reads++; return bundle; },
        sleep: async () => { sleeps++; }, writeStatus: async (status) => { statuses.push(status); },
      });
      await createGuardedAuth(result.bundle, keys, async () => { factories++; return {}; }, now);
    }, (error) => error instanceof PilotError && error.code !== 'READONLY_GATE_STALE');
    assert.equal(reads, 1); assert.equal(sleeps, 0); assert.equal(factories, 0);
    assert.deepEqual(statuses, ['FAILED']);
  }
});

test('waiting preflight aborts on invalid replacement or malformed JSON instead of retrying it', async () => {
  for (const malformed of [false, true]) {
    let elapsed = 0, reads = 0;
    const statuses = [];
    await assert.rejects(waitForFreshReadonlyEvidence({
      now: () => now + elapsed, monotonicNow: () => elapsed,
      readEvidence: async () => {
        const bundle = evidence();
        if (++reads === 1) bundle.gate.observedAt = new Date(now - 16 * 60000).toISOString();
        else if (malformed) throw new SyntaxError('synthetic invalid JSON');
        else bundle.gate.projectRef = 'wrong-project';
        return bundle;
      },
      sleep: async (ms) => { elapsed += ms; }, writeStatus: async (status) => { statuses.push(status); },
    }), malformed ? SyntaxError : { code: 'READONLY_GATE_REQUIRED' });
    assert.equal(reads, 2); assert.equal(elapsed, 1000);
    assert.deepEqual(statuses, ['WAITING_PARENT_PREFLIGHT', 'FAILED']);
  }
});

test('stale preflight wait stops after 60 minutes without another read or client', async () => {
  let elapsed = 0, reads = 0, sleeps = 0;
  const statuses = [];
  await assert.rejects(waitForFreshReadonlyEvidence({
    now: () => now + elapsed, monotonicNow: () => elapsed,
    readEvidence: async () => {
      reads++; const bundle = evidence();
      bundle.gate.observedAt = new Date(now - 16 * 60000).toISOString(); return bundle;
    },
    sleep: async (ms) => { assert.equal(ms, 1000); sleeps++; elapsed = 60 * 60_000; },
    writeStatus: async (status) => { statuses.push(status); },
  }), { code: 'READONLY_GATE_WAIT_TIMEOUT' });
  assert.equal(reads, 1); assert.equal(sleeps, 1);
  assert.deepEqual(statuses, ['WAITING_PARENT_PREFLIGHT', 'FAILED']);
});

test('keys cannot cross roles/projects or enter public configuration', () => {
  const jwt = (role, ref) => 'e30.' + Buffer.from(JSON.stringify({ role, ref })).toString('base64url') + '.signature';
  assert.throws(() => validateKeys(jwt('anon', PROJECT), keys.publicKey, keys.controlToken), PilotError);
  assert.throws(() => validateKeys(keys.serviceKey, jwt('service_role', PROJECT), keys.controlToken), PilotError);
  assert.throws(() => validateKeys(jwt('service_role', 'another'), keys.publicKey, keys.controlToken), PilotError);
  assert.throws(() => validateKeys(keys.serviceKey, keys.publicKey, 'short'), PilotError);
  validateKeys(jwt('service_role', PROJECT), jwt('anon', PROJECT), keys.controlToken);
});

test('one bounded stdin JSON record; rejects extra commands and fields', async () => {
  async function* input(value) { yield Buffer.from(value); }
  const first = { serviceKey: keys.serviceKey, controlToken: keys.controlToken };
  assert.deepEqual(await readStartupInput(input(JSON.stringify(first) + '\n')), first);
  await assert.rejects(readStartupInput(input(JSON.stringify(first) + '\n{}\n')));
  await assert.rejects(readStartupInput(input(JSON.stringify({ ...first, dumpSecrets: true }))));
  await assert.rejects(readStartupInput(input('x'.repeat(32769))));
});

test('control authorization rejects wrong token, origin, host and non-loopback peers', () => {
  const request = () => ({ method: 'POST', url: '/control', socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:8786', 'content-type': 'application/json',
      authorization: 'Bearer ' + keys.controlToken } });
  assert.equal(authorizeControl(request(), keys.controlToken), true);
  for (const alter of [
    (r) => { r.headers.authorization = 'Bearer wrong'; },
    (r) => { r.headers.origin = 'http://127.0.0.1:8784'; },
    (r) => { r.headers.host = 'attacker.test:8786'; },
    (r) => { r.socket.remoteAddress = '192.0.2.5'; },
    (r) => { r.method = 'GET'; }, (r) => { r.url = '/control?token=secret'; },
  ]) { const r = request(); alter(r); assert.equal(authorizeControl(r, keys.controlToken), false); }
});

function harness() {
  const users = new Map(), calls = [], saves = [];
  const state = { runId: RUN, projectRef: PROJECT, phase: 'READY', ownershipNonce: 'nonce',
    startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(),
    accounts: ALIASES.map((alias) => ({ alias, authId: null, created: false, attempted: false })), apps: [] };
  const credentials = { accounts: ALIASES.map((alias) => ({
    alias, email: email(alias), password: randomUUID() + '-Aa1!' + randomUUID(), authId: null,
  })) };
  const auth = {
    create: async (attributes) => {
      calls.push(['create', attributes]);
      const user = { ...structuredClone(attributes), banned_until: null };
      delete user.password; users.set(user.id, user); return structuredClone(user);
    },
    get: async (id) => { calls.push(['get', id]); return structuredClone(users.get(id) || null); },
    login: async (address, password) => {
      calls.push(['login', address]);
      const secret = credentials.accounts.find((a) => a.email === address && a.password === password);
      assert.ok(secret);
      const user = users.get(secret.authId);
      return { user: structuredClone(user), session: { access_token: user.id } };
    },
    verify: async (jwt) => { calls.push(['verify', jwt]); return structuredClone(users.get(jwt)); },
    revoke: async (jwt) => { calls.push(['revoke', jwt]); },
    ban: async (id) => {
      calls.push(['ban', id]); const user = users.get(id);
      user.banned_until = '2099-01-01T00:00:00Z'; return structuredClone(user);
    },
  };
  let seedReceipt = null, removed = false;
  const apps = { start: async (ids) => {
    calls.push(['apps', ids]); return [{ alias: 'A', origin: 'http://127.0.0.1:8784', status: 'STARTED' }];
  }, stop: async () => { calls.push(['stop']); },
  enableCleanup: async (ids) => { calls.push(['enable-cleanup', ids]); } };
  const pilot = new Pilot({ state, credentials, auth, apps, now: () => now,
    save: async () => { saves.push(structuredClone(sanitizedState(state))); },
    seed: async () => seedReceipt, removeCredentials: async () => { removed = true; },
    roleRevocation: async () => ({ status: 'ROLES_REVOKED', projectRef: PROJECT, runId: RUN,
      accounts: state.accounts.map(({ alias, authId }) => ({
        alias, authId, workspaceAlias: alias === 'C-B' ? 'B' : 'A',
      })) }),
    deleteProduct: async (account, jwt, workspaceAlias) => {
      assert.equal(jwt, account.authId);
      assert.equal(workspaceAlias, account.alias === 'C-B' ? 'B' : 'A');
      calls.push(['product-delete', account.authId]);
      const user = users.get(account.authId);
      user.email = 'deleted-' + account.authId + '@deleted.invalid';
      user.banned_until = '2099-01-01T00:00:00Z';
    } });
  const seed = () => {
    seedReceipt = { status: 'ROOT_SEEDED', projectRef: PROJECT, runId: RUN, sqlSha256: SQL_SHA256,
      accounts: state.accounts.map(({ alias, authId }) => ({ alias, authId })), workspaces: WORKSPACES,
      staffRoles: ['workspace_admin','operator','reviewer','finance_viewer'].map((role, i) => ({
        alias: ['S-A','S-O','S-R','S-F'][i], workspaceAlias: 'A', role,
      })), brandMembershipAliases: ['S-A','S-O','S-R','S-F','B-A'], uXAuthOnly: true };
  };
  return { pilot, state, credentials, auth, users, calls, saves, seed, removed: () => removed };
}

test('nine exact confirmed users; pause before seeded app launch and login', async () => {
  const h = harness();
  await h.pilot.action('create-users');
  assert.equal(h.state.phase, 'USERS_CREATED_AWAITING_PARENT_SEED');
  assert.equal(h.users.size, 9);
  const created = h.calls.filter(([name]) => name === 'create').map(([, args]) => args);
  assert.deepEqual(created.map((a) => a.email), ALIASES.map(email));
  assert.ok(created.every((a) => a.email_confirm === true && a.role === 'authenticated'));
  assert.equal(new Set(created.map((a) => a.password)).size, 9);
  assert.equal(h.calls.filter(([name]) => name === 'login').length, 0);
  await assert.rejects(h.pilot.action('start-apps'), /PARENT_SEED_RECEIPT_REQUIRED/);
  await assert.rejects(h.pilot.action('login-all'), /LOGIN_PHASE_INVALID/);
  await assert.rejects(h.pilot.action('create-users'), /CREATE_ALREADY_ATTEMPTED/);
  h.seed(); await h.pilot.action('start-apps'); await h.pilot.action('login-all');
  assert.equal(h.calls.filter(([name]) => name === 'verify').length, 9);
  assert.equal(h.state.phase, 'LOGINS_VERIFIED');
});

test('public status/saves omit keys, passwords, emails, tokens and ownership nonce', async () => {
  const h = harness(); await h.pilot.action('create-users');
  const json = JSON.stringify([await h.pilot.action('status'), h.saves]);
  for (const a of h.credentials.accounts) { assert.ok(!json.includes(a.email)); assert.ok(!json.includes(a.password)); }
  assert.ok(!json.includes('ownershipNonce')); assert.ok(!json.includes('serviceKey'));
  assert.ok(!json.includes('access_token'));
});

test('factory receipt matches the exact nine-user contract and contains no credentials', async () => {
  const h = harness();
  assert.throws(() => usersCreatedReceipt(h.state), /NINE_OWNED_USERS_REQUIRED/);
  await h.pilot.action('create-users');
  const receipt = usersCreatedReceipt(h.state);
  assert.deepEqual(Object.keys(receipt), ['phase','projectRef','runId','users']);
  assert.equal(receipt.phase, 'users_created');
  assert.deepEqual(receipt.users.map((u) => u.alias), ALIASES);
  assert.ok(receipt.users.every((u) => u.authId && u.createdThisRun === true && u.email === email(u.alias)));
  assert.ok(receipt.users.every((u) => !('accountId' in u) && !('password' in u) && !('token' in u)));
});

test('collision/ambiguous create never upserts or retries; cleanup reconciles exact owned ID', async () => {
  const h = harness(), create = h.auth.create;
  h.auth.create = async (attributes) => {
    const result = await create(attributes);
    if (attributes.app_metadata.auth_pilot.alias === 'C-B') throw new Error('secret network detail');
    return result;
  };
  await assert.rejects(h.pilot.action('create-users'), /PILOT_OPERATION_FAILED/);
  assert.equal(h.users.size, 3); assert.equal(h.state.accounts[2].authId, null);
  await assert.rejects(h.pilot.action('create-users'), /CREATE_ALREADY_ATTEMPTED/);
  await h.pilot.action('cleanup');
  assert.equal(h.calls.filter(([name]) => name === 'ban').length, 3);
  assert.equal(h.state.phase, 'AUTH_DISABLED_CREDENTIALS_REMOVED');
  assert.equal(h.removed(), true);
});

test('cleanup rechecks ownership; foreign account cannot be banned or treated as owned', async () => {
  const h = harness(); await h.pilot.action('create-users');
  h.users.get(h.state.accounts[0].authId).app_metadata.auth_pilot.ownership_nonce = 'other-run';
  await assert.rejects(h.pilot.action('cleanup'), /CLEANUP_INCOMPLETE_CREDENTIALS_RETAINED/);
  assert.ok(!h.calls.some(([name, id]) => name === 'ban' && id === h.state.accounts[0].authId));
  assert.equal(h.removed(), false);
});

test('partial cleanup retries exact remaining IDs; successful cleanup never recreates credentials', async () => {
  const h = harness(); await h.pilot.action('create-users'); h.seed();
  await h.pilot.action('start-apps'); await h.pilot.action('login-all');
  const ban = h.auth.ban; let once = true;
  h.auth.ban = async (id) => { if (once) { once = false; throw new Error('sensitive error'); } return ban(id); };
  await assert.rejects(h.pilot.action('cleanup'), /CLEANUP_INCOMPLETE/);
  assert.equal(h.removed(), false);
  await h.pilot.action('cleanup');
  const writes = h.calls.filter(([name]) => name === 'ban').length;
  await h.pilot.action('cleanup');
  assert.equal(h.calls.filter(([name]) => name === 'ban').length, writes);
  assert.equal(h.pilot.credentials.accounts.length, 0);
  assert.equal(h.pilot.tokens.size, 0);
  assert.equal(h.state.phase, 'AUTH_DISABLED_CREDENTIALS_REMOVED');
  assert.equal(h.calls.filter(([name]) => name === 'product-delete').length, 9);
  for (const account of h.state.accounts) {
    const deletion = h.calls.findIndex(([name, id]) => name === 'product-delete' && id === account.authId);
    const revoke = h.calls.findIndex(([name, id]) => name === 'revoke' && id === account.authId);
    assert.ok(deletion >= 0 && revoke > deletion);
    assert.equal(account.productDeleted, true);
  }
});

test('product cleanup requires parent role revocation before touching any account', async () => {
  const h = harness(); await h.pilot.action('create-users'); h.seed(); await h.pilot.action('start-apps');
  h.pilot.roleRevocation = async () => ({ status: 'NOT_REVOKED' });
  await assert.rejects(h.pilot.action('cleanup'), /PARENT_ROLE_REVOCATION_RECEIPT_REQUIRED/);
  assert.ok(!h.calls.some(([name]) => ['product-delete','ban','revoke'].includes(name)));
  assert.equal(h.removed(), false);
});

test('expiry blocks new work but leaves owned cleanup available', async () => {
  const h = harness(); await h.pilot.action('create-users');
  h.state.expiresAt = new Date(now - 1).toISOString();
  await assert.rejects(h.pilot.action('start-apps'), /RUN_EXPIRED/);
  await h.pilot.action('cleanup');
  assert.equal(h.removed(), true);
});

test('child configuration strips inherited secrets/proxy/preloads and uses real isolated workspace', () => {
  const env = cleanEnvironment({ PATH: 'path', SUPABASE_SERVICE_KEY: 'secret', NODE_OPTIONS: '--require bad',
    HTTP_PROXY: 'proxy', VITE_STUDIO_FIXTURE: 'true', AI_GATEWAY_API_KEY: 'bad' });
  assert.deepEqual(env, { PATH: 'path' });
  const child = appEnvironment({ supabaseUrl: SUPABASE_URL, publicKey: keys.publicKey,
    serviceKey: keys.serviceKey, workspace: WORKSPACES[1] });
  assert.equal(child.VITE_STUDIO_FIXTURE, 'false');
  assert.equal(child.STUDIO_THREADS, 'true');
  assert.equal(child.VITE_STUDIO_THREADS, 'true');
  assert.equal(child.VITE_STUDIO_SHELL, 'true');
  assert.equal(child.VITE_DEFAULT_WORKSPACE, WORKSPACES[1].slug);
  assert.equal(child.BOOTSTRAP_WORKSPACE_SLUGS, WORKSPACES[1].slug);
  assert.equal(child.INTEGRATIONS_ENABLED, 'false');
  assert.equal(child.SUPABASE_SERVICE_KEY, undefined);
  assert.ok(!JSON.stringify(child).includes(keys.serviceKey));
});

test('app egress permits real password/Auth reads and bootstrap; denies email/provider/reward paths', () => {
  for (const suffix of ['/auth/v1/otp','/auth/v1/signup','/auth/v1/recover',
    '/auth/v1/invite','/rest/v1/rpc/award_welcome_bonus','/rest/v1/rpc/join_mission',
    '/rest/v1/point_transactions','/functions/v1/provider']) {
    assert.equal(allowedAppFetch(SUPABASE_URL + suffix, 'POST', SUPABASE_URL), false);
  }
  assert.equal(allowedAppFetch('https://example.invalid/', 'GET', SUPABASE_URL), false);
  assert.equal(allowedAppFetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', 'POST', SUPABASE_URL), true);
  assert.equal(allowedAppFetch(SUPABASE_URL + '/auth/v1/user', 'GET', SUPABASE_URL), true);
  assert.equal(allowedAppFetch(SUPABASE_URL + '/rest/v1/rpc/bootstrap_creator_account', 'POST', SUPABASE_URL), true);
});

test('Studio manual commands use the exact POST RPC; assistant and award RPCs stay blocked', () => {
  const rpc = SUPABASE_URL + '/rest/v1/rpc/studio_command';
  assert.equal(allowedAppFetch(rpc, 'POST', SUPABASE_URL), true);
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(allowedAppFetch(rpc, method, SUPABASE_URL), false);
  }
  for (const name of ['studio_command_extra', 'studio_command/other', 'save_assistant_turn', 'award_welcome_bonus']) {
    assert.equal(allowedAppFetch(SUPABASE_URL + '/rest/v1/rpc/' + name, 'POST', SUPABASE_URL), false);
  }
  assert.equal(allowedAppFetch('https://example.invalid/rest/v1/rpc/studio_command', 'POST', SUPABASE_URL), false);
});

test('product-only egress allows exact anonymization and derived email ban, never another user/delete', () => {
  const id = randomUUID(), other = randomUUID();
  const rpc = SUPABASE_URL + '/rest/v1/rpc/anonymize_creator_account';
  assert.equal(allowedProductCleanup(rpc, 'POST', JSON.stringify({ p_creator: id }), id, SUPABASE_URL), true);
  assert.equal(allowedProductCleanup(rpc, 'POST', JSON.stringify({ p_creator: other }), id, SUPABASE_URL), false);
  assert.equal(allowedProductCleanup(rpc, 'POST', JSON.stringify({ p_creator: id }), null, SUPABASE_URL), false);
  const endpoint = SUPABASE_URL + '/auth/v1/admin/users/' + id;
  const body = { email: 'deleted-' + id + '@deleted.invalid', email_confirm: true,
    user_metadata: {}, ban_duration: '876000h' };
  assert.equal(allowedProductCleanup(endpoint, 'PUT', JSON.stringify(body), id, SUPABASE_URL), true);
  assert.equal(allowedProductCleanup(endpoint, 'DELETE', undefined, id, SUPABASE_URL), false);
  assert.equal(allowedProductCleanup(endpoint, 'PUT', JSON.stringify({ ...body, role: 'service_role' }), id, SUPABASE_URL), false);
});
