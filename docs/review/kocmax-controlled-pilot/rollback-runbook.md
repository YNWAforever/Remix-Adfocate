# Rollback runbook — no execution

1. Disable pilot writes and stop/drain workers. Preserve current intents, accepted IDs and unknown outcomes.
2. Inventory target objects, ownership, counts and hashes. Require a current target-specific restore point and independently verified recovery procedure before any approved SQL application.
3. Reconcile possible platform writes using reads only. Database rollback never deletes a public post or grants permission to repost.
4. Review exact synthetic cleanup separately; retain mission, proof, reward, audit and semantic-reservation tombstones. No wildcard deletion.
5. Only if separately approved and the new jobs table is empty, execute the reviewed rollback.sql. It locks and refuses nonempty tables; no CASCADE.
6. Read back original schema/grants/counts and regression behavior. Re-enable nothing automatically.

Current scope: rollback.sql covers the checkpoint table only. The PGlite fixture source/RPC helper is test-only and is not part of an approved production migration. Neither SQL file has been applied remotely.
