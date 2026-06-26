-- 0023_brand_access.sql
-- Slice B3b-1: brand identity + invite + RLS-enforced workspace isolation.

-- Pending invites (by email, before an auth user exists). Server-only (service_role).
create table public.brand_invites (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  role             text not null default 'member' check (role in ('owner','member')),
  token            text not null unique default encode(gen_random_bytes(16), 'hex'),
  invited_by_staff uuid references auth.users(id),
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index brand_invites_pending_email on public.brand_invites (lower(email)) where accepted_at is null;
alter table public.brand_invites enable row level security;
grant all on public.brand_invites to service_role;  -- no authenticated/anon policies

-- Active membership (by user_id). v1: one workspace per brand user.
create table public.brand_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,
  role         text not null default 'member' check (role in ('owner','member')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.brand_users enable row level security;
grant all on public.brand_users to service_role;
grant select on public.brand_users to authenticated;
create policy brand_users_self_read on public.brand_users
  for select to authenticated using (user_id = auth.uid());

-- Brand access to missions, scoped by membership (ADDITIVE to existing creator/staff paths).
grant select, insert, update, delete on public.missions to authenticated;
create policy missions_brand_select on public.missions
  for select to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy missions_brand_insert on public.missions
  for insert to authenticated
  with check (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy missions_brand_update on public.missions
  for update to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active))
  with check (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active));
create policy missions_brand_delete on public.missions
  for delete to authenticated
  using (workspace_id in (select workspace_id from public.brand_users bu where bu.user_id = auth.uid() and bu.active and bu.role = 'owner'));
