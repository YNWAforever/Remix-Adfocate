import { createHash } from 'node:crypto';
import { classifyRefresh as frozenClassifyRefresh } from './verify-auth-pilot-cleanup.mjs';

export { classifyRefresh } from './verify-auth-pilot-cleanup.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const TOKEN_LIMIT = 8192;
const TARGET_FIELDS = ['alias', 'projectRef', 'runId', 'ownerId', 'sessionId'];
const IDENTITY_BASIS = 'INJECTED_EFFECT_IDENTITY_MATCH_ONLY';

const isText = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const isToken = value => typeof value === 'string' && value.length > 0 && value.length <= TOKEN_LIMIT;
const isTimestamp = value => typeof value === 'string' && ISO_TIMESTAMP.test(value) &&
  Number.isFinite(Date.parse(value));
const sha256 = value => isText(value) ? createHash('sha256').update(value).digest('hex') : null;
const utc = value => new Date(value).toISOString();
const addOutcome = (receipt, code) => {
  if (!receipt.outcomeCodes.includes(code)) receipt.outcomeCodes.push(code);
};

function contextFor(session) {
  return Object.fromEntries(TARGET_FIELDS.map(field => [field, session[field]]));
}

function exactTarget(observation, session) {
  return observation && TARGET_FIELDS.every(field => observation[field] === session[field]);
}

function baseReceipt(session) {
  return {
    status: 'INCONCLUSIVE_INPUT',
    alias: isText(session?.alias) ? session.alias : null,
    projectRef: isText(session?.projectRef) ? session.projectRef : null,
    runId: isText(session?.runId) ? session.runId : null,
    ownerIdSha256: sha256(session?.ownerId),
    sessionIdSha256: sha256(session?.sessionId),
    identityBasis: IDENTITY_BASIS,
    startedAt: null,
    revokeBarrierObservedAt: null,
    refreshSubmittedAt: null,
    cleanupVerifiedAt: null,
    finishedAt: null,
    outcomeCodes: [],
    refresh: null,
    oldAccess: null,
    cleanup: {
      revokeBarrier: 'NOT_RUN',
      exactCleanup: 'NOT_RUN',
    },
  };
}

function validSession(session, currentTime) {
  return session && isText(session.alias) && isText(session.projectRef) && isText(session.runId) &&
    UUID.test(session.ownerId ?? '') && UUID.test(session.sessionId ?? '') &&
    isToken(session.accessToken) && isToken(session.refreshToken) &&
    session.accessToken !== session.refreshToken && isTimestamp(session.issuedAt) &&
    isTimestamp(session.expiresAt) &&
    Date.parse(session.issuedAt) <= currentTime &&
    Date.parse(session.expiresAt) > currentTime;
}

function classifyOldAccess(session, response) {
  if (!response || response.transportError) {
    return { status: 'INCONCLUSIVE_TRANSPORT', httpStatus: null };
  }
  if (response.status === 'HTTP_REJECTED') {
    return {
      status: [401, 403].includes(response.httpStatus) ? 'HTTP_REJECTED' : 'INCONCLUSIVE_RESPONSE',
      httpStatus: Number.isInteger(response.httpStatus) ? response.httpStatus : null,
    };
  }
  if (!['OWN_ROWS_VISIBLE', 'NO_VISIBLE_OWN_ROWS'].includes(response.status)) {
    return {
      status: 'INCONCLUSIVE_RESPONSE',
      httpStatus: Number.isInteger(response.httpStatus) ? response.httpStatus : null,
    };
  }
  const identity = {
    ownerIdSha256: sha256(response.ownerId),
    sessionIdSha256: sha256(response.sessionId),
  };
  if (identity.ownerIdSha256 === null || identity.sessionIdSha256 === null) {
    return {
      status: 'INCONCLUSIVE_RESPONSE',
      httpStatus: Number.isInteger(response.httpStatus) ? response.httpStatus : null,
      ...identity,
    };
  }
  if (!exactTarget(response, session)) {
    return {
      status: 'FAIL_UNEXPECTED_ACCESS_IDENTITY',
      httpStatus: Number.isInteger(response.httpStatus) ? response.httpStatus : null,
      ...identity,
    };
  }
  return {
    status: response.status,
    httpStatus: Number.isInteger(response.httpStatus) ? response.httpStatus : null,
    count: Number.isInteger(response.rowCount) && response.rowCount >= 0 ? response.rowCount : null,
    ...identity,
  };
}

function refreshOutcomeCode(status) {
  if (status === 'REJECTED_EXPLICIT_AUTH_ERROR') return 'REFRESH_REJECTED_EXPLICIT_AUTH_ERROR';
  if (status === 'FAIL_REFRESH_ACCEPTED') return 'REFRESH_ACCEPTED_UNEXPECTEDLY';
  if (status === 'INCONCLUSIVE_TRANSPORT') return 'REFRESH_INCONCLUSIVE_TRANSPORT';
  return 'REFRESH_INCONCLUSIVE_RESPONSE';
}

