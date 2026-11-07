# Studio session recovery with mocks

Same branch, no commit/deploy/SQL/live connections. Continue recovery work with TDD and one independent review.

When Studio history or current detail reports API 401, show localized login-required notice and explicit `/login` link. Hide cached history, detail, composers and command controls within Studio. Do not sign out, refresh credentials, automatically navigate, place private return URLs in login parameters, or replay writes. Existing auth-cache handling remains authoritative. 403/404 recovery and transient retry remain intact.

Add a development-only fixture returning 401 for Studio endpoints while leaving fixture identity available to render the page. It models an API/session mismatch, not real expiration or login. Block mock Studio mutations under that scenario. Verify component/fixture tests, mobile/desktop navigation to existing login, normal owner restoration, production fixture exclusion, type/lint and scoped review.

This is UI containment and recovery, not real refresh-token or Auth/RLS acceptance. Unsaved data is not automatically persisted or restored.

Completed: four expected RED cases, 42 GREEN tests, type/lint, production-exclusion build, mobile/desktop notice-to-login navigation and normal owner recovery. Independent review found no issues. Evidence: `docs/review/kocmax-stage-5/studio-session-recovery.md`.
