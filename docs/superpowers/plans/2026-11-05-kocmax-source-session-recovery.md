# Source panel session recovery

Same branch; mock validation only, no commit/deploy/SQL/connections. Preserve rights, consent, generation and actor boundaries.

Add optional parent login callback to IntegrationSourcePanel. API401 in connection list, resources, import or mock sync immediately hides panel data and latches recovery; notify the parent once so all private thread UI hides. Guard late import success notices. Other errors retain current behavior. Reuse existing login notice; no auto navigation or command replay.

Add dev-only source401 fixture with Studio reads unaffected for browser verification without creating any mock or real connection. Test four error paths and 401-to-transient persistence, existing consent tests, type/lint, production exclusion, mobile/desktop and independent review. Drive picker-specific failures and the account-management screen are outside this Instagram-source panel scope.

Completed: six RED cases to62 focused GREEN; broad227 pass including build isolation; late-import test added after static review and all16 source tests pass. Mobile/desktop parent containment and login navigation verified without connections. No review findings; execution report at `docs/review/kocmax-stage-5/source-session-recovery.md`.
