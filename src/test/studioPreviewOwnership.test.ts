import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: { auth: {} } }));
vi.mock("../lib/creatorGrowth/jpegPreparation",()=>({prepareSyntheticJpeg:async()=>({bytes:new Uint8Array([1]),mime:"image/jpeg",width:480,height:600,byteSize:1,sha256:"a".repeat(64)})}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEED = id(901);
const peers = [
  ["same_workspace_creator", "同工作區其他創作者", id(12), id(1)],
  ["other_workspace_creator", "其他工作區創作者", id(13), id(2)],
] as const;

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = "";
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_STUDIO_FIXTURE", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in fixture tests"); }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function install(savedRole = "creator") {
  sessionStorage.setItem("kocmax-local-preview-role", savedRole);
  const { installStudioPreview } = await import("./studioPreview");
  const controls = await installStudioPreview();
  const navigate = vi.fn(async () => undefined);
  controls(navigate, async () => undefined);
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="示例角色"]')!;
  const choose = async (role: string) => {
    select.value = role;
    await select.onchange!.call(select, new Event("change"));
  };
  const request = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    window.fetch(`/api${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const create = async (title: string, requestId = crypto.randomUUID(), missionId: string | null = null) => {
    const response = await request("/studio/commands", {
      action: "create_thread", requestId, payload: { title, topic: "creation", initialPrompt: title, missionId },
    });
    expect(response.status).toBe(200);
    return (await response.json()).result as { id: string; conversation_id: string; revision: number };
  };
  return { choose, request, create, select, navigate };
}

describe("development fixture principal ownership", () => {
  it("isolates the new mission rehearsal and denies every proof/reward write",async()=>{
    const f=await install(),path=`/my-missions/${id(931)}`;
    const before=await(await f.request("/wallet/points")).json();
    expect((await f.request(`${path}/workspace`)).status).toBe(200);
    expect((await f.request(`${path}/publication/${id(941)}`)).status).toBe(200);
    expect((await f.request(`${path}/publication/${id(941)}`,{primaryUrl:"https://example.test/demo"})).status).toBe(403);
    expect(await(await f.request("/wallet/points")).json()).toEqual(before);
    for(const [role] of peers){await f.choose(role);expect((await f.request(`${path}/workspace`)).status).toBe(403);}
  });
  it("copies and saves the dedicated private sample without changing originals or rewards", async () => {
    const f=await install();
    const path=`/studio/threads/${id(910)}`;
    const response=await f.request(path);expect(response.status).toBe(200);
    const detail=await response.json();
    expect(detail.briefs).toHaveLength(2);
    const original=JSON.stringify(detail.briefs);
    const before=await (await f.request("/wallet/points")).json();
    const {copySavedBrief}=await import("../lib/studio/savedOutputs");
    const sections=copySavedBrief(detail.briefs[1],id(910),detail.sources,()=>crypto.randomUUID());
    const saved=await f.request("/studio/commands",{action:"save_brief",requestId:crypto.randomUUID(),payload:{threadId:id(910),revision:detail.thread.revision,sections}});
    expect(saved.status).toBe(200);
    const after=await (await f.request(path)).json();
    expect(after.briefs[0].version).toBe(3);expect(JSON.stringify(after.briefs.slice(1))).toBe(original);
    expect(after.sources.find((s:{kind:string})=>s.kind==="private").shareable).toBe(false);
    expect(after.shares).toEqual([]);expect(await (await f.request("/wallet/points")).json()).toEqual(before);
    for(const [role] of peers){await f.choose(role);expect((await f.request(path)).status).toBe(403);}
  });
  it("exposes the two explicit peer labels with distinct creator/session/workspace identities", async () => {
    const f = await install();
    const { supabase } = await import("../lib/supabase");
    const a = (await supabase.auth.getSession()).data.session!;
    const tokens = new Set([a.access_token]);
    expect((await (await f.request("/me")).json()).id).toBe(id(11));
    for (const [role, label, creatorId, workspaceId] of peers) {
      expect([...f.select.options].find(o => o.value === role)?.text).toBe(label);
      await f.choose(role);
      const session = (await supabase.auth.getSession()).data.session!;
      const me = await (await f.request("/me")).json();
      const workspace = await (await f.request("/workspace/demo")).json();
      expect(session.user.id).toBe(creatorId);
      expect(me).toMatchObject({ id: creatorId, xp: 0 });
      expect(me.display_name).not.toBe("阿晴");
      expect(workspace.id).toBe(workspaceId);
      tokens.add(session.access_token);
      expect(f.navigate).toHaveBeenLastCalledWith("/home");
    }
    expect(tokens.size).toBe(3);
  });

  it.each(peers)("%s denies known A records but owns its own threads and receipts", async (role) => {
    const f = await install();
    const requestId = crypto.randomUUID();
    const a = await f.create("PRIVATE-A-SYNTHETIC", requestId);
    await f.choose(role);
    expect(await (await f.request("/studio/threads")).json()).toEqual({ threads: [], nextPage: null });
    for (const threadId of [a.id, SEED]) {
      const denied = await f.request(`/studio/threads/${threadId}`);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ code: "STUDIO_OWNER_REQUIRED" });
      const write = await f.request("/studio/commands", { action: "save_brief", requestId: crypto.randomUUID(), payload: { threadId, revision: 0, sections: [] } });
      expect(write.status).toBe(403);
    }
    expect((await f.request("/assistant/chat", { conversation_id: a.conversation_id, client_request_id: crypto.randomUUID(), message: "Read A" })).status).toBe(403);
    expect(await (await f.request(`/assistant/requests/${requestId}`)).json()).toEqual({ persistence: "unknown" });
    // Same request key in a different owner namespace cannot replay A's response.
    const b = await f.create("PRIVATE-PEER-SYNTHETIC", requestId);
    expect(b.id).not.toBe(a.id);
    expect((await f.request(`/studio/threads/${b.id}`)).status).toBe(200);
    expect((await f.request(`/studio/threads/${crypto.randomUUID()}`)).status).toBe(404);
    const attachA = await f.request("/studio/commands", { action: "create_thread", requestId: crypto.randomUUID(), payload: { title: "Not mine", topic: "other", missionId: id(21) } });
    expect(attachA.status).toBe(403);
    await f.choose("creator");
    expect((await f.request(`/studio/threads/${a.id}`)).status).toBe(200);
    expect((await f.request(`/studio/threads/${b.id}`)).status).toBe(403);
    expect(await (await f.request("/studio/threads")).json()).not.toEqual(expect.objectContaining({ threads: expect.arrayContaining([expect.objectContaining({ id: b.id })]) }));
    expect((await (await f.request(`/studio/threads/${a.id}`)).json()).briefs).toEqual([]);
    await f.choose(role);
    expect((await f.request(`/studio/threads/${b.id}`)).status).toBe(200);
  });

  it.each(peers)("%s does not inherit A's missions, wallet, notifications or profile state", async role => {
    const f = await install();
    await f.choose(role);
    expect(await (await f.request("/missions/my")).json()).toEqual({ submissions: [] });
    expect((await f.request(`/my-missions/${id(31)}/workspace`)).status).toBe(403);
    expect((await f.request(`/my-missions/${id(31)}/work-items/${id(41)}/draft`, { revision: 0, caption: "ATTACK" }, "PATCH")).status).toBe(403);
    expect(await (await f.request("/wallet/points")).json()).toMatchObject({ balance: 0 });
    expect(await (await f.request("/notifications")).json()).toMatchObject({ items: [] });
    expect((await f.request("/me/profile", { display_name: "Peer only" }, "PATCH")).status).toBe(200);
    expect((await (await f.request("/me")).json()).display_name).toBe("Peer only");
    expect((await f.request("/me/passport/share", {})).status).not.toBe(200);
    await f.choose("creator");
    expect((await (await f.request("/me")).json()).display_name).toBe("阿晴");
    expect((await (await f.request("/missions/my")).json()).submissions).toHaveLength(1);
    expect((await (await f.request(`/my-missions/${id(31)}/workspace`)).json()).workItems[0].draft.caption).toBe("");
  });

  it.each(peers)("%s initializes independent defaults after A profile edits", async (role, label, creatorId) => {
    const f = await install();
    // Use the existing profile API before this peer has ever been initialized.
    const ownerProfile = {
      display_name: "A 的合成私人資料",
      categories: ["travel"],
      social_handles: [{ platform: "instagram", handle: "synthetic_owner_a_only" }],
    };
    expect((await f.request("/me/profile", ownerProfile, "PATCH")).status).toBe(200);
    expect(await (await f.request("/me")).json()).toMatchObject(ownerProfile);

    await f.choose(role);
    const peerDefaults = {
      id: creatorId, display_name: `${label}（合成示例）`,
      level: "L0", level_seen: "L0", xp: 0, onboarding_step: 4, onboarding_completed: true,
      categories: [], social_handles: [], social_accounts: [], is_trusted: false,
    };
    expect(await (await f.request("/me")).json()).toEqual(peerDefaults);
    expect(await (await f.request("/me/profile")).json()).toEqual(peerDefaults);

    await f.choose("creator");
    expect(await (await f.request("/me")).json()).toMatchObject(ownerProfile);
    expect((await (await f.request("/missions/my")).json()).submissions).toHaveLength(1);
    expect((await f.request(`/studio/threads/${SEED}`)).status).toBe(200);
  });

  it("keeps the fixed synthetic A thread available across fixture reload and peer denial", async () => {
    let f = await install();
    const initial = await f.request(`/studio/threads/${SEED}`);
    expect(initial.status).toBe(200);
    const detail = await initial.json();
    expect(detail.thread.title).toContain("合成示例");
    await f.choose("same_workspace_creator");
    vi.resetModules(); document.body.innerHTML = "";
    f = await install("same_workspace_creator");
    expect((await f.request(`/studio/threads/${SEED}`)).status).toBe(403);
    await f.choose("creator");
    expect((await (await f.request(`/studio/threads/${SEED}`)).json()).thread.title).toBe(detail.thread.title);
  });

  it.each([
    ["brand", "/brand/missions"], ["brand_member", "/brand/missions"],
    ["operator", `/admin/active-missions/${id(31)}`], ["reviewer", `/admin/active-missions/${id(31)}`],
    ["finance_viewer", "/admin/reward-handoffs"], ["workspace_admin", `/admin/active-missions/${id(31)}`],
  ])("preserves %s legitimate mission views while denying creator private endpoints", async (role, sharedPath) => {
    const f = await install();
    const thread = await f.create("A private, not mission proof");
    await f.choose(role);
    expect((await f.request(sharedPath)).status).toBe(200);
    if (role.startsWith("brand")) expect((await (await f.request("/brand/me")).json()).brand.role).toBe(role === "brand" ? "owner" : "member");
    for (const path of ["/studio/threads", `/studio/threads/${thread.id}`, `/my-missions/${id(31)}/workspace`, "/creator-growth/drafts/owner-a", "/creator-growth/publish/owner-a"]) {
      expect((await f.request(path)).status, path).toBe(403);
    }
    expect((await f.request("/studio/commands", { action: "create_thread", requestId: crypto.randomUUID(), payload: { title: "private" } })).status).toBe(403);
    expect((await f.request("/assistant/chat", { conversation_id: thread.conversation_id })).status).toBe(403);
  });

  it.each(peers)("%s cannot use owner A growth/publish endpoints with forged owner fields", async role => {
    const f = await install(); await f.choose(role);
    for (const path of ["/creator-growth/assets", "/creator-growth/analyse", "/creator-growth/publish/preview", "/creator-growth/publish/approve", "/creator-growth/publish/owner-a/reconcile"]) {
      expect((await f.request(path, { ownerId: id(11), workspaceId: id(1), threadId: SEED })).status, path).toBe(403);
    }
    expect((await f.request("/admin/me")).status).toBe(403);
    expect((await f.request("/brand/me")).status).toBe(403);
    await f.choose("creator");
    // Unsupported owned transport stays unavailable; this fixture does not invent publishing success.
    expect((await f.request("/creator-growth/publish/preview", { threadId: SEED })).status).toBe(503);
  });

  it("simulates Studio login-required without changing identity or replaying commands", async () => {
    const f=await install();
    const scenario=document.querySelector<HTMLSelectElement>('select[aria-label="示例資料狀態"]')!;
    expect([...scenario.options].some(o=>o.value==="studio_login_required")).toBe(true);
    scenario.value="studio_login_required";
    await scenario.onchange!.call(scenario,new Event("change"));
    expect((await f.request("/me")).status).toBe(200);
    for(const path of ["/studio/threads",`/studio/threads/${SEED}`]) expect((await f.request(path)).status).toBe(401);
    expect((await f.request("/studio/commands",{action:"create_thread",requestId:crypto.randomUUID(),payload:{title:"MUST_NOT_EXIST",topic:"creation"}})).status).toBe(401);
    scenario.value="normal";
    await scenario.onchange!.call(scenario,new Event("change"));
    expect((await f.request(`/studio/threads/${SEED}`)).status).toBe(200);
    expect(JSON.stringify(await (await f.request("/studio/threads")).json())).not.toContain("MUST_NOT_EXIST");
  });
  it("keeps reads available but rejects command-only login failures before mutation",async()=>{
    const f=await install();
    const scenario=document.querySelector<HTMLSelectElement>('select[aria-label="示例資料狀態"]')!;
    expect([...scenario.options].some(o=>o.value==="studio_command_login_required")).toBe(true);
    scenario.value="studio_command_login_required";await scenario.onchange!.call(scenario,new Event("change"));
    expect((await f.request(`/studio/threads/${SEED}`)).status).toBe(200);
    const before=await (await f.request(`/studio/threads/${SEED}`)).json();
    expect((await f.request("/studio/commands",{action:"save_brief",requestId:crypto.randomUUID(),payload:{threadId:SEED,revision:0,sections:[]}})).status).toBe(401);
    expect((await f.request("/assistant/chat",{conversation_id:id(902),message:"DO_NOT_SEND"})).status).toBe(401);
    expect((await f.request("/assistant/requests/sample" )).status).toBe(401);
    expect(await (await f.request(`/studio/threads/${SEED}`)).json()).toEqual(before);
    scenario.value="normal";await scenario.onchange!.call(scenario,new Event("change"));
  });
  it("isolates source401 rehearsal from Studio reads and creates no connection",async()=>{
    const f=await install();
    const scenario=document.querySelector<HTMLSelectElement>('select[aria-label="示例資料狀態"]')!;
    expect([...scenario.options].some(o=>o.value==="source_login_required")).toBe(true);
    scenario.value="source_login_required";await scenario.onchange!.call(scenario,new Event("change"));
    expect((await f.request("/me/integrations")).status).toBe(401);
    expect((await f.request("/me/integrations/mock-id/import",{})).status).toBe(401);
    expect((await f.request(`/studio/threads/${SEED}`)).status).toBe(200);
    scenario.value="normal";await scenario.onchange!.call(scenario,new Event("change"));
    expect((await (await f.request("/me/integrations")).json()).connections).toEqual([]);
  });

  it("preserves visitor, onboarding, editor and explicit generic failure scenarios", async () => {
    const f = await install("visitor");
    expect((await f.request("/public/missions")).status).toBe(200);
    expect((await f.request(`/studio/threads/${SEED}`)).status).toBe(401);
    await f.choose("new_creator");
    expect((await (await f.request("/onboarding/status")).json()).onboarding_completed).toBe(false);
    await f.choose("content_editor");
    expect((await f.request("/admin/content")).status).toBe(200);
    await f.choose("creator");
    const scenario = document.querySelector<HTMLSelectElement>('select[aria-label="示例資料狀態"]')!;
    scenario.value = "denied"; await scenario.onchange!.call(scenario, new Event("change"));
    expect(await (await f.request(`/studio/threads/${SEED}`)).json()).toMatchObject({ code: "STAFF_CAPABILITY_REQUIRED" });
    scenario.value = "normal"; await scenario.onchange!.call(scenario, new Event("change"));
    expect((await f.request(`/studio/threads/${SEED}`)).status).toBe(200);
    expect((await window.fetch("https://example.invalid/api/me")).status).toBe(503);
  });

  it.each([[false, "true"], [true, "false"]] as const)("requires DEV=%s and explicit flag=%s before installing", async (dev, flag) => {
    vi.stubEnv("DEV", dev); vi.stubEnv("VITE_STUDIO_FIXTURE", flag);
    const original = window.fetch;
    const { installStudioPreview } = await import("./studioPreview");
    await expect(installStudioPreview()).rejects.toThrow("Preview requires explicit development mode");
    expect(window.fetch).toBe(original);
  });
});
