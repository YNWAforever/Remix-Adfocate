# Callback review corrections and audit history — mock only

2026-11-07, existing branch, Native. No live routes, existing DEV - Ads integration changes, Meta settings, connections, SQL, deployment or posting.

## Contract

Ruling: corrections supersede an evidence interpretation, never the delivery outcome or the earlier review record. `correctReconciliation` appends a record containing the normalized fixture review, a reason digest, a predecessor ID, a revision number and a deterministic content ID. It requires the same configured App, exact event/inventory fingerprint, consumer and original unknown outcome as reconciliation.

Each consumer has its own ordered history. Revision zero is derived deterministically from the original review, so existing journals require no migration. Every correction must reference the latest review, preventing stale competing edits. Repeating the exact correction returns its existing record without writing, even after later corrections. Changing a stale request is rejected. Every new record is persisted using the existing fsynced journal and committed-tail protocol before being exposed in memory.

`getReviewHistory(eventKey, consumerId)` returns copied records, oldest first; the last entry is the latest mock interpretation. `getReconciliations` continues returning original reviews for compatibility, not the latest interpretation. Neither method mutates anything. Original review decisions, delivery unknown outcomes and sibling consumers are preserved. Even an `effect_absent` decision or subsequent correction never enables resend, deletion or provider completion.

Audit ordering is revision/predecessor ordering, not a verified wall-clock timestamp. Reviewer aliases, reason digests and evidence digests are trusted synthetic assertions. No actual identity, evidence authenticity, reviewer entitlement or provider completion is verified. Raw reason/evidence bodies and extra review fields are not stored. This replaces the prior mock's lack of a correction workflow; its prohibition on overwriting history remains.

## Recovery and remaining live blockers

Preserve the journal, committed-tail marker and owner-lock evidence. Stop the original owner and reopen only a consistent pair. Review and correction records restore in order; broken predecessor/revision/content links reject the journal even when outer checksums match. Flush failure poisons further access; mismatched disk evidence stays blocked without automatic repair. Existing callback claims still suppress replay.

Older readers do not understand correction records and fail closed. Do not downgrade an actively used journal or delete history to make it readable. Existing mock limitations remain: no OS-kill/power-loss guarantee, no protection against coordinated rollback of all evidence, stale locks require controlled investigation, local bounded storage only. Live use still requires authenticated authorized reviewers, independent evidence verification, retention/access policy, trusted audit timestamps/checkpoints and separately approved operational procedures. No route exposes these methods.

## Verification

Tests-first RED: 7 new failures from missing methods, 15 existing reconciliation tests passed. Initial focused GREEN: 55 PASS / 3 files. Final targeted regression: 76 PASS / 10 files, including 23 reconciliation/correction cases. Covered ordered history, multiple corrections, restart, exact repeated correction after supersession, stale conflict, missing review, mismatched consumer/App, invalid reason/parent, copied reads, write failure/closed journal, broken predecessor with recalculated outer checksums, and duplicate dispatch after correction. Changed-file lint passed.

Logs are `corrections-red.log`, `corrections-green.log`, `corrections-regression.log`, `corrections-types.log` and `corrections-lint.log` under the P5 evidence directory. No frontend changed; mobile/desktop browser checks were not rerun. No whole-suite or live acceptance claim. Approval disposition remains HOLD; execution disabled.
Independent scoped review found no Important findings; actual reviewer authentication and evidence verification remain outside mock guarantees.
Final TypeScript --noEmit PASS (exit 0).
