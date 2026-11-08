# Reload gap resolved and local mock summary

2026-11-05. Branch `codex/kocmax-studio-stages-1-2`, HEAD `e491e2dd30f42090458eacb82777d45b67275627`; changes uncommitted, index empty. No SQL application, deployment, real connections or posts.

## Reload cause and correction

Installed `@tanstack/react-router/src/useBlocker.tsx` defaults `enableBeforeUnload` to true independently of `shouldBlockFn`. Studio registered its route guard without overriding that default, so even a clean thread could trigger unload protection. The browser reload action retained the existing page.

Studio now explicitly passes `Boolean(dirty || growthDirty || input || pendingChat)`. The existing route-confirmation function and explicit beforeunload listener remain intact. Regression testing covers clean false, typed input true, cleared input false, and actual cancelable beforeunload events; existing unsaved-growth protection also passes.

The prior gap is closed for the mock workflow: at 390×844 a pending-review rehearsal reloaded to fresh preparation; at 1440×1000 a received mock receipt reloaded to fresh preparation, with zero preview regions and zero handoff buttons. No guard bypass, real data deletion or authentication change. Unsaved non-demo content remains protected; dismissal/acceptance of a real dirty-work browser warning is not claimed as a new browser test.

## Next mock phase delivered

After either simulated review decision, a local JSON download includes only schema version, synthetic/no-authority warning, sampleOnly=true, awarded=false, decision, exact caption, final JPEG SHA-256 and synthetic media ID. Explicit whitelisting omits owner/session identifiers, nonce, fingerprint and URLs. Pending/unknown states cannot download. Invalid summary inputs fail closed.

Blob URLs are revoked when the summary changes or its component unmounts (clear/owner change). No automatic download, upload, API call, mission mutation or reward operation. The creator-requested file remains on disk after page cleanup; revoking the Blob URL does not delete their downloaded copy.

## Validation

- 161 tests PASS in 9 suites: serializer 7, journey 10, real handoff 57, mock UI 9, preview 32, fixture ownership 19, image workspace 17, Studio workspace 9 and production boundary 1.
- Opt-in production build excludes all 36 development markers. TypeScript and scoped ESLint pass. `git diff --check` passes.
- Independent read-only review found no actionable findings.
- Desktop completed the full conversion/confirmation/handoff/review flow and downloaded `kocmax-mock-review.json`. The actual file was read and its fields matched the whitelist, synthetic flags and exact sample caption. [Downloaded example copy](mock-summary-example.json).
- At 390×844 the download link and warning are readable, scroll width 384 (no page overflow); clearing removes the link. [Mobile evidence](mock-summary-mobile.png). The file download itself was exercised on desktop; mobile link rendering/cleanup and reload were exercised separately.
- Existing growth/publish migration and rollback SHA-256 values remain unchanged from the prior report. Historical records preserved.

Logs: `.superpowers/sdd/reload-gap-{red,green}.log` and `.superpowers/sdd/mock-summary-*.log`. No broad full-suite or real provider/Auth acceptance is claimed.

Scope ruling: this file is synthetic inspection material, not official evidence, reviewer authority or portable approval. The canonical mission workflow still rejects synthetic receipts. Download is local-only; live adapter, official identity/revocation and real receipt verification remain outside this work.