function oldAccessOutcomeCode(status) {
  if (status === 'OWN_ROWS_VISIBLE') return 'OLD_ACCESS_OWN_ROWS_VISIBLE';
  if (status === 'NO_VISIBLE_OWN_ROWS') return 'OLD_ACCESS_NO_VISIBLE_OWN_ROWS';
  if (status === 'HTTP_REJECTED') return 'OLD_ACCESS_HTTP_REJECTED';
  if (status === 'FAIL_UNEXPECTED_ACCESS_IDENTITY') return 'OLD_ACCESS_IDENTITY_MISMATCH';
  if (status === 'INCONCLUSIVE_TRANSPORT') return 'OLD_ACCESS_INCONCLUSIVE_TRANSPORT';
  return 'OLD_ACCESS_INCONCLUSIVE_RESPONSE';
}

function deriveStatus(receipt) {
  if (receipt.outcomeCodes.includes('TARGET_IDENTITY_MISMATCH') ||
      receipt.outcomeCodes.includes('OLD_ACCESS_IDENTITY_MISMATCH')) {
    return 'FAIL_UNEXPECTED_TARGET_IDENTITY';
  }
  if (receipt.refresh?.status === 'FAIL_REFRESH_ACCEPTED') return 'FAIL_REFRESH_REPLAY_ACCEPTED';
  if (receipt.cleanup.exactCleanup === 'NOT_VERIFIED') return 'FAIL_CLEANUP_NOT_EXACT';
  if (receipt.outcomeCodes.includes('EVIDENCE_CLOCK_REVERSED')) {
    return 'INCONCLUSIVE_EVIDENCE_CHRONOLOGY';
  }
  if (receipt.cleanup.exactCleanup !== 'VERIFIED') return 'INCONCLUSIVE_CLEANUP';
  if (receipt.refresh?.status === 'INCONCLUSIVE_TRANSPORT' ||
      receipt.refresh?.status === 'INCONCLUSIVE_RESPONSE') return 'INCONCLUSIVE_REFRESH';
  if (receipt.oldAccess?.status === 'INCONCLUSIVE_TRANSPORT' ||
      receipt.oldAccess?.status === 'INCONCLUSIVE_RESPONSE') return 'INCONCLUSIVE_OLD_ACCESS';
  if (receipt.refresh?.status === 'REJECTED_EXPLICIT_AUTH_ERROR') {
    return 'PASS_REPLAY_REJECTED_AND_CLEANUP_VERIFIED';
  }
  return 'INCONCLUSIVE_REFRESH';
}

