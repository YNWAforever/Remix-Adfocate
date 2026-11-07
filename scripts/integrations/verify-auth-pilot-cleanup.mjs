/**
 * Import is inert. Parent-only execution AFTER UI, BEFORE worker cleanup:
 * node scripts/integrations/verify-auth-pilot-cleanup.mjs --execute-approved-cleanup-verification \
 *   --public-key-file docs/review/kocmax-stage-4d/d1/auth-permission-execution/runtime-public-config.json
 *
 * Uses only the public key and nine existing private passwords. No service key,
 * environment credentials, business writes, SDK refresh retries, or Auth admin.
 * Passwords/JWTs/refresh tokens remain in memory and are never written or logged.
 * This process must remain alive; an interrupted run cannot resume its sessions.
 *
 * Wait for cleanup-auth-verification-ready.json before starting worker cleanup.
 * Parent atomically writes cleanup-worker-completed.json by copying ready.expectedReceipt
 * EXACTLY and replacing completedAt:null with the actual UTC completion time.
 * All other fields (including each account's assertions) must remain exact.
 * Write it only after audited role revocation, product anonymization, Auth ban,
 * global session revocation, and credential removal have actually completed.
 * These are parent attestations; this verifier independently tests refresh rejection.
 *
 * Wait <=30 minutes AND ends >=10 minutes before earliest session/run expiry.
 * A malformed/wrong/replayed receipt stops verification; no automatic retry.
 * Final artifact: cleanup-auth-verification-receipt.json. HTTP/transport failures
 * are inconclusive, never a passing refresh rejection. Old access JWTs may still
 * read their own rows; no claim of instant JWT invalidation or broader isolation.
 * Only unexpected successful refresh permits one public logout?scope=local of
 * that exact, proven owned session. No global logout or other cleanup mutation.
 * Reports are one-shot: existing outputs/barrier require parent review, not overwrite.
 * JS reference clearing is not a cryptographic memory-erasure guarantee.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { assertPrivateDirectory, readJsonFile, writeJsonAtomic, verifyCheckout } from './auth-pilot-local.mjs';
import {
  validateEvidence as validateAppliedEvidence, validatePublicConfig, validateOwnedSession,
  ALIASES, TARGET, REPORT_DIR, restPath,
} from './run-auth-pilot-cases.mjs';
import { RUN_ID, PROJECT_REF, REQUIRED_SQL_SHA256, MANIFEST_SHA256 } from './auth-pilot-fixtures.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PRIVATE_DIR = 'C:/Users/laich/AppData/Local/KOCmax/AuthPilot/' + RUN_ID;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const API_SHA256 = '25f81102f39da3748f5ea75ca2617dad83bd70bb1b7947fd32ba4f38907490d8';
export const SCOPE_SHA256 = 'a6066defcccca54973846f0d11da583e59a923a3661cd10b3a1c3292aca3fa35';
export const SOURCE_HASHES = Object.freeze({
  'server/routes/me.ts': '9e3515ac7177371a6c14b8f6e483cc5371d03e496f14f4d9658ea3724c9296f8',
  'server/lib/brandAuth.ts': '1318514b0a6047d2cf46104e2357154226bf623a3b79f57d09721fcad3304970',
  'server/routes/brand.ts': '170d98a524ec4014b3b22a869ccdb142c23639c759aba656088615bf0884af86',
  'server/routes/account.ts': '42867c57bdff07edf5521cc6742357c7868d516a284d0f7d80efd5ba645bac74',
  'scripts/integrations/auth-pilot-local.mjs': 'ba2d157230750495778922b5ccc6f15a8f635c79f53f1d36e3c576a25fdedfaf',
  'scripts/integrations/auth-pilot-fixtures.mjs': 'a17503f41ddc3c9195be76d04d490473803b2f770100f02d482163f400bce379',
  'scripts/integrations/run-auth-pilot-cases.mjs': '17ff2bb4ff1b2ea459ecc70b6ba44534cf2747a543dd5ab89d9d19935fd3ad20',
});
const FILES = Object.freeze({
  ready: path.join(REPORT_DIR, 'cleanup-auth-verification-ready.json'),
  barrier: path.join(REPORT_DIR, 'cleanup-worker-completed.json'),
  result: path.join(REPORT_DIR, 'cleanup-auth-verification-receipt.json'),
});
const MARGIN_MS = 600000, MAX_WAIT_MS = 1800000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
class VerificationError extends Error {}
const check = (ok, code) => { if (!ok) throw new VerificationError(code); };
const safeCode = error => error instanceof VerificationError ? error.message : 'DETAILS_SUPPRESSED';
const utc = value => new Date(value).toISOString();
const exactKeys = (value, keys) => value && equal(Object.keys(value).sort(), [...keys].sort());
const claims = token => {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new VerificationError('INVALID_SESSION'); }
};
const accountRefs = scope => scope.accounts.map(({ alias, authId }) => {
  const workspace = scope.workspaces.find(w => w.alias === (alias === 'C-B' ? 'B' : 'A'));
  return { alias, authId, workspaceAlias: workspace.alias, workspaceId: workspace.id };
});

/** Pure gates. The injected fixture validator is only for offline unit tests. */
export function validatePublicEvidence(input, now = Date.now(), fixtureValidator = validateAppliedEvidence) {
  check(equal(input.sourceHashes, SOURCE_HASHES), 'SOURCE_HASH_MISMATCH');
  check(input.apiHash === API_SHA256 && input.scopeHash === SCOPE_SHA256, 'FROZEN_RECEIPT_HASH_MISMATCH');
  const config = input.publicConfig;
  check(exactKeys(config, ['projectRef', 'supabaseUrl', 'publishableKey', 'keyType']), 'PUBLIC_CONFIG_FIELDS');
  const publicKey = validatePublicConfig(config);
  check((config.keyType === 'legacy_anon' && publicKey.split('.').length === 3) ||
    (config.keyType === 'publishable' && /^sb_publishable_/.test(publicKey)), 'PUBLIC_KEY_TYPE_MISMATCH');
  const pilot = fixtureValidator(input, utc(now));
  check(equal(input.scope, pilot.scope), 'EXACT_ACTUAL_SCOPE_REQUIRED');
  const api = input.apiReport;
  check(api?.status === 'API_RLS_CASES_PASSED_CLEANUP_PENDING' && api.projectRef === PROJECT_REF &&
    api.runId === RUN_ID && UUID.test(api.caseRunId) && api.sqlSha256 === REQUIRED_SQL_SHA256 &&
    api.manifestSha256 === MANIFEST_SHA256 && equal(api.accounts, pilot.scope.accounts.map(({ alias, authId }) => ({ alias, authId }))) &&
    equal(api.workspaces, pilot.scope.workspaces) && Date.parse(api.startedAt) <= Date.parse(api.finishedAt) &&
    Date.parse(api.finishedAt) <= now && !api.failureCode &&
    Array.isArray(api.cases) && api.cases.length === 265 && api.cases.every(c => c.status === 'PASS') &&
    ['stale_reviewer:scoped_read', 'stale_reviewer:admin_write'].every(name =>
      api.cases.some(c => c.name === name && c.actor === 'S-R' && c.httpStatus === 403)) &&
    Object.entries(api.sourceHashes ?? {}).length === 3 &&
    ['server/routes/me.ts', 'server/lib/brandAuth.ts', 'server/routes/brand.ts'].every(file =>
      api.sourceHashes[file] === SOURCE_HASHES[file]), 'PASSED_API_REPORT_REQUIRED');
  check(Array.isArray(api.studio) && api.studio.length === pilot.studioSteps.length &&
    new Set(api.studio.map(row => row.id)).size === api.studio.length, 'EXACT_STUDIO_RECEIPTS_REQUIRED');
  const studio = pilot.studioSteps.map(step => {
    const matches = api.studio.filter(row => row.step === step.key);
    const row = matches[0];
    check(matches.length === 1 && row.actor === step.alias && row.requestId === step.requestId &&
      row.validation === 'PASS' && UUID.test(row.id), 'STUDIO_RECEIPT_MISMATCH');
    if (step.kind !== 'thread') check(row.threadId === api.studio.find(r => r.step === step.alias + ':thread')?.id,
      'STUDIO_THREAD_MISMATCH');
    return { alias: step.alias, id: row.id, table: step.kind === 'thread' ? 'studio_threads' :
      step.kind === 'brief' ? 'studio_briefs' : 'studio_sources' };
  });
  return { scope: pilot.scope, studio, publicKey, apiCaseRunId: api.caseRunId };
}

