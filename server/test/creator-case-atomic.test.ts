import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseCreatorCaseRepository } from "../lib/creatorCase/supabaseRepository";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, serviceForTests } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

describe("SupabaseCreatorCaseRepository context validation", () => {
  const repo = new SupabaseCreatorCaseRepository({} as SupabaseClient);
  const readContext = { workspaceId: DEMO_WS, actorId: "creator-case-test", actorLabel: "Creator Case Test" };
  const command = {
    creatorId: "00000000-0000-0000-0000-0000000000bb",
    status: "approved" as const,
    riskLevel: "low" as const,
    summary: "Atomic test",
    note: null,
  };

  it.each([
    [{ ...readContext, workspaceId: "" }, "workspace_required"],
    [{ ...readContext, actorId: "" }, "actor_required"],
    [{ ...readContext, actorLabel: "" }, "actor_label_required"],
  ] as const)("validates read context before database access", async (context, code) => {
    await expect(repo.getCase(context, command.creatorId)).rejects.toMatchObject({ code });
  });

  it("validates listReviewQueue context before the unimplemented-path error", async () => {
    await expect(repo.listReviewQueue({ ...readContext, workspaceId: "" }, {
      page: 1,
      pageSize: 25,
      sort: "last_activity",
    })).rejects.toMatchObject({ code: "workspace_required" });
  });

  it.each([
    [{ ...readContext, commandId: "" }, "command_required"],
    [{ ...readContext, commandId: randomUUID(), actorId: "" }, "actor_required"],
    [{ ...readContext, commandId: randomUUID(), actorLabel: "" }, "actor_label_required"],
  ] as const)("validates command context before RPC access", async (context, code) => {
    await expect(repo.applyReview(context, command)).rejects.toMatchObject({ code });
  });
});

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

  it("returns the original review snapshot when replayed after a later command", async () => {
    const creator = await makeCreator("creator-case-atomic-snapshot@test.local");
    const repo = new SupabaseCreatorCaseRepository(serviceForTests());
    const context = {
      workspaceId: DEMO_WS,
      actorId: "creator-case-test",
      actorLabel: "Creator Case Test",
      commandId: randomUUID(),
    };

    const first = await repo.applyReview(context, {
      creatorId: creator.userId,
      status: "approved",
      riskLevel: "low",
      summary: "Atomic snapshot",
      note: { category: "other", body: "Original note" },
    });
    await repo.appendNote({ ...context, commandId: randomUUID() }, {
      creatorId: creator.userId,
      category: "other",
      body: "Later note",
    });
    const replay = await repo.applyReview(context, {
      creatorId: creator.userId,
      status: "approved",
      riskLevel: "low",
      summary: "Atomic snapshot",
      note: { category: "other", body: "Original note" },
    });

    expect(replay).toEqual(first);
    expect(replay.notes).toHaveLength(1);
    expect(replay.audit).toHaveLength(2);
  });

  it("appends one note and audit event through the note command", async () => {
    const creator = await makeCreator("creator-case-append-note@test.local");
    const repo = new SupabaseCreatorCaseRepository(serviceForTests());

    const result = await repo.appendNote(
      { workspaceId: DEMO_WS, actorId: "creator-case-test", actorLabel: "Creator Case Test", commandId: randomUUID() },
      { creatorId: creator.userId, category: "fit", body: "Strong audience fit." },
    );

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ category: "fit", body: "Strong audience fit." });
    expect(result.audit.map((event) => event.eventType)).toEqual(["creator_note.created"]);
  });

  it("does not duplicate appendNote rows for an identical command replay", async () => {
    const creator = await makeCreator("creator-case-append-replay@test.local");
    const repo = new SupabaseCreatorCaseRepository(serviceForTests());
    const context = {
      workspaceId: DEMO_WS,
      actorId: "creator-case-test",
      actorLabel: "Creator Case Test",
      commandId: randomUUID(),
    };
    const command = { creatorId: creator.userId, category: "other" as const, body: "One durable note." };

    const first = await repo.appendNote(context, command);
    const replay = await repo.appendNote(context, command);
    const service = serviceForTests();
    const [notes, audits] = await Promise.all([
      service.from("creator_review_notes").select("id", { count: "exact", head: true }).eq("creator_id", creator.userId),
      service.from("operator_audit_events").select("id", { count: "exact", head: true }).eq("creator_id", creator.userId),
    ]);

    expect(replay).toEqual(first);
    expect(notes.count).toBe(1);
    expect(audits.count).toBe(1);
  });

  it("rejects a changed appendNote payload for a reused command id", async () => {
    const creator = await makeCreator("creator-case-append-conflict@test.local");
    const repo = new SupabaseCreatorCaseRepository(serviceForTests());
    const context = {
      workspaceId: DEMO_WS,
      actorId: "creator-case-test",
      actorLabel: "Creator Case Test",
      commandId: randomUUID(),
    };
    const command = { creatorId: creator.userId, category: "other" as const, body: "One durable note." };

    await repo.appendNote(context, command);
    await expect(repo.appendNote(context, { ...command, body: "Changed note." })).rejects.toMatchObject({
      code: "command_conflict",
    });
  });

  it("returns command validation errors for null review status and risk level", async () => {
    const creator = await makeCreator("creator-case-null-validation@test.local");
    const svc = serviceForTests();
    const common = {
      p_workspace_id: DEMO_WS,
      p_creator_id: creator.userId,
      p_operator_id: "creator-case-test",
      p_actor_label: "Creator Case Test",
      p_summary: null,
      p_note_category: null,
      p_note_body: null,
    };

    const missingStatus = await svc.rpc("apply_creator_review", {
      ...common,
      p_command_id: randomUUID(),
      p_status: null,
      p_risk_level: "low",
    });
    const missingRisk = await svc.rpc("apply_creator_review", {
      ...common,
      p_command_id: randomUUID(),
      p_status: "approved",
      p_risk_level: null,
    });

    expect(missingStatus.error?.message).toContain("bad_review_status");
    expect(missingRisk.error?.message).toContain("bad_risk_level");
  });
});
