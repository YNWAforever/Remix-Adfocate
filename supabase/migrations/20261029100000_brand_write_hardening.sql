-- Brand writes go through the API, which validates input and forces the workspace from the
-- brand identity. Browser-held JWTs previously kept table-wide INSERT/DELETE (and UPDATE of
-- mission status), so a brand could insert a live mission with any reward, publish without
-- validation, or delete a mission and cascade away creators' submissions via PostgREST.
-- Reward columns had no lower bound, so a negative points_reward debited creators on approval.
begin;

revoke insert, delete on table public.missions from anon, authenticated;
revoke update (status, published_at, closed_at) on table public.missions from anon, authenticated;
revoke insert, update, delete on table public.campaigns from anon, authenticated;
revoke insert, update, delete on table public.campaign_missions from anon, authenticated;

-- NOT VALID: enforced for every new or updated row without failing the deploy on any legacy
-- production row; validate after the data check in the release runbook.
alter table public.missions
  add constraint missions_points_reward_nonneg check (points_reward >= 0) not valid,
  add constraint missions_cash_reward_nonneg check (cash_reward is null or cash_reward >= 0) not valid,
  add constraint missions_cpm_nonneg check ((cpm_rate is null or cpm_rate >= 0) and (cpm_budget_pool is null or cpm_budget_pool >= 0)) not valid,
  add constraint missions_quota_filled_nonneg check (quota >= 0 and filled >= 0) not valid;

alter table public.campaigns
  add constraint campaigns_bonus_nonneg check (completion_bonus_points >= 0 and completion_bonus_xp >= 0) not valid,
  add constraint campaigns_goal_target_positive check (goal_target > 0) not valid;

commit;
