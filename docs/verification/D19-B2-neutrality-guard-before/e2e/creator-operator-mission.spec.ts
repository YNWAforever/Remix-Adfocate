// @ts-expect-error Native local evidence helper.
import {FixtureJournal,bindBrowserJournal} from "../scripts/audit/fixture-journal.mjs";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import process from "node:process";
import type { ActiveMissionWorkspace, MissionPublicationView } from "../src/lib/activeMission";
// @ts-expect-error Identity helper is native ESM.
import {verifiedTarget as verifyBrowserTarget} from "../scripts/audit/local-targets.mjs";
const pilot=process.env.ADFOCATE_BROWSER_SCOPE==="D19";
const verified=pilot?verifyBrowserTarget():null;
const selected=verified?.context;
const fixture=selected?selected.readPrivate("browser-fixture.private.json"):JSON.parse(readFileSync(pilot?".codex-tmp/D19-browser-fixture.private.json":".codex-tmp/browser-fixture.private.json","utf8"));
if(pilot)expect(fixture.target).toEqual(verified.identity);
const evidencePrefix = pilot?"D19-":process.env.ADFOCATE_BROWSER_SCOPE === "D08" ? "D08-" : "";
test("real roles reload one durable pending reward and its revision/proof history",async({browser,request})=>{
  const creatorContext=await browser.newContext(evidencePrefix ? {viewport:{width:360,height:800}} : {});let operatorContext=await browser.newContext();
  for(const context of [creatorContext,operatorContext]){
    await context.addInitScript(()=>localStorage.setItem("lang","en"));
    if(selected)await bindBrowserJournal(context,new FixtureJournal(selected.privatePath(`transport-browser-${process.pid}-${context===creatorContext?"creator":"reviewer"}.jsonl`),selected.lineage,{requests:selected.manifest.fixture.transportWriteCapPerProcess}),selected.origins);
    else await context.route("**/*",route=>{
      const url=new URL(route.request().url());
      return (selected?.origins??["http://127.0.0.1:56400","http://127.0.0.1:56421"]).includes(url.origin)?route.continue():route.abort();
    });
  }
  const creator=await creatorContext.newPage();let operator=await operatorContext.newPage();
  // Reuse the already authenticated operator session from setup; JWT is verified by the real Auth service.
  await operatorContext.addInitScript(session=>localStorage.setItem("sb-127-auth-token",JSON.stringify(session)),pilot?fixture.reviewerSession:fixture.operatorSession);
  async function login(page:Page,actor:{email:string;password:string}){
    await page.goto("/login"); await page.locator('input[type="email"]').first().fill(actor.email);
    await page.locator('input[type="password"]') .fill(actor.password);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    await expect(page).not.toHaveURL(/\/login$/);
  }
  async function api<T>(jwt:string,path:string):Promise<T>{
    const response=await request.get(`/api${path}`,{headers:{Authorization:`Bearer ${jwt}`,"X-Workspace-Slug":fixture.slug}});
    expect(response.status(),`${path}: ${await response.text()}`).toBe(200); return response.json();
  }
  await login(creator,fixture.creator);
  if(selected){await creator.goto("/my");await expect(creator.getByText("You haven't joined any missions yet.",{exact:true})).toBeVisible();}
  if(pilot){
    await creator.goto(`/mission/${fixture.legacyMission.slug}`);
    const joined=creator.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/join")&&r.request().method()==="POST");
    await creator.getByRole("button",{name:"Join Mission",exact:true}).click();const join=await joined;expect(join.status()).toBe(200);const legacy=await join.json();
    await creator.locator("textarea").fill("invalid");await creator.getByRole("button",{name:"Submit Content",exact:true}).click();await expect(creator.getByRole("alert")).toContainText("HTTP(S)");await expect(creator.locator("textarea")).toHaveValue("invalid");
    await creator.locator("textarea").fill(`https://example.test/d19-${fixture.runId}`);
    const submitted=creator.waitForResponse(r=>new URL(r.url()).pathname.endsWith("/submit")&&r.request().method()==="PUT");await creator.getByRole("button",{name:"Submit Content",exact:true}).click();expect((await submitted).status()).toBe(200);
    await operator.goto("/admin/submissions");const approved=operator.waitForResponse(r=>new URL(r.url()).pathname===`/api/admin/submissions/${legacy.id}/approve`&&r.request().method()==="POST");await operator.getByRole("button",{name:"Approve",exact:true}).click();expect((await approved).status()).toBe(200);
    await creator.reload();expect(verified.sql(`select status from public.mission_submissions where id='${legacy.id}';`)).toBe("approved");
    fixture.legacy={submissionId:legacy.id,creatorId:fixture.creator.id,missionId:fixture.legacyMission.id};
    writeFileSync(selected?.publicPath("browser-legacy.json")??"docs/verification/D19-browser-legacy.json",JSON.stringify({...(selected?{lineage:selected.lineage}:{}),runId:fixture.runId,...fixture.legacy,ui:"Creator login/join/invalid-input retention/submit → reviewer approve → Creator reload",result:"passed",financialMeaning:"Existing legacy issuance measured before active pending baseline; no new payment feature"},null,2)+"\n");
  }
  await creator.goto(`/mission/${fixture.mission.slug}`);
  const joined=creator.waitForResponse(response=>response.url().endsWith("/join")&&response.request().method()==="POST");
  await creator.getByRole("button",{name:"Join Mission",exact:true}).click();
  const joinResponse=await joined; expect(joinResponse.status()).toBe(200); const join=await joinResponse.json();
  const submissionId=join.submission.id;
  const read=()=>api<ActiveMissionWorkspace>(fixture.creator.jwt,`/my-missions/${submissionId}/workspace`);
  const workspace=await read(); const workflowId=workspace.workflow.id,itemId=workspace.workItems.find(item=>item.required)!.id;
  const workspaceUrl=`/my/${submissionId}?item=${itemId}`;
  const homeChecks: Array<{state:string;action:string;clicks:number;revision:number}> = [];
  async function checkHome(label: string, item = true) {
    if (evidencePrefix!=="D08-") return;
    const before = await read();
    await creator.goto("/home");
    await creator.reload();
    const action = creator.getByRole("link", {name:label,exact:true});
    await expect(action).toHaveAttribute("href", item ? workspaceUrl : `/my/${submissionId}`);
    expect(await creator.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const actionBox = (await action.boundingBox())!;
    expect(actionBox.width).toBeGreaterThanOrEqual(44);
    expect(actionBox.height).toBeGreaterThanOrEqual(44);
    await creator.screenshot({path:`docs/verification/D08-home-${before.workflow.state}.png`});
    if (!item) await expect(action.locator("xpath=..")).toContainText("Pending reward is not payment and is not available to withdraw.");
    await action.click();
    await expect(creator).toHaveURL(item ? new RegExp(`/my/${submissionId}\\?item=${itemId}$`) : new RegExp(`/my/${submissionId}$`));
    const after = await read();
    expect(after.workflow).toEqual(before.workflow);
    expect(after.workItems).toEqual(before.workItems);
    expect(after.pendingReward).toEqual(before.pendingReward);
    expect(after.events).toEqual(before.events);
    homeChecks.push({state:after.workflow.state,action:label,clicks:1,revision:after.workflow.revision});
  }
  await creator.goto(workspaceUrl);
  if(selected){
    const draftPath=`/api/my-missions/${submissionId}/work-items/${itemId}/draft`,pattern=`**${draftPath}`;
    // Explicit browser transport mock: no target write occurs for the failed attempt.
    await creator.route(pattern,route=>route.abort("failed"));
    await creator.getByRole("textbox",{name:"Caption or copy",exact:true}).fill("Browser retained after network failure");
    await expect(creator.getByRole("button",{name:"Retry save",exact:true})).toBeVisible();
    await expect(creator.getByRole("textbox",{name:"Caption or copy",exact:true})).toHaveValue("Browser retained after network failure");
    await creator.unroute(pattern);await creator.getByRole("button",{name:"Retry save",exact:true}).click();
    await expect.poll(async()=>(await read()).workItems.find(i=>i.id===itemId)!.draft?.caption).toBe("Browser retained after network failure");
    const saved=(await read()).workItems.find(i=>i.id===itemId)!.draft!;
    const concurrent=await request.patch(draftPath,{headers:{Authorization:`Bearer ${fixture.creator.jwt}`,"X-Workspace-Slug":fixture.slug},data:{revision:saved.revision,caption:"Concurrent server draft",externalUrl:saved.externalUrl,checklist:saved.checklist}});expect(concurrent.status()).toBe(200);
    const stale=creator.waitForResponse(r=>new URL(r.url()).pathname===draftPath&&r.request().method()==="PATCH"&&r.status()===409);
    await creator.getByRole("textbox",{name:"Caption or copy",exact:true}).fill("Browser retained after real 409");await stale;
    await expect(creator.getByText("Concurrent server draft",{exact:true})).toBeVisible();
    await expect(creator.getByRole("textbox",{name:"Caption or copy",exact:true})).toHaveValue("Browser retained after real 409");
    await creator.getByRole("button",{name:"Save retained draft against latest revision",exact:true}).click();
    await expect.poll(async()=>(await read()).workItems.find(i=>i.id===itemId)!.draft?.caption).toBe("Browser retained after real 409");
    writeFileSync(selected.publicPath("browser-recovery.json"),JSON.stringify({lineage:selected.lineage,submissionId,itemId,emptyBeforeJoin:true,networkFailure:"explicit transport mock",stale409:"real concurrent database revision",inputRetained:true,explicitRetry:true,newSubjectsOrWorkflows:0},null,2)+"\n");
  }
  await creator.getByRole("textbox",{name:"Caption or copy",exact:true}).fill("Browser original draft");
  await creator.getByRole("checkbox").first().check();
  await expect.poll(async()=> (await read()).workItems.find(item=>item.id===itemId)!.draft?.caption).toBe("Browser original draft");
  await creator.reload(); await expect(creator.getByRole("textbox",{name:"Caption or copy",exact:true})).toHaveValue("Browser original draft");
  await creator.getByRole("button",{name:"Submit version",exact:true}).click();
  await expect.poll(async()=> (await read()).workItems.find(item=>item.id===itemId)!.state).toBe("submitted");
  await checkHome("View submitted version");
  const operatorUrl=`/admin/active-missions/${workflowId}?ws=${fixture.workspaceId}&workItemId=${itemId}`;
  const itemState=async()=> (await read()).workItems.find(item=>item.id===itemId)!.state;
  await operator.goto(operatorUrl);
  await operator.getByRole("button",{name:"Start review",exact:true}).click();
  await expect.poll(itemState).toBe("under_review");
  await operator.getByRole("button",{name:"Request revision",exact:true}).click();
  await operator.getByLabel("Revision deadline",{exact:true}).fill("");
  await operator.getByRole("textbox",{name:"Required change 1",exact:true}).fill("Browser revision required");
  await operator.getByRole("button",{name:"Send revision request",exact:true}).click();
  await expect.poll(itemState).toBe("revision_requested");
  await checkHome("Revise draft");
  await creator.reload(); await expect(creator.getByText("Browser revision required").first()).toBeVisible();
  await creator.getByRole("textbox",{name:"Caption or copy",exact:true}).fill("Browser revised draft");
  await creator.getByRole("button",{name:"Submit version",exact:true}).click();
  await expect.poll(async()=> (await read()).workItems.find(item=>item.id===itemId)!.state).toBe("submitted");
  await operator.reload();
  await operator.getByRole("button",{name:"Start review",exact:true}).click();
  await expect.poll(itemState).toBe("under_review");
  await operator.getByRole("button",{name:"Approve version",exact:true}).click();
  await operator.getByRole("alertdialog").getByRole("button",{name:"Confirm approval",exact:true}).click();
  await expect.poll(itemState).toBe("approved_to_publish");
  const publication=async()=> (await api<{publication:MissionPublicationView}>(fixture.creator.jwt,`/my-missions/${submissionId}/publication/${itemId}`)).publication;
  async function submitProof(){
    await creator.reload();await creator.getByRole("textbox",{name:"Primary public URL",exact:true}).fill(`https://www.instagram.com/p/${randomUUID().replaceAll("-","")}/`);
    await creator.getByRole("checkbox",{name:/I confirm this is the published content/}).check();
    await creator.getByRole("button",{name:"Publish and submit proof",exact:true}).click();
    await expect.poll(async()=>(await publication()).state).toBe("proof_submitted");
  }
  const checklistLabels=["Publicly accessible","Platform matches","Account matches","Content matches approved version","Timing acceptable","Disclosures present"];
  await submitProof();
  await operator.reload();
  await operator.getByRole("button",{name:"Claim review",exact:true}).click();
  await expect.poll(async()=>(await publication()).state).toBe("proof_under_review");
  for(const label of checklistLabels.filter(label=>label!=="Content matches approved version"))await operator.getByRole("checkbox",{name:label,exact:true}).check();
  await operator.getByRole("button",{name:"Add correction",exact:true}).click();
  await operator.getByRole("combobox",{name:"Correction category 1",exact:true}).selectOption("content");
  await operator.getByRole("textbox",{name:"Correction 1",exact:true}).fill("Browser proof correction");
  await operator.getByRole("button",{name:"Send correction request",exact:true}).click();
  await expect.poll(async()=>(await publication()).state).toBe("proof_correction_requested");
  await submitProof();
  await operator.reload();
  await operator.getByRole("button",{name:"Claim review",exact:true}).click();
  await expect.poll(async()=>(await publication()).state).toBe("proof_under_review");
  for(const label of checklistLabels)await operator.getByRole("checkbox",{name:label,exact:true}).check();
  await operator.getByRole("button",{name:"Verify proof",exact:true}).click();
  await operator.getByRole("alertdialog").getByRole("textbox",{name:"Type attempt number 2 to confirm",exact:true}).fill("2");
  await operator.getByRole("alertdialog").getByRole("button",{name:"Confirm verification",exact:true}).click();
  await expect.poll(async()=>(await publication()).state).toBe("proof_verified");
  // @ts-expect-error Native ESM test utility has no declaration file.
  const {verifiedTarget}=await import("../scripts/audit/local-targets.mjs");
  // @ts-expect-error Native ESM test utility has no declaration file.
  const {neutralitySnapshot}=await import("../scripts/audit/neutrality-snapshot.mjs");
  const target=verifiedTarget();
  expect(target.sql(`select state from public.mission_workflows where id='${workflowId}';`)).toBe("proof_verified");
  writeFileSync(selected?.publicPath("browser-before-handoff.json")??`docs/verification/${evidencePrefix}browser-before-handoff.json`,JSON.stringify({...(selected?{lineage:selected.lineage}:{}),runId:fixture.runId,phase:"immediately-before-completion",snapshot:neutralitySnapshot(target,fixture.creator.id,fixture.workspaceId)},null,2)+"\n");
  if(pilot){
    const anchors=verified.sql(`select jsonb_agg(jsonb_build_object('id',id,'status',status,'pointsAwarded',points_awarded,'xpAwarded',xp_awarded) order by id) from public.mission_submissions where workspace_id='${fixture.workspaceId}' and status='approved';`);
    const before=JSON.parse(readFileSync(selected?.publicPath("browser-before-handoff.json")??"docs/verification/D19-browser-before-handoff.json","utf8"));before.legacyAnchors=JSON.parse(anchors);writeFileSync(selected?.publicPath("browser-before-handoff.json")??"docs/verification/D19-browser-before-handoff.json",JSON.stringify(before,null,2)+"\n");
    await operatorContext.close();operatorContext=await browser.newContext();await operatorContext.addInitScript(session=>{localStorage.setItem("lang","en");localStorage.setItem("sb-127-auth-token",JSON.stringify(session));},fixture.operatorSession);
    if(selected)await bindBrowserJournal(operatorContext,new FixtureJournal(selected.privatePath(`transport-browser-${process.pid}-operator.jsonl`),selected.lineage,{requests:selected.manifest.fixture.transportWriteCapPerProcess}),selected.origins);
    else await operatorContext.route("**/*",route=>{const u=new URL(route.request().url());return (selected?.origins??["http://127.0.0.1:56400","http://127.0.0.1:56421"]).includes(u.origin)?route.continue():route.abort();});operator=await operatorContext.newPage();
  }
  await operator.bringToFront();
  // Reconcile the operator page with the persisted proof before opening completion.
  // Proof verification invalidates several projections; do not click during their replacement.
  await operator.goto(operatorUrl);
  await expect(operator).toHaveURL(/\/admin\/active-missions\//);
  await operator.getByRole("button",{name:"Approve completion",exact:true}).click();
  await expect(operator.getByRole("alertdialog")).toBeVisible();
  await operator.screenshot({path:selected?.privatePath("operator-before-completion.png")??".codex-tmp/operator-before-completion.png"});
  await operator.getByRole("alertdialog").getByRole("button",{name:"Confirm approval",exact:true}).click();
  await expect.poll(async()=>(await read()).pendingReward?.status).toBe("pending");
  const completion=await api<{pendingReward:{id:string;reward:unknown}}>(fixture.operator.jwt,`/admin/active-missions/${workflowId}/completion`);
  await creator.reload(); await expect(creator.getByRole("heading",{name:"Mission complete — reward under finance review",exact:true})).toBeVisible();
  await operator.reload(); await expect(operator.getByText("Reward handoff pending",{exact:true}).first()).toBeVisible();
  const creatorReload=await read(); const operatorReload=await api<typeof completion>(fixture.operator.jwt,`/admin/active-missions/${workflowId}/completion`);
  expect(operatorReload.pendingReward.id).toBe(completion.pendingReward.id);
  expect(creatorReload.pendingReward!.reward).toEqual(operatorReload.pendingReward.reward);
  expect(creatorReload.events.length).toBeGreaterThan(8);
  await checkHome("View reward review", false);
  if(evidencePrefix==="D08-") writeFileSync("docs/verification/D08-home-roundtrip.json",JSON.stringify({...(selected?{lineage:selected.lineage}:{}),runId:fixture.runId,submissionId,workflowId,homeChecks,creatorViewport:{width:360,height:800},minimumPrimaryTarget44px:true,noHomeHorizontalOverflow:true,persistedAfterNavigationAndReload:true},null,2)+"\n");
  writeFileSync(selected?.publicPath("browser-roundtrip.json")??`docs/verification/${evidencePrefix}browser-roundtrip.json`,JSON.stringify({...(selected?{lineage:selected.lineage}:{}),runId:fixture.runId,submissionId,workflowId,pendingRewardId:completion.pendingReward.id,
    creatorReward:creatorReload.pendingReward!.reward,operatorReward:operatorReload.pendingReward.reward,historyEvents:creatorReload.events.length,
    persistedAfterReload:true,creatorPrivateIdRedacted:creatorReload.pendingReward!.id===null,reviewTransitions:pilot?"reviewer UI; read-only API assertions":"operator UI; read-only API assertions",completion:"operator UI",proofMetadata:"external HTTP blocked"},null,2)+"\n");
  if(pilot){fixture.core={creatorId:fixture.creator.id,submissionId,workflowId,itemId,pendingRewardId:completion.pendingReward.id};writeFileSync(selected?.privatePath("browser-fixture.private.json")??".codex-tmp/D19-browser-fixture.private.json",JSON.stringify(fixture));}
  await creatorContext.close();await operatorContext.close();
});
