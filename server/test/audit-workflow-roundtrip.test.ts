// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ActiveMissionWorkspace, MissionPublicationView } from "../../src/lib/activeMission";
import type { createAuditFixture } from "./auditWorkflowFixture";
// Only the external metadata provider is simulated. Auth/JWT, RLS and RPCs are real local Supabase.
vi.mock("../lib/activeMission/proofUrl.js", () => ({ inspectProofUrl: async ({url}:{url:string}) => ({ normalizedUrl:url,
  status:"unavailable", metadata:{}, errorCategory:"network" }) }));
const enabled = process.env.RUN_AUDIT_INTEGRATION === "1";
describe.skipIf(!enabled)("D07 exact-ID disposable workflow roundtrip", () => {
  let fixture: Awaited<ReturnType<typeof createAuditFixture>>;
  let owned:Awaited<ReturnType<(typeof import("./staffCapabilityFixture.js"))["createStaffCapabilityFixture"]>>|undefined;
  let core:Record<string,string>|undefined;
  let app: ReturnType<(typeof import("../app"))["createApp"]>["app"];
  beforeAll(async () => {
    if(process.env.ADFOCATE_ACCEPTANCE_TASK==="D19"){
      owned=await(await import("./staffCapabilityFixture.js")).createStaffCapabilityFixture("D19");
      fixture={...owned.base,operator:owned.roles.operator};
    }else fixture = await (await import("./auditWorkflowFixture")).createAuditFixture();
    app = (await import("../app")).createApp().app;
  }, 60000);
  async function request<T>(jwt:string,path:string,method="GET",body?:unknown,key?:string,status=200):Promise<T> {
    const response = await app.request(`/api${path}`, { method, headers:{ Authorization:`Bearer ${jwt}`,
      "X-Workspace-Slug":fixture.slug, "Content-Type":"application/json", ...(key?{"Idempotency-Key":key}:{}) },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    const result = await response.json(); expect(response.status,`${path}: ${JSON.stringify(result)}`).toBe(status); return result as T;
  }
  it("loads the real creator mission collection before and after joining",async()=>{
    const result=await request<{submissions:unknown[]}>(fixture.creators[0].jwt,"/missions/my");
    expect(result.submissions).toEqual([]);
  });
  it("pages 51 real database creators once with stable ties and a scoped total",async()=>{
    const queue=fixture.queueCreators(51);
    type QueuePage={creators:{id:string}[];total:number;page:number;pageSize:number};
    const pages:QueuePage[]=[];
    for(const page of [1,2,3])pages.push(await request(fixture.operator.jwt,`/admin/creators/review?q=${queue.prefix}&page=${page}`));
    expect(pages.map((page)=>page.creators.length)).toEqual([25,25,1]);
    expect(pages.map((page)=>page.total)).toEqual([51,51,51]);
    const seen=pages.flatMap((page)=>page.creators.map((creator)=>creator.id));
    expect(new Set(seen).size).toBe(51);expect([...seen].sort()).toEqual([...queue.ids].sort());
    const replay=await request<QueuePage>(fixture.operator.jwt,`/admin/creators/review?q=${queue.prefix}&page=2`);
    expect(replay.creators.map((creator)=>creator.id)).toEqual(pages[1].creators.map((creator)=>creator.id));
    fixture.recordEvidence({caseId:"D10-51",total:51,pageCounts:[25,25,1],stableReplay:true,result:"passed"});
  });
  it("persists race/join, receipt, revision, proof correction, one pending reward and cancellation without financial effects", async () => {
    const mission = await fixture.mission("active_workspace", true);
    const joins = await Promise.all(fixture.creators.map(async (creator) => {
      const response = await app.request(`/api/missions/${mission.slug}/join`,{ method:"POST",headers:{ Authorization:`Bearer ${creator.jwt}`,"X-Workspace-Slug":fixture.slug }});
      return {creator,response,result:await response.json()};
    }));
    expect(joins.map((join)=>join.response.status).sort()).toEqual([200,409]);
    const winner = joins.find((join)=>join.response.status===200)!;
    const submissionId = winner.result.submission.id as string;
    const creator = winner.creator;
    const read = () => request<ActiveMissionWorkspace>(creator.jwt,`/my-missions/${submissionId}/workspace`);
    let workspace = await read(); const workflowId=workspace.workflow.id; const itemId=workspace.workItems.find((item)=>item.required)!.id;
    const creatorPath=`/my-missions/${submissionId}/work-items/${itemId}`;
    const operatorPath=`/admin/active-missions/${workflowId}/work-items/${itemId}`;
    const reviewer=owned?.roles.reviewer??fixture.operator;
    const before = await fixture.neutrality(creator.id);
    expect(workspace.workflow.state).toBe("fulfillment_pending");
    await request(fixture.operator.jwt,`/admin/active-missions/${workflowId}/fulfillment/shipped`,"POST",{note:"Synthetic shipment"});
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
    await request(reviewer.jwt,`${operatorPath}/start-review`,"POST",{expectedState:item.state});
    await request(reviewer.jwt,`${operatorPath}/request-revision`,"POST",{expectedState:"under_review",versionId:item.currentSubmittedVersionId,
      deadline:new Date(Date.now()+86400000).toISOString(),items:[{category:"quality",text:"Keep the product visible",required:true}]});
    workspace=await read(); item=workspace.workItems.find((candidate)=>candidate.id===itemId)!;
    expect(item.state).toBe("revision_requested");
    await request(creator.jwt,`${creatorPath}/draft`,"PATCH",{revision:item.draft!.revision,caption:"Revised synthetic draft",checklist});
    workspace=await read(); item=workspace.workItems.find((candidate)=>candidate.id===itemId)!;
    await request(creator.jwt,`${creatorPath}/submit`,"POST",{expectedRevision:item.draft!.revision},randomUUID());
    workspace=await read(); item=workspace.workItems.find((candidate)=>candidate.id===itemId)!;
    await request(reviewer.jwt,`${operatorPath}/start-review`,"POST",{expectedState:item.state});
    await request(reviewer.jwt,`${operatorPath}/approve-to-publish`,"POST",{expectedState:"under_review",versionId:item.currentSubmittedVersionId});
    const publicationPath=`/my-missions/${submissionId}/publication/${itemId}`;
    const publication=async()=> (await request<{publication:MissionPublicationView}>(creator.jwt,publicationPath)).publication;
    let proof=await publication();
    await request(creator.jwt,`${publicationPath}/proofs`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,
      primaryUrl:`https://www.instagram.com/p/${randomUUID().replaceAll("-","")}/`,additionalUrls:[],evidenceAssetIds:[]},randomUUID());
    proof=await publication();
    await request(reviewer.jwt,`${operatorPath}/proof-review/start`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,attemptId:proof.currentAttempt!.id},randomUUID());
    proof=await publication();
    const proofChecklist={publicly_accessible:true,platform_matches:true,account_matches:true,content_matches_approved_version:true,timing_acceptable:true,disclosures_present:true};
    await request(reviewer.jwt,`${operatorPath}/proof-review/corrections`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,
      attemptId:proof.currentAttempt!.id,checklist:{...proofChecklist,content_matches_approved_version:false},corrections:[{category:"content",text:"Use approved content",position:0}]},randomUUID());
    proof=await publication(); expect(proof.state).toBe("proof_correction_requested");
    await request(creator.jwt,`${publicationPath}/proofs`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,
      primaryUrl:`https://www.instagram.com/p/${randomUUID().replaceAll("-","")}/`,additionalUrls:[],evidenceAssetIds:[]},randomUUID());
    proof=await publication();
    await request(reviewer.jwt,`${operatorPath}/proof-review/start`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,attemptId:proof.currentAttempt!.id},randomUUID());
    proof=await publication();
    await request(reviewer.jwt,`${operatorPath}/proof-review/verify`,"POST",{expectedState:proof.state,expectedRevision:proof.revision,attemptId:proof.currentAttempt!.id,checklist:proofChecklist},randomUUID());
    workspace=await read(); expect(workspace.workflow.state).toBe("proof_verified");
    // Creator projection deliberately hides the private contract. Only the operator can complete.
    const review=await request<{completionEligibility:{eligible:boolean;blockers:string[]}}>(fixture.operator.jwt,`/admin/active-missions/${workflowId}/completion`);
    expect(review.completionEligibility,JSON.stringify(review.completionEligibility)).toMatchObject({eligible:true,blockers:[]});
    expect(workspace.workItems.find((candidate)=>!candidate.required)!.state).toBe("drafting");
    const completionBody={expectedState:"proof_verified",expectedRevision:workspace.workflow.revision}, completionKey=randomUUID();
    const completion=await request<{pendingReward:{id:string};decision:{id:string}}>(fixture.operator.jwt,`/admin/active-missions/${workflowId}/completion`,"POST",completionBody,completionKey);
    const replay=await request<typeof completion>(fixture.operator.jwt,`/admin/active-missions/${workflowId}/completion`,"POST",completionBody,completionKey);
    expect(replay.pendingReward.id).toBe(completion.pendingReward.id);
    workspace=await read(); expect(workspace.workflow.state).toBe("reward_pending"); expect(workspace.pendingReward?.status).toBe("pending");
    const operatorReload=await request<{pendingReward:{id:string}}>(fixture.operator.jwt,`/admin/active-missions/${workflowId}/completion`);
    expect(operatorReload.pendingReward.id).toBe(completion.pendingReward.id);
    const pendingSnapshot=await fixture.neutrality(creator.id); expect(pendingSnapshot).toEqual(before);
    const cancellation=await request(fixture.operator.jwt,`/admin/active-missions/${workflowId}/reward-handoff/cancel`,"POST",{
      expectedState:"reward_pending",expectedRevision:workspace.workflow.revision,reasonCategory:"other",reasonNote:"Synthetic cancellation acceptance"},randomUUID());
    workspace=await read(); expect(workspace.pendingReward?.status).toBe("cancelled");
    const after=await fixture.neutrality(creator.id); expect(after).toEqual(before);
    expect(workspace.events.length).toBeGreaterThan(8);
    core={submissionId,workflowId,itemId,creatorId:creator.id,cancelledPendingRewardId:completion.pendingReward.id};owned?.saveCore(core);
    fixture.recordEvidence({caseId:"D07-active",submissionId,workflowId,decisionId:completion.decision.id,pendingRewardId:completion.pendingReward.id,
      beforeSnapshot:before,pendingSnapshot,afterSnapshot:after,historyEvents:workspace.events.length,cancellation,
      metadataProvider:"mock-unavailable",auth:"real-local-Supabase",result:"passed"});
  },90000);
  it("rejects real signed-in staff without membership and cross-workspace requests",async()=>{
    await request(fixture.noMembership.jwt,"/admin/workspaces","GET",undefined,undefined,403);
    const response=await app.request(`/api/admin/workspaces?workspace=${fixture.otherWorkspaceId}`,{headers:{Authorization:`Bearer ${fixture.operator.jwt}`}});
    expect(response.status).toBe(404);
  });
  it("rolls back a real audit fault and serializes concurrent CRM retries",async()=>{
    const creatorId=fixture.creators[0].id,requestId=randomUUID();
    const functionName=`audit_fault_${fixture.runId.replaceAll("-","")}`;
    const counts=()=>JSON.parse(fixture.target.sql(`select jsonb_build_object(
      'reviews',(select count(*) from public.creator_review_statuses where creator_id='${creatorId}'),
      'notes',(select count(*) from public.creator_review_notes where creator_id='${creatorId}'),
      'receipts',(select count(*) from public.operator_crm_command_receipts where request_id='${requestId}'),
      'audit',(select count(*) from public.operator_audit_events where creator_id='${creatorId}'));`));
    const before=counts(),body={status:"approved",risk_level:"low",note:"Synthetic transactional review",request_id:requestId,expected_revision:0};
    fixture.target.sql(`create function public.${functionName}() returns trigger language plpgsql as $$begin if new.creator_id='${creatorId}'::uuid then raise exception 'synthetic_audit_failure'; end if; return new; end;$$;
      create trigger ${functionName} before insert on public.operator_audit_events for each row execute function public.${functionName}();`);
    try { await request(fixture.operator.jwt,`/admin/creators/${creatorId}/review`,"POST",body,undefined,500);expect(counts()).toEqual(before); }
    finally {fixture.target.sql(`drop trigger ${functionName} on public.operator_audit_events;drop function public.${functionName}();`);}
    const responses=await Promise.all([0,1].map(()=>request<{review:{revision:number}}>(fixture.operator.jwt,`/admin/creators/${creatorId}/review`,"POST",body)));
    expect(responses[0]).toEqual(responses[1]);expect(responses[0].review.revision).toBe(1);
    // Existing contract emits one review event and one note event, each exactly once.
    expect(counts()).toEqual({reviews:before.reviews+1,notes:before.notes+1,receipts:1,audit:before.audit+2});
    await request(fixture.operator.jwt,`/admin/creators/${creatorId}/review`,"POST",{...body,request_id:randomUUID()},undefined,409);
    await request(fixture.operator.jwt,`/admin/creators/${creatorId}/review`,"POST",{...body,note:"Changed retry"},undefined,409);
    fixture.recordEvidence({caseId:"D06-transaction",requestId,countsBefore:before,countsAfter:counts(),auditFaultRollback:true,concurrentSameKeyReplay:true,result:"passed"});
  },30000);
  it("blocks an unknown historical reward contract and preserves the single-workspace membership key",async()=>{
    const mission=await fixture.mission("active_workspace",false),creator=fixture.creators[0];
    const submission=fixture.must(await fixture.service.from("mission_submissions").insert({workspace_id:fixture.workspaceId,mission_id:mission.id,creator_id:creator.id,status:"joined"}).select("id").single());
    const recovered=fixture.must(await creator.client.rpc("create_mission_workflow",{p_submission:submission!.id}));
    const review=await request<{completionEligibility:{blockers:string[]};rewardContract:null}>(fixture.operator.jwt,`/admin/active-missions/${recovered.id}/completion`);
    expect(review.rewardContract).toBeNull();expect(review.completionEligibility.blockers).toContain("reward_contract_required");
    const duplicate=await fixture.service.from("brand_users").insert({user_id:fixture.operator.id,workspace_id:fixture.otherWorkspaceId,email:"synthetic@example.test",active:true,role:"member"});
    expect(duplicate.error?.code).toBe("23505");
    fixture.recordEvidence({caseId:"D07-historical-contract",submissionId:submission!.id,workflowId:recovered.id,result:"passed",contractInvented:false});
  },30000);
  it("persists one assistant turn with real service grants and rejects Creator provider claims",async()=>{
    const creator=fixture.creators[1],requestId=randomUUID();
    const args={p_workspace:fixture.workspaceId,p_creator:creator.id,p_request:requestId};
    const browserClaim=await creator.client.rpc("claim_assistant_request",args);expect(browserClaim.error?.code).toBe("42501");
    fixture.must(await fixture.service.rpc("reserve_assistant_request",{...args,p_message:"Synthetic AI request",p_locale:"en",p_conversation:null,p_context_version:"r1"}));
    fixture.must(await fixture.service.rpc("claim_assistant_request",args));
    const saved=fixture.must(await fixture.service.rpc("save_assistant_turn",{...args,p_answer:"Synthetic answer; no provider called",p_citations:[]}));
    const replay=fixture.must(await fixture.service.rpc("save_assistant_turn",{...args,p_answer:"Synthetic answer; no provider called",p_citations:[]}));expect(replay).toEqual(saved);
    const own=await creator.client.rpc("get_assistant_request",{p_workspace:fixture.workspaceId,p_request:requestId});expect(own.error).toBeNull();expect(own.data.persistence).toBe("saved");
    const stranger=await fixture.creators[0].client.rpc("get_assistant_request",{p_workspace:fixture.workspaceId,p_request:requestId});expect(stranger.data).toBeNull();
    fixture.recordEvidence({caseId:"D16-saved-turn",requestId,result:"passed",provider:"not-called; synthetic answer",replaySameResult:true});
  },30000);
  it("retains the legacy join/submit/review journey with evidence validation",async()=>{
    if(fixture.historical){
      const historical=fixture.historical;
      const before=fixture.target.sql(`begin read only;select to_jsonb(s) from public.mission_submissions s where id='${historical.submissionId}';commit;`);
      const financialBefore=await Promise.all(fixture.creators.map(c=>fixture.neutrality(c.id)));
      const rejected=await request<{code:string}>((owned?.roles.reviewer??fixture.operator).jwt,`/admin/submissions/${historical.submissionId}/approve`,"POST",{},undefined,400);
      expect(rejected.code).toBe("invalid_evidence");
      expect(fixture.target.sql(`begin read only;select to_jsonb(s) from public.mission_submissions s where id='${historical.submissionId}';commit;`)).toBe(before);
      expect(await Promise.all(fixture.creators.map(c=>fixture.neutrality(c.id)))).toEqual(financialBefore);
      fixture.recordEvidence({caseId:"B2-historical-invalid-legacy",submissionId:historical.submissionId,ordinaryApprovalRejected:400,storedRowUnchanged:true,financialStateUnchanged:true,source:"owned pre-guard bootstrap checkpoint; never an original incident before image",result:"passed"});
    }
    const creator=fixture.creators[0],mission=await fixture.mission("legacy");
    const joined=await request<{id:string}>(creator.jwt,`/missions/${mission.slug}/join`,"POST");
    await request(creator.jwt,`/missions/${mission.slug}/submit`,"PUT",{content_urls:["invalid"]},undefined,400);
    await request(creator.jwt,`/missions/${mission.slug}/submit`,"PUT",{content_urls:["https://example.test/synthetic-proof"]});
    await request((owned?.roles.reviewer??fixture.operator).jwt,`/admin/submissions/${joined.id}/approve`,"POST",{});
    const row=fixture.must(await fixture.service.from("mission_submissions").select("id,status,reviewed_at").eq("id",joined.id).single());
    expect(row!.status).toBe("approved"); expect(row!.reviewed_at).toBeTruthy();
    owned?.saveLegacy({submissionId:joined.id,missionId:mission.id,missionSlug:mission.slug,creatorId:creator.id});
    fixture.recordEvidence({caseId:"D07-legacy",submissionId:joined.id,result:"passed",auth:"real-local-Supabase",financialMeaning:"existing legacy reward behavior; separate from neutral pending handoff"});
  },30000);
  if(process.env.ADFOCATE_ACCEPTANCE_TASK==="D19")it("D19 reapproval preserves an issued legacy anchor and reloads one neutral pending reward through finance",async()=>{
    expect(owned).toBeDefined();expect(core).toBeDefined();const c=core!;
    const creator=fixture.creators.find(x=>x.id===c.creatorId)!;
    const legacy=()=>JSON.parse(fixture.target.sql(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'pointsAwarded',points_awarded,'xpAwarded',xp_awarded) order by id),'[]'::jsonb) from public.mission_submissions where workspace_id='${fixture.workspaceId}' and status='approved';`));
    const before=await Promise.all(fixture.creators.map(x=>fixture.neutrality(x.id))),anchors=legacy();expect(anchors.length).toBeGreaterThan(0);
    expect(before[0].budget).toBeGreaterThan(0);expect(before[0].rewardInventory).toHaveLength(1);
    const workspace=await request<ActiveMissionWorkspace>(creator.jwt,`/my-missions/${c.submissionId}/workspace`);expect(workspace.workflow.state).toBe("proof_verified");
    const body={expectedState:"proof_verified",expectedRevision:workspace.workflow.revision},key=randomUUID();
    const path=`/admin/active-missions/${c.workflowId}/completion`;
    const first=await request<{pendingReward:{id:string}}>(fixture.operator.jwt,path,"POST",body,key),replay=await request<typeof first>(fixture.operator.jwt,path,"POST",body,key);expect(replay.pendingReward.id).toBe(first.pendingReward.id);expect((replay as {idempotent?:boolean}).idempotent).toBe(true);
    const finance=await request<{items:{id:string;status:string}[]}>(owned!.roles.finance_viewer.jwt,"/admin/reward-handoffs");expect(finance.items.find(x=>x.id===first.pendingReward.id)).toMatchObject({status:"pending"});
    const after=await Promise.all(fixture.creators.map(x=>fixture.neutrality(x.id)));expect(after).toEqual(before);expect(legacy()).toEqual(anchors);
    expect(fixture.target.sql(`select count(*) from public.mission_pending_rewards where mission_workflow_id='${c.workflowId}' and status='pending';`)).toBe("1");
    owned!.saveCore({...c,pendingRewardId:first.pendingReward.id});
    fixture.recordEvidence({caseId:"D19-reapproval",beforeSnapshot:before,afterSnapshot:after,legacyBefore:anchors,legacyAfter:legacy(),pendingRewardId:first.pendingReward.id,historyRetained:true,result:"passed"});
  },60000);
});
