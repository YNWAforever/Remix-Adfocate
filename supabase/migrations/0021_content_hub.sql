-- 0021_content_hub.sql — Content Hub (CMS Slice C1): editorial articles + announcements.
-- Staff author markdown in /admin; authenticated creators read published-global rows at /news.

-- Taxonomy (created before content_items for the category FK) -----------------
create table public.content_categories (
  id        uuid primary key default gen_random_uuid(),
  slug      text not null unique,
  label_zh  text not null,
  label_en  text,
  sort      int  not null default 0,
  created_at timestamptz not null default now()
);

create table public.content_tags (
  id        uuid primary key default gen_random_uuid(),
  slug      text not null unique,
  label_zh  text not null,
  label_en  text,
  created_at timestamptz not null default now()
);

-- Core --------------------------------------------------------------------------
create table public.content_items (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('article','announcement')),
  slug            text not null unique,
  status          text not null default 'draft' check (status in ('draft','scheduled','published','archived')),
  title_zh        text not null,
  title_en        text,
  excerpt_zh      text,
  excerpt_en      text,
  body_zh         text not null default '',
  body_en         text,
  cover_image_url text,
  category_id     uuid references public.content_categories(id) on delete set null,
  author_id       uuid,
  workspace_id    uuid references public.workspaces(id),
  pinned          boolean not null default false,
  pinned_rank     int,
  views           int not null default 0,
  scheduled_for   timestamptz,
  published_at    timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint content_items_scheduled_chk check (status <> 'scheduled' or scheduled_for is not null)
);

create table public.content_item_tags (
  content_id uuid not null references public.content_items(id) on delete cascade,
  tag_id     uuid not null references public.content_tags(id) on delete cascade,
  primary key (content_id, tag_id)
);

-- updated_at trigger ------------------------------------------------------------
create or replace function public.content_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger content_items_touch
  before update on public.content_items
  for each row execute function public.content_touch_updated_at();

-- Indexes -----------------------------------------------------------------------
create index content_items_kind_status_pub_idx on public.content_items (kind, status, published_at desc);
create index content_items_category_idx        on public.content_items (category_id);
create index content_items_scheduled_idx        on public.content_items (scheduled_for) where status = 'scheduled';
create index content_items_pinned_idx           on public.content_items (pinned_rank) where pinned;

-- RLS: authenticated creators read published-global; all writes are service-role -
alter table public.content_items     enable row level security;
alter table public.content_categories enable row level security;
alter table public.content_tags        enable row level security;
alter table public.content_item_tags   enable row level security;

create policy content_items_read_published on public.content_items
  for select to authenticated using (status = 'published' and workspace_id is null);
create policy content_categories_read on public.content_categories for select to authenticated using (true);
create policy content_tags_read       on public.content_tags       for select to authenticated using (true);
create policy content_item_tags_read  on public.content_item_tags  for select to authenticated using (true);

grant select on public.content_items, public.content_categories, public.content_tags, public.content_item_tags to authenticated;
grant all    on public.content_items, public.content_categories, public.content_tags, public.content_item_tags to service_role;

-- RPCs --------------------------------------------------------------------------
create or replace function public.content_increment_views(p_slug text)
returns void language sql security definer set search_path = public as $$
  update public.content_items set views = views + 1
  where slug = p_slug and status = 'published' and workspace_id is null;
$$;
revoke all on function public.content_increment_views(text) from public, anon;
grant execute on function public.content_increment_views(text) to authenticated, service_role;

create or replace function public.content_publish_scheduled()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.content_items
     set status = 'published', published_at = now()
   where status = 'scheduled' and scheduled_for <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.content_publish_scheduled() from public, anon, authenticated;
grant execute on function public.content_publish_scheduled() to service_role;

-- Storage bucket (public read; staff upload via serviceClient server-side) -------
insert into storage.buckets (id, name, public) values ('content-media', 'content-media', true)
on conflict (id) do nothing;

-- Seed two starter categories so the editor select is non-empty -----------------
insert into public.content_categories (slug, label_zh, label_en, sort) values
  ('platform-news', '平台公告', 'Platform News', 0),
  ('creator-tips',  '創作心得', 'Creator Tips', 1)
on conflict (slug) do nothing;
