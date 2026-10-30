/** Synthetic, in-memory UI examples. Never imported by the production entry. */
import type { AdminMission, AdminCampaign, AdminCreatorReviewRow } from "../lib/admin";
import type { AdminAcademyRow, GuideCategory } from "../lib/academy";
import type { AdminContentRow, NewsItem } from "../lib/content";
import type { Gift, Me, CreatorProfileMedia, RedemptionHistoryItem } from "../lib/queries/kocmax";
import type { NotificationRow } from "../lib/notifications";

export const previewId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const id = previewId, now = "2026-10-31T04:00:00.000Z", deadline = "2026-12-15T08:00:00.000Z";
const ok = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{"Content-Type":"application/json"}});
export const previewMe: Me = {id:id(11),display_name:"阿晴",level:"L1",level_seen:"L1",xp:800,onboarding_step:4,onboarding_completed:true,social_handles:[],social_accounts:[],categories:["food"],is_trusted:false};
export const previewMedia: CreatorProfileMedia = {avatarUrl:null,portfolioLinks:[],publicHighlights:[],published:{avatarUrl:null,highlights:[],publishedAt:null},completeness:{score:40,items:[{key:"name",label:"創作者名稱",complete:true},{key:"portfolio",label:"作品連結",complete:false}]}};
export const previewMission: AdminMission = {id:id(21),workspace_id:id(1),slug:"tea-story",title:"一杯茶的日常故事",description:"拍攝一段 30 秒短片，分享真實試飲感受。所有人物、品牌及資料均為本機示例。",category:"food",mission_type:"ugc",access_type:"open",required_level:"L0",points_reward:400,cash_reward:0,cpm_rate:null,cpm_budget_pool:null,deadline,quota:20,filled:3,status:"active",deliverables:["30 秒短片"],requirements:["真實體驗","標示合作關係"],platforms:["instagram"],effort:"low",target_audience:"香港繁中讀者",dos:["保留自己的說話方式"],donts:["不要捏造成效"],key_messages:["分享真實感受"],reference_links:[],updated_at:now,published_at:now,closed_at:null,creator_workflow_mode:"active_workspace",fulfillment_required:false,revision_limit:2,review_sla_hours:48,revision_response_hours:48,deliverable_templates:[]};
const missions: AdminMission[] = [previewMission,{...previewMission,id:id(22),slug:"weekend-walk",title:"週末散步：發現社區小店",status:"draft",access_type:"application",category:"lifestyle",points_reward:600,deliverables:["三張相片與真實介紹"],filled:0}];
const campaign: AdminCampaign = {id:id(71),workspace_id:id(1),slug:"small-stories",title:"日常小故事挑戰",description:"用真實生活完成兩個作品。自願參加，沒有連續登入要求。（示例）",status:"active",starts_at:"2026-10-01T00:00:00Z",ends_at:deadline,goal_target:2,completion_bonus_points:100,completion_bonus_xp:0,prize_tiers:[],updated_at:now};
const campaignMissions = [{mission_id:id(21),added_at:now,removed_at:null,missions:{title:previewMission.title,slug:previewMission.slug,status:"active"}}];
const gifts: Gift[] = [
  {id:id(81),name:"午後咖啡券（示例）",category:"food",points_cost:100,stock_remaining:8,gift_type:"code",status:"active"},
  {id:id(82),name:"創作靈感手帳（示例）",category:"lifestyle",points_cost:400,stock_remaining:5,gift_type:"physical",status:"active"},
  {id:id(83),name:"迷你腳架（示例）",category:"electronics",points_cost:800,stock_remaining:0,gift_type:"physical",status:"active"},
];
const redemptions: RedemptionHistoryItem[] = [];
const redemptionReceipts = new Map<string,unknown>();
let spent = 0;
export const previewSpent = () => spent;
const notifications: NotificationRow[] = [{id:id(91),type:"application_accepted",data:{mission_title:previewMission.title,mission_slug:previewMission.slug},entity_type:"submission",entity_id:id(31),read_at:null,created_at:now}];
const scores = {influence:null,reliability:null,content:null,brandSafety:null};
const academy: AdminAcademyRow = {id:id(101),kind:"track",slug:"first-story",status:"published",title_zh:"把真實體驗拍成故事",title_en:"Tell a real story",excerpt_zh:"從三個鏡頭開始。",excerpt_en:"Start with three shots.",body_zh:"## 今天的小練習\n\n先說出觀眾的問題，再呈現真實體驗。\n\n1. 拍下場景\n2. 分享自己的感受\n3. 清楚標示合作關係\n\n示例內容，不代表已完成課程或獲發積分。",body_en:"## A small exercise\n\nShow the scene, share your honest experience, and disclose any collaboration.\n\nExample content. Reading does not award points.",category:"start",required_level:"L0",emoji:"🎬",color:"lilac",sort:1,metadata:{},published_at:now,archived_at:null,created_at:now,updated_at:now};
const doc: AdminAcademyRow = {...academy,id:id(102),kind:"guide_doc",slug:"start-here",title_zh:"第一個任務怎樣開始？",title_en:"Your first mission"};
const editorial: AdminContentRow = {id:id(111),kind:"article",audience:"creator",slug:"creator-notes",status:"draft",title_zh:"創作小札：留住真實感",title_en:"Creator notes: keep it real",excerpt_zh:"一個小提醒，讓作品更有自己的聲音。",excerpt_en:"A small reminder to keep your own voice.",body_zh:"## 給今天的創作者\n\n先記下你的真實感受，再整理成作品。這是本機示例文章。",body_en:"## A note for today\n\nStart with your own experience. This is a local example article.",cover_image_url:null,category_id:null,pinned:false,pinned_rank:null,views:12,scheduled_for:null,published_at:now,updated_at:now};
const review: AdminCreatorReviewRow["review"] = {revision:0,status:"needs_review",riskLevel:"unknown",summary:null,reviewedBy:null,lastReviewedAt:null,updatedAt:null};
const social: AdminCreatorReviewRow["social"] = {platforms:[],syncStatus:null,followerCount:null,engagementRate:null,apiSyncedAt:null,label:"Not synced",ownershipLabel:"Ownership not verified"};
const creatorRow: AdminCreatorReviewRow = {id:id(11),displayName:"阿晴",avatarUrl:null,level:"L1",categories:["food"],scores,social,profileMedia:{avatarUrl:null,portfolioCount:0,publicHighlightCount:0,completenessScore:40},review,shortlist:null,lastActivityAt:now};
const notes: Array<Record<string,unknown>> = [];
const applications = [{id:id(32),creator_id:id(11),mission_id:id(22),workspace_id:id(1),status:"applied",created_at:now,creators:{display_name:"阿晴"},missions:{slug:"weekend-walk",title:missions[1].title,points_reward:600}}];
const submissions = [{...applications[0],id:id(33),status:"submitted",content_urls:["https://example.test/creator-story"],submission_data:{},submitted_at:now,evidence_revision:0,legacy_evidence_sql_valid:true}];
let passportShared = false;

