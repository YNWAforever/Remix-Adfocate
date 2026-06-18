create or replace function private.is_valid_public_http_url(value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select value ~* '^https?://((([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)|(\d{1,3}(?:\.\d{1,3}){3}))(?::\d{1,5})?(?:[/?#][^\s]*)?$';
$$;

alter table public.creator_portfolio_links
  add constraint creator_portfolio_links_url_public_http_check
  check (private.is_valid_public_http_url(url));

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
        or not private.is_valid_public_http_url(elem ->> 'url')
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
        or ((elem ->> 'sort_order')::numeric % 1) <> 0
    );
$$;
