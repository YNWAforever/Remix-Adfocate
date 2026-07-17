import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createApp } from "../app";
import {
  joinMissionWithWorkflowRecovery,
  submitMissionForMode,
} from "../routes/missions";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  makeCreator,
  makeMission,
  cleanup,
  hasSupabaseEnv,
  seedActiveMission,
  serviceForTests,
  creatorRewardSnapshot,
} from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": "demo",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("mission route behavior without a live database", () => {
  it("recovers an active-workspace join after workflow creation failed", async () => {
    const mission = { id: "mission-1", creator_workflow_mode: "active_workspace" };
    const submission = {
      id: "submission-1",
      mission_id: mission.id,
      creator_id: "creator-1",
      workspace_id: "workspace-1",
      status: "joined",
    };
    let storedSubmission: typeof submission | null = null;
    let xp = 0;
    let filled = 0;
    let workflowAttempts = 0;
    const events: string[] = [];
    const rpc = vi.fn(async (name: string, args: Record<string, string>) => {
      events.push(`rpc:${name}:${JSON.stringify(args)}`);
      if (name === "join_mission") {
        if (storedSubmission) {
          return { data: null, error: { message: "already_joined" } };
        }
        storedSubmission = submission;
        xp += 10;
        filled += 1;
        return { data: submission, error: null };
      }
      if (name === "create_mission_workflow") {
        workflowAttempts += 1;
        if (workflowAttempts === 1) {
          return { data: null, error: { message: "workflow_failed" } };
        }
        return {
          data: { id: "workflow-1", mission_submission_id: submission.id },
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const maybeSingle = vi.fn(async () => {
      events.push("query:maybeSingle");
      return { data: storedSubmission, error: null };
    });
    const eq = vi.fn((column: string, value: string) => {
      events.push(`query:eq:${column}:${value}`);
      return { eq, maybeSingle };
    });
    const select = vi.fn((columns: string) => {
      events.push(`query:select:${columns}`);
      return { eq };
    });
    const from = vi.fn((table: string) => {
      expect(table).toBe("mission_submissions");
      events.push(`query:from:${table}`);
      return { select };
    });
    const client = { rpc, from } as unknown as SupabaseClient;

    const first = await joinMissionWithWorkflowRecovery(
      client,
      mission,
      "creator-1",
      "workspace-1",
    );
    expect(first.error?.message).toBe("workflow_failed");

    const second = await joinMissionWithWorkflowRecovery(
      client,
      mission,
      "creator-1",
      "workspace-1",
    );
    expect(second).toEqual({
      data: {
        submission,
        workflow: { id: "workflow-1", mission_submission_id: submission.id },
      },
      error: null,
    });
    expect(rpc.mock.calls).toEqual([
      ["join_mission", { p_mission: "mission-1" }],
      ["create_mission_workflow", { p_submission: "submission-1" }],
      ["join_mission", { p_mission: "mission-1" }],
      ["create_mission_workflow", { p_submission: "submission-1" }],
    ]);
    expect(events).toEqual([
      'rpc:join_mission:{"p_mission":"mission-1"}',
      'rpc:create_mission_workflow:{"p_submission":"submission-1"}',
      'rpc:join_mission:{"p_mission":"mission-1"}',
      "query:from:mission_submissions",
      "query:select:*",
      "query:eq:mission_id:mission-1",
      "query:eq:creator_id:creator-1",
      "query:eq:workspace_id:workspace-1",
      "query:maybeSingle",
      'rpc:create_mission_workflow:{"p_submission":"submission-1"}',
    ]);
    expect(rpc.mock.calls.filter(([name]) => name === "join_mission")).toHaveLength(2);
    expect(rpc.mock.calls.filter(([name]) => name === "create_mission_workflow")).toHaveLength(2);
    expect(select).toHaveBeenCalledWith("*");
    expect(eq.mock.calls).toEqual([
      ["mission_id", "mission-1"],
      ["creator_id", "creator-1"],
      ["workspace_id", "workspace-1"],
    ]);
    expect({ xp, filled }).toEqual({ xp: 10, filled: 1 });
  });

  it("keeps legacy already_joined behavior unchanged", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "already_joined" } }));
    const from = vi.fn();
    const result = await joinMissionWithWorkflowRecovery(
      { rpc, from } as unknown as SupabaseClient,
      { id: "mission-legacy", creator_workflow_mode: "legacy" },
      "creator-1",
      "workspace-1",
    );

    expect(result.error?.message).toBe("already_joined");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not recover an active-workspace submission in the wrong state", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "already_joined" } }));
    const maybeSingle = vi.fn(async () => ({
      data: { id: "submission-1", status: "submitted" },
      error: null,
    }));
    const eq = vi.fn(() => ({ eq, maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const result = await joinMissionWithWorkflowRecovery(
      { rpc, from } as unknown as SupabaseClient,
      { id: "mission-1", creator_workflow_mode: "active_workspace" },
      "creator-1",
      "workspace-1",
    );

    expect(result.error?.message).toBe("already_joined");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("guards active-workspace submit without calling submit_mission", async () => {
    const rpc = vi.fn();
    const result = await submitMissionForMode(
      { rpc } as unknown as SupabaseClient,
      { id: "mission-1", creator_workflow_mode: "active_workspace" },
      { content_urls: ["https://example.com/post"] },
    );

    expect(result).toEqual({ mismatch: true, data: null, error: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});

suite("mission join", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("join@test.local", 0);
  });
  afterAll(cleanup);

  it("joins an open mission: row created, status joined, +10 XP", async () => {
    await makeMission({ slug: "test-join-ok", points_reward: 100, quota: 5 });
    const res = await req("/missions/test-join-ok/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("joined");
    expect(body.xp_awarded).toBe(10);

    const me = await req("/me", koc.jwt);
    expect((await me.json()).xp).toBe(10);
  });

  it("rejects a second join with already_joined", async () => {
    const res = await req("/missions/test-join-ok/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("already_joined");
  });

  it("rejects join when the mission is full", async () => {
    await makeMission({ slug: "test-join-full", quota: 1, filled: 1 });
    const res = await req("/missions/test-join-full/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("mission_full");
  });

  it("rejects join on a non-open (application) mission", async () => {
    await makeMission({ slug: "test-join-gated", access_type: "application" });
    const res = await req("/missions/test-join-gated/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_open");
  });

  it("rejects join on a closed mission with 404 (status guard fires before RPC)", async () => {
    await makeMission({ slug: "test-join-closed", status: "closed" });
    const res = await req("/missions/test-join-closed/join", koc.jwt, { method: "POST" });
    // B1 guard: join lookup filters .eq("status","active"), so closed missions are
    // not_found at the DB level — consistent with GET /:slug and missionAuthoring tests.
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });

  it("404s an unknown mission slug", async () => {
    const res = await req("/missions/test-does-not-exist/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("creates one workflow for an active-workspace direct join", async () => {
    const active = await seedActiveMission({
      email: "active-route-join@test.local",
      slug: "test-active-route-join",
      deliverables: [{ title: "Instagram post", platform: "instagram" }],
    });
    const svc = serviceForTests();
    const removed = await svc.from("mission_submissions").delete().eq("id", active.submission.id);
    expect(removed.error).toBeNull();
    const before = await creatorRewardSnapshot(active.creator.id);

    const first = await req("/missions/test-active-route-join/join", active.creator.jwt, { method: "POST" });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.submission.status).toBe("joined");
    expect(body.workflow).toMatchObject({
      mission_submission_id: body.submission.id,
      state: "drafting",
    });
    const afterFirst = await creatorRewardSnapshot(active.creator.id);
    const missionAfterFirst = await svc.from("missions").select("filled").eq("id", active.mission.id).single();
    expect(missionAfterFirst.error).toBeNull();

    const repeated = await req("/missions/test-active-route-join/join", active.creator.jwt, { method: "POST" });
    expect(repeated.status).toBe(200);
    const repeatedBody = await repeated.json();
    expect(repeatedBody.submission.id).toBe(body.submission.id);
    expect(repeatedBody.workflow.id).toBe(body.workflow.id);
    const workflows = await svc.from("mission_workflows").select("id").eq("mission_submission_id", body.submission.id);
    expect(workflows.error).toBeNull();
    expect(workflows.data).toHaveLength(1);
    const afterRepeated = await creatorRewardSnapshot(active.creator.id);
    expect(afterFirst.xp - before.xp).toBe(10);
    expect(afterFirst.points).toBe(before.points);
    expect(afterRepeated).toEqual(afterFirst);
    const missionAfterRepeated = await svc.from("missions").select("filled").eq("id", active.mission.id).single();
    expect(missionAfterRepeated.error).toBeNull();
    expect(missionAfterFirst.data?.filled).toBe(1);
    expect(missionAfterRepeated.data?.filled).toBe(missionAfterFirst.data?.filled);
  });
});

suite("mission submit", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("submit@test.local", 0);
    await makeMission({ slug: "test-submit-ok", points_reward: 100, quota: 5 });
    await req("/missions/test-submit-ok/join", koc.jwt, { method: "POST" });
  });
  afterAll(cleanup);

  it("submits content: status submitted, +25 XP (total 35)", async () => {
    const res = await req("/missions/test-submit-ok/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://ig.com/p/abc"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("submitted");
    expect(body.content_urls).toEqual(["https://ig.com/p/abc"]);
    expect(body.submitted_at).toBeTruthy();
    expect(body.xp_awarded).toBe(35);
  });

  it("rejects an empty content_urls array", async () => {
    await makeMission({ slug: "test-submit-empty", quota: 5 });
    await req("/missions/test-submit-empty/join", koc.jwt, { method: "POST" });
    const res = await req("/missions/test-submit-empty/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: [] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("empty_urls");
  });

  it("rejects submit before join (wrong_state)", async () => {
    await makeMission({ slug: "test-submit-nojoin", quota: 5 });
    const res = await req("/missions/test-submit-nojoin/submit", koc.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://x"] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("wrong_state");
  });

  it("rejects legacy submit for active-workspace missions without mutating rewards", async () => {
    const active = await seedActiveMission({
      email: "active-route-submit@test.local",
      slug: "test-active-route-submit",
      deliverables: [{ title: "Instagram reel", platform: "instagram" }],
    });
    const before = await creatorRewardSnapshot(active.creator.id);

    const response = await req("/missions/test-active-route-submit/submit", active.creator.jwt, {
      method: "PUT",
      body: JSON.stringify({ content_urls: ["https://example.com/post"] }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "WORKFLOW_MODE_MISMATCH" });
    expect(await creatorRewardSnapshot(active.creator.id)).toEqual(before);
    const stored = await serviceForTests()
      .from("mission_submissions")
      .select("status, xp_awarded, points_awarded")
      .eq("id", active.submission.id)
      .single();
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject({ status: "joined", xp_awarded: 0, points_awarded: 0 });
  });
});

suite("mission list + my + apply", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("list@test.local", 0);
    await makeMission({ slug: "test-list-joined", quota: 5 });
    await req("/missions/test-list-joined/join", koc.jwt, { method: "POST" });
  });
  afterAll(cleanup);

  it("GET / annotates joined missions with my_status", async () => {
    const res = await req("/missions", koc.jwt);
    expect(res.status).toBe(200);
    const { missions } = await res.json();
    const joined = missions.find((m: { slug: string }) => m.slug === "test-list-joined");
    expect(joined.my_status).toBe("joined");
    // a seed mission the koc never joined stays null
    const other = missions.find((m: { slug: string }) => m.slug === "ugc-cafe");
    expect(other.my_status).toBeNull();
  });

  it("GET /my returns the caller's submissions", async () => {
    const res = await req("/missions/my", koc.jwt);
    expect(res.status).toBe(200);
    const { submissions } = await res.json();
    expect(submissions).toHaveLength(1);
    expect(submissions[0].status).toBe("joined");
    expect(submissions[0].missions.slug).toBe("test-list-joined");
  });

  it("GET /my?status=approved filters to none here", async () => {
    const res = await req("/missions/my?status=approved", koc.jwt);
    expect((await res.json()).submissions).toHaveLength(0);
  });

  it("POST /:slug/apply applies to an application mission (→ applied)", async () => {
    await makeMission({ slug: "test-apply-gated", access_type: "application" });
    const res = await req("/missions/test-apply-gated/apply", koc.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("applied");
  });

  it("GET /:slug returns the brief fields + brand", async () => {
    await makeMission({ slug: "test-brief-fields", access_type: "open" });
    const res = await req("/missions/test-brief-fields", koc.jwt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brand).toBe("Demo Brand");          // joined from workspaces.name
    expect(Array.isArray(body.deliverables)).toBe(true);
    expect(Array.isArray(body.requirements)).toBe(true);
    expect(Array.isArray(body.platforms)).toBe(true);
    expect(body).not.toHaveProperty("workspaces");   // nested join flattened away
  });

  it("does not leak another creator's submissions via /my (RLS isolation)", async () => {
    // koc joined test-list-joined above; a different creator must see none of it.
    const other = await makeCreator("list-other@test.local", 0);
    const res = await req("/missions/my", other.jwt);
    expect(res.status).toBe(200);
    expect((await res.json()).submissions).toHaveLength(0);
  });
});
