# KOCmax stages 1 and 2 — implementation

Approved scope: user approved stages 1 and 2 on 2026-10-31. No deployment, real connections or production database changes.

**Goal:** Deliver the approved responsive public/creator/staff shells and one evidence-backed task journey, using the existing submission, review, proof and reward contracts.

**Architecture:** Add an opt-in studio surface and private, owner-scoped thread/evidence/brief records. Keep existing canonical workflow screens and services. Promotion into a mission draft is an explicit version-bound operation; neither chat nor saving a brief awards money, points or XP. Public mission previews use a separate allowlist. Local verification uses fixtures and an isolated PostgreSQL-compatible test database.

**Tech stack:** Existing React 19, TanStack Router/Query, Tailwind 4, Hono, Supabase/Postgres, Vitest and PGlite. No new external provider.

**Spec:** `../specs/2026-10-31-kocmax-full-product-design.md`; approved master plan and function audit in the same documentation tree.

**Global constraints:** Base `a20b29e2691929f47b26ea9505082bb0882fc404`; branch `codex/kocmax-studio-stages-1-2`; original checkout untouched; flags off by default; private content never placed in browser-wide persistent storage; no widening existing mission/auth/staff access; additive migrations only, unapplied to remote databases. Preserve consent, account export/deletion, loaded-version conflicts, pagination, notification retries, frozen contracts and idempotent settlement.

**Review focus (five failure modes):**
1. Public or staff projection leaks private/financial data: allowlist and role-denial tests.
2. A creator reads another thread or shares a stale/revoked source: owner/workspace, revision and lineage tests at service and SQL boundaries.
3. A conversation triggers workflow or reward writes: explicit proposal/confirmation tests; existing transition/settlement regressions.
4. Lost responses duplicate drafts, shares or badges: idempotency/replay/conflict tests and unique database constraints.
5. Mobile/auth navigation strands users or hides actions: safe-next/signup tests, all-route inventory, browser checks at 320/390/430/768/1024/1440 and keyboard/reduced motion.

## Tasks

1. Baseline and protection: capture current tests, copy approved documents, inventory routes and keep release/integration gates. Record every deviation in `.superpowers/sdd/kocmax-stages-1-2/progress.md`.
2. Foundation: new `src/lib/studio` policy/status/navigation, scoped `src/components/studio` shell/tokens and feature flags; retain old shells behind flags. Verify role projections and unchanged routes.
3. Visitor/auth: replace opt-in public homepage and creator/brand landings, add safe public mission projection, signup mode and safe return-to-task. Preserve consent/onboarding/reset/login methods and account controls.
4. Private studio persistence: additive SQL migration plus `server/lib/studio` and `server/routes/studio.ts`; thread topics, manual evidence, immutable brief versions, source lineage, explicit share receipts and canonical draft reference. Include export/anonymisation. Test owner isolation, stale revisions, revoked sources and retry semantics before wiring UI.
5. Creator journey: query layer, task cards, composer/history, evidence panel, brief editor and per-item sharing; bridge to the existing mission workspace and preserve original review/proof/completion/settlement screens. No real connector; explicit unavailable/unknown data.
6. Staff/reward journey: common responsive shell and capability-safe overview, preserve recent workflow services, expose receipt-derived achievement after successful canonical settlement/legacy credit. No new points or XP rules.
7. Verification: build/lint/typecheck, all unit/regression tests, isolated SQL contracts, in-app browser local fixture walkthrough on mobile and desktop. Fresh whole-branch review and fix important findings. Document runtime/deployment limits and leave branch unmerged/unpublished.

## Acceptance evidence

Record commands, results and screenshots in `docs/review/kocmax-stages-1-2/verification.md`. Distinguish source, local SQL, mock-browser, integration and production evidence. Skipped external tests are not passes. Stage 3 full-screen migration and stage 4 OAuth remain out of scope.
