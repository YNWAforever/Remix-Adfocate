# Saved Output Mock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native implementation, or superpowers:subagent-driven-development if selected by the user. Steps use checkboxes for tracking.

**Goal:** Add private Brief cards, safe version preview and copy-to-unsaved-draft inside existing Studio.

**Architecture:** A pure policy module validates current source lineage and constructs copies. A presentational card component exposes only sanitized previews. StudioWorkspace owns replacement confirmation, editor state and existing save/share commands. No new persistence or API.

**Tech Stack:** React, TypeScript, TanStack Query/Router, Vitest, existing Studio CSS and development fixture.

**Spec:** docs/superpowers/specs/2026-11-05-kocmax-saved-output-mock.md

## Global Constraints

- Remain on codex/kocmax-studio-stages-1-2; preserve dirty baseline. No staging/commits without separate request.
- No deploy, SQL application, real connections, real Auth account or authoritative mission/reward writes.
- New mock examples must stay in development fixtures and out of production builds.
- Copies retain sourceIds and privacy, never sharing consent or original section ids.
- Missing/revoked/cross-thread source makes the whole version uncopyable; hide affected paragraph text in both card snippets and expanded preview.
- No source rights escalation. Private usable sources remain editable, not shareable.
- Pending/unknown command outcomes remain bound to their existing request; copying cannot reset them.
- Interpret spec phrase about pending commands as **do not clear pending requests to enable copying**.

## Review Focus

1. Source revoked while replacement confirmation is open: revalidate at final copy, do not reuse a stale snapshot (Task1/3 tests).
2. Refetched version disappears or changes: resolve selected id against latest detail before copying (Task3).
3. Empty/invalid sections or duplicate ids: reject copy without changing editor; fresh ids generated through injected factory (Task1).
4. Historical snippet leaks unavailable derived text: sanitize card and preview from same policy result (Task2).
5. Delayed save/share changes after copy attempt: pending request blocks copy and no stale receipt survives an accepted copy (Task3).

## Task 1: Copy and preview policy

**Files:** create src/lib/studio/savedOutputs.ts and savedOutputs.test.ts. Consume StudioBrief, StudioSource, StudioSection from existing types.ts.

**Interfaces:**
- `inspectSavedBrief(brief: StudioBrief, threadId: string, sources: StudioSource[]): { copyable: boolean; unavailableSourceIds: string[]; sections: Array<{ id: string; text: string | null; sourceIds: string[] }> }`
- `copySavedBrief(brief: StudioBrief, threadId: string, sources: StudioSource[], newId: () => string): StudioSection[]`; throw `BRIEF_UNAVAILABLE` on invalid lineage/content. Deep copy each sourceIds array; no mutation of input.

- [x] Write tests: valid private/nonshareable source allowed; revoked/missing/foreign source blocks all-copy and redacts affected preview only; cross-thread brief blocked; empty text/sections, duplicate section ids rejected. Assert copied ids differ, sourceIds equal but arrays independent, source.shareable unchanged. Validate returned identifiers from newId are unique and not original ids.
- [x] Run `node node_modules/vitest/vitest.mjs run src/lib/studio/savedOutputs.test.ts --reporter=dot`; expect initial failure for missing module.
- [x] Implement policy using current source metadata, without network/storage effects. Apply existing section count/text limits (12/3000); do not invent verification status.
- [x] Rerun focused test; expect PASS.

Required assertion examples (fixtures use the existing Studio types):

```ts
const sections = copySavedBrief(brief, brief.thread_id, [privateSource], () => "new-section");
expect(sections[0].sourceIds).toEqual(brief.sections[0].sourceIds);
expect(sections[0].sourceIds).not.toBe(brief.sections[0].sourceIds);
expect(sections[0].id).not.toBe(brief.sections[0].id);
const revoked = { ...privateSource, revoked_at: "2026-11-05T00:00:00Z" };
expect(inspectSavedBrief(brief, brief.thread_id, [revoked]).sections[0].text).toBeNull();
expect(() => copySavedBrief(brief, brief.thread_id, [revoked], () => "new-section"))
  .toThrow("BRIEF_UNAVAILABLE");
```

Use a one-section Brief citing privateSource for this fixture. Wrong-thread brief must expose **no paragraph text**, even for source-free paragraphs. Duplicate source ids in the supplied source registry are ambiguous: reject references to those ids rather than selecting an arbitrary record.

## Task 2: Saved output cards

**Files:** create src/components/studio/SavedOutputCards.tsx and SavedOutputCards.test.tsx; modify studio.css for scoped responsive classes.

**Interface:** `SavedOutputCards({threadId, briefs, sources, disabledReason, onCopy}: {threadId:string; briefs:StudioBrief[]; sources:StudioSource[]; disabledReason?:string; onCopy:(briefId:string)=>void})`.

- [x] Write tests for private cards/version/date/latest label, empty list, unavailable paragraph redaction in snippet and expanded preview, read-only expansion without onCopy calls, disabled reason, long labels and unique accessible copy button names per version.
- [x] Run `node node_modules/vitest/vitest.mjs run src/components/studio/SavedOutputCards.test.tsx --reporter=dot`; expect FAIL before implementation.
- [x] Implement using Task1 policy for both snippet and preview, native details/summary, 44px actions, wrapping source labels and no raw HTML. Derive latest from highest version, not assumed display order. Show existing loaded-history limitation.
- [x] Rerun focused test; expect PASS.

