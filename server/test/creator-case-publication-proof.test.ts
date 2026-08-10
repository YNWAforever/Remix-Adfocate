import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InMemoryCreatorCaseRepository } from "../lib/creatorCase/inMemoryRepository";
import { SupabaseCreatorCaseRepository } from "../lib/creatorCase/supabaseRepository";
import type { CreatorCaseReadModel } from "../lib/creatorCase/types";

type PublicationProofReviewRepository = InMemoryCreatorCaseRepository & {
  reviewPublicationProof(
    context: {
      workspaceId: string;
      actorId: string;
      actorLabel: string;
      commandId: string;
    },
    command: {
      creatorId: string;
      submissionId: string;
      workItemId: string;
      attemptId: string;
      decision: "verified" | "changes_requested";
      message: string | null;
    },
  ): Promise<CreatorCaseReadModel>;
};

function makeCase(): CreatorCaseReadModel {
  return {
    creator: {
      id: "creator-1",
      workspaceId: "workspace-1",
      displayName: "Ada Creator",
      avatarUrl: null,
      level: "L1",
      categories: ["beauty"],
      scores: { trust: 80 },
      socialHandles: {},
      createdAt: "2026-08-08T00:00:00.000Z",
    },
    review: {
      status: "needs_review",
      riskLevel: "unknown",
      summary: null,
      reviewedBy: null,
      lastReviewedAt: null,
      updatedAt: null,
    },
    notes: [],
    audit: [],
    social: { status: "unavailable", reason: "not_configured" },
    profile: { status: "unavailable", reason: "not_configured" },
    missionHistory: { status: "unavailable", reason: "not_configured" },
    publicationProofs: [{
      submissionId: "submission-1",
      workflowId: "workflow-1",
      workItemId: "work-item-1",
      creatorId: "creator-1",
      workspaceId: "workspace-1",
      currentAttempt: {
        id: "attempt-1",
        submissionId: "submission-1",
        workflowId: "workflow-1",
        workItemId: "work-item-1",
        creatorId: "creator-1",
        workspaceId: "workspace-1",
        parentAttemptId: null,
        sequence: 1,
        publishedUrl: "https://example.com/post/one",
        platform: "instagram",
        state: "submitted",
        operatorMessage: null,
        submittedAt: "2026-08-09T00:00:00.000Z",
        decidedAt: null,
      },
      history: [],
    }],
  } as CreatorCaseReadModel;
}

const context = {
  workspaceId: "workspace-1",
  actorId: "operator-1",
  actorLabel: "Operator",
  commandId: "proof-review-1",
};

const verifyCommand = {
  creatorId: "creator-1",
  submissionId: "submission-1",
  workItemId: "work-item-1",
  attemptId: "attempt-1",
  decision: "verified" as const,
  message: null,
};

