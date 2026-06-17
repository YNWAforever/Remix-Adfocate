-- Trust Profile Bundle: social scan snapshots, API-synced account metrics,
-- and opt-in public passport sharing.

create table public.creator_social_accounts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  platform text not null check (platform in ('instagram', 'threads')),
  handle text not null,
  handle_normalized text generated always as (lower(regexp_replace(handle, '^@+', ''))) stored,
  profile_url text,
  owner_verified boolean not null default false,
  api_synced_at timestamptz,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'stale', 'failed', 'rate_limited')),
  follower_count integer check (follower_count is null or follower_count >= 0),
  following_count integer check (following_count is null or following_count >= 0),
  post_count integer check (post_count is null or post_count >= 0),
  bio text,
  external_avatar_url text,
  engagement_rate numeric(8,4) check (engagement_rate is null or engagement_rate >= 0),
  avg_likes numeric(12,2) check (avg_likes is null or avg_likes >= 0),
  avg_comments numeric(12,2) check (avg_comments is null or avg_comments >= 0),
  posting_frequency numeric(12,4) check (posting_frequency is null or posting_frequency >= 0),
  freshness_score integer check (freshness_score is null or (freshness_score >= 0 and freshness_score <= 100)),
  content_themes jsonb not null default '[]',
  summary jsonb not null default '{}',
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, platform, handle_normalized)
);

create index creator_social_accounts_creator_idx
  on public.creator_social_accounts (creator_id);
create index creator_social_accounts_refresh_idx
  on public.creator_social_accounts (sync_status, api_synced_at);

create or replace function private.touch_creator_social_accounts_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger creator_social_accounts_set_updated_at
  before update on public.creator_social_accounts
  for each row
  execute function private.touch_creator_social_accounts_updated_at();

create table public.creator_social_scan_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_social_accounts(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  provider text not null,
  status text not null check (status in ('synced', 'stale', 'failed', 'rate_limited')),
  metrics jsonb not null default '{}',
  recent_posts_summary jsonb not null default '[]',
  error_code text,
  error_message text
);

create index creator_social_scan_snapshots_account_idx
  on public.creator_social_scan_snapshots (account_id, scanned_at desc);

create table public.creator_public_passports (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  public_token_hash text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  unique (creator_id)
);

alter table public.creator_social_accounts enable row level security;
alter table public.creator_social_scan_snapshots enable row level security;
alter table public.creator_public_passports enable row level security;

create policy creator_social_accounts_self_select
  on public.creator_social_accounts
  for select using (creator_id = auth.uid());

create policy creator_social_accounts_self_insert
  on public.creator_social_accounts
  for insert with check (
    creator_id = auth.uid()
    and workspace_id = private.current_workspace_id()
  );

create policy creator_social_accounts_self_update
  on public.creator_social_accounts
  for update using (creator_id = auth.uid())
  with check (
    creator_id = auth.uid()
    and workspace_id = private.current_workspace_id()
  );

create policy creator_social_accounts_self_delete
  on public.creator_social_accounts
  for delete using (creator_id = auth.uid());

create policy creator_social_snapshots_self_select
  on public.creator_social_scan_snapshots
  for select using (
    exists (
      select 1
      from public.creator_social_accounts a
      where a.id = account_id
        and a.creator_id = auth.uid()
    )
  );

create policy creator_public_passports_self_select
  on public.creator_public_passports
  for select using (creator_id = auth.uid());

create policy creator_public_passports_self_insert
  on public.creator_public_passports
  for insert with check (creator_id = auth.uid());

create policy creator_public_passports_self_update
  on public.creator_public_passports
  for update using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create policy creator_public_passports_self_delete
  on public.creator_public_passports
  for delete using (creator_id = auth.uid());

grant all on public.creator_social_accounts to service_role;
grant all on public.creator_social_scan_snapshots to service_role;
grant all on public.creator_public_passports to service_role;

grant select, delete on public.creator_social_accounts to authenticated;
grant insert (creator_id, workspace_id, platform, handle, profile_url)
  on public.creator_social_accounts to authenticated;
grant update (handle, profile_url)
  on public.creator_social_accounts to authenticated;
grant select on public.creator_social_scan_snapshots to authenticated;
grant select, delete on public.creator_public_passports to authenticated;
