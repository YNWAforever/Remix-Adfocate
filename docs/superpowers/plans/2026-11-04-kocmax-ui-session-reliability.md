# KOCmax UI and Session Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the four D1 interface findings and obtain an honest, independently readable refresh-token replay result with exact disposable-account cleanup.

**Architecture:** Keep the current server authorization and D1 evidence immutable. Derive controls from server-issued staff/brand identity, make sign-out hide protected UI synchronously, and build a new focused Auth verifier instead of reviving the expired nine-account D1 harness.

**Tech Stack:** React 19, TypeScript 5.8, TanStack Router/Query, Supabase Auth, Vitest, Node test runner, Playwright.

**Spec:** [Approved Instagram growth Studio design](../specs/2026-11-03-kocmax-instagram-growth-studio-design.md), §§3, 9–10. D1 baseline: [closeout](../../review/kocmax-stage-4d/d1/D1-CLOSEOUT-20261103.md).

## Global Constraints

- Work on `codex/kocmax-studio-stages-1-2`; preserve every existing function, current D1 changes, and recent fixes. Record the dirty baseline; stage/commit only new active-task hunks and audit every staged diff.
- No production deployment, real Instagram/Drive connection, or Instagram publication. Shared-DB/Auth writes for a new replay test require a separately reviewed restore point, exact test IDs/SQL, cleanup, and explicit user approval.
- D1's nine accounts are banned/anonymized; `CLEANUP_BARRIER_TIMEOUT` and `SESSION_REVOCATION_FAILED` remain historical failures, not PASS.
- Existing API/RLS capability checks stay authoritative. UI gates must not turn 403 into a fake success or erase the distinction between same-owner refresh and identity change.
- Mobile and desktop verification targets: 320, 390, 430, and 1440px; keyboard, back/reload, and account switch. No test credential, JWT, refresh token, or email enters tracked evidence.

## Review Focus

1. Operator pastes an edit URL while access is loading: no writable control flashes (Task 1 test).
2. Brand member sees a draft that an owner may delete: member has no Delete control, owner still does (Task 2 test).
3. Staff clicks Sign out while the network request is pending or fails: protected UI disappears immediately; failure reconciles without showing stale data (Task 3 test).
4. Password-authenticated nonstaff user sees denial: it names an account rather than Google (Task 3 test).
5. Refresh request times out or receives an unknown error after revoke: result is inconclusive, and cleanup still targets only the new disposable IDs (Tasks 4–5 tests).

---

## File structure and order

| Unit | Files | Responsibility |
| --- | --- | --- |
| Staff mission view | `src/routes/admin.missions.$missionId.tsx`, `src/routes/-admin.missions.editor.test.tsx` | Prevent direct-route edit controls without `mission.manage` |
| Brand controls | `src/routes/brand.missions.index.tsx`, `src/routes/-brand.test.tsx` | Use `GET /api/brand/me` role for delete presentation; leave server DELETE rule intact |
| Sign-out state | `src/components/admin/StaffAuthGate.tsx`, `AdminAuthContext.tsx`, `AdminTopBar.tsx`, `src/routes/admin.tsx`, `src/lib/i18n.dict.ts`, `src/components/admin/StaffAuthGate.scope.test.tsx` | Immediate private-view teardown and neutral denial text |
| Replay tool | `scripts/integrations/verify-refresh-replay.mjs`, `.test.mjs`, `docs/review/kocmax-stage-5/refresh-replay-runbook.md` | New one-account, one-session verifier with injectable effects and no token logging |
| Live receipt | `docs/review/kocmax-stage-5/refresh-replay-execution.md` plus private local artifacts outside Git | Record authorized real test, exact cleanup and postconditions |

### Task 1: Staff mission edit is capability-gated at the leaf

**Files:** Modify `src/routes/admin.missions.$missionId.tsx`; Test `src/routes/-admin.missions.editor.test.tsx`.

**Interfaces:** Consume existing `useStaffAccess(): AccessContext | undefined` and `access.can("mission.manage")`; preserve `updateMission(id, { ...body, expected_updated_at })`. Produce no new API.

