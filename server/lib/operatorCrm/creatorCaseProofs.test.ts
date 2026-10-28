import { describe, expect, it, vi } from "vitest";
import { getCreatorCaseProofs, projectCreatorCaseProofs } from "./creatorCaseProofs.js";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    workspace_id: "workspace-1",
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
      current_proof_attempt_id: overrides.id ?? "attempt-1",
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
function stubClient(
  attempts: { data?: unknown; error?: unknown },
  submissions: { data?: unknown; error?: unknown } = { data: [] },
  select = vi.fn(),
  eq = vi.fn(),
) {
  return {
    from: (table: string) => {
      const result = table === "mission_submissions" ? submissions : attempts;
      const builder = {
        select: (projection: string) => { select(table, projection); return builder; },
        eq: (column: string, value: string) => { eq(column, value); return builder; },
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
      workspaceId: "workspace-1",
      isCurrentAttempt: true,
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

  it("carries each proof's owning workspace across a creator's workspaces", () => {
    const items = projectCreatorCaseProofs([
      row(), row({ id: "attempt-2", workspace_id: "workspace-2" }),
    ]);
    expect(items.map((item) => [item.attemptId, item.workspaceId])).toEqual([
      ["attempt-1", "workspace-1"], ["attempt-2", "workspace-2"],
    ]);
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

  it.each([
    { reviewer_id: null, claimed_at: null, expected: "awaiting_review" },
    { reviewer_id: "reviewer-1", claimed_at: "2026-08-02T00:00:00.000Z", expected: "in_review" },
  ])("maps an open review with claim $reviewer_id to $expected", ({ reviewer_id, claimed_at, expected }) => {
    const [item] = projectCreatorCaseProofs([
      row({ mission_publication_proof_reviews: [{ review_number: 1, state: "open", reviewer_id, claimed_at, summary: null, reviewed_at: null }] }),
    ]);

    expect(item.reviewState).toBe(expected);
  });

  it.each([
    { reviewer_id: null, claimed_at: null, expected: "awaiting_review" },
    { reviewer_id: "reviewer-2", claimed_at: "2026-08-04T00:00:00.000Z", expected: "in_review" },
  ])("uses only the newest round's claim for $expected regardless of row order", ({ reviewer_id, claimed_at, expected }) => {
    const rounds = [
      { review_number: 3, state: "open", reviewer_id, claimed_at, summary: null, reviewed_at: null },
      { review_number: 1, state: "open", reviewer_id: "old-reviewer", claimed_at: "2026-08-01T00:00:00.000Z" },
      { review_number: 2, state: "correction_requested", summary: "Old correction", reviewed_at: "2026-08-03T00:00:00.000Z" },
    ];
    for (const reviews of [rounds, [...rounds].reverse()]) {
      const [item] = projectCreatorCaseProofs([row({ mission_publication_proof_reviews: reviews })]);
      expect(item).toMatchObject({ reviewState: expected, reviewSummary: null, reviewedAt: null });
    }
  });

  it.each(["verified", "open"])("retains superseded correction history below the current %s replacement", (state) => {
    const workItem = { ...row().mission_work_items, current_proof_attempt_id: "replacement" };
    const items = projectCreatorCaseProofs([
      row({ id: "historical", mission_work_items: workItem,
        mission_publication_proof_reviews: [{ review_number: 1, state: "correction_requested", summary: "Add disclosure" }] }),
      row({ id: "replacement", attempt_number: 2, mission_work_items: workItem,
        submitted_at: "2026-08-05T00:00:00.000Z",
        mission_publication_proof_reviews: [{ review_number: 2, state, reviewer_id: null, claimed_at: null }] }),
      row({ id: "other-pending", submitted_at: "2026-08-04T00:00:00.000Z" }),
    ]);
    expect(items.map((item) => item.attemptId)).toEqual(["other-pending", "replacement", "historical"]);
    expect(items.find((item) => item.attemptId === "replacement")).toMatchObject({
      isCurrentAttempt: true, reviewState: state === "verified" ? "verified" : "awaiting_review",
    });
    expect(items[2]).toMatchObject({ isCurrentAttempt: false, reviewState: "correction_requested", reviewSummary: "Add disclosure" });
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
    expect(projectCreatorCaseProofs([row({ workspace_id: null })])).toEqual([]);
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
  it("selects workspace, current-attempt and claim fields through the real FK hints", async () => {
    const select = vi.fn();
    const eq = vi.fn();
    await getCreatorCaseProofs(stubClient({ data: [] }, { data: [] }, select, eq), "creator-1");
    const projection = select.mock.calls[0][1] as string;
    expect(select.mock.calls[0][0]).toBe("mission_publication_proof_attempts");
    expect(projection).toContain("workspace_id");
    expect(projection).toContain("mission_work_items!mission_publication_proof_attempts_work_item_workspace_fk!inner(");
    expect(projection).toContain("current_proof_attempt_id");
    expect(projection).toContain("mission_workflows!mission_work_items_workflow_workspace_fk!inner(");
    expect(projection).toContain("reviewer_id, claimed_at");
    expect(eq).toHaveBeenCalledWith("submitted_by", "creator-1");
  });

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
