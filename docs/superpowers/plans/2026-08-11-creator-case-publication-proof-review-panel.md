
# Creator Case Publication-Proof Review Panel Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a dedicated operator-facing publication-proof review panel to the Creator Case detail route, using the existing repository-backed review command.

**Architecture:** Extend the focused src/lib/creatorCase.ts client boundary with proof projection types and one typed POST adapter. Add a standalone PublicationProofReviewPanel that owns per-attempt rendering, feedback validation, retry-safe command IDs, and safe API errors. Keep src/routes/operator.creators.$creatorId.tsx responsible only for supplying the read model and invalidating its existing detail query after success.

**Tech Stack:** React 19, TypeScript, TanStack React Query 5, Vitest 2, Testing Library React, existing adminFetch transport, existing Tailwind utility classes.

## Global Constraints

- Only the current submitted publication-proof attempt is actionable.
- changes_requested requires a trimmed, non-empty operator message; verified does not.
- All commands must include submission_id, work_item_id, attempt_id, decision, message, and an idempotency command_id.
- The client must call /api/admin/creators/:creatorId/publication-proof/review?workspace=:workspaceId through adminFetch; the component must not issue raw fetch calls.
- On success, invalidate ["admin-creator-detail", creatorId, workspace]; do not optimistically rewrite the proof projection.
- Keep publication-proof decisions separate from generic Creator review status, risk, notes, shortlist state, rewards, and payouts.
- Do not modify the Creator Case server repository, RPC, migration, or error vocabulary in this slice.
- Do not add evidence upload, metadata inspection, provider-backed verification, production seeding, migration application, or deployment.
- Preserve unrelated local and untracked workspace artifacts; stage only files named by each task.

---

## File map

| File | Responsibility | Change |
| --- | --- | --- |
| src/lib/creatorCase.ts | Focused Creator Case client types and request construction | Modify |
| src/lib/creatorCase.test.ts | Exact request and workspace-boundary client tests | Modify |
| src/components/operator/PublicationProofReviewPanel.tsx | Proof-card rendering, review actions, validation, retry state, safe errors | Create |
| src/components/operator/PublicationProofReviewPanel.test.tsx | Component state and mutation behavior tests | Create |
| src/routes/operator.creators.$creatorId.tsx | Supply proof projections and invalidate the detail query | Modify |
| src/routes/-operator.creators.$creatorId.test.tsx | Detail-route fixture and panel integration coverage | Modify |

No server files or database migrations are part of this implementation plan.

## Task 1: Add the focused Creator Case proof-review client contract

**Files:**
- Modify: src/lib/creatorCase.ts
- Test: src/lib/creatorCase.test.ts

**Interfaces:**
- Consumes: existing CreatorCaseDetailResponse, creatorPath, commandIdOrNew, and adminFetch.
- Produces: CreatorCasePublicationProofAttemptState, CreatorCasePublicationProofDecision, CreatorCasePublicationProofAttempt, CreatorCasePublicationProof, CreatorCasePublicationProofReviewInput, postCreatorPublicationProofReview, and optional publicationProofs on CreatorCaseDetailResponse.

- [ ] Step 1: Write the failing adapter test

Add this test and import to the existing src/lib/creatorCase.test.ts suite:

~~~tsx
import {
  fetchCreatorDetail,
  fetchCreatorReviewQueue,
  postCreatorNote,
  postCreatorPublicationProofReview,
  postCreatorReview,
} from "./creatorCase";

it("sends the complete workspace-scoped publication-proof review command", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ publicationProof: null }),
  });

  const result = await postCreatorPublicationProofReview(
    "workspace-1",
    "creator-1",
    {
      submissionId: "submission-1",
      workItemId: "work-item-1",
      attemptId: "attempt-1",
      decision: "changes_requested",
      message: "Use the public campaign post URL.",
    },
    "proof-command-1",
  );

  expect(result).toEqual({ publicationProof: null });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/creators/creator-1/publication-proof/review?workspace=workspace-1",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        command_id: "proof-command-1",
        submission_id: "submission-1",
        work_item_id: "work-item-1",
        attempt_id: "attempt-1",
        decision: "changes_requested",
        message: "Use the public campaign post URL.",
      }),
    }),
  );
});
~~~