- [ ] **Step 1: Write failing route tests.** Assert operator direct navigation to `/admin/missions/:id` shows no `VersionedMissionEditor`/Save controls even before access resolves; `workspace_admin` with `mission.manage` sees editor; access failure shows retry/unavailable, not editor.
- [ ] **Step 2: Run the focused test and record the expected failure.** `npx vitest run src/routes/-admin.missions.editor.test.tsx` → fails on the current operator edit control.
- [ ] **Step 3: Gate the route render.** At `EditMission`, use the live staff-access context before rendering either tab. For missing/loading/error access, show a non-writable state; for `!access.can("mission.manage")`, show a plain denial and an allowed navigation link. Retain existing 409/versioned-save and unsaved-edit behavior for authorized staff.
- [ ] **Step 4: Run focused route and permission tests.** `npx vitest run src/routes/-admin.missions.editor.test.tsx src/components/admin/MissionEditor.permissions.test.tsx` → PASS.
- [ ] **Step 5: Commit only Task 1 files.** `git add -- 'src/routes/admin.missions.$missionId.tsx' 'src/routes/-admin.missions.editor.test.tsx' && git commit -m 'fix: gate direct mission edit by staff capability'`.

### Task 2: Brand Delete matches the existing owner rule

**Files:** Modify `src/routes/brand.missions.index.tsx`; Test `src/routes/-brand.test.tsx`; read-only regression `server/test/brand.test.ts`.

**Interfaces:** Consume `useBrandAuth().brand.role: "owner" | "member"`; leave `DELETE /api/brand/missions/:id` server rule and `deleteBrandMission(id)` unchanged.

- [ ] **Step 1: Write failing role tests.** With a draft mission, `member` must have no Delete button; `owner` must have it; neither role sees Delete for an active mission. Keep a server test asserting member DELETE returns 403 and owner draft DELETE remains available.
- [ ] **Step 2: Run tests to see the presentational failure.** `npx vitest run src/routes/-brand.test.tsx server/test/brand.test.ts` → member case fails on current UI.
- [ ] **Step 3: Render Delete only for `brand.role === "owner" && m.status === "draft"`.** Keep confirmation, pending state, and server error handling.
- [ ] **Step 4: Re-run those two files.** Expected: PASS with server authorization unchanged.
- [ ] **Step 5: Commit only Task 2 files.** `git add -- 'src/routes/brand.missions.index.tsx' 'src/routes/-brand.test.tsx' && git commit -m 'fix: hide brand draft delete from members'`.

### Task 3: Immediate staff sign-out and identity-neutral denial

**Files:** Modify `src/components/admin/StaffAuthGate.tsx`, `AdminAuthContext.tsx`, `AdminTopBar.tsx`, `src/routes/admin.tsx`, `src/lib/i18n.dict.ts`; Test `src/components/admin/StaffAuthGate.scope.test.tsx` and `StaffAuthGate.test.tsx`.

**Interfaces:** Change gate child signature to `children: (staff: AdminStaff, signOut: () => Promise<void>) => ReactNode`; add `signOut: () => Promise<void>` to `AdminAuth`. `AdminTopBar` calls context `signOut`. Existing `onIdentityChange` clears the React Query cache.

- [ ] **Step 1: Add failing tests.** Clicking Sign out synchronously unmounts protected children before `supabase.auth.signOut()` settles; an in-flight same-user `TOKEN_REFRESHED` cannot re-show them while sign-out is pending; back/reload cannot re-show cached private content; a failed sign-out stays hidden while session is rechecked; an ordinary same-user `TOKEN_REFRESHED` preserves an unsaved editor; nonstaff denial is `此帳戶未獲授權使用營運後台。` / `This account isn't authorized for the operator console.`
- [ ] **Step 2: Run the focused tests.** `npx vitest run src/components/admin/StaffAuthGate.scope.test.tsx src/components/admin/StaffAuthGate.test.tsx` → current pending sign-out and copy cases fail.
- [ ] **Step 3: Implement gate-owned sign-out.** Latch `signingOut` synchronously, increment the gate's request sequence, clear rendered staff immediately, invoke `onIdentityChange`, await Supabase sign-out, then reconcile the actual session. Ignore same-owner refresh events while the latch is set; clear it only after final session reconciliation. On failure expose an error/retry state rather than restoring stale children. Pass the callback through `admin.tsx` and `AdminAuthContext`. Replace only the `app.admin.notStaff` translations; leave the Google sign-in button's accurate label intact.
- [ ] **Step 4: Verify auth and existing form recovery.** `npx vitest run src/components/admin/StaffAuthGate.scope.test.tsx src/components/admin/StaffAuthGate.test.tsx src/lib/auth-flow.test.ts src/routes/-admin.missions.edit-version.test.tsx` → PASS.
- [ ] **Step 5: Commit only Task 3 files.** Stage exactly the files named above and `git commit -m 'fix: clear staff view immediately on sign-out'`.

