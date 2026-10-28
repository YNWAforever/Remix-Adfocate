import {test,expect,type Browser} from "@playwright/test";
import {readFileSync,writeFileSync} from "node:fs";
import {isDeepStrictEqual} from "node:util";
import process from "node:process";
// @ts-expect-error Native ESM identity verifier has no declaration file.
import {verifiedTarget} from "../scripts/audit/local-targets.mjs";
const task=process.env.ADFOCATE_BROWSER_SCOPE==="D19"?"D19":"D18";
const target=["D18","D19"].includes(process.env.ADFOCATE_BROWSER_SCOPE??"")?verifiedTarget("empty"):null;
const fx=target?JSON.parse(readFileSync(task==="D19"?".codex-tmp/D19-browser-fixture.private.json":".codex-tmp/D18-fixture.private.json","utf8")):{};
if(target&&!isDeepStrictEqual(target.identity,fx.target))throw new Error("D18 browser target drift");
test.beforeEach(()=>test.skip(!target,"Use the identity-gated D18 runner."));
const record=(name:string,data:unknown)=>writeFileSync(`docs/verification/${task}-${name}.json`,JSON.stringify({runId:fx.runId,data},null,2)+"\n");
async function context(browser:Browser,actor=fx.roles.finance_viewer,lang="en",width=390){
 const ctx=await browser.newContext({viewport:{width,height:900}});
 await ctx.addInitScript(({session,lang})=>{localStorage.setItem("lang",lang);localStorage.setItem("sb-127-auth-token",JSON.stringify(session));},{session:actor.session,lang});
 await ctx.route("**/*",route=>{const u=new URL(route.request().url());return u.hostname==="127.0.0.1"&&["56400","56421"].includes(u.port)?route.continue():route.abort();});return ctx;
}
const headers=(actor:{jwt:string})=>({Authorization:`Bearer ${actor.jwt}`,"X-Workspace-Slug":fx.slug});
test("D18 finance reloads the same saved handoff with read-only controls and scoped navigation",async({browser})=>{
 const ctx=await context(browser),page=await ctx.newPage();await page.goto("/admin/reward-handoffs");await expect(page.getByLabel("Staff role")).toContainText("Finance viewer");
 await expect(page.locator("#reward-handoff-sla-heading")).toBeVisible();await expect(page.locator("#reward-handoff-sla-heading").locator("..").getByRole("button")).toHaveCount(0);
 await page.locator('button[aria-controls="admin-mobile-nav"]').click();const nav=page.locator("#admin-mobile-nav").getByRole("navigation",{name:"Operator Console"});await expect(nav.getByRole("link",{name:"Reward handoffs",exact:true})).toBeVisible();await expect(nav.getByRole("link",{name:"Creator Review",exact:true})).toHaveCount(0);await expect(nav.getByRole("link",{name:"Academy",exact:true})).toHaveCount(0);
 const first=await page.request.get("/api/admin/reward-handoffs",{headers:headers(fx.roles.finance_viewer)});expect(first.status()).toBe(200);expect((await first.json()).items.find((r:{id:string})=>r.id===fx.core.pendingRewardId)).toMatchObject({status:"pending"});
 const denied=await page.request.put("/api/admin/reward-handoffs/settings",{headers:headers(fx.roles.finance_viewer),data:{days:14}});expect(denied.status()).toBe(403);
 await page.reload();await expect(page.getByLabel("Staff role")).toContainText("Finance viewer");
 const next=await page.request.get("/api/admin/reward-handoffs",{headers:headers(fx.roles.finance_viewer)});expect((await next.json()).items.find((r:{id:string})=>r.id===fx.core.pendingRewardId)).toMatchObject({status:"pending"});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);record("finance-ui",{pendingRewardId:fx.core.pendingRewardId,reloadSame:true,settingsWrite:403,readOnly:true,viewport:390});await ctx.close();
});
test("D18 reviewer retains authored input after a real forbidden mission save",async({browser})=>{
 const ctx=await context(browser,fx.roles.reviewer,"zh",1280),page=await ctx.newPage();await page.goto("/admin/missions/new");await expect(page.getByLabel("Staff role")).toContainText("Reviewer");await page.waitForLoadState("networkidle");
 await page.getByLabel("標題",{exact:true}).fill("D18 保留的未授權作者輸入");await page.getByLabel("任務網址代號",{exact:true}).fill(`d18-denied-${fx.runId}`);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/admin/missions"&&r.request().method()==="POST");
 await page.getByRole("button",{name:"儲存草稿",exact:true}).click();expect((await response).status()).toBe(403);await expect(page.getByLabel("標題",{exact:true})).toHaveValue("D18 保留的未授權作者輸入");
 await expect(page.getByText("請聯絡 workspace 負責人覆核已指派的角色，再重試。你的輸入已保留。",{exact:true})).toBeVisible();record("reviewer-ui",{directSaveDenied:403,inputPreserved:true});page.on("dialog",dialog=>dialog.accept());await ctx.close();
});
test("D18 platform-only content editor recovers access discovery without a workspace or another login",async({browser})=>{
 const ctx=await context(browser,fx.roles.content_editor),page=await ctx.newPage(),pattern="**/api/admin/access*";
 await page.route(pattern,route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({code:"STAFF_CAPABILITY_UNAVAILABLE",error:"Explicit access-discovery outage mock"})}));
 await page.goto("/admin/academy");await expect(page.getByRole("alert").filter({hasText:"Access unavailable"})).toBeVisible();
 await page.unroute(pattern);await page.getByRole("button",{name:/Retry access/}).click();await expect(page.getByText("Platform content / 平台內容",{exact:true})).toBeVisible();await expect(page.getByLabel("Staff role")).toContainText("Content editor");
 const item=await page.request.get(`/api/admin/academy/${fx.resource.id}`,{headers:headers(fx.roles.content_editor)});expect(item.status()).toBe(200);expect((await item.json()).item.id).toBe(fx.resource.id);
 await page.reload();await expect(page.getByText("Platform content / 平台內容",{exact:true})).toBeVisible();record("platform-ui",{scope:"platform",workspaceMembership:false,draftReadback:true,retry503Mock:true,relogin:false});await ctx.close();
});
test("D18 Creator and operator refresh agree with finance on one pending reward and history",async({browser})=>{
 const creator=fx.creators.find((c:{id:string})=>c.id===fx.core.creatorId),ids: string[]=[],projections: Record<string,unknown>[]=[];
 for(const actor of [creator,fx.roles.operator]){
  const operator=actor.id===fx.roles.operator.id,ctx=await context(browser,actor,"en",operator?1280:390),page=await ctx.newPage();
  const path=operator?`/admin/active-missions/${fx.core.workflowId}?workItemId=${fx.core.itemId}`:`/my/${fx.core.submissionId}`;
  await page.goto(path);await expect(page.getByRole("main")).toBeVisible();
  for(let i=0;i<2;i++){
   const response=await page.request.get(operator?`/api/admin/active-missions/${fx.core.workflowId}/completion`:`/api/my-missions/${fx.core.submissionId}/workspace`,{headers:headers(actor)});expect(response.status()).toBe(200);const body=await response.json();if(operator){expect(body.pendingReward.id).toBe(fx.core.pendingRewardId);ids.push(body.pendingReward.id);}else expect(body.pendingReward.id).toBeNull();
   projections.push(Object.fromEntries(["reward","status","processingWindowDays","targetAt","createdAt","cancelledAt"].map(key=>[key,body.pendingReward[key]])));
   if(!operator)expect(body.events.length).toBeGreaterThan(8);
   await page.reload();
  }
  await expect(page.getByText(/reward.*pending|pending.*reward/i).first()).toBeVisible();await ctx.close();
 }
 expect(projections).toHaveLength(4);for(const projection of projections)expect(projection).toEqual(projections[0]);
 const live=verifiedTarget("empty");expect(live.identity).toEqual(fx.target);expect(live.sql(`select count(*) from public.mission_pending_rewards where id='${fx.core.pendingRewardId}' and mission_workflow_id='${fx.core.workflowId}' and mission_submission_id='${fx.core.submissionId}';`)).toBe("1");
 record("handoff-ui",{pendingRewardId:fx.core.pendingRewardId,readbacks:projections.length,operatorReadbacks:ids.length,creatorInternalIdHidden:true,allVisibleFieldsSame:true,oneSavedWorkflowReward:true,historyRetained:true});
});
