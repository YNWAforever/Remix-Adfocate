# Mock native pipeline — local acceptance

Updated 2026-11-05 (Asia/Singapore). Branch `codex/kocmax-studio-stages-1-2`; HEAD `e491e2dd30f42090458eacb82777d45b67275627`, changes remain uncommitted. This report covers the bounded continuation only; earlier manifests retain their historical meaning.

## Delivered

- `MockNativeInstagramAdapter` implements the existing publisher interface over the closed in-memory mock. Default disabled; no token, HTTP transport, endpoint or live mode. Numeric receipt identity and target checks, single publish and unknown-outcome behavior remain enforced. Internal native-shaped envelopes are NOT a verified Meta protocol adapter.
- Browser-local PNG/JPEG decoding and JPEG re-encoding, bounded to 5 MiB / 4 million pixels / 4096 per edge for this demonstration. White transparency background, orientation-aware bitmap decode, no copied source EXIF, and SHA-256 over the final encoded bytes. These are local limits, not verified Instagram limits. The development flow generates its own synthetic PNG; real uploads cannot enter it.
- Owner/content-bound, one-use publish confirmation, mock receipt and separately confirmed demo proof. Unknown outcomes cannot hand off or retry. Clear/unmount cancels late work and revokes the local object URL. No original mission submission, persistence, points or XP. Real `MissionProofHandoff` continues rejecting sample evidence.
- Development-only UI retains the earlier publishing demo and ordinary upload/manual flow. Production alias/build excludes all demo code tested by the marker boundary.

## Verification

| Check | Observed result |
| --- | --- |
| New and affected focused suites | 173/173 PASS across 7 files, including 57 real handoff sample/permission regressions and 73 service tests |
| Preview/status/Studio/fixture ownership/publisher regressions | 105/105 PASS across 5 files |
| Opt-in production build boundary | 1/1 PASS; all 28 forbidden development markers absent with Studio enabled, fixture disabled and invalid placeholder Supabase URL |
| Project TypeScript | PASS, no diagnostics |
| Changed-file ESLint | PASS, no diagnostics |
| Diff whitespace | PASS |
| Independent review | No concrete correctness/security/regression defect found; one P3 scope discrepancy resolved by explicitly deferring WebP conversion |

Logs: `.superpowers/sdd/2026-11-05-kocmax-mock-native-pipeline/{focused,regressions,bundle,typecheck,lint}.log`. RED logs for the added modules are retained there. The initial UI teardown failure was caused by restoring the URL mock before React cleanup; tests now clean up first. The TypeScript BufferSource issue in the digest test was corrected using an owned ArrayBuffer.

## Browser acceptance (in-app browser, localhost only)

- 390 × 844: generated PNG actually decoded/re-encoded to JPEG, 480 × 600, 16,773 bytes; exact full-image preview and two separate confirmations reached `示例證明待審核`.
- 1440 × 1000: same actual conversion, preview, mock receipt and demo handoff completed. Screenshot: [desktop](mock-native-desktop.png); [mobile](mock-native-mobile.png).
- Desktop timeout scenario: `示例結果待確認`, zero handoff buttons, explicit no automatic retry.
- Document scroll widths 384/390, 1434/1440 and 314/320: no horizontal page overflow at mobile, desktop or narrow-mobile size. The 320 check covered the timeout result, not another complete journey.
- Switching to the same-workspace peer returned to `/home` with zero native-demo regions. Returning to the original creator/thread showed a fresh rehearsal without the old receipt.
- Temporary viewport reset; local demonstration tab retained for inspection.

These are synthetic local browser checks, not real authentication, Meta API or Supabase acceptance. No broad full-suite PASS claimed.

## Rulings and remaining limits

1. Native-shaped mock envelopes are internal simulation contracts. Real HTTP, grant identity/revocation and official receipt resolution remain blocked by the protocol review; this work does not clear them.
2. Browser conversion uses generated synthetic pixels only. Production server image validation/conversion and real-upload publishing remain unavailable. No external image processor is called.
3. PNG/JPEG conversion only in this prototype; WebP conversion is deferred, while ordinary manual WebP upload remains unchanged. Cost: WebP is rejected by this conversion helper.
4. Demo proof is page-only and explicitly synthetic. It cannot become native mission evidence or earn rewards. No commit, deployment, SQL application, real provider connection or post was made.

The two growth/publish SQL files and rollback retain their prior hashes:

| File | SHA-256 |
| --- | --- |
| `20261103215321_kocmax_creator_growth_private.sql` | `bfe4fab81bb23198a2f57c804a521b03b83c2a41815acc86f8966ac49b2d0e43` |
| `20261104134202_kocmax_publish_intents.sql` | `d740d13d59e722548d4396639b62f9423ba1b287e42c639032c0f0de09a45eb7` |
| `creator-growth.rollback.sql` | `61c65aed95ca6ebb523bbf8ee91e01ab3543bc0c4b60d3e7524f0585b66d30cd` |

Git index remains empty. Existing functions and prior fixes were not replaced; the touched shared UI file adds the development-only panel, and the service test adds adapter compatibility coverage.
