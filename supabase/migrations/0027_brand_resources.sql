-- 0027_brand_resources.sql — Brand Resources (C2): audience-partition content_items so the
-- existing Content Hub (0021_content_hub.sql) can serve brand-facing guides alongside creator
-- news, without a new table and without overloading `kind`. Additive. No RLS change — the
-- existing content_items_read_published policy (status='published' and workspace_id is null)
-- already covers brand users, who are Supabase Auth users like anyone else; audience gating
-- happens at the route/query level (server/routes/content.ts, server/routes/brandResources.ts).
-- See docs/superpowers/specs/2026-07-01-brand-resources-c2-design.md.

alter table public.content_items
  add column audience text not null default 'creator' check (audience in ('creator','brand'));

create index content_items_audience_status_pub_idx
  on public.content_items (audience, status, published_at desc);
