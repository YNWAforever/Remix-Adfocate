# Phase 3 closeout — launch readiness

Updated 2026-11-13 (Asia/Singapore). Production main: `985e572` (deployment READY, `/` 200, `/api/health` 200).

## Shipped

| Milestone | PRs | State |
| --- | --- | --- |
| M1 creator recovery after rejection | #155 (schema/RPC), #156 (route/UI), #157 (production evidence) | Live; migration `20261113090000` applied 2026-11-13 |
| M2 operator overdue signal | #158 | Live |
| M3 support handoff | #159 | Code live, **dark** (no channel configured) |
| M4 staff MFA (AAL2) | #160 | Code live, **dark** (`STAFF_MFA_REQUIRED` unset) |
| M5 production release/pilot | — | **Not started — owner-gated** ([readiness bundle](phase3-pilot-rollout.md)) |

Details: [creator recovery](phase3-creator-recovery.md),
[support handoff](phase3-support-handoff.md), [staff MFA](phase3-staff-mfa.md).

## Verification

- Migration applied as one transaction with a history row; column, table, RLS
  policy, indexes, function `SECURITY DEFINER`/ACLs verified. 10 submissions
  before/after (0 rejected); a rolled-back RPC probe returned `wrong_state`.
- Creator recovery: integration suite covers success, replay, idempotency
  conflict, revision exhaustion, deadline, foreign creator; route tests cover
  `/missions/my` headroom and 409 mapping; mission-page tests cover available and
  closed states.
- Overdue signal: integration covers `overdue=1` + `overdue_count`; UI test
  covers the toggle and badge. CI build-test + integration green on #158.
- Support handoff: unit tests for validation/preference/payload opacity; UI
  tests for hidden/visible states.
- Staff MFA: offline policy/claims/exemption tests, admin route enforcement test,
  enrol/challenge/gate component tests. Break-glass identity exempt.
- Production after merge: `/` 200, `/api/health` 200, unauthenticated API 401.

## Owner actions remaining

1. **First rejection verification (M1):** production currently has 0 rejected
   submissions, so the recovery UI is unexercised in production. Reject one
   disposable/test submission, confirm the creator sees the reason + remaining
   revisions + form, resubmit once, and confirm the event row/`resubmit_count`.
2. **Support channel (M3):** set `VITE_SUPPORT_WHATSAPP` or
   `VITE_SUPPORT_EMAIL` in Vercel Production and redeploy. Hidden while unset.
3. **Staff MFA (M4):** enable Supabase TOTP, set `STAFF_MFA_REQUIRED=true`, and
   have staff enrol factors before enforcing elsewhere.
4. **M5 pilot (separate authorization):** choose the one pilot legacy mission,
   run the publication-proof/release runbooks, and provide the explicit
   `APPROVE <projectRef> <evidenceDigest>` release approval. Plan approval alone
   does not authorize this rollout.

## Notes / risks

- `missions.revision_limit` defaults to 2 and is interpreted as resubmissions
  after the first submission; resubmission never writes XP/points/earnings.
- Production `supabase_migrations.schema_migrations` records only a subset of
  reviewed history (earlier migrations were out of band). Future protected
  releases need that history reconciled before the release executor preflight
  will pass.
- The overdue count is computed from the filtered queue (paged read), not a
  database count, and is workspace-scoped when a workspace filter is present.
