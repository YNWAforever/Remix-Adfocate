import {createPilotFixtureSession} from "./pilotFixtureSession";
/** Local UI transport fixture. Dynamically imported only in DEV with an explicit flag.
 * No provider, email, database or external fetch is allowed in this mode.
 * SQL and API acceptance are tested separately; these controls simulate server events.
 */
import { journeyFixture, previewMe, previewSpent, previewScreens } from "./studioPreviewJourneys";
import type { Session, AuthChangeEvent } from "@supabase/supabase-js";
import type { ActiveMissionWorkspace, WorkflowState, WorkItemState } from "../lib/activeMission";
import type { StudioDetail, StudioSection } from "../lib/studio/types";
import { buildSharedCaption, sourceInput, redactRevokedIntegrationOutputs } from "../lib/studio/policy";
import { createIntegrationPreview } from "./studioIntegrationPreview";
import {missionPublishFixture,missionPublishIds} from "./missionPublishPreview";
import {createPilotRoleCards} from "./controlledPilotUi";
import { ROLE_CAPABILITIES, staffRouteRequirement, type StaffWorkspaceRole } from "../../server/lib/staffCapabilities";

const localNativeFetch=window.fetch.bind(window);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now = "2026-10-31T04:00:00.000Z", deadline = "2026-12-15T08:00:00.000Z";
const ws=id(1), creator=id(11), missionId=id(21), sub=id(31), item=id(41);
type Role = "visitor" | "creator" | "same_workspace_creator" | "other_workspace_creator" | "brand" | "brand_member" | "content_editor" | "new_creator" | StaffWorkspaceRole;
const previewRoles = ["visitor","creator","same_workspace_creator","other_workspace_creator","brand","brand_member","content_editor","new_creator","workspace_admin","operator","reviewer","finance_viewer"] as const;
const pilotFixtureSession=createPilotFixtureSession(sessionStorage);
const savedRole = sessionStorage.getItem("kocmax-local-preview-role");
let role: Role = previewRoles.includes(savedRole as Role) ? savedRole as Role : "visitor";
let scenario = "normal";
// Stable, explicitly synthetic private record for reload/back ownership checks.
// This entire module is reachable only through the opt-in DEV preview entry.
const threads: StudioDetail[] = [{
  thread: { id:id(901), title:"擁有者 A 私人討論（合成示例）", initial_prompt:"本機合成資料；不是真實創作者內容。", topic:"creation", mission_id:null, conversation_id:id(902), revision:0, created_at:now },
  sources:[], briefs:[], shares:[], messages:[{id:id(903),role:"assistant",content:"【本機合成示例】這段私人討論只屬於擁有者 A，沒有分享到任務。",created_at:now}],
}, {
  thread:{id:id(910),title:"成果收藏練習（合成示例）",initial_prompt:"SAVED_OUTPUT_MOCK_ONLY",topic:"creation",mission_id:null,conversation_id:id(911),revision:4,created_at:now},
  sources:[
    {id:id(912),thread_id:id(910),title:"合成試飲觀察",content:"SAVED_OUTPUT_MOCK_ONLY：先拍茶杯，再介紹口感。",url:null,kind:"manual",shareable:true,question:"如何開始短片？",platform:"本機合成筆記",region:"HK",language:"zh-Hant",observed_at:now,revoked_at:null,status:"unverified"},
    {id:id(913),thread_id:id(910),title:"合成私人拍攝筆記",content:"SAVED_OUTPUT_MOCK_ONLY：下午窗邊拍攝。",url:null,kind:"private",shareable:false,question:"在哪裡拍攝？",platform:"本機合成筆記",region:"HK",language:"zh-Hant",observed_at:now,revoked_at:null,status:"unverified"},
  ],
  briefs:[
    {id:id(914),thread_id:id(910),version:2,created_at:"2026-11-05T04:00:00Z",sections:[{id:id(916),text:"合成新版：茶杯近鏡，再分享真實口感。",sourceIds:[id(912)]},{id:id(917),text:"合成私人構思：下午窗邊拍攝，先確認光線。",sourceIds:[id(913)]}]},
    {id:id(915),thread_id:id(910),version:1,created_at:now,sections:[{id:id(918),text:"合成舊版：先介紹今天的試飲主題。",sourceIds:[id(912)]},{id:id(919),text:"合成私人構思：選擇安靜的窗邊。",sourceIds:[id(913)]}]},
  ], shares:[],messages:[{id:id(920),role:"assistant",content:"這是成果收藏練習，所有內容都是合成示例。試試預覽舊版，再複製成私人草稿。",created_at:now}],
}], receipts = new Map<string,{fingerprint:string;result:unknown}>();
const integrationPreview = createIntegrationPreview({ workspaceId: ws, creatorId: creator }, () => threads, () => receipts.clear());
type FixtureOwner = { workspaceId:string; creatorId:string };
type StudioFixtureState = { owner:FixtureOwner; threads:StudioDetail[]; receipts:typeof receipts; integration:typeof integrationPreview; me:typeof previewMe };
const peerIdentities = {
  same_workspace_creator: { workspaceId:ws, creatorId:id(12), sessionId:id(212), displayName:"同工作區其他創作者（合成示例）" },
  other_workspace_creator: { workspaceId:id(2), creatorId:id(13), sessionId:id(213), displayName:"其他工作區創作者（合成示例）" },
};
const peerIdentity = () => role === "same_workspace_creator" || role === "other_workspace_creator" ? peerIdentities[role] : null;
const creatorRole = () => role === "creator" || role === "new_creator" || peerIdentity() !== null;
// new_creator remains the original owner's onboarding scenario, not a peer persona.
const principal = ():FixtureOwner => peerIdentity() ?? { workspaceId:ws, creatorId:role === "creator" || role === "new_creator" ? creator : id(100+["workspace_admin","operator","reviewer","finance_viewer","brand","content_editor","new_creator"].indexOf(role)) };
const ownerKey = (owner:FixtureOwner) => `${owner.workspaceId}:${owner.creatorId}`;
const ownsOriginal = () => ownerKey(principal()) === ownerKey({workspaceId:ws,creatorId:creator});
const studioStates = new Map<string,StudioFixtureState>([[ownerKey({workspaceId:ws,creatorId:creator}), {owner:{workspaceId:ws,creatorId:creator},threads,receipts,integration:integrationPreview,me:previewMe}]]);
function studioState():StudioFixtureState {
  const owner=principal(), key=ownerKey(owner), existing=studioStates.get(key);
  if(existing)return existing;
  const ownThreads:StudioDetail[]=[], ownReceipts=new Map<string,{fingerprint:string;result:unknown}>();
  // Fresh synthetic defaults: previewMe is A's mutable profile, not a template.
  const me:typeof previewMe={id:owner.creatorId,display_name:peerIdentity()?.displayName??"本機示例",xp:0,level:"L0",level_seen:"L0",onboarding_step:4,onboarding_completed:true,categories:[],social_handles:[],social_accounts:[],is_trusted:false};
  const state={owner,threads:ownThreads,receipts:ownReceipts,integration:createIntegrationPreview(owner,()=>ownThreads,()=>ownReceipts.clear()),me};
  studioStates.set(key,state);return state;
}
function foreignThread(value:unknown, conversation=false):boolean {
  for(const state of studioStates.values()) {
    if(state.threads.some(detail=>(conversation?detail.thread.conversation_id:detail.thread.id)===value))return ownerKey(state.owner)!==ownerKey(principal());
  }
  return false;
}
function peerResponse(path:string,method:string,body:Record<string,unknown>):Response|null {
  const peer=peerIdentity();if(!peer)return null;
  const me=studioState().me;
  if(path==="/me"||path==="/me/level-seen")return result(me);
  if(path==="/me/profile") {
    if(method!=="GET") {if(typeof body.display_name==="string")me.display_name=body.display_name;}
    return result(me);
  }
  if(path==="/onboarding/status")return result({onboarding_completed:true,onboarding_step:4,completion_pct:80});
  if(path==="/missions/my")return result({submissions:[]});
  if(path==="/missions")return result({missions:peer.workspaceId===ws?[{...mission,my_status:null}]:[]});
  if(path===`/missions/${mission.slug}`)return peer.workspaceId===ws?result({...mission,my_status:null}):fail("NOT_FOUND",404);
  if(path==="/wallet/points")return result({balance:0,available_to:null});
  if(path==="/wallet/points/history"||path==="/wallet/earnings/history")return result({transactions:[]});
  if(path==="/wallet/earnings")return result({available:0,pending:0});
  if(path==="/notifications")return result({items:[],unread_count:0});
  if(path==="/notifications/unread-count")return result({count:0});
  if(path==="/studio/badges")return result({badges:[]});
  if(path==="/me/integrations"&&method==="GET")return null;
  if(path==="/me/consents"||path==="/me/bootstrap")return null;
  // Journey fixtures below represent A's personal state; do not relabel it as B/C.
  if(/^\/(me|onboarding|wallet|notifications|redemption|campaigns|match|social)(\/|$)/.test(path))return fail("LOCAL_FIXTURE_NOT_IMPLEMENTED",503);
  return null;
}
const callbacks = new Set<(event:AuthChangeEvent, session:Session|null)=>void>();
const mission = { id:missionId,slug:"tea-story",title:"一杯茶的日常故事",description:"拍攝一段 30 秒短片，分享真實試飲感受。",category:"food",mission_type:"ugc",access_type:"open",points_reward:400,cash_reward:0,required_level:"L0",deliverables:["30 秒短片"],requirements:["真實體驗","標示合作關係"],platforms:["instagram"],effort:"low",brand:"茶日和（示例）",deadline,quota:20,filled:3,status:"active",my_status:"joined",creator_workflow_mode:"active_workspace" };
const workspace:ActiveMissionWorkspace = {
  workflow:{id:sub,submissionId:sub,state:"drafting",acceptedAt:now,deadline,revision:0,fulfillmentRequired:false,revisionLimit:2,reviewSlaHours:48,revisionResponseHours:48,createdAt:now,updatedAt:now},
  mission:{id:missionId,slug:mission.slug,title:mission.title,missionType:"ugc",brief:{description:mission.description,deliverables:mission.deliverables,requirements:mission.requirements,platforms:mission.platforms,effort:"low",targetAudience:"香港繁中讀者",dos:["分享真實感受"],donts:["不要捏造成效"],keyMessages:[],referenceLinks:[]}},fulfillment:null,
  workItems:[{id:item,title:"30 秒試飲短片",platform:"instagram",requirements:[{id:"disclosure",text:"已標示合作關係",required:true}],required:true,position:1,deadline,state:"drafting",draft:{id:id(42),caption:"",externalUrl:null,checklist:{},revision:0,lastSavedAt:now},currentSubmittedVersionId:null,approvedVersionId:null,reviewStartedAt:null,reviewDueAt:null,versions:[],draftAssets:[],reviewRounds:[]}],events:[],
  rewardContract:{id:id(51),pointsAmount:400,cashAmount:0,currency:"HKD",xpAmount:0,source:"join",createdAt:now},
  completionEligibility:{eligible:false,blockers:[],requiredItemCount:1,verifiedRequiredItemCount:0},pendingReward:null,nextAction:{kind:"draft",workItemId:item,deadline,blockedReason:null},
};
const session = ():Session|null => role==="visitor" ? null : {access_token:peerIdentity()?`local-fixture-only:${peerIdentity()!.sessionId}`:"local-fixture-only",refresh_token:peerIdentity()?`local-fixture-refresh:${peerIdentity()!.sessionId}`:"local-fixture-only",expires_in:3600,token_type:"bearer",user:{id:principal().creatorId,email:`${role}@example.test`,app_metadata:{},user_metadata:{},aud:"authenticated",created_at:now}};
const result = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const fail = (code:string,status=409) => result({code,error:code},status);
const currentItem = () => workspace.workItems[0];
const settled = () => workspace.pendingReward?.status==="settled";

