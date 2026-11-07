/**
 * Import is inert. Syntax/helper checks do not read credentials or use the network.
 * Parent execution (from this checkout, after seed + start-apps, BEFORE login-all/UI):
 * node scripts/integrations/run-auth-pilot-cases.mjs --execute-approved-cases \
 *   --public-key-file <exact-private-or-report-directory>/runtime-public-config.json
 * Never run concurrently with UI, cleanup, another runner, or worker login-all.
 * api-bootstrap-ready.json permits the parent's separate bounded profile setup;
 * it does not accept consent or finish onboarding. Later UI = existing-account login.
 * Only passwords from the private accounts file and the anon/publishable key are read.
 * worker-state.json supplies the exact ownership nonce, not a service key.
 * Reports contain allowlisted IDs/status only. No HTTP bodies, exports, JWTs or errors.
 * No automatic mutation retries/resume/remote cleanup. An interrupted POST needs parent review.
 *
 * Parent barrier receipt: reviewer-revoked.json in REPORT_DIR, with EXACT fields
 * copied from api-awaiting-reviewer-revocation.json.expectedReceipt, and status
 * REVIEWER_REVOKED. Write only after applying factory.roleRevokeSql() and verifying
 * revision 2 inactive. The original reviewer JWT is retained only in this process.
 * This is API/RLS evidence, not browser/native Google or whole-system acceptance.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createAuthPilotFixtures, RUN_ID, PROJECT_REF, REQUIRED_SQL_SHA256, MANIFEST_SHA256 } from './auth-pilot-fixtures.mjs';
import { assertPrivateDirectory, readJsonFile, writeJsonAtomic, verifyCheckout } from './auth-pilot-local.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const REPORT_DIR = path.join(ROOT, 'docs/review/kocmax-stage-4d/d1/auth-permission-execution');
const PRIVATE_DIR = `C:/Users/laich/AppData/Local/KOCmax/AuthPilot/${RUN_ID}`;
export const TARGET = `https://${PROJECT_REF}.supabase.co`;
export const APP_ORIGINS = Object.freeze({ A: 'http://127.0.0.1:8784', B: 'http://127.0.0.1:8785' });
export const ALIASES = Object.freeze(['C-A', 'C-P', 'C-B', 'S-A', 'S-O', 'S-R', 'S-F', 'B-A', 'U-X']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_HASHES = Object.freeze({
  'server/routes/me.ts': '9e3515ac7177371a6c14b8f6e483cc5371d03e496f14f4d9658ea3724c9296f8',
  'server/lib/brandAuth.ts': '1318514b0a6047d2cf46104e2357154226bf623a3b79f57d09721fcad3304970',
  'server/routes/brand.ts': '170d98a524ec4014b3b22a869ccdb142c23639c759aba656088615bf0884af86',
});
class CaseError extends Error {}
const check = (value, code) => { if (!value) throw new CaseError(code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const empty = value => Array.isArray(value) && value.length === 0;
const idsEqual = (rows, ids, key = 'id') => Array.isArray(rows) && rows.length === ids.length
  && equal(rows.map(row => row[key]).sort(), [...ids].sort());
const zero = value => (typeof value === 'number' || typeof value === 'string') && value !== '' && Number(value) === 0;
const jwtPayload = token => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { throw new CaseError('INVALID_SESSION'); } };

export function validatePublicConfig(config) {
  check(config?.projectRef === PROJECT_REF && config.supabaseUrl === TARGET, 'PUBLIC_TARGET_MISMATCH');
  const key = config.publishableKey;
  check(typeof key === 'string', 'PUBLIC_KEY_REQUIRED');
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) return key;
  check(key.split('.').length === 3, 'ANON_KEY_REQUIRED');
  const payload = jwtPayload(key);
  check(payload.role === 'anon' && payload.ref === PROJECT_REF, 'ANON_KEY_REQUIRED');
  return key;
}

/** Pure checks; the parent receipts are attestations, not an independent catalog query. */
export function validateEvidence({ manifestText, usersCreated, application, seed, sourceHashes, sqlHash }, observedAt) {
  check(application?.status === 'APPLIED_AND_READ_ONLY_POSTCONDITIONS_PASSED'
    && application.projectRef === PROJECT_REF && application.sqlSha256 === REQUIRED_SQL_SHA256
    && application.branch === 'codex/kocmax-studio-stages-1-2' && application.head === '5c60020091e8e6fee934b61c498bf7518944c433'
    && application.migration?.version === '20261101075946' && application.migration.success === true
    && application.exactApprovedSqlVerifiedInMigrationHistory === true && application.targetIdentityVerified === true
    && application.restoreVerified === true && application.applicationDataBeforeAndAfter?.unchanged === true
    && application.postconditions?.authenticatedCanUpdateCreatorXpWorkspaceOrStatus === false,
  'APPLIED_RESTORE_GATE_REQUIRED');
  check(sqlHash === REQUIRED_SQL_SHA256 && Object.entries(SOURCE_HASHES).every(([file, digest]) => sourceHashes?.[file] === digest), 'SOURCE_GATE_MISMATCH');
  const pilot = createAuthPilotFixtures({ manifestText, usersCreated, approvalRef: application.authorization, observedAt });
  check(seed?.status === 'ROOT_SEEDED' && seed.projectRef === PROJECT_REF && seed.runId === RUN_ID
    && seed.sqlSha256 === REQUIRED_SQL_SHA256 && seed.uXAuthOnly === true
    && equal(seed.accounts, pilot.scope.accounts.map(({ alias, authId }) => ({ alias, authId })))
    && equal(seed.workspaces, pilot.scope.workspaces)
    && equal(seed.brandMembershipAliases, ['S-A', 'S-O', 'S-R', 'S-F', 'B-A'])
    && equal(seed.staffRoles, ['workspace_admin', 'operator', 'reviewer', 'finance_viewer'].map((role, i) => ({ alias: ALIASES[i + 3], workspaceAlias: 'A', role }))),
  'EXACT_SEED_RECEIPT_REQUIRED');
  return pilot;
}

