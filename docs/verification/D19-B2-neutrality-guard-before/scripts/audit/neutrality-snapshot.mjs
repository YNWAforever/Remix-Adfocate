export function neutralitySnapshot(target,id,workspace){
  if(![id,workspace].every((value)=>/^[a-f0-9-]{36}$/.test(value)))throw new Error("invalid exact fixture ID");
  return JSON.parse(target.sql(`select jsonb_build_object(
    'xp',(select xp from public.creators where id='${id}'),
    'points',(select balance from public.point_balances where creator_id='${id}'),
    'withdrawable',(select available from public.earnings_balances where creator_id='${id}'),
    'budget',(select balance from public.workspace_budgets where workspace_id='${workspace}'),
    'pointLedger',(select count(*) from public.point_transactions where creator_id='${id}'),
    'cashLedger',(select count(*) from public.earnings_transactions where creator_id='${id}'),
    'redemptions',(select count(*) from public.redemptions where creator_id='${id}'),
    'budgetLedger',(select count(*) from public.workspace_budget_transactions where workspace_id='${workspace}'),
    'rewardInventory',coalesce((select jsonb_agg(jsonb_build_object('id',id,'stock_qty',stock_qty,'stock_remaining',stock_remaining) order by id) from public.redemption_gifts where workspace_id='${workspace}'),'[]'::jsonb));`));
}
