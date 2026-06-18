-- Creator Profile Media: private portfolio drafts, public passport snapshots,
-- and creator-owned avatar uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creator-avatars',
  'creator-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.creator_portfolio_links (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  url text not null check (url ~* '^https?://'),
  title text not null check (length(trim(title)) > 0),
  platform_type text not null check (
    platform_type in ('instagram', 'threads', 'tiktok', 'youtube', 'website', 'case_study', 'other')
  ),
  caption text,
  sort_order integer not null default 0,
  public_highlight boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creator_portfolio_links_creator_idx
  on public.creator_portfolio_links (workspace_id, creator_id, sort_order, created_at);

create index creator_portfolio_links_highlight_idx
  on public.creator_portfolio_links (workspace_id, creator_id, public_highlight)
  where public_highlight = true;

create table public.creator_public_profile_snapshots (
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  avatar_url text,
  highlights jsonb not null default '[]',
  published_at timestamptz not null default now(),
  published_by uuid not null references public.creators(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, creator_id),
  check (jsonb_typeof(highlights) = 'array'),
  check (jsonb_array_length(highlights) <= 3)
);

create or replace function private.touch_creator_profile_media_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.uuid_lock_key(value uuid)
returns integer
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select
    ((get_byte(uuid_send(value), 0)::int << 24)
      | (get_byte(uuid_send(value), 1)::int << 16)
      | (get_byte(uuid_send(value), 2)::int << 8)
      | get_byte(uuid_send(value), 3)::int)
    # ((get_byte(uuid_send(value), 4)::int << 24)
      | (get_byte(uuid_send(value), 5)::int << 16)
      | (get_byte(uuid_send(value), 6)::int << 8)
      | get_byte(uuid_send(value), 7)::int)
    # ((get_byte(uuid_send(value), 8)::int << 24)
      | (get_byte(uuid_send(value), 9)::int << 16)
      | (get_byte(uuid_send(value), 10)::int << 8)
      | get_byte(uuid_send(value), 11)::int)
    # ((get_byte(uuid_send(value), 12)::int << 24)
      | (get_byte(uuid_send(value), 13)::int << 16)
      | (get_byte(uuid_send(value), 14)::int << 8)
      | get_byte(uuid_send(value), 15)::int);
$$;

create or replace function private.is_valid_public_profile_highlights(value jsonb)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select
    jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) <= 3
    and not exists (
      select 1
      from jsonb_array_elements(value) as elem
      where jsonb_typeof(elem) <> 'object'
        or not (
          elem ? 'url'
          and elem ? 'title'
          and elem ? 'platform_type'
          and elem ? 'caption'
          and elem ? 'sort_order'
        )
        or exists (
          select 1
          from jsonb_object_keys(elem) as key_name
          where key_name not in ('url', 'title', 'platform_type', 'caption', 'sort_order')
        )
        or jsonb_typeof(elem -> 'url') <> 'string'
        or (elem ->> 'url') !~* '^https?://'
        or jsonb_typeof(elem -> 'title') <> 'string'
        or btrim(elem ->> 'title') = ''
        or jsonb_typeof(elem -> 'platform_type') <> 'string'
        or (elem ->> 'platform_type') not in (
          'instagram',
          'threads',
          'tiktok',
          'youtube',
          'website',
          'case_study',
          'other'
        )
        or coalesce(jsonb_typeof(elem -> 'caption'), 'null') not in ('string', 'null')
        or jsonb_typeof(elem -> 'sort_order') <> 'number'
    );
$$;

alter table public.creator_public_profile_snapshots
  add constraint creator_public_profile_snapshots_highlights_public_shape_check
  check (private.is_valid_public_profile_highlights(highlights));

create trigger creator_portfolio_links_set_updated_at
  before update on public.creator_portfolio_links
  for each row execute function private.touch_creator_profile_media_updated_at();

create trigger creator_public_profile_snapshots_set_updated_at
  before update on public.creator_public_profile_snapshots
  for each row execute function private.touch_creator_profile_media_updated_at();

create or replace function private.enforce_creator_portfolio_highlight_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  if new.public_highlight then
    perform pg_advisory_xact_lock(
      private.uuid_lock_key(new.workspace_id),
      private.uuid_lock_key(new.creator_id)
    );

    select count(*)
      into v_count
      from public.creator_portfolio_links
      where creator_id = new.creator_id
        and workspace_id = new.workspace_id
        and public_highlight = true
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if v_count >= 3 then
      raise exception 'creator_portfolio_links highlight limit exceeded';
    end if;
  end if;

  return new;
end;
$$;

create trigger creator_portfolio_links_highlight_limit
  before insert or update on public.creator_portfolio_links
  for each row execute function private.enforce_creator_portfolio_highlight_limit();

alter table public.creator_portfolio_links enable row level security;
alter table public.creator_public_profile_snapshots enable row level security;

create policy creator_portfolio_links_self_select
  on public.creator_portfolio_links
  for select using (creator_id = auth.uid());

create policy creator_portfolio_links_self_insert
  on public.creator_portfolio_links
  for insert with check (
    creator_id = auth.uid()
    and workspace_id = private.current_workspace_id()
  );

create policy creator_portfolio_links_self_update
  on public.creator_portfolio_links
  for update using (creator_id = auth.uid())
  with check (
    creator_id = auth.uid()
    and workspace_id = private.current_workspace_id()
  );

create policy creator_portfolio_links_self_delete
  on public.creator_portfolio_links
  for delete using (creator_id = auth.uid());

create policy creator_public_profile_snapshots_self_select
  on public.creator_public_profile_snapshots
  for select using (creator_id = auth.uid());

create policy creator_avatar_objects_public_read
  on storage.objects
  for select
  using (bucket_id = 'creator-avatars');

create policy creator_avatar_objects_self_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'creator-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy creator_avatar_objects_self_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'creator-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'creator-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy creator_avatar_objects_self_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'creator-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

grant all on public.creator_portfolio_links to service_role;
grant all on public.creator_public_profile_snapshots to service_role;

grant select, insert, update, delete on public.creator_portfolio_links to authenticated;
grant select on public.creator_public_profile_snapshots to authenticated;
