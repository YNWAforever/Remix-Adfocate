-- Slice 3: restore the table-level GRANTs that the deprecated auto-expose default
-- used to provide. Without these, the `authenticated` role gets RLS-passes-but-
-- still-403 on fresh (post-2026-05-30) stacks. Cloud predates the flip, so prod
-- already works; this makes local + CI match and hardens against drift.

grant select on
  public.workspaces,
  public.missions,
  public.redemption_gifts,
  public.creators,
  public.point_balances,
  public.point_transactions
  to authenticated;

-- Profile self-edit columns (UPDATE is gated by the creators_self_update policy
-- from 0003; this grants the column privilege the policy needs to take effect).
grant update (display_name, avatar_url, categories, social_handles, onboarding_step, phone)
  on public.creators to authenticated;