async function studioCommand(body:Record<string,unknown>):Promise<Response> {
  const {threads,receipts,integration:integrationPreview}=studioState();
  const p=body.payload as Record<string,unknown>, action=String(body.action), request=String(body.requestId), fingerprint=JSON.stringify(body.payload)+action;
  if(foreignThread(p.threadId))return fail("STUDIO_OWNER_REQUIRED",403);
  if(action==="create_thread"&&p.missionId&&(!ownsOriginal()||p.missionId!==missionId))return fail("STUDIO_OWNER_REQUIRED",403);
  if(action==="share_brief"&&!ownsOriginal())return fail("STUDIO_OWNER_REQUIRED",403);
  const prior=receipts.get(request);if(prior)return prior.fingerprint===fingerprint?result({result:prior.result}):fail("IDEMPOTENCY_CONFLICT");
  let value:unknown;
  if(action==="create_thread") {
    const thread={id:crypto.randomUUID(),title:String(p.title),initial_prompt:String(p.initialPrompt??""),topic:p.topic as StudioDetail["thread"]["topic"],mission_id:p.missionId?String(p.missionId):null,conversation_id:crypto.randomUUID(),revision:0,created_at:now};
    threads.unshift({thread,sources:[],briefs:[],shares:[],messages:[]});value=thread;
  } else {
    const detail=threads.find(t=>t.thread.id===p.threadId);if(!detail)return fail("NOT_FOUND",404);
    if(detail.thread.revision!==p.revision)return fail("WORKFLOW_STALE");
    await integrationPreview.authorizeCommand(action, p);
    if(action==="add_source") { const source={...sourceInput(p),id:crypto.randomUUID(),thread_id:detail.thread.id,revoked_at:null};detail.sources.push(source);value=source; }
    else if(action==="revoke_source") {const source=detail.sources.find(s=>s.id===p.sourceId);if(!source)return fail("NOT_FOUND",404);if(source.integration){integrationPreview.revokeSource(source.id);source.integration.model_allowed=false;source.integration.availability="revoked";detail.messages=[];}source.revoked_at=now;source.shareable=false;value=source;}
    else if(action==="save_brief") {const brief={id:crypto.randomUUID(),thread_id:detail.thread.id,version:detail.briefs.length+1,sections:structuredClone(p.sections as StudioSection[]),created_at:now};detail.briefs.unshift(brief);value=brief;}
    else if(action==="share_brief") {
      const brief=detail.briefs[0], draft=currentItem().draft;
      if(!brief||brief.id!==p.briefId||!draft||draft.revision!==p.draftRevision)return fail("WORKFLOW_STALE");
      if(p.submissionId!==sub||p.workItemId!==item)return fail("NOT_FOUND",404);
      draft.caption=buildSharedCaption(brief.sections,detail.sources,p.sectionIds as string[]);draft.revision++;
      const receipt={id:crypto.randomUUID(),brief_id:brief.id,submission_id:sub,work_item_id:item,section_ids:p.sectionIds as string[],draft_revision:draft.revision,created_at:now};detail.shares.push(receipt);value=receipt;
    } else return fail("FIXTURE_ACTION_UNAVAILABLE",503);
    detail.thread.revision++;
  }
  receipts.set(request,{fingerprint,result:structuredClone(value)});return result({result:value});
}

