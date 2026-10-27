import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { createAuditFixture } from "./auditWorkflowFixture";
import { missionEligibility } from "../../src/lib/missionMeta";

vi.mock("../lib/llm", async (original) => ({ ...await original<typeof import("../lib/llm")>(), enhanceRationales: async () => undefined }));
const enabled = process.env.RUN_AUDIT_INTEGRATION === "1";
const decisionFields = ["cash_reward","required_level","platforms","deliverables","effort","brand","deadline","quota","filled","points_reward","access_type","mission_type"];
describe.skipIf(!enabled)("D09 real disposable mission decision contract", () => {
  let fixture: Awaited<ReturnType<typeof createAuditFixture>>;
  let app: ReturnType<(typeof import("../app"))["createApp"]>["app"];
  const missions: Array<{id:string;slug:string;category:string;title:string}> = [];
  let foreignId: string, foreignSlug: string, hiddenSlug: string;
  let before: Awaited<ReturnType<Awaited<ReturnType<typeof createAuditFixture>>["neutrality"]>>;
  beforeAll(async () => {
    // createAuditFixture verifies exact container/project/network identity before SDK/client/setup.
    fixture = await (await import("./auditWorkflowFixture")).createAuditFixture();
    app = (await import("../app")).createApp().app;
    fixture.must(await fixture.service.from("creators").update({xp:6000,level_seen:"L3"}).eq("id",fixture.creators[1].id).eq("workspace_id",fixture.workspaceId));
    const deadline = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    for (const [index,category] of ["寵物","旅遊","travel","原有未知長中文分類"].entries()) {
      const mission = await fixture.mission("legacy",false,10);
      const title = ["寵物介紹與很長的中文任務標題內容","旅遊零現金任務","歷史旅遊未知現金任務","未知分類任務"][index];
      fixture.must(await fixture.service.from("missions").update({category,title,deadline,
        required_level:index===0?"L2":"L0",cash_reward:index===1?0:index===2?null:125,effort:index===2?null:"medium",
        platforms:["instagram","tiktok"],deliverables:["一條附有清晰披露的中文短片"],description:"Synthetic decision-contract acceptance"})
        .eq("id",mission.id).eq("workspace_id",fixture.workspaceId));
      missions.push({...mission,category,title});
    }
    const hidden=await fixture.mission("legacy",false,10);hiddenSlug=hidden.slug;
    fixture.must(await fixture.service.from("missions").update({status:"draft"}).eq("id",hidden.id).eq("workspace_id",fixture.workspaceId));
    foreignId=randomUUID();foreignSlug=`foreign-${foreignId}`;
    fixture.must(await fixture.service.from("missions").insert({id:foreignId,workspace_id:fixture.otherWorkspaceId,slug:foreignSlug,
      title:"Foreign synthetic mission",category:"寵物",mission_type:"ugc",required_level:"L0",points_reward:50,quota:10,status:"active"}));
    // Establish the already-joined fixture before measuring discovery reads.
    // Existing legacy join_mission grants 10 XP; record that raw setup effect.
    const initial=await fixture.neutrality(fixture.creators[0].id);
    await request("/me");await request("/me",fixture.creators[1]);
    await request(`/missions/${missions[1].slug}/join`,fixture.creators[0],"POST");
    before=await fixture.neutrality(fixture.creators[0].id);
    expect(before.xp).toBe(initial.xp+10);
    fixture.recordEvidence({caseId:"D09-existing-join-setup",initial,measuredBaseline:before,source:"existing join_mission grants 10 XP; no new reward behavior"});
    fixture.recordEvidence({caseId:"D09-setup",ownedMissionIds:[...missions.map(x=>x.id),hidden.id,foreignId],result:"fixture-ready"});
  },60000);
  async function request(path:string,actor=fixture.creators[0],method="GET",status=200) {
    const response=await app.request(`/api${path}`,{method,headers:{Authorization:`Bearer ${actor.jwt}`,"X-Workspace-Slug":fixture.slug}});
    const body=await response.json();expect(response.status,`${path}: ${JSON.stringify(body)}`).toBe(status);return body;
  }
  it("serializes all decision facts from real PostgREST list and detail, preserving zero/null", async () => {
    const list=await request("/missions");expect(list.missions).toHaveLength(4);
    for (const mission of missions) {
      const row=list.missions.find((x:{id:string})=>x.id===mission.id);
      const detail=await request(`/missions/${mission.slug}`);
      for (const key of decisionFields) {expect(row,key).toHaveProperty(key);expect(row[key],key).toEqual(detail[key]);}
      expect(row.brand).toBe("Synthetic audit workspace A");
    }
    expect(list.missions.find((x:{id:string})=>x.id===missions[1].id).cash_reward).toBe(0);
    expect(list.missions.find((x:{id:string})=>x.id===missions[2].id).cash_reward).toBeNull();
  });
  it("keeps pet/travel aliases and unknown categories findable without changing stored values", async () => {
    for (const [category,expected] of [["寵物",[missions[0].id]],["旅遊",[missions[1].id,missions[2].id]],["pets",[missions[0].id]],
      ["原有未知長中文分類",[missions[3].id]]] as Array<[string,string[]]>) {
      const list=await request(`/missions?category=${encodeURIComponent(category)}`);
      expect(list.missions.map((x:{id:string})=>x.id).sort()).toEqual(expected.sort());
    }
    expect((await request(`/missions/${missions[2].slug}`)).category).toBe("travel");
  });
  it.each(["/match","/onboarding/recommended-missions"])("keeps the existing %s decision DTO backed and workspace-scoped", async (path) => {
    const payload=await request(path);
    const rows=payload.matches??payload.missions;expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(missions.map(x=>x.id)).toContain(row.id);
      const detail=await request(`/missions/${row.slug}`);
      for (const key of decisionFields) expect(row,key).toHaveProperty(key,detail[key]);
    }
  });
  it("matches the existing XP/verified-handle join gate and never calls unverified L3 unlocked", async () => {
    const mission=missions[0];
    const low=await request("/me");const high=await request("/me",fixture.creators[1]);
    expect(low.level).toBe("L0");expect(high.level).toBe("L3");expect(high.is_trusted).toBe(false);
    expect(missionEligibility("L2",low.level,low.is_trusted).labelKey).toBe("app.eligibility.notQualified");
    expect(missionEligibility("L2",high.level,high.is_trusted).labelKey).toBe("app.eligibility.verifyToUnlock");
    const lowResponse=await request(`/missions/${mission.slug}/join`,fixture.creators[0],"POST",409);
    const highResponse=await request(`/missions/${mission.slug}/join`,fixture.creators[1],"POST",409);
    expect(lowResponse.code).toBe("level_locked");expect(highResponse.code).toBe("verification_required");
    const match=await request("/match",fixture.creators[1]);
    expect(match.matches.find((x:{id:string})=>x.id===mission.id).locked).toBe(true);
  });
  it("keeps draft/foreign details private, requires Auth, and reads the persisted fixture join status", async () => {
    await request(`/missions/${foreignSlug}`,fixture.creators[0],"GET",404);
    await request(`/missions/${hiddenSlug}`,fixture.creators[0],"GET",404);
    expect((await app.request("/api/missions",{headers:{"X-Workspace-Slug":fixture.slug}})).status).toBe(401);
    const list=await request("/missions");
    expect(list.missions.find((x:{id:string})=>x.id===missions[1].id).my_status).toBe("joined");
    const mine=await request("/missions/my");
    const submissionId=mine.submissions.find((x:{missions:{slug:string}})=>x.missions.slug===missions[1].slug)?.id;
    expect(submissionId).toBeTruthy();
    fixture.recordEvidence({caseId:"D09-join-status",submissionId,result:"passed"});
  });
  afterAll(async () => {
    if(!fixture)return;
    const after=await fixture.neutrality(fixture.creators[0].id);expect(after).toEqual(before);
    fixture.recordEvidence({caseId:"D09-neutrality",before,after,allEqual:true,result:"passed"});
    writeFileSync(".codex-tmp/D09-fixture.private.json",JSON.stringify({runId:fixture.runId,target:fixture.target.identity,workspaceId:fixture.workspaceId,
      slug:fixture.slug,missions,creator:fixture.creators[0],unverifiedCreator:fixture.creators[1],beforeSnapshot:after},(key,value)=>key==="client"?undefined:value));
    writeFileSync("docs/verification/D09-api-contract.json",JSON.stringify({runId:fixture.runId,target:fixture.target.identity,missionIds:missions.map(x=>x.id),
      foreignMissionId:foreignId,decisionFields,neutrality:{before,after,allEqual:true},externalProviders:"LLM enhancement mocked; external HTTP blocked; no notifications sent",cleanup:"retained exact IDs; no reset or delete"},null,2)+"\n");
  });
});
