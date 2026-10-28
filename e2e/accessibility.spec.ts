import { expect,test,type Browser,type Page } from "@playwright/test";
import {readFileSync,writeFileSync} from "node:fs";
import process from "node:process";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const fx=process.env.ADFOCATE_BROWSER_SCOPE==="D17"?JSON.parse(readFileSync(".codex-tmp/D17-fixture.private.json","utf8")):{};
test.beforeEach(()=>test.skip(process.env.ADFOCATE_BROWSER_SCOPE!=="D17","Use the identity-gated D17 runner."));
const record=(name:string,data:unknown)=>writeFileSync(`docs/verification/D17-${name}.json`,JSON.stringify({runId:fx.runId,data},null,2)+"\n");
async function context(browser:Browser,operator=false,width=390,zoom=false){
 const ctx=await browser.newContext({viewport:{width:zoom?width/2:width,height:zoom?450:900},deviceScaleFactor:zoom?2:1});
 await ctx.addInitScript(session=>{localStorage.setItem("lang","en");localStorage.setItem("sb-127-auth-token",JSON.stringify(session));},(operator?fx.operator:fx.creator).session);
 await ctx.route("**/*",route=>{const u=new URL(route.request().url());return u.hostname==="127.0.0.1"&&["56400","56421"].includes(u.port)?route.continue():route.abort();});
 return ctx;
}
async function settled(page:Page){await expect(page.locator("main")).toBeVisible();await expect(page.locator("main").getByRole("heading").first()).toBeVisible();await page.waitForLoadState("networkidle");}

test("D17 core Creator and operator pages reflow at 360/390/768 and 200 percent desktop reflow",async({browser})=>{
 const cells=[];
 for(const width of [360,390,768])for(const operator of [false,true]){
  const ctx=await context(browser,operator,width),page=await ctx.newPage();
  for(const path of operator?["/admin/creators","/admin/insights"]:["/home","/my","/wallet"]){
   await page.goto(path);await settled(page);
   const size=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
   expect.soft(size.scroll,`${path} width ${width}`).toBeLessThanOrEqual(size.viewport+1);cells.push({width,operator,path,...size});
  }
  await ctx.close();
 }
 for(const operator of [false,true]){
  const ctx=await context(browser,operator,1280,true),page=await ctx.newPage();await page.goto(operator?"/admin/creators":"/home");await settled(page);
  const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));expect.soft(size.scroll).toBeLessThanOrEqual(size.viewport+1);
  cells.push({operator,zoom:"200% desktop reflow simulation: 1280x900 physical => 640x450 CSS at DPR2; not native browser zoom",...size});await ctx.close();
 }
 record("responsive",cells);
});

test("D17 assistant keyboard dialog restores focus, offers usable targets and retains input on announced failure",async({browser})=>{
 const ctx=await context(browser),page=await ctx.newPage();await page.goto("/home");await settled(page);
 const launch=page.getByRole("button",{name:"Open AI Assistant",exact:true});await launch.focus();await page.keyboard.press("Enter");
 const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
 const close=dialog.getByRole("button",{name:/close/i});const box=await close.boundingBox();expect.soft(box!.width).toBeGreaterThanOrEqual(44);expect.soft(box!.height).toBeGreaterThanOrEqual(44);
 const input=dialog.getByRole("textbox");await expect(input).toBeFocused();
 const last=dialog.getByRole("button",{name:"Send",exact:true});await last.focus();await page.keyboard.press("Tab");await expect(close).toBeFocused();await page.keyboard.press("Shift+Tab");await expect(last).toBeFocused();
 let mocked=0;await page.route("**/api/assistant/chat",route=>{mocked++;return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Explicit mocked unavailable provider; no real AI request."})});});
 await input.fill("Retained accessibility draft "+"https://example.invalid/"+"x".repeat(250));
 await input.press("Enter");await expect(dialog.getByRole("alert").first()).toBeVisible();await expect(input).toHaveValue(/Retained accessibility draft/);
 expect(mocked).toBe(1);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);expect.soft(overflow).toBe(false);
 await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(launch).toBeFocused();
 record("dialog",{focusRestored:true,failureTransportMock:true,mocked503Responses:mocked,inputPreserved:true,closeTarget:box});await ctx.close();
});

test("D17 Insights announces an unavailable read, retries and labels ledger credits without payout claims",async({browser})=>{
 const ctx=await context(browser,true),page=await ctx.newPage(),pattern="**/api/admin/insights?*";
 await page.route(pattern,route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({code:"metrics_unavailable",error:"Explicit unavailable-read fixture"})}));
 await page.goto("/admin/insights");await expect(page.getByRole("alert").first()).toBeVisible();
 await page.unroute(pattern);await page.getByRole("button",{name:/Retry/}).last().click();
 await expect(page.getByText(/Cash ledger credits/)).toBeVisible();await expect(page.getByText("Cash paid",{exact:true})).toHaveCount(0);
 await expect(page.getByText(/Asia\/Hong_Kong/)).toBeVisible();await expect(page.getByText(/112\.50/)).toBeVisible();
 record("insights-ui",{retry:true,currency:"HKD",cashCredits:112.5,payoutClaim:false});await ctx.close();
});

