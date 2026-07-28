# Release Task 5B Report: Publication Proof Analytics Wiring

## Status

Implemented the nine approved publication-proof analytics events with closed-domain,
privacy-safe payloads at canonical creator and operator success boundaries.

Planned commit: `feat: emit publication proof analytics`

## Graph findings

- `CreatorMissionWorkspace` is the sole caller of `useSubmitPublicationProof`.
- `retryPreservedProof` is the canonical creator stale-conflict recovery path.
- `PublicationProofReview` owns operator claim, correction, metadata refresh, and
  verification actions.
- The operator `perform` helper catches action errors, so success telemetry is invoked
  inside `perform` only after the awaited mutation resolves.
- The admin detail response includes `missions(*)`; `mission_type` is therefore the
  canonical operator mission-type source.
- Platform, work-item state, proof attempt number, review number, publication deadline,
  and review SLA are sourced from canonical workflow/publication data.

## Event mapping

| Event | Canonical emission boundary |
| --- | --- |
| `publication_instructions_viewed` | Publication details become available; deduplicated once per mounted work item. |
| `publication_proof_form_started` | First real form focus/change interaction; component and route deduplication prevent rerender duplicates. |
| `publication_proof_submitted` | Initial proof mutation resolves with canonical attempt number 1. |
| `publication_proof_metadata_unavailable` | A successful submit/refresh result reports the exact `unavailable` outcome. |
| `publication_proof_review_started` | Operator claim mutation resolves successfully. |
| `publication_proof_correction_requested` | Correction mutation resolves successfully; only closed correction categories are emitted. |
| `publication_proof_resubmitted` | Proof mutation resolves with canonical attempt number greater than 1. |
| `publication_proof_verified` | Verification mutation resolves successfully. |
| `publication_proof_recovery_used` | A stale-conflict retry or metadata recovery action resolves successfully. |

## Closed domains and timing

- Unsupported platforms map to `other`.
- Unsupported mission types or work-item states suppress telemetry rather than emit
  open-ended values.
- Creator timing uses `late`, `within_24h`, or `on_time` from the frozen publication
  deadline.
- Operator timing uses `within_sla` or `late` from proof submission time and the
  workflow review SLA.
- Metadata status is reduced to `available` or `unavailable`.

## Privacy and duplicate evidence

- Payloads contain only locale, closed mission/platform/state/timing categories,
  bounded counts, canonical attempt/review numbers, metadata status, recovery category,
  and closed checklist-failure categories.
- Tests assert that work-item, workflow, submission, attempt IDs, URLs, account handles,
  authored instructions/correction prose, evidence paths, and error detail do not enter
  analytics payloads.
- Tests cover rerender duplicate suppression, first-interaction form start, success-only
  mutation events, initial/resubmission distinction, and actual recovery-only behavior.

## Files

- `src/lib/publicationProofAnalytics.ts`
- `src/components/active-mission/ProofSubmissionForm.tsx`
- `src/routes/_app.my.$submissionId.tsx`
- `src/components/admin/PublicationProofReview.tsx`
- `src/routes/-_app.my.$submissionId.test.tsx`
- `src/routes/-admin.active-missions.test.tsx`

## TDD and verification

RED:

`npm.cmd test -- --run 'src/routes/-_app.my.$submissionId.test.tsx' 'src/routes/-admin.active-missions.test.tsx'`

- 2 files failed; 10 failed and 18 passed before production wiring.

GREEN:

`npm.cmd test -- --run 'src/routes/-_app.my.$submissionId.test.tsx' 'src/routes/-admin.active-missions.test.tsx'`

- 2 files passed; 28 passed and 0 failed.

Type-check:

`npm.cmd run type-check`

- Passed. The command retains the repository's existing `_site.smoke.test.tsx` route-file
  warning.

Focused lint:

`npm.cmd exec -- eslint 'src/components/active-mission/ProofSubmissionForm.tsx' 'src/routes/-_app.my.$submissionId.test.tsx' 'src/routes/-admin.active-missions.test.tsx' 'src/routes/_app.my.$submissionId.tsx' 'src/lib/publicationProofAnalytics.ts'`

- Passed.
- Linting `PublicationProofReview.tsx` also reports an untouched pre-existing
  `jsx-a11y/no-noninteractive-element-interactions` error at its alert-dialog wrapper
  and an untouched `react-hooks/exhaustive-deps` warning. Neither reported line is part
  of this task's diff.

## Self-review

- No SQL, reward, workflow-transition, or API-contract changes.
- All mutation outcomes emit only after awaited success.
- Form-start emission is tied to first real interaction rather than mount.
- Attempt and review numbers come from mutation results with canonical workflow fallback.
- `git diff --check` is clean after removing a test EOF artifact.

## Concerns

No Task 5B behavior concerns. The two admin-component lint findings above remain baseline
repository debt outside this task's touched lines.
## Review correction wave

### Root causes

1. `publicationResultMetadataStatus` parsed only top-level status fields, while the
   canonical refresh RPC returns `{ attempt: { metadata_status }, idempotent }`.
2. The stale-conflict retry had a separate recovery-only analytics path and bypassed
   the canonical proof submission outcome instrumentation.
3. Metadata refresh emitted `publication_proof_recovery_used` after every successful
   request instead of requiring a real unavailable-to-available transition.

### Corrections

- Metadata result parsing now supports nested attempt camel/snake-case status fields
  and retains the legitimate top-level shapes as fallbacks.
- Normal proof submit and stale-conflict retry share one successful proof-outcome
  instrumentation function. Retry now emits exactly one submitted/resubmitted event,
  metadata-unavailable when returned by the canonical attempt, and then recovery-used.
- Metadata recovery now requires prior `unavailable` plus returned `available`.
  Returned `unavailable` emits metadata-unavailable without claiming recovery;
  available-to-available emits neither event.

### Lifecycle coverage

- React StrictMode effect replay does not duplicate instruction views.
- Rerender and repeated focus/change do not duplicate view or form-start events.
- Switching to a new work item emits one new instruction view and first-interaction
  form-start for that item.
- A genuine unmount/remount starts a fresh mounted-work-item lifecycle and may emit
  its own view and first-interaction events.

### Review RED

Command:

`npm.cmd test -- --run 'src/routes/-_app.my.$submissionId.test.tsx' 'src/routes/-admin.active-missions.test.tsx'`

Result:

- 2 files failed.
- 5 tests failed and 27 passed.
- Failures proved missing retry outcome events, incorrect nested refresh parsing,
  unconditional recovery emission, and the missing available-to-available guard.

### Review GREEN

Command:

`npm.cmd test -- --run 'src/routes/-_app.my.$submissionId.test.tsx' 'src/routes/-admin.active-missions.test.tsx'`

Result:

- 2 files passed.
- 32 tests passed and 0 failed.
- No unhandled test errors.

### Review verification

- `npm.cmd run type-check`: passed, with the existing `_site.smoke.test.tsx`
  route-file warning.
- Focused ESLint passed for the helper, creator route, and both covering test files.
- `PublicationProofReview.tsx` retains the same untouched baseline alert-dialog
  accessibility error and hook-dependency warning outside the review diff.
- `git diff --check`: clean.

Follow-up commit message: `fix: correct publication proof analytics outcomes`
