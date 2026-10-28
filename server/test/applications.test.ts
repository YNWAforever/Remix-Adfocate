import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFixtureStaffApp as createApp } from "./fixtureStaffTransport";
import { acceptApplicationWithWorkflow } from "../routes/admin";
import {
  makeCreator,
  makeMission,
  cleanup,
  hasSupabaseEnv,
  seedActiveMission,
  serviceForTests,
  creatorRewardSnapshot,
} from "./helpers";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
function adminReq(path: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": ADMIN_SECRET, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("active application acceptance without a live database", () => {
  it("recovers workflow creation on repeated acceptance without repeating rewards or quota", async () => {
    const submission = {
      id: "submission-application-1",
      mission_id: "mission-application-1",
      status: "joined",
    };
    const workflow = {
      id: "workflow-application-1",
      mission_submission_id: submission.id,
    };
    const events: string[] = [];
    let accepted = false;
    let rewardMutations = 0;
    let quotaMutations = 0;
    let workflowAttempts = 0;
    const rpc = vi.fn(async (name: string, args: Record<string, string>) => {
      events.push(`rpc:${name}:${JSON.stringify(args)}`);
      if (name === "accept_application") {
        if (!accepted) {
          accepted = true;
          rewardMutations += 1;
          quotaMutations += 1;
        }
        return { data: submission, error: null };
      }
      if (name === "create_mission_workflow") {
        workflowAttempts += 1;
        if (workflowAttempts === 1) {
          return { data: null, error: { message: "workflow_failed" } };
        }
        return { data: workflow, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const maybeSingle = vi.fn(async () => {
      events.push("query:maybeSingle");
      return { data: { creator_workflow_mode: "active_workspace" }, error: null };
    });
    const eq = vi.fn((column: string, value: string) => {
      events.push(`query:eq:${column}:${value}`);
      return { maybeSingle };
    });
    const select = vi.fn((columns: string) => {
      events.push(`query:select:${columns}`);
      return { eq };
    });
    const from = vi.fn((table: string) => {
      events.push(`query:from:${table}`);
      return { select };
    });
    const client = { rpc, from } as unknown as SupabaseClient;

    const first = await acceptApplicationWithWorkflow(client, submission.id);
    expect(first).toEqual({ data: null, error: { message: "workflow_failed" }, stage: "workflow" });

    const repeated = await acceptApplicationWithWorkflow(client, submission.id);
    expect(repeated).toEqual({ data: { submission, workflow }, error: null, stage: null });
    expect(rpc.mock.calls).toEqual([
      ["accept_application", { p_submission: submission.id }],
      ["create_mission_workflow", { p_submission: submission.id }],
      ["accept_application", { p_submission: submission.id }],
      ["create_mission_workflow", { p_submission: submission.id }],
    ]);
    expect(events).toEqual([
      `rpc:accept_application:{"p_submission":"${submission.id}"}`,
      "query:from:missions",
      "query:select:creator_workflow_mode",
      `query:eq:id:${submission.mission_id}`,
      "query:maybeSingle",
      `rpc:create_mission_workflow:{"p_submission":"${submission.id}"}`,
      `rpc:accept_application:{"p_submission":"${submission.id}"}`,
      "query:from:missions",
      "query:select:creator_workflow_mode",
      `query:eq:id:${submission.mission_id}`,
      "query:maybeSingle",
      `rpc:create_mission_workflow:{"p_submission":"${submission.id}"}`,
    ]);
    expect({ rewardMutations, quotaMutations }).toEqual({ rewardMutations: 1, quotaMutations: 1 });
  });
});

suite("application-gated missions", () => {
  let koc: { userId: string; jwt: string };
  let koc2: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator(`applicant-${randomUUID()}@test.local`, 0);
    koc2 = await makeCreator(`applicant2-${randomUUID()}@test.local`, 0);
  });
  afterAll(cleanup);

  it("applies to an application mission (→ applied), and a duplicate apply is rejected", async () => {
    await makeMission({ slug: fixtureName("test-app-apply"), title: "申請制任務", access_type: "application", quota: 5 });

    const res = await req(fixtureName("/missions/test-app-apply/apply"), koc.jwt, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("applied");

    const dup = await req(fixtureName("/missions/test-app-apply/apply"), koc.jwt, { method: "POST" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("already_applied");
  });

  it("rejects applying to an open mission (not_application)", async () => {
    await makeMission({ slug: fixtureName("test-open-apply"), title: "公開任務", access_type: "open" });
    const res = await req(fixtureName("/missions/test-open-apply/apply"), koc2.jwt, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_application");
  });

  it("requires authentication to apply", async () => {
    const res = await app.request(fixtureName("/api/missions/test-app-apply/apply"), {
      method: "POST", headers: { "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("operator accept → joined (+10 xp, filled++), then the creator can submit", async () => {
    await makeMission({ slug: fixtureName("test-app-accept"), title: "申請接受", access_type: "application", quota: 1 });
    const applied = await (await req(fixtureName("/missions/test-app-accept/apply"), koc.jwt, { method: "POST" })).json();

    const meBefore = await (await req("/me", koc.jwt)).json();

    const list = await (await adminReq("/admin/applications")).json();
    expect(list.applications.some((a: { id: string }) => a.id === applied.id)).toBe(true);

    const acc = await adminReq(`/admin/applications/${applied.id}/accept`, { method: "POST" });
    expect(acc.status).toBe(200);
    expect((await acc.json()).status).toBe("joined");

    const meAfter = await (await req("/me", koc.jwt)).json();
    expect(meAfter.xp - meBefore.xp).toBe(10);

    const mission = await (await req(fixtureName("/missions/test-app-accept"), koc.jwt)).json();
    expect(mission.filled).toBe(1);

    const sub = await req(fixtureName("/missions/test-app-accept/submit"), koc.jwt, {
      method: "PUT", body: JSON.stringify({ content_urls: ["https://ig.com/p/x"] }),
    });
    expect(sub.status).toBe(200);
    expect((await sub.json()).status).toBe("submitted");
  });

  it("creates one workflow when an active-workspace application is accepted repeatedly", async () => {
    const active = await seedActiveMission({
      email: fixtureName("active-route-application@test.local"),
      slug: fixtureName("test-active-route-application"),
      deliverables: [{ title: "TikTok video", platform: "tiktok" }],
    });
    const svc = serviceForTests();
    expect((await svc.from("mission_submissions").delete().eq("id", active.submission.id)).error).toBeNull();
    expect((await svc.from("missions").update({ access_type: "application" }).eq("id", active.mission.id)).error).toBeNull();
    const before = await creatorRewardSnapshot(active.creator.id);

    const appliedResponse = await req(fixtureName("/missions/test-active-route-application/apply"), active.creator.jwt, {
      method: "POST",
    });
    expect(appliedResponse.status).toBe(200);
    const applied = await appliedResponse.json();

    const first = await adminReq(`/admin/applications/${applied.id}/accept`, { method: "POST" });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.submission.status).toBe("joined");
    expect(firstBody.workflow).toMatchObject({
      mission_submission_id: applied.id,
      state: "drafting",
    });

    const repeated = await adminReq(`/admin/applications/${applied.id}/accept`, { method: "POST" });
    expect(repeated.status).toBe(200);
    const repeatedBody = await repeated.json();
    expect(repeatedBody.submission.id).toBe(firstBody.submission.id);
    expect(repeatedBody.workflow.id).toBe(firstBody.workflow.id);
    const after = await creatorRewardSnapshot(active.creator.id);
    expect(after.xp - before.xp).toBe(10);
    const mission = await svc.from("missions").select("filled").eq("id", active.mission.id).single();
    expect(mission.error).toBeNull();
    expect(mission.data?.filled).toBe(1);
  });

  it("accept fails with mission_full when the quota is reached", async () => {
    // test-app-accept (quota 1) is already filled by koc above; koc2 applies then accept fails.
    const applied = await (await req(fixtureName("/missions/test-app-accept/apply"), koc2.jwt, { method: "POST" })).json();
    const res = await adminReq(`/admin/applications/${applied.id}/accept`, { method: "POST" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("mission_full");
  });

  it("operator can decline an application", async () => {
    await makeMission({ slug: fixtureName("test-app-decline"), title: "申請拒絕", access_type: "application", quota: 5 });
    const applied = await (await req(fixtureName("/missions/test-app-decline/apply"), koc2.jwt, { method: "POST" })).json();
    const res = await adminReq(`/admin/applications/${applied.id}/decline`, {
      method: "POST", body: JSON.stringify({ notes: "唔啱" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("declined");
  });
});