export function journeyFixture(path:string,method:string,body:Record<string,unknown>,url:URL): Response | null {
  const en = url.searchParams.get("lang")==="en";
  const item = (row:AdminAcademyRow) => ({...row,title:(en?row.title_en:row.title_zh)??row.title_zh,excerpt:en?row.excerpt_en:row.excerpt_zh,body:(en?row.body_en:row.body_zh)??row.body_zh,category:row.category as GuideCategory,requiredLevel:row.required_level,meta:{duration:"5 分鐘",levelLabel:"L0"},contentStatus:"available" as const,learningEnabled:false});
  const news: NewsItem = {id:editorial.id,slug:editorial.slug,kind:editorial.kind,title:(en?editorial.title_en:editorial.title_zh)!,excerpt:en?editorial.excerpt_en:editorial.excerpt_zh,body:(en?editorial.body_en:editorial.body_zh)!,coverImageUrl:null,category:null,tags:["示例"],publishedAt:now,pinned:false,views:12};
  if(path==="/me/profile"){Object.assign(previewMe,body);return ok(previewMe);}
  if(path==="/me/level-seen")return ok(previewMe);
  if(path==="/me/passport")return ok({level:"L1",xp:800,scores,badges:[],socialTrust:{accounts:[],badges:[]}});
  if(path==="/me/profile-media")return ok(previewMedia);
  if(path.includes("/portfolio-links")){
    if(method==="POST")previewMedia.portfolioLinks.push({id:crypto.randomUUID(),creatorId:id(11),workspaceId:id(1),url:String(body.url),title:String(body.title),platformType:"website",caption:null,sortOrder:0,publicHighlight:false,createdAt:now,updatedAt:now});
    return ok({profileMedia:previewMedia,...previewMedia});
  }
  if(path==="/social/accounts")return ok({accounts:[]});
  if(path==="/me/passport/share"){passportShared=method!=="DELETE";return ok({token:"local-public-example",publicUrl:`${location.origin}/passport/local-public-example`});}
  if(path.startsWith("/public/passports/"))return passportShared||path.endsWith("local-public-example")?ok({creator:{displayName:"阿晴（公開示例）",avatarUrl:null,level:"L1",xp:800},scores,badges:[],socialTrustBadges:[],profileMedia:{highlights:[],publishedAt:null}}):ok({code:"NOT_FOUND"},404);
  if(path.startsWith("/onboarding/")){if(path.endsWith("complete")){previewMe.onboarding_completed=true;previewMe.onboarding_step=5;}else if(path.endsWith("profile")){previewMe.onboarding_step=Number(body.step??previewMe.onboarding_step);if(body.categories)previewMe.categories=body.categories as string[];}return ok({...previewMe,completion_pct:80,missions:[previewMission],referral_code:"EXAMPLE"});}
  if(path==="/match")return ok({matches:[{...previewMission,fit_score:80,reasons:["符合你選擇的飲食興趣（示例）"],rationale:"配對示例；未連接社交數據。",locked:false}]});
  if(path==="/copilot/hook-generator")return ok({source:"template",hooks:[{angle:"真實體驗",text:"這一杯，適合我的哪個日常時刻？（示例）"}]});
  if(path==="/redemption/gifts")return ok({gifts:gifts.filter(g=>!url.searchParams.get("category")||g.category===url.searchParams.get("category"))});
  if(path==="/redemption/redeem"){
    const key=String(body.client_request_id);if(redemptionReceipts.has(key))return ok(redemptionReceipts.get(key));
    const gift=gifts.find(g=>g.id===body.gift_id);if(!gift||gift.stock_remaining<=0)return ok({code:"sold_out"},409);
    gift.stock_remaining--;spent+=gift.points_cost;
    const receipt={id:crypto.randomUUID(),gift_id:gift.id,code:"LOCAL-EXAMPLE-ONLY",points_spent:gift.points_cost,status:"ready",created_at:now};redemptions.unshift({...receipt,redemption_gifts:{name:gift.name}});redemptionReceipts.set(key,receipt);return ok(receipt);
  }
  if(path==="/redemption/history")return ok({redemptions});
  if(path==="/wallet/points/history")return ok({transactions:[{id:id(121),type:"mission",delta:200,balance_after:200,description:"已核實作品獎勵（示例）",created_at:now},...redemptions.map(r=>({id:r.id,type:"redeem",delta:-r.points_spent,balance_after:200-spent,description:r.redemption_gifts?.name,created_at:now}))]});
  if(path==="/wallet/earnings")return ok({available:120,pending:80});
  if(path==="/wallet/earnings/history")return ok({transactions:[{id:id(122),type:"reward",amount:120,balance_after:120,description:"已結算稿酬（示例）",created_at:now}]});
  if(path==="/notifications")return ok({items:notifications,unread_count:notifications.filter(n=>!n.read_at).length});
  if(path==="/notifications/unread-count")return ok({count:notifications.filter(n=>!n.read_at).length});
  if(path==="/notifications/read"||path==="/notifications/read-all"){notifications.forEach(n=>{if(path.endsWith("read-all")||(body.ids as string[])?.includes(n.id))n.read_at=now;});return ok({ok:true,updated:1});}
  if(path==="/campaigns")return ok({campaigns:[campaign]});
  if(path.startsWith("/campaigns/"))return path.endsWith("leaderboard")?ok({leaderboard:[]}):ok({campaign,missions:campaignMissions,my_progress:{approved:1,goal_reached:false,bonus_granted:false,prize_rank:null,rank:null}});
  if(path==="/academy")return ok({docs:[item(doc)],tracks:[item(academy)],playbooks:[],resources:[]});
  if(path.startsWith("/academy/doc/"))return ok({item:item(doc)});
  if(path.startsWith("/academy/track/"))return ok({item:item(academy)});
  if(path==="/content"||path==="/brand/resources")return ok({items:[news],page:1,pageSize:20,total:1});
  if(path.startsWith("/content/")||path.startsWith("/brand/resources/"))return ok({item:news,related:[]});
  if(path==="/brand/me"||path==="/brand/accept")return ok({brand:{email:"brand@example.test",workspaceId:id(1),workspaceName:"茶日和 · 品牌工作區（示例）",role:"owner"}});
  const missionPath=path.match(/^\/(admin|brand)\/missions(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if(missionPath){
    const target=missions.find(m=>m.id===missionPath[2]);
    if(!missionPath[2]&&method==="GET")return ok({missions:missions.filter(m=>!url.searchParams.get("status")||m.status===url.searchParams.get("status"))});
    if(!missionPath[2]&&method==="POST"){const created={...structuredClone(previewMission),...body,id:crypto.randomUUID(),status:"draft" as const,updated_at:new Date().toISOString()};missions.push(created);return ok({mission:created});}
    if(!target)return ok({code:"NOT_FOUND"},404);
    if(missionPath[3]==="shortlist")return ok({mission:target,shortlists:[],total:0,page:1,pageSize:20});
    if(missionPath[3]==="activity")return ok({activity:{applications:0,joined:3,submitted:1,approved:0,rejected:0},engaged:true});
    if(method!=="GET"){
      if(body.expected_updated_at&&body.expected_updated_at!==target.updated_at)return ok({code:"STALE_EDIT",error:"STALE_EDIT"},409);
      Object.assign(target,body,{updated_at:new Date().toISOString()});
      if(missionPath[3]==="publish")target.status="active";if(missionPath[3]==="close")target.status="closed";
    }
    return ok({mission:target});
  }
  if(path==="/admin/applications")return ok({applications:applications.filter(a=>a.status==="applied")});
  if(path.startsWith("/admin/applications/")){applications[0].status=path.endsWith("accept")?"joined":"declined";return ok({ok:true});}
  if(path==="/admin/submissions")return ok({submissions:submissions.filter(s=>s.status===(url.searchParams.get("status")??"submitted"))});
  if(path.startsWith("/admin/submissions/")){submissions[0].status=path.endsWith("approve")?"approved":"rejected";return ok({ok:true});}
  if(path==="/admin/creators/review")return ok({creators:[creatorRow],total:1,page:1,pageSize:20});
  if(path.endsWith("/publication-proofs"))return ok({items:[],total:0,page:1,pageSize:20});
  if(path===`/admin/creators/${id(11)}`)return ok({creator:{id:id(11),workspace_id:id(1),display_name:"阿晴",avatar_url:null,level:"L1",categories:["food"],scores,social_handles:[],created_at:now},socialAccounts:[],social,profileMedia:previewMedia,review,notes,shortlists:[],audit:[],missionHistory:[]});
  if(path.endsWith("/notes")){notes.push({...body,id:crypto.randomUUID(),created_at:now});return ok({ok:true});}
  if(path.endsWith("/review")){Object.assign(review,body,{revision:(review.revision??0)+1,lastReviewedAt:now});return ok({review});}
  if(path==="/admin/engaged")return ok({creators:[{id:id(11),displayName:"阿晴",avatarUrl:null,level:"L1",xp:800,activeCount:1,completedCount:1,pointsEarned:200,lastActivityAt:now,activeMissions:[{submissionId:id(31),missionId:id(21),missionSlug:previewMission.slug,missionTitle:previewMission.title,status:"joined",joinedAt:now,submittedAt:null,reviewDeadline:deadline}]}]});
  if(path==="/admin/campaigns")return method==="GET"?ok({campaigns:[campaign]}):ok({campaign:{...campaign,...body,id:id(72),status:"draft"}});
  if(path.startsWith("/admin/campaigns/")){if(method!=="GET")Object.assign(campaign,body,{updated_at:new Date().toISOString()});return path.endsWith("leaderboard")?ok({leaderboard:[]}):ok({campaign,missions:campaignMissions,participants:3});}
  if(path==="/admin/radar")return ok({radar:{window:{days:30,from:now},atRisk:{items:[],total:0},slaBreaching:{items:[],total:0},rising:{items:[{creator_id:id(11),display_name:"阿晴",level:"L1",recent_approvals:1,avg_quality:null,score:1}],total:1},newUnactivated:{items:[],total:0}}});
  if(path==="/admin/insights"){const metric={value:1,prev:1,deltaPct:0};return ok({insights:{window:{days:30,from:"2026-10-01",to:now,timezone:"Asia/Hong_Kong"},kpis:{activeCreators:metric,submitToApprove:metric,pointsIssued:{...metric,value:200},cashPaid:{...metric,value:120},missionFillRate:metric,completions:metric},funnel:{joined:3,submitted:1,approved:1,joinToSubmit:33.3,submitToApprove:100},levels:[{level:"L1",count:3}],trend:[{bucket:"2026-10-31",joined:3,submitted:1,approved:1}]}});}
  if(path==="/admin/content-categories")return ok({categories:[]});
  if(path==="/admin/content-tags")return ok({tags:[]});
  if(path.startsWith("/admin/academy")||path.startsWith("/admin/content")){
    const isAcademy=path.startsWith("/admin/academy"),row=isAcademy?academy:editorial;
    if(path.endsWith("/lessons"))return ok({items:[]});
    if(method!=="GET"){
      if(body.updated_at&&body.updated_at!==row.updated_at)return ok({code:"STALE_EDIT",error:"STALE_EDIT"},409);
      Object.assign(row,body,{updated_at:new Date().toISOString()});
      if(path.endsWith("/publish"))row.status="published";if(path.endsWith("/archive"))row.status="archived";if(path.endsWith("/unpublish"))row.status="draft";
      return ok({item:row});
    }
    return path.split("/").length===3?ok({items:isAcademy?[academy,doc]:[editorial],page:1,pageSize:20,total:isAcademy?2:1}):ok({item:row});
  }
  return null;
}

/** These are actual router destinations, selectable without resetting fixture state. */
export const previewScreens = ["/","/creators","/brands","/packages","/stories","/playbooks","/earn","/contact","/legal/terms","/legal/privacy","/login","/auth/reset-password","/auth/callback","/brand/auth/callback","/onboarding","/home","/studio","/mission","/mission/tea-story","/my",`/my/${id(31)}`,"/campaigns","/campaigns/small-stories","/redemption","/redemption/history","/wallet","/wallet/earnings","/profile","/passport","/passport/local-public-example","/connections","/guide","/guide/doc/start-here","/guide/track/first-story","/news","/news/creator-notes","/notifications","/explore","/match","/more","/privacy","/tnc","/brand/login","/brand","/brand/missions","/brand/missions/new",`/brand/missions/${id(22)}`,"/brand/resources","/brand/resources/creator-notes","/admin","/admin/applications","/admin/submissions","/admin/active-missions",`/admin/active-missions/${id(31)}`,"/admin/reward-handoffs","/admin/missions","/admin/missions/new",`/admin/missions/${id(22)}`,"/admin/campaigns","/admin/campaigns/new",`/admin/campaigns/${id(71)}`,"/admin/creators","/admin/engaged","/admin/insights","/admin/radar","/admin/content","/admin/content/new",`/admin/content/${id(111)}`,"/admin/academy","/admin/academy/new",`/admin/academy/${id(101)}`,"/operator","/operator/creators",`/operator/creators/${id(11)}`,`/operator/missions/${id(21)}`];
