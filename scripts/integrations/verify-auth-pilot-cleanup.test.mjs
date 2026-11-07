// Pure synthetic tests. No file/private-directory reads, SDK, network, listener or child process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_SHA256, SCOPE_SHA256, SOURCE_HASHES, parseArguments, validatePublicEvidence,
  validatePrivateInputs, makeReady, validateBarrier, awaitBarrier,
  classifyRefresh, classifyOldAccess, canRevokeRefreshedSession, runVerification,
} from './verify-auth-pilot-cleanup.mjs';
import { RUN_ID, PROJECT_REF, REQUIRED_SQL_SHA256, MANIFEST_SHA256 } from './auth-pilot-fixtures.mjs';

const NOW = Date.parse('2026-11-02T00:00:00Z');
const TARGET = 'https://' + PROJECT_REF + '.supabase.co';
const aliases = ['C-A', 'C-P', 'C-B', 'S-A', 'S-O', 'S-R', 'S-F', 'B-A', 'U-X'];
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const jwt = value => 'e30.' + Buffer.from(JSON.stringify(value)).toString('base64url') + '.synthetic';
const nonce = 'n'.repeat(43);
const key = 'sb_publishable_' + 'p'.repeat(40);
const clone = value => structuredClone(value);
const scope = {
  runId: RUN_ID, projectRef: PROJECT_REF, requiredSqlSha256: REQUIRED_SQL_SHA256, manifestSha256: MANIFEST_SHA256,
  workspaces: ['A', 'B'].map((alias, i) => ({ alias, id: id(100 + i), slug: 'synthetic-' + alias })),
  accounts: aliases.map((alias, i) => ({ alias, authId: id(i + 1),
    email: 'kocmax-' + RUN_ID + '-' + alias.toLowerCase() + '@example.invalid' })),
};
const studioSteps = ['C-A', 'C-P', 'C-B'].flatMap(alias =>
  ['thread', 'source-1', ...(alias === 'C-A' ? ['source-2'] : []), 'brief']
    .map(kind => ({ alias, kind, key: alias + ':' + kind })))
  .map((step, i) => ({ ...step, requestId: id(300 + i) }));
function publicInput() {
  const studio = studioSteps.map((step, i) => ({ step: step.key, actor: step.alias,
    requestId: step.requestId, id: id(200 + i), validation: 'PASS' }));
  for (const row of studio) if (!row.step.endsWith(':thread'))
    row.threadId = studio.find(r => r.step === row.actor + ':thread').id;
  return {
    sourceHashes: clone(SOURCE_HASHES), apiHash: API_SHA256, scopeHash: SCOPE_SHA256, scope: clone(scope),
    publicConfig: { projectRef: PROJECT_REF, supabaseUrl: TARGET, publishableKey: key, keyType: 'publishable' },
    apiReport: { status: 'API_RLS_CASES_PASSED_CLEANUP_PENDING', projectRef: PROJECT_REF, runId: RUN_ID,
      caseRunId: id(500), sqlSha256: REQUIRED_SQL_SHA256, manifestSha256: MANIFEST_SHA256,
      startedAt: new Date(NOW - 120000).toISOString(), finishedAt: new Date(NOW - 60000).toISOString(),
      accounts: scope.accounts.map(({ alias, authId }) => ({ alias, authId })), workspaces: clone(scope.workspaces),
      sourceHashes: Object.fromEntries(Object.entries(SOURCE_HASHES).slice(0, 3)), studio,
      cases: [
        { name: 'stale_reviewer:scoped_read', actor: 'S-R', httpStatus: 403, status: 'PASS' },
        { name: 'stale_reviewer:admin_write', actor: 'S-R', httpStatus: 403, status: 'PASS' },
        ...Array.from({ length: 263 }, (_, i) => ({ name: 'synthetic-' + i, status: 'PASS' })),
      ],
    },
  };
}
const fixtureValidator = () => ({ scope: clone(scope), studioSteps });
const context = () => validatePublicEvidence(publicInput(), NOW, fixtureValidator);
function privateInputs() {
  return {
    state: { projectRef: PROJECT_REF, runId: RUN_ID, manifestSha256: MANIFEST_SHA256,
      phase: 'LOGINS_VERIFIED', appsEverStarted: true, ownershipNonce: nonce,
      startedAt: new Date(NOW - 3600000).toISOString(), expiresAt: new Date(NOW + 23 * 3600000).toISOString(),
      accounts: scope.accounts.map(a => ({ alias: a.alias, authId: a.authId, created: true, attempted: true })) },
    credentials: { accounts: scope.accounts.map((a, i) => ({ ...a, password: 'private-password-' + i + '-'.repeat(40) })) },
  };
}
function liveSession(account, now = NOW) {
  return {
    session: { access_token: jwt({ sub: account.authId, role: 'authenticated', iss: TARGET + '/auth/v1',
      exp: (now + 3600000) / 1000, session_id: id(600 + aliases.indexOf(account.alias)) }),
      refresh_token: 'held_refresh_' + account.alias.replace('-', '_') },
    user: { id: account.authId, role: 'authenticated', email: account.email,
      email_confirmed_at: new Date(NOW - 60000).toISOString(),
      app_metadata: { auth_pilot: { run_id: RUN_ID, alias: account.alias, ownership_nonce: nonce } } },
  };
}
function readyFixture() {
  const sessions = new Map(aliases.map(alias => [alias, { expiresAt: NOW + 3600000 }]));
  return makeReady(context(), sessions, id(700), NOW, NOW + 23 * 3600000);
}
const completed = ready => ({ ...clone(ready.expectedReceipt), completedAt: new Date(NOW + 1000).toISOString() });

