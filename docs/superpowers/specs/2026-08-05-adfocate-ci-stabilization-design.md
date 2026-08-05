# Adfocate CI Stabilization Design

Date: 2026-08-05  
Status: Approved for implementation planning  
Production change status: Not authorized  
Target: Draft PR #62 (`codex/production-release-foundation-design`)

## 1. Purpose

Draft PR #62 contains the production release foundation, but its first GitHub
Actions run exposed two independent CI blockers:

1. `build-test` reports checksum drift for existing migration files because the
   manifest currently hashes the checkout's raw line-ending bytes. The local
   Windows checkout has `core.autocrlf=true` and CRLF migration files, while
   the Ubuntu runner reads LF files.
2. `integration` fails all three publication-proof asset-grant cases with HTTP
   500. The current assertions hide whether the failure is in the guarded RPC,
   the Storage bucket/policy, or the signed-upload endpoint.

This phase makes the release checks platform-independent and restores the live
Supabase Storage/RPC integration proof. It does not relax a gate, substitute a
mock for Storage, or modify production.

## 2. Approved decisions

1. The next phase is CI stabilization for PR #62 before any new product work or
   release execution.
2. Migration SQL is hashed after canonical newline normalization (`CRLF` and
   lone `CR` become `LF`). Manifest generation and validation must use the same
   helper.
3. GitHub Actions pins the Supabase CLI to `2.110.0`, matching the repository's
   release toolchain.
4. The publication-proof integration tests remain live and mandatory. A
   Storage/RPC failure is fixed or clearly escalated as an infrastructure
   blocker; it is not converted into an expected skip.
5. Diagnostic output is test-only and sanitized. It may include HTTP status and
   stable error fields (`code`, `error`, and a short message), but never tokens,
   signed URLs, emails, credentials, authored content, or opaque identifiers.
6. The phase ends only when the PR's release check, full test suite, integration
   suite, lint, type-check, build, and Vercel check are green.

## 3. Goals

- Make the committed migration manifest validate identically on Windows and
  Ubuntu.
- Add regression coverage proving newline normalization is deterministic.
- Make live publication-proof grant failures actionable without leaking
  secrets or personal data into GitHub logs.
- Identify and fix the underlying RPC/Storage failure while preserving the
  service-role-only guarded path and real signed upload flow.
- Keep CI credential-free except for the existing disposable Supabase service
  keys supplied by the integration job.
- Preserve the reward-neutral boundary: no production migration, pilot
  enablement, payout, ledger mutation, or mark-paid action.

## 4. Out of scope

- Skipping or weakening the live publication-proof integration suite.
- Replacing Supabase Storage with an in-memory or mocked upload path.
- Changing production schema, data, credentials, or deployment settings.
- Reworking the reward-handoff state machine or adding creator-facing product
  features.
- General migration refactoring unrelated to hashing or the surfaced Storage /
  RPC failure.
- Rotating secrets or changing GitHub/Vercel/Supabase access controls.

## 5. Architecture

The phase has two independent but ordered tracks.

### 5.1 Canonical manifest track

`canonicalSqlText(value)` is the only newline normalization boundary. It
converts `\r\n` and lone `\r` to `\n`, then encodes the resulting UTF-8 text
before SHA-256 hashing. `buildManifest` and `validateManifest` call the same
helper; the manifest JSON schema, migration order, capability declarations,
and overall digest remain unchanged.

The manifest CLI continues to read the committed artifact and never writes it
during `check`. A write is an explicit local command. The resulting check is
therefore independent of checkout line-ending settings while remaining strict
about file contents and ordering.

### 5.2 Live integration track

The integration workflow pins the Supabase CLI before `supabase start` and
exports the disposable project's keys exactly as it does today. The
publication-proof preflight remains the first integration process so failure is
isolated and fast.

The live test sends the creator-authenticated request through the production
route, which uses the service-role repository and guarded RPC, then requests a
real Storage signed-upload URL. The GIF and MP4 cases upload through that URL
and finalize through the real route. A test-only assertion helper captures a
sanitized response diagnostic when a status is not 2xx. The diagnostic is
observability only; the final behavior must still be a successful grant,
upload, and finalize sequence.

## 6. Component boundaries

### 6.1 Manifest hashing

- `scripts/release/manifest.ts`: canonical text and SHA-256 helper used by
  inspection and validation.
- `scripts/release/manifest.test.ts`: LF/CRLF/lone-CR equivalence and existing
  manifest validation coverage.
- `scripts/release/manifest-cli.ts`: unchanged command boundary; `check`
  remains read-only.

### 6.2 CI toolchain

- `.github/workflows/ci.yml`: pin `supabase/setup-cli` to `2.110.0` in the
  integration job. No production or Vercel secrets are added to pull-request
  jobs.
- `package.json` and lockfile: remain the source of the Node dependency
  versions; no unrelated dependency upgrade is included.

### 6.3 Integration diagnostics and fix

- A small test-only helper (in the integration test support area) reads a
  failing response once, parses JSON when possible, and emits only the allowed
  diagnostic fields.
- `server/test/publication-proof-asset-grant-live.test.ts` uses the helper for
  all grant requests and keeps cleanup behavior for any returned asset.
- The first diagnostic CI run determines whether the narrow fix belongs in the
  migration bucket/policy setup, the guarded RPC contract, the server client,
  or the disposable workflow. The implementation must add a focused regression
  test for that exact cause before changing behavior.

## 7. Error handling and security

- Manifest drift remains a hard error with the migration version and generic
  drift category; it never prints SQL contents.
- Integration diagnostics redact bearer tokens, JWT-like strings, signed URLs,
  email addresses, connection strings, and UUID-like identifiers before output.
- Unexpected route exceptions remain HTTP 500 and are not mapped to a false
  success. Stable RPC validation errors continue to use their existing status
  mapping.
- Any Storage failure must leave the pending asset cleaned up when the existing
  best-effort cleanup path can run; tests must verify no fixture residue.
- If the failure is proven to be runner or Supabase infrastructure rather than
  repository behavior, record that evidence and stop rather than weakening the
  acceptance gate.

## 8. Verification plan

1. Add and run the manifest newline regression tests.
2. Run the release-foundation suite, manifest check, type-check, lint, build,
   and full local test suite on Windows.
3. Run the pinned disposable Supabase integration preflight locally when the
   Docker/Supabase environment is available; otherwise use CI as the first
   live reproduction and retain its sanitized diagnostic.
4. Fix the proven Storage/RPC cause and add the focused regression test.
5. Push the implementation commit to PR #62 and require:
   - `build-test` success;
   - `integration` success with no unexpected skips;
   - Vercel preview success;
   - `git diff --check` clean.

## 9. Acceptance criteria

- The same migration manifest digest is produced on Windows and Ubuntu.
- `npm.cmd run release:check` passes locally.
- The live PNG grant, GIF upload/finalize, and MP4 upload/finalize cases all
  return success against disposable Supabase Storage.
- No diagnostic log contains a secret, token, signed URL, email, authored
  content, or opaque identifier.
- The PR remains draft until all required checks are green.
- No production database, deployment, pilot, reward ledger, or payout state is
  changed by this phase.

## 10. Handoff

After the spec is reviewed, create an implementation plan with TDD-first tasks
for the canonical hash helper, CLI pin, diagnostic assertion, root-cause
regression, and CI verification. Implementation must stop if the live failure
requires new production authority or unavailable infrastructure.