export function validatePrivateInputs(credentials, state, scope, now = Date.now()) {
  check(state?.projectRef === PROJECT_REF && state.runId === RUN_ID && state.manifestSha256 === MANIFEST_SHA256 &&
    ['APPS_STARTED', 'LOGIN_PARTIAL', 'LOGINS_VERIFIED'].includes(state.phase) && state.appsEverStarted === true &&
    /^[A-Za-z0-9_-]{43}$/.test(state.ownershipNonce) && Date.parse(state.startedAt) <= now &&
    Date.parse(state.expiresAt) > now + MARGIN_MS + 60000 &&
    Date.parse(state.expiresAt) - Date.parse(state.startedAt) === 86400000, 'OWNED_ACTIVE_WORKER_REQUIRED');
  check(equal(scope.accounts.map(a => a.alias), ALIASES) && state.accounts?.length === 9 &&
    credentials?.accounts?.length === 9, 'NINE_OWNED_ACCOUNTS_REQUIRED');
  for (const [i, expected] of scope.accounts.entries()) {
    const owned = state.accounts[i], secret = credentials.accounts[i];
    check(UUID.test(expected.authId) && owned?.alias === expected.alias && owned.authId === expected.authId &&
      owned.created === true && owned.attempted === true && !owned.productDeleted && !owned.sessionsRevoked &&
      (!owned.cleanup || owned.cleanup === 'NOT_RUN') && secret?.alias === expected.alias &&
      secret.authId === expected.authId && secret.email === expected.email &&
      typeof secret.password === 'string' && secret.password.length >= 40 && secret.password.length <= 256,
    'OWNED_PRIVATE_IDENTITY_MISMATCH');
  }
  check(new Set(credentials.accounts.map(a => a.password)).size === 9, 'DISTINCT_PASSWORDS_REQUIRED');
}

