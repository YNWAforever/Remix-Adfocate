# Private thread recovery

Continue on the existing branch, mock validation only. No SQL, connection, deploy or commit.

Observed problem: the nine-role mock matrix denied private-thread reads correctly, but showed a transient-error retry prompt for 403 responses.

Implement the same neutral unavailable message for 403 and 404 without showing server text, owner identity or existence hints. Offer return to the creator's workspace; keep transient failure retry and all existing successful-thread behavior. Test stale detail suppression and retry dispatch. Verify peer denial and owner recovery at 390 and 1440 pixels, then run focused Studio/ownership regressions, typecheck and lint. Obtain one independent code review.

No permissions are expanded, and no backend error semantics or existing draft handling changes.

Completed: RED (2 expected failures) to GREEN (38 tests), mobile/desktop recovery and transient-error browser check, TypeScript/lint, independent review with no findings. Evidence: `docs/review/kocmax-stage-5/private-thread-recovery.md`. Historical source manifests are not overwritten.
