begin;

-- F-008: creators were never asked to accept the Terms or Privacy Policy (PDPO PICS) and no
-- consent was stored. Each acceptance or marketing choice is appended here with the document
-- version shown; the latest row per document is the creator's current position. Rows are
-- written by the API (service role) and never edited, so the history is the audit trail.
create table public.creator_consents (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  document text not null check (document in ('terms', 'privacy', 'marketing')),
  version text not null check (btrim(version) <> '' and char_length(version) <= 40),
  granted boolean not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (document = 'marketing' or granted)
);
create index creator_consents_creator_document_idx
  on public.creator_consents (creator_id, document, recorded_at desc);

alter table public.creator_consents enable row level security;
revoke all on table public.creator_consents from public, anon, authenticated;
grant select on table public.creator_consents to authenticated;
grant select, insert on table public.creator_consents to service_role;
create policy creator_consents_self_read on public.creator_consents for select to authenticated
  using (creator_id = (select auth.uid()));

create function private.creator_consents_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_record';
end;
$$;
create trigger creator_consents_append_only before update on public.creator_consents
  for each row execute function private.creator_consents_append_only();

commit;
