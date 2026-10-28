import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { dict } from "../src/lib/i18n.dict";

const fixture=JSON.parse(readFileSync(".codex-tmp/D09-fixture.private.json","utf8"));
test("D09 real decision DTO, filters, retry and qualification stay consistent across list and detail",async({browser,request})=>{
  test.skip(process.env.ADFOCATE_BROWSER_SCOPE!=="D09","Use the identity-guarded D09 discovery runner.");
  const context=await browser.newContext({viewport:{width:360,height:800}});
  let failList=true,detailRequests=0;
  await context.addInitScript(()=>localStorage.setItem("lang","en"));
  await context.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=="127.0.0.1")return route.abort();
    if(fixture.missions.some((mission:{slug:string})=>url.pathname===`/api/missions/${mission.slug}`))detailRequests++;
    if(failList&&url.pathname==="/api/missions")return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({code:"db_error",error:"Synthetic read outage"})});
    return route.continue();
  });
  async function login(page:Page,actor:{email:string;password:string}){
    await page.goto("/login");await page.locator('input[type="email"]').first().fill(actor.email);
    await page.locator('input[type="password"]').fill(actor.password);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading",{name:/Welcome back/})).toBeVisible();
  }
  const creator=await context.newPage();await login(creator,fixture.creator);
  // @ts-expect-error Native ESM local utility has no declaration file.
  const {verifiedTarget}=await import("../scripts/audit/local-targets.mjs");
  // @ts-expect-error Native ESM local utility has no declaration file.
  const {neutralitySnapshot}=await import("../scripts/audit/neutrality-snapshot.mjs");
  const target=verifiedTarget("empty");
  const before={runId:fixture.runId,snapshot:neutralitySnapshot(target,fixture.creator.id,fixture.workspaceId)};
  await creator.getByRole("navigation",{name:dict.en["common.mainNav"],exact:true}).getByRole("link",{name:"Find missions",exact:true}).click();
  await expect(creator).toHaveURL(/\/mission$/);
  await expect(creator.getByRole("alert")).toContainText(dict.en["app.mission.loadFailed"]);
  await creator.getByRole("button",{name:dict.en["app.category.travel"],exact:true}).click();
  failList=false;
  const listResponse=creator.waitForResponse(response=>new URL(response.url()).pathname==="/api/missions"&&response.status()===200);
  await creator.getByRole("button",{name:"重試 / Retry",exact:true}).click();
  const list=(await (await listResponse).json()).missions as Array<Record<string,unknown>>;
  await expect(creator.getByRole("button",{name:dict.en["app.category.travel"],exact:true})).toHaveAttribute("aria-pressed","true");
  for(const index of [1,2])await expect(creator.locator(`a[href="/mission/${fixture.missions[index].slug}"]`)).toBeVisible();
  await expect(creator.locator(`a[href="/mission/${fixture.missions[0].slug}"]`)).toHaveCount(0);
  const zero=creator.locator(`a[href="/mission/${fixture.missions[1].slug}"]`);
  const unknown=creator.locator(`a[href="/mission/${fixture.missions[2].slug}"]`);
  await expect(zero).toContainText("HK$0.00");
  await expect(unknown.getByText("Cash reward",{exact:true}).locator("..")).toContainText("Not provided");
  await expect(unknown).not.toContainText("HK$0.00");
  expect(detailRequests).toBe(0);
  await unknown.click();
  const unknownCashFact=creator.locator("p").filter({hasText:"Cash reward: Not provided"});
  await expect(unknownCashFact).toBeVisible();
  await creator.screenshot({path:"docs/verification/D09-unknown-cash-detail-360.png"});
  expect(await unknownCashFact.evaluate(element=>element.scrollHeight<=element.clientHeight+1)).toBe(true);
  await creator.goBack();
  await creator.getByRole("button",{name:"原有未知長中文分類",exact:true}).click();
  await expect(creator.locator(`a[href="/mission/${fixture.missions[3].slug}"]`)).toBeVisible();
  await creator.getByRole("button",{name:dict.en["app.category.pet"],exact:true}).click();
  const pet=creator.locator(`a[href="/mission/${fixture.missions[0].slug}"]`);
  await expect(pet).toContainText("Instagram, TikTok");
  await expect(pet).toContainText("一條附有清晰披露的中文短片");
  await expect(pet).toContainText("Needs L2 · you're L0");
  expect(await creator.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await creator.screenshot({path:"docs/verification/D09-discovery-360.png"});
  const detailResponse=creator.waitForResponse(response=>new URL(response.url()).pathname===`/api/missions/${fixture.missions[0].slug}`);
  await pet.click();const detail=await (await detailResponse).json();
  const row=list.find(mission=>mission.id===fixture.missions[0].id)!;
  for(const key of ["cash_reward","required_level","platforms","deliverables","effort","brand","deadline","quota","filled"])expect(row[key],key).toEqual(detail[key]);
  await expect(creator.getByText("Needs L2 · you're L0",{exact:true})).toBeVisible();
  const rejected=creator.waitForResponse(response=>response.url().endsWith("/join")&&response.request().method()==="POST");
  await creator.getByRole("button",{name:"Join Mission",exact:true}).click();
  expect((await rejected).status()).toBe(409);
  await expect(creator.getByRole("alert")).toContainText(dict.en["app.mission.errorLevelLocked"]);
  await creator.reload();await expect(creator.getByText("Needs L2 · you're L0",{exact:true})).toBeVisible();
  const own=await request.get("/api/missions/my",{headers:{Authorization:`Bearer ${fixture.creator.jwt}`,"X-Workspace-Slug":fixture.slug}});
  expect((await own.json()).submissions.some((submission:{missions:{slug:string}})=>submission.missions.slug===fixture.missions[0].slug)).toBe(false);
  const highContext=await browser.newContext({viewport:{width:1280,height:900}});
  await highContext.addInitScript(()=>localStorage.setItem("lang","en"));
  await highContext.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():route.abort());
  const high=await highContext.newPage();await login(high,fixture.unverifiedCreator);
  await high.getByRole("navigation",{name:dict.en["common.mainNav"],exact:true}).getByRole("link",{name:dict.en["app.nav.mission"],exact:true}).click();
  await expect(high).toHaveURL(/\/mission$/);
  const highPet=high.locator(`a[href="/mission/${fixture.missions[0].slug}"]`);
  await expect(highPet).toContainText("Verify a social handle to unlock L2 missions");
  await highPet.click();await expect(high.getByText("Verify a social handle to unlock L2 missions",{exact:true})).toBeVisible();
  await high.goto("/match");
  await expect(high.locator(`a[href="/mission/${fixture.missions[0].slug}"]`)).toContainText("驗證社交帳號");
  await high.screenshot({path:"docs/verification/D09-unverified-desktop.png"});
  writeFileSync("docs/verification/D09-browser-before.json",JSON.stringify(before,null,2)+"\n");
  writeFileSync("docs/verification/D09-browser-roundtrip.json",JSON.stringify({runId:fixture.runId,missionIds:fixture.missions.map((m:{id:string})=>m.id),
    realSerializedListAndDetailEqual:true,cashZeroAndNullDistinct:true,petTravelAndUnknownFilter:true,noDetailRequestBeforeCardOpen:true,
    retry503PreservedFilter:true,lowXpJoinDeniedAndReloaded:true,unverifiedL3StillLocked:true,viewports:[360,1280],
    noHorizontalOverflowAt360:true,unknownCashDetailFullyReadable:true,publication:"not performed",paidProviders:"disabled"},null,2)+"\n");
  await highContext.close();await context.close();
});