## Task 3: Editor copy/replacement integration

**Files:** modify src/components/studio/StudioWorkspace.tsx and StudioWorkspace.test.tsx. Replace only existing saved Brief list with Task2 cards, preserve surrounding workflow.

**Interfaces:** onCopy receives briefId only; resolve latest detail and call Task1 at the moment replacement is accepted. Parent owns `pendingCopyId: string|null` and `copiedFromVersion: number|null`.

State rules: disable copies while command.isPending or pendingCommand.current is non-null. Read the ref again in both request-copy and confirm-replacement handlers. Setting pending/feedback state must trigger a rerender so the button accurately reflects an unresolved request. Keep the original requestId on retry. Do not add a dismiss control that silently clears unknown results.

On successful save, synchronize copiedFromVersion against the returned saved Brief/new canonical detail: the badge must stop saying "未保存" once that exact draft was saved. A failed save keeps the copied draft and origin badge. Do not replace local edits with a background refetch. Tests must exercise save response arriving before and after detail refetch and a subsequent local edit.

- [x] Tests: clean editor copy opens Brief tab with fresh ids/sourceIds; dirty editor presents inline Keep/Replace, Keep leaves state unchanged; Replace revalidates latest source and version existence. No POST until explicit existing save action.
- [x] Tests: pending save/share or unresolved pendingCommand prevents copy; accepted copy clears selected, confirmed, confirmedKey, submissionId, workItemId and receipt, but never clears an outstanding request. Existing save/version conflict behavior retained.
- [x] Tests: copy badge remains unsaved even identical text because ids differ; save creates next private version in fixture; old Brief immutable. Source revoked while choice open blocks replacement; identity/thread change or401 removes private preview/confirmation.
- [x] Run `node node_modules/vitest/vitest.mjs run src/components/studio/StudioWorkspace.test.tsx --reporter=dot`; expect new tests FAIL initially.
- [x] Implement callback/inline replacement choice, sanitized feedback and new draft provenance badge. Preserve existing navigation guards; focus Brief heading after successful copy only. Do not rebase revision silently on a background update.
- [x] Add keyboard test: dismissing replacement returns focus to its initiating card button; successful replacement focuses the Brief heading with tabIndex=-1; background refetch never steals focus.
- [x] Rerun Task1–3 tests; expect PASS.

## Task 4: Fixture and integrated acceptance

**Files:** modify src/test/studioPreview.ts, src/test/studioPreviewOwnership.test.ts and scripts/creator-growth-bundle-boundary.test.ts; add docs/review/kocmax-stage-5/saved-output-mock.md.

- [x] Add a dedicated owner-only synthetic thread with two Brief versions, one manual source and one private/nonshareable source. Use a distinct fixed UUID and unique marker `SAVED_OUTPUT_MOCK_ONLY`, register it in the fixture history and its existing authorization lookup, and add that marker to production exclusion. Preserve the original default thread and all peer-denial fixtures.
- [x] Test fixture read/copy/save creates a new version without changing prior versions or awarding rewards. Add unique example strings to production exclusion markers. Expect initial failures then PASS after fixture additions.
- [x] Run `node node_modules/vitest/vitest.mjs run src/components/studio src/components/integrations src/lib/studio src/test/studioPreviewOwnership.test.ts scripts/creator-growth-bundle-boundary.test.ts --maxWorkers=4 --minWorkers=1 --reporter=dot`; require all selected tests PASS, including fixture-off production build.
- [x] Run `node node_modules/typescript/bin/tsc --noEmit --pretty false`, then `node node_modules/eslint/bin/eslint.js src/lib/studio/savedOutputs.ts src/lib/studio/savedOutputs.test.ts src/components/studio/SavedOutputCards.tsx src/components/studio/SavedOutputCards.test.tsx src/components/studio/StudioWorkspace.tsx src/components/studio/StudioWorkspace.test.tsx src/test/studioPreview.ts src/test/studioPreviewOwnership.test.ts scripts/creator-growth-bundle-boundary.test.ts`. Require exit0; report unrelated baseline failures separately rather than hiding them.
- [x] In-app browser390x844 and1440x1000: preview old card, copy, edit, preserve/cancel replacement, explicitly replace, fixture-save, confirm old/new versions and privacy; check source unavailable behavior, owner switch/401 and keyboard focus. No real account, save or connection calls.
- [x] Save screenshots and evidence, restore normal fixture/default viewport. Independent review of this feature's working diff only; fix material findings with failing regression tests before final report.

## Self-review and handoff

Spec coverage maps policy/privacy to Task1, cards/layout to Task2, editing/command safety to Task3 and fixture/browser/build checks to Task4. Interfaces are shared above; no SQL/API work required. Recommendation: native execution because card and editor interfaces are tightly coupled, followed by one independent review. This is an implementation plan, not completed functionality. Await plan review before implementation under writing-plans handoff.

Second self-review completed: made wrong-thread redaction and duplicate-source handling explicit; specified pending-command rerender, saved-copy badge synchronization, keyboard focus and dedicated fixture isolation. No implementation or test execution is claimed by this planning artifact. Task commits are intentionally omitted under the existing no-commit instruction.

## Execution note (2026-11-06)
Native selected by user. See docs/review/kocmax-stage-5/saved-output-mock.md for final evidence and remaining minor focus issue. Plan checkboxes describe completed work with that explicit exception; no commits or remote writes.
