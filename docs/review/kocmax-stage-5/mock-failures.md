# Mock failure and expiry acceptance

2026-11-05; same branch `codex/kocmax-studio-stages-1-2`, HEAD `e491e2dd30f42090458eacb82777d45b67275627`. Changes uncommitted. No deployment, SQL application, real connections or posts.

## Result

Two explicit development scenarios: image conversion failure and already-expired preview. The first throws before decoding or provider calls. The second issues an expired preview and is rejected by the journey's existing confirmation check independently of the UI. Neither option changes normal limits or enables a real adapter.

Errors lock the old journey until reset. A labelled return-to-normal action clears preview, evidence, nonce and local image URL without automatic processing. The creator must prepare and acknowledge again. Deliberate failure copy distinguishes fixtures from actual image errors. Existing receipt, timeout, review, export, revoke and original mission paths remain intact.

## Verification

- 166 tests PASS across 8 suites: journey 18, mock UI 13, preview 32, Studio workspace 9, image workspace 17, fixture ownership 19, real handoff 57 and production boundary 1.
- Project TypeScript and scoped ESLint PASS. Opt-in production build excludes all 42 development markers. RED/GREEN evidence retained in `.superpowers/sdd/mock-failures-*.log`.
- Independent read-only review found no actionable findings.
- 390×844: conversion-failure fixture shows safe error, no preview and disabled prepare. Return to normal requires a new image and unchecked confirmation; explicit acknowledgement/publish yields a sample receipt. Scroll width 384. [Mobile failure](mock-failures-mobile.png).
- 1440×1000: expired preview displays the expiry explanation and disables confirmation. Return to normal produces a fresh unchecked preview; explicit acknowledgement/publish yields a sample receipt. Scroll width 1434. [Desktop expiry](mock-failures-desktop.png).
- Temporary viewport restored and local demo retained. No horizontal overflow observed at the two tested sizes.

Scope ruling: injected failures and an already-expired fixture prove mock handling only, not real decoder/provider failure rates or a real five-minute authorization wait. No live provider/Auth acceptance or full-suite PASS claimed. Prepared growth/publish SQL and rollback hashes remain unchanged; original workflow and reward authority remain unchanged.