### Task 4: New focused refresh-replay verifier, offline first

**Files:** Create `scripts/integrations/verify-refresh-replay.mjs`, `.test.mjs`, `docs/review/kocmax-stage-5/refresh-replay-runbook.md`.

**Interfaces:** Export `classifyRefresh(response): { status: "REJECTED_EXPLICIT_AUTH_ERROR" | "FAIL_REFRESH_ACCEPTED" | "INCONCLUSIVE_TRANSPORT" | "INCONCLUSIVE_RESPONSE"; httpStatus: number | null; authCode?: string }` (reuse tested logic from the D1 verifier without changing its frozen constants). Export `runFocusedReplay({ session, revoke, refresh, readOldAccess, verifyCleanup, now }): Promise<ReplayReceipt>`; all effects are injected so import cannot contact a server.

- [ ] **Step 1: Write failing pure tests.** Cover explicit 400/401/403 Auth rejection, 2xx refresh acceptance, transport timeout, unknown error, old access JWT still reading only its own rows, wrong owner/session, and cleanup failure. Receipt has alias, project ref, timestamps, outcome codes, hashed IDs and cleanup state; never token bytes.
- [ ] **Step 2: Run them.** `node --test scripts/integrations/verify-refresh-replay.test.mjs` → expected missing export/failure.
- [ ] **Step 3: Implement the injected verifier and runbook.** Use a new disposable run ID and new session, not D1's `RUN_ID`/nine-account hardcoded assertions. Revoke/ban first, observe the actual session cleanup barrier, submit the captured old refresh token once, record old access behavior separately, and verify exact cleanup. No automatic retry or PASS on timeout. Describe required restore point, approved IDs/SQL and private in-memory secret handling.
- [ ] **Step 4: Run focused plus D1 regression tests.** `node --test scripts/integrations/verify-refresh-replay.test.mjs scripts/integrations/verify-auth-pilot-cleanup.test.mjs` → PASS; old D1 receipt files remain byte-identical.
- [ ] **Step 5: Commit only Task 4 files.** `git add -- scripts/integrations/verify-refresh-replay.mjs scripts/integrations/verify-refresh-replay.test.mjs docs/review/kocmax-stage-5/refresh-replay-runbook.md && git commit -m 'test: add focused auth refresh replay verifier'`.

### Task 5: Authorized real Auth replay and exact cleanup

**Files:** Create `docs/review/kocmax-stage-5/refresh-replay-execution.md`; private credentials/receipt stay outside Git. This task is **gated** and cannot start from design or plan approval alone.

**Interfaces:** Consume Task 4 verifier. Produce one evidence bundle with restore point, exact disposable Auth/user/session IDs, request/response status classes, cleanup SQL checksum, post-cleanup readback, and clear PASS/FAIL/INCONCLUSIVE for refresh vs old access.

- [ ] **Step 1: Prepare a concrete review packet** for the chosen Supabase project: new disposable account, exact SQL for test data and cleanup, restore point, no impact to non-test rows, test time window, and a mobile/desktop login checklist. Request separate approval **before** creating the account or running SQL.
- [ ] **Step 2: After approval, verify the restore point and baseline** by read-only queries; abort on drift. Do not reuse D1's nine banned accounts.
- [ ] **Step 3: Execute one real session test** with in-memory credentials. Record whether global sign-out actually succeeded; test the old refresh token exactly once after the proven barrier, and measure old access JWT behavior separately.
- [ ] **Step 4: Perform only exact approved cleanup and independent readback.** Confirm owned sessions/refresh/AMR/test content are gone, account is disabled/anonymized as approved, and unrelated baseline is unchanged or each drift item explained.
- [ ] **Step 5: Verify UI and report.** At 390×844 and 1440×1000, test login/logout/back/reload and owner/member/operator views. Record PASS only with explicit Auth rejection and confirmed cleanup; otherwise mark INCONCLUSIVE/FAIL, leave D1 history unchanged. Commit only sanitized execution documentation after review.

## Final acceptance for this plan

Run `npm run build`, the focused Vitest/Node tests above, and `git diff --check`. Review the exact changed-file list against the starting dirty worktree. Browser evidence covers both sizes and all four UI findings; live Auth replay is reported separately from local tests. This plan does not authorize Stage 5 Instagram work or deployment.
