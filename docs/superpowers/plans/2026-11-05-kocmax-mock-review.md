# Mock receipt review continuation

User authorized continuing on the same branch with mocks, preserving existing functions/fixes and mobile/desktop verification. No SQL, deployment, real connections or commits.

Design: extend the page-only native rehearsal after its explicit proof confirmation. A read-only evidence card retains the exact converted image, caption, SHA and media receipt. Explicit developer simulation buttons select verified or needs-information. These are fixtures, never reviewer authority. No point/XP/badge or mission mutation. Unknown receipts cannot enter review. Terminal decisions cannot contradict one another; repeated identical simulation is idempotent. Owner, fingerprint and proof nonce remain bound; cancellation clears the rehearsal. A needs-information result directs editing into a new preview/confirmation, never republishes automatically.

Implementation: add journey tests first, implement review/snapshot methods, then UI tests and evidence/result cards. Preserve existing uploader and earlier demonstration. Add production marker assertions. Run focused and existing UI/handoff tests, TypeScript/lint/build, browser mobile/desktop and one independent review.

Scope ruling: no actual review role or persistence is introduced. This completes a rehearsal of the existing review concept and does not alter native mission states or clear live adapter/protocol blockers. The cost is that real reviewer acceptance remains untested.

Completed locally: 166 tests, type/lint/build boundary, mobile/desktop browser journey and independent review pass. Evidence: `docs/review/kocmax-stage-5/mock-review.md`. No commit, SQL, deployment or real connection.
