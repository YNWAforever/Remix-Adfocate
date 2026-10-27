// @vitest-environment node
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import type { createStaffCapabilityFixture } from "./staffCapabilityFixture";
import type { ActiveMissionWorkspace, MissionPublicationView } from "../../src/lib/activeMission";
vi.mock("../lib/activeMission/proofUrl.js",()=>({inspectProofUrl:async({url}:{url:string})=>({normalizedUrl:url,status:"unavailable",metadata:{},errorCategory:"network"})}));
const task=process.env.ADFOCATE_ACCEPTANCE_TASK==="D19"?"D19":"D18";
describe.skipIf(process.env.RUN_AUDIT_INTEGRATION!=="1")(`${task} exact-owned staff roles/API/RLS`,()=>{
 let owned:Awaited<ReturnType<typeof createStaffCapabilityFixture>>,fixture:Awaited<ReturnType<typeof createStaffCapabilityFixture>>["base"],roles:Awaited<ReturnType<typeof createStaffCapabilityFixture>>["roles"];
 let app:ReturnType<(typeof import("../app"))["createApp"]>["app"],initialBefore:unknown,afterJoin:unknown,joinBaseline:unknown;
 const results:{path:string;method:string;status:number}[]=[];
 beforeAll(async()=>{owned=await (await import("./staffCapabilityFixture")).createStaffCapabilityFixture(task);fixture=owned.base;roles=owned.roles;app=(await import("../app")).createApp().app;initialBefore=await Promise.all(fixture.creators.map(c=>fixture.neutrality(c.id)));},90000);
 async function request<T=Record<string,unknown>>(jwt:string,path:string,method="GET",body?:unknown,key?:string,status=200):Promise<T>{
  const r=await app.request(`/api${path}`,{method,headers:{Authorization:`Bearer ${jwt}`,"X-Workspace-Slug":fixture.slug,"Content-Type":"application/json",...(key?{"Idempotency-Key":key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await r.json();results.push({path:path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,":id"),method,status:r.status});expect(r.status,`${method} ${path}: ${JSON.stringify(value)}`).toBe(status);return value as T;
 }
 afterAll(async()=>{
  if(!fixture)return;const after=await Promise.all(fixture.creators.map(c=>fixture.neutrality(c.id)));const expected=afterJoin??initialBefore;
  owned.save("api-finished");writeFileSync(fixture.target.context?.publicPath("api-contract.json")??`docs/verification/${task}-api-contract.json`,JSON.stringify({...(fixture.target.context?{lineage:fixture.target.context.lineage}:{}),runId:fixture.runId,target:fixture.target.identity,results,roles:Object.fromEntries(Object.entries(roles).map(([name,actor])=>[name,{id:actor.id}])),neutrality:{initialBefore,joinBaseline,before:expected,after,allEqual:JSON.stringify(expected)===JSON.stringify(after)},provider:"proof metadata mocked unavailable; no real messages/payments/paid AI",scope:"Only new exact-owned fixture staff/memberships/roles changed; no production data or automatic migration grants"},null,2)+"\n");expect(after).toEqual(expected);
 });
 it("requires a separate staff grant despite brand owner membership and preserves no-membership scope errors",async()=>{
  const access=await request<{access:{workspace:{role:null}}}>(roles.noRole.jwt,"/admin/access");expect(access.access.workspace.role).toBeNull();
  await request(roles.noRole.jwt,"/admin/creators/review","GET",undefined,undefined,403);
  const missing=await request<{code:string}>(fixture.noMembership.jwt,"/admin/creators/review","GET",undefined,undefined,403);expect(missing.code).toBe("WORKSPACE_MEMBERSHIP_REQUIRED");
  await request(fixture.creators[0].jwt,"/admin/reward-handoffs","GET",undefined,undefined,403);
  const cross=await app.request(`/api/admin/reward-handoffs?workspace=${fixture.otherWorkspaceId}`,{headers:{Authorization:`Bearer ${roles.admin.jwt}`}});expect(cross.status).toBe(404);
 });
 it("keeps finance handoff-only, reviewer review-only and operator unable to manage grants/settings",async()=>{
  await request(roles.finance_viewer.jwt,"/admin/reward-handoffs");
  for(const name of ["finance_viewer","operator","reviewer"])await request(roles[name].jwt,"/admin/reward-handoffs/settings","PUT",{days:7},undefined,403);
  await request(roles.admin.jwt,"/admin/reward-handoffs/settings","PUT",{days:7});
  for(const name of ["finance_viewer","reviewer"])await request(roles[name].jwt,`/admin/creators/${fixture.creators[0].id}/notes`,"POST",{note:"Not authorized",request_id:randomUUID(),expected_revision:0},undefined,403);
  await request(roles.reviewer.jwt,"/admin/active-missions/queue");
  for(const name of ["finance_viewer","operator","reviewer"])await request(roles[name].jwt,"/admin/missions","POST",{workspace_id:fixture.workspaceId,slug:`denied-${randomUUID()}`,title:"Denied owned mission",mission_type:"ugc"},undefined,403);
  await request(roles.operator.jwt,`/admin/creators/${fixture.creators[0].id}/review`,"POST",{status:"approved",risk_level:"low",request_id:randomUUID(),expected_revision:0,note:"Owned role acceptance"});
 });
 it("denies direct browser role writes/RPC/self-elevation even with forged user metadata",async()=>{
  const actor=roles.finance_viewer;fixture.must(await actor.client.auth.updateUser({data:{role:"workspace_admin",capabilities:["access.manage"]}}));
  await request(actor.jwt,"/admin/staff-access","GET",undefined,undefined,403);
  const write=await actor.client.from("staff_workspace_roles").update({role:"workspace_admin"}).eq("user_id",actor.id);expect(write.error?.code).toBe("42501");
  const insert=await actor.client.from("staff_platform_roles").insert({user_id:actor.id,role:"content_editor",granted_by:actor.id});expect(insert.error?.code).toBe("42501");
  const rpc=await actor.client.rpc("set_staff_workspace_role",{p_workspace:fixture.workspaceId,p_actor:roles.admin.id,p_subject:actor.id,p_role:"workspace_admin",p_active:true,p_expected_revision:1,p_request:randomUUID(),p_reason:"Forbidden browser grant"});expect(rpc.error?.code).toBe("42501");
 });
 it("persists a normal grant once with exact replay, audit attribution, stale/conflict denial and no self/cross-workspace grant",async()=>{
  const requestId=randomUUID(),body={role:"operator",active:true,expectedRevision:0,requestId,reason:"Explicit owned acceptance grant",actorId:roles.foreign.id};
  const path=`/admin/staff-access/${roles.noRole.id}`;
  for(const name of ["operator","reviewer","finance_viewer"])await request(roles[name].jwt,path,"PUT",body,undefined,403);
  const saved=await Promise.all([0,1,2].map(()=>request<{grant:{revision:number}}>(roles.admin.jwt,path,"PUT",body)));expect(saved[0]).toEqual(saved[1]);expect(saved[0]).toEqual(saved[2]);expect(saved[0].grant.revision).toBe(1);
  const audit=fixture.must(await fixture.service.from("staff_access_audit").select("actor_id,user_id").eq("request_id",requestId));expect(audit).toEqual([{actor_id:roles.admin.id,user_id:roles.noRole.id}]);
  await request(roles.admin.jwt,path,"PUT",{...body,role:"reviewer"},undefined,409);await request(roles.admin.jwt,path,"PUT",{...body,requestId:randomUUID()},undefined,409);
  await request(roles.admin.jwt,`/admin/staff-access/${roles.admin.id}`,"PUT",body,undefined,403);
  await request(roles.admin.jwt,`/admin/staff-access/${roles.foreign.id}`,"PUT",{...body,requestId:randomUUID()},undefined,404);
  const list=await request<{grants:{user_id:string;role:string;revision:number}[]}>(roles.admin.jwt,"/admin/staff-access");expect(list.grants.find(g=>g.user_id===roles.noRole.id)).toMatchObject({role:"operator",revision:1});
 });
 it("revokes active staff, membership or role immediately using the same signed-in session",async()=>{
  const actor=roles.revocable;
  for(const table of ["staff_users","brand_users"]){
   fixture.must(await fixture.service.from(table).update({active:false}).eq("user_id",actor.id));
   try{await request(actor.jwt,"/admin/creators/review","GET",undefined,undefined,403);}finally{fixture.must(await fixture.service.from(table).update({active:true}).eq("user_id",actor.id));}
  }
  const path=`/admin/staff-access/${actor.id}`,body={role:"operator",active:false,expectedRevision:1,requestId:randomUUID(),reason:"Owned live role revocation"};
  await request(roles.admin.jwt,path,"PUT",body);await request(actor.jwt,"/admin/creators/review","GET",undefined,undefined,403);
  await request(roles.admin.jwt,path,"PUT",{...body,active:true,expectedRevision:2,requestId:randomUUID(),reason:"Owned fixture role restored"});await request(actor.jwt,"/admin/creators/review");
 });
 it("requires platform content editor for global drafts without inventing course content",async()=>{
  const editor=roles.content_editor,body={kind:"resource",slug:`${task.toLowerCase()}-resource-${fixture.runId}`,title_zh:"合成角色資源",title_en:"Owned role resource",excerpt_zh:"角色權限測試",body_zh:"Synthetic draft body for role acceptance. No course lessons or content approval."};
  const created=await request<{item:{id:string}}>(editor.jwt,"/admin/academy","POST",body,undefined,201);
  owned.saveResource({id:created.item.id,slug:body.slug});
  await request(editor.jwt,`/admin/academy/${created.item.id}`);await request(roles.admin.jwt,`/admin/academy/${created.item.id}`,"GET",undefined,undefined,403);await request(roles.operator.jwt,"/admin/content","GET",undefined,undefined,403);
  const raw=await fixture.creators[0].client.from("academy_content").select("id").eq("id",created.item.id);expect(raw.error).toBeNull();expect(raw.data).toEqual([]);
  const access=await request<{access:{workspace:null;platformCapabilities:string[]}}>(editor.jwt,"/admin/access");expect(access.access).toMatchObject({workspace:null,platformCapabilities:["content.manage"]});
 });
 it("preserves brand_users user_id primary key and owner-only bootstrap ACL",async()=>{
  const duplicate=await fixture.service.from("brand_users").insert({user_id:roles.operator.id,workspace_id:fixture.otherWorkspaceId,email:"owned@example.invalid",role:"member",active:true});expect(duplicate.error?.code).toBe("23505");
  expect(fixture.target.sql("select has_function_privilege('service_role','private.bootstrap_staff_access(uuid,uuid,uuid,text,boolean,integer,uuid,text,text)','execute');")).toBe("f");
 });
 // The following role handoff extends the existing D07 journey; the business engine is unchanged.
  it("hands work through Creator, reviewer, operator and finance with one durable pending reward and neutral balances", async () => {
    const mission = await fixture.mission("active_workspace", true);
    const joinBefore=await Promise.all(fixture.creators.map(c=>fixture.neutrality(c.id)));expect(joinBefore).toEqual(initialBefore);
    const joins = await Promise.all(fixture.creators.map(async (creator) => {
      const response = await app.request(`/api/missions/${mission.slug}/join`,{ method:"POST",headers:{ Authorization:`Bearer ${creator.jwt}`,"X-Workspace-Slug":fixture.slug }});
      return {creator,response,result:await response.json()};
    }));
    expect(joins.map((join)=>join.response.status).sort()).toEqual([200,409]);
    const winner = joins.find((join)=>join.response.status===200)!;
    const submissionId = winner.result.submission.id as string;
    const creator = winner.creator;
    afterJoin=await Promise.all(fixture.creators.map(c=>fixture.neutrality(c.id)));
    expect(afterJoin).toEqual(joinBefore.map((row,i)=>({...row,xp:row.xp+(fixture.creators[i].id===creator.id?10:0)})));
    joinBaseline={before:joinBefore,after:afterJoin,creatorId:creator.id,existingJoinXpDelta:10,contract:"D18-existing-join-contract.json"};
    const read = () => request<ActiveMissionWorkspace>(creator.jwt,`/my-missions/${submissionId}/workspace`);
    let workspace = await read(); const workflowId=workspace.workflow.id; const itemId=workspace.workItems.find((item)=>item.required)!.id;
    const creatorPath=`/my-missions/${submissionId}/work-items/${itemId}`;
    const operatorPath=`/admin/active-missions/${workflowId}/work-items/${itemId}`;
    const before = await fixture.neutrality(creator.id);
    expect(workspace.workflow.state).toBe("fulfillment_pending");
    await request(roles.operator.jwt,`/admin/active-missions/${workflowId}/fulfillment/shipped`,"POST",{note:"Synthetic shipment"});
    await request(creator.jwt,`/my-missions/${submissionId}/fulfillment/received`,"POST");
    workspace=await read(); let item=workspace.workItems.find((candidate)=>candidate.id===itemId)!;
    const checklist=Object.fromEntries(item.requirements.map((requirement)=>[String(requirement.id),true]));
    await request(creator.jwt,`${creatorPath}/draft`,"PATCH",{revision:item.draft!.revision,caption:"First synthetic draft",checklist});
    workspace=await read(); item=workspace.workItems.find((candidate)=>candidate.id===itemId)!;
    expect(item.draft?.caption).toBe("First synthetic draft");
    await request(creator.jwt,`${creatorPath}/draft`,"PATCH",{revision:item.draft!.revision-1,caption:"Stale overwrite"},undefined,409);
    const submitKey=randomUUID(); const submitBody={expectedRevision:item.draft!.revision};
    await request(creator.jwt,`${creatorPath}/submit`,"POST",submitBody,submitKey);
    await request(creator.jwt,`${creatorPath}/submit`,"POST",submitBody,submitKey);
    workspace=await read(); item=workspace.workItems.find((candidate)=>candidate.id===itemId)!;
    await request(roles.reviewer.jwt,`${operatorPath}/start-review`,"POST",{expectedState:item.state});
    await request(roles.reviewer.jwt,`${operatorPath}/request-revision`,"POST",{expectedState:"under_review",versionId:item.currentSubmittedVersionId,
      deadline:new Date(Date.now()+86400000).toISOString(),items:[{category:"quality",text:"Keep the product visible",required:true}]});
    workspace=await read(); item=workspace.workItems.find((candidate)=>candidate.id===itemId)!;
    expect(item.state).toBe("revision_requested");
    await request(creator.jwt,`${creatorPath}/draft`,"PATCH",{revision:item.draft!.revision,caption:"Revised synthetic draft",checklist});
    workspace=await read(); item=workspace.workItems.find((candidate)=>candidate.id===itemId)!;
    await request(creator.jwt,`${creatorPath}/submit`,"POST",{expectedRevision:item.draft!.revision},randomUUID());
    workspace=await read(); item=workspace.workItems.find((candidate)=>candidate.id===itemId)!;
    await request(roles.reviewer.jwt,`${operatorPath}/start-review`,"POST",{expectedState:item.state});
    await request(roles.reviewer.jwt,`${operatorPath}/approve-to-publish`,"POST",{expectedState:"under_review",versionId:item.currentSubmittedVersionId});
    const publicationPath=`/my-missions/${submissionId}/publication/${itemId}`;
    const publication=async()=> (await request<{publication:MissionPublicationView}>(creator.jwt,publicationPath)).publication;
    let proof=await publication();
    await request(creator.jwt,`${publicationPath}/proofs`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,
      primaryUrl:`https://www.instagram.com/p/${randomUUID().replaceAll("-","")}/`,additionalUrls:[],evidenceAssetIds:[]},randomUUID());
    proof=await publication();
    await request(roles.reviewer.jwt,`${operatorPath}/proof-review/start`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,attemptId:proof.currentAttempt!.id},randomUUID());
    proof=await publication();
    const proofChecklist={publicly_accessible:true,platform_matches:true,account_matches:true,content_matches_approved_version:true,timing_acceptable:true,disclosures_present:true};
    await request(roles.reviewer.jwt,`${operatorPath}/proof-review/corrections`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,
      attemptId:proof.currentAttempt!.id,checklist:{...proofChecklist,content_matches_approved_version:false},corrections:[{category:"content",text:"Use approved content",position:0}]},randomUUID());
    proof=await publication(); expect(proof.state).toBe("proof_correction_requested");
    await request(creator.jwt,`${publicationPath}/proofs`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,
      primaryUrl:`https://www.instagram.com/p/${randomUUID().replaceAll("-","")}/`,additionalUrls:[],evidenceAssetIds:[]},randomUUID());
    proof=await publication();
    await request(roles.reviewer.jwt,`${operatorPath}/proof-review/start`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,attemptId:proof.currentAttempt!.id},randomUUID());
    proof=await publication();
    await request(roles.reviewer.jwt,`${operatorPath}/proof-review/verify`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,attemptId:proof.currentAttempt!.id,checklist:proofChecklist},randomUUID());
    workspace=await read(); expect(workspace.workflow.state).toBe("proof_verified");
    // Creator projection deliberately hides the private contract. Only the operator can complete.
    const review=await request<{completionEligibility:{eligible:boolean;blockers:string[]}}>(roles.operator.jwt,`/admin/active-missions/${workflowId}/completion`);
    expect(review.completionEligibility,JSON.stringify(review.completionEligibility)).toMatchObject({eligible:true,blockers:[]});
    expect(workspace.workItems.find((candidate)=>!candidate.required)!.state).toBe("drafting");
    const completionBody={expectedState:"proof_verified",expectedRevision:workspace.workflow.revision}, completionKey=randomUUID();
    const completion=await request<{pendingReward:{id:string};decision:{id:string}}>(roles.operator.jwt,`/admin/active-missions/${workflowId}/completion`,"POST",completionBody,completionKey);
    const replay=await request<typeof completion>(roles.operator.jwt,`/admin/active-missions/${workflowId}/completion`,"POST",completionBody,completionKey);
    expect(replay.pendingReward.id).toBe(completion.pendingReward.id);
    workspace=await read(); expect(workspace.workflow.state).toBe("reward_pending"); expect(workspace.pendingReward?.status).toBe("pending");
    const operatorReload=await request<{pendingReward:{id:string}}>(roles.operator.jwt,`/admin/active-missions/${workflowId}/completion`);
    expect(operatorReload.pendingReward.id).toBe(completion.pendingReward.id);
    const pendingSnapshot=await fixture.neutrality(creator.id); expect(pendingSnapshot).toEqual(before);
    const financeReload=await request<{items:{id:string;status:string}[]}>(roles.finance_viewer.jwt,"/admin/reward-handoffs");
    expect(financeReload.items.find(r=>r.id===completion.pendingReward.id)).toMatchObject({status:"pending"});
    await request(roles.finance_viewer.jwt,`/admin/active-missions/${workflowId}/reward-handoff/cancel`,"POST",{expectedState:"reward_pending",expectedRevision:workspace.workflow.revision,reasonCategory:"other",reasonNote:"Must be denied"},randomUUID(),403);
    const after=await fixture.neutrality(creator.id);expect(after).toEqual(before);expect(workspace.events.length).toBeGreaterThan(8);
    owned.saveCore({workflowId,submissionId,itemId,pendingRewardId:completion.pendingReward.id,creatorId:creator.id});
    fixture.recordEvidence({caseId:"D18-role-handoff",submissionId,workflowId,pendingRewardId:completion.pendingReward.id,historyEvents:workspace.events.length,beforeSnapshot:before,afterSnapshot:after,reviewer:roles.reviewer.id,operator:roles.operator.id,finance:roles.finance_viewer.id,metadataProvider:"explicit mock unavailable",result:"passed"});
  },90000);

});