describe("Creator Case publication-proof review", () => {
  it("verifies a submitted attempt without changing the creator review projection", async () => {
    const repository = new InMemoryCreatorCaseRepository({ cases: [makeCase()] }) as PublicationProofReviewRepository;

    const result = await repository.reviewPublicationProof(context, verifyCommand);

    expect(result.publicationProofs?.[0].currentAttempt).toMatchObject({
      id: "attempt-1",
      state: "verified",
      operatorMessage: null,
    });
    expect(result.review).toMatchObject({
      status: "needs_review",
      riskLevel: "unknown",
      summary: null,
      reviewedBy: null,
      lastReviewedAt: null,
      updatedAt: null,
    });
    expect(result.notes).toEqual([]);
    expect(result.audit.at(-1)).toMatchObject({
      eventType: "creator_publication_proof.verified",
      targetType: "publication_proof_attempt",
      targetId: "attempt-1",
    });
  });

  it("requests changes by preserving the decided attempt and creating a linked draft correction", async () => {
    const repository = new InMemoryCreatorCaseRepository({ cases: [makeCase()] }) as PublicationProofReviewRepository;

    const result = await repository.reviewPublicationProof(context, {
      ...verifyCommand,
      decision: "changes_requested",
      message: "Please use the campaign URL.",
    });

    expect(result.publicationProofs?.[0]).toMatchObject({
      currentAttempt: {
        id: "attempt-1:correction:proof-review-1",
        parentAttemptId: "attempt-1",
        sequence: 2,
        state: "draft",
        submittedAt: null,
        decidedAt: null,
      },
      history: [{
        id: "attempt-1",
        state: "changes_requested",
        operatorMessage: "Please use the campaign URL.",
      }],
    });
  });

  it("requires a message for a changes-requested decision without mutating the submitted attempt", async () => {
    const repository = new InMemoryCreatorCaseRepository({ cases: [makeCase()] }) as PublicationProofReviewRepository;

    await expect(repository.reviewPublicationProof(context, {
      ...verifyCommand,
      decision: "changes_requested",
      message: "   ",
    })).rejects.toMatchObject({ code: "proof_message_required" });

    const unchanged = await repository.getCase(
      { workspaceId: "workspace-1", actorId: "operator-1", actorLabel: "Operator" },
      "creator-1",
    );
    expect(unchanged.publicationProofs?.[0].currentAttempt).toMatchObject({ id: "attempt-1", state: "submitted" });
  });

  it("replays the original proof decision and rejects a conflicting command payload", async () => {
    const repository = new InMemoryCreatorCaseRepository({ cases: [makeCase()] }) as PublicationProofReviewRepository;

    const first = await repository.reviewPublicationProof(context, verifyCommand);
    const replay = await repository.reviewPublicationProof(context, verifyCommand);
    expect(replay).toEqual(first);
    expect(replay).not.toBe(first);

    await expect(repository.reviewPublicationProof(context, {
      ...verifyCommand,
      decision: "changes_requested",
      message: "Different command payload",
    })).rejects.toMatchObject({ code: "command_conflict" });
  });

  it("sends the complete lineage once through the Supabase repository RPC", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: {
            creator: { id: "creator-1", workspaceId: "workspace-1", categories: [], scores: {} },
            review: { status: "needs_review", riskLevel: "unknown" },
            notes: [],
            audit: [],
            publicationProofs: [{
              submissionId: "submission-1",
              workflowId: "workflow-1",
              workItemId: "work-item-1",
              creatorId: "creator-1",
              workspaceId: "workspace-1",
              currentAttempt: {
                id: "attempt-1",
                submissionId: "submission-1",
                workflowId: "workflow-1",
                workItemId: "work-item-1",
                creatorId: "creator-1",
                workspaceId: "workspace-1",
                parentAttemptId: null,
                sequence: 1,
                publishedUrl: "https://example.com/post/one",
                platform: "instagram",
                state: "verified",
                operatorMessage: "Looks good.",
                submittedAt: "2026-08-09T00:00:00.000Z",
                decidedAt: "2026-08-10T00:00:00.000Z",
              },
              history: [],
            }],
          },
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const result = await new SupabaseCreatorCaseRepository(client).reviewPublicationProof(
      { ...context, commandId: "supabase-proof-review-1" },
      { ...verifyCommand, message: "  Looks good.  " },
    );

    expect(calls).toEqual([{
      name: "creator_case_review_publication_proof",
      args: {
        p_command_id: "supabase-proof-review-1",
        p_workspace_id: "workspace-1",
        p_creator_id: "creator-1",
        p_operator_id: "operator-1",
        p_actor_label: "Operator",
        p_submission_id: "submission-1",
        p_work_item_id: "work-item-1",
        p_attempt_id: "attempt-1",
        p_decision: "verified",
        p_message: "Looks good.",
      },
    }]);
    expect(result.publicationProofs?.[0].currentAttempt).toMatchObject({ state: "verified", operatorMessage: "Looks good." });
  });

  it("maps proof transition errors without exposing database details", async () => {
    const client = {
      rpc: async () => ({ data: null, error: new Error("proof_attempt_not_submitted: private details") }),
    } as unknown as SupabaseClient;

    await expect(new SupabaseCreatorCaseRepository(client).reviewPublicationProof(context, verifyCommand))
      .rejects.toMatchObject({ code: "proof_attempt_not_submitted", publicMessage: expect.stringContaining("proof_attempt_not_submitted") });
  });
});
