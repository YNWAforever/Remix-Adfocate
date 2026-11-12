import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  cleanup,
  fixtureName,
  FIXTURE_WORKSPACE_SLUG,
  hasSupabaseEnv,
  makeCreator,
  makeMission,
  serviceForTests,
  userForJwt,
} from "./helpers";
import { createApp } from "../app";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

type Creator = Awaited<ReturnType<typeof makeCreator>>;

async function rejectedSubmission(label: string) {
  const stamp = randomUUID().slice(0, 8);
  const creator = await makeCreator(fixtureName(`test-resubmit-${label}-${stamp}@test.local`), 0);
  const mission = await makeMission({
    slug: fixtureName(`test-resubmit-${label}-${stamp}`),
    quota: 5,
  });
  const user = userForJwt(creator.jwt);
  const joined = await user.rpc("join_mission", { p_mission: mission.id });
  if (joined.error) throw joined.error;
  const submitted = await user.rpc("submit_mission", {
    p_mission: mission.id,
    p_urls: ["https://example.test/original-evidence"],
    p_data: {},
  });
  if (submitted.error) throw submitted.error;
  const rejected = await serviceForTests()
    .from("mission_submissions")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewer_notes: "請補上近鏡示範 / Add a close-up demo",
    })
    .eq("id", submitted.data.id)
    .select("*")
    .single();
  if (rejected.error) throw rejected.error;
  return { creator, mission, user, submission: rejected.data as Record<string, unknown> };
}

async function creatorXp(creator: Creator): Promise<number> {
  const { data, error } = await serviceForTests()
    .from("creators")
    .select("xp")
    .eq("id", creator.userId)
    .single();
  if (error) throw error;
  return (data as { xp: number }).xp;
}

suite("legacy creator resubmission", () => {
  afterAll(cleanup);

  it("reopens a rejected submission without writing XP and preserves the prior decision", async () => {
    const { creator, mission, user, submission } = await rejectedSubmission("ok");
    const xpBefore = await creatorXp(creator);
    const request = randomUUID();
    const result = await user.rpc("resubmit_mission", {
      p_mission: mission.id,
      p_urls: ["https://example.test/corrected-evidence"],
      p_data: { note: "close-up added" },
      p_request: request,
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      id: submission.id,
      status: "submitted",
      resubmit_count: 1,
      reviewer_notes: null,
      reviewed_at: null,
    });
    expect(result.data.content_urls).toEqual(["https://example.test/corrected-evidence"]);
    expect(await creatorXp(creator)).toBe(xpBefore);

    const event = await serviceForTests()
      .from("mission_submission_events")
      .select("event,previous_status,reviewer_notes_snapshot,request_id,payload_hash")
      .eq("mission_submission_id", submission.id)
      .single();
    expect(event.error).toBeNull();
    expect(event.data).toMatchObject({
      event: "resubmitted",
      previous_status: "rejected",
      reviewer_notes_snapshot: "請補上近鏡示範 / Add a close-up demo",
      request_id: request,
    });

    // Replaying the same request returns the submitted row without a second event.
    const replay = await user.rpc("resubmit_mission", {
      p_mission: mission.id,
      p_urls: ["https://example.test/corrected-evidence"],
      p_data: { note: "close-up added" },
      p_request: request,
    });
    expect(replay.error).toBeNull();
    expect(replay.data.id).toBe(submission.id);
    const events = await serviceForTests()
      .from("mission_submission_events")
      .select("id")
      .eq("mission_submission_id", submission.id);
    expect(events.error).toBeNull();
    expect(events.data).toHaveLength(1);
  });

  it("blocks a replayed request with different evidence as an idempotency conflict", async () => {
    const { mission, user } = await rejectedSubmission("conflict");
    const request = randomUUID();
    const first = await user.rpc("resubmit_mission", {
      p_mission: mission.id,
      p_urls: ["https://example.test/one"],
      p_data: {},
      p_request: request,
    });
    expect(first.error).toBeNull();
    const replay = await user.rpc("resubmit_mission", {
      p_mission: mission.id,
      p_urls: ["https://example.test/two"],
      p_data: {},
      p_request: request,
    });
    expect(replay.error?.message).toContain("IDEMPOTENCY_CONFLICT");
  });

  it("enforces the mission revision limit and stops accepting revisions", async () => {
    const { mission, user, submission } = await rejectedSubmission("limit");
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await user.rpc("resubmit_mission", {
        p_mission: mission.id,
        p_urls: [`https://example.test/attempt-${attempt}`],
        p_data: {},
        p_request: randomUUID(),
      });
      expect(result.error).toBeNull();
      expect(result.data.resubmit_count).toBe(attempt);
      const rejected = await serviceForTests()
        .from("mission_submissions")
        .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewer_notes: `round ${attempt}` })
        .eq("id", submission.id);
      expect(rejected.error).toBeNull();
    }
    const blocked = await user.rpc("resubmit_mission", {
      p_mission: mission.id,
      p_urls: ["https://example.test/attempt-3"],
      p_data: {},
      p_request: randomUUID(),
    });
    expect(blocked.error?.message).toContain("revision_limit_reached");
  });

  it("rejects a resubmission after the mission deadline", async () => {
    const { mission, user } = await rejectedSubmission("deadline");
    const past = new Date(Date.now() - 60_000).toISOString();
    const updated = await serviceForTests()
      .from("missions")
      .update({ deadline: past })
      .eq("id", mission.id);
    expect(updated.error).toBeNull();
    const result = await user.rpc("resubmit_mission", {
      p_mission: mission.id,
      p_urls: ["https://example.test/late"],
      p_data: {},
      p_request: randomUUID(),
    });
    expect(result.error?.message).toContain("deadline_passed");
  });

  it("does not let another creator resubmit someone else's rejected submission", async () => {
    const { mission } = await rejectedSubmission("foreign");
    const outsider = await makeCreator(fixtureName(`test-resubmit-outsider-${randomUUID().slice(0, 8)}@test.local`), 0);
    const result = await userForJwt(outsider.jwt).rpc("resubmit_mission", {
      p_mission: mission.id,
      p_urls: ["https://example.test/foreign"],
      p_data: {},
      p_request: randomUUID(),
    });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("wrong_state");
  });
});


