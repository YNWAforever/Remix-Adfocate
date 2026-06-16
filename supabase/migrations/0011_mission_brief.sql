-- Slice A (mission brief): structured brief fields on missions so the detail page can
-- show a creator what to make / requirements / where to post / effort. Additive,
-- nullable-or-defaulted — table-level select grant + existing RLS already cover them.
alter table public.missions
  add column deliverables text[] not null default '{}',
  add column requirements text[] not null default '{}',
  add column platforms    text[] not null default '{}',
  add column effort        text check (effort in ('low','medium','high'));
