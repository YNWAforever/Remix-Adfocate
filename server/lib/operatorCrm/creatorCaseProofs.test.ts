import { describe, expect, it } from "vitest";
import { getCreatorCaseProofs, projectCreatorCaseProofs } from "./creatorCaseProofs.js";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    attempt_number: 1,
    primary_url: "https://example.com/post",
    submitted_at: "2026-08-01T00:00:00.000Z",
    submitted_late: false,
    metadata_status: "available",
    mission_work_items: {
      id: "work-item-1",
      title: "IG Reel",
      platform: "instagram",
      mission_workflow_id: "workflow-1",
      mission_workflows: { id: "workflow-1", mission_submission_id: "submission-1" },
    },
    mission_publication_proof_reviews: [],
    ...overrides,
  };
}

const MISSIONS = new Map([["submission-1", { title: "Summer launch", slug: "summer-launch" }]]);

/**
 * Minimal PostgREST stub. `mission_publication_proof_attempts` resolves on `.order()`,
 * `mission_submissions` resolves on `.in()` — matching how each query terminates.
 */
function stubClient(attempts: { data?: unknown; error?: unknown }, submissions: { data?: unknown; error?: unknown } = { data: [] }) {
  return {
    from: (table: string) => {
      const result = table === "mission_submissions" ? submissions : attempts;
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => Promise.resolve(result),
        order: () => Promise.resolve(result),
      };
      return builder;
    },
  } as never;
}

describe("projectCreatorCaseProofs", () => {
  it("projects a proof attempt into the case read model", () => {
    const [item] = projectCreatorCaseProofs([row()], MISSIONS);

    expect(item).toMatchObject({
      attemptId: "attempt-1",
      workflowId: "workflow-1",
      workItemId: "work-item-1",
      workItemTitle: "IG Reel",
      platform: "instagram",
      missionTitle: "Summer launch",
      missionSlug: "summer-launch",
      primaryUrl: "https://example.com/post",
      reviewState: "awaiting_review",
    });
  });

  it("accepts embedded relations returned as single-element arrays", () => {
    const [item] = projectCreatorCaseProofs(
      [
        row({
          mission_work_items: [
            {
              id: "work-item-1",
              title: "IG Reel",
              platform: "instagram",
              mission_workflow_id: "workflow-1",
              mission_workflows: [{ id: "workflow-1", mission_submission_id: "submission-1" }],
            },
          ],
        }),
      ],
      MISSIONS,
    );

    expect(item.workflowId).toBe("workflow-1");
    expect(item.missionTitle).toBe("Summer launch");
  });

  it("leaves the mission unlabelled when its title could not be resolved", () => {
    const [item] = projectCreatorCaseProofs([row()]);

    expect(item.missionTitle).toBeNull();
    expect(item.attemptId).toBe("attempt-1");
  });

  it("derives review state from the newest review round", () => {
    const [item] = projectCreatorCaseProofs([
      row({
        mission_publication_proof_reviews: [
          { review_number: 1, state: "correction_requested", summary: "Add disclosure", reviewed_at: "2026-08-02T00:00:00.000Z" },
          { review_number: 2, state: "verified", summary: "Looks good", reviewed_at: "2026-08-03T00:00:00.000Z" },
        ],
      }),
    ]);

    expect(item.reviewState).toBe("verified");
    expect(item.reviewSummary).toBe("Looks good");
    expect(item.reviewedAt).toBe("2026-08-03T00:00:00.000Z");
  });

  it("maps an open review round to in_review", () => {
    const [item] = projectCreatorCaseProofs([
      row({ mission_publication_proof_reviews: [{ review_number: 1, state: "open", summary: null, reviewed_at: null }] }),
    ]);

    expect(item.reviewState).toBe("in_review");
  });

  it("sorts pending proofs above verified ones, oldest first", () => {
    const items = projectCreatorCaseProofs([
      row({ id: "verified", mission_publication_proof_reviews: [{ review_number: 1, state: "verified" }] }),
      row({ id: "newer-pending", submitted_at: "2026-08-05T00:00:00.000Z" }),
      row({ id: "older-pending", submitted_at: "2026-08-02T00:00:00.000Z" }),
    ]);

    expect(items.map((item) => item.attemptId)).toEqual(["older-pending", "newer-pending", "verified"]);
  });

  it("drops rows that cannot be actioned by an operator", () => {
    expect(projectCreatorCaseProofs([row({ mission_work_items: null })])).toEqual([]);
    expect(projectCreatorCaseProofs([row({ primary_url: null })])).toEqual([]);
  });

  it("falls back to unavailable for an unrecognized metadata status", () => {
    const [item] = projectCreatorCaseProofs([row({ metadata_status: "bogus" })]);
    expect(item.metadataStatus).toBe("unavailable");
  });

  it("tolerates a non-array payload", () => {
    expect(projectCreatorCaseProofs(null)).toEqual([]);
  });
});

describe("getCreatorCaseProofs", () => {
  it("returns an available envelope with mission titles joined in", async () => {
    const result = await getCreatorCaseProofs(
      stubClient(
        { data: [row()] },
        { data: [{ id: "submission-1", missions: { title: "Summer launch", slug: "summer-launch" } }] },
      ),
      "creator-1",
    );

    expect(result.status).toBe("available");
    expect(result.status === "available" && result.value[0]).toMatchObject({
      attemptId: "attempt-1",
      missionTitle: "Summer launch",
      missionSlug: "summer-launch",
    });
  });

  it("still lists proofs when the mission lookup fails", async () => {
    const result = await getCreatorCaseProofs(
      stubClient({ data: [row()] }, { error: { code: "57014", message: "timeout" } }),
      "creator-1",
    );

    expect(result.status).toBe("available");
    expect(result.status === "available" && result.value[0]).toMatchObject({
      attemptId: "attempt-1",
      missionTitle: null,
    });
  });

  it("reports a missing relation as not_configured", async () => {
    const result = await getCreatorCaseProofs(stubClient({ error: { code: "42P01" } }), "creator-1");
    expect(result).toEqual({ status: "unavailable", reason: "not_configured" });
  });

  it("reports a stale PostgREST schema cache as not_configured", async () => {
    const result = await getCreatorCaseProofs(stubClient({ error: { code: "PGRST205" } }), "creator-1");
    expect(result).toEqual({ status: "unavailable", reason: "not_configured" });
  });

  it("reports any other query error as source_error", async () => {
    const result = await getCreatorCaseProofs(stubClient({ error: { code: "57014", message: "timeout" } }), "creator-1");
    expect(result).toEqual({ status: "unavailable", reason: "source_error" });
  });

  it("degrades instead of throwing when the transport fails", async () => {
    const client = {
      from: () => {
        throw new Error("socket hang up");
      },
    } as never;

    await expect(getCreatorCaseProofs(client, "creator-1")).resolves.toEqual({
      status: "unavailable",
      reason: "source_error",
    });
  });
});
