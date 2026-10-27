import { describe, expect, it } from "vitest";
// @ts-expect-error Existing native ESM acceptance helper.
import { assertBrowserPendingNeutrality, neutralitySnapshot } from "../../scripts/audit/neutrality-snapshot.mjs";
const id="11111111-1111-4111-8111-111111111111",workspaceId="22222222-2222-4222-8222-222222222222";
const tableNames=["point_balances","point_transactions","earnings_balances","earnings_transactions","workspace_budgets","workspace_budget_transactions","redemptions","redemption_gifts","redemption_codes"];
function samples(){
 const expected={runId:id,target:{projectId:"unit-b2",databaseContainerId:"unit-db"},creatorId:id,workspaceId,submissionId:"33333333-3333-4333-8333-333333333333",workflowId:"44444444-4444-4444-8444-444444444444",lineage:{projectId:"unit-b2",sourceFingerprint:"unit",manifestSha256:"unit",phase:"browser"}};
 const before={...expected,snapshot:{xp:145,points:550,withdrawable:125,budget:8875,pointLedger:1,cashLedger:1,redemptions:0,budgetLedger:1,rewardInventory:[{id,stock_qty:3,stock_remaining:3}],financialRows:{creatorsXp:[{id,xp:145}],...Object.fromEntries(tableNames.map(t=>[t,[]]))} as Record<string,unknown>},legacyAnchors:[{id,status:"approved",pointsAwarded:500,xpAwarded:135,reviewedAt:"2026-10-25T00:00:00Z"}]};
 return{expected,before,after:structuredClone(before)};
}
describe("D19 browser pending reward gate",()=>{
 it("accepts unchanged funded state only within the exact saved run/target/workflow frame",()=>{
  const s=samples();expect(assertBrowserPendingNeutrality(s.before,s.after,s.expected)).toMatchObject({passed:true,financialRowsCompared:true,legacyAnchorsEqual:true});
 });
 it.each(["xp","points","withdrawable","budget","pointLedger","cashLedger","redemptions","budgetLedger"])("rejects a %s delta even when browser cases reported success",key=>{
  const s=samples();s.after.snapshot[key as "xp"]+=1;
  expect(()=>assertBrowserPendingNeutrality(s.before,s.after,s.expected)).toThrow("D19_PENDING_REWARD_NEUTRALITY_CHANGED");
 });
 it("rejects an altered ledger row with unchanged balances and ledger counts",()=>{
  const s=samples();s.before.snapshot.financialRows.point_transactions=[{id,hash:"before"}];s.after.snapshot.financialRows.point_transactions=[{id,hash:"after"}];
  expect(()=>assertBrowserPendingNeutrality(s.before,s.after,s.expected)).toThrow("D19_PENDING_REWARD_NEUTRALITY_CHANGED");
 });
 it("rejects stock changes and altered issued legacy anchors",()=>{
  const s=samples();s.after.snapshot.rewardInventory[0].stock_remaining=2;
  expect(()=>assertBrowserPendingNeutrality(s.before,s.after,s.expected)).toThrow("D19_PENDING_REWARD_NEUTRALITY_CHANGED");
  s.after=structuredClone(s.before);s.after.legacyAnchors[0].xpAwarded=235;
  expect(()=>assertBrowserPendingNeutrality(s.before,s.after,s.expected)).toThrow("D19_PENDING_REWARD_NEUTRALITY_CHANGED");
 });
 it.each(["runId","creatorId","workspaceId","workflowId","submissionId"])("rejects a borrowed %s frame",key=>{
  const s=samples();s.after[key as "runId"]="55555555-5555-4555-8555-555555555555";
  expect(()=>assertBrowserPendingNeutrality(s.before,s.after,s.expected)).toThrow("D19_PENDING_REWARD_FRAME_MISMATCH");
 });
 it("refuses missing complete row evidence, wrong lineage and absent funded values",()=>{
  const s=samples();delete (s.after.snapshot as Partial<typeof s.after.snapshot>).financialRows;
  expect(()=>assertBrowserPendingNeutrality(s.before,s.after,s.expected)).toThrow("D19_PENDING_REWARD_EVIDENCE_INCOMPLETE");
  s.after=structuredClone(s.before);s.after.lineage.sourceFingerprint="other";
  expect(()=>assertBrowserPendingNeutrality(s.before,s.after,s.expected)).toThrow("D19_PENDING_REWARD_FRAME_MISMATCH");
  s.after=structuredClone(s.before);s.after.snapshot.budget=Number.NaN;
  expect(()=>assertBrowserPendingNeutrality(s.before,s.after,s.expected)).toThrow("D19_PENDING_REWARD_EVIDENCE_INCOMPLETE");
 });
 it("uses a single read-only exact-workspace query for complete row hashes and all creator XP",()=>{
  const s=samples();let query="";
  const target={sql:(sql:string)=>{query=sql;return JSON.stringify(s.before.snapshot);}};
  expect(neutralitySnapshot(target,id,workspaceId,{complete:true})).toEqual(s.before.snapshot);
  expect(query).toMatch(/^begin read only;/);expect(query).toContain(workspaceId);
  for(const table of tableNames)expect(query).toContain("public."+table);
  expect(query).toContain("md5(to_jsonb(t)::text)");expect(query).not.toMatch(/insert into|update public|delete from|truncate/i);
 });
});