async function dispatchFixture(input:RequestInfo|URL,init?:RequestInit):Promise<Response> {
  const url=new URL(input instanceof Request?input.url:String(input),location.origin), path=url.pathname.replace(/^\/api/,""), method=init?.method??(input instanceof Request ? input.method : "GET");
  if(url.origin!==location.origin || !url.pathname.startsWith("/api/"))return fail("LOCAL_PREVIEW_EXTERNAL_ACCESS_BLOCKED",503);
  const body=typeof init?.body==="string"?JSON.parse(init.body) as Record<string,unknown>:{};
  if(path==="/public/missions")return result({missions:[{slug:mission.slug,title:mission.title,points:400,level:"L0",deadline}]});
  if(path.startsWith("/workspace"))return result({id:principal().workspaceId,slug:peerIdentity()?.workspaceId===id(2)?"demo-other":"demo",name:peerIdentity()?.workspaceId===id(2)?"另一工作區（合成示例）":"KOCmax",theme:null});
  if(path.startsWith("/public/passports/"))return journeyFixture(path,method,body,url)!;
  if(role==="visitor")return fail("no_auth",401);
  if(/^\/(studio|assistant)(\/|$)/.test(path)&&!creatorRole())return fail("STUDIO_OWNER_REQUIRED",403);
  if(/^\/(my-missions|creator-growth|publish)(\/|$)/.test(path)&&!ownsOriginal())return fail("STUDIO_OWNER_REQUIRED",403);
  if(path.startsWith("/studio/threads/")&&foreignThread(path.split("/")[3]))return fail("STUDIO_OWNER_REQUIRED",403);
  const {threads,receipts,integration:integrationPreview}=studioState();
  if(path.startsWith("/admin/")) {
    if(creatorRole()||role==="brand"||role==="brand_member")return fail("NOT_STAFF",403);
    const requirement=staffRouteRequirement(method,path.slice(7));
    const capabilities=ROLE_CAPABILITIES[role as StaffWorkspaceRole]??[];
    if(requirement.kind==="deny" || (requirement.kind==="platform" && role!=="content_editor") || (requirement.kind==="workspace" && !requirement.anyOf.some(cap=>capabilities.includes(cap))))return fail("STAFF_CAPABILITY_REQUIRED",403);
  }
  if(path.startsWith("/brand/") && role!=="brand" && role!=="brand_member")return fail("NOT_BRAND",403);
  if(path==="/brand/me" && role==="brand_member") {
    const response=journeyFixture(path,method,body,url);
    if(!response)return fail("LOCAL_FIXTURE_NOT_IMPLEMENTED",503);
    const data=await response.json();
    return result({...data,brand:{...data.brand,role:"member"}});
  }
  const peerResult=peerResponse(path,method,body);if(peerResult)return peerResult;
  if(path.startsWith(`/my-missions/${id(1931)}`)){
    if(role!=="creator"||!ownsOriginal())return fail("STUDIO_OWNER_REQUIRED",403);
    if(method!=="GET")return fail("PILOT_FIXTURE_PROOF_DISABLED",403);
    const response=await fixtureFetch("/api/controlled-pilot-mock/snapshot");if(!response.ok)return response;
    const s=await response.json(),sample=await missionPublishFixture(workspace),w=sample.workspace,item=w.workItems[0];
    const p={...sample.publication,workItemId:s.workItemId,approvedVersionId:s.approvedVersionId,revision:s.instructionRevision,instructions:{...sample.publication.instructions,requiredDisclosures:s.requiredDisclosures}};
    w.workflow.id=s.submissionId;w.workflow.submissionId=s.submissionId;w.mission.title="茶日和 · 受控試點（本機 mock）";
    item.id=s.workItemId;item.approvedVersionId=s.approvedVersionId;item.currentSubmittedVersionId=s.approvedVersionId;
    item.versions![0]={...item.versions![0],id:s.approvedVersionId,caption:s.caption,contentChecksum:s.asset.sha256,assets:[{...item.versions![0].assets[0],id:s.asset.id,versionId:s.approvedVersionId,checksum:s.asset.sha256}]};
    w.nextAction.workItemId=s.workItemId;
    if(path.endsWith("/workspace"))return result(w);
    if(path.endsWith(`/publication/${s.workItemId}`))return result({publication:p});
    return fail("NOT_FOUND",404);
  }
  if(path.startsWith(`/my-missions/${missionPublishIds.submission}`)){
    if(role!=="creator"||!ownsOriginal())return fail("STUDIO_OWNER_REQUIRED",403);
    if(method!=="GET")return fail("MISSION_MOCK_WRITE_DISABLED",403);
    const sample=await missionPublishFixture(workspace);
    if(path===`/my-missions/${missionPublishIds.submission}/workspace`)return result(sample.workspace);
    if(path===`/my-missions/${missionPublishIds.submission}/publication/${missionPublishIds.item}`)return result({publication:sample.publication});
    return fail("NOT_FOUND",404);
  }
  if(path.startsWith("/me/integrations")) { if(role!=="creator"&&!peerIdentity())return fail("CREATOR_PREVIEW_REQUIRED",403); return (await integrationPreview.handle(path,method,body))??fail("NOT_FOUND",404); }
  if(path==="/me")return result({...previewMe,onboarding_completed:role!=="new_creator"||previewMe.onboarding_completed});
  if(path==="/me/consents")return result({required:{terms:"2026-01",privacy:"2026-01"},needsAcceptance:false,marketing:{granted:false,recordedAt:null}});
  if(path==="/me/bootstrap")return result({created:false});
  if(path==="/onboarding/status")return result({onboarding_completed:role!=="new_creator"||previewMe.onboarding_completed,onboarding_step:previewMe.onboarding_step,completion_pct:80});
  if(path==="/wallet/points")return result({balance:(settled()?600:200)-previewSpent(),available_to:null});



  if(path==="/missions")return result({missions:[mission]});
  if(path==="/missions/my")return result({submissions:[{id:sub,status:currentItem().currentSubmittedVersionId?"submitted":"joined",content_urls:[],points_awarded:settled()?400:0,created_at:now,creator_workflow_mode:"active_workspace",active_workflow_id:sub,missions:mission}]});
  if(path===`/missions/${mission.slug}`)return result(mission);
  if(path==="/studio/badges")return result({badges:settled()?[{id:id(90),badge_key:"first_verified_creation"}]:[]});
  if(path==="/studio/threads")return result({threads:threads.map(t=>t.thread),nextPage:null});
  if(path.startsWith("/studio/threads/")){const detail=threads.find(t=>t.thread.id===path.split("/").at(-1));return detail?result(redactRevokedIntegrationOutputs(detail)):fail("NOT_FOUND",404);}
  if(path==="/studio/commands") {try{return await studioCommand(body);}catch(error){return fail(error instanceof Error?error.message:"INVALID_INPUT",400);}}
  if(path==="/assistant/chat") {
    if(foreignThread(body.conversation_id,true))return fail("STUDIO_OWNER_REQUIRED",403);
    const detail=threads.find(t=>t.thread.conversation_id===body.conversation_id);if(!detail)return fail("NOT_FOUND",404);
    const key=String(body.client_request_id), prior=receipts.get(key);if(prior)return result(prior.result);
    let sources: Awaited<ReturnType<typeof integrationPreview.modelSources>>;
    try { sources=await integrationPreview.modelSources(detail,key); } catch { return fail("SOURCE_PERMISSION_REQUIRED",403); }
    const answer=sources.length ? `【模擬回覆 · 未驗證】問題：${String(body.message)}\n${sources.map(source=>`${source.title}：${source.content.slice(0,500)}\n來源：${source.platform} · ${source.integration?.source_version} · ${source.observed_at} · 地區／語言未驗證`).join("\n\n")}\n建議將觀察轉為真實體驗的拍攝方向；以上只是示例，不代表香港市場實測。保存後仍需逐段確認接收者與分享權。` : "【本機示例回覆】可以先拍一段真實試飲感受：開場交代問題，中段呈現份量與味道，結尾清楚標示合作關係。請先加入來源，再另開私人 Brief。社交成效未連接／未驗證；這段建議未提交任務，也未發放積分。";
    const messageTime = new Date().toISOString();
    detail.messages.push({id:crypto.randomUUID(),role:"user",content:String(body.message),created_at:messageTime},{id:crypto.randomUUID(),role:"assistant",content:answer,created_at:messageTime});
    const reply={conversation_id:detail.thread.conversation_id,answer,persistence:"saved",citations:sources.map(source=>({id:source.id,title:source.title,source:"integration_mock_unverified"})),limitations:["local_fixture"]};receipts.set(key,{fingerprint:String(body.message),result:reply});return result(reply);
  }
  if(path.startsWith("/assistant/requests/"))return result(receipts.get(path.split("/").at(-1)!)?.result??{persistence:"unknown"});
  if(path===`/my-missions/${sub}/workspace`)return result(workspace);
  if(path===`/my-missions/${sub}/work-items/${item}/draft`&&method==="PATCH") {
    const draft=currentItem().draft!;if(draft.revision!==body.revision)return fail("WORKFLOW_STALE");
    Object.assign(draft,{caption:body.caption??draft.caption,externalUrl:body.externalUrl??draft.externalUrl,checklist:body.checklist??draft.checklist,revision:draft.revision+1});return result({draft});
  }
  if(path===`/my-missions/${sub}/work-items/${item}/submit`) {
    const key=new Headers(init?.headers).get("Idempotency-Key")??"", prior=receipts.get(key);if(prior)return result(prior.result);
    const draft=currentItem().draft!, version={id:id(61),versionNumber:1,caption:draft.caption,externalUrl:draft.externalUrl,checklist:draft.checklist,contentChecksum:"fixture",submittedAt:now,state:"submitted" as const,decisionAt:null,assets:[]};
    currentItem().versions=[version];currentItem().currentSubmittedVersionId=version.id;currentItem().state="submitted";workspace.workflow.state="in_review";workspace.workflow.revision++;
    const reply={version:{id:version.id,mission_work_item_id:item,version_number:1},workItem:{id:item,state:"submitted"}};receipts.set(key,{fingerprint:JSON.stringify(body),result:reply});return result(reply);
  }
  if(path===`/my-missions/${sub}/publication/${item}`)return result({publication:{workItemId:item,platform:"instagram",state:currentItem().state,revision:workspace.workflow.revision,approvedVersionId:id(61),instructions:{publicationInstructions:"依核准版本發佈，保留合作揭露。",requiredDisclosures:["#合作"],expectedAccount:"@demo_creator",proofEvidencePolicy:{},publishDueAt:deadline,frozenAt:now},attempts:[],currentAttempt:null,acceptedAttempt:null}});
  if(path==="/admin/me")return ["visitor","creator","brand","new_creator"].includes(role)?fail("NOT_STAFF",403):result({staff:{userId:session()!.user.id,email:session()!.user.email}});
  if(path==="/admin/access")return result({access:{workspace:{id:ws,slug:"demo",role,capabilities:ROLE_CAPABILITIES[role as StaffWorkspaceRole]??[],revision:1},platformCapabilities:role==="content_editor"?["content.manage"]:[],scopeStatus:null}});
  if(path==="/admin/workspaces")return result({workspaces:[{id:ws,slug:"demo",name:"KOCmax"}]});
  if(path==="/admin/active-missions/queue")return result({items:[{workflowId:sub,workItemId:item,missionId,creatorDisplayName:"阿晴",missionTitle:mission.title,deliverableTitle:currentItem().title,state:currentItem().state==="drafting"?"under_review":currentItem().state,creatorDeadline:deadline,submittedAt:now,reviewDueAt:deadline,reviewerId:session()!.user.id,riskBucket:"on_track",platform:"instagram"}],total:1});
  if(path===`/admin/active-missions/${sub}`)return result({workflow:{id:sub,state:workspace.workflow.state==="drafting"?"in_review":workspace.workflow.state,revision:workspace.workflow.revision,revision_limit:2,revision_response_hours:48,deadline},submission:{id:sub,creators:{id:creator,display_name:"阿晴"},missions:{...mission}},workItems:[{id:item,title:currentItem().title,platform:"instagram",position:0,state:currentItem().state==="drafting"?"under_review":currentItem().state,deadline,current_reviewer_id:session()!.user.id,current_submitted_version_id:id(61),approved_version_id:currentItem().approvedVersionId,requirements_snapshot:[{id:"disclosure",category:"compliance",text:"已標示合作關係",required:true}]}],fulfillment:null,versions:[{id:id(61),mission_work_item_id:item,version_number:1,caption_snapshot:currentItem().draft?.caption||"一杯茶的真實感受 #合作（本機示例）",external_draft_url_snapshot:null,checklist_snapshot:{disclosure:true},submitted_at:now}],reviews:[],grants:[],events:[],assets:[],publicationInstructions:[],proofAttempts:[],proofReviews:[],proofAssets:[]});
  if(path===`/admin/active-missions/${sub}/completion`)return result({rewardContract:{...workspace.rewardContract,sourceMissionUpdatedAt:now,confirmedBy:null,confirmationEvidenceSource:null,confirmationReason:null},completionEligibility:workspace.completionEligibility,pendingReward:null,acceptedProofAnchors:[],processingWindowDays:7,processingTargetAt:deadline});
  if(path.startsWith(`/admin/active-missions/${sub}/work-items/`)&&method!=="GET") {
    if(path.endsWith("start-review"))currentItem().state="under_review";
    if(path.endsWith("request-revision"))currentItem().state="revision_requested";
    if(path.endsWith("approve-to-publish")){currentItem().state="approved_to_publish";currentItem().approvedVersionId=id(61);workspace.workflow.state="approved_to_publish";}
    return result({ok:true});
  }
  if(path==="/admin/reward-handoffs")return result({items:[{id:id(151),workflowId:sub,submissionId:sub,creatorId:creator,missionId,rewardContractId:id(51),completionDecisionId:id(152),cancellationDecisionId:null,reward:{pointsAmount:400,cashAmount:0,currency:"HKD",xpAmount:0},status:settled()?"settled":"pending",processingWindowDays:7,targetAt:deadline,createdAt:now,cancelledAt:null,settledAt:settled()?now:null,decision:null,creatorDisplayName:"阿晴",missionTitle:mission.title,completionDecision:{id:id(152),kind:"approved",decidedAt:now,requiredItemCount:1,verifiedRequiredItemCount:1,evidenceAvailable:true}}],rewardProcessingWindowDays:7,pageInfo:{hasMore:false,nextCursor:null,limit:25}});

  return journeyFixture(path,method,body,url) ?? fail("LOCAL_FIXTURE_NOT_IMPLEMENTED",503);
}

