// server/test/missionAuthoring.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";
import { normalizeDeliverableSpecs, validateDeliverableSpecs } from "../lib/missionAuthoring";

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET!;
const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

describe("structured deliverable specs", () => {
  it("keeps legacy string deliverables valid and emits no proof requirement", () => {
    const result = normalizeDeliverableSpecs({
      deliverables: ["Publish one review"],
    });

    expect(result).toEqual([{
      title: "Publish one review",
      instructions: "",
      requirements: { caption: false, externalUrl: false, checklist: [] },
      requiresAsset: false,
      proofRequirement: null,
    }]);
  });

  it("accepts a publication URL proof requirement with optional evidence", () => {
    expect(validateDeliverableSpecs([{
      title: "Publish one review",
      instructions: "Publish on an allowed platform.",
      requirements: { caption: true, externalUrl: true, checklist: ["Use the campaign tag"] },
      requiresAsset: false,
      proofRequirement: {
        kind: "publication_url",
        allowedPlatforms: ["instagram", "youtube"],
        evidence: "optional",
      },
    }])).toEqual([]);
  });

  it("returns stable codes for invalid publication proof requirements", () => {
    expect(validateDeliverableSpecs([{
      title: "",
      instructions: "",
      requirements: { caption: false, externalUrl: false, checklist: [] },
      requiresAsset: false,
      proofRequirement: { kind: "publication_url", allowedPlatforms: ["instagram"], evidence: "optional" },
    }])).toContain("deliverable_specs.0.title_required");
    expect(validateDeliverableSpecs([{
      title: "Publish one review",
      instructions: "",
      requirements: { caption: false, externalUrl: false, checklist: [] },
      requiresAsset: false,
      proofRequirement: { kind: "unsupported" as "publication_url", allowedPlatforms: ["instagram"], evidence: "optional" },
    }])).toContain("deliverable_specs.0.proof_requirement.kind_invalid");
    expect(validateDeliverableSpecs([{
      title: "Publish one review",
      instructions: "",
      requirements: { caption: false, externalUrl: false, checklist: [] },
      requiresAsset: false,
      proofRequirement: { kind: "publication_url", allowedPlatforms: [], evidence: "optional" },
    }])).toContain("deliverable_specs.0.proof_requirement.allowed_platforms_required");
  });
});

