# B1 — mission workspace rebuild plan

Status: started 2026-11-09. Page: `/my/$submissionId` (`src/routes/_app.my.$submissionId.tsx`). Goal: rebuild
the creator mission workspace on the studio design system (`s-*` components in
`src/components/studio/studio.css`) without changing the workflow or server contracts.

## Current state

- ~100 KB legacy route with Tailwind + a few studio primitives (`StudioProgress`).
- Sections: mission header, deliverable navigator, editor card, requirement checklist, upload,
  submission, review/revision, publication instructions, proof upload/verification, version timeline.
- Layout issues already patched: compact stepper, single-deliverable full-width editor, no nested `<main>`.

## Phases (each independently shippable)

### B1.1 — Shell, header, progress (done)
- `WorkspaceHeader`: `s-page-head` card with mission title, status tag, deadline, cash/points summary,
  primary action; remove duplicated labels.
- `StudioProgress`: keep, now compact; move to a `s-card s-stack` with clearer current step.
- Page wrapper: `s-stack` spacing, no legacy `main`.
- Acceptance: fixture screenshot 1440/390, no overflow, height reduced, one H1, studio typography.

### B1.2 — Deliverables + editor frame (done)
- `DeliverableNavigator` rebuilt as `s-tabs`/`s-card` list (desktop) and horizontal scroll (mobile),
  showing status, requirement count and blocked reason.
- Editor card shell: heading block (deliverable title, format tag, state), field group spacing.
- Draft save / external URL / requirement checklist styled as `s-field` + `s-list-check`.
- Acceptance: keyboard nav preserved (existing roving tabindex tests), textareas bounded, autosave
  status visible only when dirty/saving.

### B1.3 — Versions, review and revision (done)
- Version timeline as `s-card` list with event icons; review feedback as callout (`s-note`/`s-callout`).
- Revision request state: distinct callout, remaining attempts, retry action.
- Acceptance: tests for revision-request and version selection states.

### B1.4 — Publication and proof (done)
- Publication instructions as numbered checklist; "publish" and "submit proof" actions grouped.
- Proof upload: file input, preview, existing evidence grant flow; verification status callout.
- Acceptance: no upload path changes; E2E with fixture revisions.

### B1.5 — Mobile, a11y, cleanup
- 390/768/1024 layout pass; min 44px targets; focus order; reduced-motion.
- Remove now-unused legacy block components; keep route logic untouched.
- Acceptance: Playwright viewport sweeps + axe-lite checks; Visual audit archived.

## Invariants

- Server contracts unchanged: active-mission queries, mutations, RLS and payload shapes stay as-is.
- All text via existing i18n keys; no new hard-coded copy beyond test labels.
- Workflow semantics untouched (drafts, revisions, publication, proof).
- No writes from the studio chat; this page remains the only place submission data changes.

## Risks

- Route file is large; extract presentational components first, keep selectors/mutations in the route.
- Existing tests target legacy text; update assertions per phase rather than rewriting tests.
- Fixture data must cover multi-deliverable and revision states; extend fixtures only if needed.