export function makeReady(context, sessions, verificationId, readyAt, runExpiresAt) {
  check(UUID.test(verificationId) && sessions.size === 9, 'NINE_FRESH_SESSIONS_REQUIRED');
  const deadline = Math.min(readyAt + MAX_WAIT_MS, runExpiresAt - MARGIN_MS,
    ...[...sessions.values()].map(s => s.expiresAt - MARGIN_MS));
  check(deadline >= readyAt + 60000, 'INSUFFICIENT_SESSION_LIFETIME');
  const expectedReceipt = {
    status: 'WORKER_CLEANUP_COMPLETED', projectRef: PROJECT_REF, runId: RUN_ID, verificationId,
    apiCaseRunId: context.apiCaseRunId, apiCasesSha256: API_SHA256, fixtureScopeSha256: SCOPE_SHA256,
    sqlSha256: REQUIRED_SQL_SHA256, workerStatus: 'AUTH_DISABLED_CREDENTIALS_REMOVED',
    rolesRevoked: true, credentialsRemoved: true,
    accounts: accountRefs(context.scope).map(a => ({ ...a, productAnonymized: true,
      authBanned: true, sessionsRevoked: true, authParentRetained: true })),
    completedAt: null,
  };
  return { status: 'AWAITING_PARENT_CLEANUP', projectRef: PROJECT_REF, runId: RUN_ID, verificationId,
    readyAt: utc(readyAt), deadline: utc(deadline), sessionExpiryMarginSeconds: MARGIN_MS / 1000,
    accounts: accountRefs(context.scope), expectedReceipt };
}