- [ ] Step 2: Run the focused client test to verify it fails

Run:

~~~powershell
node node_modules/vitest/vitest.mjs run src/lib/creatorCase.test.ts
~~~

Expected: FAIL because postCreatorPublicationProofReview and its proof-review types do not yet exist.

- [ ] Step 3: Add the proof projection types and adapter

Place the types beside the existing Creator review types and add the function beside postCreatorReview:

~~~ts
export type CreatorCasePublicationProofAttemptState =
  | "draft"
  | "submitted"
  | "verified"
  | "changes_requested";

export type CreatorCasePublicationProofDecision = "verified" | "changes_requested";

export type CreatorCasePublicationProofAttempt = {
  id: string;
  submissionId: string;
  workflowId: string;
  workItemId: string;
  creatorId: string;
  workspaceId: string;
  parentAttemptId: string | null;
  sequence: number;
  publishedUrl: string;
  platform: string | null;
  state: CreatorCasePublicationProofAttemptState;
  operatorMessage: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
};

export type CreatorCasePublicationProof = {
  submissionId: string;
  workflowId: string;
  workItemId: string;
  creatorId: string;
  workspaceId: string;
  currentAttempt: CreatorCasePublicationProofAttempt | null;
  history: CreatorCasePublicationProofAttempt[];
};

export type CreatorCasePublicationProofReviewInput = {
  submissionId: string;
  workItemId: string;
  attemptId: string;
  decision: CreatorCasePublicationProofDecision;
  message?: string | null;
};

export function postCreatorPublicationProofReview(
  workspaceId: string,
  creatorId: string,
  body: CreatorCasePublicationProofReviewInput,
  commandId?: string,
) {
  return adminFetch<{ publicationProof: CreatorCasePublicationProof | null }>(
    creatorPath(workspaceId, "/admin/creators/" + creatorId + "/publication-proof/review"),
    {
      method: "POST",
      body: JSON.stringify({
        command_id: commandIdOrNew(commandId),
        submission_id: body.submissionId,
        work_item_id: body.workItemId,
        attempt_id: body.attemptId,
        decision: body.decision,
        message: body.message ?? null,
      }),
    },
  );
}
~~~

Add publicationProofs?: CreatorCasePublicationProof[] to CreatorCaseDetailResponse. Keep it optional at the client boundary because older or degraded responses may omit the projection; the panel will treat omission as an empty list.

- [ ] Step 4: Run the client contract tests to verify they pass

~~~powershell
node node_modules/vitest/vitest.mjs run src/lib/creatorCase.test.ts
~~~

Expected: all existing Creator Case client tests plus the new exact-payload test pass.

- [ ] Step 5: Commit the client contract

~~~powershell
git add src/lib/creatorCase.ts src/lib/creatorCase.test.ts
git commit -m "feat: add creator case proof review client contract"
~~~

## Task 2: Add read-only proof-card rendering and state coverage

**Files:**
- Create: src/components/operator/PublicationProofReviewPanel.tsx
- Test: src/components/operator/PublicationProofReviewPanel.test.tsx

**Interfaces:**
- Consumes: CreatorCasePublicationProof[] from @/lib/creatorCase.
- Produces: PublicationProofReviewPanel with props { workspaceId: string; creatorId: string; publicationProofs?: CreatorCasePublicationProof[]; onSuccess?: () => void }.

- [ ] Step 1: Write failing render tests for empty, draft, verified, and history states

Create the test file with deterministic attempt factories and a minimal render helper. Establish the public labels used by later action tests:

~~~tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CreatorCasePublicationProof, CreatorCasePublicationProofAttempt } from "@/lib/creatorCase";
import { PublicationProofReviewPanel } from "./PublicationProofReviewPanel";

const attempt = (overrides: Partial<CreatorCasePublicationProofAttempt> = {}): CreatorCasePublicationProofAttempt => ({
  id: "attempt-1",
  submissionId: "submission-1",
  workflowId: "workflow-1",
  workItemId: "work-item-1",
  creatorId: "creator-1",
  workspaceId: "workspace-1",
  parentAttemptId: null,
  sequence: 1,
  publishedUrl: "https://example.com/published-post",
  platform: "instagram",
  state: "submitted" as const,
  operatorMessage: null,
  submittedAt: "2026-08-11T00:00:00.000Z",
  decidedAt: null,
  ...overrides,
});

