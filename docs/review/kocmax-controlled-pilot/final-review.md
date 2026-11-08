# Independent final review and remediation

2026-11-06. One read-only independent reviewer (Zeno). Working-tree review on the existing branch; no commits, deployment, remote SQL or provider calls.

Reviewer verdict: **changes requested for whole-stage offline acceptance**. No Critical finding; three Important implementation defects and several missing whole-stage deliverables. The verdict is not silently promoted to approved after local fixes.

| Finding | Remediation | Evidence |
| --- | --- | --- |
| Known media ID lost before receipt lookup | Added durable `media_known` checkpoint before receipt fetch. Recovery reads only; no lease/create/publish. | worker tests: failed receipt lookup retains ID; reconstructed job store retains ID and bounded read budget |
| Exact clock equality rejects 1ms elapsed | Accept elapsed time up to 5 seconds; reject future/stale clock, invalid or overlong lease. | jobStore test reproduces 1ms failure then passes |
| Revocation during asset loading still writes storage | Recheck authorization and expiry immediately before storage put, retain post-put check/purge. | mediaLease test: revoke in load means zero puts |
| Memory/SQL semantic mismatch | Both reserve once per owner/approved version/revision, including app retarget conflicts. Fixture SQL now has retention tombstones. | memory binding and PGlite persistence tests |

Additional coordinator fixes: initial worker projection must match stored mission/product/app basis; operator card is removed on sign-out; DTO parser/hash substitution tests; original mission projection adapter validates immutable approved version and omits mutable draft/private brief.

The reviewer excluded actual OAuth/Meta/App, hosted Auth/RLS, restore readiness, deployment and real settlement. These remain NOT_RUN/BLOCKED, not waived. Independent review preceded the remediation; no second reviewer was requested. Final automated checks cover the edited code.

Remaining whole-stage gaps: composed durable runtime/reconciliation; original approved-source production authority SQL and OAuth composition; same-task proof/reviewer/settlement acceptance; enforced roster wave and collection handoff for this new pilot receipt. Existing collection behavior was rechecked separately. See acceptance.md and launch-packet.md. These are not all external-provider blockers.
