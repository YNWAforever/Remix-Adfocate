# Phase 3 M4 — staff MFA (AAL2)

Status: code shipped dark. `STAFF_MFA_REQUIRED` defaults to false; enabling it is
an owner action.

## Behaviour

- Server reads `STAFF_MFA_REQUIRED === "true"` and the verified Supabase JWT
  claims (`aal`, `amr`). A staff session that is not AAL2 gets:
  - `GET /api/admin/me` → 200 with `mfa_required: true` (identity still
    readable so the gate can render the enrol/challenge screen);
  - every other `/api/admin/*` route → 403 `{ code: "mfa_required" }` before
    workspace/capability checks run.
- AAL2 (`aal: "aal2"`, or `amr` containing `totp`/`mfa`) passes.
- The shared-secret break-glass path is not a real staff identity
  (`viaSecret`/no user id) and is exempt by construction.
- Client `StaffAuthGate` renders `StaffMfaChallenge` instead of the admin shell:
  - first use enrols a TOTP factor (`supabase.auth.mfa.enroll`) and shows the QR
    code + manual key;
  - subsequent visits challenge the verified factor;
  - a successful `verify` refreshes the session and revalidates `/admin/me`
    before the shell mounts.

## Rollout (owner)

1. Enable TOTP MFA for the Supabase project (Authentication → Factors/TOTP).
2. Set `STAFF_MFA_REQUIRED=true` in Vercel Production and redeploy.
3. Sign in as staff: `/admin` should show the enrolment screen; complete it with
   an authenticator app.
4. Confirm `/api/admin/me` returns `mfa_required: false` after verification and
   the rest of `/api/admin/*` works.
5. Keep the flag off for other environments until staff factors are enrolled.

## Rollback

Remove `STAFF_MFA_REQUIRED` (or set it to anything other than `true`) and
redeploy. Already-enrolled factors remain in Supabase and continue to work; the
server simply stops requiring AAL2. No schema change is involved.

## Tests

- `server/test/staff-mfa.test.ts`: flag parsing, JWT claim decoding, AAL2
  detection, break-glass/no-identity exemption.
- `server/test/admin.test.ts`: with the flag on, `/admin/me` reports
  `mfa_required: true` while another admin route returns 403 `mfa_required`.
- `src/components/admin/StaffMfaChallenge.test.tsx`: enrolment, verified-factor
  challenge, malformed-code rejection.
- `src/components/admin/StaffAuthGate.test.tsx`: MFA screen replaces the shell.
