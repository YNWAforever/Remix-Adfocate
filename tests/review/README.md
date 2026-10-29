# Review test suite

Scenario tests written for the 2026-10 end-to-end review (see `docs/review/`). They run only
against a **local, disposable** Supabase stack; the runners refuse any non-loopback target.

```bash
npx supabase start
```

```bash
node tests/review/run-review-tests.mjs
```

```bash
node tests/review/run-review-e2e.mjs
```

`knownBug("F-xx", …)` tests pass while the documented defect exists and fail with
"appears FIXED" once it is fixed — then drop the marker and keep the test as a regression.
Finding IDs refer to `docs/review/02-findings.md`; results are in `docs/review/04-test-report.md`.