const proof = (currentAttempt: ReturnType<typeof attempt> | null = attempt(), history = []): CreatorCasePublicationProof => ({
  submissionId: "submission-1",
  workflowId: "workflow-1",
  workItemId: "work-item-1",
  creatorId: "creator-1",
  workspaceId: "workspace-1",
  currentAttempt,
  history,
});

describe("PublicationProofReviewPanel", () => {
  it("renders an empty state when the case has no proofs", () => {
    render(<PublicationProofReviewPanel workspaceId="workspace-1" creatorId="creator-1" publicationProofs={[]} />);

    expect(screen.getByRole("heading", { name: "Publication proof review" })).toBeInTheDocument();
    expect(screen.getByText("No publication proofs linked to this creator case.")).toBeInTheDocument();
  });

  it("renders a submitted proof without changing its state", () => {
    render(<PublicationProofReviewPanel workspaceId="workspace-1" creatorId="creator-1" publicationProofs={[proof()]} />);

    expect(screen.getByText("https://example.com/published-post")).toBeInTheDocument();
    expect(screen.getByText("submitted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify publication proof" })).toBeInTheDocument();
  });
});
~~~

- [ ] Step 2: Run the new component tests to verify they fail

~~~powershell
node node_modules/vitest/vitest.mjs run src/components/operator/PublicationProofReviewPanel.test.tsx
~~~

Expected: FAIL because the panel module does not exist.

- [ ] Step 3: Implement the read-only panel shell and proof-state rendering

Create the exported component with this prop contract and state rules:

~~~tsx
export type PublicationProofReviewPanelProps = {
  workspaceId: string;
  creatorId: string;
  publicationProofs?: CreatorCasePublicationProof[];
  onSuccess?: () => void;
};