export function validateBarrier(receipt, ready, now = Date.now()) {
  check(exactKeys(receipt, Object.keys(ready.expectedReceipt)) &&
    equal({ ...receipt, completedAt: null }, ready.expectedReceipt), 'EXACT_CLEANUP_BARRIER_REQUIRED');
  check(typeof receipt.completedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(receipt.completedAt) &&
    Date.parse(receipt.completedAt) >= Date.parse(ready.readyAt) && Date.parse(receipt.completedAt) <= now + 5000 &&
    Date.parse(receipt.completedAt) < Date.parse(ready.deadline) && now < Date.parse(ready.deadline),
  'FRESH_CLEANUP_BARRIER_REQUIRED');
}

export async function awaitBarrier(ready, { readBarrier, now = Date.now, monotonicNow = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const remaining = Date.parse(ready.deadline) - now();
  check(remaining > 0 && remaining <= MAX_WAIT_MS, 'CLEANUP_BARRIER_TIMEOUT');
  const stopAt = monotonicNow() + remaining;
  for (;;) {
    check(now() < Date.parse(ready.deadline) && monotonicNow() < stopAt, 'CLEANUP_BARRIER_TIMEOUT');
    const receipt = await readBarrier();
    check(now() < Date.parse(ready.deadline) && monotonicNow() < stopAt, 'CLEANUP_BARRIER_TIMEOUT');
    if (receipt) { validateBarrier(receipt, ready, now()); return; }
    await sleep(Math.min(1000, Date.parse(ready.deadline) - now(), stopAt - monotonicNow()));
  }
}

const REJECTION_CODES = new Set(['refresh_token_not_found', 'refresh_token_already_used',
  'session_not_found', 'session_expired', 'user_banned', 'user_not_found']);
export function classifyRefresh(response) {
  if (response.transportError) return { status: 'INCONCLUSIVE_TRANSPORT', httpStatus: null };
  const { status, data } = response;
  if (status >= 200 && status < 300) return { status: 'FAIL_REFRESH_ACCEPTED', httpStatus: status };
  const code = data?.error_code ?? data?.code;
  if ([400, 401, 403].includes(status) && REJECTION_CODES.has(code))
    return { status: 'REJECTED_EXPLICIT_AUTH_ERROR', httpStatus: status, authCode: code };
  if ([400, 401, 403].includes(status) && data?.error === 'invalid_grant' &&
      /^(Invalid Refresh Token: (Refresh Token Not Found|Already Used)|User is banned|Session (not found|expired)|User not found)$/i.test(data.error_description ?? ''))
    return { status: 'REJECTED_EXPLICIT_AUTH_ERROR', httpStatus: status, authCode: 'legacy_invalid_grant' };
  return { status: 'INCONCLUSIVE_RESPONSE', httpStatus: Number.isInteger(status) ? status : null };
}

export function canRevokeRefreshedSession(data, original, account, nonce) {
  try {
    const jwt = claims(data.access_token), marker = data.user?.app_metadata?.auth_pilot;
    return jwt.sub === account.authId && jwt.iss === TARGET + '/auth/v1' && jwt.role === 'authenticated' &&
      jwt.session_id === original.sessionId && UUID.test(jwt.session_id) && data.user.id === account.authId &&
      marker?.run_id === RUN_ID && marker.alias === account.alias && marker.ownership_nonce === nonce;
  } catch { return false; }
}

export function classifyOldAccess(response, account, rows) {
  if (response.transportError) return { status: 'INCONCLUSIVE_TRANSPORT', httpStatus: null };
  if ([401, 403].includes(response.status)) return { status: 'HTTP_REJECTED', httpStatus: response.status };
  if (response.status !== 200) return { status: 'INCONCLUSIVE_RESPONSE', httpStatus: response.status };
  if (!rows) return { status: response.data?.id === account.authId ? 'OWN_AUTH_USER_VISIBLE' :
    'FAIL_UNEXPECTED_IDENTITY', httpStatus: 200 };
  const data = response.data;
  if (!Array.isArray(data)) return { status: 'INCONCLUSIVE_RESPONSE', httpStatus: 200 };
  if (data.length > rows.length || new Set(data.map(r => r?.id)).size !== data.length ||
      data.some(r => !r || !rows.some(expected => expected.id === r.id) ||
        r.creator_id !== account.authId || r.workspace_id !== account.workspaceId))
    return { status: 'FAIL_UNEXPECTED_SCOPE', httpStatus: 200 };
  return { status: data.length ? 'RECORDED_OWN_ROWS_VISIBLE' : 'NO_VISIBLE_RECORDED_OWN_ROWS',
    httpStatus: 200, count: data.length };
}

/** Injected engine: pure tests supply every effect; it never reads files itself. */
export async function runVerification({ context, credentials, state, createAdapter, readBarrier, writeReady, writeReport,
  now = Date.now, monotonicNow = () => performance.now(), sleep, verificationId = randomUUID() }) {
  const report = { status: 'PREPARING', projectRef: PROJECT_REF, runId: RUN_ID, verificationId,
    apiCaseRunId: context.apiCaseRunId, apiCasesSha256: API_SHA256, fixtureScopeSha256: SCOPE_SHA256,
    sqlSha256: REQUIRED_SQL_SHA256, sourceHashes: SOURCE_HASHES, startedAt: utc(now()),
    accounts: accountRefs(context.scope).map(a => ({ ...a, login: 'NOT_RUN', refresh: { status: 'NOT_RUN' },
      oldAccess: { authUser: { status: 'NOT_RUN' }, studio: [] } })),
    accessJwtInvalidation: 'NOT_ASSUMED_OR_PROVEN_BY_REFRESH_REJECTION',
    limitations: ['Parent cleanup receipt is an attestation, not independent admin verification.',
      'Old-token probes cover only own recorded IDs; no claim about other rows or complete deletion.',
      'Empty REST results cannot distinguish removed rows from RLS filtering.',
      'Reference clearing is not cryptographic memory erasure.'],
  };
  const sessions = new Map();
  let adapter;
  try {
    validatePrivateInputs(credentials, state, context.scope, now());
    adapter = await createAdapter(); // Runtime SDK import occurs only after all public/private gates.
    for (const [i, account] of context.scope.accounts.entries()) {
      const secret = credentials.accounts[i];
      const signed = await adapter.login(secret);
      try {
        const expiresAt = validateOwnedSession(signed.session, signed.user, account, state.ownershipNonce, now());
        const claim = claims(signed.session.access_token);
        check(UUID.test(claim.session_id) && typeof signed.session.refresh_token === 'string' &&
          /^[A-Za-z0-9_-]{8,4096}$/.test(signed.session.refresh_token), 'OWNED_REFRESH_SESSION_REQUIRED');
        sessions.set(account.alias, { jwt: signed.session.access_token, refresh: signed.session.refresh_token,
          sessionId: claim.session_id, expiresAt });
        report.accounts[i].originalAccessExpiresAt = utc(expiresAt);
      } finally {
        secret.password = '';
        if (signed.session) { signed.session.access_token = ''; signed.session.refresh_token = ''; signed.session.user = null; }
        signed.user = null;
      }
      report.accounts[i].login = 'FRESH_PASSWORD_AND_GET_USER_VERIFIED';
      await writeReport(report);
    }
    check(new Set([...sessions.values()].map(s => s.sessionId)).size === 9, 'DISTINCT_SESSIONS_REQUIRED');
    const ready = makeReady(context, sessions, verificationId, now(), Date.parse(state.expiresAt));
    report.status = ready.status;
    await writeReport(report);
    await writeReady(ready);
    await awaitBarrier(ready, { readBarrier, now, monotonicNow, sleep });
    report.status = 'VERIFYING_AFTER_PARENT_CLEANUP';
    await writeReport(report);
    for (const [i, account] of context.scope.accounts.entries()) {
      const held = sessions.get(account.alias), result = report.accounts[i];
      check(now() < held.expiresAt && now() < Date.parse(state.expiresAt), 'VERIFICATION_SESSION_OR_RUN_EXPIRED');
      let refreshed;
      try { refreshed = await adapter.refresh(held.refresh); }
      catch { refreshed = { transportError: true }; }
      result.refresh = classifyRefresh(refreshed);
      if (result.refresh.status === 'FAIL_REFRESH_ACCEPTED') {
        if (canRevokeRefreshedSession(refreshed.data, held, account, state.ownershipNonce)) {
          let revoked;
          try { revoked = await adapter.logoutLocal(refreshed.data.access_token); }
          catch { revoked = { transportError: true }; }
          result.unexpectedSessionLogout = { status: !revoked.transportError && [200, 204].includes(revoked.status) ?
            'LOCAL_LOGOUT_ACKNOWLEDGED' : 'NOT_VERIFIED', httpStatus: revoked.status ?? null };
        } else result.unexpectedSessionLogout = { status: 'NOT_ATTEMPTED_OWNERSHIP_UNPROVEN' };
      }
      // Drop any unexpected returned credentials before persisting a result.
      if (refreshed.data && typeof refreshed.data === 'object') {
        delete refreshed.data.access_token; delete refreshed.data.refresh_token; delete refreshed.data.user;
      }
      refreshed = null; held.refresh = '';
      result.oldAccess.observedAt = utc(now());
      const oldRequest = async operation => {
        if (now() >= held.expiresAt) return { status: 'NOT_PROBED_OLD_ACCESS_EXPIRED' };
        let response;
        try { response = await operation(); } catch { response = { transportError: true }; }
        return response;
      };
      let observed = await oldRequest(() => adapter.authUser(held.jwt));
      result.oldAccess.authUser = typeof observed.status === 'string' ? observed : classifyOldAccess(observed, account);
      const own = context.studio.filter(row => row.alias === account.alias);
      for (const table of ['studio_threads', 'studio_sources', 'studio_briefs']) {
        const rows = own.filter(row => row.table === table);
        if (!rows.length) continue;
        observed = await oldRequest(() => adapter.studio(held.jwt, result, table, rows));
        result.oldAccess.studio.push({ table, ...(typeof observed.status === 'string' ? observed :
          classifyOldAccess(observed, result, rows)) });
      }
      if (!own.length) result.oldAccess.studio.push({ status: 'NOT_PROBED_NO_RECORDED_OWN_ROWS' });
      await writeReport(report);
    }
    const scopeFailure = report.accounts.some(a => a.oldAccess.authUser.status.startsWith('FAIL_') ||
      a.oldAccess.studio.some(r => r.status.startsWith('FAIL_')));
    report.status = scopeFailure ? 'FAIL_UNEXPECTED_ACCESS_SCOPE' :
      report.accounts.some(a => a.refresh.status === 'FAIL_REFRESH_ACCEPTED') ? 'FAIL_REFRESH_ACCEPTED' :
      report.accounts.every(a => a.refresh.status === 'REJECTED_EXPLICIT_AUTH_ERROR') ?
        'NINE_REFRESH_REJECTIONS_VERIFIED_OLD_ACCESS_REPORTED' : 'REFRESH_VERIFICATION_INCONCLUSIVE';
  } catch (error) {
    report.status = 'STOPPED_NOT_VERIFIED';
    report.failureCode = safeCode(error);
  } finally {
    for (const account of credentials?.accounts ?? []) account.password = '';
    for (const held of sessions.values()) { held.jwt = ''; held.refresh = ''; held.sessionId = ''; }
    sessions.clear();
    if (state) state.ownershipNonce = '';
    await adapter?.dispose().catch(() => {});
    report.finishedAt = utc(now());
    await writeReport(report);
  }
  return report;
}

async function jsonResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) return { status: response.status, data: null };
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; check(size <= 131072, 'RESPONSE_LIMIT');
      chunks.push(Buffer.from(value));
    }
    let data = null;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    return { status: response.status, data };
  } finally {
    await reader.cancel().catch(() => {});
    for (const chunk of chunks) chunk.fill(0);
  }
}

