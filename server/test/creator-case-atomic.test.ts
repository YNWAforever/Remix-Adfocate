import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseCreatorCaseRepository } from "../lib/creatorCase/supabaseRepository";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, serviceForTests } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("creator case atomic commands", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("commits a review, note, and audit rows through one review command", async () => {
    const creator = await makeCreator("creator-case-atomic@test.local");
    const repo = new SupabaseCreatorCaseRepository(serviceForTests());
    const commandId = randomUUID();

    const result = await repo.applyReview(
      { workspaceId: DEMO_WS, actorId: "creator-case-test", actorLabel: "Creator Case Test", commandId },
      {
        creatorId: creator.userId,
        status: "approved",
        riskLevel: "low",
        summary: "Atomic test",
        note: { category: "other", body: "Atomic note" },
      },
    );

    expect(result.review).toMatchObject({ status: "approved", riskLevel: "low", summary: "Atomic test" });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ category: "other", body: "Atomic note" });
    expect(result.audit.map((event) => event.eventType).sort()).toEqual([
      "creator_note.created",
      "creator_review.updated",
    ]);
  });

  it("does not duplicate notes or audit events for an identical command replay", async () => {
    const creator = await makeCreator("creator-case-atomic-replay@test.local");
    const repo = new SupabaseCreatorCaseRepository(serviceForTests());
    const commandId = randomUUID();
    const context = { workspaceId: DEMO_WS, actorId: "creator-case-test", actorLabel: "Creator Case Test", commandId };
    const command = {
      creatorId: creator.userId,
      status: "approved" as const,
      riskLevel: "low" as const,
      summary: "Atomic test",
      note: { category: "other" as const, body: "Atomic note" },
    };

    await repo.applyReview(context, command);
    await repo.applyReview(context, command);

    const service = serviceForTests();
    const [notes, audits] = await Promise.all([
      service.from("creator_review_notes").select("id", { count: "exact", head: true }).eq("creator_id", creator.userId),
      service.from("operator_audit_events").select("id", { count: "exact", head: true }).eq("creator_id", creator.userId),
    ]);
    expect(notes.error).toBeNull();
    expect(notes.count).toBe(1);
    expect(audits.error).toBeNull();
    expect(audits.count).toBe(2);
  });

  it("rejects a changed payload for a reused command id", async () => {
    const creator = await makeCreator("creator-case-atomic-conflict@test.local");
    const repo = new SupabaseCreatorCaseRepository(serviceForTests());
    const commandId = randomUUID();
    const context = { workspaceId: DEMO_WS, actorId: "creator-case-test", actorLabel: "Creator Case Test", commandId };
    const command = {
      creatorId: creator.userId,
      status: "approved" as const,
      riskLevel: "low" as const,
      summary: "Atomic test",
      note: { category: "other" as const, body: "Atomic note" },
    };

    await repo.applyReview(context, command);
    await expect(repo.applyReview(context, { ...command, summary: "Changed summary" })).rejects.toMatchObject({
      code: "command_conflict",
    });
  });
});
