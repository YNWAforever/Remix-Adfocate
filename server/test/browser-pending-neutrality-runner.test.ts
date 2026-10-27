import { afterEach, describe, expect, it, vi } from "vitest";
const io=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),spawn:vi.fn(),target:{}as Record<string,unknown>,capture:vi.fn()}));
vi.mock("node:fs",async original=>{const fs=await original<typeof import("node:fs")>();return{...fs,default:{...fs,readFileSync:io.read,writeFileSync:io.write},readFileSync:io.read,writeFileSync:io.write};});
vi.mock("node:child_process",async original=>{const cp=await original<typeof import("node:child_process")>();return{...cp,default:{...cp,spawnSync:io.spawn},spawnSync:io.spawn};});
vi.mock("../../scripts/audit/local-targets.mjs",()=>({verifiedTarget:()=>io.target}));
vi.mock("../../scripts/audit/b2-fixture-inventory.mjs",()=>({captureB2Inventory:io.capture}));
const originalArgv=[...process.argv];
afterEach(()=>{process.argv=originalArgv;vi.restoreAllMocks();vi.resetModules();});
class Stopped extends Error{constructor(readonly status:number){super("Unit runner stopped");}}
function scenario(changed:boolean){
 const ids={creatorId:"11111111-1111-4111-8111-111111111111",workspaceId:"22222222-2222-4222-8222-222222222222",submissionId:"33333333-3333-4333-8333-333333333333",workflowId:"44444444-4444-4444-8444-444444444444"};
 const identity={projectId:"unit-only",runId:"unit-owner"},lineage={projectId:"unit-only",phase:"browser",manifestSha256:"unit",sourceFingerprint:"unit"};
 const financialRows=Object.fromEntries(["point_balances","point_transactions","earnings_balances","earnings_transactions","workspace_budgets","workspace_budget_transactions","redemptions","redemption_gifts","redemption_codes","creatorsXp"].map(t=>[t,[]]));
 const snapshot={xp:145,points:550,withdrawable:125,budget:8875,pointLedger:1,cashLedger:1,redemptions:0,budgetLedger:1,rewardInventory:[],financialRows};
 const anchors=[{id:ids.submissionId,status:"approved",pointsAwarded:500,xpAwarded:135}];
 const fx={runId:"unit-phase",target:identity,creator:{id:ids.creatorId},workspaceId:ids.workspaceId,slug:"unit",core:{submissionId:ids.submissionId,workflowId:ids.workflowId}};
 const context={phase:"browser",lineage,privatePath:(n:string)=>"unit-private/"+n,publicPath:(n:string)=>"unit-public/"+n,readPrivate:()=>fx};
 const before={...ids,lineage,runId:fx.runId,target:identity,snapshot,legacyAnchors:anchors};
 io.target={context,identity,env:{SUPABASE_URL:"http://127.0.0.1:56821",SUPABASE_ANON_KEY:"unit-only"},sql:(query:string)=>JSON.stringify(query.includes("'legacy'")?anchors:{...snapshot,budget:snapshot.budget+(changed?1:0)})};
 io.read.mockReset().mockImplementation((p:string)=>p.endsWith("browser-before-handoff.json")?JSON.stringify(before):JSON.stringify({stats:{},suites:[{specs:[{title:"Mocked browser success",ok:true,tests:[{results:[{status:"passed",duration:1}]}]}]}]}));
 io.write.mockReset();io.spawn.mockReset().mockReturnValue({status:0});io.capture.mockReset();
 process.argv=["node","unit-runner","--resume"];
 vi.spyOn(process,"exit").mockImplementation(((status:number)=>{throw new Stopped(status);})as never);
}
describe("D19 browser runner requires financial evidence beyond browser success",()=>{
 it("exits1 and persists a failed phase when browser cases pass but the saved budget changes",async()=>{
  scenario(true);
  // @ts-expect-error Native executable is evaluated only with all I/O and subprocesses mocked.
  await expect(import("../../scripts/audit/run-pilot-browser.mjs")).rejects.toMatchObject({status:1});
  const phase=io.write.mock.calls.find(([p])=>p.endsWith("phase-result.json"));expect(JSON.parse(phase![1])).toMatchObject({exitCode:1});
  const summary=io.write.mock.calls.find(([p])=>p.endsWith("browser-summary.json"));expect(JSON.parse(summary![1])).toMatchObject({status:1,neutrality:{passed:false,reason:"D19_PENDING_REWARD_NEUTRALITY_CHANGED"}});
 });
 it("exits0 only after unchanged complete financial rows and legacy anchors have been compared",async()=>{
  scenario(false);
  // @ts-expect-error Native executable is evaluated only with all I/O and subprocesses mocked.
  await expect(import("../../scripts/audit/run-pilot-browser.mjs")).rejects.toMatchObject({status:0});
  const summary=io.write.mock.calls.find(([p])=>p.endsWith("browser-summary.json"));expect(JSON.parse(summary![1])).toMatchObject({status:0,neutrality:{passed:true,financialRowsCompared:true,financialTableFamiliesCompared:9,legacyAnchorsEqual:true}});
 });
});