function harness(overrides = {}) {
  const { state, credentials } = privateInputs(), reports = [], readyFiles = [], calls = [];
  let clock = NOW, factories = 0, disposed = false;
  const adapter = {
    login: async secret => { calls.push(['login', secret.alias]); return liveSession(secret, clock); },
    refresh: async token => { calls.push(['refresh', token]); return { status: 400, data: { code: 'refresh_token_not_found' } }; },
    authUser: async token => {
      const claim = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      calls.push(['oldUser', claim.sub]); return { status: 200, data: { id: claim.sub, ignored: 'secret-response-body' } };
    },
    studio: async (_token, account, table, rows) => {
      calls.push(['studio', account.alias, table]);
      return { status: 200, data: rows.map(row => ({ id: row.id, creator_id: account.authId, workspace_id: account.workspaceId })) };
    },
    logoutLocal: async token => { calls.push(['logoutLocal', token]); return { status: 204, data: null }; },
    dispose: async () => { disposed = true; },
    ...overrides,
  };
  const options = {
    context: context(), credentials, state, verificationId: id(700),
    now: () => clock, monotonicNow: () => clock - NOW,
    sleep: async ms => { clock += ms; },
    createAdapter: async () => { factories++; return adapter; },
    readBarrier: async () => {
      assert.equal(calls.filter(c => c[0] === 'login').length, 9);
      assert.equal(calls.filter(c => c[0] === 'refresh').length, 0);
      clock += 1000; return completed(readyFiles[0]);
    },
    writeReady: async ready => { readyFiles.push(clone(ready)); },
    writeReport: async report => { reports.push(clone(report)); },
  };
  return { options, state, credentials, reports, readyFiles, calls,
    factories: () => factories, disposed: () => disposed };
}

test('import stays inert; CLI requires the exact explicit flag and key-file argument', () => {
  assert.equal(parseArguments(['--execute-approved-cleanup-verification', '--public-key-file', 'public.json']), 'public.json');
  for (const args of [[], ['--execute'], ['--public-key-file', 'public.json'],
    ['--execute-approved-cleanup-verification', '--public-key-file', 'x', '--service-key', 'never']])
    assert.throws(() => parseArguments(args));
});

