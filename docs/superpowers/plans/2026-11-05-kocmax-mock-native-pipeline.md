# Mock native publishing pipeline

Authorized scope: same branch, mock providers, image conversion and receipt handoff; preserve existing fixes; verify mobile/desktop. No deployment, SQL, real connections, commits or external image processing.

1. Add an InstagramPublisher-compatible adapter over a closed in-memory native-shaped mock transport. Validate target and receipt shapes, bound errors, keep sampleOnly true/null permalink, and exercise existing service compatibility. No URL/token/HTTP or live mode.
2. Add bounded browser-local PNG/JPEG to JPEG preparation with a fixed synthetic image in the development flow. Compute digest after conversion, show final bytes in confirmation, reject bad dimensions/type/size and stale async results. Unit-test the injectable codec boundary; verify actual browser conversion separately. WebP remains available in the existing manual upload flow, but is outside this conversion prototype.
3. Add an explicitly synthetic receipt-to-demo-proof handoff with one-use confirmation and no rewards. Keep real MissionProofHandoff sample rejection unchanged. Tie preview, receipt and demo proof to one owner/session/content version; no original API submission.
4. Add a development-only mobile/desktop journey, preserve existing mock demo and ordinary upload/manual flow. Confirm production tree-shaking excludes the new demo. Run focused tests, TypeScript/lint, production boundary build, browser checks and one final independent review.

Rulings: native-shaped mock operation envelopes are internal simulation contracts, not claims about verified Meta endpoints. Actual HTTP, grant resolution, provider revoke, official receipt verification and production image processing remain blocked by the existing protocol review. Local browser conversion of generated synthetic pixels is authorized and involves no provider. Real uploaded images remain outside the publishing demo.

Ruling: scope this prototype's decoder to PNG/JPEG; WebP conversion is deferred. The fixed synthetic PNG journey is sufficient for the approved mock rehearsal; the cost is that WebP cannot enter this conversion helper. Existing manual WebP upload is preserved. This resolves the final review's P3 plan discrepancy.

Execution ledger: implemented and locally verified; see docs/review/kocmax-stage-5/mock-native-pipeline.md. Preserve historical evidence and the preceding71-file manifest. No commit or cleanup of evidence because the user's continuation requires preserving the current worktree.
