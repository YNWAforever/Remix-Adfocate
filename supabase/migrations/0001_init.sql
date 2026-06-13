-- Workspaces ---------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  plan text not null default 'starter' check (plan in ('starter','growth','enterprise')),
  theme jsonb not null default '{}',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Creators (id = auth user id) --------------------------------------------
create table public.creators (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  display_name text,
  avatar_url text,
  level text not null default 'L0',
  xp integer not null default 0,
  categories text[] not null default '{}',
  social_handles jsonb not null default '[]',
  scores jsonb not null default '{"influence":0,"content":0,"reliability":0,"brandSafety":0}',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- Missions -----------------------------------------------------------------
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  slug text not null,
  title text not null,
  description text,
  category text,
  mission_type text not null check (mission_type in ('koc_trial','ugc','clipping','affiliate','performance_cpm','live_commerce','brand_ambassador')),
  access_type text not null default 'open' check (access_type in ('open','application')),
  required_level text not null default 'L0',
  points_reward integer not null default 0,
  cash_reward numeric(8,2),
  cpm_rate numeric(8,2),
  cpm_budget_pool numeric(10,2),
  deadline date,
  quota integer not null default 10,
  filled integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

-- Redemption gifts ---------------------------------------------------------
create table public.redemption_gifts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  name text not null,
  description text,
  category text,
  points_cost integer not null,
  stock_qty integer not null default 0,
  stock_remaining integer not null default 0,
  gift_type text not null check (gift_type in ('voucher','physical','digital','experience')),
  image_url text,
  status text not null default 'available',
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now()
);

-- Point balances -----------------------------------------------------------
create table public.point_balances (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  balance integer not null default 0,
  available_from timestamptz not null default now(),
  available_to timestamptz,
  updated_at timestamptz not null default now(),
  unique (creator_id, workspace_id)
);

-- Point transactions -------------------------------------------------------
create table public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  type text not null check (type in ('earn','redeem','expire','adjust','referral','bonus','multiplier')),
  delta integer not null,
  balance_after integer not null,
  source_ref text,
  description text,
  created_at timestamptz not null default now()
);

-- Realtime for live balance
alter publication supabase_realtime add table public.point_balances;

-- Row-Level Security -------------------------------------------------------
alter table public.workspaces         enable row level security;
alter table public.creators           enable row level security;
alter table public.missions           enable row level security;
alter table public.redemption_gifts   enable row level security;
alter table public.point_balances     enable row level security;
alter table public.point_transactions enable row level security;

-- Helper: the current creator's workspace_id.
-- SECURITY DEFINER so it can read creators (which has RLS) to resolve the
-- caller's tenant from auth.uid(); this avoids needing a custom JWT claim /
-- access-token hook for workspace-scoped reads (spec §6 fallback).
create or replace function public.current_workspace_id() returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from public.creators where id = auth.uid() limit 1
$$;

-- Creator-owned tables: a creator sees only their own rows
create policy creators_self on public.creators
  for select using (id = auth.uid());
create policy balances_self on public.point_balances
  for select using (creator_id = auth.uid());
create policy transactions_self on public.point_transactions
  for select using (creator_id = auth.uid());

-- Workspace-scoped catalogue tables: readable to creators of that workspace
create policy missions_workspace on public.missions
  for select using (workspace_id = public.current_workspace_id());
create policy gifts_workspace on public.redemption_gifts
  for select using (workspace_id = public.current_workspace_id());

-- Workspaces: a creator may read their own workspace row
create policy workspace_self on public.workspaces
  for select using (id = public.current_workspace_id());