function koreq(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
function adminreq(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("B1 visibility guards", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("b1vis@test.local", 0);
    await makeMission({ slug: "test-vis-draft", status: "draft", category: "美容" });
    await makeMission({ slug: "test-vis-closed", status: "closed", category: "美容" });
    await makeMission({ slug: "test-vis-active", status: "active", category: "美容" });
  });
  afterAll(cleanup);

  it("creator list excludes draft + closed", async () => {
    const { missions } = await (await koreq("/missions", koc.jwt)).json();
    const slugs = missions.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("test-vis-active");
    expect(slugs).not.toContain("test-vis-draft");
    expect(slugs).not.toContain("test-vis-closed");
  });

  it("creator detail 404s a draft/closed slug", async () => {
    expect((await koreq("/missions/test-vis-draft", koc.jwt)).status).toBe(404);
    expect((await koreq("/missions/test-vis-closed", koc.jwt)).status).toBe(404);
    expect((await koreq("/missions/test-vis-active", koc.jwt)).status).toBe(200);
  });

  it("hook-generator 404s a draft/closed slug but works on active", async () => {
    const draft = await koreq("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ mission_slug: "test-vis-draft" }) });
    expect(draft.status).toBe(404);
    const closed = await koreq("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ mission_slug: "test-vis-closed" }) });
    expect(closed.status).toBe(404);
    const active = await koreq("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ mission_slug: "test-vis-active" }) });
    expect(active.status).toBe(200);
  });

  it("join RPC refuses a closed mission (Close auto-blocks new joins)", async () => {
    const res = await koreq("/missions/test-vis-closed/join", koc.jwt, { method: "POST" });
    expect(res.status).toBe(404); // detail-guard returns not_found before the RPC; closed never visible
  });
});

suite("B1 admin read endpoints", () => {
  beforeAll(async () => {
    await cleanup();
    await makeMission({ slug: "test-adm-active", status: "active", category: "美容" });
    await makeMission({ slug: "test-adm-draft", status: "draft", category: "美容" });
  });
  afterAll(cleanup);

  it("401s without the secret", async () => {
    expect((await app.request("/api/admin/missions", { headers: { "Content-Type": "application/json" } })).status).toBe(401);
  });
  it("lists workspaces ordered by name", async () => {
    const { workspaces } = await (await adminreq("/admin/workspaces")).json();
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces.length).toBeGreaterThan(0);
  });
  it("lists all statuses for a workspace, each annotated with engaged", async () => {
    const { missions } = await (await adminreq("/admin/missions?workspace=00000000-0000-0000-0000-0000000000aa")).json();
    const slugs = missions.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("test-adm-active");
    expect(slugs).toContain("test-adm-draft"); // admin sees drafts
    expect(missions.every((m: { engaged: boolean }) => typeof m.engaged === "boolean")).toBe(true);
  });
  it("filters by status", async () => {
    const { missions } = await (await adminreq("/admin/missions?status=draft")).json();
    expect(missions.every((m: { status: string }) => m.status === "draft")).toBe(true);
  });
  it("404s an unknown id", async () => {
    expect((await adminreq("/admin/missions/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});

suite("B1 create + edit", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  async function createDraft(slug: string, over: Record<string, unknown> = {}) {
    const res = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({ workspace_id: "00000000-0000-0000-0000-0000000000aa", slug, title: "草稿", mission_type: "ugc", ...over }),
    });
    return { res, body: await res.json() };
  }

  it("creates a sparse draft (no reward) → 201, not visible to creators", async () => {
    const { res, body } = await createDraft("test-create-1");
    expect(res.status).toBe(201);
    expect(body.mission.status).toBe("draft");
    const koc = await makeCreator("b1create@test.local", 0);
    const { missions } = await (await koreq("/missions", koc.jwt)).json();
    expect(missions.map((m: { slug: string }) => m.slug)).not.toContain("test-create-1");
  });

  it("422s a draft missing mission_type with a per-field error", async () => {
    const res = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({ workspace_id: "00000000-0000-0000-0000-0000000000aa", slug: "test-create-2", title: "x" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation");
    expect(body.fields).toHaveProperty("mission_type");
  });

  it("422s a duplicate slug in the same workspace", async () => {
    await createDraft("test-dupe");
    const { res, body } = await createDraft("test-dupe");
    expect(res.status).toBe(422);
    expect(body.fields).toHaveProperty("slug");
  });

  it("edits the brief of a draft → 200", async () => {
    const { body } = await createDraft("test-edit-brief");
    const res = await adminreq(`/admin/missions/${body.mission.id}`, { method: "PATCH", body: JSON.stringify({ title: "新標題", description: "做啲嘢" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).mission.title).toBe("新標題");
  });
});

suite("B1 lifecycle + locks", () => {
  const WS = "00000000-0000-0000-0000-0000000000aa";
  beforeAll(cleanup);
  afterAll(cleanup);

  async function createDraft(slug: string, over: Record<string, unknown> = {}) {
    const res = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({ workspace_id: WS, slug, title: "草稿", mission_type: "ugc", ...over }),
    });
    return (await res.json()).mission;
  }
  async function publish(id: string) {
    return adminreq(`/admin/missions/${id}/publish`, { method: "POST" });
  }

  it("publish-missing-fields → 422 with fields; complete draft → 200 + visible to creators", async () => {
    const bad = await createDraft("test-pub-bad"); // no reward/category/deadline
    const r1 = await publish(bad.id);
    expect(r1.status).toBe(422);
    expect((await r1.json()).fields).toHaveProperty("category");

    const good = await createDraft("test-pub-good", {
      description: "做啲嘢", category: "美容", access_type: "open", required_level: "L0",
      quota: 5, deadline: "2030-01-01", points_reward: 100,
    });
    expect((await publish(good.id)).status).toBe(200);

    const koc = await makeCreator("b1pub@test.local", 0);
    const { missions } = await (await koreq("/missions", koc.jwt)).json();
    expect(missions.map((m: { slug: string }) => m.slug)).toContain("test-pub-good");
  });

  it("publish a non-draft → 409; close a non-active → 409; edit a closed → 409", async () => {
    const m = await createDraft("test-lc", {
      description: "x", category: "美容", access_type: "open", required_level: "L0", quota: 3, deadline: "2030-01-01", points_reward: 50,
    });
    await publish(m.id);
    expect((await publish(m.id)).status).toBe(409); // already active
    expect((await adminreq(`/admin/missions/${m.id}/close`, { method: "POST" })).status).toBe(200);
    expect((await adminreq(`/admin/missions/${m.id}/close`, { method: "POST" })).status).toBe(409); // already closed
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).status).toBe(409);
  });

  it("slug & mission_type frozen after publish → 422", async () => {
    const m = await createDraft("test-frozen", {
      description: "x", category: "美容", access_type: "open", required_level: "L0", quota: 3, deadline: "2030-01-01", points_reward: 50,
    });
    await publish(m.id);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ slug: "test-frozen-2" }) })).status).toBe(422);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ mission_type: "clipping" }) })).status).toBe(422);
    // brief still editable
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ description: "新簡介" }) })).status).toBe(200);
  });

  it("economic fields lock after a creator joins; brief stays editable; quota cannot drop below filled", async () => {
    const m = await createDraft("test-engage", {
      description: "x", category: "美容", access_type: "open", required_level: "L0", quota: 5, deadline: "2030-01-01", points_reward: 50,
    });
    await publish(m.id);
    const koc = await makeCreator("b1eng@test.local", 0);
    expect((await koreq("/missions/test-engage/join", koc.jwt, { method: "POST" })).status).toBe(200);

    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ points_reward: 999 }) })).status).toBe(422);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ quota: 0 }) })).status).toBe(422);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ title: "改個名" }) })).status).toBe(200);
    expect((await adminreq(`/admin/missions/${m.id}`, { method: "PATCH", body: JSON.stringify({ quota: 9 }) })).status).toBe(200);
  });

  it("delete draft → ok; delete active → 409", async () => {
    const d = await createDraft("test-del-draft");
    expect((await adminreq(`/admin/missions/${d.id}`, { method: "DELETE" })).status).toBe(200);
    const a = await createDraft("test-del-active", {
      description: "x", category: "美容", access_type: "open", required_level: "L0", quota: 3, deadline: "2030-01-01", points_reward: 50,
    });
    await publish(a.id);
    expect((await adminreq(`/admin/missions/${a.id}`, { method: "DELETE" })).status).toBe(409);
  });
});