export function validatePrivateAccounts(credentials, state, scope, now = Date.now()) {
  check(state?.runId === RUN_ID && state.projectRef === PROJECT_REF && state.manifestSha256 === MANIFEST_SHA256
    && state.phase === 'APPS_STARTED' && /^[A-Za-z0-9_-]{43}$/.test(state.ownershipNonce)
    && Date.parse(state.startedAt) <= now && Date.parse(state.expiresAt) > now
    && Date.parse(state.expiresAt) - Date.parse(state.startedAt) === 86400000,
  'OWNED_ACTIVE_WORKER_REQUIRED');
  check(Array.isArray(state.apps) && state.apps.length === 2 && ['A', 'B'].every(alias =>
    state.apps.filter(app => app.alias === alias && app.origin === APP_ORIGINS[alias] && app.status === 'STARTED').length === 1), 'EXACT_LOCAL_APPS_REQUIRED');
  check(credentials?.accounts?.length === 9 && state.accounts?.length === 9, 'EXACT_PRIVATE_ACCOUNTS_REQUIRED');
  for (const [i, expected] of scope.accounts.entries()) {
    const account = credentials.accounts[i], owned = state.accounts[i];
    check(account?.alias === expected.alias && account.authId === expected.authId && account.email === expected.email
      && typeof account.password === 'string' && account.password.length >= 40
      && owned?.alias === expected.alias && owned.authId === expected.authId && owned.created === true,
    'PRIVATE_IDENTITY_MISMATCH');
  }
}

export function validateOwnedSession(session, user, account, nonce, now = Date.now()) {
  const claim = jwtPayload(session?.access_token ?? '');
  const marker = user?.app_metadata?.auth_pilot;
  check(user?.id === account.authId && user.email === account.email && user.email_confirmed_at
    && marker?.run_id === RUN_ID && marker.alias === account.alias && marker.ownership_nonce === nonce
    && claim.sub === account.authId && claim.role === 'authenticated' && claim.iss === `${TARGET}/auth/v1`
    && Number.isFinite(claim.exp) && claim.exp * 1000 > now + 300000, 'LIVE_OWNERSHIP_MISMATCH');
  return claim.exp * 1000;
}

export function expectedRevocation(scope, caseRunId) {
  check(UUID.test(caseRunId), 'INVALID_CASE_RUN_ID');
  return { status: 'REVIEWER_REVOKED', caseRunId, projectRef: PROJECT_REF, runId: RUN_ID,
    sqlSha256: REQUIRED_SQL_SHA256, alias: 'S-R', authId: scope.accounts.find(a => a.alias === 'S-R').authId,
    workspaceId: scope.workspaces.find(w => w.alias === 'A').id, role: 'reviewer', active: false,
    previousRevision: 1, revision: 2, requestId: scope.revokeRequestId };
}
export function validateRevocation(receipt, expected) {
  check(receipt && equal(Object.keys(receipt).sort(), Object.keys(expected).sort())
    && Object.entries(expected).every(([key, value]) => receipt[key] === value), 'EXACT_FRESH_REVOCATION_RECEIPT_REQUIRED');
}