/** No SDK refreshSession: that path has retry behavior. Raw refresh is one request. */
async function createPublicAdapter(publicKey) {
  const diagnostics = Object.fromEntries(['log', 'warn', 'error', 'debug', 'info'].map(k => [k, console[k]]));
  for (const key of Object.keys(diagnostics)) console[key] = () => {};
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const request = async (resource, method, jwt, body) => {
      try {
        const headers = { apikey: publicKey, Accept: 'application/json' };
        if (jwt) headers.Authorization = 'Bearer ' + jwt;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        return await jsonResponse(await fetch(TARGET + resource, { method, headers,
          body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000) }));
      } catch { return { transportError: true }; }
    };
    return {
      login: async secret => {
        const seen = new Set();
        const client = createClient(TARGET, publicKey, { auth: {
          persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
          storageKey: 'cleanup-verifier-' + randomUUID(), debug: false,
        }, global: { fetch: async (input, init = {}) => {
          const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
          const method = (init.method ?? 'GET').toUpperCase();
          check(url.origin === TARGET && !url.username && !url.password && !url.hash &&
            ((method === 'POST' && url.pathname === '/auth/v1/token' && url.search === '?grant_type=password') ||
              (method === 'GET' && url.pathname === '/auth/v1/user' && !url.search)), 'LOGIN_ENDPOINT_DENIED');
          const identity = method + url.pathname; check(!seen.has(identity), 'AUTOMATIC_REQUEST_RETRY_DENIED');
          seen.add(identity);
          return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
        } } });
        try {
          const signed = await client.auth.signInWithPassword({ email: secret.email, password: secret.password });
          check(!signed.error && signed.data.session, 'PASSWORD_LOGIN_FAILED');
          const verified = await client.auth.getUser(signed.data.session.access_token);
          check(!verified.error && verified.data.user, 'AUTH_GET_USER_FAILED');
          return { session: signed.data.session, user: verified.data.user };
        } finally { await client.auth.stopAutoRefresh(); }
      },
      refresh: token => request('/auth/v1/token?grant_type=refresh_token', 'POST', null, { refresh_token: token }),
      logoutLocal: jwt => request('/auth/v1/logout?scope=local', 'POST', jwt),
      authUser: jwt => request('/auth/v1/user', 'GET', jwt),
      studio: (jwt, account, table, rows) => request(restPath(table, {
        id: 'in.(' + rows.map(row => row.id).join(',') + ')', creator_id: 'eq.' + account.authId,
        workspace_id: 'eq.' + account.workspaceId, limit: String(rows.length),
      }, 'id,creator_id,workspace_id'), 'GET', jwt),
      dispose: async () => { Object.assign(console, diagnostics); },
    };
  } catch (error) { Object.assign(console, diagnostics); throw error; }
}