test('public source/report/key/identity gates reject drift before any adapter', () => {
  for (const change of [
    b => { b.sourceHashes['server/routes/account.ts'] = '0'.repeat(64); },
    b => { b.apiHash = '0'.repeat(64); }, b => { b.scopeHash = '0'.repeat(64); },
    b => { b.publicConfig.publishableKey = 'sb_secret_' + 'x'.repeat(40); },
    b => { b.publicConfig.keyType = 'service_role'; }, b => { b.publicConfig.projectRef = 'other'; },
    b => { b.publicConfig.extraSecret = 'never'; },
    b => { b.scope.accounts[0].authId = id(999); }, b => { b.scope.workspaces[0].id = id(999); },
    b => { b.apiReport.cases.pop(); }, b => { b.apiReport.cases[2].status = 'FAIL'; },
    b => { b.apiReport.cases[0].httpStatus = 200; }, b => { b.apiReport.accounts[0].authId = id(999); },
    b => { b.apiReport.studio[1].threadId = id(999); },
  ]) {
    const input = publicInput(); change(input);
    assert.throws(() => validatePublicEvidence(input, NOW, fixtureValidator));
  }
  assert.equal(context().scope.accounts.length, 9);
  const legacy = publicInput();
  legacy.publicConfig.publishableKey = jwt({ ref: PROJECT_REF, role: 'anon' });
  legacy.publicConfig.keyType = 'legacy_anon';
  assert.ok(validatePublicEvidence(legacy, NOW, fixtureValidator));
  legacy.publicConfig.publishableKey = jwt({ ref: PROJECT_REF, role: 'service_role' });
  assert.throws(() => validatePublicEvidence(legacy, NOW, fixtureValidator));
});

test('private ownership gate supports active UI phases and rejects prior cleanup or foreign IDs', () => {
  for (const phase of ['APPS_STARTED', 'LOGIN_PARTIAL', 'LOGINS_VERIFIED']) {
    const value = privateInputs(); value.state.phase = phase;
    validatePrivateInputs(value.credentials, value.state, scope, NOW);
  }
  for (const change of [
    v => { v.state.ownershipNonce = 'bad'; }, v => { v.state.accounts[0].authId = id(999); },
    v => { v.state.accounts[0].productDeleted = true; }, v => { v.state.phase = 'CLEANUP_IN_PROGRESS'; },
    v => { v.credentials.accounts[1].password = v.credentials.accounts[0].password; },
    v => { v.credentials.accounts[0].email = 'not-owned@example.invalid'; },
  ]) { const value = privateInputs(); change(value); assert.throws(() =>
    validatePrivateInputs(value.credentials, value.state, scope, NOW)); }
});

test('ready deadline is capped by 30 minutes, earliest session expiry and run expiry', () => {
  const sessions = new Map(aliases.map(alias => [alias, { expiresAt: NOW + 3600000 }]));
  assert.equal(Date.parse(readyFixture().deadline), NOW + 1800000);
  sessions.get('C-P').expiresAt = NOW + 900000;
  assert.equal(Date.parse(makeReady(context(), sessions, id(700), NOW, NOW + 86400000).deadline), NOW + 300000);
  assert.equal(Date.parse(makeReady(context(), sessions, id(700), NOW, NOW + 720000).deadline), NOW + 120000);
  sessions.get('C-A').expiresAt = NOW + 600000;
  assert.throws(() => makeReady(context(), sessions, id(700), NOW, NOW + 86400000));
});

