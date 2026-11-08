import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { classifyRefresh, runFocusedReplay } from './verify-refresh-replay.mjs';

const NOW = Date.parse('2026-11-04T08:00:00Z');
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_OWNER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_SESSION_ID = '44444444-4444-4444-8444-444444444444';
const PROJECT_REF = 'task4-disposable-project';
const RUN_ID = 'task4-refresh-replay-20261104';
const ALIAS = 'TASK4-FOCUSED-SESSION';
const ACCESS_TOKEN = 'old-access-token-private-value';
const REFRESH_TOKEN = 'old-refresh-token-private-value';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function sequenceNow(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function makeSession(overrides = {}) {
  return {
    alias: ALIAS,
    projectRef: PROJECT_REF,
    runId: RUN_ID,
    ownerId: OWNER_ID,
    sessionId: SESSION_ID,
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    issuedAt: new Date(NOW - 60000).toISOString(),
    expiresAt: new Date(NOW + 3600000).toISOString(),
    ...overrides,
  };
}

function target(session) {
  return {
    alias: session.alias,
    projectRef: session.projectRef,
    runId: session.runId,
    ownerId: session.ownerId,
    sessionId: session.sessionId,
  };
}

function makeEffects(session, overrides = {}) {
  const calls = [];
  let clock = NOW;
  const effects = {
    now: () => clock,
    revoke: async command => {
      calls.push(['revoke', command]);
      clock += 1000;
      return {
        status: 'CLEANUP_BARRIER_OBSERVED',
        ...target(session),
        observedAt: new Date(clock).toISOString(),
      };
    },
    refresh: async command => {
      calls.push(['refresh', command]);
      return { status: 400, data: { error_code: 'refresh_token_not_found' } };
    },
    readOldAccess: async command => {
      calls.push(['readOldAccess', command]);
      return {
        status: 'OWN_ROWS_VISIBLE',
        httpStatus: 200,
        ...target(session),
        rowCount: 1,
      };
    },
    verifyCleanup: async command => {
      calls.push(['verifyCleanup', command]);
      clock += 1000;
      return {
        status: 'EXACT_CLEANUP_VERIFIED',
        ...target(session),
        verifiedAt: new Date(clock).toISOString(),
      };
    },
    ...overrides,
  };
  return { effects, calls };
}

test('classifier preserves the frozen D1 refresh behavior', () => {
  for (const status of [400, 401, 403]) {
    assert.deepEqual(classifyRefresh({
      status,
      data: { error_code: 'refresh_token_not_found', message: 'not persisted' },
    }), {
      status: 'REJECTED_EXPLICIT_AUTH_ERROR',
      httpStatus: status,
      authCode: 'refresh_token_not_found',
    });
  }
  assert.deepEqual(classifyRefresh({
    status: 400,
    data: {
      error: 'invalid_grant',
      error_description: 'Invalid Refresh Token: Already Used',
    },
  }), {
    status: 'REJECTED_EXPLICIT_AUTH_ERROR',
    httpStatus: 400,
    authCode: 'legacy_invalid_grant',
  });
  for (const status of [200, 201, 204]) {
    assert.deepEqual(classifyRefresh({ status, data: {} }), {
      status: 'FAIL_REFRESH_ACCEPTED',
      httpStatus: status,
    });
  }
  assert.deepEqual(classifyRefresh({ transportError: true }), {
    status: 'INCONCLUSIVE_TRANSPORT',
    httpStatus: null,
  });
  assert.deepEqual(classifyRefresh({
    status: 503,
    data: { error_code: 'unknown_failure', message: 'secret diagnostic' },
  }), {
    status: 'INCONCLUSIVE_RESPONSE',
    httpStatus: 503,
  });
  assert.deepEqual(classifyRefresh({ status: 400, data: null }), {
    status: 'INCONCLUSIVE_RESPONSE',
    httpStatus: 400,
  });
});

test('rejected replay passes only after one refresh and exact cleanup readback', async () => {
  const session = makeSession();
  const fixture = makeEffects(session);
  const receipt = await runFocusedReplay({ session, ...fixture.effects });

  assert.equal(receipt.status, 'PASS_REPLAY_REJECTED_AND_CLEANUP_VERIFIED');
  assert.equal(receipt.alias, ALIAS);
  assert.equal(receipt.projectRef, PROJECT_REF);
  assert.equal(receipt.runId, RUN_ID);
  assert.equal(receipt.ownerIdSha256, sha256(OWNER_ID));
  assert.equal(receipt.sessionIdSha256, sha256(SESSION_ID));
  assert.equal(receipt.identityBasis, 'INJECTED_EFFECT_IDENTITY_MATCH_ONLY');
  assert.equal(receipt.refresh.status, 'REJECTED_EXPLICIT_AUTH_ERROR');
  assert.equal(receipt.refresh.httpStatus, 400);
  assert.equal(receipt.oldAccess.status, 'OWN_ROWS_VISIBLE');
  assert.equal(receipt.oldAccess.httpStatus, 200);
  assert.equal(receipt.cleanup.revokeBarrier, 'OBSERVED');
  assert.equal(receipt.cleanup.exactCleanup, 'VERIFIED');
  assert.deepEqual(receipt.outcomeCodes, [
    'TARGET_INPUT_VALIDATED',
    'REVOKE_CLEANUP_BARRIER_OBSERVED',
    'REFRESH_REJECTED_EXPLICIT_AUTH_ERROR',
    'OLD_ACCESS_OWN_ROWS_VISIBLE',
    'EXACT_CLEANUP_VERIFIED',
  ]);
  assert.equal(receipt.revokeBarrierObservedAt, new Date(NOW + 1000).toISOString());
  assert.equal(receipt.refreshSubmittedAt, new Date(NOW + 1000).toISOString());
  assert.equal(receipt.cleanupVerifiedAt, new Date(NOW + 2000).toISOString());
  assert.equal(receipt.finishedAt, new Date(NOW + 2000).toISOString());
  assert.ok(Date.parse(receipt.startedAt) <= Date.parse(receipt.revokeBarrierObservedAt));
  assert.ok(Date.parse(receipt.revokeBarrierObservedAt) <= Date.parse(receipt.refreshSubmittedAt));
  assert.ok(Date.parse(receipt.refreshSubmittedAt) <= Date.parse(receipt.cleanupVerifiedAt));
  assert.ok(Date.parse(receipt.cleanupVerifiedAt) <= Date.parse(receipt.finishedAt));
  assert.deepEqual(fixture.calls.map(call => call[0]), [
    'revoke',
    'refresh',
    'readOldAccess',
    'verifyCleanup',
  ]);
  assert.equal(fixture.calls.filter(call => call[0] === 'refresh').length, 1);
  assert.equal(fixture.calls[1][1].refreshToken, REFRESH_TOKEN);
  assert.equal(fixture.calls[2][1].accessToken, ACCESS_TOKEN);
  assert.equal(session.accessToken, '');
  assert.equal(session.refreshToken, '');
});

test('stale, future, or reversed barrier evidence stops before refresh', async () => {
  const cases = [
    {
      name: 'stale',
      now: () => NOW,
      observedAt: new Date(NOW - 1000).toISOString(),
      expectedStatus: 'INCONCLUSIVE_CLEANUP_BARRIER',
      expectedBarrier: 'INCONCLUSIVE',
    },
    {
      name: 'future',
      now: () => NOW,
      observedAt: new Date(NOW + 1000).toISOString(),
      expectedStatus: 'INCONCLUSIVE_CLEANUP_BARRIER',
      expectedBarrier: 'INCONCLUSIVE',
    },
    {
      name: 'reversed',
      now: sequenceNow(NOW, NOW + 500),
      observedAt: new Date(NOW + 1000).toISOString(),
      expectedStatus: 'INCONCLUSIVE_EVIDENCE_CHRONOLOGY',
      expectedBarrier: 'OBSERVED',
    },
  ];

  for (const scenario of cases) {
    const session = makeSession();
    const fixture = makeEffects(session, {
      now: scenario.now,
      revoke: async command => {
        fixture.calls.push(['revoke', command]);
        return {
          status: 'CLEANUP_BARRIER_OBSERVED',
          ...target(session),
          observedAt: scenario.observedAt,
        };
      },
    });
    const receipt = await runFocusedReplay({ session, ...fixture.effects });

    assert.equal(receipt.status, scenario.expectedStatus, scenario.name);
    assert.equal(receipt.cleanup.revokeBarrier, scenario.expectedBarrier, scenario.name);
    assert.equal(receipt.cleanup.exactCleanup, 'NOT_RUN', scenario.name);
    assert.equal(fixture.calls.filter(call => call[0] === 'refresh').length, 0, scenario.name);
    assert.equal(fixture.calls.filter(call => call[0] === 'verifyCleanup').length, 0, scenario.name);
  }
});

test('stale or reversed cleanup evidence is inconclusive after exactly one refresh', async () => {
  const cases = [
    {
      name: 'stale',
      verifiedAt: new Date(NOW + 500).toISOString(),
    },
    {
      name: 'future',
      verifiedAt: new Date(NOW + 3000).toISOString(),
    },
    {
      name: 'reversed',
      verifiedAt: new Date(NOW + 500).toISOString(),
      now: sequenceNow(NOW, NOW + 1000, NOW + 2500),
    },
  ];

  for (const scenario of cases) {
    const session = makeSession();
    const fixture = makeEffects(session, {
      ...(scenario.now ? { now: scenario.now } : {}),
      verifyCleanup: async command => {
        fixture.calls.push(['verifyCleanup', command]);
        return {
          status: 'EXACT_CLEANUP_VERIFIED',
          ...target(session),
          verifiedAt: scenario.verifiedAt,
        };
      },
    });
    const receipt = await runFocusedReplay({ session, ...fixture.effects });

    assert.equal(receipt.status, 'INCONCLUSIVE_CLEANUP', scenario.name);
    assert.equal(receipt.refresh.status, 'REJECTED_EXPLICIT_AUTH_ERROR', scenario.name);
    assert.equal(receipt.cleanup.exactCleanup, 'INCONCLUSIVE', scenario.name);
    assert.equal(fixture.calls.filter(call => call[0] === 'refresh').length, 1, scenario.name);
    assert.equal(fixture.calls.filter(call => call[0] === 'verifyCleanup').length, 1, scenario.name);
  }
});

test('injected clock reversal after the barrier is inconclusive', async () => {
  const session = makeSession();
  const fixture = makeEffects(session, {
    now: sequenceNow(NOW, NOW + 500, NOW + 2500, NOW + 2000),
  });
  const receipt = await runFocusedReplay({ session, ...fixture.effects });

  assert.equal(receipt.status, 'INCONCLUSIVE_EVIDENCE_CHRONOLOGY');
  assert.equal(receipt.cleanup.revokeBarrier, 'OBSERVED');
  assert.equal(receipt.cleanup.exactCleanup, 'NOT_RUN');
  assert.equal(fixture.calls.filter(call => call[0] === 'refresh').length, 0);
});

test('unexpected refresh remains failed after successful cleanup and leaks no response secrets', async () => {
  const session = makeSession();
  const fixture = makeEffects(session, {
    refresh: async command => {
      fixture.calls.push(['refresh', command]);
      return {
        status: 200,
        data: {
          access_token: 'accepted-access-token-private-value',
          refresh_token: 'accepted-refresh-token-private-value',
          user: { id: OWNER_ID, private_field: 'accepted-user-private-value' },
        },
      };
    },
    readOldAccess: async command => {
      fixture.calls.push(['readOldAccess', command]);
      return {
        status: 'OWN_ROWS_VISIBLE',
        httpStatus: 200,
        ...target(session),
        privateRow: 'old-access-private-value',
      };
    },
  });
  const receipt = await runFocusedReplay({ session, ...fixture.effects });
  const serialized = JSON.stringify(receipt);

  assert.equal(receipt.status, 'FAIL_REFRESH_REPLAY_ACCEPTED');
  assert.equal(receipt.refresh.status, 'FAIL_REFRESH_ACCEPTED');
  assert.equal(receipt.cleanup.exactCleanup, 'VERIFIED');
  assert.equal(fixture.calls.filter(call => call[0] === 'refresh').length, 1);
  for (const secret of [
    ACCESS_TOKEN,
    REFRESH_TOKEN,
    'accepted-access-token-private-value',
    'accepted-refresh-token-private-value',
    'accepted-user-private-value',
    'old-access-private-value',
    OWNER_ID,
    SESSION_ID,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('barrier timeout and unknown revoke errors stop before replay and never pass', async () => {
  for (const [thrown, expectedCode] of [
    [Object.assign(new Error('private timeout details'), { code: 'CLEANUP_BARRIER_TIMEOUT' }),
      'CLEANUP_BARRIER_TIMEOUT'],
    [new Error('private unknown details'), 'REVOKE_EFFECT_ERROR'],
  ]) {
    const session = makeSession();
    const fixture = makeEffects(session, { revoke: async () => { throw thrown; } });
    const receipt = await runFocusedReplay({ session, ...fixture.effects });

    assert.equal(receipt.status, 'INCONCLUSIVE_CLEANUP_BARRIER');
    assert.equal(receipt.cleanup.revokeBarrier, 'INCONCLUSIVE');
    assert.equal(receipt.cleanup.exactCleanup, 'NOT_RUN');
    assert.ok(receipt.outcomeCodes.includes(expectedCode));
    assert.equal(fixture.calls.length, 0);
    assert.equal(JSON.stringify(receipt).includes('private'), false);
  }
});

test('wrong revoke barrier owner or session is an explicit identity failure without replay', async () => {
  for (const changed of [
    session => ({ ...target(session), ownerId: OTHER_OWNER_ID }),
    session => ({ ...target(session), sessionId: OTHER_SESSION_ID }),
  ]) {
    const session = makeSession();
    const fixture = makeEffects(session, {
      revoke: async command => {
        fixture.calls.push(['revoke', command]);
        return {
          status: 'CLEANUP_BARRIER_OBSERVED',
          ...changed(session),
          observedAt: new Date(NOW + 1000).toISOString(),
        };
      },
    });
    const receipt = await runFocusedReplay({ session, ...fixture.effects });

    assert.equal(receipt.status, 'FAIL_UNEXPECTED_TARGET_IDENTITY');
    assert.equal(receipt.cleanup.exactCleanup, 'NOT_RUN');
    assert.equal(fixture.calls.filter(call => call[0] === 'refresh').length, 0);
    assert.equal(JSON.stringify(receipt).includes(OTHER_OWNER_ID), false);
    assert.equal(JSON.stringify(receipt).includes(OTHER_SESSION_ID), false);
  }
});

test('old access is separate evidence and wrong owner or session fails the receipt', async () => {
  for (const changed of [
    session => ({ ...target(session), ownerId: OTHER_OWNER_ID }),
    session => ({ ...target(session), sessionId: OTHER_SESSION_ID }),
  ]) {
    const session = makeSession();
    const fixture = makeEffects(session, {
      readOldAccess: async command => {
        fixture.calls.push(['readOldAccess', command]);
        return {
          status: 'OWN_ROWS_VISIBLE',
          httpStatus: 200,
          ...changed(session),
        };
      },
    });
    const receipt = await runFocusedReplay({ session, ...fixture.effects });

    assert.equal(receipt.status, 'FAIL_UNEXPECTED_TARGET_IDENTITY');
    assert.equal(receipt.refresh.status, 'REJECTED_EXPLICIT_AUTH_ERROR');
    assert.equal(receipt.oldAccess.status, 'FAIL_UNEXPECTED_ACCESS_IDENTITY');
    assert.equal(fixture.calls.filter(call => call[0] === 'refresh').length, 1);
    assert.equal(fixture.calls.filter(call => call[0] === 'verifyCleanup').length, 1);
  }
});

test('transport and unknown refresh responses are inconclusive with exactly one request', async () => {
  for (const [refreshEffect, expectedStatus] of [
    [async () => { throw new Error('private transport diagnostic'); }, 'INCONCLUSIVE_TRANSPORT'],
    [async () => ({ status: 500, data: { message: 'private server diagnostic' } }),
      'INCONCLUSIVE_RESPONSE'],
  ]) {
    const session = makeSession();
    const fixture = makeEffects(session, {
      refresh: async command => {
        fixture.calls.push(['refresh', command]);
        return refreshEffect();
      },
    });
    const receipt = await runFocusedReplay({ session, ...fixture.effects });

    assert.equal(receipt.status, 'INCONCLUSIVE_REFRESH');
    assert.equal(receipt.refresh.status, expectedStatus);
    assert.equal(fixture.calls.filter(call => call[0] === 'refresh').length, 1);
    assert.equal(JSON.stringify(receipt).includes('private'), false);
  }
});

test('explicit cleanup failure fails and cleanup exceptions remain inconclusive', async () => {
  for (const [verifyCleanup, expectedStatus, expectedCleanup] of [
    [async () => ({ status: 'EXACT_CLEANUP_NOT_VERIFIED' }),
      'FAIL_CLEANUP_NOT_EXACT', 'NOT_VERIFIED'],
    [async () => { throw new Error('private cleanup diagnostic'); },
      'INCONCLUSIVE_CLEANUP', 'INCONCLUSIVE'],
  ]) {
    const session = makeSession();
    let cleanupCalls = 0;
    const fixture = makeEffects(session, {
      verifyCleanup: async command => {
        cleanupCalls++;
        return verifyCleanup(command);
      },
    });
    const receipt = await runFocusedReplay({ session, ...fixture.effects });

    assert.equal(receipt.status, expectedStatus);
    assert.equal(receipt.refresh.status, 'REJECTED_EXPLICIT_AUTH_ERROR');
    assert.equal(receipt.cleanup.exactCleanup, expectedCleanup);
    assert.equal(cleanupCalls, 1);
    assert.equal(JSON.stringify(receipt).includes('private'), false);
  }
});

test('invalid target input starts no effect and still returns a sanitized receipt', async () => {
  const session = makeSession({ sessionId: 'not-a-session-id' });
  const fixture = makeEffects(session);
  const receipt = await runFocusedReplay({ session, ...fixture.effects });

  assert.equal(receipt.status, 'INCONCLUSIVE_INPUT');
  assert.equal(receipt.cleanup.exactCleanup, 'NOT_RUN');
  assert.equal(fixture.calls.length, 0);
  assert.equal(JSON.stringify(receipt).includes(ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(receipt).includes(REFRESH_TOKEN), false);
});
