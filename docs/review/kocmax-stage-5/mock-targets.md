# Two-target mock confirmation

2026-11-05. Branch `codex/kocmax-studio-stages-1-2`, HEAD `e491e2dd30f42090458eacb82777d45b67275627`; uncommitted, empty index. No deployment, SQL application, real connections, posts or rewards.

## Behavior

Two fixed synthetic targets: A preserves `kocmax_demo_only` / subject123456789 / connection ending041; B is `kocmax_demo_other` / subject123456790 / connection ending042. These are fixture values, not real profile lookups. Constructor validates the enum and snapshots an immutable target. Fingerprint, provider calls and displayed account derive from that target.

Explicit target switch during preview stops the old journey, clears its preview/proof/URL and requires fresh image preparation and acknowledgement. The switch shortcut is disabled during the asynchronous publish call and absent once a receipt/unknown result is shown. The target selector is locked while the journey is active. Existing clear/restart remains a page-only fixture action.

Evidence displays the synthetic target label. The existing JSON whitelist intentionally still omits account identities: it remains a target-free synthetic inspection summary, not portable approval or official evidence.

## Verification

- 169 tests PASS across8 files: journey19, mock UI15, preview32, Studio9, image workspace17, fixture ownership19, native handoff57 and production boundary1.
- Added tests reject A confirmation on B before adapter calls, verify exact B subject/connection used by adapter, and require new UI acknowledgement after switching.
- TypeScript, scoped ESLint and diff whitespace check PASS. Opt-in production build excludes all45 dev markers. Independent read-only review found no actionable findings.
- 390×844: A preview acknowledged, switch action removes old preview (count0); newly prepared B preview displays @kocmax_demo_other, confirmation remains disabled before acknowledgement. Scroll width384. [Mobile](mock-targets-mobile.png).
- 1440×1000: explicit B acknowledgement → sample receipt → proof confirmation; evidence displays B. Switch shortcut absent after receipt (count0). Scroll width1434. [Desktop](mock-targets-desktop.png). Viewport restored.
- Both prepared SQL migration hashes and rollback hash unchanged from prior acceptance. No authoritative mission/reward paths modified. Logs: `.superpowers/sdd/mock-targets-*.log`.

Limits: local mock identities and in-memory adapter only; no live cross-account/Auth/provider verification claimed. Synthetic media IDs may repeat across isolated journeys and cannot establish a real post identity. Historical reports preserved; no full-suite PASS claim.