suite("legacy resubmission route", () => {
  afterAll(cleanup);

  it("returns revision headroom on /missions/my and accepts a resubmission through the route", async () => {
    const { creator, mission, submission } = await rejectedSubmission("route-ok");
    const mine = await req("/missions/my", creator.jwt);
    expect(mine.status).toBe(200);
    const mineBody = await mine.json();
    const row = (mineBody.submissions as Array<Record<string, unknown>>).find((value) => value.id === submission.id);
    expect(row).toMatchObject({ status: "rejected", resubmit_remaining: 2, resubmit_count: 0, closed: false });

    const requestId = randomUUID();
    const res = await req(`/missions/${mission.slug}/submit`, creator.jwt, {
      method: "PUT",
      body: JSON.stringify({
        content_urls: ["https://example.test/route-corrected"],
        request_id: requestId,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: submission.id, status: "submitted", resubmit_count: 1 });

    // Same request id + payload replay is idempotent at the route boundary too.
    const replay = await req(`/missions/${mission.slug}/submit`, creator.jwt, {
      method: "PUT",
      body: JSON.stringify({
        content_urls: ["https://example.test/route-corrected"],
        request_id: requestId,
      }),
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).resubmit_count).toBe(1);

    const after = await req("/missions/my", creator.jwt);
    const afterRow = ((await after.json()).submissions as Array<Record<string, unknown>>)
      .find((value) => value.id === submission.id);
    expect(afterRow).toMatchObject({ resubmit_remaining: 1, resubmit_count: 1 });
  });

  it("maps revision exhaustion and idempotency conflicts to 409", async () => {
    const { mission, creator, submission } = await rejectedSubmission("route-limit");
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const res = await req(`/missions/${mission.slug}/submit`, creator.jwt, {
        method: "PUT",
        body: JSON.stringify({ content_urls: [`https://example.test/route-${attempt}`], request_id: randomUUID() }),
      });
      expect(res.status).toBe(200);
      const rejected = await serviceForTests()
        .from("mission_submissions")
        .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewer_notes: `round ${attempt}` })
        .eq("id", submission.id);
      expect(rejected.error).toBeNull();
    }
    const blocked = await req(`/missions/${mission.slug}/submit`, creator.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://example.test/route-3"], request_id: randomUUID() }),
    });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe("revision_limit_reached");
  });

  it("maps an idempotency conflict to 409", async () => {
    const { mission, creator } = await rejectedSubmission("route-conflict");
    const requestId = randomUUID();
    const first = await req(`/missions/${mission.slug}/submit`, creator.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://example.test/conflict-one"], request_id: requestId }),
    });
    expect(first.status).toBe(200);
    const conflict = await req(`/missions/${mission.slug}/submit`, creator.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://example.test/conflict-two"], request_id: requestId }),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
