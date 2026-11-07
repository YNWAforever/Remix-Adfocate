# Focused Refresh-Replay Runbook

This runbook covers one disposable Auth session and one replay attempt after an approved session cleanup. It does not authorize an Auth, database, provider, network, or production action. A PASS requires all of the following:

- The injected `revoke` effect banned or revoked the exact disposable target and observed the actual cleanup barrier.
- The captured old refresh token was submitted exactly once.
- The response was an explicit Auth rejection at HTTP 400, 401, or 403 with an allow-listed Auth code.
- The independent cleanup readback returned `EXACT_CLEANUP_VERIFIED` for the same project, run, owner, and session.

Old access-token behavior is recorded separately. It is not used to prove refresh rejection. A JWT claim decoded from token bytes is not identity proof.

## Required Restore Point

Before a later live run, identify the exact Supabase project and confirm that its restore point is available and fresh. Read the pre-change baseline and store the restore-point reference in the private execution record. Abort if the project, baseline, restore point, window, or owner approval differs from the approved packet.

Use a new disposable run ID and a new session. Do not reuse the D1 `RUN_ID`, D1's nine accounts, or any existing user's session.

## Approved IDs And SQL

The live approval packet must contain:

- Supabase project reference and environment.
- Disposable run ID, alias, Auth owner ID, and session ID.
- Exact fixture-create and cleanup SQL, each with a SHA-256 checksum.
- Exact read-only SQL for the cleanup barrier and post-cleanup readback.
- The approved test window and restore-point reference.
- A statement of every row or Auth object the SQL may create or remove.

The cleanup readback must prove that this owner's session, refresh credential, and test content are absent. Confirm that unrelated rows and sessions are unchanged. Record the query checksum and a normalized readback result without credentials or token bytes.

## Private Secret Handling

Keep the old access token and old refresh token only in process memory after capture. Do not put them in command-line arguments, environment variables, URLs, logs, exception text, SQL, receipts, screenshots, or source control. Do not serialize the effect responses. The verifier returns a sanitized receipt and replaces its session token references with empty strings after the run; JavaScript cannot guarantee physical memory erasure.

The receipt may contain only:

- Alias, project reference, and disposable run ID.
- ISO timestamps for the run phases.
- Outcome codes, refresh status class, HTTP status, and Auth code when explicitly allow-listed.
- SHA-256 references for owner and session IDs.
- Separate old-access status.
- Cleanup barrier and exact-cleanup state.

## Injected Effect Contract

`runFocusedReplay({ session, revoke, refresh, readOldAccess, verifyCleanup, now })` performs no network or file action itself. Importing the module is inert.

The session input is:

```js
{
  alias: string,
  projectRef: string,
  runId: string,
  ownerId: UUID,
  sessionId: UUID,
  accessToken: string,
  refreshToken: string,
  issuedAt: ISO-8601 string,
  expiresAt: ISO-8601 string
}
```

`revoke(target)` runs before the barrier. It must ban or revoke the exact approved target, wait for the cleanup system's actual session barrier, and return:

```js
{
  status: "CLEANUP_BARRIER_OBSERVED",
  alias,
  projectRef,
  runId,
  ownerId,
  sessionId,
  observedAt
}
```

The IDs come from the approved fixture and the authoritative cleanup observation, not from JWT claims. A timeout must reject with `code: "CLEANUP_BARRIER_TIMEOUT"`. Any rejection, timeout, missing barrier, wrong ID, or malformed timestamp is non-PASS, and the refresh token is not submitted.

`refresh({ alias, projectRef, runId, ownerId, sessionId, refreshToken })` makes one request and returns a response shape accepted by `classifyRefresh`. It must not add retries. If it throws, the result is transport-inconclusive.

`readOldAccess({ alias, projectRef, runId, ownerId, sessionId, accessToken })` records old access separately and returns one of:

```js
{ status: "OWN_ROWS_VISIBLE", httpStatus: 200, alias, projectRef, runId,
  ownerId, sessionId, rowCount }

{ status: "NO_VISIBLE_OWN_ROWS", httpStatus: 200, alias, projectRef, runId,
  ownerId, sessionId, rowCount: 0 }

{ status: "HTTP_REJECTED", httpStatus: 401 or 403 }
```

For a successful read, the injected evidence adapter must independently establish the owner and session IDs. The verifier hashes those observations and does not decode or trust JWT claims. A wrong owner, wrong session, wrong project/run, transport failure, or unknown response cannot pass.

`verifyCleanup(target)` performs the separately approved cleanup readback and returns:

```js
{
  status: "EXACT_CLEANUP_VERIFIED",
  alias,
  projectRef,
  runId,
  ownerId,
  sessionId,
  verifiedAt
}
```

It returns `{ status: "EXACT_CLEANUP_NOT_VERIFIED" }` when the approved readback proves cleanup did not match. Any exception or unknown response is inconclusive.

Evidence must satisfy this chronology using timestamps read from the same injected
clock:

```text
startedAt <= barrier.observedAt <= refreshSubmittedAt
          <= cleanup.verifiedAt <= finishedAt
```

A stale or future barrier is `INCONCLUSIVE_CLEANUP_BARRIER` and stops before the
refresh token is submitted. A stale or future cleanup timestamp is
`INCONCLUSIVE_CLEANUP`. Any backward movement in the injected execution clock is
`INCONCLUSIVE_EVIDENCE_CHRONOLOGY`.

## Outcomes

- `PASS_REPLAY_REJECTED_AND_CLEANUP_VERIFIED`: explicit Auth rejection plus exact cleanup.
- `FAIL_REFRESH_REPLAY_ACCEPTED`: any 2xx refresh response. This remains FAIL even if cleanup later succeeds.
- `FAIL_UNEXPECTED_TARGET_IDENTITY`: barrier, cleanup, or successful old-access observation names another owner or session.
- `FAIL_CLEANUP_NOT_EXACT`: cleanup readback explicitly failed.
- `INCONCLUSIVE_CLEANUP_BARRIER`: barrier timeout, exception, wrong state, or malformed receipt.
- `INCONCLUSIVE_EVIDENCE_CHRONOLOGY`: injected clock movement or evidence ordering is inconsistent.
- `INCONCLUSIVE_REFRESH`: transport, timeout, unknown status, or unrecognized Auth error.
- `INCONCLUSIVE_OLD_ACCESS`: old access could not be classified; refresh evidence is kept separate.
- `INCONCLUSIVE_CLEANUP`: cleanup verification threw or returned an unknown result.
- `INCONCLUSIVE_INPUT`: the target session or injected interface is invalid.

No timeout, unknown error, stale or future evidence, reversed clock, empty response,
generic 4xx/5xx, decoded JWT claim, or successful local test is a PASS.

## Verification

From the worktree root, run:

```powershell
node --test scripts/integrations/verify-refresh-replay.test.mjs
node --test scripts/integrations/verify-refresh-replay.test.mjs scripts/integrations/verify-auth-pilot-cleanup.test.mjs
```

The first command proves the offline verifier suite. The second also proves the frozen D1 classifier regression suite. Neither command performs an Auth, database, provider, or network request.