async function fixtureFetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response> {
  const url=new URL(input instanceof Request?input.url:String(input),location.origin);
  if(url.origin===location.origin&&url.pathname.startsWith("/api/controlled-pilot-mock/")&&["localhost","127.0.0.1","[::1]"].includes(location.hostname)){
    if(scenario==="error"||scenario==="denied")return fail("LOCAL_SESSION_UNAVAILABLE",401);
    const headers=new Headers(init?.headers);headers.set("X-Pilot-Fixture-Role",role);const capturedSession=pilotFixtureSession.current();headers.set("X-Pilot-Fixture-Session",capturedSession);
    const response=await localNativeFetch(url,{...init,headers});
    return pilotFixtureSession.isCurrent(capturedSession)?response:fail("LOCAL_SESSION_CHANGED",401);
  }
  const path=url.pathname.replace(/^\/api/, ""), method=init?.method??(input instanceof Request?input.method:"GET");
  const identity=/^\/(workspace|me$|me\/consents|me\/bootstrap|onboarding\/status|admin\/(me|access|workspaces)$|brand\/me$)/.test(path);
  if(scenario==="studio_login_required" && path.startsWith("/studio/"))return fail("LOCAL_STUDIO_LOGIN_REQUIRED",401);
  if(scenario==="source_login_required" && path.startsWith("/me/integrations"))return fail("LOCAL_SOURCE_LOGIN_REQUIRED",401);
  if(scenario==="studio_command_login_required" && (path==="/studio/commands" || path==="/assistant/chat" || path.startsWith("/assistant/requests/")))return fail("LOCAL_STUDIO_COMMAND_LOGIN_REQUIRED",401);
  if(!identity && scenario==="error")return fail("LOCAL_EXAMPLE_UNAVAILABLE",503);
  if(!identity && scenario==="denied")return fail("STAFF_CAPABILITY_REQUIRED",403);
  if(!identity && scenario==="stale" && method!=="GET")return fail(path.includes("content")||path.includes("academy")||path.includes("missions")?"STALE_EDIT":"WORKFLOW_STALE",409);
  const response=await dispatchFixture(input,init);
  if(scenario==="empty" && !identity && response.ok && method==="GET") {
    const data=await response.clone().json();
    for(const key of ["items","missions","matches","gifts","campaigns","submissions","applications","creators","transactions","redemptions","docs","tracks","playbooks","resources"]){if(Array.isArray(data[key]))data[key]=[];}
    if("total" in data)data.total=0;
    return result(data);
  }
  return response;
}

