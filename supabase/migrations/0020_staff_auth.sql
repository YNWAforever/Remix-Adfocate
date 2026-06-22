-- 0020_staff_auth.sql
-- Slice B3a: staff identity allowlist. A row here (active) = Fimmick staff with full
-- cross-workspace admin access. Read only by the server via the service client, so RLS
-- is closed by default (no authenticated/anon policies); the frontend learns staff status
-- via GET /admin/me, never by querying this table directly.
create table public.staff_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff_users enable row level security;
-- service_role bypasses RLS; no policies for authenticated/anon = they cannot read it.
grant all on public.staff_users to service_role;