test("D17 selected core pages satisfy the automated WCAG A/AA checks; manual and device limits remain explicit",async({browser})=>{
 const scans=[];
 for(const operator of [false,true]){
  const ctx=await context(browser,operator),page=await ctx.newPage();
  for(const path of operator?["/admin/creators","/admin/insights"]:["/home","/my","/wallet"]){
   await page.goto(path);await settled(page);await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")});
   const result=await page.evaluate(async()=>{
    const axe=(window as unknown as {axe:{run:(node:Document,options:unknown)=>Promise<{violations:Array<{id:string;impact:string;help:string;helpUrl:string;nodes:Array<{target:string[]}>}>}>}}).axe;
    const r=await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}});
    return r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,helpUrl:v.helpUrl,targets:v.nodes.map(n=>n.target)}));
   });
   scans.push({operator,path,violations:result});expect.soft(result,`${path} WCAG automated checks`).toEqual([]);
  }
  await ctx.close();
 }
 record("accessibility-scans",{axeVersion:require("axe-core/package.json").version,scans,limitations:["Selected pages and automated rules only; not full accessibility certification.","Keyboard and ARIA live regions tested separately; no physical screen-reader or Safari session."]});
});

test("D17 records production-asset lab vitals, 100 HTTP API reads and 24 real queue interactions",async({browser})=>{
 const ctx=await context(browser,true,1280),page=await ctx.newPage();
 await page.addInitScript(()=>{
  const state={lcp:[] as number[],shifts:[] as {at:number;value:number}[],events:[] as {id:number;duration:number;at:number}[]};
  (window as unknown as {d17Vitals:typeof state}).d17Vitals=state;
  for(const type of ["largest-contentful-paint","layout-shift","event"]){
   if(!PerformanceObserver.supportedEntryTypes.includes(type))continue;
   new PerformanceObserver(list=>{for(const entry of list.getEntries()){
    if(type==="largest-contentful-paint")state.lcp.push(entry.startTime);
    if(type==="layout-shift"){const e=entry as PerformanceEntry&{value:number;hadRecentInput:boolean};if(!e.hadRecentInput)state.shifts.push({at:e.startTime,value:e.value});}
    if(type==="event"){const e=entry as PerformanceEntry&{interactionId:number;duration:number};if(e.interactionId)state.events.push({id:e.interactionId,duration:e.duration,at:e.startTime});}
   }}).observe({type,buffered:true,...(type==="event"?{durationThreshold:16}:{})});
  }
 });
 const pages=[];
 for(const path of ["/admin/creators","/admin/insights"]){
  await page.goto(path);await settled(page);
  pages.push({path,cache:"HTTP cache disabled by request routing; first navigation",...await page.evaluate(()=>({vitals:(window as unknown as {d17Vitals:unknown}).d17Vitals,resources:performance.getEntriesByType("resource").filter(r=>r.name.includes("/assets/")).map(r=>({name:new URL(r.name).pathname,transferBytes:(r as PerformanceResourceTiming).transferSize,encodedBytes:(r as PerformanceResourceTiming).encodedBodySize}))}))});
 }
 const requests=[];
 for(let i=0;i<100;i++){
  const started=performance.now();const response=await page.request.get(`/api/admin/creators/review?page=${i%2+1}`,{headers:{Authorization:`Bearer ${fx.operator.jwt}`,"X-Workspace-Slug":fx.slug}});const body=await response.json();
  requests.push({ms:performance.now()-started,status:response.status(),total:body.total,rows:body.creators?.length});
  expect(response.status()).toBe(200);expect(body.total).toBe(10000);expect(body.creators).toHaveLength(25);
 }
 await page.goto("/admin/creators");await settled(page);
 const interactions=[];
 for(let i=0;i<24;i++){
  const started=performance.now();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/admin/creators/review"&&r.status()===200);
  await page.getByRole("button",{name:"下一頁 / Next",exact:true}).click();await response;
  await expect(page.getByRole("navigation",{name:"Creator queue pages"})).toContainText(`${i+2} / 400`);
  await expect(page.getByRole("button",{name:"下一頁 / Next",exact:true})).toBeEnabled();
  interactions.push({action:"next",page:i+2,toReadyMs:performance.now()-started});
 }
 await page.waitForTimeout(300);
 const vitals=await page.evaluate(()=>(window as unknown as {d17Vitals:{lcp:number[];shifts:{at:number;value:number}[];events:{id:number;duration:number;at:number}[]}}).d17Vitals);
 const groups=new Map<number,number>();for(const event of vitals.events)groups.set(event.id,Math.max(groups.get(event.id)??0,event.duration));
 const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return{samples:values.length,p50:sorted[Math.ceil(values.length*.5)-1]??null,p95:sorted[Math.ceil(values.length*.95)-1]??null,max:sorted.at(-1)??null};};
 let start=0,last=0,sum=0,cls=0;for(const shift of vitals.shifts){if(shift.at-last>1000||shift.at-start>5000){start=shift.at;sum=0;}sum+=shift.value;last=shift.at;cls=Math.max(cls,sum);}
 const inp=[...groups.values()].sort((a,b)=>b-a)[Math.floor(groups.size/50)]??null;
 record("runtime-performance",{browser:browser.version(),viewport:"1280x900",network:"loopback, no throttling, external requests aborted; fonts use local fallback",cache:"HTTP cache disabled due network routing; DB and server warmed, not reset",pages,requests,httpApi:summary(requests.map(r=>r.ms)),interactions,uiToReady:summary(interactions.map(r=>r.toReadyMs)),eventTiming:vitals.events,observedInteractions:groups.size,labInpCandidateMs:inp,cls,thresholds:{apiP95:800,lcpMs:2500,inpMs:200,cls:.1},limitations:["Lab visit INP candidate, not field p75 across real users.","Browser warm-cache, physical mobile, CPU-throttled network and production not measured."]});
 await page.screenshot({path:"docs/verification/D17-queue-desktop.png"});await ctx.close();
});
