# Task 7 report: exact production deployment verification

Status: READY_FOR_REVIEW

## Scope

- Added `verifyDeployment` to validate the Vercel deployment identity before release sign-off.
- Requires HTTP 200, `READY`, production target, GitHub `main` ref, exact expected commit, and the exact production alias.
- Probes `/api/health` for HTTP 200 and `{ ok: true }`, then probes `/home` for HTTP 200.
- Returns only sanitized deployment identifiers, status codes, timestamps, and the already-generated schema fingerprint; tokens, headers, response payload extras, and raw request errors are never returned.
- Added the `release:verify-deployment` package script.

## TDD evidence

- RED: `npx.cmd vitest run scripts/release/deployment.test.ts --reporter=verbose` failed because `./deployment` did not exist.
- GREEN: the same focused suite passes all 5 tests after implementing the verifier.

## Verification

- Focused: 5 passed.
- Type-check: passed. Existing TanStack warning remains for `src/routes/_site.smoke.test.tsx`.
- `git diff --check`: passed.

## Security and correctness notes

- Vercel API calls use a team-scoped deployment URL and bearer token only for the deployment request.
- Health and home requests never receive the Vercel token.
- Fetch and parsing failures collapse to bounded labels; token-bearing URLs and error text are not copied into errors or reports.
- No production or Vercel mutation was performed.