suite("B2: brief fields round-trip + duplicate", () => {
  const WORKSPACE_ID = "00000000-0000-0000-0000-0000000000aa";
  afterAll(cleanup);

  it("creates a draft with brief fields and reads them back", async () => {
    const create = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: WORKSPACE_ID, slug: "test-b2-brief", title: "Brief", mission_type: "ugc",
        target_audience: "  20-30 城市女性 ",
        dos: [" 真實分享 ", ""],
        donts: ["唔可以講粗口"],
        key_messages: ["新精華", " 快速見效 "],
        reference_links: [" example.com/post ", ""],
      }),
    });
    expect(create.status).toBe(201);
    const { mission } = await create.json();
    expect(mission.target_audience).toBe("20-30 城市女性");
    expect(mission.dos).toEqual(["真實分享"]);
    expect(mission.key_messages).toEqual(["新精華", "快速見效"]);
    expect(mission.reference_links).toEqual(["https://example.com/post"]);
  });

  it("rejects a bad reference link with 422 + fields.reference_links", async () => {
    const res = await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: WORKSPACE_ID, slug: "test-b2-badlink", title: "X", mission_type: "ugc",
        reference_links: ["not a url"],
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("validation");
    expect(body.fields.reference_links).toBeTruthy();
  });

  it("duplicates a mission into a -copy draft, copying brief fields", async () => {
    const src = await (await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: WORKSPACE_ID, slug: "test-b2-dup", title: "Dup me", mission_type: "ugc",
        key_messages: ["copy this"],
      }),
    })).json();

    const dup = await adminreq(`/admin/missions/${src.mission.id}/duplicate`, { method: "POST" });
    expect(dup.status).toBe(201);
    const { mission } = await dup.json();
    expect(mission.id).not.toBe(src.mission.id);
    expect(mission.slug).toBe("test-b2-dup-copy");
    expect(mission.status).toBe("draft");
    expect(mission.filled).toBe(0);
    expect(mission.key_messages).toEqual(["copy this"]);
  });

  it("suffixes -copy-2 when -copy already exists", async () => {
    const src = await (await adminreq("/admin/missions", {
      method: "POST",
      body: JSON.stringify({ workspace_id: WORKSPACE_ID, slug: "test-b2-dup2", title: "D2", mission_type: "ugc" }),
    })).json();
    await adminreq(`/admin/missions/${src.mission.id}/duplicate`, { method: "POST" }); // -copy
    const dup2 = await adminreq(`/admin/missions/${src.mission.id}/duplicate`, { method: "POST" }); // -copy-2
    expect((await dup2.json()).mission.slug).toBe("test-b2-dup2-copy-2");
  });

  it("404s when duplicating a missing mission", async () => {
    const res = await adminreq("/admin/missions/00000000-0000-0000-0000-0000000000ff/duplicate", { method: "POST" });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });
});