test('barrier binds verification ID, complete account/workspace assertions, hashes and time', () => {
  const ready = readyFixture();
  validateBarrier(completed(ready), ready, NOW + 1000);
  for (const change of [
    r => { r.verificationId = id(701); }, r => { r.accounts.pop(); },
    r => { r.accounts[0].authId = id(999); }, r => { r.accounts[0].workspaceAlias = 'B'; },
    r => { r.accounts[0].sessionsRevoked = false; }, r => { r.credentialsRemoved = false; },
    r => { r.apiCasesSha256 = '0'.repeat(64); }, r => { r.completedAt = new Date(NOW - 1).toISOString(); },
    r => { r.completedAt = new Date(NOW + 60000).toISOString(); }, r => { r.extra = 'not-allowed'; },
  ]) { const receipt = completed(ready); change(receipt); assert.throws(() => validateBarrier(receipt, ready, NOW + 1000)); }
});

test('barrier polling is bounded by a monotonic deadline even if wall time moves backward', async () => {
  let elapsed = 0, reads = 0;
  await assert.rejects(awaitBarrier(readyFixture(), {
    now: () => NOW - elapsed, monotonicNow: () => elapsed,
    readBarrier: async () => { reads++; return null; },
    sleep: async ms => { assert.equal(ms, 1000); elapsed = 1800000; },
  }), /CLEANUP_BARRIER_TIMEOUT/);
  assert.equal(reads, 1);
});

test('only explicit Auth rejection at 400/401/403 passes; network and generic errors do not', () => {
  for (const status of [400, 401, 403]) assert.equal(classifyRefresh({ status,
    data: { error_code: 'refresh_token_not_found', message: 'never publish' } }).status, 'REJECTED_EXPLICIT_AUTH_ERROR');
  assert.equal(classifyRefresh({ status: 400, data: { error: 'invalid_grant',
    error_description: 'Invalid Refresh Token: Refresh Token Not Found' } }).status, 'REJECTED_EXPLICIT_AUTH_ERROR');
  for (const response of [{ transportError: true }, { status: 503, data: { code: 'user_banned' } },
    { status: 401, data: { code: 'invalid_api_key' } }, { status: 403, data: null },
    { status: 429, data: { code: 'over_request_rate_limit' } }, { status: 400, data: { error: 'invalid_grant' } }])
    assert.ok(classifyRefresh(response).status.startsWith('INCONCLUSIVE'));
  assert.equal(classifyRefresh({ status: 200, data: {} }).status, 'FAIL_REFRESH_ACCEPTED');
});

test('unexpected refresh can revoke only the same user/session/ownership marker', () => {
  const account = scope.accounts[0], signed = liveSession(account), original = { sessionId: id(600) };
  const value = { access_token: signed.session.access_token, user: signed.user };
  assert.equal(canRevokeRefreshedSession(value, original, account, nonce), true);
  for (const altered of [{ ...original, sessionId: id(999) }, { sessionId: null }])
    assert.equal(canRevokeRefreshedSession(value, altered, account, nonce), false);
  assert.equal(canRevokeRefreshedSession(value, original, scope.accounts[1], nonce), false);
  assert.equal(canRevokeRefreshedSession(value, original, account, 'wrong'), false);
});

test('old-token observations distinguish own visibility, empty results, rejection and wrong scope', () => {
  const account = { ...scope.accounts[0], workspaceId: scope.workspaces[0].id }, rows = [{ id: id(200) }];
  assert.equal(classifyOldAccess({ status: 200, data: { id: account.authId } }, account).status, 'OWN_AUTH_USER_VISIBLE');
  assert.equal(classifyOldAccess({ status: 403 }, account).status, 'HTTP_REJECTED');
  assert.equal(classifyOldAccess({ status: 200, data: [] }, account, rows).status, 'NO_VISIBLE_RECORDED_OWN_ROWS');
  const own = { id: id(200), creator_id: account.authId, workspace_id: account.workspaceId };
  assert.equal(classifyOldAccess({ status: 200, data: [own] }, account, rows).status, 'RECORDED_OWN_ROWS_VISIBLE');
  assert.equal(classifyOldAccess({ status: 200, data: [{ ...own, creator_id: id(999) }] }, account, rows).status, 'FAIL_UNEXPECTED_SCOPE');
});