export function PublicationProofReviewPanel({ publicationProofs = [] }: PublicationProofReviewPanelProps) {
  return (
    <section aria-labelledby="publication-proof-review-heading" className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <h3 id="publication-proof-review-heading" className="font-heading font-bold">Publication proof review</h3>
      {publicationProofs.length === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">No publication proofs linked to this creator case.</p>
      ) : (
        <div className="space-y-3">
          {publicationProofs.map((publicationProof) => (
            <article key={publicationProof.submissionId + ":" + publicationProof.workItemId} className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase text-[var(--color-soft-ink)]">Work item {publicationProof.workItemId}</span>
                <span className="text-xs font-bold">{publicationProof.currentAttempt?.state ?? "awaiting submission"}</span>
              </div>
              {publicationProof.currentAttempt ? (
                <>
                  <a href={publicationProof.currentAttempt.publishedUrl} target="_blank" rel="noreferrer" className="block break-all text-sm font-bold underline">
                    {publicationProof.currentAttempt.publishedUrl}
                  </a>
                  <p className="text-sm text-[var(--color-soft-ink)]">
                    {publicationProof.currentAttempt.platform ?? "Platform unavailable"} · attempt {publicationProof.currentAttempt.sequence}
                  </p>
                </>
              ) : <p className="text-sm text-[var(--color-soft-ink)]">Awaiting creator submission.</p>}
              {publicationProof.history.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-sm font-bold">Attempt history</summary>
                  <ol className="mt-2 space-y-2 text-sm">
                    {publicationProof.history.map((historyAttempt) => (
                      <li key={historyAttempt.id} className="rounded border border-[var(--color-ink)] p-2">
                        Attempt {historyAttempt.sequence}: {historyAttempt.state}
                        {historyAttempt.operatorMessage ? <p>{historyAttempt.operatorMessage}</p> : null}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
~~~

Use the existing visual language from ReviewActionPanel.tsx: ink borders, white cards, small bold labels, and no new dependencies. Do not add action behavior until Task 3.

- [ ] Step 4: Run the read-only component tests to verify they pass

~~~powershell
node node_modules/vitest/vitest.mjs run src/components/operator/PublicationProofReviewPanel.test.tsx
~~~

Expected: the new empty and submitted-state tests pass.

- [ ] Step 5: Commit the read-only panel

~~~powershell
git add src/components/operator/PublicationProofReviewPanel.tsx src/components/operator/PublicationProofReviewPanel.test.tsx
git commit -m "feat: add creator case proof review panel"
~~~

## Task 3: Add decision actions, feedback validation, and retry-safe errors

**Files:**
- Modify: src/components/operator/PublicationProofReviewPanel.tsx
- Test: src/components/operator/PublicationProofReviewPanel.test.tsx

**Interfaces:**
- Consumes: postCreatorPublicationProofReview, CreatorCasePublicationProofDecision, AdminRequestError, and the Task 2 panel props.
- Produces: Verify and Request changes actions that call the existing adapter and invoke the onSuccess callback after success; the route owns the single detail-query invalidation.

- [ ] Step 1: Write failing action and error tests

Add a hoisted mock for postCreatorPublicationProofReview. Import QueryClient and QueryClientProvider from @tanstack/react-query, fireEvent/render/screen/waitFor from @testing-library/react, and add this render helper before the tests. The helper accepts an optional onSuccess callback:

~~~tsx
function renderPanel(
  publicationProofs: CreatorCasePublicationProof[],
  options: { onSuccess?: () => void } = {},
) {
  const queryClient = new QueryClient();
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <PublicationProofReviewPanel
          workspaceId="workspace-1"
          creatorId="creator-1"
          publicationProofs={publicationProofs}
          onSuccess={options.onSuccess}
        />
      </QueryClientProvider>,
    ),
  };
}

it("verifies the current submitted attempt and calls the success callback", async () => {
  const onSuccess = vi.fn();
  mocks.postCreatorPublicationProofReview.mockResolvedValue({ publicationProof: proof(attempt({ state: "verified", decidedAt: "2026-08-11T01:00:00.000Z" })) });

  renderPanel([proof()], { onSuccess });
  fireEvent.click(screen.getByRole("button", { name: "Verify publication proof" }));

  await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledWith(
    "workspace-1",
    "creator-1",
    {
      submissionId: "submission-1",
      workItemId: "work-item-1",
      attemptId: "attempt-1",
      decision: "verified",
      message: null,
    },
    expect.any(String),
  ));
  expect(onSuccess).toHaveBeenCalledTimes(1);
});

it("requires feedback before requesting changes", () => {
  renderPanel([proof()]);

  fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
  expect(screen.getByRole("button", { name: "Send change request" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Proof review feedback" })).toBeInTheDocument();
});

it("reuses the command id when a proof decision is retried", async () => {
  mocks.postCreatorPublicationProofReview
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValueOnce({ publicationProof: proof(attempt({ state: "verified" })) });
  renderPanel([proof()]);

  fireEvent.click(screen.getByRole("button", { name: "Verify publication proof" }));
  await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Retry proof review" }));
  await waitFor(() => expect(mocks.postCreatorPublicationProofReview).toHaveBeenCalledTimes(2));
  expect(mocks.postCreatorPublicationProofReview.mock.calls[0][3]).toBe(mocks.postCreatorPublicationProofReview.mock.calls[1][3]);
});
~~~

Also test AdminRequestError with code proof_attempt_not_submitted renders “This attempt is no longer actionable. Reload the case.” and never exposes the error message.

- [ ] Step 2: Run the action tests to verify they fail

~~~powershell
node node_modules/vitest/vitest.mjs run src/components/operator/PublicationProofReviewPanel.test.tsx
~~~

Expected: FAIL because the panel has no mutation, feedback form, or buttons yet.

- [ ] Step 3: Add the mutation, per-attempt command IDs, and safe error mapping

Add the following behavior inside the component:

~~~tsx
const pendingCommandIds = useRef<Record<string, string>>({});
const [feedbackAttemptId, setFeedbackAttemptId] = useState<string | null>(null);
const [feedback, setFeedback] = useState("");
const [errorMessage, setErrorMessage] = useState<string | null>(null);

const mutation = useMutation({
  mutationFn: ({ proof, decision, message, commandId }: {
    proof: CreatorCasePublicationProof;
    decision: CreatorCasePublicationProofDecision;
    message: string | null;
    commandId: string;
  }) => postCreatorPublicationProofReview(workspaceId, creatorId, {
    submissionId: proof.submissionId,
    workItemId: proof.workItemId,
    attemptId: proof.currentAttempt!.id,
    decision,
    message,
  }, commandId),
  onSuccess: async () => {
    setFeedbackAttemptId(null);
    setFeedback("");
    setErrorMessage(null);
    onSuccess?.();
  },
  onError: (error) => {
    const code = error instanceof AdminRequestError ? error.code : undefined;
    setErrorMessage(code === "proof_attempt_not_submitted"
      ? "This attempt is no longer actionable. Reload the case."
      : code === "proof_message_required"
        ? "Feedback is required before requesting changes."
        : code === "command_conflict"
          ? "This review command conflicted with another attempt. Retry the action."
          : code === "proof_attempt_not_found" || code === "proof_lineage_mismatch"
            ? "This proof is no longer available in the case. Reload the case."
            : "Proof review could not be completed. Retry or reload the case.");
  },
});

const submitDecision = (proof: CreatorCasePublicationProof, decision: CreatorCasePublicationProofDecision) => {
  const currentAttempt = proof.currentAttempt;
  if (!currentAttempt || currentAttempt.state !== "submitted") return;
  const message = decision === "changes_requested" ? feedback.trim() : null;
  if (decision === "changes_requested" && !message) {
    setErrorMessage("Feedback is required before requesting changes.");
    return;
  }
  const commandKey = proof.submissionId + ":" + currentAttempt.id + ":" + decision;
  const commandId = pendingCommandIds.current[commandKey] ?? crypto.randomUUID();
  pendingCommandIds.current[commandKey] = commandId;
  mutation.mutate({ proof, decision, message, commandId });
};
~~~

Render Verify directly. Render Request changes as a reveal action; once selected, render a labeled textarea and a disabled Send change request button until feedback.trim() is non-empty. Disable all proof actions while mutation.isPending. Preserve the command ID after failure and clear it only in onSuccess or when the proof identity changes.

- [ ] Step 4: Run the full panel test file to verify the actions pass

~~~powershell
node node_modules/vitest/vitest.mjs run src/components/operator/PublicationProofReviewPanel.test.tsx
~~~

Expected: all read-only, action, validation, retry, and safe-error tests pass.

- [ ] Step 5: Commit the panel behavior

~~~powershell
git add src/components/operator/PublicationProofReviewPanel.tsx src/components/operator/PublicationProofReviewPanel.test.tsx
git commit -m "feat: add creator case proof review actions"
~~~

## Task 4: Wire the panel into the Creator detail route

**Files:**
- Modify: src/routes/operator.creators.$creatorId.tsx
- Test: src/routes/-operator.creators.$creatorId.test.tsx

**Interfaces:**
- Consumes: detailData.publicationProofs, PublicationProofReviewPanel, and the existing queryClient, workspace, and creator route state.
- Produces: visible proof review in the Creator Case right rail and integration coverage for the route-to-panel boundary.

- [ ] Step 1: Extend the route fixture and write the failing integration assertion

Add postCreatorPublicationProofReview to the test mock and add a submitted proof to the response() fixture. Then add:

~~~tsx
it("renders proof review in the case rail and sends the selected lineage", async () => {
  hoisted.postCreatorPublicationProofReview.mockResolvedValue({ publicationProof: response().publicationProofs?.[0] ?? null });
  renderRoute();

  expect(await screen.findByRole("heading", { name: "Publication proof review" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Verify publication proof" }));

  await waitFor(() => expect(hoisted.postCreatorPublicationProofReview).toHaveBeenCalledWith(
    "workspace-1",
    "creator-1",
    {
      submissionId: "submission-1",
      workItemId: "work-item-1",
      attemptId: "attempt-1",
      decision: "verified",
      message: null,
    },
    expect.any(String),
  ));
});
~~~

Update the existing renderRoute helper to accept an optional QueryClient and return it. In this test, create a QueryClient, spy on invalidateQueries, pass that client to renderRoute, and assert the route owns the single invalidation:

~~~tsx
const queryClient = new QueryClient();
const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
renderRoute(queryClient);

await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({
  queryKey: ["admin-creator-detail", "creator-1", "workspace-1"],
}));
~~~

- [ ] Step 2: Run the route test to verify it fails

~~~powershell
node node_modules/vitest/vitest.mjs run 'src/routes/-operator.creators.$creatorId.test.tsx'
~~~

Expected: FAIL because the route does not yet mock or render the new panel and the fixture lacks publicationProofs.

- [ ] Step 3: Render the panel in the existing right rail

Import PublicationProofReviewPanel and add it after the existing generic Review action section, before Shortlist memberships:

~~~tsx
<section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
  <PublicationProofReviewPanel
    workspaceId={workspace}
    creatorId={creator.id}
    publicationProofs={detailData.publicationProofs}
    onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-creator-detail", creatorId, workspace] })}
  />
</section>
~~~

Keep the route responsible only for placement and query invalidation. The panel owns proof action state and the client adapter owns request serialization.

- [ ] Step 4: Run the route and focused client suites to verify they pass

~~~powershell
node node_modules/vitest/vitest.mjs run src/lib/creatorCase.test.ts src/components/operator/PublicationProofReviewPanel.test.tsx 'src/routes/-operator.creators.$creatorId.test.tsx'
~~~

Expected: all three files pass, including the existing Creator detail, note, generic review, workspace, and optional-enrichment tests.

- [ ] Step 5: Commit the route integration

~~~powershell
git add src/routes/operator.creators.$creatorId.tsx 'src/routes/-operator.creators.$creatorId.test.tsx'
git commit -m "feat: wire proof review into creator case detail"
~~~

## Task 5: Run the final focused verification gate

**Files:**
- Inspect only: all files changed by Tasks 1-4

**Interfaces:**
- Consumes: the committed client contract, panel, route wiring, and tests.
- Produces: fresh evidence for the approved design acceptance criteria; no additional behavior.

- [ ] Step 1: Run the focused Creator Case client and route suite

~~~powershell
node node_modules/vitest/vitest.mjs run src/lib/creatorCase.test.ts src/components/operator/PublicationProofReviewPanel.test.tsx 'src/routes/-operator.creators.$creatorId.test.tsx'
~~~

Expected: 3 files pass with zero failures.

- [ ] Step 2: Run the adjacent Creator Studio proof component regressions

~~~powershell
node node_modules/vitest/vitest.mjs run src/components/creator-studio/PublicationProofPanel.test.tsx src/components/creator-studio/CreatorStudioWorkbench.test.tsx src/lib/creatorCase.test.ts src/components/operator/PublicationProofReviewPanel.test.tsx 'src/routes/-operator.creators.$creatorId.test.tsx'
~~~

Expected: existing Creator Studio proof behavior and the new Creator Case panel pass together.

- [ ] Step 3: Run targeted lint and ESM checks

~~~powershell
node node_modules/eslint/bin/eslint.js src/lib/creatorCase.ts src/lib/creatorCase.test.ts src/components/operator/PublicationProofReviewPanel.tsx src/components/operator/PublicationProofReviewPanel.test.tsx src/routes/operator.creators.$creatorId.tsx 'src/routes/-operator.creators.$creatorId.test.tsx'
npm.cmd run check:esm
~~~

Expected: both commands exit with code 0. If repository-wide lint or type-check remains blocked by the known missing tsr/toolchain baseline, report that separately from this focused result.

- [ ] Step 4: Run repository hygiene checks

~~~powershell
git diff --check
git status --short
~~~

Expected: no whitespace errors; only the intentional task commits are tracked changes. Existing unrelated untracked artifacts remain untouched and must not be staged.

- [ ] Step 5: Review the final diff against the spec

Confirm the final diff has:

- no server or migration changes;
- no raw fetch from the component;
- no action controls for draft, verified, or changes-requested attempts;
- required trimmed feedback for changes requests;
- per-attempt command IDs preserved across retries;
- detail-query invalidation after success;
- no rewards, payouts, evidence upload, metadata refresh, or provider calls.

If all checks pass, hand off the commit list and verification evidence. Do not apply migrations, seed production, deploy, push, or open a pull request without separate authorization.
