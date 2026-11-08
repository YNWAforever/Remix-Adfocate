# Durable callback replay and recovery — offline only

2026-11-07. Native implementation on the existing branch. No live routes mounted or existing DEV - Ads consumers changed. No Meta settings, SQL, connections, deployment or publishing.

## Implemented contract

The shared mock dispatcher optionally accepts a local file journal. Its default in-memory behavior is preserved. The journal uses the existing exclusive local-directory owner lock under `.superpowers`, an 8 MiB bounded append-only record file, fsynced writes, hash chaining and an independently checked committed-tail marker. A durable claim is written before consumer effects. Fixed fixture App identity and the normalized notice plus sorted consumer inventory bind each claim. Raw callback bodies, subjects, tokens and exception text are not written.

Completed and unknown consumer outcomes survive close/reopen; duplicates do not resend. Pending outcomes become unknown on reopen, with recovery recorded before accepting delivery. Changed consumer mappings or event contents hold. A closed or failed journal cannot accept further writes. Missing tail metadata, partial records, complete-record truncation and mismatched App identity fail closed without repairing or deleting original evidence. The tail marker catches loss of complete records that a hash chain alone would miss.

`recorded` means the injected handler returned, not verified Meta revocation or deletion. `unknown` is not success and is never automatically retried or upgraded.

## Recovery procedure and limits

1. Stop delivery and preserve the journal, tail marker, leftover temporary markers and owner-lock evidence together.
2. Confirm the original owner has stopped. Never steal a stale lock or edit the original journal in place. Make an explicitly identified offline copy for investigation; never run two owners for the same logical consumer effects.
3. Open only a consistent journal and tail pair. Valid pending records become unknown. A corrupt/missing/mismatched pair remains blocked; do not truncate or rebuild it to make a retry possible.
4. Reconcile each unknown consumer against separately collected evidence before proposing any manual resolution. This module deliberately has no resend or mark-complete endpoint.

Tests exercise close/reopen and interrupted injected handlers, not an OS kill or power failure. Filesystem directory durability and malicious local file replacement are not proven. The checksums are corruption detection, not authentication; coordinated rollback of both files requires an external trusted checkpoint to detect. Stale locks remain fail-closed. Retention/compaction, production atomic persistence, provider signature/identity protocol, exact consumer inventory, timeout isolation and operational reconciliation remain live blockers.

## Verification

Tests-first RED confirmed the missing module. Regression includes durable restart, concurrent owner denial, changed mapping, partial/complete-line truncation, missing marker, flush failure before effects, and retained per-consumer unknown outcomes. See `durable-callback-regression.log`, `durable-callback-types.log` and `durable-callback-lint.log` in the P5 evidence directory for final results.

No frontend changes were made; mobile/desktop browser tests were not rerun or represented as new evidence. Earlier UI/build and full-suite results retain their original scope. Disposition: HOLD; live execution remains unauthorized.

Targeted regression: 53 PASS / 9 files. Independent review found complete-record truncation risk; committed-tail validation and a regression test resolve it. Follow-up scoped review found no Important issues. One filesystem spy setup failure was corrected using a module mock; the suite was rerun successfully. No whole-suite PASS is claimed.

Final TypeScript --noEmit and changed-file ESLint both PASS (exit 0).