test('all nine sessions are held before readiness; rejection passes while own old access is reported honestly', async () => {
  const h = harness(), secrets = h.credentials.accounts.map(a => a.password);
  const report = await runVerification(h.options);
  assert.equal(report.status, 'NINE_REFRESH_REJECTIONS_VERIFIED_OLD_ACCESS_REPORTED');
  assert.equal(h.factories(), 1); assert.equal(h.disposed(), true); assert.equal(h.readyFiles.length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'login').length, 9);
  assert.equal(h.calls.filter(c => c[0] === 'refresh').length, 9);
  assert.equal(h.calls.filter(c => c[0] === 'oldUser').length, 9);
  assert.equal(h.calls.filter(c => c[0] === 'studio').length, 9);
  assert.equal(h.calls.filter(c => c[0] === 'logoutLocal').length, 0);
  assert.ok(report.accounts.every(a => a.oldAccess.authUser.status === 'OWN_AUTH_USER_VISIBLE'));
  const serialized = JSON.stringify([h.reports, h.readyFiles]);
  for (const secret of [...secrets, nonce, key, 'held_refresh_', 'secret-response-body', '.synthetic'])
    assert.equal(serialized.includes(secret), false);
  assert.ok(h.credentials.accounts.every(a => a.password === ''));
  assert.equal(h.state.ownershipNonce, '');
});

test('invalid local ownership starts no adapter; bad barrier starts no refresh or logout', async () => {
  const invalid = harness(); invalid.state.accounts[0].authId = id(999);
  assert.equal((await runVerification(invalid.options)).status, 'STOPPED_NOT_VERIFIED');
  assert.equal(invalid.factories(), 0);
  const barrier = harness();
  barrier.options.readBarrier = async () => ({ ...completed(barrier.readyFiles[0]), credentialsRemoved: false });
  assert.equal((await runVerification(barrier.options)).status, 'STOPPED_NOT_VERIFIED');
  assert.equal(barrier.calls.filter(c => ['refresh', 'logoutLocal'].includes(c[0])).length, 0);
});

test('transport errors never pass and never trigger logout or retries', async () => {
  let attempts = 0;
  const h = harness({ refresh: async () => { attempts++; throw new Error('private diagnostic held_refresh_NEVER'); } });
  const report = await runVerification(h.options);
  assert.equal(report.status, 'REFRESH_VERIFICATION_INCONCLUSIVE');
  assert.equal(attempts, 9); assert.equal(h.calls.filter(c => c[0] === 'logoutLocal').length, 0);
  assert.equal(JSON.stringify(h.reports).includes('private diagnostic'), false);
});

test('unexpected refresh stays failed even after one local logout; foreign session is not touched', async () => {
  for (const foreign of [false, true]) {
    let refreshes = 0, logouts = 0;
    const h = harness({
      refresh: async () => {
        if (++refreshes !== 1) return { status: 400, data: { code: 'user_banned' } };
        const signed = liveSession(scope.accounts[foreign ? 1 : 0]);
        return { status: 200, data: { ...signed.session, user: signed.user } };
      },
      logoutLocal: async token => { logouts++; assert.ok(token.includes('.')); return { status: 204 }; },
    });
    const report = await runVerification(h.options);
    assert.equal(report.status, 'FAIL_REFRESH_ACCEPTED');
    assert.equal(refreshes, 9); assert.equal(logouts, foreign ? 0 : 1);
    assert.equal(JSON.stringify(h.reports).includes('held_refresh_'), false);
  }
});

test('mismatched live ownership stops before ready and scrubs returned session references', async () => {
  const signed = liveSession(scope.accounts[1]);
  const h = harness({ login: async () => signed });
  const report = await runVerification(h.options);
  assert.equal(report.status, 'STOPPED_NOT_VERIFIED'); assert.equal(h.readyFiles.length, 0);
  assert.equal(signed.session.access_token, ''); assert.equal(signed.session.refresh_token, '');
  assert.equal(signed.user, null);
});