async function checkedFile(file) {
  const stat = await fs.lstat(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 1048576, 'SAFE_FILE_REQUIRED');
  return fs.readFile(file);
}
async function assertAbsent(file) {
  try { await fs.lstat(file); throw new VerificationError('EXISTING_VERIFICATION_ARTIFACT_REQUIRES_PARENT_REVIEW'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function executeApprovedVerification(publicKeyFile) {
  check(typeof publicKeyFile === 'string' && path.resolve(publicKeyFile).toLowerCase() ===
    path.join(REPORT_DIR, 'runtime-public-config.json').toLowerCase(), 'EXACT_PUBLIC_KEY_FILE_REQUIRED');
  check(path.resolve(await fs.realpath(REPORT_DIR)).toLowerCase() === path.resolve(REPORT_DIR).toLowerCase(),
    'REPORT_DIRECTORY_MISMATCH');
  for (let directory = REPORT_DIR; ; directory = path.dirname(directory)) {
    check(!(await fs.lstat(directory)).isSymbolicLink(), 'REPORT_REPARSE_DENIED');
    if (path.dirname(directory) === directory) break;
  }
  const sourceHashes = Object.fromEntries(await Promise.all(Object.keys(SOURCE_HASHES).map(async file =>
    [file, hash(await checkedFile(path.join(ROOT, file)))])));
  check(equal(sourceHashes, SOURCE_HASHES), 'SOURCE_HASH_MISMATCH');
  await verifyCheckout(ROOT);
  const apiBytes = await checkedFile(path.join(REPORT_DIR, 'api-cases-receipt.json'));
  const scopeBytes = await checkedFile(path.join(REPORT_DIR, 'fixture-scope.actual.json'));
  const context = validatePublicEvidence({ sourceHashes,
    manifestText: (await checkedFile(path.join(REPORT_DIR, 'fixture-manifest.prepared.json'))).toString('utf8'),
    usersCreated: await readJsonFile(path.join(REPORT_DIR, 'users-created.json')),
    application: await readJsonFile(path.join(REPORT_DIR, 'application-receipt.json')),
    seed: await readJsonFile(path.join(REPORT_DIR, 'fixture-seed-receipt.json')),
    sqlHash: hash(await checkedFile(path.join(REPORT_DIR, '22-proposed-auth-boundary-apply.sql'))),
    apiReport: JSON.parse(apiBytes), apiHash: hash(apiBytes), scope: JSON.parse(scopeBytes), scopeHash: hash(scopeBytes),
    publicConfig: await readJsonFile(publicKeyFile),
  });
  for (const file of Object.values(FILES)) await assertAbsent(file);
  // Exclusive result creation prevents concurrent harness runs; never automatically delete it.
  await fs.writeFile(FILES.result, JSON.stringify({ status: 'PUBLIC_GATES_PASSED_PRIVATE_CHECK_PENDING',
    projectRef: PROJECT_REF, runId: RUN_ID }) + '\n', { flag: 'wx', mode: 0o600 });
  let credentials, state;
  try {
    await assertPrivateDirectory(PRIVATE_DIR);
    state = await readJsonFile(path.join(PRIVATE_DIR, 'worker-state.json'));
    credentials = await readJsonFile(path.join(PRIVATE_DIR, 'accounts.json'));
    return await runVerification({ context, credentials, state,
      createAdapter: () => createPublicAdapter(context.publicKey),
      readBarrier: () => readJsonFile(FILES.barrier, true),
      writeReady: ready => writeJsonAtomic(FILES.ready, ready),
      writeReport: report => writeJsonAtomic(FILES.result, report),
    });
  } catch (error) {
    await writeJsonAtomic(FILES.result, { status: 'STOPPED_NOT_VERIFIED', projectRef: PROJECT_REF,
      runId: RUN_ID, failureCode: safeCode(error) }).catch(() => {});
    throw error;
  } finally {
    for (const account of credentials?.accounts ?? []) account.password = '';
    if (state) state.ownershipNonce = '';
    credentials = null; state = null; context.publicKey = '';
  }
}

export function parseArguments(args) {
  check(args.length === 3 && args[0] === '--execute-approved-cleanup-verification' &&
    args[1] === '--public-key-file' && typeof args[2] === 'string', 'EXPLICIT_EXECUTION_FLAG_AND_PUBLIC_KEY_FILE_REQUIRED');
  return args[2];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await executeApprovedVerification(parseArguments(process.argv.slice(2)));
    process.stdout.write(JSON.stringify({ status: report.status, verificationId: report.verificationId,
      projectRef: PROJECT_REF, runId: RUN_ID }) + '\n');
    if (report.status !== 'NINE_REFRESH_REJECTIONS_VERIFIED_OLD_ACCESS_REPORTED') process.exitCode = 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'STOPPED_NOT_VERIFIED', code: safeCode(error) }) + '\n');
    process.exitCode = 1;
  }
}
