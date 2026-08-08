import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { SupabaseCreatorCaseRepository } from "../lib/creatorCase/supabaseRepository";
import { cleanup, DEMO_WS, hasSupabaseEnv, makeCreator, makeMission, serviceForTests } from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const { app } = createApp();

function adminreq(path: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      "x-admin-secret": process.env.ADMIN_SECRET,
      "x-operator-id": "creator-case-http-test",
      "x-operator-label": "Creator Case HTTP Test",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

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
    expect(result.insertedNote).toEqual(result.notes[0]);
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

suite("creator case HTTP integration", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("serves a workspace-scoped queue and retains the strict core when enrichment is available", async () => {
    const creator = await makeCreator("creator-case-http-queue@test.local");
    const response = await adminreq(`/admin/creators/review?workspace=${DEMO_WS}&q=creator-case-http-queue`);

    expect(response.status).toBe(200);
    const body = await response.json();
    const row = body.creators.find((item: { id: string }) => item.id === creator.userId);
    expect(row.review).toMatchObject({ status: "needs_review", riskLevel: "unknown" });
    expect(row.enrichment.social).toMatchObject({ status: "available" });
  });

  it("commits review, note, and audit state through the workspace-scoped route", async () => {
    const creator = await makeCreator("creator-case-http-review@test.local");
    const response = await adminreq(`/admin/creators/${creator.userId}/review?workspace=${DEMO_WS}`, {
      method: "POST",
      body: JSON.stringify({
        command_id: randomUUID(),
        status: "approved",
        risk_level: "low",
        summary: "Strong fit for skincare missions.",
        note: "Prior delivery was on brief.",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      review: { status: "approved", riskLevel: "low", summary: "Strong fit for skincare missions." },
    });

    const service = serviceForTests();
    const [notes, audits] = await Promise.all([
      service.from("creator_review_notes").select("body, category").eq("creator_id", creator.userId),
      service.from("operator_audit_events").select("event_type, operator_id, actor_label").eq("creator_id", creator.userId),
    ]);
    expect(notes.data).toEqual([{ body: "Prior delivery was on brief.", category: "other" }]);
    expect(audits.data?.map((event) => event.event_type).sort()).toEqual(["creator_note.created", "creator_review.updated"]);
    expect(audits.data?.every((event) => event.operator_id === "creator-case-http-test")).toBe(true);
  });

  it("returns detail enrichment and keeps mission shortlist projection separate", async () => {
    const creator = await makeCreator("creator-case-http-detail@test.local");
    const mission = await makeMission({ slug: "test-creator-case-http-detail" });
    const service = serviceForTests();
    await service.from("creator_social_accounts").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      platform: "instagram",
      handle: "detailcreator",
      sync_status: "synced",
      follower_count: 22000,
      engagement_rate: 4.1,
      api_synced_at: "2026-06-18T03:00:00.000Z",
    });
    await service.from("creator_portfolio_links").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      url: "https://example.com/creator-case-http-portfolio",
      title: "Operator-visible work",
      platform_type: "website",
      caption: "Private review caption",
      sort_order: 1,
      public_highlight: true,
    });
    await adminreq(`/admin/missions/${mission.id}/shortlist`, {
      method: "POST",
      body: JSON.stringify({ creator_id: creator.userId, source: "manual", notes: "Add to launch list." }),
    });

    const response = await adminreq(`/admin/creators/${creator.userId}?workspace=${DEMO_WS}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.creator.id).toBe(creator.userId);
    expect(body.social).toMatchObject({ status: "available", value: { summary: { followerCount: 22000 } } });
    expect(body.profile).toMatchObject({ status: "available", value: { portfolioLinks: [expect.objectContaining({ title: "Operator-visible work" })] } });
    expect(body.shortlists[0]).toMatchObject({ mission_id: mission.id, status: "shortlisted" });
  });

  it("rejects unscoped and cross-workspace commands without writing state", async () => {
    const creator = await makeCreator("creator-case-http-mismatch@test.local");
    const service = serviceForTests();
    const missingWorkspace = await adminreq(`/admin/creators/${creator.userId}/notes`, {
      method: "POST",
      body: JSON.stringify({ command_id: randomUUID(), category: "fit", body: "Must not write." }),
    });
    const mismatch = await adminreq(`/admin/creators/${creator.userId}/review?workspace=00000000-0000-0000-0000-0000000000bb`, {
      method: "POST",
      body: JSON.stringify({ command_id: randomUUID(), status: "approved", risk_level: "low", summary: "Must not write." }),
    });
    const notes = await service.from("creator_review_notes").select("id", { count: "exact", head: true }).eq("creator_id", creator.userId);
    const audits = await service.from("operator_audit_events").select("id", { count: "exact", head: true }).eq("creator_id", creator.userId);

    expect(missingWorkspace.status).toBe(422);
    expect(mismatch.status).toBe(404);
    expect(await mismatch.json()).toMatchObject({ code: "creator_not_found" });
    expect(notes.count).toBe(0);
    expect(audits.count).toBe(0);
  });

  it("hides flagged creators by default in a mission-scoped queue", async () => {
    const approved = await makeCreator("creator-case-http-approved@test.local");
    const flagged = await makeCreator("creator-case-http-flagged@test.local");
    const mission = await makeMission({ slug: "test-creator-case-http-mission-filter" });
    const service = serviceForTests();
    await service.from("creator_portfolio_links").insert([
      {
        creator_id: flagged.userId,
        workspace_id: DEMO_WS,
        url: "https://example.com/creator-case-http-flagged-1",
        title: "Flagged work 1",
        platform_type: "website",
        caption: null,
        sort_order: 1,
        public_highlight: true,
      },
      {
        creator_id: flagged.userId,
        workspace_id: DEMO_WS,
        url: "https://example.com/creator-case-http-flagged-2",
        title: "Flagged work 2",
        platform_type: "instagram",
        caption: null,
        sort_order: 2,
        public_highlight: false,
      },
    ]);
    await adminreq(`/admin/creators/${approved.userId}/review?workspace=${DEMO_WS}`, {
      method: "POST",
      body: JSON.stringify({ command_id: randomUUID(), status: "approved", risk_level: "low", summary: "Ready." }),
    });
    await adminreq(`/admin/creators/${flagged.userId}/review?workspace=${DEMO_WS}`, {
      method: "POST",
      body: JSON.stringify({
        command_id: randomUUID(),
        status: "flagged",
        risk_level: "high",
        summary: "Hidden by default.",
        note: "Hold for operator review.",
      }),
    });

    const queue = await adminreq(`/admin/creators/review?workspace=${DEMO_WS}&mission_id=${mission.id}`);
    expect(queue.status).toBe(200);
    const ids = (await queue.json()).creators.map((row: { id: string }) => row.id);
    expect(ids).toContain(approved.userId);
    expect(ids).not.toContain(flagged.userId);

    const flaggedQueue = await adminreq(`/admin/creators/review?workspace=${DEMO_WS}&mission_id=${mission.id}&status=flagged`);
    expect(flaggedQueue.status).toBe(200);
    const flaggedBody = await flaggedQueue.json();
    expect(flaggedBody.creators.map((row: { id: string }) => row.id)).toContain(flagged.userId);
    expect(flaggedBody.creators[0].profileMedia).toMatchObject({ portfolioCount: 2, publicHighlightCount: 1 });
  });

  it("keeps Creator avatar identity separate from social-source avatars", async () => {
    const creator = await makeCreator("creator-case-http-social-avatar@test.local");
    await serviceForTests().from("creator_social_accounts").insert({
      creator_id: creator.userId,
      workspace_id: DEMO_WS,
      platform: "instagram",
      handle: "socialavataronly",
      sync_status: "synced",
      external_avatar_url: "https://cdn.example.com/social-only-avatar.jpg",
      api_synced_at: "2026-06-18T02:00:00.000Z",
    });

    const response = await adminreq(`/admin/creators/review?workspace=${DEMO_WS}&q=creator-case-http-social-avatar`);
    expect(response.status).toBe(200);
    const row = (await response.json()).creators.find((item: { id: string }) => item.id === creator.userId);
    expect(row).toMatchObject({ avatarUrl: null, social: { label: "API-synced" } });
  });

  it("sorts approved creators before the selected mission-queue secondary sort", async () => {
    const approved = await makeCreator("creator-case-http-approved-first@test.local");
    const needsReview = await makeCreator("creator-case-http-needs-review@test.local");
    const mission = await makeMission({ slug: "test-creator-case-http-approved-first" });
    await adminreq(`/admin/creators/${approved.userId}/review?workspace=${DEMO_WS}`, {
      method: "POST",
      body: JSON.stringify({
        command_id: randomUUID(),
        status: "approved",
        risk_level: "low",
        summary: "Approved for mission queue ordering.",
      }),
    });
    await serviceForTests().from("creator_social_accounts").insert([
      {
        creator_id: approved.userId,
        workspace_id: DEMO_WS,
        platform: "instagram",
        handle: "approvedfirst",
        sync_status: "synced",
        follower_count: 20000,
        engagement_rate: 4.1,
        api_synced_at: "2026-06-18T01:00:00.000Z",
      },
      {
        creator_id: needsReview.userId,
        workspace_id: DEMO_WS,
        platform: "instagram",
        handle: "needsfirst",
        sync_status: "synced",
        follower_count: 18000,
        engagement_rate: 3.9,
        api_synced_at: "2026-06-18T03:00:00.000Z",
      },
    ]);

    const response = await adminreq(`/admin/creators/review?workspace=${DEMO_WS}&mission_id=${mission.id}&sort=social_freshness`);
    expect(response.status).toBe(200);
    const ids = (await response.json()).creators.map((row: { id: string }) => row.id);
    expect(ids.indexOf(approved.userId)).toBeLessThan(ids.indexOf(needsReview.userId));
  });
});
