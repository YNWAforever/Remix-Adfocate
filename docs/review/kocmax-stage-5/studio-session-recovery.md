# Studio login-required recovery

2026-11-05. Branch `codex/kocmax-studio-stages-1-2`; uncommitted. No deployment, applied SQL, real connections, credentials, messages, posts or reward mutations.

## Behavior

An API 401 from Studio history or the selected detail now replaces the Studio content with a localized login-required notice and explicit `/login` link. Cached history, private detail and Studio composers are not rendered. The new-thread entry is also contained when history requires login. No server error text or private return URL is included. It neither signs out nor refreshes credentials, navigates automatically or replays commands. Existing auth-cache behavior is unchanged. Previously reviewed 403/404 neutral recovery and transient retry remain intact.

The development fixture now includes `工作室需要登入（模擬）`. It returns 401 before dispatching `/studio/` reads or writes, leaving mock identity available to render the mismatch. It is not a real expired session or login test. The marker and fixture response code are included in production-exclusion checks.

Unsaved work is not automatically persisted or restored. This change contains Studio content once an unauthorized query error is reported; it is not global cache erasure, cross-tab sign-out or real Auth/RLS acceptance.

## Verification

- RED: 4 new failures demonstrated missing 401 containment and the absent fixture option.
- GREEN: 42 tests in StudioWorkspace, StudioJourneys and studioPreviewOwnership passed. Coverage includes detail-only and history-only 401 with cached private data, the new-chat entry, no command replay, fixture write denial and normal fixture recovery.
- TypeScript and focused ESLint: exit 0.
- Opt-in production bundle exclusion: 1 test passed, including the two new fixture markers (47 total). This is a local build, not deployment verification.
- Independent scoped read-only review: no findings. Preexisting dirty-baseline changes were outside that review.

Commands:

```powershell
node node_modules/vitest/vitest.mjs run src/components/studio/StudioWorkspace.test.tsx src/components/studio/StudioJourneys.test.tsx src/test/studioPreviewOwnership.test.ts --reporter=dot
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js src/components/studio/StudioWorkspace.tsx src/components/studio/StudioWorkspace.test.tsx src/test/studioPreview.ts src/test/studioPreviewOwnership.test.ts scripts/creator-growth-bundle-boundary.test.ts
node node_modules/vitest/vitest.mjs run scripts/creator-growth-bundle-boundary.test.ts --reporter=dot
```

Logs: `.superpowers/sdd/studio-session-recovery-{red,green,types,build}.log`.

## Fresh browser observations

| Observation | Mobile 390×844 | Desktop 1440×1000 |
| --- | --- | --- |
| Mock 401 notice | Visible | Visible |
| Studio private history / composer | 0 / 0 | 0 / 0 |
| Explicit login link | Reaches existing `/login` | Reaches existing `/login` |
| Login form | Existing email/password form visible; not submitted | Existing email field visible; not submitted |
| Horizontal overflow | None (scroll width 384) | None (scroll width 1434) |

Screenshots: [mobile](studio-session-recovery-mobile.png), [desktop](studio-session-recovery-desktop.png). Normal mock state and owner thread were restored; viewport reset. No login form was filled or submitted and no test accounts were created.

Current scope changes five existing files: StudioWorkspace and test, studioPreview and ownership test, production-boundary test. Historical milestone fingerprints remain historical and are not overwritten. Original mission, rewards, backend authorization and real-provider gates are unchanged.