export async function runFocusedReplay({
  session,
  revoke,
  refresh,
  readOldAccess,
  verifyCleanup,
  now = Date.now,
}) {
  const receipt = baseReceipt(session);
  let refreshResponse = null;
  let oldAccessResponse = null;
  let cleanupResponse = null;

  try {
    const startedAt = now();
    receipt.startedAt = utc(startedAt);
    if (!validSession(session, startedAt) || [revoke, refresh, readOldAccess, verifyCleanup]
      .some(effect => typeof effect !== 'function')) {
      addOutcome(receipt, 'INVALID_TARGET_INPUT');
      return receipt;
    }
    addOutcome(receipt, 'TARGET_INPUT_VALIDATED');
    const target = contextFor(session);

    let barrier;
    try {
      barrier = await revoke(target);
    } catch (error) {
      receipt.cleanup.revokeBarrier = 'INCONCLUSIVE';
      addOutcome(receipt, error?.code === 'CLEANUP_BARRIER_TIMEOUT'
        ? 'CLEANUP_BARRIER_TIMEOUT' : 'REVOKE_EFFECT_ERROR');
      receipt.status = 'INCONCLUSIVE_CLEANUP_BARRIER';
      return receipt;
    }

    if (barrier?.status !== 'CLEANUP_BARRIER_OBSERVED' || !isTimestamp(barrier.observedAt)) {
      receipt.cleanup.revokeBarrier = 'INCONCLUSIVE';
      addOutcome(receipt, 'CLEANUP_BARRIER_NOT_OBSERVED');
      receipt.status = 'INCONCLUSIVE_CLEANUP_BARRIER';
      return receipt;
    }
    if (!exactTarget(barrier, session)) {
      receipt.cleanup.revokeBarrier = 'NOT_VERIFIED';
      addOutcome(receipt, 'TARGET_IDENTITY_MISMATCH');
      receipt.status = 'FAIL_UNEXPECTED_TARGET_IDENTITY';
      return receipt;
    }
    const startedAtTime = Date.parse(receipt.startedAt);
    const barrierTime = Date.parse(barrier.observedAt);
    if (barrierTime < startedAtTime) {
      receipt.cleanup.revokeBarrier = 'INCONCLUSIVE';
      addOutcome(receipt, 'CLEANUP_BARRIER_PRECEDES_START');
      receipt.status = 'INCONCLUSIVE_CLEANUP_BARRIER';
      return receipt;
    }
    receipt.cleanup.revokeBarrier = 'OBSERVED';
    receipt.revokeBarrierObservedAt = barrier.observedAt;
    addOutcome(receipt, 'REVOKE_CLEANUP_BARRIER_OBSERVED');

    receipt.refreshSubmittedAt = utc(now());
    const refreshSubmittedTime = Date.parse(receipt.refreshSubmittedAt);
    if (refreshSubmittedTime < startedAtTime) {
      addOutcome(receipt, 'EVIDENCE_CLOCK_REVERSED');
      receipt.status = 'INCONCLUSIVE_EVIDENCE_CHRONOLOGY';
      return receipt;
    }
    if (refreshSubmittedTime < barrierTime) {
      receipt.cleanup.revokeBarrier = refreshSubmittedTime <= startedAtTime
        ? 'INCONCLUSIVE' : 'OBSERVED';
      addOutcome(receipt, refreshSubmittedTime <= startedAtTime
        ? 'CLEANUP_BARRIER_AFTER_CLOCK' : 'EVIDENCE_CLOCK_REVERSED');
      receipt.status = refreshSubmittedTime <= startedAtTime
        ? 'INCONCLUSIVE_CLEANUP_BARRIER' : 'INCONCLUSIVE_EVIDENCE_CHRONOLOGY';
      return receipt;
    }
    try {
      refreshResponse = await refresh({
        ...target,
        refreshToken: session.refreshToken,
      });
    } catch {
      refreshResponse = { transportError: true };
    }
    receipt.refresh = frozenClassifyRefresh(
      refreshResponse && typeof refreshResponse === 'object' ? refreshResponse : { status: null, data: null },
    );
    addOutcome(receipt, refreshOutcomeCode(receipt.refresh.status));
    refreshResponse = null;

    try {
      oldAccessResponse = await readOldAccess({
        ...target,
        accessToken: session.accessToken,
      });
    } catch {
      oldAccessResponse = { transportError: true };
    }
    receipt.oldAccess = classifyOldAccess(session, oldAccessResponse);
    addOutcome(receipt, oldAccessOutcomeCode(receipt.oldAccess.status));
    oldAccessResponse = null;

    try {
      cleanupResponse = await verifyCleanup(target);
    } catch {
      receipt.cleanup.exactCleanup = 'INCONCLUSIVE';
      addOutcome(receipt, 'CLEANUP_VERIFICATION_ERROR');
      cleanupResponse = null;
    }
    const finishedAtTime = now();
    receipt.finishedAt = utc(finishedAtTime);
    if (finishedAtTime < refreshSubmittedTime) {
      receipt.cleanup.exactCleanup = 'INCONCLUSIVE';
      addOutcome(receipt, 'EVIDENCE_CLOCK_REVERSED');
      cleanupResponse = null;
    }
    if (cleanupResponse) {
      if (cleanupResponse.status === 'EXACT_CLEANUP_VERIFIED') {
        const cleanupVerifiedTime = Date.parse(cleanupResponse.verifiedAt);
        if (!exactTarget(cleanupResponse, session) || !isTimestamp(cleanupResponse.verifiedAt)) {
          receipt.cleanup.exactCleanup = 'INCONCLUSIVE';
          addOutcome(receipt, exactTarget(cleanupResponse, session)
            ? 'CLEANUP_VERIFICATION_TIMESTAMP_INVALID' : 'TARGET_IDENTITY_MISMATCH');
        } else if (cleanupVerifiedTime < refreshSubmittedTime) {
          receipt.cleanup.exactCleanup = 'INCONCLUSIVE';
          addOutcome(receipt, 'CLEANUP_PRECEDES_REFRESH');
        } else if (cleanupVerifiedTime > finishedAtTime) {
          receipt.cleanup.exactCleanup = 'INCONCLUSIVE';
          addOutcome(receipt, 'CLEANUP_TIMESTAMP_AFTER_CLOCK');
        } else {
          receipt.cleanup.exactCleanup = 'VERIFIED';
          receipt.cleanupVerifiedAt = cleanupResponse.verifiedAt;
          addOutcome(receipt, 'EXACT_CLEANUP_VERIFIED');
        }
      } else if (cleanupResponse.status === 'EXACT_CLEANUP_NOT_VERIFIED') {
        receipt.cleanup.exactCleanup = 'NOT_VERIFIED';
        addOutcome(receipt, 'EXACT_CLEANUP_NOT_VERIFIED');
      } else {
        receipt.cleanup.exactCleanup = 'INCONCLUSIVE';
        addOutcome(receipt, 'CLEANUP_VERIFICATION_INCONCLUSIVE');
      }
      cleanupResponse = null;
    }

    receipt.status = deriveStatus(receipt);
    return receipt;
  } catch {
    receipt.status = 'INCONCLUSIVE_INPUT';
    addOutcome(receipt, 'VERIFIER_INTERNAL_ERROR');
    return receipt;
  } finally {
    if (session && typeof session === 'object') {
      if ('accessToken' in session) session.accessToken = '';
      if ('refreshToken' in session) session.refreshToken = '';
    }
    refreshResponse = null;
    oldAccessResponse = null;
    cleanupResponse = null;
    if (receipt.finishedAt === null) receipt.finishedAt = utc(now());
  }
}