export async function installStudioPreview() {
  if(!import.meta.env.DEV || import.meta.env.VITE_STUDIO_FIXTURE!=="true")throw new Error("Preview requires explicit development mode");
  window.fetch=fixtureFetch;
  const {supabase}=await import("../lib/supabase");
  supabase.auth.getSession=async()=>{const value=session();return value?{data:{session:value},error:null}:{data:{session:null},error:null};};
  supabase.auth.refreshSession=async()=>({data:{session:session(),user:session()?.user??null},error:null});
  supabase.auth.onAuthStateChange=(cb)=>{callbacks.add(cb);queueMicrotask(()=>cb("INITIAL_SESSION",session()));return {data:{subscription:{id:"fixture",callback:cb,unsubscribe:()=>callbacks.delete(cb)}}};};
  supabase.auth.signInWithPassword=async()=>{role="creator";callbacks.forEach(cb=>cb("SIGNED_IN",session()));return {data:{session:session()!,user:session()!.user},error:null};};
  let refreshPilotCards: (()=>void)|undefined;
  supabase.auth.signOut=async()=>{pilotFixtureSession.rotate();role="visitor";sessionStorage.setItem("kocmax-local-preview-role",role);refreshPilotCards?.();callbacks.forEach(cb=>cb("SIGNED_OUT",null));return {error:null};};
  return (navigate:(path:string)=>Promise<unknown>,invalidate:()=>Promise<unknown>)=>{
    const pilotHost=document.createElement("div");pilotHost.id="controlled-pilot-fixture-cards";document.body.prepend(pilotHost);const showPilotCards=createPilotRoleCards(pilotHost);refreshPilotCards=()=>showPilotCards(role);showPilotCards(role);
    const bar=document.createElement("div");bar.id="studio-preview-controls";bar.setAttribute("aria-label","本機示例控制");
    bar.style.cssText="position:relative;z-index:100;background:#302a45;color:white;display:flex;flex-wrap:wrap;gap:8px;padding:8px 16px;font:13px system-ui;align-items:center";
    const label=document.createElement("strong");label.textContent="本機示例 · 無真實連接";bar.append(label);
    const select=document.createElement("select");select.setAttribute("aria-label","示例角色");select.style.cssText="min-height:44px;background:white;color:#302a45;border-radius:12px;padding:6px";
    for(const [value,text] of [["visitor","訪客"],["creator","創作者"],["same_workspace_creator","同工作區其他創作者"],["other_workspace_creator","其他工作區創作者"],["new_creator","新創作者"],["brand","品牌擁有者"],["brand_member","品牌成員"],["content_editor","內容編輯"],["reviewer","Reviewer"],["operator","Operator"],["workspace_admin","Admin"],["finance_viewer","Finance viewer"]]){const option=new Option(text,value);select.add(option);}
    select.value=role;
    select.onchange=async()=>{pilotFixtureSession.rotate();role=select.value as Role;showPilotCards(role);sessionStorage.setItem("kocmax-local-preview-role",role);if(role==="new_creator"){previewMe.onboarding_completed=false;previewMe.onboarding_step=0;}callbacks.forEach(cb=>cb(role==="visitor"?"SIGNED_OUT":"SIGNED_IN",session()));await invalidate();await navigate(role==="visitor"?"/":role==="creator"||peerIdentity()?"/home":role==="new_creator"?"/onboarding":role==="brand"||role==="brand_member"?"/brand":role==="content_editor"?"/admin/content":"/admin");};bar.append(select);
    const screens=document.createElement("select");screens.setAttribute("aria-label","示例畫面");screens.style.cssText=select.style.cssText+";max-width:260px";
    screens.add(new Option("前往畫面…",""));for(const path of [...previewScreens,`/my/${id(1931)}`,`/studio?thread=${id(901)}`,`/my/${missionPublishIds.submission}`])screens.add(new Option(path,path));
    screens.onchange=async()=>{delete screens.dataset.ready;if(screens.value){await navigate(screens.value);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);screens.dataset.ready=screens.value;}};bar.append(screens);
    const states=document.createElement("select");states.setAttribute("aria-label","示例資料狀態");states.style.cssText=select.style.cssText;
    for(const [value,label] of [["normal","正常示例"],["empty","空白列表"],["error","讀取失敗"],["denied","權限被拒"],["stale","版本衝突"],["studio_login_required","工作室需要登入（模擬）"],["studio_command_login_required","操作時需要登入（模擬）"],["source_login_required","來源需要登入（模擬）"]])states.add(new Option(label,value));
    states.onchange=async()=>{scenario=states.value;await invalidate();};bar.append(states);
    const phases=document.createElement("select");phases.setAttribute("aria-label","模擬伺服器事件");phases.style.cssText=select.style.cssText;
    for(const [value,text] of [["drafting","模擬伺服器事件…"],["approved_to_publish","審核：獲准發佈"],["proof_verified","審核：證明已核實"],["reward_pending","營運：等待結算"],["settled","管理員：已入帳"]])phases.add(new Option(text,value));
    phases.onchange=async()=>{
      const state=phases.value;workspace.workflow.state=(state==="settled"?"reward_pending":state) as WorkflowState;currentItem().state=["settled","reward_pending"].includes(state)?"proof_verified":state as WorkItemState;workspace.workflow.revision++;
      if(state!=="drafting")currentItem().approvedVersionId=id(61);
      if(state==="reward_pending"||state==="settled")workspace.pendingReward={id:null,status:state==="settled"?"settled":"pending",reward:{pointsAmount:400,cashAmount:0,currency:"HKD",xpAmount:0},processingWindowDays:7,targetAt:deadline,createdAt:now,cancelledAt:null,settledAt:state==="settled"?now:null,decisionState:{kind:"approved",decidedAt:now}};
      await invalidate();
    };bar.append(phases);document.body.prepend(bar);
    const previewStyle=document.createElement("style");previewStyle.textContent=".s-staff nav.fixed.inset-y-0,.s-rail{top:var(--studio-preview-inset,60px)!important}";document.head.append(previewStyle);
    new ResizeObserver(()=>document.documentElement.style.setProperty("--studio-preview-inset",`${bar.offsetHeight}px`)).observe(bar);
  };
}