/** Read only owned fixture rows. No broad REST table scans or arbitrary URL input. */
export function restPath(table, filters, select) {
  check(['creators', 'point_balances', 'earnings_balances', 'missions', 'studio_threads', 'studio_sources', 'studio_briefs'].includes(table), 'REST_TABLE_DENIED');
  const query = new URLSearchParams({ select, ...filters });
  check(Object.keys(filters).some(key => ['id', 'creator_id'].includes(key)), 'EXACT_ID_FILTER_REQUIRED');
  return `/rest/v1/${table}?${query}`;
}

async function checkedFile(file) {
  const info = await fs.lstat(file);
  check(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 1048576, 'SAFE_INPUT_FILE_REQUIRED');
  return fs.readFile(file);
}
async function assertReportDirectory() {
  check(path.resolve(await fs.realpath(REPORT_DIR)).toLowerCase() === path.resolve(REPORT_DIR).toLowerCase(), 'REPORT_PATH_MISMATCH');
  for (let dir = REPORT_DIR; ; dir = path.dirname(dir)) {
    check(!(await fs.lstat(dir)).isSymbolicLink(), 'REPORT_REPARSE_DENIED');
    if (path.dirname(dir) === dir) break;
  }
}
async function assertAbsent(file) {
  try { await fs.lstat(file); throw new CaseError('EXISTING_RUN_RECEIPT_STOP'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function executeApprovedCases(publicKeyFile) {
  // No private files or network are touched until the public/source gates pass.
  await verifyCheckout(ROOT);
  await assertReportDirectory();
  const observedAt = new Date().toISOString();
  const sourceHashes = Object.fromEntries(await Promise.all(Object.keys(SOURCE_HASHES).map(async file => [file, hash(await checkedFile(path.join(ROOT, file)))])));
  const pilot = validateEvidence({ sourceHashes, manifestText: (await checkedFile(path.join(REPORT_DIR, 'fixture-manifest.prepared.json'))).toString('utf8'),
    sqlHash: hash(await checkedFile(path.join(REPORT_DIR, '22-proposed-auth-boundary-apply.sql'))),
    usersCreated: await readJsonFile(path.join(REPORT_DIR, 'users-created.json')),
    application: await readJsonFile(path.join(REPORT_DIR, 'application-receipt.json')),
    seed: await readJsonFile(path.join(REPORT_DIR, 'fixture-seed-receipt.json')) }, observedAt);
  const resultFile = path.join(REPORT_DIR, 'api-cases-receipt.json');
  const barrierFile = path.join(REPORT_DIR, 'api-awaiting-reviewer-revocation.json');
  const revokedFile = path.join(REPORT_DIR, 'reviewer-revoked.json');
  const bootstrapFile = path.join(REPORT_DIR, 'api-bootstrap-ready.json');
  for (const file of [resultFile, barrierFile, revokedFile, bootstrapFile]) await assertAbsent(file);
  await assertPrivateDirectory(PRIVATE_DIR);
  const keyFile = path.resolve(publicKeyFile);
  check(path.basename(keyFile) === 'runtime-public-config.json' && [PRIVATE_DIR, REPORT_DIR].some(dir => path.resolve(dir).toLowerCase() === path.dirname(keyFile).toLowerCase()), 'EXACT_PUBLIC_CONFIG_PATH_REQUIRED');
  const publicKey = validatePublicConfig(await readJsonFile(keyFile));
  const state = await readJsonFile(path.join(PRIVATE_DIR, 'worker-state.json'));
  const credentials = await readJsonFile(path.join(PRIVATE_DIR, 'accounts.json'));
  validatePrivateAccounts(credentials, state, pilot.scope);
  const lockFile = path.join(PRIVATE_DIR, 'api-cases.lock');
  const lock = await fs.open(lockFile, 'wx', 0o600);
  const caseRunId = randomUUID();
  await lock.writeFile(caseRunId); await lock.close();
  const sessions = new Map(), clients = [], studioReceipts = [];
  // auth-js logs native fetch failures through console.error. Suppress SDK
  // diagnostics for this standalone run; only the allowlisted report is emitted.
  const diagnostics = Object.fromEntries(['log', 'warn', 'error', 'debug', 'info'].map(key => [key, console[key]]));
  for (const key of Object.keys(diagnostics)) console[key] = () => {};
  const report = { status: 'RUNNING', projectRef: PROJECT_REF, runId: RUN_ID, caseRunId, startedAt: observedAt,
    sqlSha256: REQUIRED_SQL_SHA256, manifestSha256: MANIFEST_SHA256, sourceHashes,
    prerequisiteEvidence: 'PARENT_APPLICATION_AND_SEED_RECEIPTS_PLUS_LOCAL_SOURCE_HASHES',
    accounts: pilot.scope.accounts.map(({ alias, authId }) => ({ alias, authId })),
    workspaces: pilot.scope.workspaces, cases: [], intents: [], missions: [], studio: [],
    notRun: ['mobile_desktop_browser', 'signup_onboarding_acceptance', 'legal_consent_acceptance', 'native_Google_login', 'Storage', 'workflow_parent_fixtures', 'positive_join_XP', 'AI', 'providers', 'deployment', 'cleanup'],
    limitations: ['No independent catalog verification of parent receipts.', 'No remote cleanup; parent must inspect exact returned IDs and ambiguous intents.',
      'Own balance completeness relies on creator_id-only SELECT policies; parent owner inventory remains authoritative.',
      'Export Auth account metadata may be null because the local worker blocks Auth-admin reads.'],
  };
  const save = () => writeJsonAtomic(resultFile, report);
  const account = alias => pilot.scope.accounts.find(row => row.alias === alias);
  const ws = alias => pilot.scope.workspaces.find(row => row.alias === (alias === 'C-B' ? 'B' : 'A'));
  let activeCase = 'login', missionId, currentTitle;
  async function test(name, actor, operation, accepts) {
    activeCase = name;
    const response = await operation();
    const passed = Boolean(accepts(response));
    report.cases.push({ name, actor, status: passed ? 'PASS' : 'FAIL', httpStatus: response.status });
    await save(); check(passed, 'CASE_ASSERTION_FAILED');
    return response.data;
  }
  async function request(origin, resource, alias, method = 'GET', body, extraHeaders = {}) {
    check(origin === TARGET || Object.values(APP_ORIGINS).includes(origin), 'OUTBOUND_ORIGIN_DENIED');
    check(resource.startsWith(origin === TARGET ? '/rest/v1/' : '/api/') && !resource.includes('://'), 'OUTBOUND_PATH_DENIED');
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (origin === TARGET) headers.apikey = publicKey;
    if (alias) {
      const session = sessions.get(alias);
      check(session && session.expiresAt > Date.now() + 15000 && Date.now() < Date.parse(state.expiresAt), 'SESSION_OR_RUN_EXPIRED');
      headers.Authorization = `Bearer ${session.jwt}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // No redirects, SDK service key, automatic retries, response logging or export files.
    const response = await fetch(origin + resource, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000) });
    const text = await response.text();
    check(text.length < 2097152, 'RESPONSE_LIMIT_EXCEEDED');
    let data; try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, data };
  }
  const api = (alias, route, method = 'GET', body, workspace = ws(alias)) => request(APP_ORIGINS[workspace.alias], route, alias, method, body, { 'X-Workspace-Slug': workspace.slug });
  const rest = (alias, table, filters, select, body) => request(TARGET, restPath(table, filters, select), alias, body === undefined ? 'GET' : 'PATCH', body, { Prefer: 'return=representation' });
  const rows = (ids, key = 'id') => r => r.status === 200 && idsEqual(r.data, ids, key);
  async function balances(alias, label) {
    for (const [table, field] of [['point_balances', 'balance'], ['earnings_balances', 'available']]) {
      await test(`${label}:${table}`, alias, () => rest(alias, table, { creator_id: `eq.${account(alias).authId}` }, `creator_id,workspace_id,${field}`),
        r => r.status === 200 && r.data?.length === 1 && r.data[0].creator_id === account(alias).authId && r.data[0].workspace_id === ws(alias).id && zero(r.data[0][field]));
    }
  }
  async function missionUnchanged(label) {
    await test(label, 'B-A', () => rest('B-A', 'missions', { id: `eq.${missionId}` }, 'id,workspace_id,title,status,points_reward,cash_reward,cpm_rate,cpm_budget_pool,public_preview_enabled'),
      r => r.status === 200 && r.data?.length === 1 && r.data[0].id === missionId && r.data[0].workspace_id === ws('B-A').id
        && r.data[0].status === 'draft' && r.data[0].title === currentTitle && r.data[0].public_preview_enabled === false
        && ['points_reward', 'cash_reward', 'cpm_rate', 'cpm_budget_pool'].every(key => zero(r.data[0][key])));
  }
  const missionSlug = `kocmax-auth-${RUN_ID}-api-draft`;
  const missionBody = { slug: missionSlug, title: `Synthetic permission pilot ${RUN_ID}`, mission_type: 'ugc',
    points_reward: 0, cash_reward: 0, cpm_rate: 0, cpm_budget_pool: 0, quota: 1, deadline: null, deliverables: [], requirements: [], platforms: [] };
  async function brandDenied(alias, label) {
    // Duplicate slug, empty publish requirements, draft close, and member delete also
    // bound damage if a gate regresses. Exact capability error, not any 403, is required.
    for (const [method, suffix, body] of [['POST', '', missionBody], ['PUT', `/${missionId}`, { title: currentTitle }],
      ['POST', `/${missionId}/publish`, {}], ['POST', `/${missionId}/close`, {}], ['DELETE', `/${missionId}`, undefined]]) {
      await test(`${label}:${method}:${suffix.split('/').at(-1) || 'create'}`, alias,
        () => api(alias, `/api/brand/missions${suffix}`, method, body), r => r.status === 403 && r.data?.code === 'STAFF_CAPABILITY_REQUIRED');
    }
    await test(`${label}:REST_PATCH`, alias, () => rest(alias, 'missions', { id: `eq.${missionId}` }, 'id', { title: currentTitle }), rows([]));
    await missionUnchanged(`${label}:draft_unchanged`);
  }
  try {
    await save();
    const { createClient } = await import('@supabase/supabase-js');
    for (const secret of credentials.accounts) {
      activeCase = `password_auth:${secret.alias}`;
      const client = createClient(TARGET, publicKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
        storageKey: `auth-pilot-api-${caseRunId}-${secret.alias}`, debug: false },
        global: { fetch: async (input, init = {}) => {
          const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
          check(url.origin === TARGET && !url.username && !url.password && !url.hash
            && ((url.pathname === '/auth/v1/token' && url.search === '?grant_type=password' && init.method === 'POST')
              || (url.pathname === '/auth/v1/user' && !url.search && (!init.method || init.method === 'GET'))), 'AUTH_ENDPOINT_DENIED');
          return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
        } } });
      clients.push(client);
      const signed = await client.auth.signInWithPassword({ email: secret.email, password: secret.password });
      secret.password = ''; // File remains private for the parent's UI session/cleanup.
      check(!signed.error && signed.data.session, 'PASSWORD_AUTH_FAILED');
      const verified = await client.auth.getUser(signed.data.session.access_token);
      check(!verified.error, 'VERIFIED_AUTH_USER_REQUIRED');
      const expiresAt = validateOwnedSession(signed.data.session, verified.data.user, secret, state.ownershipNonce);
      sessions.set(secret.alias, { jwt: signed.data.session.access_token, expiresAt });
      report.cases.push({ name: activeCase, actor: secret.alias, status: 'PASS' }); await save();
    }
    // Auth-only negative comes BEFORE any normal bootstrap for U-X.
    for (const table of ['creators', 'point_balances', 'earnings_balances']) {
      const key = table === 'creators' ? 'id' : 'creator_id';
      await test(`auth_only:${table}`, 'U-X', () => rest('U-X', table, { [key]: `eq.${account('U-X').authId}` }, key), rows([]));
    }
    await test('auth_only:GET_me', 'U-X', () => api('U-X', '/api/me'), r => r.status === 403 && r.data?.code === 'forbidden');
    await test('auth_only:admin', 'U-X', () => api('U-X', '/api/admin/me'), r => r.status === 403 && r.data?.code === 'not_staff');
    await test('auth_only:brand', 'U-X', () => api('U-X', '/api/brand/me'), r => r.status === 403);
    for (const alias of ALIASES) {
      report.intents.push({ action: 'bootstrap', alias }); await save();
      await test('bootstrap:first', alias, () => api(alias, '/api/me/bootstrap', 'POST', { slug: ws(alias).slug }), r => r.status === 200 && r.data?.created === true);
    }
    await test('bootstrap:repeat', 'C-A', () => api('C-A', '/api/me/bootstrap', 'POST', { slug: ws('C-A').slug }), r => r.status === 200 && r.data?.created === false);
    await balances('C-A', 'before_wrong_workspace');
    await test('bootstrap:B_server', 'C-A', () => api('C-A', '/api/me/bootstrap', 'POST', { slug: ws('C-B').slug }, ws('C-B')), r => r.status === 404 && r.data?.code === 'no_workspace');
    await balances('C-A', 'after_wrong_workspace_no_extra_balance');
    for (const alias of ALIASES) {
      await test('own:GET_me', alias, () => api(alias, '/api/me'), r => r.status === 200 && r.data?.id === account(alias).authId && zero(r.data.xp));
      await test('own:creator', alias, () => rest(alias, 'creators', { id: `eq.${account(alias).authId}` }, 'id,workspace_id,xp,status'),
        r => r.status === 200 && r.data?.length === 1 && r.data[0].id === account(alias).authId && r.data[0].workspace_id === ws(alias).id && zero(r.data[0].xp) && r.data[0].status !== 'deleted');
    }
    await writeJsonAtomic(bootstrapFile, { status: 'NINE_NORMAL_API_BOOTSTRAPS_VERIFIED_READY_FOR_PARENT_PROFILE_SETUP',
      projectRef: PROJECT_REF, runId: RUN_ID, caseRunId, sqlSha256: REQUIRED_SQL_SHA256,
      observedAt: new Date().toISOString(), scope: 'EXISTING_ACCOUNT_LOGIN_ONLY_NOT_SIGNUP_OR_ONBOARDING_ACCEPTANCE',
      accounts: ALIASES.map(alias => ({ alias, authId: account(alias).authId, workspaceId: ws(alias).id })),
      consentAcceptedByRunner: false, onboardingCompletedByRunner: false });
    for (const field of ['workspace_id', 'xp']) {
      await test(`protected_creator:${field}`, 'C-A', () => rest('C-A', 'creators', { id: `eq.${account('C-A').authId}` }, 'id', { [field]: field === 'workspace_id' ? ws('C-B').id : 1 }), r => r.status === 403 && r.data?.code === '42501');
    }
    await test('protected_creator:unchanged', 'C-A', () => rest('C-A', 'creators', { id: `eq.${account('C-A').authId}` }, 'id,workspace_id,xp'),
      r => r.status === 200 && r.data?.length === 1 && r.data[0].workspace_id === ws('C-A').id && zero(r.data[0].xp));

    report.intents.push({ action: 'create_draft_mission', actor: 'B-A', workspaceId: ws('B-A').id, slug: missionSlug }); await save();
    const created = await test('brand:create_one_draft', 'B-A', async () => {
      const r = await api('B-A', '/api/brand/missions', 'POST', missionBody);
      if (UUID.test(r.data?.mission?.id)) { missionId = r.data.mission.id; report.missions.push({ id: missionId, slug: missionSlug, workspaceId: ws('B-A').id }); }
      return r;
    }, r => r.status === 201 && UUID.test(r.data?.mission?.id) && r.data.mission.workspace_id === ws('B-A').id && r.data.mission.status === 'draft');
    currentTitle = created.mission.title; await missionUnchanged('mission:draft_zero_private');
    for (const alias of ['B-A', 'S-A']) {
      currentTitle = `Synthetic ${alias} permission pilot ${RUN_ID}`;
      await test('brand:positive_API_edit', alias, () => api(alias, `/api/brand/missions/${missionId}`, 'PUT', { title: currentTitle }),
        r => r.status === 200 && r.data?.mission?.id === missionId && r.data.mission.title === currentTitle);
      await test('brand:positive_REST_PATCH_one', alias, () => rest(alias, 'missions', { id: `eq.${missionId}` }, 'id', { title: currentTitle }), rows([missionId]));
    }
    for (const alias of ['S-O', 'S-R', 'S-F']) await brandDenied(alias, `limited_staff:${alias}`);
    await test('outsider:brand_API', 'C-B', () => api('C-B', `/api/brand/missions/${missionId}`, 'PUT', { title: currentTitle }), r => r.status === 403);
    await test('outsider:REST_PATCH_zero', 'C-B', () => rest('C-B', 'missions', { id: `eq.${missionId}` }, 'id', { title: currentTitle }), rows([]));

    for (const step of pilot.studioSteps) {
      const command = pilot.studioRequest(step.key, studioReceipts);
      report.intents.push({ action: command.body.action, alias: step.alias, requestId: step.requestId }); await save();
      const data = await test(`studio:${step.kind}`, step.alias, () => api(step.alias, command.path, command.method, command.body), r => r.status === 200 && UUID.test(r.data?.result?.id));
      studioReceipts.push({ step: step.key, requestId: step.requestId, result: data.result });
      // Journal safe returned IDs even if subsequent shape/ownership validation fails.
      const entity = { step: step.key, requestId: step.requestId, id: data.result.id, actor: step.alias, validation: 'PENDING' };
      if (UUID.test(data.result.conversation_id)) entity.conversationId = data.result.conversation_id;
      if (UUID.test(data.result.thread_id)) entity.threadId = data.result.thread_id;
      report.studio.push(entity); await save();
      // Factory re-validates ownership, dependencies, private/manual/unverified state.
      pilot.cleanupInventorySql(studioReceipts);
      entity.validation = 'PASS'; await save();
    }
    for (const owner of ['C-A', 'C-P', 'C-B']) {
      const own = studioReceipts.filter(row => row.step.startsWith(`${owner}:`));
      const thread = own.find(row => row.step.endsWith(':thread')).result;
      await test('studio:owner_detail', owner, () => api(owner, `/api/studio/threads/${thread.id}`), r => r.status === 200
        && r.data?.thread?.id === thread.id && r.data.thread.conversation_id === thread.conversation_id
        && idsEqual(r.data.sources, own.filter(row => row.step.includes(':source')).map(row => row.result.id))
        && idsEqual(r.data.briefs, own.filter(row => row.step.endsWith(':brief')).map(row => row.result.id)) && empty(r.data.shares) && empty(r.data.messages));
      for (const other of ['C-A', 'C-P', 'C-B'].filter(alias => alias !== owner)) {
        await test(`studio:private_detail:${owner}`, other, () => api(other, `/api/studio/threads/${thread.id}`), r => r.status === 404 && r.data?.code === 'not_found');
      }
      await test(`studio:anonymous_detail:${owner}`, null, () => api(null, `/api/studio/threads/${thread.id}`, 'GET', undefined, ws(owner)), r => r.status === 401);
      for (const [table, suffix] of [['studio_threads', ':thread'], ['studio_sources', ':source'], ['studio_briefs', ':brief']]) {
        const ids = own.filter(row => row.step.includes(suffix)).map(row => row.result.id);
        for (const actor of [...ALIASES, null]) {
          await test(`studio:REST:${table}:${owner}`, actor, () => rest(actor, table, { id: `in.(${ids.join(',')})` }, 'id,creator_id,workspace_id'),
            r => actor === null ? [401, 403].includes(r.status) && r.data?.code === '42501'
              : r.status === 200 && idsEqual(r.data, actor === owner ? ids : []) && r.data.every(row => row.creator_id === account(actor).authId && row.workspace_id === ws(actor).id));
        }
      }
    }
    for (const alias of ALIASES) {
      await balances(alias, 'final_zero_balance');
      await test('wallet:points_zero', alias, () => api(alias, '/api/wallet/points'), r => r.status === 200 && zero(r.data?.balance));
      await test('wallet:earnings_zero', alias, () => api(alias, '/api/wallet/earnings'), r => r.status === 200 && zero(r.data?.available) && zero(r.data.pending));
      for (const kind of ['points', 'earnings']) await test(`wallet:${kind}_history_empty`, alias, () => api(alias, `/api/wallet/${kind}/history`), r => r.status === 200 && empty(r.data?.transactions));
      await test('export:own_scopes_only', alias, () => api(alias, '/api/me/export'), r => validateOwnExport(r, alias, pilot.scope, studioReceipts));
    }
    await test('reviewer:before_scoped_access', 'S-R', () => api('S-R', '/api/admin/submissions'), r => r.status === 200 && empty(r.data?.submissions));
    const expected = expectedRevocation(pilot.scope, caseRunId);
    const oldReviewerJwt = sessions.get('S-R').jwt;
    const deadline = Math.min(sessions.get('S-R').expiresAt - 120000, Date.parse(state.expiresAt) - 120000, Date.now() + 2700000);
    check(deadline > Date.now() + 60000, 'INSUFFICIENT_REVIEWER_SESSION_LIFETIME');
    report.status = 'AWAITING_PARENT_REVIEWER_REVOCATION'; await save();
    await writeJsonAtomic(barrierFile, { status: report.status, caseRunId, projectRef: PROJECT_REF, runId: RUN_ID,
      waitingAt: new Date().toISOString(), deadline: new Date(deadline).toISOString(), expectedReceipt: expected });
    let received = false;
    while (Date.now() < deadline) {
      const receipt = await readJsonFile(revokedFile, true);
      if (receipt) { validateRevocation(receipt, expected); received = true; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    check(received, 'REVOCATION_RECEIPT_TIMEOUT');
    check(sessions.get('S-R').jwt === oldReviewerJwt, 'ORIGINAL_REVIEWER_SESSION_REQUIRED');
    report.status = 'RUNNING_AFTER_REVOCATION'; await save();
    await test('stale_reviewer:scoped_read', 'S-R', () => api('S-R', '/api/admin/submissions'), r => r.status === 403 && r.data?.code === 'STAFF_CAPABILITY_REQUIRED');
    await test('stale_reviewer:admin_write', 'S-R', () => api('S-R', `/api/admin/missions/${missionId}`, 'PATCH', { title: currentTitle }), r => r.status === 403 && r.data?.code === 'STAFF_CAPABILITY_REQUIRED');
    await brandDenied('S-R', 'stale_reviewer');
    report.status = 'API_RLS_CASES_PASSED_CLEANUP_PENDING'; report.finishedAt = new Date().toISOString(); await save();
    return { status: report.status, caseRunId, passed: report.cases.length, report: resultFile };
  } catch (error) {
    report.status = 'STOPPED_NOT_ACCEPTED'; report.failedCase = activeCase;
    report.failureCode = error instanceof CaseError ? error.message : 'OPERATION_FAILED_DETAILS_SUPPRESSED';
    report.finishedAt = new Date().toISOString(); await save().catch(() => {});
    throw new CaseError(report.failureCode);
  } finally {
    for (const secret of credentials.accounts) secret.password = '';
    for (const client of clients) await client.auth.stopAutoRefresh().catch(() => {});
    sessions.clear(); clients.length = 0; studioReceipts.length = 0;
    Object.assign(console, diagnostics);
    // Do not sign out globally: parent UI and later cleanup own session revocation.
    if (await fs.readFile(lockFile, 'utf8').catch(() => '') === caseRunId) await fs.unlink(lockFile);
  }
}

/** Never save the export. Require exact fixture collections and empty unrelated data. */
export function validateOwnExport(response, alias, scope, receipts) {
  const data = response.data, actor = scope.accounts.find(row => row.alias === alias);
  const workspace = scope.workspaces.find(row => row.alias === (alias === 'C-B' ? 'B' : 'A'));
  if (response.status !== 200 || data?.creatorId !== actor.authId || data.profile?.id !== actor.authId || !zero(data.profile.xp)) return false;
  const own = receipts.filter(row => row.step.startsWith(`${alias}:`));
  for (const [table, suffix] of [['studio_threads', ':thread'], ['studio_sources', ':source'], ['studio_briefs', ':brief'], ['studio_commands', null]]) {
    const expected = suffix ? own.filter(row => row.step.includes(suffix)).map(row => row.result.id) : own.map(row => row.requestId);
    if (!idsEqual(data[table], expected, suffix ? 'id' : 'request_id') || !data[table].every(row => row.creator_id === actor.authId && row.workspace_id === workspace.id)) return false;
  }
  const conversations = own.filter(row => row.step.endsWith(':thread')).map(row => row.result.conversation_id);
  if (!idsEqual(data.assistantConversations, conversations) || !data.assistantConversations.every(row => empty(row.messages))) return false;
  for (const key of ['consents', 'submissions', 'points', 'earnings', 'redemptions', 'socialAccounts', 'portfolioLinks', 'notifications', 'studio_shares', 'studio_badges']) if (!empty(data[key])) return false;
  for (const key of ['integration_connections', 'integration_resources', 'integration_snapshots', 'integration_sync_runs', 'integration_events']) if (data[key] !== undefined && !empty(data[key])) return false;
  if (data.account?.email != null && data.account.email !== actor.email) return false;
  // Catch another pilot identity anywhere, including nested command result/content.
  const serialized = JSON.stringify(data);
  return scope.accounts.filter(row => row.alias !== alias).every(row => !serialized.includes(row.authId) && !serialized.includes(row.email));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--execute-approved-cases' || args[1] !== '--public-key-file') {
    process.stderr.write('Explicit execution flag and runtime-public-config.json path required. Import is offline/inert.\n');
    process.exitCode = 2;
  } else {
    // Never surface SDK/native errors or stack traces, which can contain customer data.
    try { process.stdout.write(JSON.stringify(await executeApprovedCases(args[2])) + '\n'); }
    catch (error) { process.stdout.write(JSON.stringify({ status: 'STOPPED_NOT_ACCEPTED', code: error instanceof CaseError ? error.message : 'PREREQUISITE_OR_OPERATION_FAILED_DETAILS_SUPPRESSED' }) + '\n'); process.exitCode = 1; }
  }
}
