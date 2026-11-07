# Unknown callback reconciliation — mock evidence only

2026-11-07. Same branch, Native implementation. No routes mounted, existing consumer handlers changed, Meta settings edited, connections created, SQL applied, deployment or posting.

## Decision and implementation

Ruling: append a separate immutable evidence review, rather than change the original unknown delivery result. A handler may have completed its external effect before failing to acknowledge it; rewriting the original result or enabling retries would hide that uncertainty. This mock models reviewing the uncertainty without performing an effect.

The local journal exposes `reconcile` and `getReconciliations`. A review binds fixture provenance, configured App ID, event key, exact notice/consumer-inventory fingerprint and consumer ID. Only an existing unknown outcome can be reviewed. The record stores a synthetic reviewer alias, evidence digest and one of `effect_confirmed`, `effect_absent`, or `inconclusive`. It persists through the same fsynced journal and committed-tail protocol before returning, and is restored on reopen. Returned data is copied. Raw evidence, tokens and extra fields are not stored.

An identical review is idempotent; a conflicting review is rejected, with no overwrite. Each consumer is independent. The original unknown outcome remains unknown even for `effect_absent`, and redelivery never resends effects. There is no retry, deletion, mark-complete or live reconciliation endpoint. Inconclusive reviews remain immutable in this bounded mock; later corrections/superseding evidence require a separately designed append-only workflow.

## Scope of trust

The caller is a trusted offline fixture harness. Reviewer aliases and evidence digests are supplied synthetic assertions: they do not prove operator authentication, source authority, evidence contents, or real revocation/deletion. Do not expose these journal methods as a production API. Production requires authenticated authorized reviewers, validated independently collected evidence bound to the affected account/consumer, retention/access rules, audited corrections, and explicit operational approval. No review closes live pilot blockers.

Existing durable-journal limitations remain: exclusive local ownership, stale-lock refusal, no OS-kill or power-loss proof, no protection against coordinated rollback of both journal and marker, and no automatic corruption repair. Existing version-1 journals without review records still open. Older readers fail closed on new reconciliation record types; preserve a copy and do not downgrade an actively used review journal.

## Mock recovery acceptance

1. Preserve journal and committed-tail evidence; stop the original owner before reopening or using a controlled copy.
2. Reopen only a consistent pair. Interrupted pending delivery becomes unknown through the existing recovery path.
3. Supply a fixture review referencing that exact App, event fingerprint and consumer. Missing, pending, recorded or mismatched cases reject without a review.
4. Reopen and read the decision. Confirm unknown delivery and sibling outcomes are unchanged, and duplicate dispatch does not invoke handlers.
5. A flush failure must not publish a successful review; the journal is poisoned and mismatched disk evidence remains blocked. Never repair by deleting the claim or blindly repeating the callback.

## Verification evidence

Tests-first RED: 14 failures because reconciliation methods were absent. Initial focused GREEN: 47 PASS / 3 files. Final regression includes an additional per-consumer inconclusive/privacy case. Logs: `reconciliation-red.log`, `reconciliation-green.log`, `reconciliation-regression.log`, `reconciliation-types.log`, `reconciliation-lint.log` under the existing P5 evidence directory.

No UI changed. Browser/mobile/desktop checks were not rerun; historical browser evidence is not fresh acceptance. Status remains HOLD with execution disabled. DEV - Ads integrations remain untouched.

Final targeted regression: 68 PASS / 10 files, including 15 reconciliation cases. Changed-file ESLint PASS. Independent scoped review found no Important findings. These results are offline and do not represent a whole-branch or live acceptance pass.

Final TypeScript --noEmit PASS (exit 0).
