# Mock local revocation rehearsal

User authorized next mock phase on the same branch. Add owner-scoped local revocation to the existing isolated rehearsal. Immediately invalidate previews, proof/review/export access and late async completion. Preserve a minimal classification of prior outcome: not requested, published, or unknown. Repeated revoke is idempotent. Revocation never means an already accepted post was deleted; downloaded files remain with their owner.

UI: explicit “simulate revoke” action available during the demo, followed by a stopped notice and prior-outcome explanation. Clear all content/Blob URLs. New rehearsal requires an explicit restart, new preparation and confirmation. Never call real provider revoke or change original account/mission state. No SQL, deployment, real connections, posts or commits.

Tests first: pre-confirmation revoke, post-receipt revoke, unknown outcome, wrong owner, late conversion/publish continuation; UI controls and URL cleanup. Then focused regressions/build marker exclusion/type/lint, mobile/desktop and one independent review. Live provider revocation blockers remain unchanged.

Implemented locally. Final independent review found no actionable bugs; its noted delayed-receipt coverage gap was filled. Mobile/desktop evidence and test details: `docs/review/kocmax-stage-5/mock-revocation.md`. No commit or external operation.
