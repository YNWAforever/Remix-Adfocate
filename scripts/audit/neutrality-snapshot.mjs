import {isDeepStrictEqual} from "node:util";

const financialTables=["point_balances","point_transactions","earnings_balances","earnings_transactions","workspace_budgets","workspace_budget_transactions","redemptions","redemption_gifts","redemption_codes"];
const numericFields=["xp","points","withdrawable","budget","pointLedger","cashLedger","redemptions","budgetLedger"];
export function neutralitySnapshot(target,id,workspace,{complete=false}={}){
  if(![id,workspace].every((value)=>/^[a-f0-9-]{36}$/.test(value)))throw new Error("invalid exact fixture ID");
  const rows=complete?`, 'financialRows',jsonb_build_object(
    'creatorsXp',coalesce((select jsonb_agg(jsonb_build_object('id',id,'xp',xp)order by id)from public.creators where workspace_id='${workspace}'),'[]'::jsonb),
    ${financialTables.map(table=>`'${table}',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'hash',md5(to_jsonb(t)::text))order by t.id)from public.${table} t where t.workspace_id='${workspace}'),'[]'::jsonb)`).join(",")})`:"";
  return JSON.parse(target.sql(`${complete?"begin read only;":""}select jsonb_build_object(
    'xp',(select xp from public.creators where id='${id}'),
    'points',(select balance from public.point_balances where creator_id='${id}'),
    'withdrawable',(select available from public.earnings_balances where creator_id='${id}'),
    'budget',(select balance from public.workspace_budgets where workspace_id='${workspace}'),
    'pointLedger',(select count(*) from public.point_transactions where creator_id='${id}'),
    'cashLedger',(select count(*) from public.earnings_transactions where creator_id='${id}'),
    'redemptions',(select count(*) from public.redemptions where creator_id='${id}'),
    'budgetLedger',(select count(*) from public.workspace_budget_transactions where workspace_id='${workspace}'),
    'rewardInventory',coalesce((select jsonb_agg(jsonb_build_object('id',id,'stock_qty',stock_qty,'stock_remaining',stock_remaining) order by id) from public.redemption_gifts where workspace_id='${workspace}'),'[]'::jsonb)${rows});${complete?"commit;":""}`));
}

export function legacyRewardAnchors(target,workspace){
  if(!/^[a-f0-9-]{36}$/.test(workspace))throw new Error("invalid exact fixture workspace");
  return JSON.parse(target.sql(`begin read only;select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'missionId',s.mission_id,'creatorId',s.creator_id,'status',s.status,'pointsAwarded',s.points_awarded,'xpAwarded',s.xp_awarded,'reviewedAt',s.reviewed_at)order by s.id),'[]'::jsonb)from public.mission_submissions s join public.missions m on m.id=s.mission_id and m.workspace_id=s.workspace_id where s.workspace_id='${workspace}' and m.creator_workflow_mode='legacy' and s.status='approved';commit;`));
}

export function assertBrowserPendingNeutrality(before,after,expected){
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  for(const evidence of [before,after]){
    if(!evidence||!expected)fail("D19_PENDING_REWARD_EVIDENCE_INCOMPLETE");
    for(const key of ["runId","target","creatorId","workspaceId","submissionId","workflowId"]){
      if(expected[key]===undefined||!isDeepStrictEqual(evidence[key],expected[key]))fail("D19_PENDING_REWARD_FRAME_MISMATCH");
    }
    if(expected.lineage&&!isDeepStrictEqual(evidence.lineage,expected.lineage))fail("D19_PENDING_REWARD_FRAME_MISMATCH");
    const snapshot=evidence.snapshot;
    if(!snapshot||numericFields.some(key=>typeof snapshot[key]!=="number"||!Number.isFinite(snapshot[key]))
      ||!Array.isArray(snapshot.rewardInventory)||!Array.isArray(evidence.legacyAnchors)||evidence.legacyAnchors.length===0)fail("D19_PENDING_REWARD_EVIDENCE_INCOMPLETE");
    if(expected.requireCompleteRows!==false&&(!snapshot.financialRows||["creatorsXp",...financialTables].some(key=>!Array.isArray(snapshot.financialRows[key]))))fail("D19_PENDING_REWARD_EVIDENCE_INCOMPLETE");
  }
  if(!isDeepStrictEqual(before.snapshot,after.snapshot)||!isDeepStrictEqual(before.legacyAnchors,after.legacyAnchors))fail("D19_PENDING_REWARD_NEUTRALITY_CHANGED");
  return{passed:true,financialRowsCompared:expected.requireCompleteRows!==false,financialTableFamiliesCompared:expected.requireCompleteRows!==false?financialTables.length:0,legacyAnchorsEqual:true};
}
