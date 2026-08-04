# Task 7 report: exact production deployment verification

Status: READY_FOR_REVIEW

## Scope

- Added `verifyDeployment` to validate the Vercel deployment identity before release sign-off.
- Requires HTTP 200, `READY`, production target, GitHub `main` ref, exact expected commit, and the exact production alias.
- Probes `/api/health` for HTTP 200 and `{ ok: true }`, then probes `/home` for HTTP 200.
- Returns only sanitized deployment identifiers, status codes, timestamps, and the already-generated schema fingerprint; tokens, headers, response payload extras, and raw request errors are never returned.
- Added the `release:verify-deployment` package script.
- Added a guarded `runDeploymentCli` entrypoint using only trusted CI environment
  variables (`RELEASE_VERCEL_*`, `RELEASE_APPLICATION_COMMIT`/`GITHUB_SHA`,
  `RELEASE_PRODUCTION_ALIAS`, `RELEASE_APP_ORIGIN`, and
  `RELEASE_SCHEMA_FINGERPRINT`). The package command uses vite-node script mode
  and emits sanitized JSON on success or failure.
- Bound health and home probes to the verified production alias: the app origin
  must be HTTPS and have the exact normalized hostname/port of the alias.

## TDD evidence

- RED: `npx.cmd vitest run scripts/release/deployment.test.ts --reporter=verbose` failed because `./deployment` did not exist.
- GREEN: the focused suite passes all 8 tests after the review fixes.

## Verification

- Focused: 8 passed, including missing-env CLI, package-entrypoint, and origin
  binding regressions.
- Real package command: `npm.cmd run release:verify-deployment` fails closed
  with sanitized JSON and a non-zero exit when trusted environment inputs are
  absent.
- Type-check: passed. Existing TanStack warning remains for `src/routes/_site.smoke.test.tsx`.
- `git diff --check`: passed.

## Security and correctness notes

- Vercel API calls use a team-scoped deployment URL and bearer token only for the deployment request.
- Health and home requests never receive the Vercel token.
- Fetch and parsing failures collapse to bounded labels; token-bearing URLs and error text are not copied into errors or reports.
- No production or Vercel mutation was performed.
