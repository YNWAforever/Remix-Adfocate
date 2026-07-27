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
