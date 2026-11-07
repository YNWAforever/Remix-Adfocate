# Shared-consumer callback compatibility — offline mock only

2026-11-07, same branch, Native. Added `server/lib/creatorGrowth/pilot/sharedCallbackMock.ts` and adjacent tests. No existing runtime or integration code changed. No HTTP route registered, provider signature algorithm implemented, OAuth connection established, SQL applied or Meta settings changed.

## Contract

`createSharedCallbackMock` accepts fixture-only dependencies: verifier, clock, maximum notice age, fixed App ID, explicit consumer handlers and a trusted subject-to-consumers inventory. Inputs use synthetic IDs, not DEV - Ads credentials or real users.

Only normalized verified fixture notices for the configured App and Facebook Login product are routed. Unknown subjects, incomplete coverage, invalid kind/time/product and event-ID collisions hold without effects. Payloads are bounded at 8 KiB; arbitrary verifier fields and raw bodies never reach handlers. Registry inputs are copied. One subject may legitimately map to several consumers; duplicate registry entries are rejected rather than merged by guesswork.

All mapped consumers receive the notice. An in-memory claim is recorded before consumer awaits, so concurrent duplicates do not resend. A failing consumer becomes unknown; siblings still run, and redelivery does not blindly retry the unknown effect. Returned outcomes are copies. `recorded` means the injected handler returned, not that provider access is revoked or data erased. Separate completion/reconciliation evidence is required.

## Limits that remain blockers

- Fixture verifier is injected; it is not Meta signature verification. No exact provider callback identity/replay semantics are claimed.
- Registry completeness is trusted fixture input, not proof that all DEV - Ads consumers have been inventoried. Legacy Google Apps Script/ads-dashboard callbacks were not invoked or modified.
- Replay state is in-memory and unbounded for this bounded test harness. Restart loses it; live retention, durable atomic claims, per-consumer reconciliation, timeout isolation and crash recovery remain required before enablement.
- No fallback to pilot exists for unknown or incomplete mapping. A live dispatcher must distinguish legitimate multi-consumer membership from ambiguous identity mapping.
- OAuth authorization-code callback, exchange, deletion confirmation/status URLs and actual shared-consumer handlers are not implemented by this module. Proposed routes in the configuration sheet remain design-only.
- No frontend or responsive layout changed. Historical browser/build results were not rerun or promoted to live acceptance.

## Verification

Initial RED: test import failed because the new module did not exist (`shared-callback-red.log`). Focused suite: 22 tests. Final targeted regression: 42 PASS / 8 files (`shared-callback-regression.log`), covering this module and existing grant/runtime/transport/route/preflight boundaries. Initial TypeScript/lint found test-table typing and an unused parameter; corrected the parameterized cases to supply actual empty/missing/duplicate arrays and reran the suite.

Independent scoped review found no Important findings in the mock-only module, with no production registration. This is not whole-branch production approval. Final TypeScript and changed-file lint both PASS (exit0); results are recorded in the adjacent evidence logs.

Disposition HOLD. Next offline work depends on an authoritative consumer inventory and actual App-specific callback/OAuth protocol. No automatic retries, configuration edits or live connection are authorized by this evidence.

