-- REVIEW-ONLY PROPOSAL for existing Remix-Adfocate mhkoayftiuojxlrkollf.
-- Not applied. Do not run without separately approved shared-database rehearsal.
-- Default is ROLLBACK. A future commit requires a newly reviewed artifact, not an ad-hoc edit.
-- Dedicated connection; stop on the first error; never use the ordinary migration runner.
-- Approval-reference settings are accidental-execution interlocks, NOT authorization or target identity.
-- Verify control-plane project identity and packet hashes independently before any SQL.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
DO $approval_guard$
BEGIN
 IF current_setting('kocmax.shared_db_review_reference',true) IS DISTINCT FROM 'c817e8f0-3cf0-461c-9c57-5e0715d5bfc8'
   OR current_setting('kocmax.shared_db_review_payload',true) IS DISTINCT FROM 'c879b204d9b2928c6426b641262096fff23ef1a1b49b33a8f2003afd5ee9dbff'
 THEN RAISE EXCEPTION 'DB_CHANGE_NOT_APPROVED_FOR_THIS_REVIEW_ARTIFACT'; END IF;
END
$approval_guard$;

DO $catalog_guard$
DECLARE actual text;
BEGIN
WITH t AS (
 SELECT c.oid,n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,c.relacl::text AS acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S')
)
SELECT md5(jsonb_build_object(
 'server_version',current_setting('server_version'),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','private')),
 'tables',(SELECT jsonb_agg(to_jsonb(t)-'oid' ORDER BY schema,name) FROM t),
 'columns',(SELECT jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY t.schema,t.name,a.attnum) FROM t JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid,true),'validated',c.convalidated) ORDER BY t.schema,t.name,c.conname) FROM t JOIN pg_constraint c ON c.conrelid=t.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef) ORDER BY schemaname,tablename,indexname) FROM pg_indexes WHERE schemaname IN ('public','private')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','private')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity_args',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,'definition_md5',md5(pg_get_functiondef(p.oid))) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('schema',t.schema,'table',t.name,'name',g.tgname,'enabled',g.tgenabled,'function',g.tgfoid::regprocedure::text,'definition_md5',md5(pg_get_triggerdef(g.oid,true))) ORDER BY t.schema,t.name,g.tgname) FROM t JOIN pg_trigger g ON g.tgrelid=t.oid WHERE NOT g.tgisinternal),
 'enums',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',y.typname,'label',e.enumlabel,'order',e.enumsortorder) ORDER BY n.nspname,y.typname,e.enumsortorder) FROM pg_type y JOIN pg_namespace n ON n.oid=y.typnamespace JOIN pg_enum e ON e.enumtypid=y.oid WHERE n.nspname IN ('public','private')),
 'default_acl',(SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'kind',d.defaclobjtype,'acl',d.defaclacl::text) ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname IN ('public','private')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'bypass_rls',rolbypassrls,'can_login',rolcanlogin) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','supabase_admin'))
)::text) INTO actual;

IF actual IS DISTINCT FROM '9c71b106abb2ec07304e10772a871f9b' THEN RAISE EXCEPTION 'CATALOG_DRIFT_STOP'; END IF;
RAISE NOTICE 'CATALOG_MATCH_ONLY_NOT_WRITE_AUTHORIZATION';
END
$catalog_guard$;

DO $extended_guard$
DECLARE actual text;
BEGIN
SELECT md5(jsonb_build_object(
 'executor',current_user,
 'column_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'acl',a.attacl::text) ORDER BY n.nspname,c.relname,a.attnum),'[]'::jsonb) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL),
 'table_owners',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'is_executor',c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) ORDER BY n.nspname,c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S')),
 'function_owners',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'is_executor',p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
 'api_memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'admin',admin_option) ORDER BY roleid,member),'[]'::jsonb) FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))),
 'buckets',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) ORDER BY id),'[]'::jsonb) FROM storage.buckets WHERE id IN ('mission-draft-assets','mission-publication-proof-assets')),
 'storage_policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname),'[]'::jsonb) FROM pg_policies p WHERE schemaname='storage' AND tablename IN ('objects','buckets')),
 'auth_user_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'function',tgfoid::regprocedure::text,'definition_md5',md5(pg_get_triggerdef(oid,true))) ORDER BY tgname),'[]'::jsonb) FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'event_triggers',(SELECT jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'tags',e.evttags,'enabled',e.evtenabled,'function',e.evtfoid::regprocedure::text,'function_md5',md5(pg_get_functiondef(e.evtfoid))) ORDER BY e.evtname) FROM pg_event_trigger e)
)::text) INTO actual;
IF actual IS DISTINCT FROM 'ced6f4c3e4ff69e10b8870f6a51b4717' THEN
  RAISE EXCEPTION 'EXTENDED_METADATA_DRIFT_STOP: %',actual;
END IF;
IF current_setting('session_replication_role') <> 'origin' OR current_setting('row_security') <> 'on' THEN
  RAISE EXCEPTION 'NORMAL_TRIGGER_AND_RLS_SESSION_REQUIRED';
END IF;
END
$extended_guard$;
DO $data_guard$
DECLARE failed text;
BEGIN
 SELECT string_agg(check_name, ', ' ORDER BY check_name) INTO failed
 FROM (SELECT 'submission_workspace_consistency' AS check_name,
  NOT EXISTS (SELECT 1 FROM public.mission_submissions s
    JOIN public.missions m ON m.id=s.mission_id
    JOIN public.creators c ON c.id=s.creator_id
    WHERE s.workspace_id IS DISTINCT FROM m.workspace_id OR s.workspace_id IS DISTINCT FROM c.workspace_id) AS passed
UNION ALL
SELECT 'point_reward_source_uniqueness', NOT EXISTS (
  SELECT 1 FROM public.point_transactions WHERE source_ref LIKE 'mission_reward:%'
  GROUP BY source_ref HAVING count(*)>1)
UNION ALL
SELECT 'cash_reward_source_uniqueness', NOT EXISTS (
  SELECT 1 FROM public.earnings_transactions WHERE source_ref LIKE 'mission_reward:%'
  GROUP BY source_ref HAVING count(*)>1)
UNION ALL
SELECT 'new_bucket_ids_unused', NOT EXISTS (
  SELECT 1 FROM storage.buckets WHERE id IN ('mission-draft-assets','mission-publication-proof-assets'))) checks
 WHERE passed IS DISTINCT FROM true;
 IF failed IS NOT NULL THEN RAISE EXCEPTION 'DATA_PREFLIGHT_STOP: %',failed; END IF;
END
$data_guard$;
-- BEGIN REVIEWED PAYLOAD
-- SOURCE: 11-apply-mission-repair.sql; sha256=bdde4538e1700f5f084be43deb06d1f0f41a755b88cea43eeae7a28caa3e4f97
-- Only the reviewed final baseline routine. Existing signature/ACL/owner retained by CREATE OR REPLACE.
-- 4. apply_mission: add the same effective-level gate (it had none before).
create or replace function public.apply_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_level text;
  m record;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id, level into v_ws, v_level
    from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline, required_level
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'application' then raise exception 'not_application'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;

  -- level_ordinal is 1-indexed (L0=1, L1=2, L2=3...) — compare against
  -- level_ordinal('L2'), NOT a bare 2, so the verification gate applies to L2+
  -- only and L0/L1 missions stay XP-only.
  if public.level_ordinal(m.required_level) >= public.level_ordinal('L2') then
    if public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
      raise exception 'level_locked';
    elsif not exists (
      select 1 from public.creator_social_accounts
      where creator_id = v_creator and owner_verified
    ) then
      raise exception 'verification_required';
    end if;
  elsif public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
    raise exception 'level_locked';
  end if;

  begin
    insert into public.mission_submissions
      (mission_id, creator_id, workspace_id, status, xp_awarded)
      values (p_mission, v_creator, v_ws, 'applied', 0)
      returning * into v_sub;
  exception when unique_violation then
    raise exception 'already_applied';
  end;
  return v_sub;
end;
$$;

-- SOURCE: derived-sql/20260715163350-active_mission_workspace.sql; sha256=780ae85d8025fb54853e7c1fd80823acf73d1ca261d08e9c2fdf896e303a1fbe
-- Phase 2 active mission workspace foundation.
-- The legacy mission_submissions row remains the reward anchor and stays joined.

create schema if not exists private;
revoke all on schema private from public;
alter table public.missions
  add column creator_workflow_mode text not null default 'legacy'
    check (creator_workflow_mode in ('legacy', 'active_workspace')),
  add column fulfillment_required boolean not null default false,
  add column revision_limit smallint not null default 2 check (revision_limit >= 0),
  add column review_sla_hours integer not null default 48 check (review_sla_hours > 0),
  add column revision_response_hours integer not null default 48 check (revision_response_hours > 0);
create table public.mission_deliverable_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  platform text not null check (btrim(platform) <> ''),
  position integer not null default 0 check (position >= 0),
  required boolean not null default true,
  draft_due_offset_hours integer check (draft_due_offset_hours is null or draft_due_offset_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, position)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_deliverable_templates FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_deliverable_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_deliverable_template_id uuid not null references public.mission_deliverable_templates(id) on delete cascade,
  category text not null check (category in ('format', 'key_message', 'compliance', 'quality', 'other')),
  requirement_text text not null check (btrim(requirement_text) <> ''),
  required boolean not null default true,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (mission_deliverable_template_id, position)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_deliverable_requirements FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_submission_id uuid not null unique references public.mission_submissions(id) on delete cascade,
  state text not null check (state in ('accepted', 'fulfillment_pending', 'drafting', 'in_review', 'revision_requested', 'approved_to_publish', 'cancelled', 'expired')),
  accepted_at timestamptz not null,
  deadline timestamptz,
  fulfillment_required boolean not null,
  revision_limit smallint not null check (revision_limit >= 0),
  review_sla_hours integer not null check (review_sla_hours > 0),
  revision_response_hours integer not null check (revision_response_hours > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_workflows FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_work_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_workflow_id uuid not null references public.mission_workflows(id) on delete cascade,
  source_template_id uuid references public.mission_deliverable_templates(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  platform text not null check (btrim(platform) <> ''),
  requirements_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements_snapshot) = 'array'),
  required boolean not null default true,
  position integer not null default 0 check (position >= 0),
  deadline timestamptz,
  state text not null check (state in ('blocked_by_fulfillment', 'drafting', 'submitted', 'under_review', 'revision_requested', 'approved_to_publish', 'cancelled', 'expired')),
  current_submitted_version_id uuid,
  approved_version_id uuid,
  current_reviewer_id uuid references auth.users(id) on delete set null,
  review_started_at timestamptz,
  review_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_workflow_id, position)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_work_items FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_working_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  caption_text text not null default '',
  external_draft_url text,
  checklist_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist_answers) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  last_saved_at timestamptz not null default now(),
  archived_at timestamptz
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_working_drafts FROM PUBLIC, anon, authenticated, service_role;

create unique index mission_working_drafts_one_active_idx
  on public.mission_working_drafts (mission_work_item_id)
  where archived_at is null;
create table public.mission_draft_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  caption_snapshot text not null default '',
  external_draft_url_snapshot text,
  checklist_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist_snapshot) = 'object'),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  content_checksum text not null check (btrim(content_checksum) <> ''),
  unique (mission_work_item_id, version_number),
  unique (mission_work_item_id, content_checksum)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_draft_versions FROM PUBLIC, anon, authenticated, service_role;

alter table public.mission_work_items
  add constraint mission_work_items_current_version_fk
    foreign key (current_submitted_version_id) references public.mission_draft_versions(id),
  add constraint mission_work_items_approved_version_fk
    foreign key (approved_version_id) references public.mission_draft_versions(id);
create table public.mission_draft_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  creator_id uuid not null references public.creators(id) on delete cascade,
  storage_object_path text not null unique check (btrim(storage_object_path) <> ''),
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  checksum text,
  upload_state text not null default 'pending' check (upload_state in ('pending', 'uploaded', 'ready', 'failed', 'deleted')),
  mission_draft_version_id uuid references public.mission_draft_versions(id),
  created_at timestamptz not null default now(),
  retained_at timestamptz,
  deleted_at timestamptz
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_draft_assets FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_review_rounds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  mission_draft_version_id uuid not null references public.mission_draft_versions(id),
  round_number integer not null check (round_number > 0),
  state text not null default 'open' check (state in ('open', 'revision_requested', 'approved_to_publish')),
  reviewer_id uuid references auth.users(id) on delete set null,
  review_started_at timestamptz,
  decision_at timestamptz,
  creator_response_deadline timestamptz,
  created_at timestamptz not null default now(),
  unique (mission_work_item_id, round_number)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_review_rounds FROM PUBLIC, anon, authenticated, service_role;

create unique index mission_review_rounds_one_decision_per_version_idx
  on public.mission_review_rounds (mission_draft_version_id)
  where state <> 'open';
create table public.mission_review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_review_round_id uuid not null references public.mission_review_rounds(id) on delete cascade,
  requirement_id uuid,
  category text not null check (category in ('format', 'key_message', 'compliance', 'quality', 'other')),
  required_change_text text not null check (btrim(required_change_text) <> ''),
  required boolean not null default true,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (mission_review_round_id, position)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_review_items FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_revision_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  granted_by uuid not null references auth.users(id),
  reason text not null check (btrim(reason) <> ''),
  granted_count smallint not null default 1 check (granted_count > 0),
  granted_at timestamptz not null default now()
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_revision_grants FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_fulfillments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_workflow_id uuid not null unique references public.mission_workflows(id) on delete cascade,
  status text not null default 'preparing' check (status in ('preparing', 'shipped', 'received')),
  shipped_by uuid references auth.users(id) on delete set null,
  shipped_at timestamptz,
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz,
  operational_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_fulfillments FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_workflow_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_workflow_id uuid not null references public.mission_workflows(id) on delete cascade,
  mission_work_item_id uuid references public.mission_work_items(id) on delete cascade,
  actor_type text not null check (actor_type in ('creator', 'operator', 'system')),
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (btrim(event_type) <> ''),
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_workflow_events FROM PUBLIC, anon, authenticated, service_role;

-- Foreign-key, ownership, timeline, and queue indexes.
create index mission_templates_workspace_idx on public.mission_deliverable_templates (workspace_id);
create index mission_templates_mission_idx on public.mission_deliverable_templates (mission_id);
create index mission_requirements_workspace_idx on public.mission_deliverable_requirements (workspace_id);
create index mission_requirements_template_idx on public.mission_deliverable_requirements (mission_deliverable_template_id);
create index mission_workflows_workspace_idx on public.mission_workflows (workspace_id);
create index mission_work_items_workspace_idx on public.mission_work_items (workspace_id);
create index mission_work_items_workflow_idx on public.mission_work_items (mission_workflow_id);
create index mission_work_items_queue_idx on public.mission_work_items (state, review_due_at, deadline, review_started_at);
create index mission_working_drafts_workspace_idx on public.mission_working_drafts (workspace_id);
create index mission_versions_workspace_idx on public.mission_draft_versions (workspace_id);
create index mission_versions_work_item_idx on public.mission_draft_versions (mission_work_item_id);
create index mission_assets_workspace_idx on public.mission_draft_assets (workspace_id);
create index mission_assets_work_item_idx on public.mission_draft_assets (mission_work_item_id);
create index mission_assets_creator_idx on public.mission_draft_assets (creator_id);
create index mission_assets_version_idx on public.mission_draft_assets (mission_draft_version_id);
create index mission_reviews_workspace_idx on public.mission_review_rounds (workspace_id);
create index mission_reviews_work_item_idx on public.mission_review_rounds (mission_work_item_id);
create index mission_reviews_version_idx on public.mission_review_rounds (mission_draft_version_id);
create index mission_review_items_workspace_idx on public.mission_review_items (workspace_id);
create index mission_review_items_round_idx on public.mission_review_items (mission_review_round_id);
create index mission_revision_grants_workspace_idx on public.mission_revision_grants (workspace_id);
create index mission_revision_grants_work_item_idx on public.mission_revision_grants (mission_work_item_id);
create index mission_fulfillments_workspace_idx on public.mission_fulfillments (workspace_id);
create index mission_workflow_events_workspace_idx on public.mission_workflow_events (workspace_id);
create index mission_workflow_events_timeline_idx on public.mission_workflow_events (mission_workflow_id, created_at, id);
create index mission_workflow_events_work_item_idx on public.mission_workflow_events (mission_work_item_id);
-- All public tables are RLS protected. Authenticated users receive read-only Data API grants.
alter table public.mission_deliverable_templates enable row level security;
alter table public.mission_deliverable_requirements enable row level security;
alter table public.mission_workflows enable row level security;
alter table public.mission_work_items enable row level security;
alter table public.mission_working_drafts enable row level security;
alter table public.mission_draft_versions enable row level security;
alter table public.mission_draft_assets enable row level security;
alter table public.mission_review_rounds enable row level security;
alter table public.mission_review_items enable row level security;
alter table public.mission_revision_grants enable row level security;
alter table public.mission_fulfillments enable row level security;
alter table public.mission_workflow_events enable row level security;
create policy mission_templates_creator_read on public.mission_deliverable_templates
  for select to authenticated using (exists (
    select 1 from public.mission_submissions s
    where s.mission_id = mission_deliverable_templates.mission_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_requirements_creator_read on public.mission_deliverable_requirements
  for select to authenticated using (exists (
    select 1 from public.mission_deliverable_templates t
    join public.mission_submissions s on s.mission_id = t.mission_id
    where t.id = mission_deliverable_requirements.mission_deliverable_template_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_workflows_creator_read on public.mission_workflows
  for select to authenticated using (exists (
    select 1 from public.mission_submissions s
    where s.id = mission_workflows.mission_submission_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_work_items_creator_read on public.mission_work_items
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = mission_work_items.mission_workflow_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_working_drafts_creator_read on public.mission_working_drafts
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where i.id = mission_working_drafts.mission_work_item_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_versions_creator_read on public.mission_draft_versions
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where i.id = mission_draft_versions.mission_work_item_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_assets_creator_read on public.mission_draft_assets
  for select to authenticated using (creator_id = (select auth.uid()));
create policy mission_reviews_creator_read on public.mission_review_rounds
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where i.id = mission_review_rounds.mission_work_item_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_review_items_creator_read on public.mission_review_items
  for select to authenticated using (exists (
    select 1 from public.mission_review_rounds r
    join public.mission_work_items i on i.id = r.mission_work_item_id
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where r.id = mission_review_items.mission_review_round_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_revision_grants_creator_read on public.mission_revision_grants
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w on w.id = i.mission_workflow_id
    join public.mission_submissions s on s.id = w.mission_submission_id
    where i.id = mission_revision_grants.mission_work_item_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_fulfillments_creator_read on public.mission_fulfillments
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = mission_fulfillments.mission_workflow_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_events_creator_read on public.mission_workflow_events
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = mission_workflow_events.mission_workflow_id
      and s.creator_id = (select auth.uid())
  ));
grant all on
  public.mission_deliverable_templates,
  public.mission_deliverable_requirements,
  public.mission_workflows,
  public.mission_work_items,
  public.mission_working_drafts,
  public.mission_draft_versions,
  public.mission_draft_assets,
  public.mission_review_rounds,
  public.mission_review_items,
  public.mission_revision_grants,
  public.mission_fulfillments,
  public.mission_workflow_events
to service_role;
grant select on
  public.mission_deliverable_templates,
  public.mission_deliverable_requirements,
  public.mission_workflows,
  public.mission_work_items,
  public.mission_working_drafts,
  public.mission_draft_versions,
  public.mission_draft_assets,
  public.mission_review_rounds,
  public.mission_review_items,
  public.mission_revision_grants,
  public.mission_fulfillments,
  public.mission_workflow_events
to authenticated;
-- Privileged implementations live outside exposed schemas and repeat identity checks.
create or replace function private.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_state text;
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s on s.id = w.mission_submission_id
  where w.id = p_workflow
    and (v_service or s.creator_id = v_actor)
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  if exists (
    select 1 from public.mission_fulfillments f
    where f.mission_workflow_id = v_workflow.id and f.status <> 'received'
  ) then
    v_state := 'fulfillment_pending';
  elsif not exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.required and i.state <> 'approved_to_publish'
  ) then
    v_state := 'approved_to_publish';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id and i.state = 'revision_requested'
  ) then
    v_state := 'revision_requested';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id and i.state in ('submitted', 'under_review')
  ) then
    v_state := 'in_review';
  else
    v_state := 'drafting';
  end if;

  update public.mission_workflows
  set state = v_state, updated_at = now()
  where id = v_workflow.id
  returning * into v_workflow;
  return v_workflow;
end;
$$;
create or replace function private.create_mission_workflow(p_submission uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_submission public.mission_submissions;
  v_mission public.missions;
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_template record;
  v_required_count integer;
  v_initial_item_state text;
  v_accepted_at timestamptz := now();
begin
  if v_creator is null and not v_service then raise exception 'not_authenticated'; end if;

  select * into v_submission
  from public.mission_submissions
  where id = p_submission
    and (v_service or creator_id = v_creator)
  for update;
  if v_submission.id is null then raise exception 'not_found'; end if;

  select * into v_workflow
  from public.mission_workflows
  where mission_submission_id = v_submission.id;
  if v_workflow.id is not null then
    return private.refresh_mission_workflow_state(v_workflow.id);
  end if;

  if v_submission.status <> 'joined' then raise exception 'wrong_state'; end if;
  select * into v_mission from public.missions where id = v_submission.mission_id;
  if v_mission.creator_workflow_mode <> 'active_workspace' then raise exception 'legacy_mission'; end if;
  if v_mission.workspace_id <> v_submission.workspace_id then raise exception 'workspace_mismatch'; end if;

  select count(*) into v_required_count
  from public.mission_deliverable_templates
  where mission_id = v_mission.id and required;
  if v_required_count = 0 then raise exception 'required_deliverable_missing'; end if;

  insert into public.mission_workflows (
    workspace_id, mission_submission_id, state, accepted_at, deadline,
    fulfillment_required, revision_limit, review_sla_hours, revision_response_hours
  ) values (
    v_submission.workspace_id, v_submission.id, 'accepted', v_accepted_at,
    v_mission.deadline::timestamptz, v_mission.fulfillment_required,
    v_mission.revision_limit, v_mission.review_sla_hours, v_mission.revision_response_hours
  )
  on conflict (mission_submission_id) do nothing
  returning * into v_workflow;

  if v_workflow.id is null then
    select * into v_workflow from public.mission_workflows
    where mission_submission_id = v_submission.id;
    return private.refresh_mission_workflow_state(v_workflow.id);
  end if;

  v_initial_item_state := case
    when v_workflow.fulfillment_required then 'blocked_by_fulfillment'
    else 'drafting'
  end;

  for v_template in
    select
      t.*,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id,
          'category', r.category,
          'text', r.requirement_text,
          'required', r.required,
          'position', r.position
        ) order by r.position, r.id)
        from public.mission_deliverable_requirements r
        where r.mission_deliverable_template_id = t.id
      ), '[]'::jsonb) as requirement_snapshot
    from public.mission_deliverable_templates t
    where t.mission_id = v_mission.id
    order by t.position, t.id
  loop
    insert into public.mission_work_items (
      workspace_id, mission_workflow_id, source_template_id, title, platform,
      requirements_snapshot, required, position, deadline, state
    ) values (
      v_submission.workspace_id, v_workflow.id, v_template.id, v_template.title,
      v_template.platform, v_template.requirement_snapshot, v_template.required,
      v_template.position,
      case when v_template.draft_due_offset_hours is null then v_workflow.deadline
           else least(
             v_accepted_at + make_interval(hours => v_template.draft_due_offset_hours),
             coalesce(v_workflow.deadline, 'infinity'::timestamptz)
           ) end,
      v_initial_item_state
    ) returning * into v_item;

    insert into public.mission_working_drafts (workspace_id, mission_work_item_id)
    values (v_submission.workspace_id, v_item.id);
  end loop;

  if v_workflow.fulfillment_required then
    insert into public.mission_fulfillments (workspace_id, mission_workflow_id, status)
    values (v_submission.workspace_id, v_workflow.id, 'preparing');
  end if;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, actor_type, actor_id, event_type,
    entity_type, entity_id, metadata
  ) values (
    v_submission.workspace_id, v_workflow.id,
    case when v_creator is null then 'system' else 'creator' end,
    v_creator, 'workflow_created', 'mission_workflow', v_workflow.id,
    jsonb_build_object('fulfillment_required', v_workflow.fulfillment_required)
  );

  return private.refresh_mission_workflow_state(v_workflow.id);
end;
$$;
-- Narrow public names authorize before entering private privileged code.
create or replace function public.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = p_workflow and s.creator_id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.refresh_mission_workflow_state(p_workflow);
end;
$$;
create or replace function public.create_mission_workflow(p_submission uuid)
returns public.mission_workflows
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_submissions s
    where s.id = p_submission and s.creator_id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.create_mission_workflow(p_submission);
end;
$$;
revoke all on function private.refresh_mission_workflow_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_mission_workflow_state(uuid) from public, anon;
revoke all on function public.create_mission_workflow(uuid) from public, anon;
revoke usage on schema private from public, anon, authenticated;
grant execute on function public.refresh_mission_workflow_state(uuid) to authenticated, service_role;
grant execute on function public.create_mission_workflow(uuid) to authenticated, service_role;
-- Immutable records and finalized assets cannot be rewritten in place.
create or replace function private.raise_immutable_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_record';
end;
$$;
create or replace function private.guard_completed_review_round()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state <> 'open' then raise exception 'immutable_record'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create or replace function private.guard_finalized_mission_asset()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.mission_draft_version_id is not null or old.upload_state = 'ready' then
    if tg_op = 'DELETE' then raise exception 'immutable_record'; end if;
    if (to_jsonb(new) - array['retained_at', 'deleted_at'])
       is distinct from
       (to_jsonb(old) - array['retained_at', 'deleted_at']) then
      raise exception 'immutable_record';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger mission_draft_versions_immutable
  before update or delete on public.mission_draft_versions
  for each row execute function private.raise_immutable_record();
create trigger mission_completed_reviews_immutable
  before update or delete on public.mission_review_rounds
  for each row execute function private.guard_completed_review_round();
create trigger mission_revision_grants_immutable
  before update or delete on public.mission_revision_grants
  for each row execute function private.raise_immutable_record();
create trigger mission_workflow_events_immutable
  before update or delete on public.mission_workflow_events
  for each row execute function private.raise_immutable_record();
create trigger mission_finalized_assets_guard
  before update or delete on public.mission_draft_assets
  for each row execute function private.guard_finalized_mission_asset();
revoke all on function private.raise_immutable_record() from public, anon, authenticated, service_role;
revoke all on function private.guard_completed_review_round() from public, anon, authenticated, service_role;
revoke all on function private.guard_finalized_mission_asset() from public, anon, authenticated, service_role;
-- Storage remains private; object access is tied to an owned asset row.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mission-draft-assets',
  'mission-draft-assets',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy mission_draft_assets_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name and a.creator_id = (select auth.uid())
    )
  );
create policy mission_draft_assets_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and a.creator_id = (select auth.uid())
        and a.upload_state = 'pending'
    )
  );
create policy mission_draft_assets_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and a.creator_id = (select auth.uid())
        and a.upload_state in ('pending', 'uploaded')
    )
  )
  with check (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and a.creator_id = (select auth.uid())
        and a.upload_state in ('pending', 'uploaded')
    )
  );
create policy mission_draft_assets_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'mission-draft-assets'
    and exists (
      select 1 from public.mission_draft_assets a
      where a.storage_object_path = name
        and a.creator_id = (select auth.uid())
        and a.mission_draft_version_id is null
    )
  );
alter table public.missions
  add constraint missions_id_workspace_unique unique (id, workspace_id);
alter table public.mission_submissions
  add constraint mission_submissions_id_workspace_unique unique (id, workspace_id);
-- Review hardening: tenant-consistent version links and wrapper-only execution.
alter table public.mission_work_items
  add constraint mission_work_items_id_workspace_unique unique (id, workspace_id);
alter table public.mission_draft_versions
  drop constraint mission_draft_versions_mission_work_item_id_fkey,
  add constraint mission_draft_versions_id_item_workspace_unique
    unique (id, mission_work_item_id, workspace_id),
  add constraint mission_draft_versions_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade;
alter table public.mission_work_items
  drop constraint mission_work_items_current_version_fk,
  drop constraint mission_work_items_approved_version_fk,
  add constraint mission_work_items_current_version_fk
    foreign key (current_submitted_version_id, id, workspace_id)
    references public.mission_draft_versions(id, mission_work_item_id, workspace_id),
  add constraint mission_work_items_approved_version_fk
    foreign key (approved_version_id, id, workspace_id)
    references public.mission_draft_versions(id, mission_work_item_id, workspace_id);
alter table public.mission_draft_assets
  drop constraint mission_draft_assets_mission_work_item_id_fkey,
  drop constraint mission_draft_assets_mission_draft_version_id_fkey,
  add constraint mission_draft_assets_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade,
  add constraint mission_draft_assets_version_item_workspace_fk
    foreign key (mission_draft_version_id, mission_work_item_id, workspace_id)
    references public.mission_draft_versions(id, mission_work_item_id, workspace_id);
alter table public.mission_review_rounds
  drop constraint mission_review_rounds_mission_work_item_id_fkey,
  drop constraint mission_review_rounds_mission_draft_version_id_fkey,
  add constraint mission_review_rounds_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade,
  add constraint mission_review_rounds_version_item_workspace_fk
    foreign key (mission_draft_version_id, mission_work_item_id, workspace_id)
    references public.mission_draft_versions(id, mission_work_item_id, workspace_id);
-- Terminal workflows never re-enter an active state.
create or replace function private.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_state text;
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s on s.id = w.mission_submission_id
  where w.id = p_workflow
    and (v_service or s.creator_id = v_actor)
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if v_workflow.state in ('cancelled', 'expired') then return v_workflow; end if;

  if exists (
    select 1 from public.mission_fulfillments f
    where f.mission_workflow_id = v_workflow.id and f.status <> 'received'
  ) then
    v_state := 'fulfillment_pending';
  elsif not exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.required and i.state <> 'approved_to_publish'
  ) then
    v_state := 'approved_to_publish';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id and i.state = 'revision_requested'
  ) then
    v_state := 'revision_requested';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id and i.state in ('submitted', 'under_review')
  ) then
    v_state := 'in_review';
  else
    v_state := 'drafting';
  end if;

  update public.mission_workflows
  set state = v_state, updated_at = now()
  where id = v_workflow.id
  returning * into v_workflow;
  return v_workflow;
end;
$$;
-- Public wrappers are the only authenticated entry points.
create or replace function public.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s on s.id = w.mission_submission_id
    where w.id = p_workflow and s.creator_id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.refresh_mission_workflow_state(p_workflow);
end;
$$;
create or replace function public.create_mission_workflow(p_submission uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_submissions s
    where s.id = p_submission and s.creator_id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.create_mission_workflow(p_submission);
end;
$$;
revoke all on function private.refresh_mission_workflow_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role;
revoke usage on schema private from public, anon, authenticated;
revoke all on function public.refresh_mission_workflow_state(uuid) from public, anon;
revoke all on function public.create_mission_workflow(uuid) from public, anon;
grant execute on function public.refresh_mission_workflow_state(uuid) to authenticated, service_role;
grant execute on function public.create_mission_workflow(uuid) to authenticated, service_role;
-- Fail the migration if RLS, Data API grants, or RPC privileges drift.
do $$
declare
  v_table regclass;
  v_index text;
begin
  foreach v_table in array array[
    'public.mission_deliverable_templates'::regclass,
    'public.mission_deliverable_requirements'::regclass,
    'public.mission_workflows'::regclass,
    'public.mission_work_items'::regclass,
    'public.mission_working_drafts'::regclass,
    'public.mission_draft_versions'::regclass,
    'public.mission_draft_assets'::regclass,
    'public.mission_review_rounds'::regclass,
    'public.mission_review_items'::regclass,
    'public.mission_revision_grants'::regclass,
    'public.mission_fulfillments'::regclass,
    'public.mission_workflow_events'::regclass
  ] loop
    if not (select relrowsecurity from pg_class where oid = v_table) then
      raise exception 'rls_required:%', v_table;
    end if;
    if not has_table_privilege('authenticated', v_table, 'SELECT')
       or has_table_privilege('authenticated', v_table, 'INSERT')
       or has_table_privilege('authenticated', v_table, 'UPDATE')
       or has_table_privilege('authenticated', v_table, 'DELETE') then
      raise exception 'authenticated_grant_drift:%', v_table;
    end if;
    if not has_table_privilege('service_role', v_table, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'service_role_grant_missing:%', v_table;
    end if;
    if not exists (select 1 from pg_policy where polrelid = v_table) then
      raise exception 'creator_read_policy_required:%', v_table;
    end if;
  end loop;

  if has_function_privilege('authenticated', 'private.create_mission_workflow(uuid)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'private.refresh_mission_workflow_state(uuid)'::regprocedure, 'EXECUTE')
     or has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'private_rpc_exposed';
  end if;
  if not has_function_privilege('authenticated', 'public.create_mission_workflow(uuid)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.refresh_mission_workflow_state(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'public_rpc_grant_missing';
  end if;

  foreach v_index in array array[
    'mission_templates_mission_idx',
    'mission_requirements_template_idx',
    'mission_workflows_mission_submission_id_key',
    'mission_work_items_workflow_idx',
    'mission_versions_work_item_idx',
    'mission_assets_creator_idx',
    'mission_reviews_work_item_idx',
    'mission_review_items_round_idx',
    'mission_revision_grants_work_item_idx',
    'mission_fulfillments_mission_workflow_id_key',
    'mission_workflow_events_timeline_idx'
  ] loop
    if to_regclass('public.' || v_index) is null then
      raise exception 'ownership_index_required:%', v_index;
    end if;
  end loop;
end;
$$;
-- Independent-review hardening: tenant identity is part of every relationship,
-- future private routines default closed, and draft assets use one canonical key.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;
alter table public.creators
  add constraint creators_id_workspace_unique unique (id, workspace_id);
alter table public.mission_deliverable_templates
  add constraint mission_templates_id_workspace_unique unique (id, workspace_id);
alter table public.mission_workflows
  add constraint mission_workflows_id_workspace_unique unique (id, workspace_id);
alter table public.mission_work_items
  add constraint mission_work_items_id_workflow_workspace_unique unique (id, mission_workflow_id, workspace_id);
alter table public.mission_review_rounds
  add constraint mission_review_rounds_id_workspace_unique unique (id, workspace_id);
alter table public.mission_submissions
  add constraint mission_submissions_mission_workspace_fk
    foreign key (mission_id, workspace_id)
    references public.missions(id, workspace_id) on delete cascade,
  add constraint mission_submissions_creator_workspace_fk
    foreign key (creator_id, workspace_id)
    references public.creators(id, workspace_id) on delete cascade;
alter table public.mission_deliverable_templates
  add constraint mission_templates_mission_workspace_fk
    foreign key (mission_id, workspace_id)
    references public.missions(id, workspace_id) on delete cascade;
alter table public.mission_deliverable_requirements
  add constraint mission_requirements_template_workspace_fk
    foreign key (mission_deliverable_template_id, workspace_id)
    references public.mission_deliverable_templates(id, workspace_id) on delete cascade;
alter table public.mission_workflows
  add constraint mission_workflows_submission_workspace_fk
    foreign key (mission_submission_id, workspace_id)
    references public.mission_submissions(id, workspace_id) on delete cascade;
alter table public.mission_work_items
  add constraint mission_work_items_workflow_workspace_fk
    foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id) on delete cascade,
  add constraint mission_work_items_template_workspace_fk
    foreign key (source_template_id, workspace_id)
    references public.mission_deliverable_templates(id, workspace_id) on delete set null;
alter table public.mission_working_drafts
  add constraint mission_working_drafts_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade;
alter table public.mission_review_items
  add constraint mission_review_items_round_workspace_fk
    foreign key (mission_review_round_id, workspace_id)
    references public.mission_review_rounds(id, workspace_id) on delete cascade;
alter table public.mission_revision_grants
  add constraint mission_revision_grants_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade;
alter table public.mission_fulfillments
  add constraint mission_fulfillments_workflow_workspace_fk
    foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id) on delete cascade;
alter table public.mission_workflow_events
  add constraint mission_events_workflow_workspace_fk
    foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id) on delete cascade,
  add constraint mission_events_item_workflow_workspace_fk
    foreign key (mission_work_item_id, mission_workflow_id, workspace_id)
    references public.mission_work_items(id, mission_workflow_id, workspace_id) on delete cascade;
alter table public.mission_draft_assets
  add column mission_workflow_id uuid not null,
  add column file_extension text not null,
  add constraint mission_draft_assets_extension_check
    check (file_extension in ('jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm')),
  add constraint mission_draft_assets_mime_extension_check check (
    (mime_type = 'image/jpeg' and file_extension in ('jpg', 'jpeg')) or
    (mime_type = 'image/png' and file_extension = 'png') or
    (mime_type = 'image/webp' and file_extension = 'webp') or
    (mime_type = 'image/gif' and file_extension = 'gif') or
    (mime_type = 'video/mp4' and file_extension = 'mp4') or
    (mime_type = 'video/quicktime' and file_extension = 'mov') or
    (mime_type = 'video/webm' and file_extension = 'webm')
  ),
  add constraint mission_draft_assets_canonical_path_check check (
    storage_object_path = creator_id::text || '/' || mission_workflow_id::text || '/' || mission_work_item_id::text || '/' || id::text || '.' || file_extension
  ),
  add constraint mission_draft_assets_creator_workspace_fk
    foreign key (creator_id, workspace_id)
    references public.creators(id, workspace_id) on delete cascade,
  add constraint mission_draft_assets_workflow_workspace_fk
    foreign key (mission_workflow_id, workspace_id)
    references public.mission_workflows(id, workspace_id) on delete cascade,
  add constraint mission_draft_assets_item_workflow_workspace_fk
    foreign key (mission_work_item_id, mission_workflow_id, workspace_id)
    references public.mission_work_items(id, mission_workflow_id, workspace_id) on delete cascade;
create index mission_assets_workflow_workspace_idx
  on public.mission_draft_assets (mission_workflow_id, workspace_id);
drop policy mission_templates_creator_read on public.mission_deliverable_templates;
create policy mission_templates_creator_read on public.mission_deliverable_templates
  for select to authenticated using (exists (
    select 1 from public.mission_submissions s
    where s.mission_id = mission_deliverable_templates.mission_id
      and s.workspace_id = mission_deliverable_templates.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_requirements_creator_read on public.mission_deliverable_requirements;
create policy mission_requirements_creator_read on public.mission_deliverable_requirements
  for select to authenticated using (exists (
    select 1 from public.mission_deliverable_templates t
    join public.mission_submissions s
      on s.mission_id = t.mission_id and s.workspace_id = t.workspace_id
    where t.id = mission_deliverable_requirements.mission_deliverable_template_id
      and t.workspace_id = mission_deliverable_requirements.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_workflows_creator_read on public.mission_workflows;
create policy mission_workflows_creator_read on public.mission_workflows
  for select to authenticated using (exists (
    select 1 from public.mission_submissions s
    where s.id = mission_workflows.mission_submission_id
      and s.workspace_id = mission_workflows.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_work_items_creator_read on public.mission_work_items;
create policy mission_work_items_creator_read on public.mission_work_items
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where w.id = mission_work_items.mission_workflow_id
      and w.workspace_id = mission_work_items.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_working_drafts_creator_read on public.mission_working_drafts;
create policy mission_working_drafts_creator_read on public.mission_working_drafts
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_working_drafts.mission_work_item_id
      and i.workspace_id = mission_working_drafts.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_versions_creator_read on public.mission_draft_versions;
create policy mission_versions_creator_read on public.mission_draft_versions
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_draft_versions.mission_work_item_id
      and i.workspace_id = mission_draft_versions.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_assets_creator_read on public.mission_draft_assets;
create policy mission_assets_creator_read on public.mission_draft_assets
  for select to authenticated using (exists (
    select 1 from public.creators c
    join public.mission_work_items i
      on i.id = mission_draft_assets.mission_work_item_id
      and i.mission_workflow_id = mission_draft_assets.mission_workflow_id
      and i.workspace_id = mission_draft_assets.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where c.id = mission_draft_assets.creator_id
      and c.workspace_id = mission_draft_assets.workspace_id
      and s.creator_id = c.id
      and c.id = (select auth.uid())
  ));
drop policy mission_reviews_creator_read on public.mission_review_rounds;
create policy mission_reviews_creator_read on public.mission_review_rounds
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_review_rounds.mission_work_item_id
      and i.workspace_id = mission_review_rounds.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_review_items_creator_read on public.mission_review_items;
create policy mission_review_items_creator_read on public.mission_review_items
  for select to authenticated using (exists (
    select 1 from public.mission_review_rounds r
    join public.mission_work_items i
      on i.id = r.mission_work_item_id and i.workspace_id = r.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where r.id = mission_review_items.mission_review_round_id
      and r.workspace_id = mission_review_items.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_revision_grants_creator_read on public.mission_revision_grants;
create policy mission_revision_grants_creator_read on public.mission_revision_grants
  for select to authenticated using (exists (
    select 1 from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_revision_grants.mission_work_item_id
      and i.workspace_id = mission_revision_grants.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_fulfillments_creator_read on public.mission_fulfillments;
create policy mission_fulfillments_creator_read on public.mission_fulfillments
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where w.id = mission_fulfillments.mission_workflow_id
      and w.workspace_id = mission_fulfillments.workspace_id
      and s.creator_id = (select auth.uid())
  ));
drop policy mission_events_creator_read on public.mission_workflow_events;
create policy mission_events_creator_read on public.mission_workflow_events
  for select to authenticated using (exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where w.id = mission_workflow_events.mission_workflow_id
      and w.workspace_id = mission_workflow_events.workspace_id
      and s.creator_id = (select auth.uid())
  ));
create or replace function private.guard_mission_draft_asset_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = new.mission_work_item_id
      and i.mission_workflow_id = new.mission_workflow_id
      and i.workspace_id = new.workspace_id
      and s.creator_id = new.creator_id
      and s.workspace_id = new.workspace_id
  ) then
    raise exception 'mission_draft_asset_owner_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;
create constraint trigger mission_draft_assets_owner_guard
  after insert or update on public.mission_draft_assets
  deferrable initially immediate
  for each row execute function private.guard_mission_draft_asset_owner();
drop policy mission_draft_assets_storage_read on storage.objects;
drop policy mission_draft_assets_storage_insert on storage.objects;
drop policy mission_draft_assets_storage_update on storage.objects;
drop policy mission_draft_assets_storage_delete on storage.objects;
create policy mission_draft_assets_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      join public.mission_work_items i
        on i.id = a.mission_work_item_id and i.mission_workflow_id = a.mission_workflow_id and i.workspace_id = a.workspace_id
      join public.mission_workflows w
        on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
      join public.mission_submissions s
        on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and s.creator_id = a.creator_id
        and s.workspace_id = a.workspace_id
        and a.creator_id = (select auth.uid())
    )
  );
create policy mission_draft_assets_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      join public.mission_work_items i
        on i.id = a.mission_work_item_id and i.mission_workflow_id = a.mission_workflow_id and i.workspace_id = a.workspace_id
      join public.mission_workflows w
        on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
      join public.mission_submissions s
        on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and s.creator_id = a.creator_id
        and s.workspace_id = a.workspace_id
        and a.creator_id = (select auth.uid()) and a.upload_state = 'pending'
    )
  );
create policy mission_draft_assets_storage_update on storage.objects
  for update to authenticated using (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      join public.mission_work_items i
        on i.id = a.mission_work_item_id and i.mission_workflow_id = a.mission_workflow_id and i.workspace_id = a.workspace_id
      join public.mission_workflows w
        on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
      join public.mission_submissions s
        on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and s.creator_id = a.creator_id
        and s.workspace_id = a.workspace_id
        and a.creator_id = (select auth.uid()) and a.upload_state in ('pending', 'uploaded')
    )
  ) with check (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      join public.mission_work_items i
        on i.id = a.mission_work_item_id and i.mission_workflow_id = a.mission_workflow_id and i.workspace_id = a.workspace_id
      join public.mission_workflows w
        on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
      join public.mission_submissions s
        on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and s.creator_id = a.creator_id
        and s.workspace_id = a.workspace_id
        and a.creator_id = (select auth.uid()) and a.upload_state in ('pending', 'uploaded')
    )
  );
create policy mission_draft_assets_storage_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'mission-draft-assets' and exists (
      select 1 from public.mission_draft_assets a
      join public.mission_work_items i
        on i.id = a.mission_work_item_id and i.mission_workflow_id = a.mission_workflow_id and i.workspace_id = a.workspace_id
      join public.mission_workflows w
        on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
      join public.mission_submissions s
        on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
      where a.storage_object_path = name
        and name = a.creator_id::text || '/' || a.mission_workflow_id::text || '/' || a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension
        and s.creator_id = a.creator_id
        and s.workspace_id = a.workspace_id
        and a.creator_id = (select auth.uid()) and a.mission_draft_version_id is null
    )
  );
create or replace function private.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_state text;
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where w.id = p_workflow
    and (v_service or exists (
      select 1 from public.creators c
      where c.id = v_actor and c.id = s.creator_id and c.workspace_id = w.workspace_id
    ))
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if v_workflow.state in ('cancelled', 'expired') then return v_workflow; end if;

  if exists (
    select 1 from public.mission_fulfillments f
    where f.mission_workflow_id = v_workflow.id
      and f.workspace_id = v_workflow.workspace_id
      and f.status <> 'received'
  ) then
    v_state := 'fulfillment_pending';
  elsif not exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.workspace_id = v_workflow.workspace_id
      and i.required and i.state <> 'approved_to_publish'
  ) then
    v_state := 'approved_to_publish';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.workspace_id = v_workflow.workspace_id
      and i.state = 'revision_requested'
  ) then
    v_state := 'revision_requested';
  elsif exists (
    select 1 from public.mission_work_items i
    where i.mission_workflow_id = v_workflow.id
      and i.workspace_id = v_workflow.workspace_id
      and i.state in ('submitted', 'under_review')
  ) then
    v_state := 'in_review';
  else
    v_state := 'drafting';
  end if;

  update public.mission_workflows
  set state = v_state, updated_at = now()
  where id = v_workflow.id and workspace_id = v_workflow.workspace_id
  returning * into v_workflow;
  return v_workflow;
end;
$$;
create or replace function private.create_mission_workflow(p_submission uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_submission public.mission_submissions;
  v_mission public.missions;
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_template record;
  v_required_count integer;
  v_initial_item_state text;
  v_accepted_at timestamptz := now();
begin
  if v_creator is null and not v_service then raise exception 'not_authenticated'; end if;

  select s.* into v_submission
  from public.mission_submissions s
  where s.id = p_submission
    and (v_service or exists (
      select 1 from public.creators c
      where c.id = v_creator and c.id = s.creator_id and c.workspace_id = s.workspace_id
    ))
  for update;
  if v_submission.id is null then raise exception 'not_found'; end if;

  select * into v_workflow
  from public.mission_workflows
  where mission_submission_id = v_submission.id
    and workspace_id = v_submission.workspace_id;
  if v_workflow.id is not null then
    return private.refresh_mission_workflow_state(v_workflow.id);
  end if;

  if v_submission.status <> 'joined' then raise exception 'wrong_state'; end if;
  select * into v_mission from public.missions
  where id = v_submission.mission_id and workspace_id = v_submission.workspace_id;
  if v_mission.id is null then raise exception 'workspace_mismatch'; end if;
  if v_mission.creator_workflow_mode <> 'active_workspace' then raise exception 'legacy_mission'; end if;

  select count(*) into v_required_count
  from public.mission_deliverable_templates
  where mission_id = v_mission.id and workspace_id = v_mission.workspace_id and required;
  if v_required_count = 0 then raise exception 'required_deliverable_missing'; end if;

  insert into public.mission_workflows (
    workspace_id, mission_submission_id, state, accepted_at, deadline,
    fulfillment_required, revision_limit, review_sla_hours, revision_response_hours
  ) values (
    v_submission.workspace_id, v_submission.id, 'accepted', v_accepted_at,
    v_mission.deadline::timestamptz, v_mission.fulfillment_required,
    v_mission.revision_limit, v_mission.review_sla_hours, v_mission.revision_response_hours
  )
  on conflict (mission_submission_id) do nothing
  returning * into v_workflow;

  if v_workflow.id is null then
    select * into v_workflow from public.mission_workflows
    where mission_submission_id = v_submission.id and workspace_id = v_submission.workspace_id;
    return private.refresh_mission_workflow_state(v_workflow.id);
  end if;

  v_initial_item_state := case when v_workflow.fulfillment_required
    then 'blocked_by_fulfillment' else 'drafting' end;

  for v_template in
    select t.*, coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'category', r.category, 'text', r.requirement_text,
        'required', r.required, 'position', r.position
      ) order by r.position, r.id)
      from public.mission_deliverable_requirements r
      where r.mission_deliverable_template_id = t.id and r.workspace_id = t.workspace_id
    ), '[]'::jsonb) as requirement_snapshot
    from public.mission_deliverable_templates t
    where t.mission_id = v_mission.id and t.workspace_id = v_mission.workspace_id
    order by t.position, t.id
  loop
    insert into public.mission_work_items (
      workspace_id, mission_workflow_id, source_template_id, title, platform,
      requirements_snapshot, required, position, deadline, state
    ) values (
      v_submission.workspace_id, v_workflow.id, v_template.id, v_template.title,
      v_template.platform, v_template.requirement_snapshot, v_template.required,
      v_template.position,
      case when v_template.draft_due_offset_hours is null then v_workflow.deadline
           else least(
             v_accepted_at + make_interval(hours => v_template.draft_due_offset_hours),
             coalesce(v_workflow.deadline, 'infinity'::timestamptz)
           ) end,
      v_initial_item_state
    ) returning * into v_item;
    insert into public.mission_working_drafts (workspace_id, mission_work_item_id)
    values (v_submission.workspace_id, v_item.id);
  end loop;

  if v_workflow.fulfillment_required then
    insert into public.mission_fulfillments (workspace_id, mission_workflow_id, status)
    values (v_submission.workspace_id, v_workflow.id, 'preparing');
  end if;
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, actor_type, actor_id, event_type,
    entity_type, entity_id, metadata
  ) values (
    v_submission.workspace_id, v_workflow.id,
    case when v_creator is null then 'system' else 'creator' end,
    v_creator, 'workflow_created', 'mission_workflow', v_workflow.id,
    jsonb_build_object('fulfillment_required', v_workflow.fulfillment_required)
  );
  return private.refresh_mission_workflow_state(v_workflow.id);
end;
$$;
create or replace function public.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_workflows w
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    join public.creators c
      on c.id = s.creator_id and c.workspace_id = s.workspace_id
    where w.id = p_workflow and c.id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.refresh_mission_workflow_state(p_workflow);
end;
$$;
create or replace function public.create_mission_workflow(p_submission uuid)
returns public.mission_workflows language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
begin
  if not v_service and not exists (
    select 1 from public.mission_submissions s
    join public.creators c on c.id = s.creator_id and c.workspace_id = s.workspace_id
    where s.id = p_submission and c.id = v_actor
  ) then raise exception 'not_found'; end if;
  return private.create_mission_workflow(p_submission);
end;
$$;
revoke all on function private.refresh_mission_workflow_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role;
revoke all on function private.raise_immutable_record() from public, anon, authenticated, service_role;
revoke all on function private.guard_completed_review_round() from public, anon, authenticated, service_role;
revoke all on function private.guard_finalized_mission_asset() from public, anon, authenticated, service_role;
revoke all on function private.guard_mission_draft_asset_owner() from public, anon, authenticated, service_role;
revoke usage on schema private from public, anon, authenticated;
revoke all on function public.refresh_mission_workflow_state(uuid) from public, anon;
revoke all on function public.create_mission_workflow(uuid) from public, anon;
grant execute on function public.refresh_mission_workflow_state(uuid) to authenticated, service_role;
grant execute on function public.create_mission_workflow(uuid) to authenticated, service_role;
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'refresh_mission_workflow_state',
        'create_mission_workflow',
        'raise_immutable_record',
        'guard_completed_review_round',
        'guard_finalized_mission_asset',
        'guard_mission_draft_asset_owner'
      )
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE') or
        has_function_privilege('authenticated', p.oid, 'EXECUTE') or
        has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
  ) then raise exception 'private_function_execute_exposed'; end if;
end;
$$;
-- Preserve the original nullable source-template behavior without allowing a
-- composite SET NULL action to clear the non-null workspace_id column.
alter table public.mission_work_items
  drop constraint mission_work_items_template_workspace_fk,
  add constraint mission_work_items_template_workspace_fk
    foreign key (source_template_id, workspace_id)
    references public.mission_deliverable_templates(id, workspace_id);

-- SOURCE: derived-sql/20260717190420-receive_mission_fulfillment.sql; sha256=3c24478dee08b4b7de09974607575c55fd590a4a97e0de956c787ebdae8e44a6
-- Atomically acknowledge creator receipt, unblock drafting, append the audit event,
-- and refresh the workflow state. The server calls only the public service-role wrapper.

create or replace function private.receive_mission_fulfillment(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid
)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_fulfillment public.mission_fulfillments;
begin
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id
   and s.workspace_id = w.workspace_id
  where s.id = p_submission
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
    and w.workspace_id = p_workspace
  for update of w;

  if v_workflow.id is null then
    raise exception 'not_found';
  end if;

  select f.* into v_fulfillment
  from public.mission_fulfillments f
  where f.mission_workflow_id = v_workflow.id
    and f.workspace_id = p_workspace
  for update;

  if v_fulfillment.id is null or v_fulfillment.status <> 'shipped' then
    raise exception 'wrong_state';
  end if;

  update public.mission_fulfillments
  set status = 'received',
      received_by = p_creator,
      received_at = now(),
      updated_at = now()
  where id = v_fulfillment.id
    and mission_workflow_id = v_workflow.id
    and workspace_id = p_workspace;

  update public.mission_work_items
  set state = 'drafting',
      updated_at = now()
  where mission_workflow_id = v_workflow.id
    and workspace_id = p_workspace
    and state = 'blocked_by_fulfillment';

  insert into public.mission_workflow_events (
    workspace_id,
    mission_workflow_id,
    actor_type,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace,
    v_workflow.id,
    'creator',
    p_creator,
    'fulfillment_received',
    'mission_fulfillment',
    v_fulfillment.id,
    '{}'::jsonb
  );

  return private.refresh_mission_workflow_state(v_workflow.id);
end;
$$;
create or replace function public.receive_mission_fulfillment(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid
)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_found';
  end if;

  if not exists (
    select 1
    from public.mission_submissions s
    where s.id = p_submission
      and s.creator_id = p_creator
      and s.workspace_id = p_workspace
  ) then
    raise exception 'not_found';
  end if;

  return private.receive_mission_fulfillment(p_submission, p_creator, p_workspace);
end;
$$;
revoke all on function private.receive_mission_fulfillment(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.receive_mission_fulfillment(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.receive_mission_fulfillment(uuid, uuid, uuid) to service_role;

-- SOURCE: derived-sql/20260718134500-active_mission_operator_lifecycle.sql; sha256=73ad6f9c16bea88cb35c7854e0e14f637a1945e368e53d0fcfb21678c3585fd3
-- Atomic, tenant-scoped operator transitions for the Phase 2 active-mission workspace.
-- The existing mission_submissions row remains reward-neutral throughout these operations.

create or replace function private.assert_active_mission_operator(p_operator uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_operator is null or not exists (
    select 1 from public.staff_users su where su.user_id = p_operator and su.active
  ) then
    raise exception 'not_authorized';
  end if;
end;
$$;
create or replace function private.start_mission_review(
  p_workflow uuid,
  p_work_item uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
begin
  perform private.assert_active_mission_operator(p_operator);

  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
    and w.workspace_id = p_workspace
  for update of i, w;

  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state then raise exception 'stale'; end if;
  if v_item.state <> 'submitted' or v_item.current_submitted_version_id is null then
    raise exception 'wrong_state';
  end if;

  update public.mission_work_items
  set state = 'under_review',
      current_reviewer_id = p_operator,
      review_started_at = now(),
      updated_at = now()
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;

  update public.mission_review_rounds
  set reviewer_id = p_operator,
      review_started_at = coalesce(review_started_at, now())
  where mission_work_item_id = p_work_item
    and mission_draft_version_id = v_item.current_submitted_version_id
    and workspace_id = p_workspace
    and state = 'open';

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_review_started', 'mission_draft_version', v_item.current_submitted_version_id, '{}'::jsonb
  );

  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;
create or replace function private.request_mission_revision(
  p_workflow uuid,
  p_work_item uuid,
  p_version uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text,
  p_deadline timestamptz,
  p_items jsonb
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_completed integer;
  v_granted integer;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_deadline is null or p_deadline <= now() then raise exception 'validation_failed'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'validation_failed';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where coalesce(btrim(x ->> 'text'), '') = ''
       or coalesce((x ->> 'required')::boolean, true) is not true
       or coalesce(x ->> 'category', '') not in ('format', 'key_message', 'compliance', 'quality', 'other')
  ) then raise exception 'validation_failed'; end if;

  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
    and w.workspace_id = p_workspace
  for update of i, w;

  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state or v_item.current_submitted_version_id <> p_version then
    raise exception 'stale';
  end if;
  if v_item.state not in ('submitted', 'under_review') then raise exception 'wrong_state'; end if;
  if v_item.deadline is not null and p_deadline > v_item.deadline then raise exception 'validation_failed'; end if;

  select v.* into v_version
  from public.mission_draft_versions v
  where v.id = p_version and v.mission_work_item_id = p_work_item and v.workspace_id = p_workspace
  for update;
  if v_version.id is null then raise exception 'stale'; end if;

  select r.* into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.mission_draft_version_id = p_version
    and r.workspace_id = p_workspace
    and r.state = 'open'
  for update;
  if v_round.id is null then raise exception 'wrong_state'; end if;

  select count(*) into v_completed
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.workspace_id = p_workspace
    and r.state = 'revision_requested';
  select coalesce(sum(g.granted_count), 0) into v_granted
  from public.mission_revision_grants g
  where g.mission_work_item_id = p_work_item and g.workspace_id = p_workspace;
  if v_completed >= v_item_round_limit(p_workflow, p_workspace) + v_granted then
    raise exception 'revision_limit_reached';
  end if;
  if v_round.round_number <> v_completed + 1 then raise exception 'stale'; end if;

  insert into public.mission_review_items (
    workspace_id, mission_review_round_id, requirement_id, category,
    required_change_text, required, position
  )
  select p_workspace, v_round.id,
    nullif(x.value ->> 'requirementId', '')::uuid,
    x.value ->> 'category', btrim(x.value ->> 'text'), true, (x.ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as x(value, ordinality);

  update public.mission_review_rounds
  set state = 'revision_requested', reviewer_id = p_operator,
      review_started_at = coalesce(review_started_at, now()), decision_at = now(),
      creator_response_deadline = p_deadline
  where id = v_round.id and workspace_id = p_workspace;

  update public.mission_working_drafts
  set caption_text = v_version.caption_snapshot,
      external_draft_url = v_version.external_draft_url_snapshot,
      checklist_answers = v_version.checklist_snapshot,
      revision = revision + 1,
      last_saved_at = now()
  where mission_work_item_id = p_work_item and workspace_id = p_workspace and archived_at is null;

  update public.mission_work_items
  set state = 'revision_requested', current_reviewer_id = p_operator, updated_at = now()
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_revision_requested', 'mission_review_round', v_round.id,
    jsonb_build_object('round_number', v_round.round_number, 'deadline', p_deadline)
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;
-- Read a workflow's snapshotted limit while retaining the item-row lock in callers.
create or replace function private.v_item_round_limit(p_workflow uuid, p_workspace uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select w.revision_limit::integer
  from public.mission_workflows w
  where w.id = p_workflow and w.workspace_id = p_workspace
$$;
create or replace function private.grant_mission_revision(
  p_workflow uuid,
  p_work_item uuid,
  p_operator uuid,
  p_workspace uuid,
  p_reason text,
  p_granted_count smallint
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_limit integer;
  v_completed integer;
  v_granted integer;
begin
  perform private.assert_active_mission_operator(p_operator);
  if coalesce(btrim(p_reason), '') = '' or p_granted_count is null or p_granted_count <= 0 then
    raise exception 'validation_failed';
  end if;
  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace and w.workspace_id = p_workspace
  for update of i, w;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state not in ('submitted', 'under_review') then raise exception 'wrong_state'; end if;
  v_limit := private.v_item_round_limit(p_workflow, p_workspace);

  select count(*) into v_completed from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item and r.workspace_id = p_workspace and r.state = 'revision_requested';
  select coalesce(sum(g.granted_count), 0) into v_granted from public.mission_revision_grants g
  where g.mission_work_item_id = p_work_item and g.workspace_id = p_workspace;
  if v_completed < v_limit + v_granted then raise exception 'wrong_state'; end if;

  insert into public.mission_revision_grants (
    workspace_id, mission_work_item_id, granted_by, reason, granted_count
  ) values (p_workspace, p_work_item, p_operator, btrim(p_reason), p_granted_count);
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_revision_granted', 'mission_work_item', p_work_item,
    jsonb_build_object('granted_count', p_granted_count)
  );
  return v_item;
end;
$$;
create or replace function private.approve_mission_version(
  p_workflow uuid,
  p_work_item uuid,
  p_version uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
begin
  perform private.assert_active_mission_operator(p_operator);
  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace and w.workspace_id = p_workspace
  for update of i, w;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state or v_item.current_submitted_version_id <> p_version then raise exception 'stale'; end if;
  if v_item.state not in ('submitted', 'under_review') then raise exception 'wrong_state'; end if;

  select v.* into v_version from public.mission_draft_versions v
  where v.id = p_version and v.mission_work_item_id = p_work_item and v.workspace_id = p_workspace
  for update;
  if v_version.id is null then raise exception 'stale'; end if;
  if exists (
    select 1 from public.mission_draft_versions newer
    where newer.mission_work_item_id = p_work_item and newer.workspace_id = p_workspace
      and newer.version_number > v_version.version_number
  ) then raise exception 'stale'; end if;

  select r.* into v_round from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item and r.mission_draft_version_id = p_version
    and r.workspace_id = p_workspace and r.state = 'open'
  for update;
  if v_round.id is null then raise exception 'wrong_state'; end if;

  update public.mission_review_rounds
  set state = 'approved_to_publish', reviewer_id = p_operator,
      review_started_at = coalesce(review_started_at, now()), decision_at = now()
  where id = v_round.id and workspace_id = p_workspace;
  update public.mission_work_items
  set state = 'approved_to_publish', approved_version_id = p_version,
      current_reviewer_id = p_operator, updated_at = now()
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_version_approved_to_publish', 'mission_draft_version', p_version, '{}'::jsonb
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;
create or replace function private.mark_mission_fulfillment_shipped(
  p_workflow uuid,
  p_operator uuid,
  p_workspace uuid,
  p_note text
)
returns public.mission_fulfillments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fulfillment public.mission_fulfillments;
begin
  perform private.assert_active_mission_operator(p_operator);
  select f.* into v_fulfillment
  from public.mission_fulfillments f
  join public.mission_workflows w on w.id = f.mission_workflow_id and w.workspace_id = f.workspace_id
  where f.mission_workflow_id = p_workflow and f.workspace_id = p_workspace and w.workspace_id = p_workspace
  for update of f, w;
  if v_fulfillment.id is null then raise exception 'not_found'; end if;
  if v_fulfillment.status <> 'preparing' then raise exception 'wrong_state'; end if;
  update public.mission_fulfillments
  set status = 'shipped', shipped_by = p_operator, shipped_at = now(),
      operational_note = nullif(btrim(p_note), ''), updated_at = now()
  where id = v_fulfillment.id and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_fulfillment;
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, 'operator', p_operator,
    'mission_fulfillment_shipped', 'mission_fulfillment', v_fulfillment.id, '{}'::jsonb
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_fulfillment;
end;
$$;
-- Only service-role server routes can enter the public wrappers. The wrappers still
-- verify the unspoofable active staff identity and tenant context passed by the route.
create or replace function public.start_mission_review(
  p_workflow uuid, p_work_item uuid, p_operator uuid, p_workspace uuid, p_expected_state text
) returns public.mission_work_items
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.start_mission_review(p_workflow, p_work_item, p_operator, p_workspace, p_expected_state);
end;
$$;
create or replace function public.request_mission_revision(
  p_workflow uuid, p_work_item uuid, p_version uuid, p_operator uuid, p_workspace uuid,
  p_expected_state text, p_deadline timestamptz, p_items jsonb
) returns public.mission_work_items
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.request_mission_revision(p_workflow, p_work_item, p_version, p_operator, p_workspace, p_expected_state, p_deadline, p_items);
end;
$$;
create or replace function public.grant_mission_revision(
  p_workflow uuid, p_work_item uuid, p_operator uuid, p_workspace uuid,
  p_reason text, p_granted_count smallint default 1
) returns public.mission_work_items
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.grant_mission_revision(p_workflow, p_work_item, p_operator, p_workspace, p_reason, p_granted_count);
end;
$$;
create or replace function public.approve_mission_version(
  p_workflow uuid, p_work_item uuid, p_version uuid, p_operator uuid, p_workspace uuid, p_expected_state text
) returns public.mission_work_items
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.approve_mission_version(p_workflow, p_work_item, p_version, p_operator, p_workspace, p_expected_state);
end;
$$;
create or replace function public.mark_mission_fulfillment_shipped(
  p_workflow uuid, p_operator uuid, p_workspace uuid, p_note text default null
) returns public.mission_fulfillments
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.mark_mission_fulfillment_shipped(p_workflow, p_operator, p_workspace, p_note);
end;
$$;
revoke all on function private.assert_active_mission_operator(uuid) from public, anon, authenticated, service_role;
revoke all on function private.v_item_round_limit(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.start_mission_review(uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.request_mission_revision(uuid, uuid, uuid, uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.grant_mission_revision(uuid, uuid, uuid, uuid, text, smallint) from public, anon, authenticated, service_role;
revoke all on function private.approve_mission_version(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.mark_mission_fulfillment_shipped(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.start_mission_review(uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.request_mission_revision(uuid, uuid, uuid, uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.grant_mission_revision(uuid, uuid, uuid, uuid, text, smallint) from public, anon, authenticated, service_role;
revoke all on function public.approve_mission_version(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.mark_mission_fulfillment_shipped(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.start_mission_review(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.request_mission_revision(uuid, uuid, uuid, uuid, uuid, text, timestamptz, jsonb) to service_role;
grant execute on function public.grant_mission_revision(uuid, uuid, uuid, uuid, text, smallint) to service_role;
grant execute on function public.approve_mission_version(uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.mark_mission_fulfillment_shipped(uuid, uuid, uuid, text) to service_role;

-- SOURCE: derived-sql/20260718193000-harden_active_mission_operator_lifecycle.sql; sha256=b8089cdea10ff6929f85532bd4e21d2ecc404d40f251ed4b7f8d999faaa13971
-- Correct the operator lifecycle without rewriting the already-applied Task 7 migration.
-- Define dependencies before callers because every function has an empty search_path.

create or replace function private.v_item_round_limit(p_workflow uuid, p_workspace uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select w.revision_limit::integer
  from public.mission_workflows w
  where w.id = p_workflow and w.workspace_id = p_workspace
$$;
create or replace function private.start_mission_review(
  p_workflow uuid,
  p_work_item uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_completed integer;
  v_transitioned boolean;
begin
  perform private.assert_active_mission_operator(p_operator);

  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
    and w.workspace_id = p_workspace
  for update of i, w;

  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state then raise exception 'stale'; end if;
  if v_item.state not in ('submitted', 'under_review')
     or v_item.current_submitted_version_id is null then
    raise exception 'wrong_state';
  end if;
  v_transitioned := v_item.state = 'submitted';

  select v.* into v_version
  from public.mission_draft_versions v
  where v.id = v_item.current_submitted_version_id
    and v.mission_work_item_id = p_work_item
    and v.workspace_id = p_workspace
  for update;
  if v_version.id is null then raise exception 'stale'; end if;
  if exists (
    select 1 from public.mission_draft_versions newer
    where newer.mission_work_item_id = p_work_item
      and newer.workspace_id = p_workspace
      and newer.version_number > v_version.version_number
  ) then raise exception 'stale'; end if;

  select r.* into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.mission_draft_version_id = v_item.current_submitted_version_id
    and r.workspace_id = p_workspace
    and r.state = 'open'
  for update;

  if v_round.id is null then
    if exists (
      select 1 from public.mission_review_rounds r
      where r.mission_work_item_id = p_work_item
        and r.workspace_id = p_workspace
        and r.state = 'open'
    ) then raise exception 'stale'; end if;
    if exists (
      select 1 from public.mission_review_rounds r
      where r.mission_work_item_id = p_work_item
        and r.mission_draft_version_id = v_item.current_submitted_version_id
        and r.workspace_id = p_workspace
        and r.state <> 'open'
    ) then raise exception 'wrong_state'; end if;

    select count(*) into v_completed
    from public.mission_review_rounds r
    where r.mission_work_item_id = p_work_item
      and r.workspace_id = p_workspace
      and r.state = 'revision_requested';

    insert into public.mission_review_rounds (
      workspace_id, mission_work_item_id, mission_draft_version_id,
      round_number, state, reviewer_id, review_started_at
    ) values (
      p_workspace, p_work_item, v_item.current_submitted_version_id,
      v_completed + 1, 'open', p_operator, now()
    ) returning * into v_round;
  else
    update public.mission_review_rounds
    set reviewer_id = p_operator,
        review_started_at = coalesce(review_started_at, now())
    where id = v_round.id and workspace_id = p_workspace;
  end if;

  update public.mission_work_items
  set state = 'under_review',
      current_reviewer_id = p_operator,
      review_started_at = coalesce(review_started_at, now()),
      updated_at = now()
  where id = p_work_item
    and mission_workflow_id = p_workflow
    and workspace_id = p_workspace
  returning * into v_item;

  if v_transitioned then
    insert into public.mission_workflow_events (
      workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
      event_type, entity_type, entity_id, metadata
    ) values (
      p_workspace, p_workflow, p_work_item, 'operator', p_operator,
      'mission_review_started', 'mission_draft_version', v_item.current_submitted_version_id,
      jsonb_build_object('round_number', v_round.round_number)
    );
  end if;

  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;
create or replace function private.request_mission_revision(
  p_workflow uuid,
  p_work_item uuid,
  p_version uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text,
  p_deadline timestamptz,
  p_items jsonb
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_completed integer;
  v_granted integer;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_deadline is null or p_deadline <= now() then raise exception 'validation_failed'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'validation_failed';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where coalesce(btrim(x ->> 'text'), '') = ''
       or coalesce((x ->> 'required')::boolean, true) is not true
       or coalesce(x ->> 'category', '') not in ('format', 'key_message', 'compliance', 'quality', 'other')
  ) then raise exception 'validation_failed'; end if;

  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
    and w.workspace_id = p_workspace
  for update of i, w;

  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state or v_item.current_submitted_version_id <> p_version then
    raise exception 'stale';
  end if;
  if v_item.state not in ('submitted', 'under_review') then raise exception 'wrong_state'; end if;

  select v.* into v_version
  from public.mission_draft_versions v
  where v.id = p_version
    and v.mission_work_item_id = p_work_item
    and v.workspace_id = p_workspace
  for update;
  if v_version.id is null then raise exception 'stale'; end if;

  select r.* into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.mission_draft_version_id = p_version
    and r.workspace_id = p_workspace
    and r.state = 'open'
  for update;
  if v_round.id is null then raise exception 'wrong_state'; end if;

  select count(*) into v_completed
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.workspace_id = p_workspace
    and r.state = 'revision_requested';
  select coalesce(sum(g.granted_count), 0) into v_granted
  from public.mission_revision_grants g
  where g.mission_work_item_id = p_work_item and g.workspace_id = p_workspace;
  if v_completed >= private.v_item_round_limit(p_workflow, p_workspace) + v_granted then
    raise exception 'revision_limit_reached';
  end if;
  if v_round.round_number <> v_completed + 1 then raise exception 'stale'; end if;

  insert into public.mission_review_items (
    workspace_id, mission_review_round_id, requirement_id, category,
    required_change_text, required, position
  )
  select p_workspace, v_round.id,
    nullif(x.value ->> 'requirementId', '')::uuid,
    x.value ->> 'category', btrim(x.value ->> 'text'), true, (x.ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as x(value, ordinality);

  update public.mission_review_rounds
  set state = 'revision_requested', reviewer_id = p_operator,
      review_started_at = coalesce(review_started_at, now()), decision_at = now(),
      creator_response_deadline = p_deadline
  where id = v_round.id and workspace_id = p_workspace;

  update public.mission_working_drafts
  set caption_text = v_version.caption_snapshot,
      external_draft_url = v_version.external_draft_url_snapshot,
      checklist_answers = v_version.checklist_snapshot,
      revision = revision + 1,
      last_saved_at = now()
  where mission_work_item_id = p_work_item
    and workspace_id = p_workspace
    and archived_at is null;

  update public.mission_work_items
  set state = 'revision_requested', current_reviewer_id = p_operator, updated_at = now()
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_revision_requested', 'mission_review_round', v_round.id,
    jsonb_build_object('round_number', v_round.round_number, 'deadline', p_deadline)
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;
create or replace function private.grant_mission_revision(
  p_workflow uuid,
  p_work_item uuid,
  p_operator uuid,
  p_workspace uuid,
  p_reason text,
  p_granted_count smallint
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_limit integer;
  v_completed integer;
  v_granted integer;
begin
  perform private.assert_active_mission_operator(p_operator);
  if coalesce(btrim(p_reason), '') = '' or p_granted_count is null or p_granted_count <= 0 then
    raise exception 'validation_failed';
  end if;
  select i.* into v_item
  from public.mission_work_items i
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  where i.id = p_work_item and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace and w.workspace_id = p_workspace
  for update of i, w;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state not in ('submitted', 'under_review') then raise exception 'wrong_state'; end if;
  v_limit := private.v_item_round_limit(p_workflow, p_workspace);

  select count(*) into v_completed from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item and r.workspace_id = p_workspace and r.state = 'revision_requested';
  select coalesce(sum(g.granted_count), 0) into v_granted from public.mission_revision_grants g
  where g.mission_work_item_id = p_work_item and g.workspace_id = p_workspace;
  if v_completed < v_limit + v_granted then raise exception 'wrong_state'; end if;

  insert into public.mission_revision_grants (
    workspace_id, mission_work_item_id, granted_by, reason, granted_count
  ) values (p_workspace, p_work_item, p_operator, btrim(p_reason), p_granted_count);
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_revision_granted', 'mission_work_item', p_work_item,
    jsonb_build_object('granted_count', p_granted_count)
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;
revoke all on function private.v_item_round_limit(uuid, uuid) from public, anon, authenticated, service_role;

-- SOURCE: derived-sql/20260718210000-author_active_mission_workflow_policies.sql; sha256=b8cb17fce0c16b8784849a1b25f1921047003e956d7a37fd1c9855ff8a50b6f1
-- Atomically author a mission, its active-workflow policy, deliverable templates,
-- and nested checklist requirements. The server is the only caller.

alter table public.mission_deliverable_templates
  alter column platform drop not null;
alter table public.mission_work_items
  alter column platform drop not null;
create or replace function private.author_mission_workflow(
  p_mission_id uuid,
  p_mission jsonb,
  p_policy jsonb,
  p_templates jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
  v_write public.missions;
  v_template_json jsonb;
  v_requirement_json jsonb;
  v_template_id uuid;
  v_requirement_id uuid;
  v_keep_templates uuid[] := '{}'::uuid[];
  v_keep_requirements uuid[];
  v_removed_templates uuid[];
  v_result jsonb;
begin
  if jsonb_typeof(p_mission) <> 'object'
    or jsonb_typeof(p_policy) <> 'object'
    or jsonb_typeof(p_templates) <> 'array'
  then
    raise exception 'invalid_mission_authoring_payload';
  end if;

  if coalesce(p_policy->>'creator_workflow_mode', '') not in ('legacy', 'active_workspace')
    or jsonb_typeof(p_policy->'fulfillment_required') <> 'boolean'
    or (p_policy->>'revision_limit')::integer < 0
    or (p_policy->>'review_sla_hours')::integer <= 0
    or (p_policy->>'revision_response_hours')::integer <= 0
  then
    raise exception 'invalid_mission_workflow_policy';
  end if;

  if p_policy->>'creator_workflow_mode' = 'active_workspace'
    and not exists (
      select 1 from jsonb_array_elements(p_templates) template
      where template->>'required' = 'true'
    )
  then
    raise exception 'active_mission_requires_deliverable';
  end if;

  if p_mission_id is null then
    v_write := jsonb_populate_record(null::public.missions, p_mission || p_policy);
    insert into public.missions (
      workspace_id, slug, title, mission_type, description, category, access_type,
      required_level, points_reward, cash_reward, cpm_rate, cpm_budget_pool,
      deadline, quota, deliverables, requirements, platforms, effort, status,
      target_audience, dos, donts, key_messages, reference_links,
      creator_workflow_mode, fulfillment_required, revision_limit,
      review_sla_hours, revision_response_hours
    ) values (
      v_write.workspace_id, v_write.slug, v_write.title, v_write.mission_type,
      v_write.description, v_write.category, coalesce(v_write.access_type, 'open'),
      coalesce(v_write.required_level, 'L0'), coalesce(v_write.points_reward, 0),
      v_write.cash_reward, v_write.cpm_rate, v_write.cpm_budget_pool,
      v_write.deadline, coalesce(v_write.quota, 10), coalesce(v_write.deliverables, '{}'::text[]),
      coalesce(v_write.requirements, '{}'::text[]), coalesce(v_write.platforms, '{}'::text[]),
      v_write.effort, 'draft', v_write.target_audience, coalesce(v_write.dos, '{}'::text[]),
      coalesce(v_write.donts, '{}'::text[]), coalesce(v_write.key_messages, '{}'::text[]),
      coalesce(v_write.reference_links, '{}'::text[]),
      v_write.creator_workflow_mode, v_write.fulfillment_required, v_write.revision_limit,
      v_write.review_sla_hours, v_write.revision_response_hours
    ) returning * into v_mission;
  else
    select * into v_mission
    from public.missions
    where id = p_mission_id
    for update;
    if not found then raise exception 'mission_not_found'; end if;

    v_write := jsonb_populate_record(v_mission, p_mission || p_policy);
    update public.missions set
      slug = v_write.slug,
      title = v_write.title,
      mission_type = v_write.mission_type,
      description = v_write.description,
      category = v_write.category,
      access_type = v_write.access_type,
      required_level = v_write.required_level,
      points_reward = v_write.points_reward,
      cash_reward = v_write.cash_reward,
      cpm_rate = v_write.cpm_rate,
      cpm_budget_pool = v_write.cpm_budget_pool,
      deadline = v_write.deadline,
      quota = v_write.quota,
      deliverables = v_write.deliverables,
      requirements = v_write.requirements,
      platforms = v_write.platforms,
      effort = v_write.effort,
      target_audience = v_write.target_audience,
      dos = v_write.dos,
      donts = v_write.donts,
      key_messages = v_write.key_messages,
      reference_links = v_write.reference_links,
      creator_workflow_mode = v_write.creator_workflow_mode,
      fulfillment_required = v_write.fulfillment_required,
      revision_limit = v_write.revision_limit,
      review_sla_hours = v_write.review_sla_hours,
      revision_response_hours = v_write.revision_response_hours,
      updated_at = now()
    where id = v_mission.id
    returning * into v_mission;
  end if;

  perform 1
  from public.mission_deliverable_templates
  where mission_id = v_mission.id
  for update;

  select coalesce(array_agg((template->>'id')::uuid), '{}'::uuid[])
  into v_keep_templates
  from jsonb_array_elements(p_templates) template
  where template ? 'id';

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_removed_templates
  from public.mission_deliverable_templates
  where mission_id = v_mission.id
    and not (id = any(v_keep_templates));

  if cardinality(v_removed_templates) > 0 then
    perform 1
    from public.mission_work_items
    where source_template_id = any(v_removed_templates)
    for update;
    if found then raise exception 'mission_template_snapshotted'; end if;
  end if;

  -- Move current positions out of the incoming range before supporting reorder.
  update public.mission_deliverable_templates
  set position = position + 1000000
  where mission_id = v_mission.id;

  for v_template_json in select value from jsonb_array_elements(p_templates)
  loop
    if v_template_json ? 'id' then
      v_template_id := (v_template_json->>'id')::uuid;
      if not exists (
        select 1 from public.mission_deliverable_templates
        where id = v_template_id and mission_id = v_mission.id and workspace_id = v_mission.workspace_id
      ) then raise exception 'mission_template_not_found'; end if;

      update public.mission_deliverable_templates set
        title = btrim(v_template_json->>'title'),
        platform = nullif(btrim(v_template_json->>'platform'), ''),
        position = (v_template_json->>'position')::integer,
        required = (v_template_json->>'required')::boolean,
        draft_due_offset_hours = (v_template_json->>'draft_due_offset_hours')::integer,
        updated_at = now()
      where id = v_template_id;
    else
      insert into public.mission_deliverable_templates (
        workspace_id, mission_id, title, platform, position, required, draft_due_offset_hours
      ) values (
        v_mission.workspace_id, v_mission.id, btrim(v_template_json->>'title'),
        nullif(btrim(v_template_json->>'platform'), ''),
        (v_template_json->>'position')::integer,
        (v_template_json->>'required')::boolean,
        (v_template_json->>'draft_due_offset_hours')::integer
      ) returning id into v_template_id;
    end if;

    v_keep_templates := array_append(v_keep_templates, v_template_id);

    update public.mission_deliverable_requirements
    set position = position + 1000000
    where mission_deliverable_template_id = v_template_id;

    select coalesce(array_agg((requirement->>'id')::uuid), '{}'::uuid[])
    into v_keep_requirements
    from jsonb_array_elements(v_template_json->'requirements') requirement
    where requirement ? 'id';

    for v_requirement_json in select value from jsonb_array_elements(v_template_json->'requirements')
    loop
      if v_requirement_json ? 'id' then
        v_requirement_id := (v_requirement_json->>'id')::uuid;
        if not exists (
          select 1 from public.mission_deliverable_requirements
          where id = v_requirement_id
            and mission_deliverable_template_id = v_template_id
            and workspace_id = v_mission.workspace_id
        ) then raise exception 'mission_requirement_not_found'; end if;

        update public.mission_deliverable_requirements set
          category = v_requirement_json->>'category',
          requirement_text = btrim(v_requirement_json->>'text'),
          required = (v_requirement_json->>'required')::boolean,
          position = (v_requirement_json->>'position')::integer
        where id = v_requirement_id;
      else
        insert into public.mission_deliverable_requirements (
          workspace_id, mission_deliverable_template_id, category,
          requirement_text, required, position
        ) values (
          v_mission.workspace_id, v_template_id, v_requirement_json->>'category',
          btrim(v_requirement_json->>'text'),
          (v_requirement_json->>'required')::boolean,
          (v_requirement_json->>'position')::integer
        ) returning id into v_requirement_id;
      end if;

      v_keep_requirements := array_append(v_keep_requirements, v_requirement_id);
    end loop;

    delete from public.mission_deliverable_requirements
    where mission_deliverable_template_id = v_template_id
      and not (id = any(v_keep_requirements));
  end loop;

  delete from public.mission_deliverable_templates
  where mission_id = v_mission.id
    and not (id = any(v_keep_templates));

  select to_jsonb(mission_row) || jsonb_build_object(
    'deliverable_templates', coalesce((
      select jsonb_agg(
        to_jsonb(template_row) - 'workspace_id' - 'mission_id' - 'created_at' - 'updated_at'
        || jsonb_build_object('requirements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', requirement_row.id,
            'category', requirement_row.category,
            'text', requirement_row.requirement_text,
            'required', requirement_row.required,
            'position', requirement_row.position
          ) order by requirement_row.position)
          from public.mission_deliverable_requirements requirement_row
          where requirement_row.mission_deliverable_template_id = template_row.id
        ), '[]'::jsonb))
        order by template_row.position
      )
      from public.mission_deliverable_templates template_row
      where template_row.mission_id = mission_row.id
    ), '[]'::jsonb)
  ) into v_result
  from public.missions mission_row
  where mission_row.id = v_mission.id;

  return v_result;
end;
$$;
create or replace function public.author_mission_workflow(
  p_mission_id uuid,
  p_mission jsonb,
  p_policy jsonb,
  p_templates jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return private.author_mission_workflow(p_mission_id, p_mission, p_policy, p_templates);
end;
$$;
revoke all on function private.author_mission_workflow(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.author_mission_workflow(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.author_mission_workflow(uuid, jsonb, jsonb, jsonb)
  to service_role;

-- SOURCE: derived-sql/20260718213000-guard_mission_authoring_snapshot_race.sql; sha256=6a3b89986e775a4133002f145a5ff32fbef14a700eb7836553647b0f982fd848
-- Serialize creator workflow snapshots with mission-template authoring.
-- A snapshot transaction takes a key-share lock on its parent mission before
-- validating the source template. The authoring RPC takes FOR UPDATE on that
-- same mission, so either the snapshot commits first and blocks deletion, or
-- authoring commits first and the trigger rejects the now-missing template.

create or replace function private.guard_mission_work_item_source_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission_id uuid;
begin
  if new.source_template_id is null then
    return new;
  end if;

  select mission.id
  into v_mission_id
  from public.mission_workflows workflow
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  join public.missions mission
    on mission.id = submission.mission_id
   and mission.workspace_id = submission.workspace_id
  join public.mission_deliverable_templates template
    on template.id = new.source_template_id
   and template.mission_id = mission.id
   and template.workspace_id = new.workspace_id
  where workflow.id = new.mission_workflow_id
    and workflow.workspace_id = new.workspace_id
    and submission.workspace_id = new.workspace_id
    and mission.workspace_id = new.workspace_id
  for key share of mission;

  if not found then
    raise exception 'mission_work_item_source_template_mismatch'
      using errcode = '23503';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_mission_work_item_source_template()
  from public, anon, authenticated, service_role;
drop trigger if exists mission_work_items_source_template_guard
  on public.mission_work_items;
create trigger mission_work_items_source_template_guard
before insert or update of source_template_id
on public.mission_work_items
for each row
execute function private.guard_mission_work_item_source_template();

-- SOURCE: derived-sql/20260719133000-submit_active_mission_draft.sql; sha256=fd7a4d5045a9cf8693f6d4ec05aa8f31ea453622bdc2179309a01557baf5f738
-- Creator upload/finalize/submit transitions for the active mission workspace.
-- Supabase signed-upload tokens have a provider-managed lifetime in this client version;
-- the authoritative application grant is therefore expired after exactly 600 seconds here.

alter table public.mission_draft_assets
  add column if not exists upload_grant_expires_at timestamptz;
alter table public.mission_draft_versions
  add column if not exists submission_idempotency_key text;
create unique index if not exists mission_submission_idempotency_key
  on public.mission_draft_versions (mission_work_item_id, submission_idempotency_key)
  where submission_idempotency_key is not null;
create or replace function private.create_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_extension text,
  p_grant_seconds integer
)
returns public.mission_draft_assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_workflow public.mission_workflows;
  v_asset public.mission_draft_assets;
  v_asset_id uuid := gen_random_uuid();
begin
  if p_grant_seconds <> 600 then raise exception 'invalid_grant_lifetime'; end if;
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm') then
    raise exception 'invalid_mime_type';
  end if;
  if p_byte_size < 1 or p_byte_size > 20971520 then raise exception 'invalid_byte_size'; end if;

  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where w.mission_submission_id = p_submission
    and w.workspace_id = p_workspace
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = v_workflow.id
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state not in ('drafting', 'revision_requested') then raise exception 'wrong_state'; end if;

  if (select count(*) from public.mission_draft_assets a
      where a.mission_work_item_id = v_item.id
        and a.workspace_id = p_workspace
        and a.deleted_at is null
        and a.upload_state <> 'deleted') >= 5 then
    raise exception 'asset_limit';
  end if;

  insert into public.mission_draft_assets (
    id, workspace_id, mission_work_item_id, mission_workflow_id, creator_id,
    storage_object_path, original_filename, mime_type, byte_size, file_extension,
    upload_state, upload_grant_expires_at
  ) values (
    v_asset_id, p_workspace, v_item.id, v_item.mission_workflow_id, p_creator,
    p_creator::text || '/' || v_item.mission_workflow_id::text || '/' || v_item.id::text || '/' || v_asset_id::text || '.' || p_extension,
    p_filename, p_mime_type, p_byte_size, p_extension,
    'pending', now() + interval '600 seconds'
  ) returning * into v_asset;
  return v_asset;
end;
$$;
create or replace function public.create_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_extension text,
  p_grant_seconds integer
)
returns public.mission_draft_assets
language sql
security definer
set search_path = ''
as $$
  select private.create_active_mission_asset(
    p_submission, p_creator, p_workspace, p_work_item, p_filename,
    p_mime_type, p_byte_size, p_extension, p_grant_seconds
  );
$$;
create or replace function private.finalize_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_asset uuid,
  p_checksum text
)
returns public.mission_draft_assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.mission_draft_assets;
begin
  select a.* into v_asset
  from public.mission_draft_assets a
  join public.mission_work_items i
    on i.id = a.mission_work_item_id
    and i.mission_workflow_id = a.mission_workflow_id
    and i.workspace_id = a.workspace_id
  join public.mission_workflows w
    on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where a.id = p_asset
    and a.mission_work_item_id = p_work_item
    and a.creator_id = p_creator
    and a.workspace_id = p_workspace
    and s.id = p_submission
    and s.creator_id = p_creator
    and a.storage_object_path = p_creator::text || '/' || a.mission_workflow_id::text || '/' || p_work_item::text || '/' || a.id::text || '.' || a.file_extension
  for update of a;
  if v_asset.id is null then raise exception 'not_found'; end if;
  if v_asset.upload_state <> 'pending' or v_asset.deleted_at is not null then raise exception 'wrong_state'; end if;
  if v_asset.upload_grant_expires_at is null or v_asset.upload_grant_expires_at < now() then raise exception 'upload_grant_expired'; end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'mission-draft-assets'
      and o.name = v_asset.storage_object_path
      and o.metadata ->> 'mimetype' = v_asset.mime_type
      and (o.metadata ->> 'size')::bigint = v_asset.byte_size
  ) then raise exception 'upload_metadata_mismatch'; end if;

  update public.mission_draft_assets
  set upload_state = 'ready', checksum = btrim(p_checksum)
  where id = v_asset.id and workspace_id = v_asset.workspace_id
  returning * into v_asset;
  return v_asset;
end;
$$;
create or replace function public.finalize_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_asset uuid,
  p_checksum text
)
returns public.mission_draft_assets
language sql
security definer
set search_path = ''
as $$
  select private.finalize_active_mission_asset(
    p_submission, p_creator, p_workspace, p_work_item, p_asset, p_checksum
  );
$$;
create or replace function private.submit_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.mission_work_items;
  v_workflow public.mission_workflows;
  v_draft public.mission_working_drafts;
  v_version public.mission_draft_versions;
  v_round integer;
  v_version_number integer;
begin
  if btrim(coalesce(p_idempotency_key, '')) = '' then raise exception 'idempotency_key_required'; end if;

  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where w.mission_submission_id = p_submission
    and w.workspace_id = p_workspace
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = v_workflow.id
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;

  select v.* into v_version
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id
    and v.workspace_id = p_workspace
    and v.submission_idempotency_key = p_idempotency_key;
  if v_version.id is not null then
    return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
  end if;

  if v_item.state not in ('drafting', 'revision_requested') then raise exception 'wrong_state'; end if;
  select d.* into v_draft
  from public.mission_working_drafts d
  where d.mission_work_item_id = v_item.id
    and d.workspace_id = p_workspace
    and d.archived_at is null
  for update;
  if v_draft.id is null then raise exception 'not_found'; end if;
  if v_draft.revision <> p_expected_revision then raise exception 'stale_revision'; end if;

  if exists (
    select 1 from public.mission_draft_assets a
    where a.mission_work_item_id = v_item.id
      and a.workspace_id = p_workspace
      and a.deleted_at is null
      and a.upload_state <> 'deleted'
      and a.upload_state <> 'ready'
  ) then raise exception 'assets_not_ready'; end if;

  select coalesce(max(v.version_number), 0) + 1 into v_version_number
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id and v.workspace_id = p_workspace;

  insert into public.mission_draft_versions (
    workspace_id, mission_work_item_id, version_number, caption_snapshot,
    external_draft_url_snapshot, checklist_snapshot, submitted_by,
    content_checksum, submission_idempotency_key
  ) values (
    p_workspace, v_item.id, v_version_number, v_draft.caption_text,
    v_draft.external_draft_url, v_draft.checklist_answers, p_creator,
    md5(v_draft.id::text || ':' || v_draft.revision::text || ':' || p_idempotency_key),
    p_idempotency_key
  ) returning * into v_version;

  update public.mission_draft_assets
  set mission_draft_version_id = v_version.id, retained_at = now()
  where mission_work_item_id = v_item.id
    and workspace_id = p_workspace
    and upload_state = 'ready'
    and deleted_at is null
    and mission_draft_version_id is null;

  select coalesce(max(r.round_number), 0) + 1 into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = v_item.id and r.workspace_id = p_workspace;

  insert into public.mission_review_rounds (
    workspace_id, mission_work_item_id, mission_draft_version_id,
    round_number, state, review_started_at
  ) values (
    p_workspace, v_item.id, v_version.id, v_round, 'open', now()
  );

  update public.mission_work_items
  set state = 'under_review',
      current_submitted_version_id = v_version.id,
      review_started_at = now(),
      review_due_at = least(now() + make_interval(hours => v_workflow.review_sla_hours), v_item.deadline),
      updated_at = now()
  where id = v_item.id and workspace_id = p_workspace
  returning * into v_item;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id,
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, v_item.mission_workflow_id, v_item.id,
    'creator', p_creator, 'draft_submitted', 'mission_draft_version', v_version.id,
    jsonb_build_object('version_number', v_version.version_number, 'review_round', v_round)
  );

  perform private.refresh_mission_workflow_state(v_item.mission_workflow_id);
  return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
end;
$$;
create or replace function public.submit_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.submit_active_mission_draft(
    p_submission, p_creator, p_workspace, p_work_item,
    p_expected_revision, p_idempotency_key
  );
$$;
revoke all on function private.create_active_mission_asset(uuid, uuid, uuid, uuid, text, text, bigint, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.create_active_mission_asset(uuid, uuid, uuid, uuid, text, text, bigint, text, integer) from public, anon, authenticated, service_role;
revoke all on function private.finalize_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.finalize_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.create_active_mission_asset(uuid, uuid, uuid, uuid, text, text, bigint, text, integer) to service_role;
grant execute on function public.finalize_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text) to service_role;

-- SOURCE: derived-sql/20260719160000-abandon_active_mission_asset.sql; sha256=f305e4cdd0c65849d170657ea4da84760501b503d1c2052ab2132cf0b8a2fece
-- Best-effort rollback for an asset row whose signed upload grant could not be created.
-- The private implementation and public wrapper remain service-role only.

create or replace function private.abandon_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_asset uuid,
  p_storage_object_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.mission_draft_assets;
begin
  select a.* into v_asset
  from public.mission_draft_assets a
  join public.mission_work_items i
    on i.id = a.mission_work_item_id
    and i.mission_workflow_id = a.mission_workflow_id
    and i.workspace_id = a.workspace_id
  join public.mission_workflows w
    on w.id = i.mission_workflow_id
    and w.workspace_id = i.workspace_id
  join public.mission_submissions s
    on s.id = w.mission_submission_id
    and s.workspace_id = w.workspace_id
  where s.id = p_submission
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
    and a.workspace_id = p_workspace
    and a.mission_work_item_id = p_work_item
    and a.creator_id = p_creator
    and a.id = p_asset
    and a.storage_object_path = p_storage_object_path
    and a.upload_state = 'pending'
    and a.mission_draft_version_id is null
    and a.deleted_at is null
  for update of a;

  if v_asset.id is null then
    return false;
  end if;

  update public.mission_draft_assets
  set upload_state = 'deleted', deleted_at = now()
  where id = v_asset.id
    and workspace_id = p_workspace
    and mission_work_item_id = p_work_item
    and creator_id = p_creator
    and storage_object_path = p_storage_object_path
    and upload_state = 'pending'
    and mission_draft_version_id is null
    and deleted_at is null;

  return found;
end;
$$;
create or replace function public.abandon_active_mission_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_asset uuid,
  p_storage_object_path text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.abandon_active_mission_asset(
    p_submission,
    p_creator,
    p_workspace,
    p_work_item,
    p_asset,
    p_storage_object_path
  );
$$;
revoke all on function private.abandon_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.abandon_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.abandon_active_mission_asset(uuid, uuid, uuid, uuid, uuid, text)
  to service_role;

-- SOURCE: derived-sql/20260719200000-active_mission_workflow_notifications.sql; sha256=63715f59408bcbd5aa1878b6903d1d8c0b42b5a01f70e2e7f55d6e430cc984f8
-- Phase 2 workflow notifications are added in a forward migration because the
-- foundational workspace migration has already been followed by transition overrides.
-- Triggers preserve those atomic transition functions and make delivery best-effort.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started',
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue'
  ));
alter table public.notifications drop constraint if exists notifications_workflow_payload_size_check;
alter table public.notifications add constraint notifications_workflow_payload_size_check
  check (
    type not in (
      'mission_product_shipped','mission_receipt_required',
      'mission_revision_requested','mission_draft_approved',
      'mission_approved_to_publish','mission_deadline_approaching',
      'mission_deadline_overdue'
    )
    or octet_length(data::text) <= 8192
  );
create table private.mission_workflow_notification_dedupe (
  recipient_id uuid not null,
  notification_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  semantic_key text not null,
  created_at timestamptz not null default now(),
  primary key (recipient_id, notification_type, entity_type, entity_id, semantic_key)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.mission_workflow_notification_dedupe FROM PUBLIC, anon, authenticated, service_role;

revoke all on table private.mission_workflow_notification_dedupe
  from public, anon, authenticated, service_role;
create or replace function private.notify_mission_workflow(
  p_type text,
  p_workflow uuid,
  p_work_item uuid default null,
  p_deadline timestamptz default null,
  p_version_number integer default null,
  p_reason_category text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_workspace uuid;
  v_submission uuid;
  v_mission_title text;
  v_mission_slug text;
  v_deliverable_title text;
  v_deadline timestamptz;
  v_version_number integer;
  v_entity_type text;
  v_entity_id uuid;
  v_semantic_key text;
  v_claimed integer;
  v_data jsonb;
begin
  if p_type not in (
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue'
  ) then
    return false;
  end if;

  select
    s.creator_id,
    w.workspace_id,
    w.mission_submission_id,
    m.title,
    m.slug,
    i.title,
    coalesce(p_deadline, i.deadline),
    coalesce(p_version_number, v.version_number)
  into
    v_user,
    v_workspace,
    v_submission,
    v_mission_title,
    v_mission_slug,
    v_deliverable_title,
    v_deadline,
    v_version_number
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id
   and s.workspace_id = w.workspace_id
  join public.missions m
    on m.id = s.mission_id
   and m.workspace_id = s.workspace_id
  left join public.mission_work_items i
    on i.id = p_work_item
   and i.mission_workflow_id = w.id
   and i.workspace_id = w.workspace_id
  left join public.mission_draft_versions v
    on v.id = coalesce(i.approved_version_id, i.current_submitted_version_id)
   and v.mission_work_item_id = i.id
   and v.workspace_id = i.workspace_id
  where w.id = p_workflow;

  if v_user is null then
    return false;
  end if;

  v_entity_type := case when p_work_item is null then 'mission_workflow' else 'mission_work_item' end;
  v_entity_id := coalesce(p_work_item, p_workflow);
  v_data := jsonb_strip_nulls(jsonb_build_object(
    'mission_title', v_mission_title,
    'mission_slug', v_mission_slug,
    'submission_id', v_submission,
    'deliverable_title', v_deliverable_title,
    'deadline', v_deadline,
    'version_number', v_version_number,
    'reason_category', p_reason_category
  ));

  if p_type in ('mission_deadline_approaching', 'mission_deadline_overdue') then
    v_semantic_key := coalesce(v_deadline::text, '');
  else
    v_semantic_key := concat_ws(
      '|',
      coalesce(v_deadline::text, ''),
      coalesce(v_version_number::text, ''),
      coalesce(p_reason_category, '')
    );
  end if;

  begin
    insert into private.mission_workflow_notification_dedupe (
      recipient_id, notification_type, entity_type, entity_id, semantic_key
    ) values (
      v_user, p_type, v_entity_type, v_entity_id, v_semantic_key
    )
    on conflict do nothing;

    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
      return false;
    end if;

    insert into public.notifications (
      user_id, workspace_id, type, entity_type, entity_id, data
    )
    values (
      v_user, v_workspace, p_type, v_entity_type, v_entity_id, v_data
    );

    return true;
  exception
    when others then
      return false;
  end;
exception
  when others then
    return false;
end;
$$;
create or replace function private.notify_mission_fulfillment_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status = 'shipped' then
    perform private.notify_mission_workflow('mission_product_shipped', new.mission_workflow_id);
    perform private.notify_mission_workflow('mission_receipt_required', new.mission_workflow_id);
  end if;
  return new;
end;
$$;
drop trigger if exists mission_fulfillment_workflow_notifications on public.mission_fulfillments;
create trigger mission_fulfillment_workflow_notifications
after update of status on public.mission_fulfillments
for each row execute function private.notify_mission_fulfillment_transition();
create or replace function private.notify_mission_work_item_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline timestamptz;
  v_reason_category text;
  v_version_number integer;
begin
  if old.state is not distinct from new.state then
    return new;
  end if;

  if new.state = 'revision_requested' then
    select
      r.creator_response_deadline,
      (
        select ri.category
        from public.mission_review_items ri
        where ri.mission_review_round_id = r.id
          and ri.workspace_id = r.workspace_id
        order by ri.position
        limit 1
      )
    into v_deadline, v_reason_category
    from public.mission_review_rounds r
    where r.mission_work_item_id = new.id
      and r.workspace_id = new.workspace_id
      and r.state = 'revision_requested'
    order by r.decision_at desc nulls last
    limit 1;

    perform private.notify_mission_workflow(
      'mission_revision_requested',
      new.mission_workflow_id,
      new.id,
      v_deadline,
      null,
      v_reason_category
    );
  elsif new.state = 'approved_to_publish' then
    select v.version_number into v_version_number
    from public.mission_draft_versions v
    where v.id = new.approved_version_id
      and v.mission_work_item_id = new.id
      and v.workspace_id = new.workspace_id;

    perform private.notify_mission_workflow(
      'mission_draft_approved',
      new.mission_workflow_id,
      new.id,
      new.deadline,
      v_version_number,
      null
    );
  end if;

  return new;
end;
$$;
drop trigger if exists mission_work_item_workflow_notifications on public.mission_work_items;
create trigger mission_work_item_workflow_notifications
after update of state on public.mission_work_items
for each row execute function private.notify_mission_work_item_transition();
create or replace function private.notify_mission_workflow_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state is distinct from new.state and new.state = 'approved_to_publish' then
    perform private.notify_mission_workflow('mission_approved_to_publish', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists mission_workflow_state_notifications on public.mission_workflows;
create trigger mission_workflow_state_notifications
after update of state on public.mission_workflows
for each row execute function private.notify_mission_workflow_transition();
create or replace function public.emit_active_mission_deadline_notifications(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_count integer := 0;
  v_type text;
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;

  for v_item in
    select i.id, i.mission_workflow_id, i.deadline
    from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id
     and w.workspace_id = i.workspace_id
    where i.required
      and i.deadline is not null
      and i.state in ('drafting', 'revision_requested')
      and w.state not in ('approved_to_publish', 'cancelled', 'expired')
      and i.deadline <= p_now + interval '24 hours'
  loop
    v_type := case
      when v_item.deadline < p_now then 'mission_deadline_overdue'
      else 'mission_deadline_approaching'
    end;
    if private.notify_mission_workflow(
      v_type,
      v_item.mission_workflow_id,
      v_item.id,
      v_item.deadline
    ) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;
revoke all on function private.notify_mission_workflow(text, uuid, uuid, timestamptz, integer, text) from public, anon, authenticated, service_role;
revoke all on function private.notify_mission_fulfillment_transition()
  from public, anon, authenticated, service_role;
revoke all on function private.notify_mission_work_item_transition()
  from public, anon, authenticated, service_role;
revoke all on function private.notify_mission_workflow_transition()
  from public, anon, authenticated, service_role;
revoke all on function public.emit_active_mission_deadline_notifications(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.emit_active_mission_deadline_notifications(timestamptz)
  to service_role;

-- SOURCE: derived-sql/20260719220000-migrate_pristine_joined_active_mission.sql; sha256=9e5e027d31219f88ba127f236bddaacbc2e0520266a4bfa9b819c3b8f339bc3d
-- Explicit rollout-only conversion for pristine legacy assignment anchors.
-- Existing workflow history and the legacy reward anchor remain immutable.
create or replace function public.migrate_pristine_joined_active_mission(p_submission uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.mission_submissions;
  v_workflow public.mission_workflows;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'not_authorized';
  end if;

  -- Match private.create_mission_workflow's first lock so concurrent rollout,
  -- join, and workflow creation attempts serialize on the same anchor row.
  select * into v_submission
  from public.mission_submissions
  where id = p_submission
  for update;

  if v_submission.id is null then
    raise exception 'not_found';
  end if;

  if v_submission.status <> 'joined'
    or coalesce(cardinality(v_submission.content_urls), 0) <> 0
    or v_submission.submission_data <> '{}'::jsonb
    or v_submission.reviewer_notes is not null
    or v_submission.submitted_at is not null
    or v_submission.reviewed_at is not null
    or v_submission.review_deadline is not null
    or v_submission.points_awarded <> 0
    or v_submission.xp_awarded <> 0
    or v_submission.quality_rating is not null
  then
    raise exception 'wrong_state';
  end if;

  -- This administrative migration is intentionally not idempotent: an
  -- existing workflow proves that the legacy record is no longer pristine.
  if exists (
    select 1
    from public.mission_workflows
    where mission_submission_id = v_submission.id
  ) then
    raise exception 'wrong_state';
  end if;

  v_workflow := private.create_mission_workflow(p_submission);

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, actor_type, actor_id, event_type,
    entity_type, entity_id, metadata
  ) values (
    v_submission.workspace_id, v_workflow.id, 'system', null,
    'legacy_submission_migrated', 'mission_submission', v_submission.id,
    jsonb_build_object('source_status', v_submission.status)
  );

  return v_workflow;
end;
$$;
comment on function public.migrate_pristine_joined_active_mission(uuid) is
  'Service-only rollout conversion for a locked, pristine joined legacy submission.';
revoke all on function public.migrate_pristine_joined_active_mission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.migrate_pristine_joined_active_mission(uuid) to service_role;

-- SOURCE: derived-sql/20260720033542-final_review_active_mission_contracts.sql; sha256=5de463933dce75652b312866a0b9c5373be7f45743a4359075aab0b56d003fe9
-- Final whole-branch review corrections for creator draft, submission, and review contracts.
-- This migration is intentionally forward-only: earlier deployed definitions remain immutable history.

create extension if not exists pgcrypto with schema extensions;
create table if not exists private.mission_draft_submission_idempotency (
  mission_work_item_id uuid not null references public.mission_work_items(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  content_checksum text not null check (btrim(content_checksum) <> ''),
  mission_draft_version_id uuid not null references public.mission_draft_versions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (mission_work_item_id, idempotency_key)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.mission_draft_submission_idempotency FROM PUBLIC, anon, authenticated, service_role;

revoke all on table private.mission_draft_submission_idempotency
  from public, anon, authenticated, service_role;
create or replace function private.submit_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_draft public.mission_working_drafts;
  v_prior_round public.mission_review_rounds;
  v_version public.mission_draft_versions;
  v_round integer;
  v_version_number integer;
  v_ready_count integer;
  v_completed integer;
  v_granted integer;
  v_asset_checksums jsonb;
  v_canonical jsonb;
  v_content_checksum text;
begin
  if btrim(coalesce(p_idempotency_key, '')) = '' or length(p_idempotency_key) > 200 then
    raise exception 'idempotency_key_required';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'validation_failed';
  end if;

  -- One lock order is shared with autosave and operator review: workflow, item, draft.
  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where w.mission_submission_id = p_submission
    and w.workspace_id = p_workspace
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = v_workflow.id
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;

  -- The same key always resolves to its original immutable response, regardless of later state.
  select v.* into v_version
  from private.mission_draft_submission_idempotency a
  join public.mission_draft_versions v
    on v.id = a.mission_draft_version_id
    and v.mission_work_item_id = a.mission_work_item_id
    and v.workspace_id = a.workspace_id
  where a.mission_work_item_id = v_item.id
    and a.workspace_id = p_workspace
    and a.idempotency_key = p_idempotency_key
  for update of a, v;
  if v_version.id is not null then
    return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
  end if;

  -- Backfill compatibility for attempts created by the superseded migration.
  select v.* into v_version
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id
    and v.workspace_id = p_workspace
    and v.submission_idempotency_key = p_idempotency_key
  for update of v;
  if v_version.id is not null then
    insert into private.mission_draft_submission_idempotency (
      mission_work_item_id, workspace_id, idempotency_key, content_checksum, mission_draft_version_id
    ) values (
      v_item.id, p_workspace, p_idempotency_key, v_version.content_checksum, v_version.id
    ) on conflict (mission_work_item_id, idempotency_key) do nothing;
    return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
  end if;

  select d.* into v_draft
  from public.mission_working_drafts d
  where d.mission_work_item_id = v_item.id
    and d.workspace_id = p_workspace
    and d.archived_at is null
  for update of d;
  if v_draft.id is null then raise exception 'not_found'; end if;
  if v_draft.revision <> p_expected_revision then raise exception 'stale_revision'; end if;

  if (v_item.deadline is not null and v_item.deadline <= v_now)
     or (v_workflow.deadline is not null and v_workflow.deadline <= v_now) then
    raise exception 'deadline_passed';
  end if;

  if v_item.state = 'revision_requested' then
    select r.* into v_prior_round
    from public.mission_review_rounds r
    where r.mission_work_item_id = v_item.id
      and r.workspace_id = p_workspace
      and r.state = 'revision_requested'
    order by r.round_number desc
    limit 1
    for update of r;
    if v_prior_round.id is null then raise exception 'wrong_state'; end if;
    if v_prior_round.creator_response_deadline is null
       or v_prior_round.creator_response_deadline <= v_now then
      raise exception 'deadline_passed';
    end if;
    select count(*) into v_completed
    from public.mission_review_rounds r
    where r.mission_work_item_id = v_item.id
      and r.workspace_id = p_workspace
      and r.state = 'revision_requested';
    select coalesce(sum(g.granted_count), 0) into v_granted
    from public.mission_revision_grants g
    where g.mission_work_item_id = v_item.id and g.workspace_id = p_workspace;
    if v_completed > v_workflow.revision_limit + v_granted then
      raise exception 'revision_limit_reached';
    end if;
  elsif v_item.state <> 'drafting' and v_item.state not in ('submitted', 'under_review') then
    raise exception 'wrong_state';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_item.requirements_snapshot) requirement
    where coalesce((requirement ->> 'required')::boolean, true)
      and coalesce(v_draft.checklist_answers -> (requirement ->> 'id'), 'false'::jsonb) <> 'true'::jsonb
  ) then raise exception 'checklist_incomplete'; end if;

  if exists (
    select 1 from public.mission_draft_assets a
    where a.mission_work_item_id = v_item.id
      and a.workspace_id = p_workspace
      and a.mission_draft_version_id is null
      and a.deleted_at is null
      and a.upload_state <> 'deleted'
      and (a.upload_state <> 'ready' or coalesce(btrim(a.checksum), '') = '')
  ) then raise exception 'assets_not_ready'; end if;

  select count(*),
         coalesce(
           jsonb_agg(lower(btrim(a.checksum)) order by lower(btrim(a.checksum)), a.id),
           '[]'::jsonb
         )
    into v_ready_count, v_asset_checksums
  from public.mission_draft_assets a
  where a.mission_work_item_id = v_item.id
    and a.workspace_id = p_workspace
    and a.mission_draft_version_id is null
    and a.deleted_at is null
    and a.upload_state = 'ready';

  if btrim(coalesce(v_draft.caption_text, '')) = ''
     and btrim(coalesce(v_draft.external_draft_url, '')) = ''
     and v_ready_count = 0 then
    raise exception 'submission_content_required';
  end if;

  v_canonical := jsonb_build_object(
    'caption', regexp_replace(btrim(coalesce(v_draft.caption_text, '')), E'\\r\\n?', E'\\n', 'g'),
    'external_url', btrim(coalesce(v_draft.external_draft_url, '')),
    'checklist', v_draft.checklist_answers,
    'asset_checksums', v_asset_checksums
  );
  v_content_checksum := encode(
    extensions.digest(convert_to(v_canonical::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select v.* into v_version
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id
    and v.workspace_id = p_workspace
    and v.content_checksum = v_content_checksum
  for update of v;
  if v_version.id is not null then
    if v_item.current_submitted_version_id = v_version.id
       and v_item.state in ('submitted', 'under_review') then
      insert into private.mission_draft_submission_idempotency (
        mission_work_item_id, workspace_id, idempotency_key, content_checksum, mission_draft_version_id
      ) values (
        v_item.id, p_workspace, p_idempotency_key, v_content_checksum, v_version.id
      ) on conflict (mission_work_item_id, idempotency_key) do nothing;
      return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
    end if;
    raise exception 'duplicate_content';
  end if;

  if v_item.state not in ('drafting', 'revision_requested') then raise exception 'wrong_state'; end if;

  select coalesce(max(v.version_number), 0) + 1 into v_version_number
  from public.mission_draft_versions v
  where v.mission_work_item_id = v_item.id and v.workspace_id = p_workspace;

  insert into public.mission_draft_versions (
    workspace_id, mission_work_item_id, version_number, caption_snapshot,
    external_draft_url_snapshot, checklist_snapshot, submitted_by,
    content_checksum, submission_idempotency_key
  ) values (
    p_workspace, v_item.id, v_version_number, v_draft.caption_text,
    v_draft.external_draft_url, v_draft.checklist_answers, p_creator,
    v_content_checksum, p_idempotency_key
  ) returning * into v_version;

  update public.mission_draft_assets
  set mission_draft_version_id = v_version.id, retained_at = v_now
  where mission_work_item_id = v_item.id
    and workspace_id = p_workspace
    and upload_state = 'ready'
    and deleted_at is null
    and mission_draft_version_id is null;

  select coalesce(max(r.round_number), 0) + 1 into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = v_item.id and r.workspace_id = p_workspace;

  insert into public.mission_review_rounds (
    workspace_id, mission_work_item_id, mission_draft_version_id, round_number, state,
    reviewer_id, review_started_at, decision_at, creator_response_deadline
  ) values (
    p_workspace, v_item.id, v_version.id, v_round, 'open', null, null, null, null
  );

  update public.mission_work_items
  set state = 'submitted',
      current_submitted_version_id = v_version.id,
      current_reviewer_id = null,
      review_started_at = null,
      review_due_at = null,
      updated_at = v_now
  where id = v_item.id and mission_workflow_id = v_workflow.id and workspace_id = p_workspace
  returning * into v_item;

  insert into private.mission_draft_submission_idempotency (
    mission_work_item_id, workspace_id, idempotency_key, content_checksum, mission_draft_version_id
  ) values (
    v_item.id, p_workspace, p_idempotency_key, v_content_checksum, v_version.id
  );

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id,
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, v_workflow.id, v_item.id,
    'creator', p_creator, 'draft_submitted', 'mission_draft_version', v_version.id,
    jsonb_build_object('version_number', v_version.version_number, 'review_round', v_round)
  );

  perform private.refresh_mission_workflow_state(v_workflow.id);
  return jsonb_build_object('version', to_jsonb(v_version), 'work_item', to_jsonb(v_item));
end;
$$;
create or replace function public.submit_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  return private.submit_active_mission_draft(
    p_submission, p_creator, p_workspace, p_work_item, p_expected_revision, p_idempotency_key
  );
end;
$$;
create or replace function private.save_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_draft public.mission_working_drafts;
begin
  if p_expected_revision is null or p_expected_revision < 0
     or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'validation_failed';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) key
    where key not in ('caption', 'externalUrl', 'checklist')
  ) then raise exception 'validation_failed'; end if;
  if p_patch ? 'caption'
     and (jsonb_typeof(p_patch -> 'caption') <> 'string' or length(p_patch ->> 'caption') > 10000) then
    raise exception 'validation_failed';
  end if;
  if p_patch ? 'externalUrl'
     and jsonb_typeof(p_patch -> 'externalUrl') not in ('string', 'null') then
    raise exception 'validation_failed';
  end if;
  if p_patch ? 'externalUrl'
     and jsonb_typeof(p_patch -> 'externalUrl') = 'string'
     and (length(p_patch ->> 'externalUrl') > 2048 or (p_patch ->> 'externalUrl') !~* '^https?://') then
    raise exception 'validation_failed';
  end if;
  if p_patch ? 'checklist'
     and jsonb_typeof(p_patch -> 'checklist') <> 'object' then
    raise exception 'validation_failed';
  end if;

  select w.* into v_workflow
  from public.mission_workflows w
  join public.mission_submissions s
    on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
  where w.mission_submission_id = p_submission
    and w.workspace_id = p_workspace
    and s.creator_id = p_creator
    and s.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = v_workflow.id
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;

  select d.* into v_draft
  from public.mission_working_drafts d
  where d.mission_work_item_id = v_item.id
    and d.workspace_id = p_workspace
    and d.archived_at is null
  for update of d;
  if v_draft.id is null then raise exception 'not_found'; end if;

  if v_item.state not in ('drafting', 'revision_requested') then
    return jsonb_build_object('code', 'WRONG_STATE', 'current_draft', to_jsonb(v_draft));
  end if;
  if v_draft.revision <> p_expected_revision then
    return jsonb_build_object('code', 'WORKFLOW_STALE', 'current_draft', to_jsonb(v_draft));
  end if;

  if p_patch ? 'checklist' and exists (
    select 1 from jsonb_each(p_patch -> 'checklist') answer
    where jsonb_typeof(answer.value) <> 'boolean'
       or not exists (
         select 1 from jsonb_array_elements(v_item.requirements_snapshot) requirement
         where requirement ->> 'id' = answer.key
       )
  ) then raise exception 'validation_failed'; end if;

  update public.mission_working_drafts
  set caption_text = case when p_patch ? 'caption' then p_patch ->> 'caption' else caption_text end,
      external_draft_url = case
        when not (p_patch ? 'externalUrl') then external_draft_url
        when jsonb_typeof(p_patch -> 'externalUrl') = 'null' then null
        else p_patch ->> 'externalUrl'
      end,
      checklist_answers = case when p_patch ? 'checklist' then p_patch -> 'checklist' else checklist_answers end,
      revision = revision + 1,
      last_saved_at = now()
  where id = v_draft.id and workspace_id = p_workspace
  returning * into v_draft;

  return jsonb_build_object('draft', to_jsonb(v_draft));
end;
$$;
create or replace function public.save_active_mission_draft(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_revision integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  return private.save_active_mission_draft(
    p_submission, p_creator, p_workspace, p_work_item, p_expected_revision, p_patch
  );
end;
$$;
create or replace function private.start_mission_review(
  p_workflow uuid,
  p_work_item uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_review_due timestamptz;
begin
  perform private.assert_active_mission_operator(p_operator);

  select w.* into v_workflow
  from public.mission_workflows w
  where w.id = p_workflow and w.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state then raise exception 'stale'; end if;
  if v_item.current_submitted_version_id is null
     or v_item.state not in ('submitted', 'under_review') then
    raise exception 'wrong_state';
  end if;

  select v.* into v_version
  from public.mission_draft_versions v
  where v.id = v_item.current_submitted_version_id
    and v.mission_work_item_id = v_item.id
    and v.workspace_id = p_workspace
  for update of v;
  if v_version.id is null then raise exception 'stale'; end if;
  if exists (
    select 1 from public.mission_draft_versions newer
    where newer.mission_work_item_id = v_item.id
      and newer.workspace_id = p_workspace
      and newer.version_number > v_version.version_number
  ) then raise exception 'stale'; end if;

  select r.* into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = v_item.id
    and r.mission_draft_version_id = v_version.id
    and r.workspace_id = p_workspace
    and r.state = 'open'
  for update of r;
  if v_round.id is null then raise exception 'wrong_state'; end if;

  if v_item.state = 'under_review' then
    if v_item.current_reviewer_id <> p_operator
       or v_round.reviewer_id <> p_operator
       or v_round.review_started_at is null then
      raise exception 'stale';
    end if;
    return v_item;
  end if;
  if v_round.reviewer_id is not null or v_round.review_started_at is not null then
    raise exception 'stale';
  end if;

  v_review_due := v_now + make_interval(hours => v_workflow.review_sla_hours);
  if v_item.deadline is not null then v_review_due := least(v_review_due, v_item.deadline); end if;
  if v_workflow.deadline is not null then v_review_due := least(v_review_due, v_workflow.deadline); end if;

  update public.mission_review_rounds
  set reviewer_id = p_operator, review_started_at = v_now
  where id = v_round.id and workspace_id = p_workspace
  returning * into v_round;

  update public.mission_work_items
  set state = 'under_review',
      current_reviewer_id = p_operator,
      review_started_at = v_now,
      review_due_at = v_review_due,
      updated_at = v_now
  where id = v_item.id and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_review_started', 'mission_draft_version', v_version.id,
    jsonb_build_object('round_number', v_round.round_number)
  );

  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;
create or replace function public.start_mission_review(
  p_workflow uuid,
  p_work_item uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.start_mission_review(
    p_workflow, p_work_item, p_operator, p_workspace, p_expected_state
  );
end;
$$;
create or replace function private.request_mission_revision(
  p_workflow uuid,
  p_work_item uuid,
  p_version uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text,
  p_deadline timestamptz,
  p_items jsonb
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_completed integer;
  v_granted integer;
  v_allowed_deadline timestamptz;
  v_effective_deadline timestamptz;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'validation_failed';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where coalesce(btrim(x ->> 'text'), '') = ''
       or coalesce((x ->> 'required')::boolean, true) is not true
       or coalesce(x ->> 'category', '') not in ('format', 'key_message', 'compliance', 'quality', 'other')
  ) then raise exception 'validation_failed'; end if;

  select w.* into v_workflow
  from public.mission_workflows w
  where w.id = p_workflow and w.workspace_id = p_workspace
  for update of w;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select i.* into v_item
  from public.mission_work_items i
  where i.id = p_work_item
    and i.mission_workflow_id = p_workflow
    and i.workspace_id = p_workspace
  for update of i;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state or v_item.current_submitted_version_id <> p_version then
    raise exception 'stale';
  end if;
  if v_item.state <> 'under_review' or v_item.current_reviewer_id <> p_operator then
    raise exception 'wrong_state';
  end if;

  v_allowed_deadline := v_now + make_interval(hours => v_workflow.revision_response_hours);
  if v_item.deadline is not null then
    v_allowed_deadline := least(v_allowed_deadline, v_item.deadline);
  end if;
  if v_workflow.deadline is not null then
    v_allowed_deadline := least(v_allowed_deadline, v_workflow.deadline);
  end if;
  if v_allowed_deadline <= v_now then raise exception 'deadline_passed'; end if;
  v_effective_deadline := coalesce(p_deadline, v_allowed_deadline);
  if v_effective_deadline <= v_now or p_deadline > v_allowed_deadline then
    raise exception 'validation_failed';
  end if;

  select v.* into v_version
  from public.mission_draft_versions v
  where v.id = p_version
    and v.mission_work_item_id = p_work_item
    and v.workspace_id = p_workspace
  for update of v;
  if v_version.id is null then raise exception 'stale'; end if;

  select r.* into v_round
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.mission_draft_version_id = p_version
    and r.workspace_id = p_workspace
    and r.state = 'open'
  for update of r;
  if v_round.id is null or v_round.reviewer_id <> p_operator
     or v_round.review_started_at is null then
    raise exception 'wrong_state';
  end if;

  select count(*) into v_completed
  from public.mission_review_rounds r
  where r.mission_work_item_id = p_work_item
    and r.workspace_id = p_workspace
    and r.state = 'revision_requested';
  select coalesce(sum(g.granted_count), 0) into v_granted
  from public.mission_revision_grants g
  where g.mission_work_item_id = p_work_item and g.workspace_id = p_workspace;
  if v_completed >= v_workflow.revision_limit + v_granted then
    raise exception 'revision_limit_reached';
  end if;
  if v_round.round_number <> v_completed + 1 then raise exception 'stale'; end if;

  insert into public.mission_review_items (
    workspace_id, mission_review_round_id, requirement_id, category,
    required_change_text, required, position
  )
  select p_workspace, v_round.id,
    nullif(x.value ->> 'requirementId', '')::uuid,
    x.value ->> 'category', btrim(x.value ->> 'text'), true, (x.ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as x(value, ordinality);

  update public.mission_review_rounds
  set state = 'revision_requested',
      reviewer_id = p_operator,
      decision_at = v_now,
      creator_response_deadline = v_effective_deadline
  where id = v_round.id and workspace_id = p_workspace;

  update public.mission_working_drafts
  set caption_text = v_version.caption_snapshot,
      external_draft_url = v_version.external_draft_url_snapshot,
      checklist_answers = v_version.checklist_snapshot,
      revision = revision + 1,
      last_saved_at = v_now
  where mission_work_item_id = p_work_item
    and workspace_id = p_workspace
    and archived_at is null;

  update public.mission_work_items
  set state = 'revision_requested', current_reviewer_id = p_operator, updated_at = v_now
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_revision_requested', 'mission_review_round', v_round.id,
    jsonb_build_object('round_number', v_round.round_number, 'deadline', v_effective_deadline)
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;
create or replace function public.request_mission_revision(
  p_workflow uuid,
  p_work_item uuid,
  p_version uuid,
  p_operator uuid,
  p_workspace uuid,
  p_expected_state text,
  p_deadline timestamptz,
  p_items jsonb
)
returns public.mission_work_items
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.request_mission_revision(
    p_workflow, p_work_item, p_version, p_operator, p_workspace,
    p_expected_state, p_deadline, p_items
  );
end;
$$;
revoke all on function private.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function private.save_active_mission_draft(uuid, uuid, uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.save_active_mission_draft(uuid, uuid, uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.start_mission_review(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.start_mission_review(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.request_mission_revision(uuid, uuid, uuid, uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.request_mission_revision(uuid, uuid, uuid, uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_active_mission_draft(uuid, uuid, uuid, uuid, integer, text)
  to service_role;
grant execute on function public.save_active_mission_draft(uuid, uuid, uuid, uuid, integer, jsonb)
  to service_role;
grant execute on function public.start_mission_review(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.request_mission_revision(uuid, uuid, uuid, uuid, uuid, text, timestamptz, jsonb)
  to service_role;

-- SOURCE: derived-sql/20260720175319-grant_service_role_budget_read.sql; sha256=d7e9f431f9effb2f3473ea1f2514c58c8cf6e2c2c7110ac44db9a7626d68955f
-- Backend reward snapshots need explicit access when auto_expose_new_tables is disabled.
grant select on table
  public.workspace_budgets,
  public.workspace_budget_transactions to service_role;

-- SOURCE: derived-sql/20260720193637-resolve_mission_submission_relationships.sql; sha256=dc11810d4a78ccb17605c8eedc718cbe4d257cbe58edd5c31aab3406f0e6eb9e
-- Preserve cross-workspace campaign participation while keeping each
-- submission bound to the workspace of its mission.
alter table public.mission_submissions
  drop constraint if exists mission_submissions_creator_workspace_fk,
  drop constraint if exists mission_submissions_mission_id_fkey;
alter table public.mission_workflows
  drop constraint if exists mission_workflows_mission_submission_id_fkey;

-- SOURCE: derived-sql/20260723090000-publication_proof_validation.sql; sha256=166f8a237961003e4a8a0c6d9d1c6ddc7139645107b8de4800462c7317c05c9b
-- Publication proof validation foundation.
-- Lifecycle mutations are intentionally deferred; these rows are service-owned snapshots and history.

alter table public.mission_deliverable_templates
  add column publication_instructions text not null default 'Publish the approved content'
    check (btrim(publication_instructions) <> ''),
  add column publication_window_hours integer not null default 72
    check (publication_window_hours > 0),
  add column required_disclosures jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_disclosures) = 'array'),
  add column expected_account text
    check (expected_account is null or btrim(expected_account) <> ''),
  add column proof_evidence_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proof_evidence_policy) = 'object');
alter table public.mission_work_items
  add column current_proof_attempt_id uuid,
  add column verified_proof_attempt_id uuid;
create table public.mission_publication_instructions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_work_item_id uuid not null,
  publication_instructions text not null check (btrim(publication_instructions) <> ''),
  publication_window_hours integer not null check (publication_window_hours > 0),
  required_disclosures jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_disclosures) = 'array'),
  expected_account text check (expected_account is null or btrim(expected_account) <> ''),
  proof_evidence_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proof_evidence_policy) = 'object'),
  publication_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mission_publication_instructions_work_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade,
  unique (workspace_id, mission_work_item_id),
  unique (workspace_id, id),
  unique (id, workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_publication_instructions FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_publication_proof_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mission_work_item_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  primary_url text not null check (primary_url ~ '^https://'),
  additional_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(additional_urls) = 'array'),
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  submitted_late boolean not null,
  metadata_status text not null check (metadata_status in ('available','unavailable','unsafe')),
  metadata_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata_snapshot) = 'object'),
  metadata_error_category text check (metadata_error_category is null or btrim(metadata_error_category) <> ''),
  content_checksum text not null check (btrim(content_checksum) <> ''),
  submission_idempotency_key uuid not null,
  constraint mission_publication_proof_attempts_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint mission_publication_proof_attempts_work_item_workspace_fk
    foreign key (mission_work_item_id, workspace_id)
    references public.mission_work_items(id, workspace_id) on delete cascade,
  constraint mission_publication_proof_attempts_submitter_workspace_fk
    foreign key (submitted_by, workspace_id)
    references public.creators(id, workspace_id),
  unique (workspace_id, mission_work_item_id, attempt_number),
  unique (workspace_id, mission_work_item_id, submission_idempotency_key),
  unique (workspace_id, id),
  unique (id, workspace_id),
  unique (id, mission_work_item_id, workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_publication_proof_attempts FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_publication_proof_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mission_publication_proof_attempt_id uuid not null,
  storage_object_path text not null unique check (btrim(storage_object_path) <> ''),
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  content_checksum text not null check (btrim(content_checksum) <> ''),
  created_at timestamptz not null default now(),
  constraint mission_publication_proof_assets_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint mission_publication_proof_assets_attempt_workspace_fk
    foreign key (mission_publication_proof_attempt_id, workspace_id)
    references public.mission_publication_proof_attempts(id, workspace_id) on delete cascade,
  unique (workspace_id, id),
  unique (id, workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_publication_proof_assets FROM PUBLIC, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.brand_users'::regclass
      and conname = 'brand_users_user_workspace_unique'
  ) then
    alter table public.brand_users
      add constraint brand_users_user_workspace_unique unique (user_id, workspace_id);
  end if;
end;
$$;
create table public.mission_publication_proof_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mission_publication_proof_attempt_id uuid not null,
  review_number integer not null default 1 check (review_number > 0),
  state text not null default 'open' check (state in ('open', 'correction_requested', 'verified')),
  decision text check (decision is null or decision in ('verified', 'rejected')),
  reviewer_id uuid,
  reviewed_at timestamptz,
  summary text check (summary is null or btrim(summary) <> ''),
  created_at timestamptz not null default now(),
  constraint mission_publication_proof_reviews_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint mission_publication_proof_reviews_attempt_workspace_fk
    foreign key (mission_publication_proof_attempt_id, workspace_id)
    references public.mission_publication_proof_attempts(id, workspace_id) on delete cascade,
  constraint mission_publication_proof_reviews_reviewer_workspace_fk
    foreign key (reviewer_id, workspace_id)
    references public.brand_users(user_id, workspace_id),
  unique (workspace_id, id),
  unique (id, workspace_id),
  unique (workspace_id, mission_publication_proof_attempt_id, review_number)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_publication_proof_reviews FROM PUBLIC, anon, authenticated, service_role;

create unique index mission_publication_proof_reviews_one_terminal_decision_idx
  on public.mission_publication_proof_reviews (workspace_id, mission_publication_proof_attempt_id)
  where decision in ('verified', 'rejected');
create table public.mission_publication_proof_review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  mission_publication_proof_review_id uuid not null,
  category text not null check (category in ('disclosure', 'account', 'content', 'url', 'metadata', 'other')),
  finding_text text not null check (btrim(finding_text) <> ''),
  passed boolean not null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint mission_publication_proof_review_items_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint mission_publication_proof_review_items_review_workspace_fk
    foreign key (mission_publication_proof_review_id, workspace_id)
    references public.mission_publication_proof_reviews(id, workspace_id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, mission_publication_proof_review_id, position)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_publication_proof_review_items FROM PUBLIC, anon, authenticated, service_role;

alter table public.mission_work_items
  add constraint mission_work_items_current_proof_attempt_fk
    foreign key (current_proof_attempt_id, id, workspace_id)
    references public.mission_publication_proof_attempts(id, mission_work_item_id, workspace_id),
  add constraint mission_work_items_verified_proof_attempt_fk
    foreign key (verified_proof_attempt_id, id, workspace_id)
    references public.mission_publication_proof_attempts(id, mission_work_item_id, workspace_id);
create index mission_work_items_current_proof_attempt_idx
  on public.mission_work_items (current_proof_attempt_id)
  where current_proof_attempt_id is not null;
create index mission_publication_instructions_due_at_idx
  on public.mission_publication_instructions (publication_due_at);
create index mission_publication_proof_attempts_late_idx
  on public.mission_publication_proof_attempts (submitted_at)
  where submitted_late;
create index mission_publication_proof_attempts_metadata_status_idx
  on public.mission_publication_proof_attempts (metadata_status, submitted_at);
create index mission_publication_proof_reviews_reviewer_idx
  on public.mission_publication_proof_reviews (reviewer_id, reviewed_at desc);
alter table public.mission_publication_instructions enable row level security;
alter table public.mission_publication_proof_attempts enable row level security;
alter table public.mission_publication_proof_assets enable row level security;
alter table public.mission_publication_proof_reviews enable row level security;
alter table public.mission_publication_proof_review_items enable row level security;
create policy mission_publication_instructions_creator_read on public.mission_publication_instructions
  for select to authenticated using (exists (
    select 1
    from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_publication_instructions.mission_work_item_id
      and i.workspace_id = mission_publication_instructions.workspace_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_publication_proof_attempts_creator_read on public.mission_publication_proof_attempts
  for select to authenticated using (exists (
    select 1
    from public.mission_work_items i
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where i.id = mission_publication_proof_attempts.mission_work_item_id
      and i.workspace_id = mission_publication_proof_attempts.workspace_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_publication_proof_assets_creator_read on public.mission_publication_proof_assets
  for select to authenticated using (exists (
    select 1
    from public.mission_publication_proof_attempts a
    join public.mission_work_items i
      on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where a.id = mission_publication_proof_assets.mission_publication_proof_attempt_id
      and a.workspace_id = mission_publication_proof_assets.workspace_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_publication_proof_reviews_creator_read on public.mission_publication_proof_reviews
  for select to authenticated using (exists (
    select 1
    from public.mission_publication_proof_attempts a
    join public.mission_work_items i
      on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where a.id = mission_publication_proof_reviews.mission_publication_proof_attempt_id
      and a.workspace_id = mission_publication_proof_reviews.workspace_id
      and s.creator_id = (select auth.uid())
  ));
create policy mission_publication_proof_review_items_creator_read on public.mission_publication_proof_review_items
  for select to authenticated using (exists (
    select 1
    from public.mission_publication_proof_reviews r
    join public.mission_publication_proof_attempts a
      on a.id = r.mission_publication_proof_attempt_id and a.workspace_id = r.workspace_id
    join public.mission_work_items i
      on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
    join public.mission_workflows w
      on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
    join public.mission_submissions s
      on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
    where r.id = mission_publication_proof_review_items.mission_publication_proof_review_id
      and r.workspace_id = mission_publication_proof_review_items.workspace_id
      and s.creator_id = (select auth.uid())
  ));
-- Creator clients may read their own publication history. All table mutations stay service-only.
revoke all on table
  public.mission_publication_instructions,
  public.mission_publication_proof_attempts,
  public.mission_publication_proof_assets,
  public.mission_publication_proof_reviews,
  public.mission_publication_proof_review_items
from public, anon, authenticated;
grant select on table
  public.mission_publication_instructions,
  public.mission_publication_proof_attempts,
  public.mission_publication_proof_assets,
  public.mission_publication_proof_reviews,
  public.mission_publication_proof_review_items
  to authenticated;
grant all on table
  public.mission_publication_instructions,
  public.mission_publication_proof_attempts,
  public.mission_publication_proof_assets,
  public.mission_publication_proof_reviews,
  public.mission_publication_proof_review_items
  to service_role;
create trigger mission_publication_instructions_immutable
  before update or delete on public.mission_publication_instructions
  for each row execute function private.raise_immutable_record();
create trigger mission_publication_proof_attempts_immutable
  before update or delete on public.mission_publication_proof_attempts
  for each row execute function private.raise_immutable_record();
create trigger mission_publication_proof_assets_immutable
  before update or delete on public.mission_publication_proof_assets
  for each row execute function private.raise_immutable_record();
create trigger mission_publication_proof_reviews_immutable
  before update or delete on public.mission_publication_proof_reviews
  for each row execute function private.raise_immutable_record();
create trigger mission_publication_proof_review_items_immutable
  before update or delete on public.mission_publication_proof_review_items
  for each row execute function private.raise_immutable_record();
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mission-publication-proof-assets',
  'mission-publication-proof-assets',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy mission_publication_proof_assets_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'mission-publication-proof-assets'
    and exists (
      select 1
      from public.mission_publication_proof_assets pa
      join public.mission_publication_proof_attempts a
        on a.id = pa.mission_publication_proof_attempt_id and a.workspace_id = pa.workspace_id
      join public.mission_work_items i
        on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
      join public.mission_workflows w
        on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
      join public.mission_submissions s
        on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
      where pa.storage_object_path = name
        and s.creator_id = (select auth.uid())
    )
  );
create policy mission_publication_proof_assets_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'mission-publication-proof-assets'
    and exists (
      select 1
      from public.mission_publication_proof_assets pa
      join public.mission_publication_proof_attempts a
        on a.id = pa.mission_publication_proof_attempt_id and a.workspace_id = pa.workspace_id
      join public.mission_work_items i
        on i.id = a.mission_work_item_id and i.workspace_id = a.workspace_id
      join public.mission_workflows w
        on w.id = i.mission_workflow_id and w.workspace_id = i.workspace_id
      join public.mission_submissions s
        on s.id = w.mission_submission_id and s.workspace_id = w.workspace_id
      where pa.storage_object_path = name
        and s.creator_id = (select auth.uid())
    )
  );
-- Phase 3 publication policy authoring, per-work-item snapshots, guarded override, and approval freeze.
alter table public.mission_publication_instructions
  alter column publication_due_at drop not null,
  add column platform text,
  add column source_template_id uuid,
  add column override_reason text check (override_reason is null or btrim(override_reason) <> ''),
  add column overridden_by uuid,
  add column overridden_at timestamptz,
  add column frozen_at timestamptz,
  add column revision integer not null default 0 check (revision >= 0),
  add column idempotency_keys uuid[] not null default '{}'::uuid[],
  add constraint mission_publication_instructions_source_template_workspace_fk
    foreign key (source_template_id, workspace_id)
    references public.mission_deliverable_templates(id, workspace_id) on delete set null (source_template_id),
  add constraint mission_publication_instructions_overridden_by_workspace_fk
    foreign key (overridden_by, workspace_id)
    references public.brand_users(user_id, workspace_id);
alter function private.author_mission_workflow(uuid, jsonb, jsonb, jsonb)
  rename to author_mission_workflow_phase2;
create or replace function private.author_mission_workflow(
  p_mission_id uuid, p_mission jsonb, p_policy jsonb, p_templates jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_mission_id uuid;
  v_template_json jsonb;
begin
  if jsonb_typeof(p_templates) <> 'array' then raise exception 'invalid_mission_authoring_payload'; end if;
  if p_policy->>'creator_workflow_mode' = 'active_workspace' and exists (
    select 1 from jsonb_array_elements(p_templates) template
    where not (template ? 'publication_instructions')
       or nullif(btrim(template->>'publication_instructions'), '') is null
       or not (template ? 'publication_window_hours')
       or coalesce((template->>'publication_window_hours') ~ '^[1-9][0-9]*$', false) is not true
       or not (template ? 'required_disclosures')
       or case when jsonb_typeof(template->'required_disclosures') = 'array' then exists (
            select 1 from jsonb_array_elements(template->'required_disclosures') disclosure
            where jsonb_typeof(disclosure) <> 'string' or nullif(btrim(disclosure #>> '{}'), '') is null
          ) else true end
       or (template ? 'expected_account' and jsonb_typeof(template->'expected_account') not in ('null', 'string'))
       or (jsonb_typeof(template->'expected_account') = 'string' and nullif(btrim(template->>'expected_account'), '') is null)
       or not (template ? 'proof_evidence_policy')
       or jsonb_typeof(template->'proof_evidence_policy') <> 'object'
  ) then raise exception 'active_publication_policy_incomplete'; end if;

  v_result := private.author_mission_workflow_phase2(p_mission_id, p_mission, p_policy, p_templates);
  v_mission_id := (v_result->>'id')::uuid;
  if p_policy->>'creator_workflow_mode' = 'active_workspace' then
    for v_template_json in select value from jsonb_array_elements(p_templates) loop
      update public.mission_deliverable_templates
      set publication_instructions = btrim(v_template_json->>'publication_instructions'),
          publication_window_hours = (v_template_json->>'publication_window_hours')::integer,
          required_disclosures = v_template_json->'required_disclosures',
          expected_account = nullif(btrim(v_template_json->>'expected_account'), ''),
          proof_evidence_policy = v_template_json->'proof_evidence_policy', updated_at = now()
      where mission_id = v_mission_id and (
        (v_template_json ? 'id' and id = (v_template_json->>'id')::uuid)
        or (not (v_template_json ? 'id') and position = (v_template_json->>'position')::integer)
      );
    end loop;
  end if;

  return v_result || jsonb_build_object('deliverable_templates', coalesce((
    select jsonb_agg(
      to_jsonb(template_row) - 'workspace_id' - 'mission_id' - 'created_at' - 'updated_at'
      || jsonb_build_object('requirements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', requirement_row.id, 'category', requirement_row.category,
          'text', requirement_row.requirement_text, 'required', requirement_row.required,
          'position', requirement_row.position
        ) order by requirement_row.position)
        from public.mission_deliverable_requirements requirement_row
        where requirement_row.mission_deliverable_template_id = template_row.id
      ), '[]'::jsonb)) order by template_row.position
    ) from public.mission_deliverable_templates template_row
    where template_row.mission_id = v_mission_id
  ), '[]'::jsonb));
end;
$$;
create or replace function public.author_mission_workflow(
  p_mission_id uuid, p_mission jsonb, p_policy jsonb, p_templates jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return private.author_mission_workflow(p_mission_id, p_mission, p_policy, p_templates);
end;
$$;
revoke all on function private.author_mission_workflow(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.author_mission_workflow(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.author_mission_workflow(uuid, jsonb, jsonb, jsonb) to service_role;
create or replace function private.snapshot_publication_instructions()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_template public.mission_deliverable_templates;
begin
  if new.source_template_id is null then return new; end if;
  select template.* into v_template
  from public.mission_deliverable_templates template
  join public.mission_workflows workflow
    on workflow.id = new.mission_workflow_id and workflow.workspace_id = new.workspace_id
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id and submission.workspace_id = workflow.workspace_id
  join public.missions mission
    on mission.id = submission.mission_id and mission.workspace_id = submission.workspace_id
  where template.id = new.source_template_id
    and template.workspace_id = new.workspace_id
    and mission.creator_workflow_mode = 'active_workspace';
  if v_template.id is null then return new; end if;
  insert into public.mission_publication_instructions (
    workspace_id, mission_work_item_id, platform, source_template_id,
    publication_instructions, publication_window_hours, required_disclosures,
    expected_account, proof_evidence_policy, publication_due_at
  ) values (
    new.workspace_id, new.id, coalesce(new.platform, v_template.platform), v_template.id,
    v_template.publication_instructions, v_template.publication_window_hours,
    v_template.required_disclosures, v_template.expected_account, v_template.proof_evidence_policy, null
  );
  return new;
end;
$$;
create trigger mission_work_items_snapshot_publication_instructions
  after insert on public.mission_work_items
  for each row execute function private.snapshot_publication_instructions();
drop trigger mission_publication_instructions_immutable on public.mission_publication_instructions;
create or replace function private.guard_publication_instruction_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'mission_publication_instructions_immutable'; end if;
  if old.frozen_at is not null then raise exception 'mission_publication_instructions_frozen'; end if;
  return new;
end;
$$;
create trigger mission_publication_instructions_immutable
  before update or delete on public.mission_publication_instructions
  for each row execute function private.guard_publication_instruction_mutation();
create or replace function private.set_publication_instructions(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid,
  p_expected_state text, p_expected_revision integer,
  p_idempotency_key uuid, p_instructions jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_reason text := nullif(btrim(p_instructions->>'override_reason'), '');
  v_changed boolean;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_expected_state is null or btrim(p_expected_state) = ''
    or p_expected_revision is null or p_expected_revision < 0 or p_idempotency_key is null
    or jsonb_typeof(p_instructions) <> 'object'
    or nullif(btrim(p_instructions->>'publication_instructions'), '') is null
    or coalesce((p_instructions->>'publication_window_hours') ~ '^[1-9][0-9]*$', false) is not true
    or (case when jsonb_typeof(p_instructions->'required_disclosures') = 'array' then exists (
      select 1 from jsonb_array_elements(p_instructions->'required_disclosures') disclosure
      where jsonb_typeof(disclosure) <> 'string' or nullif(btrim(disclosure #>> '{}'), '') is null
    ) else true end)
    or (p_instructions ? 'expected_account' and jsonb_typeof(p_instructions->'expected_account') not in ('null', 'string'))
    or (jsonb_typeof(p_instructions->'expected_account') = 'string' and nullif(btrim(p_instructions->>'expected_account'), '') is null)
    or jsonb_typeof(p_instructions->'proof_evidence_policy') <> 'object'
  then return jsonb_build_object('code', 'VALIDATION_FAILED'); end if;

  select workflow.* into v_workflow from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace for update;
  if v_workflow.id is null then return jsonb_build_object('code', 'WORKFLOW_NOT_FOUND'); end if;
  select item.* into v_item from public.mission_work_items item
  where item.id = p_work_item and item.mission_workflow_id = p_workflow and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then return jsonb_build_object('code', 'WORKFLOW_NOT_FOUND'); end if;
  select instruction.* into v_instruction from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item and instruction.workspace_id = p_workspace for update;
  if v_instruction.id is null then return jsonb_build_object('code', 'PUBLICATION_SETUP_REQUIRED'); end if;
  if p_idempotency_key = any(v_instruction.idempotency_keys) then
    return jsonb_build_object('instruction', to_jsonb(v_instruction));
  end if;
  if v_instruction.frozen_at is not null then return jsonb_build_object('code', 'WRONG_STATE'); end if;
  if v_item.state <> p_expected_state or v_instruction.revision <> p_expected_revision then
    return jsonb_build_object('code', 'WORKFLOW_STALE', 'current_instruction', to_jsonb(v_instruction));
  end if;
  if v_item.state = 'approved_to_publish' then return jsonb_build_object('code', 'WRONG_STATE'); end if;

  v_changed := v_instruction.publication_instructions is distinct from btrim(p_instructions->>'publication_instructions')
    or v_instruction.publication_window_hours is distinct from (p_instructions->>'publication_window_hours')::integer
    or v_instruction.required_disclosures is distinct from p_instructions->'required_disclosures'
    or v_instruction.expected_account is distinct from nullif(btrim(p_instructions->>'expected_account'), '')
    or v_instruction.proof_evidence_policy is distinct from p_instructions->'proof_evidence_policy';
  if not v_changed then
    update public.mission_publication_instructions
    set idempotency_keys = array_append(idempotency_keys, p_idempotency_key)
    where id = v_instruction.id and workspace_id = p_workspace
    returning * into v_instruction;
    return jsonb_build_object('instruction', to_jsonb(v_instruction));
  end if;
  if v_reason is null then raise exception 'override_reason_required'; end if;

  update public.mission_publication_instructions
  set publication_instructions = btrim(p_instructions->>'publication_instructions'),
      publication_window_hours = (p_instructions->>'publication_window_hours')::integer,
      required_disclosures = p_instructions->'required_disclosures',
      expected_account = nullif(btrim(p_instructions->>'expected_account'), ''),
      proof_evidence_policy = p_instructions->'proof_evidence_policy',
      override_reason = v_reason,
      overridden_by = p_operator,
      overridden_at = now(),
      revision = revision + 1,
      idempotency_keys = array_append(idempotency_keys, p_idempotency_key)
  where id = v_instruction.id and workspace_id = p_workspace
  returning * into v_instruction;
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_publication_instructions_overridden', 'mission_publication_instruction', v_instruction.id,
    jsonb_build_object('revision', v_instruction.revision)
  );
  return jsonb_build_object('instruction', to_jsonb(v_instruction));
end;
$$;
create or replace function public.set_publication_instructions(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid,
  p_expected_state text, p_expected_revision integer,
  p_idempotency_key uuid, p_instructions jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.set_publication_instructions(
    p_workspace, p_workflow, p_work_item, p_operator, p_expected_state,
    p_expected_revision, p_idempotency_key, p_instructions
  );
end;
$$;
revoke all on function private.set_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.set_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) to service_role;
create or replace function private.approve_mission_version(
  p_workflow uuid, p_work_item uuid, p_version uuid,
  p_operator uuid, p_workspace uuid, p_expected_state text
) returns public.mission_work_items
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_version public.mission_draft_versions;
  v_round public.mission_review_rounds;
  v_instruction public.mission_publication_instructions;
  v_publish_due_at timestamptz;
begin
  perform private.assert_active_mission_operator(p_operator);
  select workflow.* into v_workflow from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace for update;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select item.* into v_item from public.mission_work_items item
  where item.id = p_work_item and item.mission_workflow_id = p_workflow and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state or v_item.current_submitted_version_id <> p_version then raise exception 'stale'; end if;
  if v_item.state not in ('submitted', 'under_review') then raise exception 'wrong_state'; end if;

  select version.* into v_version from public.mission_draft_versions version
  where version.id = p_version and version.mission_work_item_id = p_work_item and version.workspace_id = p_workspace
  for update;
  if v_version.id is null then raise exception 'stale'; end if;
  if exists (
    select 1 from public.mission_draft_versions newer
    where newer.mission_work_item_id = p_work_item and newer.workspace_id = p_workspace
      and newer.version_number > v_version.version_number
  ) then raise exception 'stale'; end if;
  select round.* into v_round from public.mission_review_rounds round
  where round.mission_work_item_id = p_work_item and round.mission_draft_version_id = p_version
    and round.workspace_id = p_workspace and round.state = 'open' for update;
  if v_round.id is null then raise exception 'wrong_state'; end if;

  select instruction.* into v_instruction from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item and instruction.workspace_id = p_workspace for update;
  if v_instruction.id is null
     or nullif(btrim(v_instruction.publication_instructions), '') is null
     or v_instruction.publication_window_hours <= 0
     or jsonb_typeof(v_instruction.required_disclosures) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(v_instruction.required_disclosures) disclosure
       where jsonb_typeof(disclosure) <> 'string' or nullif(btrim(disclosure #>> '{}'), '') is null
     )
     or jsonb_typeof(v_instruction.proof_evidence_policy) <> 'object'
  then raise exception 'PUBLICATION_SETUP_REQUIRED'; end if;

  v_publish_due_at := v_now + make_interval(hours => v_instruction.publication_window_hours);
  if v_workflow.deadline is not null then v_publish_due_at := least(v_publish_due_at, v_workflow.deadline); end if;
  update public.mission_publication_instructions
  set publication_due_at = v_publish_due_at, frozen_at = coalesce(frozen_at, v_now)
  where id = v_instruction.id and frozen_at is null
  returning * into v_instruction;
  if v_instruction.publication_due_at is null then raise exception 'PUBLICATION_SETUP_REQUIRED'; end if;

  update public.mission_review_rounds
  set state = 'approved_to_publish', reviewer_id = p_operator,
      review_started_at = coalesce(review_started_at, v_now), decision_at = v_now
  where id = v_round.id and workspace_id = p_workspace;
  update public.mission_work_items
  set state = 'approved_to_publish', approved_version_id = p_version,
      current_reviewer_id = p_operator, updated_at = v_now
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_version_approved_to_publish', 'mission_draft_version', p_version,
    jsonb_build_object('publication_due_at', v_instruction.publication_due_at)
  );
  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_publication_instructions_frozen', 'mission_publication_instruction', v_instruction.id,
    jsonb_build_object('publication_due_at', v_instruction.publication_due_at)
  );
  perform private.refresh_mission_workflow_state(p_workflow);
  return v_item;
end;
$$;
create or replace function public.approve_mission_version(
  p_workflow uuid, p_work_item uuid, p_version uuid,
  p_operator uuid, p_workspace uuid, p_expected_state text
) returns public.mission_work_items
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.approve_mission_version(p_workflow, p_work_item, p_version, p_operator, p_workspace, p_expected_state);
end;
$$;
revoke all on function private.approve_mission_version(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.approve_mission_version(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_mission_version(uuid, uuid, uuid, uuid, uuid, text) to service_role;
create or replace function public.submit_mission_publication_proof(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid,
  p_proof jsonb,
  p_evidence_asset_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_attempt public.mission_publication_proof_attempts;
  v_attempt_number integer;
  v_evidence_count integer;
  v_unassigned_evidence_count integer;
  v_required_evidence boolean;
  v_evidence_checksums jsonb;
  v_content_checksum text;
  v_submitted_late boolean;
  v_canonical jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  if p_submission is null or p_creator is null or p_workspace is null or p_work_item is null
     or p_expected_revision is null or p_expected_revision < 0 or p_idempotency_key is null
     or p_expected_state not in ('approved_to_publish', 'proof_correction_requested')
     or jsonb_typeof(p_proof) <> 'object'
     or jsonb_typeof(p_proof->'primary_url') <> 'string'
     or nullif(btrim(p_proof->>'primary_url'), '') is null
     or jsonb_typeof(p_proof->'additional_urls') <> 'array'
     or jsonb_array_length(p_proof->'additional_urls') > 4
     or jsonb_typeof(p_proof->'metadata_snapshot') <> 'object'
     or jsonb_typeof(p_proof->'metadata_status') <> 'string'
     or p_proof->>'metadata_status' not in ('available', 'unavailable')
  then raise exception 'validation_failed'; end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  where workflow.mission_submission_id = p_submission
    and workflow.workspace_id = p_workspace
    and submission.creator_id = p_creator
  for update of workflow;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select item.* into v_item
  from public.mission_work_items item
  where item.id = p_work_item
    and item.mission_workflow_id = v_workflow.id
    and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then raise exception 'not_found'; end if;

  select instruction.* into v_instruction
  from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item
    and instruction.workspace_id = p_workspace
  for update;
  if v_instruction.id is null or v_instruction.frozen_at is null then
    return jsonb_build_object('code', 'PUBLICATION_SETUP_REQUIRED');
  end if;

  if exists (
    select 1 from unnest(coalesce(p_evidence_asset_ids, '{}'::uuid[])) left_id
    group by left_id having count(*) > 1
  ) then raise exception 'validation_failed'; end if;

  with locked_assets as (
    select asset.*
    from public.mission_publication_proof_assets asset
    where asset.id = any(coalesce(p_evidence_asset_ids, '{}'::uuid[]))
      and asset.workspace_id = p_workspace
      and asset.mission_submission_id = p_submission
      and asset.mission_workflow_id = v_workflow.id
      and asset.mission_work_item_id = p_work_item
      and asset.creator_id = p_creator
      and asset.upload_state = 'finalized'
      and asset.content_checksum is not null
    for update
  )
  select coalesce(jsonb_agg(asset.content_checksum order by asset.id), '[]'::jsonb),
         count(*)::integer,
         count(*) filter (where asset.mission_publication_proof_attempt_id is null)::integer
  into v_evidence_checksums, v_evidence_count, v_unassigned_evidence_count
  from locked_assets asset;
  if v_evidence_count <> cardinality(coalesce(p_evidence_asset_ids, '{}'::uuid[])) then
    raise exception 'evidence_invalid';
  end if;
  v_required_evidence := v_instruction.proof_evidence_policy <> '{}'::jsonb;
  if v_required_evidence and v_evidence_count = 0 then raise exception 'evidence_required'; end if;

  v_canonical := jsonb_build_object(
    'primary_url', p_proof->>'primary_url',
    'additional_urls', p_proof->'additional_urls',
    'evidence_checksums', v_evidence_checksums
  );
  v_content_checksum := encode(
    extensions.digest(convert_to(v_canonical::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select attempt.* into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.workspace_id = p_workspace
    and attempt.mission_work_item_id = p_work_item
    and attempt.submission_idempotency_key = p_idempotency_key;
  if v_attempt.id is not null then
    if v_attempt.content_checksum <> v_content_checksum then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('attempt', to_jsonb(v_attempt), 'idempotent', true);
  end if;

  select attempt.* into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.workspace_id = p_workspace
    and attempt.mission_work_item_id = p_work_item
    and attempt.content_checksum = v_content_checksum
    and v_item.state = 'proof_submitted'
    and attempt.id = v_item.current_proof_attempt_id
  order by attempt.attempt_number desc limit 1;
  if v_attempt.id is not null then
    return jsonb_build_object('attempt', to_jsonb(v_attempt), 'idempotent', true);
  end if;

  if v_unassigned_evidence_count <> v_evidence_count then
    raise exception 'evidence_invalid';
  end if;

  if v_item.state <> p_expected_state or v_instruction.revision <> p_expected_revision then
    return jsonb_build_object(
      'code', 'WORKFLOW_STALE',
      'current_publication', jsonb_build_object(
        'workItemId', v_item.id,
        'state', v_item.state,
        'revision', v_instruction.revision,
        'currentAttemptId', v_item.current_proof_attempt_id
      )
    );
  end if;

  select coalesce(max(attempt.attempt_number), 0) + 1 into v_attempt_number
  from public.mission_publication_proof_attempts attempt
  where attempt.workspace_id = p_workspace and attempt.mission_work_item_id = p_work_item;
  v_submitted_late := v_now > v_instruction.publication_due_at;

  insert into public.mission_publication_proof_attempts (
    workspace_id, mission_work_item_id, attempt_number, primary_url, additional_urls,
    submitted_by, submitted_at, submitted_late, metadata_status, metadata_snapshot,
    metadata_error_category, content_checksum, submission_idempotency_key
  ) values (
    p_workspace, p_work_item, v_attempt_number, p_proof->>'primary_url', p_proof->'additional_urls',
    p_creator, v_now, v_submitted_late, p_proof->>'metadata_status', p_proof->'metadata_snapshot',
    nullif(p_proof->>'metadata_error_category', ''), v_content_checksum, p_idempotency_key
  ) returning * into v_attempt;

  update public.mission_publication_proof_assets
  set mission_publication_proof_attempt_id = v_attempt.id
  where id = any(coalesce(p_evidence_asset_ids, '{}'::uuid[]))
    and workspace_id = p_workspace
    and creator_id = p_creator
    and upload_state = 'finalized'
    and mission_publication_proof_attempt_id is null;

  insert into public.mission_publication_proof_reviews (
    workspace_id, mission_publication_proof_attempt_id, review_number, state
  ) values (p_workspace, v_attempt.id, v_attempt_number, 'open');

  update public.mission_work_items
  set current_proof_attempt_id = v_attempt.id,
      state = 'proof_submitted',
      current_reviewer_id = null,
      review_started_at = null,
      review_due_at = null,
      updated_at = v_now
  where id = p_work_item and workspace_id = p_workspace;
  perform private.refresh_mission_workflow_state(v_workflow.id);

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, v_workflow.id, p_work_item, 'creator', p_creator,
    case when v_item.state = 'proof_correction_requested'
      then 'mission_publication_proof_resubmitted'
      else 'mission_publication_proof_submitted'
    end, 'mission_publication_proof_attempt', v_attempt.id,
    jsonb_build_object(
      'platform', v_item.platform, 'attempt_number', v_attempt_number,
      'submitted_late', v_submitted_late, 'evidence_count', v_evidence_count,
      'url_count', 1 + jsonb_array_length(p_proof->'additional_urls'),
      'metadata_status', p_proof->>'metadata_status'
    )
  );
  return jsonb_build_object('attempt', to_jsonb(v_attempt), 'idempotent', false);
end;
$$;
revoke all on function public.submit_mission_publication_proof(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.submit_mission_publication_proof(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb, uuid[])
  to service_role;
-- Exact-attempt publication proof review lifecycle.
alter table public.mission_workflows
  drop constraint if exists mission_workflows_state_check,
  add constraint mission_workflows_state_check check (
    state in (
      'accepted', 'fulfillment_pending', 'drafting', 'in_review', 'revision_requested',
      'approved_to_publish', 'publication_in_progress', 'proof_verified', 'cancelled', 'expired'
    )
  );
alter table public.mission_work_items
  drop constraint if exists mission_work_items_state_check,
  add constraint mission_work_items_state_check check (
    state in (
      'blocked_by_fulfillment', 'drafting', 'submitted', 'under_review', 'revision_requested',
      'approved_to_publish', 'proof_submitted', 'proof_under_review',
      'proof_correction_requested', 'proof_verified', 'cancelled', 'expired'
    )
  );
alter table public.mission_publication_proof_reviews
  add column claimed_at timestamptz,
  add column review_due_at timestamptz,
  add column creator_response_deadline timestamptz,
  add column checklist jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist) = 'object'),
  add column claim_idempotency_key uuid,
  add column decision_idempotency_key uuid;
create unique index mission_publication_proof_reviews_claim_idempotency_idx
  on public.mission_publication_proof_reviews (workspace_id, claim_idempotency_key)
  where claim_idempotency_key is not null;
create unique index mission_publication_proof_reviews_decision_idempotency_idx
  on public.mission_publication_proof_reviews (workspace_id, decision_idempotency_key)
  where decision_idempotency_key is not null;
alter table public.mission_publication_proof_review_items
  drop constraint if exists mission_publication_proof_review_items_category_check,
  add constraint mission_publication_proof_review_items_category_check check (
    category in ('access', 'platform', 'account', 'content', 'timing', 'disclosure', 'evidence', 'other')
  );
create or replace function private.guard_publication_proof_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'immutable_record'; end if;
  if old.state <> 'open' or old.decision is not null
     or new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.mission_publication_proof_attempt_id is distinct from old.mission_publication_proof_attempt_id
     or new.review_number is distinct from old.review_number
     or new.created_at is distinct from old.created_at
  then raise exception 'immutable_record'; end if;

  if old.reviewer_id is null
     and new.state = 'open'
     and new.decision is null
     and new.reviewer_id is not null
     and new.claimed_at is not null
     and new.review_due_at is not null
     and new.claim_idempotency_key is not null
     and new.reviewed_at is null
     and new.decision_idempotency_key is null
     and new.creator_response_deadline is null
     and new.checklist = old.checklist
  then return new; end if;

  if old.reviewer_id is not null
     and new.reviewer_id = old.reviewer_id
     and new.claimed_at = old.claimed_at
     and new.review_due_at = old.review_due_at
     and new.claim_idempotency_key = old.claim_idempotency_key
     and new.reviewed_at is not null
     and new.decision_idempotency_key is not null
     and (
       (new.state = 'correction_requested' and new.decision = 'rejected'
         and new.creator_response_deadline is not null)
       or
       (new.state = 'verified' and new.decision = 'verified'
         and new.creator_response_deadline is null)
     )
  then return new; end if;

  raise exception 'immutable_record';
end;
$$;
revoke all on function private.guard_publication_proof_review_mutation()
  from public, anon, authenticated, service_role;
drop trigger if exists mission_publication_proof_reviews_immutable
  on public.mission_publication_proof_reviews;
create trigger mission_publication_proof_reviews_immutable
  before update or delete on public.mission_publication_proof_reviews
  for each row execute function private.guard_publication_proof_review_mutation();
create or replace function private.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_state text;
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_required_count integer;
begin
  select workflow.* into v_workflow
  from public.mission_workflows workflow
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  where workflow.id = p_workflow
    and (v_service or exists (
      select 1 from public.creators creator
      where creator.id = v_actor
        and creator.id = submission.creator_id
        and creator.workspace_id = workflow.workspace_id
    ))
  for update of workflow;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if v_workflow.state in ('cancelled', 'expired') then return v_workflow; end if;

  select count(*) into v_required_count
  from public.mission_work_items item
  where item.mission_workflow_id = v_workflow.id
    and item.workspace_id = v_workflow.workspace_id
    and item.required;

  if exists (
    select 1 from public.mission_fulfillments fulfillment
    where fulfillment.mission_workflow_id = v_workflow.id
      and fulfillment.workspace_id = v_workflow.workspace_id
      and fulfillment.status <> 'received'
  ) then
    v_state := 'fulfillment_pending';
  elsif v_required_count > 0 and not exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.required
      and item.state <> 'proof_verified'
  ) then
    v_state := 'proof_verified';
  elsif exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.required
      and item.state in (
        'proof_submitted', 'proof_under_review',
        'proof_correction_requested', 'proof_verified'
      )
  ) then
    v_state := 'publication_in_progress';
  elsif not exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.required
      and item.state <> 'approved_to_publish'
  ) then
    v_state := 'approved_to_publish';
  elsif exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.state = 'revision_requested'
  ) then
    v_state := 'revision_requested';
  elsif exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.state in ('submitted', 'under_review')
  ) then
    v_state := 'in_review';
  else
    v_state := 'drafting';
  end if;

  update public.mission_workflows
  set state = v_state, updated_at = now()
  where id = v_workflow.id and workspace_id = v_workflow.workspace_id
  returning * into v_workflow;
  return v_workflow;
end;
$$;
create or replace function private.start_publication_proof_review(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_attempt uuid,
  p_expected_state text, p_expected_revision integer,
  p_operator uuid, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_attempt public.mission_publication_proof_attempts;
  v_review public.mission_publication_proof_reviews;
  v_review_due timestamptz;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_idempotency_key is null or p_expected_revision is null or p_expected_revision < 0
     or p_expected_state is null or btrim(p_expected_state) = ''
  then raise exception 'validation_failed'; end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if not exists (
    select 1 from public.brand_users operator
    where operator.user_id = p_operator and operator.workspace_id = p_workspace and operator.active
  ) then raise exception 'not_authorized'; end if;

  select item.* into v_item
  from public.mission_work_items item
  where item.id = p_work_item
    and item.mission_workflow_id = p_workflow
    and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then raise exception 'not_found'; end if;

  select instruction.* into v_instruction
  from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item
    and instruction.workspace_id = p_workspace
  for update;
  if v_instruction.id is null then raise exception 'publication_setup_required'; end if;

  select attempt.* into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt
    and attempt.mission_work_item_id = p_work_item
    and attempt.workspace_id = p_workspace
  for update;
  if v_attempt.id is null then raise exception 'workflow_stale'; end if;

  select review.* into v_review
  from public.mission_publication_proof_reviews review
  where review.mission_publication_proof_attempt_id = p_attempt
    and review.workspace_id = p_workspace
  order by review.review_number desc
  limit 1
  for update;
  if v_review.id is null then raise exception 'workflow_stale'; end if;

  if v_review.claim_idempotency_key = p_idempotency_key
     and v_review.reviewer_id = p_operator
  then
    return jsonb_build_object(
      'review', to_jsonb(v_review), 'work_item', to_jsonb(v_item), 'idempotent', true
    );
  end if;
  if v_item.state <> p_expected_state
     or v_instruction.revision <> p_expected_revision
     or v_item.current_proof_attempt_id <> p_attempt
  then raise exception 'workflow_stale'; end if;
  if v_item.state <> 'proof_submitted' or v_review.state <> 'open'
     or v_review.decision is not null
  then raise exception 'wrong_state'; end if;
  if v_review.reviewer_id is not null or v_review.claim_idempotency_key is not null
  then raise exception 'workflow_stale'; end if;

  v_review_due := v_now + make_interval(hours => v_workflow.review_sla_hours);
  begin
    update public.mission_publication_proof_reviews
    set reviewer_id = p_operator,
        claimed_at = v_now,
        review_due_at = v_review_due,
        claim_idempotency_key = p_idempotency_key
    where id = v_review.id and workspace_id = p_workspace
    returning * into v_review;
  exception when unique_violation then
    raise exception 'idempotency_conflict';
  end;

  update public.mission_work_items
  set state = 'proof_under_review',
      current_reviewer_id = p_operator,
      review_started_at = v_now,
      review_due_at = v_review_due,
      updated_at = v_now
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;
  perform private.refresh_mission_workflow_state(p_workflow);

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_publication_proof_review_started', 'mission_publication_proof_review', v_review.id,
    jsonb_build_object('attempt_number', v_attempt.attempt_number, 'review_due_at', v_review_due)
  );
  return jsonb_build_object(
    'review', to_jsonb(v_review), 'work_item', to_jsonb(v_item), 'idempotent', false
  );
end;
$$;
create or replace function public.start_publication_proof_review(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_attempt uuid,
  p_expected_state text, p_expected_revision integer,
  p_operator uuid, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true
  then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.start_publication_proof_review(
    p_workspace, p_workflow, p_work_item, p_attempt, p_expected_state,
    p_expected_revision, p_operator, p_idempotency_key
  );
end;
$$;
create or replace function private.request_publication_proof_correction(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_attempt uuid,
  p_expected_state text, p_expected_revision integer,
  p_operator uuid, p_idempotency_key uuid,
  p_checklist jsonb, p_items jsonb, p_summary text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_attempt public.mission_publication_proof_attempts;
  v_review public.mission_publication_proof_reviews;
  v_creator_response_deadline timestamptz;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_idempotency_key is null or p_expected_revision is null or p_expected_revision < 0
     or p_expected_state is null or btrim(p_expected_state) = ''
     or p_checklist is null or jsonb_typeof(p_checklist) <> 'object'
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or (p_summary is not null and nullif(btrim(p_summary), '') is null)
  then raise exception 'validation_failed'; end if;
  if (select count(*) from jsonb_object_keys(p_checklist)) <> 6
     or not (p_checklist ? 'publicly_accessible')
     or not (p_checklist ? 'platform_matches')
     or not (p_checklist ? 'account_matches')
     or not (p_checklist ? 'content_matches_approved_version')
     or not (p_checklist ? 'timing_acceptable')
     or not (p_checklist ? 'disclosures_present')
     or exists (
       select 1 from jsonb_each(p_checklist) checklist_entry
       where jsonb_typeof(checklist_entry.value) <> 'boolean'
     )
  then raise exception 'validation_failed'; end if;
  if jsonb_array_length(p_items) = 0
     or exists (
       select 1 from jsonb_array_elements(p_items) item
       where jsonb_typeof(item) <> 'object'
          or coalesce(item->>'category', '') not in (
            'access', 'platform', 'account', 'content',
            'timing', 'disclosure', 'evidence', 'other'
          )
          or nullif(btrim(item->>'text'), '') is null
          or case when jsonb_typeof(item->'position') = 'number'
            then (item->>'position')::numeric < 0
              or mod((item->>'position')::numeric, 1) <> 0
              or (item->>'position')::numeric > 2147483647
            else true
          end
     )
     or exists (
       select 1
       from jsonb_array_elements(p_items) item
       group by (item->>'position')::integer
       having count(*) > 1
     )
  then raise exception 'validation_failed'; end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if not exists (
    select 1 from public.brand_users operator
    where operator.user_id = p_operator and operator.workspace_id = p_workspace and operator.active
  ) then raise exception 'not_authorized'; end if;

  select item.* into v_item
  from public.mission_work_items item
  where item.id = p_work_item
    and item.mission_workflow_id = p_workflow
    and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then raise exception 'not_found'; end if;

  select instruction.* into v_instruction
  from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item
    and instruction.workspace_id = p_workspace
  for update;
  if v_instruction.id is null then raise exception 'publication_setup_required'; end if;

  select attempt.* into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt
    and attempt.mission_work_item_id = p_work_item
    and attempt.workspace_id = p_workspace
  for update;
  if v_attempt.id is null then raise exception 'workflow_stale'; end if;

  select review.* into v_review
  from public.mission_publication_proof_reviews review
  where review.mission_publication_proof_attempt_id = p_attempt
    and review.workspace_id = p_workspace
  order by review.review_number desc
  limit 1
  for update;
  if v_review.id is null then raise exception 'workflow_stale'; end if;

  if v_review.decision_idempotency_key = p_idempotency_key
     and v_review.reviewer_id = p_operator
     and v_review.state = 'correction_requested'
  then
    return jsonb_build_object(
      'review', to_jsonb(v_review), 'work_item', to_jsonb(v_item), 'idempotent', true
    );
  end if;
  if v_item.state <> p_expected_state
     or v_instruction.revision <> p_expected_revision
     or v_item.current_proof_attempt_id <> p_attempt
  then raise exception 'workflow_stale'; end if;
  if v_review.state <> 'open' or v_review.decision is not null
  then raise exception 'wrong_state'; end if;
  if v_item.state <> 'proof_under_review'
     or v_item.current_reviewer_id <> p_operator
     or v_review.reviewer_id <> p_operator
  then raise exception 'workflow_stale'; end if;

  v_creator_response_deadline :=
    v_now + make_interval(hours => v_workflow.revision_response_hours);
  begin
    update public.mission_publication_proof_reviews
    set state = 'correction_requested',
        decision = 'rejected',
        reviewed_at = v_now,
        creator_response_deadline = v_creator_response_deadline,
        checklist = p_checklist,
        summary = nullif(btrim(p_summary), ''),
        decision_idempotency_key = p_idempotency_key
    where id = v_review.id and workspace_id = p_workspace
    returning * into v_review;
  exception when unique_violation then
    raise exception 'idempotency_conflict';
  end;

  insert into public.mission_publication_proof_review_items (
    workspace_id, mission_publication_proof_review_id, category,
    finding_text, passed, position
  )
  select p_workspace, v_review.id, item->>'category',
    btrim(item->>'text'), false, (item->>'position')::integer
  from jsonb_array_elements(p_items) item
  order by (item->>'position')::integer;

  update public.mission_work_items
  set state = 'proof_correction_requested',
      current_reviewer_id = null,
      review_started_at = null,
      review_due_at = null,
      updated_at = v_now
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;
  perform private.refresh_mission_workflow_state(p_workflow);

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_publication_proof_correction_requested', 'mission_publication_proof_review', v_review.id,
    jsonb_build_object(
      'attempt_number', v_attempt.attempt_number,
      'correction_count', jsonb_array_length(p_items),
      'creator_response_deadline', v_creator_response_deadline
    )
  );
  return jsonb_build_object(
    'review', to_jsonb(v_review), 'work_item', to_jsonb(v_item), 'idempotent', false
  );
end;
$$;
create or replace function public.request_publication_proof_correction(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_attempt uuid,
  p_expected_state text, p_expected_revision integer,
  p_operator uuid, p_idempotency_key uuid,
  p_checklist jsonb, p_items jsonb, p_summary text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true
  then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.request_publication_proof_correction(
    p_workspace, p_workflow, p_work_item, p_attempt, p_expected_state,
    p_expected_revision, p_operator, p_idempotency_key, p_checklist, p_items, p_summary
  );
end;
$$;
create or replace function private.verify_publication_proof(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_attempt uuid,
  p_expected_state text, p_expected_revision integer,
  p_operator uuid, p_idempotency_key uuid,
  p_checklist jsonb, p_summary text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_attempt public.mission_publication_proof_attempts;
  v_review public.mission_publication_proof_reviews;
begin
  perform private.assert_active_mission_operator(p_operator);
  if p_idempotency_key is null or p_expected_revision is null or p_expected_revision < 0
     or p_expected_state is null or btrim(p_expected_state) = ''
     or p_checklist is null or jsonb_typeof(p_checklist) <> 'object'
     or (p_summary is not null and nullif(btrim(p_summary), '') is null)
  then raise exception 'validation_failed'; end if;
  if (select count(*) from jsonb_object_keys(p_checklist)) <> 6
     or not (p_checklist ? 'publicly_accessible')
     or not (p_checklist ? 'platform_matches')
     or not (p_checklist ? 'account_matches')
     or not (p_checklist ? 'content_matches_approved_version')
     or not (p_checklist ? 'timing_acceptable')
     or not (p_checklist ? 'disclosures_present')
     or exists (
       select 1 from jsonb_each(p_checklist) checklist_entry
       where jsonb_typeof(checklist_entry.value) <> 'boolean'
          or checklist_entry.value <> 'true'::jsonb
     )
  then raise exception 'validation_failed'; end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if not exists (
    select 1 from public.brand_users operator
    where operator.user_id = p_operator and operator.workspace_id = p_workspace and operator.active
  ) then raise exception 'not_authorized'; end if;

  select item.* into v_item
  from public.mission_work_items item
  where item.id = p_work_item
    and item.mission_workflow_id = p_workflow
    and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then raise exception 'not_found'; end if;

  select instruction.* into v_instruction
  from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item
    and instruction.workspace_id = p_workspace
  for update;
  if v_instruction.id is null then raise exception 'publication_setup_required'; end if;

  select attempt.* into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt
    and attempt.mission_work_item_id = p_work_item
    and attempt.workspace_id = p_workspace
  for update;
  if v_attempt.id is null then raise exception 'workflow_stale'; end if;

  select review.* into v_review
  from public.mission_publication_proof_reviews review
  where review.mission_publication_proof_attempt_id = p_attempt
    and review.workspace_id = p_workspace
  order by review.review_number desc
  limit 1
  for update;
  if v_review.id is null then raise exception 'workflow_stale'; end if;

  if v_review.decision_idempotency_key = p_idempotency_key
     and v_review.reviewer_id = p_operator
     and v_review.state = 'verified'
  then
    return jsonb_build_object(
      'review', to_jsonb(v_review), 'work_item', to_jsonb(v_item), 'idempotent', true
    );
  end if;
  if v_item.state <> p_expected_state
     or v_instruction.revision <> p_expected_revision
     or v_item.current_proof_attempt_id <> p_attempt
  then raise exception 'workflow_stale'; end if;
  if v_review.state <> 'open' or v_review.decision is not null
  then raise exception 'wrong_state'; end if;
  if v_item.state <> 'proof_under_review'
     or v_item.current_reviewer_id <> p_operator
     or v_review.reviewer_id <> p_operator
  then raise exception 'workflow_stale'; end if;

  begin
    update public.mission_publication_proof_reviews
    set state = 'verified',
        decision = 'verified',
        reviewed_at = v_now,
        creator_response_deadline = null,
        checklist = p_checklist,
        summary = nullif(btrim(p_summary), ''),
        decision_idempotency_key = p_idempotency_key
    where id = v_review.id and workspace_id = p_workspace
    returning * into v_review;
  exception when unique_violation then
    raise exception 'idempotency_conflict';
  end;

  update public.mission_work_items
  set verified_proof_attempt_id = p_attempt,
      state = 'proof_verified',
      current_reviewer_id = null,
      review_started_at = null,
      review_due_at = null,
      updated_at = v_now
  where id = p_work_item and mission_workflow_id = p_workflow and workspace_id = p_workspace
  returning * into v_item;
  perform private.refresh_mission_workflow_state(p_workflow);

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id, actor_type, actor_id,
    event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_publication_proof_verified', 'mission_publication_proof_review', v_review.id,
    jsonb_build_object('attempt_number', v_attempt.attempt_number)
  );
  return jsonb_build_object(
    'review', to_jsonb(v_review), 'work_item', to_jsonb(v_item), 'idempotent', false
  );
end;
$$;
create or replace function public.verify_publication_proof(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_attempt uuid,
  p_expected_state text, p_expected_revision integer,
  p_operator uuid, p_idempotency_key uuid,
  p_checklist jsonb, p_summary text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true
  then raise exception 'not_authorized'; end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.verify_publication_proof(
    p_workspace, p_workflow, p_work_item, p_attempt, p_expected_state,
    p_expected_revision, p_operator, p_idempotency_key, p_checklist, p_summary
  );
end;
$$;
revoke all on function private.start_publication_proof_review(
  uuid, uuid, uuid, uuid, text, integer, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.request_publication_proof_correction(
  uuid, uuid, uuid, uuid, text, integer, uuid, uuid, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function private.verify_publication_proof(
  uuid, uuid, uuid, uuid, text, integer, uuid, uuid, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.start_publication_proof_review(
  uuid, uuid, uuid, uuid, text, integer, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.request_publication_proof_correction(
  uuid, uuid, uuid, uuid, text, integer, uuid, uuid, jsonb, jsonb, text
) from public, anon, authenticated;
revoke all on function public.verify_publication_proof(
  uuid, uuid, uuid, uuid, text, integer, uuid, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.start_publication_proof_review(
  uuid, uuid, uuid, uuid, text, integer, uuid, uuid
) to service_role;
grant execute on function public.request_publication_proof_correction(
  uuid, uuid, uuid, uuid, text, integer, uuid, uuid, jsonb, jsonb, text
) to service_role;
grant execute on function public.verify_publication_proof(
  uuid, uuid, uuid, uuid, text, integer, uuid, uuid, jsonb, text
) to service_role;
-- Metadata refresh preserves immutable creator proof while permitting only bounded fetch fields.
create or replace function private.guard_publication_proof_attempt()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'immutable_record'; end if;
  if (to_jsonb(new) - array['metadata_status', 'metadata_snapshot', 'metadata_error_category'])
     is distinct from
     (to_jsonb(old) - array['metadata_status', 'metadata_snapshot', 'metadata_error_category'])
  then raise exception 'immutable_record'; end if;
  return new;
end;
$$;
drop trigger if exists mission_publication_proof_attempts_immutable
  on public.mission_publication_proof_attempts;
create trigger mission_publication_proof_attempts_immutable
  before update or delete on public.mission_publication_proof_attempts
  for each row execute function private.guard_publication_proof_attempt();
revoke all on function private.guard_publication_proof_attempt()
  from public, anon, authenticated, service_role;
create or replace function private.request_publication_proof_metadata_refresh(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_attempt uuid,
  p_expected_state text, p_expected_revision integer,
  p_operator uuid, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_attempt public.mission_publication_proof_attempts;
begin
  perform private.assert_active_mission_operator(p_operator);
  if not exists (
    select 1 from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then raise exception 'not_authorized'; end if;

  if p_workspace is null or p_workflow is null or p_work_item is null
     or p_attempt is null or p_idempotency_key is null
     or p_expected_revision is null or p_expected_revision < 0
     or p_expected_state not in (
       'proof_submitted', 'proof_under_review',
       'proof_correction_requested', 'proof_verified'
     )
  then raise exception 'validation_failed'; end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select item.* into v_item
  from public.mission_work_items item
  where item.id = p_work_item and item.workspace_id = p_workspace
    and item.mission_workflow_id = p_workflow
  for update;
  if v_item.id is null then raise exception 'not_found'; end if;

  select instruction.* into v_instruction
  from public.mission_publication_instructions instruction
  where instruction.workspace_id = p_workspace
    and instruction.mission_work_item_id = p_work_item
  for update;

  select attempt.* into v_attempt
  from public.mission_publication_proof_attempts attempt
  where attempt.id = p_attempt and attempt.workspace_id = p_workspace
    and attempt.mission_work_item_id = p_work_item
  for update;
  if v_attempt.id is null then raise exception 'not_found'; end if;
  if v_item.state <> p_expected_state
     or v_instruction.revision <> p_expected_revision
     or v_item.current_proof_attempt_id <> p_attempt
  then
    return jsonb_build_object(
      'code', 'WORKFLOW_STALE',
      'current_publication', jsonb_build_object(
        'workItemId', v_item.id, 'state', v_item.state,
        'revision', v_instruction.revision,
        'currentAttemptId', v_item.current_proof_attempt_id
      )
    );
  end if;

  if exists (
    select 1 from public.mission_workflow_events event
    where event.workspace_id = p_workspace
      and event.mission_workflow_id = p_workflow
      and event.mission_work_item_id = p_work_item
      and event.entity_id = p_attempt
      and event.event_type = 'mission_publication_metadata_refresh_completed'
      and event.metadata->>'idempotency_key' = p_idempotency_key::text
  ) then
    return jsonb_build_object('attempt', to_jsonb(v_attempt), 'idempotent', true);
  end if;

  if not exists (
    select 1 from public.mission_workflow_events event
    where event.workspace_id = p_workspace
      and event.mission_workflow_id = p_workflow
      and event.mission_work_item_id = p_work_item
      and event.entity_id = p_attempt
      and event.event_type = 'mission_publication_metadata_refresh_requested'
      and event.metadata->>'idempotency_key' = p_idempotency_key::text
  ) then
    insert into public.mission_workflow_events (
      workspace_id, mission_workflow_id, mission_work_item_id,
      actor_type, actor_id, event_type, entity_type, entity_id, metadata
    ) values (
      p_workspace, p_workflow, p_work_item, 'operator', p_operator,
      'mission_publication_metadata_refresh_requested',
      'mission_publication_proof_attempt', p_attempt,
      jsonb_build_object(
        'platform', v_item.platform,
        'attempt_number', v_attempt.attempt_number,
        'metadata_status', v_attempt.metadata_status,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;
  return jsonb_build_object(
    'primary_url', v_attempt.primary_url,
    'platform', v_item.platform,
    'idempotent', false
  );
end;
$$;
create or replace function public.request_publication_proof_metadata_refresh(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_attempt uuid,
  p_expected_state text, p_expected_revision integer,
  p_operator uuid, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true
  then raise exception 'not_authorized'; end if;
  return private.request_publication_proof_metadata_refresh(
    p_workspace, p_workflow, p_work_item, p_attempt, p_expected_state,
    p_expected_revision, p_operator, p_idempotency_key
  );
end;
$$;
create or replace function public.complete_publication_proof_metadata_refresh(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_attempt uuid,
  p_expected_state text, p_expected_revision integer,
  p_operator uuid, p_idempotency_key uuid,
  p_metadata_status text, p_metadata_snapshot jsonb,
  p_metadata_error_category text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_target jsonb;
  v_attempt public.mission_publication_proof_attempts;
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true
  then raise exception 'not_authorized'; end if;
  if p_metadata_status not in ('available', 'unavailable')
     or jsonb_typeof(p_metadata_snapshot) <> 'object'
     or (p_metadata_error_category is not null
       and nullif(btrim(p_metadata_error_category), '') is null)
  then raise exception 'validation_failed'; end if;
  v_target := private.request_publication_proof_metadata_refresh(
    p_workspace, p_workflow, p_work_item, p_attempt, p_expected_state,
    p_expected_revision, p_operator, p_idempotency_key
  );
  if v_target ? 'code' or coalesce((v_target->>'idempotent')::boolean, false)
  then return v_target; end if;

  update public.mission_publication_proof_attempts
  set metadata_status = p_metadata_status,
      metadata_snapshot = p_metadata_snapshot,
      metadata_error_category = p_metadata_error_category
  where id = p_attempt and workspace_id = p_workspace
    and mission_work_item_id = p_work_item
  returning * into v_attempt;

  insert into public.mission_workflow_events (
    workspace_id, mission_workflow_id, mission_work_item_id,
    actor_type, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace, p_workflow, p_work_item, 'operator', p_operator,
    'mission_publication_metadata_refresh_completed',
    'mission_publication_proof_attempt', p_attempt,
    jsonb_build_object(
      'attempt_number', v_attempt.attempt_number,
      'metadata_status', v_attempt.metadata_status,
      'idempotency_key', p_idempotency_key
    )
  );
  return jsonb_build_object('attempt', to_jsonb(v_attempt), 'idempotent', false);
end;
$$;
revoke all on function public.request_publication_proof_metadata_refresh(uuid, uuid, uuid, uuid, text, integer, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.request_publication_proof_metadata_refresh(uuid, uuid, uuid, uuid, text, integer, uuid, uuid)
  to service_role;
revoke all on function public.complete_publication_proof_metadata_refresh(uuid, uuid, uuid, uuid, text, integer, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_publication_proof_metadata_refresh(uuid, uuid, uuid, uuid, text, integer, uuid, uuid, text, jsonb, text)
  to service_role;
revoke all on function private.request_publication_proof_metadata_refresh(uuid, uuid, uuid, uuid, text, integer, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_publication_proof_attempt()
  from public, anon, authenticated, service_role;
revoke usage on schema private from public, anon, authenticated;

-- SOURCE: derived-sql/20260723170000-publication_proof_rollout.sql; sha256=d51daf7b02dec3ddaa635278633f00202254f17d430b487622e8bd0a054d3487
-- Publication proof evidence rollout: pending assets are staged before an attempt exists.

alter table public.mission_publication_proof_assets
  alter column mission_publication_proof_attempt_id drop not null,
  alter column content_checksum drop not null,
  add column if not exists mission_submission_id uuid,
  add column if not exists mission_workflow_id uuid,
  add column if not exists mission_work_item_id uuid,
  add column if not exists creator_id uuid,
  add column if not exists upload_state text not null default 'finalized',
  add column if not exists upload_grant_expires_at timestamptz,
  add column if not exists finalized_at timestamptz;
update public.mission_publication_proof_assets a
set mission_work_item_id = attempt.mission_work_item_id,
    mission_workflow_id = workflow.id,
    mission_submission_id = workflow.mission_submission_id,
    creator_id = submission.creator_id,
    upload_state = 'finalized',
    finalized_at = coalesce(a.created_at, now())
from public.mission_publication_proof_attempts attempt
join public.mission_work_items item on item.id = attempt.mission_work_item_id and item.workspace_id = attempt.workspace_id
join public.mission_workflows workflow on workflow.id = item.mission_workflow_id and workflow.workspace_id = item.workspace_id
join public.mission_submissions submission on submission.id = workflow.mission_submission_id and submission.workspace_id = workflow.workspace_id
where a.mission_publication_proof_attempt_id = attempt.id and a.workspace_id = attempt.workspace_id and a.mission_work_item_id is null;
alter table public.mission_publication_proof_assets
  drop constraint if exists mission_publication_proof_assets_attempt_workspace_fk;
alter table public.mission_publication_proof_assets
  add constraint mission_publication_proof_assets_attempt_workspace_fk foreign key (mission_publication_proof_attempt_id, workspace_id) references public.mission_publication_proof_attempts(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_submission_workspace_fk foreign key (mission_submission_id, workspace_id) references public.mission_submissions(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_workflow_workspace_fk foreign key (mission_workflow_id, workspace_id) references public.mission_workflows(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_work_item_workspace_fk foreign key (mission_work_item_id, workspace_id) references public.mission_work_items(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_creator_workspace_fk foreign key (creator_id, workspace_id) references public.creators(id, workspace_id) on delete cascade,
  add constraint mission_publication_proof_assets_upload_state_check check (upload_state in ('pending','finalized','abandoned')),
  add constraint mission_publication_proof_assets_pending_attempt_check check (upload_state = 'pending' or mission_publication_proof_attempt_id is not null);
create index if not exists mission_publication_proof_assets_owner_idx on public.mission_publication_proof_assets (workspace_id, creator_id, mission_work_item_id, upload_state);
drop policy if exists mission_publication_proof_assets_creator_read on public.mission_publication_proof_assets;
create policy mission_publication_proof_assets_creator_read on public.mission_publication_proof_assets for select to authenticated using (creator_id = (select auth.uid()) and creator_id is not null);
drop policy if exists mission_publication_proof_assets_storage_read on storage.objects;
create policy mission_publication_proof_assets_storage_read on storage.objects for select to authenticated using (bucket_id = 'mission-publication-proof-assets' and exists (select 1 from public.mission_publication_proof_assets pa where pa.storage_object_path = name and pa.creator_id = (select auth.uid()) and pa.upload_state = 'finalized'));
drop policy if exists mission_publication_proof_assets_storage_insert on storage.objects;
create policy mission_publication_proof_assets_storage_insert on storage.objects for insert to authenticated with check (bucket_id = 'mission-publication-proof-assets' and exists (select 1 from public.mission_publication_proof_assets pa where pa.storage_object_path = name and pa.creator_id = (select auth.uid()) and pa.upload_state = 'pending' and pa.upload_grant_expires_at > now()));
drop trigger if exists mission_publication_proof_assets_immutable on public.mission_publication_proof_assets;
create or replace function private.guard_publication_proof_asset_mutation() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'publication_proof_asset_immutable'; end if;
  if old.upload_state <> 'pending' then raise exception 'publication_proof_asset_immutable'; end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.storage_object_path <> old.storage_object_path or new.original_filename <> old.original_filename or new.mime_type <> old.mime_type or new.byte_size <> old.byte_size or new.creator_id <> old.creator_id or new.mission_work_item_id <> old.mission_work_item_id or new.mission_workflow_id <> old.mission_workflow_id or new.mission_submission_id <> old.mission_submission_id then raise exception 'publication_proof_asset_immutable'; end if;
  if new.upload_state not in ('finalized','abandoned') then raise exception 'publication_proof_asset_wrong_state'; end if;
  return new;
end;
$$;
create trigger mission_publication_proof_assets_immutable before update or delete on public.mission_publication_proof_assets for each row execute function private.guard_publication_proof_asset_mutation();
create or replace function private.create_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare v_asset public.mission_publication_proof_assets; v_workflow public.mission_workflows; v_item public.mission_work_items; v_extension text;
begin
  if p_creator is null or p_workspace is null or p_submission is null or p_work_item is null or p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_byte_size < 1 or p_byte_size > 20971520 or p_grant_seconds < 1 or p_grant_seconds > 600 then raise exception 'validation_failed'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow join public.mission_submissions submission on submission.id = workflow.mission_submission_id and submission.workspace_id = workflow.workspace_id where workflow.mission_submission_id = p_submission and workflow.workspace_id = p_workspace and submission.creator_id = p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select item.* into v_item from public.mission_work_items item where item.id = p_work_item and item.mission_workflow_id = v_workflow.id and item.workspace_id = p_workspace;
  if v_item.id is null then raise exception 'not_found'; end if;
  v_extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'pdf' end;
  if p_storage_object_path !~ ('^' || p_creator::text || '/' || v_workflow.id::text || '/' || p_work_item::text || '/proof-evidence/[0-9a-f-]+\\.' || v_extension || '$') then raise exception 'validation_failed'; end if;
  select * into v_asset from public.mission_publication_proof_assets where storage_object_path = p_storage_object_path and workspace_id = p_workspace and creator_id = p_creator;
  if v_asset.id is not null then return v_asset; end if;
  insert into public.mission_publication_proof_assets (workspace_id,mission_submission_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,upload_state,upload_grant_expires_at) values (p_workspace,p_submission,v_workflow.id,p_work_item,p_creator,p_storage_object_path,btrim(p_filename),p_mime_type,p_byte_size,'pending',now()+make_interval(secs=>p_grant_seconds)) returning * into v_asset;
  return v_asset;
end;
$$;
create or replace function public.create_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$ begin if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if; return private.create_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_filename,p_mime_type,p_byte_size,p_storage_object_path,p_grant_seconds); end; $$;
revoke all on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer) to service_role;
create or replace function private.finalize_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_checksum text) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare v_asset public.mission_publication_proof_assets; v_object storage.objects;
begin
  select * into v_asset from public.mission_publication_proof_assets a where a.id=p_asset and a.workspace_id=p_workspace and a.mission_submission_id=p_submission and a.creator_id=p_creator and a.mission_work_item_id=p_work_item for update;
  if v_asset.id is null then raise exception 'not_found'; end if;
  if v_asset.upload_state='finalized' and v_asset.content_checksum=btrim(p_checksum) then return v_asset; end if;
  if v_asset.upload_state<>'pending' then raise exception 'already_finalized'; end if;
  if v_asset.upload_grant_expires_at < now() then raise exception 'upload_grant_expired'; end if;
  select * into v_object from storage.objects where bucket_id='mission-publication-proof-assets' and name=v_asset.storage_object_path;
  if v_object.id is null then raise exception 'asset_not_uploaded'; end if;
  if v_object.metadata ? 'size' and (v_object.metadata->>'size')::bigint <> v_asset.byte_size then raise exception 'invalid_byte_size'; end if;
  update public.mission_publication_proof_assets set upload_state='finalized',content_checksum=btrim(p_checksum),finalized_at=now() where id=v_asset.id returning * into v_asset;
  return v_asset;
end;
$$;
create or replace function public.finalize_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_checksum text) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$ begin if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if; return private.finalize_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_asset,p_checksum); end; $$;
revoke all on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text) to service_role;
create or replace function private.abandon_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_storage_object_path text) returns void language plpgsql security definer set search_path = '' as $$ begin delete from public.mission_publication_proof_assets where id=p_asset and workspace_id=p_workspace and mission_submission_id=p_submission and creator_id=p_creator and mission_work_item_id=p_work_item and storage_object_path=p_storage_object_path and upload_state='pending'; end; $$;
create or replace function public.abandon_publication_proof_asset(p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_storage_object_path text) returns void language plpgsql security definer set search_path = '' as $$ begin if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if; perform private.abandon_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_asset,p_storage_object_path); end; $$;
revoke all on function public.abandon_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.abandon_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text) to service_role;

-- SOURCE: derived-sql/20260725090000-publication_proof_rollout_compat.sql; sha256=78c978fc745708cfcfc2c0aa33687dd8190f66af594aa7d58da845b5ddff36dc
-- Compatibility overrides for the pending publication-proof asset lifecycle.

alter table public.mission_publication_proof_assets
  drop constraint if exists mission_publication_proof_assets_pending_attempt_check;
alter table public.mission_publication_proof_assets
  add constraint mission_publication_proof_assets_pending_attempt_check
  check (upload_state in ('pending','finalized','abandoned'));
create or replace function private.guard_publication_proof_asset_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.upload_state <> 'pending' then raise exception 'publication_proof_asset_immutable'; end if;
    return old;
  end if;
  if old.upload_state <> 'pending' then
    if old.upload_state = 'finalized'
       and old.mission_publication_proof_attempt_id is null
       and new.mission_publication_proof_attempt_id is not null
       and new.upload_state = old.upload_state
       and (to_jsonb(new) - 'mission_publication_proof_attempt_id')
           = (to_jsonb(old) - 'mission_publication_proof_attempt_id')
    then return new; end if;
    raise exception 'publication_proof_asset_immutable';
  end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.storage_object_path <> old.storage_object_path
     or new.original_filename <> old.original_filename or new.mime_type <> old.mime_type or new.byte_size <> old.byte_size
     or new.creator_id <> old.creator_id or new.mission_work_item_id <> old.mission_work_item_id
     or new.mission_workflow_id <> old.mission_workflow_id or new.mission_submission_id <> old.mission_submission_id
  then raise exception 'publication_proof_asset_immutable'; end if;
  if new.upload_state not in ('finalized','abandoned') then raise exception 'publication_proof_asset_wrong_state'; end if;
  return new;
end; $$;
drop function if exists public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer);
create or replace function public.create_publication_proof_asset(
  p_submission uuid, p_creator uuid, p_workspace uuid, p_work_item uuid, p_filename text,
  p_mime_type text, p_byte_size bigint, p_storage_object_path text, p_grant_seconds integer default 600,
  p_expected_state text default null, p_expected_revision integer default null, p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  return private.create_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_filename,p_mime_type,p_byte_size,p_storage_object_path,p_grant_seconds);
end; $$;
revoke all on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) to service_role;
drop function if exists public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text);
create or replace function public.finalize_publication_proof_asset(
  p_submission uuid, p_creator uuid, p_workspace uuid, p_work_item uuid, p_asset uuid, p_checksum text,
  p_expected_state text default null, p_expected_revision integer default null, p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  return private.finalize_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_asset,p_checksum);
end; $$;
revoke all on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) to service_role;

-- SOURCE: derived-sql/20260725110000-publication_proof_asset_policy.sql; sha256=afd45333e5bd53fda6cda3b222873194eb95dcd38f4647de5b4b40a25c55aa54
-- Final publication-proof asset policy: exact Phase 2 MIME set and workflow namespace.
create or replace function private.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,
  p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare v_asset public.mission_publication_proof_assets; v_workflow public.mission_workflows; v_item public.mission_work_items; v_extension text;
begin
  if p_creator is null or p_workspace is null or p_submission is null or p_work_item is null
     or p_mime_type not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm')
     or p_byte_size < 1 or p_byte_size > 20971520 or p_grant_seconds < 1 or p_grant_seconds > 600 then raise exception 'validation_failed'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow
    join public.mission_submissions submission on submission.id=workflow.mission_submission_id and submission.workspace_id=workflow.workspace_id
    where workflow.mission_submission_id=p_submission and workflow.workspace_id=p_workspace and submission.creator_id=p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select item.* into v_item from public.mission_work_items item where item.id=p_work_item and item.mission_workflow_id=v_workflow.id and item.workspace_id=p_workspace;
  if v_item.id is null then raise exception 'not_found'; end if;
  v_extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' else 'webm' end;
  if p_storage_object_path !~ ('^'||p_creator::text||'/'||v_workflow.id::text||'/'||p_work_item::text||'/proof-evidence/[0-9a-f-]+\\.'||v_extension||'$') then raise exception 'validation_failed'; end if;
  select * into v_asset from public.mission_publication_proof_assets where storage_object_path=p_storage_object_path and workspace_id=p_workspace and creator_id=p_creator;
  if v_asset.id is not null then return v_asset; end if;
  insert into public.mission_publication_proof_assets (workspace_id,mission_submission_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,upload_state,upload_grant_expires_at)
  values (p_workspace,p_submission,v_workflow.id,p_work_item,p_creator,p_storage_object_path,btrim(p_filename),p_mime_type,p_byte_size,'pending',now()+make_interval(secs=>p_grant_seconds)) returning * into v_asset;
  return v_asset;
end; $$;
create or replace function public.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600,p_expected_state text default null,p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$ begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  return private.create_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_filename,p_mime_type,p_byte_size,p_storage_object_path,p_grant_seconds);
end; $$;

-- SOURCE: derived-sql/20260725130000-publication_proof_asset_mutation_guards.sql; sha256=8b760f03f68f57c93cdfeeff8d5fb35ea0c644f8fe58d94b09c29f5cb6a15705
-- Enforce publication-proof asset optimistic concurrency and idempotency.
alter table public.mission_publication_proof_assets
  add column if not exists upload_idempotency_key uuid,
  add column if not exists finalize_idempotency_key uuid;
create unique index if not exists mission_publication_proof_assets_upload_idempotency_idx
  on public.mission_publication_proof_assets(workspace_id, creator_id, mission_work_item_id, upload_idempotency_key)
  where upload_idempotency_key is not null;
drop function if exists public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text);
create function public.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,
  p_storage_object_path text,p_grant_seconds integer default 600,p_expected_state text default null,
  p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.mission_publication_proof_assets;
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_key uuid;
  v_extension text;
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  begin v_key := p_idempotency_key::uuid; exception when others then raise exception 'validation_failed'; end;
  if p_expected_state is null or p_expected_revision is null then raise exception 'validation_failed'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow
    join public.mission_submissions submission on submission.id=workflow.mission_submission_id and submission.workspace_id=workflow.workspace_id
    where workflow.mission_submission_id=p_submission and workflow.workspace_id=p_workspace and submission.creator_id=p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select * into v_item from public.mission_work_items where id=p_work_item and workspace_id=p_workspace and mission_workflow_id=v_workflow.id;
  if v_item.id is null then raise exception 'not_found'; end if;
  select * into v_instruction from public.mission_publication_instructions where workspace_id=p_workspace and mission_work_item_id=p_work_item;
  if v_instruction.id is null then raise exception 'not_found'; end if;
  select * into v_asset from public.mission_publication_proof_assets
    where workspace_id=p_workspace and creator_id=p_creator and mission_work_item_id=p_work_item and upload_idempotency_key=v_key;
  if v_asset.id is not null then
    if v_asset.original_filename<>btrim(p_filename) or v_asset.mime_type<>p_mime_type or v_asset.byte_size<>p_byte_size then raise exception 'validation_failed'; end if;
    return v_asset;
  end if;
  if v_item.state<>p_expected_state or v_instruction.revision<>p_expected_revision then raise exception 'workflow_stale'; end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm')
     or p_byte_size<1 or p_byte_size>20971520 or p_grant_seconds<1 or p_grant_seconds>600 then raise exception 'validation_failed'; end if;
  v_extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm' end;
  if p_storage_object_path !~ ('^'||p_creator::text||'/'||v_workflow.id::text||'/'||p_work_item::text||'/proof-evidence/'||v_key::text||'\\.'||v_extension||'$') then raise exception 'validation_failed'; end if;
  insert into public.mission_publication_proof_assets
    (workspace_id,mission_submission_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,upload_state,upload_grant_expires_at,upload_idempotency_key)
  values (p_workspace,p_submission,v_workflow.id,p_work_item,p_creator,p_storage_object_path,btrim(p_filename),p_mime_type,p_byte_size,'pending',now()+make_interval(secs=>p_grant_seconds),v_key)
  returning * into v_asset;
  return v_asset;
end; $$;
revoke all on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) to service_role;
drop function if exists public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text);
create function public.finalize_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_checksum text,
  p_expected_state text default null,p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.mission_publication_proof_assets;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_object storage.objects;
  v_key uuid;
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  begin v_key := p_idempotency_key::uuid; exception when others then raise exception 'validation_failed'; end;
  if p_expected_state is null or p_expected_revision is null or nullif(btrim(p_checksum),'') is null then raise exception 'validation_failed'; end if;
  select * into v_item from public.mission_work_items where id=p_work_item and workspace_id=p_workspace;
  select * into v_instruction from public.mission_publication_instructions where workspace_id=p_workspace and mission_work_item_id=p_work_item;
  if v_item.id is null or v_instruction.id is null then raise exception 'not_found'; end if;
  select * into v_asset from public.mission_publication_proof_assets where id=p_asset and workspace_id=p_workspace
    and mission_submission_id=p_submission and creator_id=p_creator and mission_work_item_id=p_work_item for update;
  if v_asset.id is null then raise exception 'not_found'; end if;
  if v_asset.mission_publication_proof_attempt_id is not null then raise exception 'already_assigned'; end if;
  if v_asset.upload_state='finalized' and v_asset.finalize_idempotency_key=v_key and v_asset.content_checksum=btrim(p_checksum) then return v_asset; end if;
  if v_item.state<>p_expected_state or v_instruction.revision<>p_expected_revision then raise exception 'workflow_stale'; end if;
  if v_asset.upload_state<>'pending' then raise exception 'already_finalized'; end if;
  if v_asset.upload_grant_expires_at<now() then raise exception 'upload_grant_expired'; end if;
  select * into v_object from storage.objects where bucket_id='mission-publication-proof-assets' and name=v_asset.storage_object_path;
  if v_object.id is null then raise exception 'asset_not_uploaded'; end if;
  if not (v_object.metadata ? 'size') or not (v_object.metadata ? 'mimetype') then raise exception 'invalid_upload_metadata'; end if;
  if (v_object.metadata->>'size')::bigint<>v_asset.byte_size or v_object.metadata->>'mimetype'<>v_asset.mime_type then raise exception 'invalid_upload_metadata'; end if;
  update public.mission_publication_proof_assets set upload_state='finalized',content_checksum=btrim(p_checksum),finalized_at=now(),finalize_idempotency_key=v_key
    where id=v_asset.id returning * into v_asset;
  return v_asset;
end; $$;
revoke all on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) to service_role;

-- SOURCE: derived-sql/20260725140000-publication_proof_asset_guards.sql; sha256=e461544af2a2bfae2964a42777d6421e758c8f60298dff5297ecbd6e40c95d92
-- Final lifecycle guards: only publication-stage items may stage evidence and
-- concurrent retries converge on the idempotency-derived storage path.
create or replace function private.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,
  p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare v_asset public.mission_publication_proof_assets; v_workflow public.mission_workflows; v_item public.mission_work_items; v_extension text;
begin
  if p_creator is null or p_workspace is null or p_submission is null or p_work_item is null
     or p_mime_type not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm')
     or p_byte_size < 1 or p_byte_size > 20971520 or p_grant_seconds < 1 or p_grant_seconds > 600 then raise exception 'validation_failed'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow join public.mission_submissions submission on submission.id=workflow.mission_submission_id and submission.workspace_id=workflow.workspace_id where workflow.mission_submission_id=p_submission and workflow.workspace_id=p_workspace and submission.creator_id=p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select item.* into v_item from public.mission_work_items item where item.id=p_work_item and item.mission_workflow_id=v_workflow.id and item.workspace_id=p_workspace;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.state not in ('approved_to_publish','proof_correction_requested') then raise exception 'wrong_state'; end if;
  v_extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' else 'webm' end;
  if p_storage_object_path !~ ('^'||p_creator::text||'/'||v_workflow.id::text||'/'||p_work_item::text||'/proof-evidence/[0-9a-f-]+\\.'||v_extension||'$') then raise exception 'validation_failed'; end if;
  insert into public.mission_publication_proof_assets (workspace_id,mission_submission_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,upload_state,upload_grant_expires_at)
  values (p_workspace,p_submission,v_workflow.id,p_work_item,p_creator,p_storage_object_path,btrim(p_filename),p_mime_type,p_byte_size,'pending',now()+make_interval(secs=>p_grant_seconds))
  on conflict (storage_object_path) do nothing returning * into v_asset;
  if v_asset.id is null then
    select * into v_asset from public.mission_publication_proof_assets where storage_object_path=p_storage_object_path and workspace_id=p_workspace;
    if v_asset.id is null or v_asset.creator_id<>p_creator or v_asset.mission_work_item_id<>p_work_item or v_asset.mime_type<>p_mime_type or v_asset.byte_size<>p_byte_size then raise exception 'idempotency_conflict'; end if;
  end if;
  return v_asset;
end; $$;

-- SOURCE: derived-sql/20260725143000-publication_proof_public_guards.sql; sha256=b78575af0a6620005106f36bcd0a6956b6a9eb8d4cf4c449e40108e70f680c66
-- Active PUBLIC RPC guards. These wrappers are the callable Supabase surface.
create or replace function public.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,p_storage_object_path text,p_grant_seconds integer default 600,p_expected_state text default null,p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  if p_expected_state not in ('approved_to_publish','proof_correction_requested') or p_expected_revision is null or p_expected_revision < 0 or p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'workflow_stale'; end if;
  return private.create_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_filename,p_mime_type,p_byte_size,p_storage_object_path,p_grant_seconds);
end; $$;
create or replace function public.finalize_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_checksum text,p_expected_state text default null,p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  if p_expected_state not in ('approved_to_publish','proof_correction_requested') or p_expected_revision is null or p_expected_revision < 0 or p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'workflow_stale'; end if;
  return private.finalize_publication_proof_asset(p_submission,p_creator,p_workspace,p_work_item,p_asset,p_checksum);
end; $$;

-- SOURCE: derived-sql/20260725150000-publication_proof_public_rpc_final.sql; sha256=8ab4c97a2e94bfc03263e01a4be9005be3c625a1d8a145d243cc5a2df46c5538
-- Final callable publication-proof asset RPCs. Keep full guards on the public surface.
create or replace function public.create_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_filename text,p_mime_type text,p_byte_size bigint,
  p_storage_object_path text,p_grant_seconds integer default 600,p_expected_state text default null,
  p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.mission_publication_proof_assets;
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_key uuid;
  v_extension text;
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  begin v_key:=p_idempotency_key::uuid; exception when others then raise exception 'validation_failed'; end;
  if p_expected_state not in ('approved_to_publish','proof_correction_requested') or p_expected_revision is null or p_expected_revision<0 then raise exception 'workflow_stale'; end if;
  select workflow.* into v_workflow from public.mission_workflows workflow
    join public.mission_submissions submission on submission.id=workflow.mission_submission_id and submission.workspace_id=workflow.workspace_id
    where workflow.mission_submission_id=p_submission and workflow.workspace_id=p_workspace and submission.creator_id=p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  select * into v_item from public.mission_work_items where id=p_work_item and workspace_id=p_workspace and mission_workflow_id=v_workflow.id;
  select * into v_instruction from public.mission_publication_instructions where workspace_id=p_workspace and mission_work_item_id=p_work_item;
  if v_item.id is null or v_instruction.id is null then raise exception 'not_found'; end if;
  select * into v_asset from public.mission_publication_proof_assets where workspace_id=p_workspace and creator_id=p_creator and mission_work_item_id=p_work_item and upload_idempotency_key=v_key;
  if v_asset.id is not null then
    if v_asset.original_filename<>btrim(p_filename) or v_asset.mime_type<>p_mime_type or v_asset.byte_size<>p_byte_size or v_asset.storage_object_path<>p_storage_object_path then raise exception 'idempotency_conflict'; end if;
    return v_asset;
  end if;
  if v_item.state<>p_expected_state or v_instruction.revision<>p_expected_revision then raise exception 'workflow_stale'; end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm') or p_byte_size<1 or p_byte_size>20971520 or p_grant_seconds<1 or p_grant_seconds>600 then raise exception 'validation_failed'; end if;
  v_extension:=case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm' end;
  if p_storage_object_path !~ ('^'||p_creator::text||'/'||v_workflow.id::text||'/'||p_work_item::text||'/proof-evidence/'||v_key::text||'\\.'||v_extension||'$') then raise exception 'validation_failed'; end if;
  insert into public.mission_publication_proof_assets
    (workspace_id,mission_submission_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,upload_state,upload_grant_expires_at,upload_idempotency_key)
  values (p_workspace,p_submission,v_workflow.id,p_work_item,p_creator,p_storage_object_path,btrim(p_filename),p_mime_type,p_byte_size,'pending',now()+make_interval(secs=>p_grant_seconds),v_key)
  on conflict (workspace_id,creator_id,mission_work_item_id,upload_idempotency_key) where upload_idempotency_key is not null do nothing
  returning * into v_asset;
  if v_asset.id is null then
    select * into v_asset from public.mission_publication_proof_assets where workspace_id=p_workspace and creator_id=p_creator and mission_work_item_id=p_work_item and upload_idempotency_key=v_key;
    if v_asset.id is null or v_asset.original_filename<>btrim(p_filename) or v_asset.mime_type<>p_mime_type or v_asset.byte_size<>p_byte_size or v_asset.storage_object_path<>p_storage_object_path then raise exception 'idempotency_conflict'; end if;
  end if;
  return v_asset;
end; $$;
revoke all on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text) to service_role;
create or replace function public.finalize_publication_proof_asset(
  p_submission uuid,p_creator uuid,p_workspace uuid,p_work_item uuid,p_asset uuid,p_checksum text,
  p_expected_state text default null,p_expected_revision integer default null,p_idempotency_key text default null
) returns public.mission_publication_proof_assets language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.mission_publication_proof_assets;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_object storage.objects;
  v_key uuid;
begin
  if coalesce((select auth.jwt()->>'role')='service_role',false) is not true then raise exception 'not_authorized'; end if;
  begin v_key:=p_idempotency_key::uuid; exception when others then raise exception 'validation_failed'; end;
  if p_expected_state not in ('approved_to_publish','proof_correction_requested') or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_checksum),'') is null then raise exception 'workflow_stale'; end if;
  select * into v_item from public.mission_work_items where id=p_work_item and workspace_id=p_workspace;
  select * into v_instruction from public.mission_publication_instructions where workspace_id=p_workspace and mission_work_item_id=p_work_item;
  if v_item.id is null or v_instruction.id is null then raise exception 'not_found'; end if;
  select * into v_asset from public.mission_publication_proof_assets where id=p_asset and workspace_id=p_workspace and mission_submission_id=p_submission and creator_id=p_creator and mission_work_item_id=p_work_item for update;
  if v_asset.id is null then raise exception 'not_found'; end if;
  if v_asset.mission_publication_proof_attempt_id is not null then raise exception 'already_assigned'; end if;
  if v_asset.upload_state='finalized' and v_asset.finalize_idempotency_key=v_key and v_asset.content_checksum=btrim(p_checksum) then return v_asset; end if;
  if v_item.state<>p_expected_state or v_instruction.revision<>p_expected_revision then raise exception 'workflow_stale'; end if;
  if v_asset.upload_state<>'pending' then raise exception 'already_finalized'; end if;
  if v_asset.upload_grant_expires_at<now() then raise exception 'upload_grant_expired'; end if;
  select * into v_object from storage.objects where bucket_id='mission-publication-proof-assets' and name=v_asset.storage_object_path;
  if v_object.id is null then raise exception 'asset_not_uploaded'; end if;
  if not (v_object.metadata?'size') or not (v_object.metadata?'mimetype') then raise exception 'invalid_upload_metadata'; end if;
  if (v_object.metadata->>'size')::bigint<>v_asset.byte_size or v_object.metadata->>'mimetype'<>v_asset.mime_type then raise exception 'invalid_upload_metadata'; end if;
  update public.mission_publication_proof_assets set upload_state='finalized',content_checksum=btrim(p_checksum),finalized_at=now(),finalize_idempotency_key=v_key where id=v_asset.id returning * into v_asset;
  return v_asset;
end; $$;
revoke all on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text) to service_role;

-- SOURCE: derived-sql/20260727120000-publication_proof_instrumentation.sql; sha256=454deb4322b12979dc4c3927590e98e3c97879b4809c903540fd4b1b8a8c5728
-- Publication-proof outcome notifications are observed from the append-only
-- workflow event boundary. Delivery stays best-effort and reward-neutral.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started',
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue',
    'mission_publication_correction_requested',
    'mission_publication_verified'
  ));
alter table public.notifications drop constraint if exists notifications_workflow_payload_size_check;
alter table public.notifications add constraint notifications_workflow_payload_size_check
  check (
    type not in (
      'mission_product_shipped','mission_receipt_required',
      'mission_revision_requested','mission_draft_approved',
      'mission_approved_to_publish','mission_deadline_approaching',
      'mission_deadline_overdue',
      'mission_publication_correction_requested',
      'mission_publication_verified'
    )
    or octet_length(data::text) <= 8192
  );
create or replace function private.notify_publication_proof_outcome(
  p_recipient uuid,
  p_type text,
  p_work_item uuid,
  p_semantic_key text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_claimed integer;
  v_data jsonb;
begin
  if p_recipient is null
     or p_work_item is null
     or nullif(btrim(p_semantic_key), '') is null
     or p_type not in (
       'mission_publication_correction_requested',
       'mission_publication_verified'
     )
     or jsonb_typeof(p_payload) <> 'object'
  then
    return false;
  end if;

  select item.workspace_id
  into v_workspace
  from public.mission_work_items item
  where item.id = p_work_item;

  if v_workspace is null then
    return false;
  end if;

  v_data := jsonb_strip_nulls(jsonb_build_object(
    'mission_title', p_payload->'mission_title',
    'mission_slug', p_payload->'mission_slug',
    'submission_id', p_payload->'submission_id',
    'deliverable_title', p_payload->'deliverable_title',
    'deadline', p_payload->'deadline',
    'attempt_number', p_payload->'attempt_number',
    'reason_categories', p_payload->'reason_categories'
  ));

  begin
    insert into private.mission_workflow_notification_dedupe
      (recipient_id, notification_type, entity_type, entity_id, semantic_key)
    values
      (p_recipient, p_type, 'mission_work_item', p_work_item, p_semantic_key)
    on conflict do nothing;

    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
      return false;
    end if;

    insert into public.notifications
      (user_id, workspace_id, type, data, entity_type, entity_id)
    values
      (p_recipient, v_workspace, p_type, v_data, 'mission_work_item', p_work_item);

    return true;
  exception
    when others then
      return false;
  end;
exception
  when others then
    return false;
end;
$$;
create or replace function private.notify_publication_proof_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_mission_title text;
  v_mission_slug text;
  v_submission uuid;
  v_deliverable_title text;
  v_deadline timestamptz;
  v_attempt_number integer;
  v_reason_categories text[];
  v_type text;
  v_semantic_key text;
  v_payload jsonb;
begin
  v_type := case new.event_type
    when 'mission_publication_proof_correction_requested'
      then 'mission_publication_correction_requested'
    when 'mission_publication_proof_verified'
      then 'mission_publication_verified'
    else null
  end;

  if v_type is null
     or new.mission_work_item_id is null
     or new.entity_type is distinct from 'mission_publication_proof_review'
     or new.entity_id is null
  then
    return new;
  end if;

  select
    submission.creator_id,
    mission.title,
    mission.slug,
    submission.id,
    item.title,
    case
      when new.event_type = 'mission_publication_proof_correction_requested'
        then coalesce(review.creator_response_deadline, instruction.publication_due_at, item.deadline)
      else coalesce(instruction.publication_due_at, item.deadline)
    end,
    attempt.attempt_number,
    coalesce(
      array_agg(distinct review_item.category order by review_item.category)
        filter (where review_item.category is not null),
      array[]::text[]
    )
  into
    v_recipient,
    v_mission_title,
    v_mission_slug,
    v_submission,
    v_deliverable_title,
    v_deadline,
    v_attempt_number,
    v_reason_categories
  from public.mission_work_items item
  join public.mission_workflows workflow
    on workflow.id = item.mission_workflow_id
   and workflow.workspace_id = item.workspace_id
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  join public.missions mission
    on mission.id = submission.mission_id
   and mission.workspace_id = submission.workspace_id
  join public.mission_publication_proof_reviews review
    on review.id = new.entity_id
   and review.workspace_id = item.workspace_id
  join public.mission_publication_proof_attempts attempt
    on attempt.id = review.mission_publication_proof_attempt_id
   and attempt.mission_work_item_id = item.id
   and attempt.workspace_id = item.workspace_id
  left join public.mission_publication_instructions instruction
    on instruction.mission_work_item_id = item.id
   and instruction.workspace_id = item.workspace_id
  left join public.mission_publication_proof_review_items review_item
    on review_item.mission_publication_proof_review_id = review.id
   and review_item.workspace_id = review.workspace_id
  where item.id = new.mission_work_item_id
    and item.mission_workflow_id = new.mission_workflow_id
    and item.workspace_id = new.workspace_id
  group by
    submission.creator_id,
    mission.title,
    mission.slug,
    submission.id,
    item.title,
    item.deadline,
    instruction.publication_due_at,
    review.creator_response_deadline,
    attempt.attempt_number;

  if v_recipient is null or v_attempt_number is null then
    return new;
  end if;

  v_semantic_key := case
    when v_type = 'mission_publication_correction_requested'
      then concat(
        'attempt:', v_attempt_number::text,
        '|reasons:', array_to_string(v_reason_categories, ',')
      )
    else concat('attempt:', v_attempt_number::text)
  end;

  v_payload := jsonb_build_object(
    'mission_title', v_mission_title,
    'mission_slug', v_mission_slug,
    'submission_id', v_submission,
    'deliverable_title', v_deliverable_title,
    'deadline', v_deadline,
    'attempt_number', v_attempt_number,
    'reason_categories', case
      when v_type = 'mission_publication_correction_requested'
        then to_jsonb(v_reason_categories)
      else null
    end
  );

  perform private.notify_publication_proof_outcome(
    v_recipient,
    v_type,
    new.mission_work_item_id,
    v_semantic_key,
    v_payload
  );

  return new;
exception
  when others then
    return new;
end;
$$;
drop trigger if exists publication_proof_workflow_event_notifications
  on public.mission_workflow_events;
create trigger publication_proof_workflow_event_notifications
after insert on public.mission_workflow_events
for each row execute function private.notify_publication_proof_event();
revoke all on function private.notify_publication_proof_outcome(uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.notify_publication_proof_event()
  from public, anon, authenticated, service_role;

-- SOURCE: derived-sql/20260727130000-publication_proof_existing_setup.sql; sha256=dca64a2ca772432c52f31d4a76968452baa73bfc825b07bddd117a5bde561581
-- Explicit, reward-neutral publication policy setup for already-approved legacy work items.

create or replace function private.setup_existing_publication_instructions(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid,
  p_expected_state text, p_expected_revision integer,
  p_idempotency_key uuid, p_instructions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_setup_event public.mission_workflow_events;
  v_window_hours integer;
  v_expected_account text;
begin
  perform private.assert_active_mission_operator(p_operator);

  if not exists (
    select 1
    from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then
    raise exception 'not_authorized';
  end if;

  if p_workspace is null or p_workflow is null or p_work_item is null
    or p_operator is null or p_expected_state is distinct from 'approved_to_publish'
    or p_expected_revision is null or p_expected_revision < 0
    or p_idempotency_key is null
    or coalesce(jsonb_typeof(p_instructions) = 'object', false) is not true
    or not (p_instructions ? 'publication_instructions')
    or not (p_instructions ? 'publication_window_hours')
    or not (p_instructions ? 'required_disclosures')
    or not (p_instructions ? 'expected_account')
    or not (p_instructions ? 'proof_evidence_policy')
    or nullif(btrim(p_instructions->>'publication_instructions'), '') is null
    or (case
      when jsonb_typeof(p_instructions->'publication_window_hours') = 'number'
        then coalesce((p_instructions->>'publication_window_hours') ~ '^[1-9][0-9]{0,3}$', false) is not true
      else true
    end)
    or (case when jsonb_typeof(p_instructions->'required_disclosures') = 'array' then exists (
        select 1
        from jsonb_array_elements(p_instructions->'required_disclosures') disclosure
        where jsonb_typeof(disclosure) <> 'string'
          or nullif(btrim(disclosure #>> '{}'), '') is null
      )
      else true
    end)
    or coalesce(jsonb_typeof(p_instructions->'expected_account') in ('null', 'string'), false) is not true
    or (
      jsonb_typeof(p_instructions->'expected_account') = 'string'
      and nullif(btrim(p_instructions->>'expected_account'), '') is null
    )
    or coalesce(jsonb_typeof(p_instructions->'proof_evidence_policy') = 'object', false) is not true
  then
    return jsonb_build_object('code', 'VALIDATION_FAILED');
  end if;

  v_window_hours := (p_instructions->>'publication_window_hours')::integer;
  if v_window_hours > 8760 then
    return jsonb_build_object('code', 'VALIDATION_FAILED');
  end if;
  v_expected_account := case
    when jsonb_typeof(p_instructions->'expected_account') = 'null' then null
    else btrim(p_instructions->>'expected_account')
  end;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow
    and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then
    return jsonb_build_object('code', 'WORKFLOW_NOT_FOUND');
  end if;

  select item.* into v_item
  from public.mission_work_items item
  where item.id = p_work_item
    and item.mission_workflow_id = p_workflow
    and item.workspace_id = p_workspace
  for update;
  if v_item.id is null then
    return jsonb_build_object('code', 'WORKFLOW_NOT_FOUND');
  end if;

  select instruction.* into v_instruction
  from public.mission_publication_instructions instruction
  where instruction.mission_work_item_id = p_work_item
    and instruction.workspace_id = p_workspace
  for update;

  perform attempt.id
  from public.mission_publication_proof_attempts attempt
  where attempt.mission_work_item_id = p_work_item
    and attempt.workspace_id = p_workspace
  for update;

  select event.* into v_setup_event
  from public.mission_workflow_events event
  where event.workspace_id = p_workspace
    and event.mission_workflow_id = p_workflow
    and event.mission_work_item_id = p_work_item
    and event.event_type = 'mission_publication_existing_instructions_setup'
    and event.actor_type = 'operator'
    and event.actor_id = p_operator
    and event.entity_type = 'mission_publication_instruction'
    and event.entity_id = v_instruction.id
    and event.metadata->>'idempotency_key' = p_idempotency_key::text
  order by event.created_at, event.id
  limit 1
  for update;

  if v_instruction.id is not null then
    if v_setup_event.id is null then
      return jsonb_build_object('code', 'WRONG_STATE');
    end if;
    if v_setup_event.metadata->>'revision' is distinct from p_expected_revision::text
      or not (p_idempotency_key = any(v_instruction.idempotency_keys))
      or v_instruction.publication_instructions is distinct from btrim(p_instructions->>'publication_instructions')
      or v_instruction.publication_window_hours is distinct from v_window_hours
      or v_instruction.required_disclosures is distinct from p_instructions->'required_disclosures'
      or v_instruction.expected_account is distinct from v_expected_account
      or v_instruction.proof_evidence_policy is distinct from p_instructions->'proof_evidence_policy'
    then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'instruction', to_jsonb(v_instruction),
      'idempotent', true
    );
  end if;

  if v_item.state is distinct from p_expected_state then
    return jsonb_build_object('code', 'WORKFLOW_STALE');
  end if;
  if v_item.state is distinct from 'approved_to_publish' then
    return jsonb_build_object('code', 'WRONG_STATE');
  end if;
  if p_expected_revision <> 0 then
    return jsonb_build_object('code', 'WORKFLOW_STALE');
  end if;
  if exists (
    select 1
    from public.mission_publication_proof_attempts attempt
    where attempt.mission_work_item_id = p_work_item
      and attempt.workspace_id = p_workspace
  ) then
    return jsonb_build_object('code', 'WRONG_STATE');
  end if;
  if exists (
    select 1
    from public.mission_workflow_events event
    where event.workspace_id = p_workspace
      and event.mission_workflow_id = p_workflow
      and event.mission_work_item_id = p_work_item
      and event.event_type = 'mission_publication_existing_instructions_setup'
  ) then
    return jsonb_build_object('code', 'WRONG_STATE');
  end if;

  begin
    insert into public.mission_publication_instructions (
      workspace_id,
      mission_work_item_id,
      platform,
      source_template_id,
      publication_instructions,
      publication_window_hours,
      required_disclosures,
      expected_account,
      proof_evidence_policy,
      publication_due_at,
      created_at,
      frozen_at,
      revision,
      idempotency_keys
    ) values (
      p_workspace,
      p_work_item,
      v_item.platform,
      null,
      btrim(p_instructions->>'publication_instructions'),
      v_window_hours,
      p_instructions->'required_disclosures',
      v_expected_account,
      p_instructions->'proof_evidence_policy',
      v_now + make_interval(hours => v_window_hours),
      v_now,
      v_now,
      0,
      array[p_idempotency_key]
    )
    returning * into v_instruction;
  exception
    when unique_violation then
      select instruction.* into v_instruction
      from public.mission_publication_instructions instruction
      where instruction.mission_work_item_id = p_work_item
        and instruction.workspace_id = p_workspace
      for update;
      return jsonb_build_object('code', 'WRONG_STATE');
  end;

  insert into public.mission_workflow_events (
    workspace_id,
    mission_workflow_id,
    mission_work_item_id,
    actor_type,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace,
    p_workflow,
    p_work_item,
    'operator',
    p_operator,
    'mission_publication_existing_instructions_setup',
    'mission_publication_instruction',
    v_instruction.id,
    jsonb_build_object(
      'revision', v_instruction.revision,
      'idempotency_key', p_idempotency_key
    )
  );

  return jsonb_build_object(
    'instruction', to_jsonb(v_instruction),
    'idempotent', false
  );
end;
$$;
create or replace function public.setup_existing_publication_instructions(
  p_workspace uuid, p_workflow uuid, p_work_item uuid, p_operator uuid,
  p_expected_state text, p_expected_revision integer,
  p_idempotency_key uuid, p_instructions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.setup_existing_publication_instructions(
    p_workspace,
    p_workflow,
    p_work_item,
    p_operator,
    p_expected_state,
    p_expected_revision,
    p_idempotency_key,
    p_instructions
  );
end;
$$;
revoke all on function private.setup_existing_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.setup_existing_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.setup_existing_publication_instructions(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb) to service_role;

-- SOURCE: derived-sql/20260728135000-fix_publication_proof_asset_path_regex.sql; sha256=a4a909bb7711ffcfb50a8f4b4b8947c7695bccbea319d266854b0a5733dd15b4
-- Fix the active proof-asset path guard: `\\.` matches a backslash plus any
-- character in PostgreSQL regex syntax, while generated object paths use `.ext`.
create or replace function public.create_publication_proof_asset(
  p_submission uuid,
  p_creator uuid,
  p_workspace uuid,
  p_work_item uuid,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_storage_object_path text,
  p_grant_seconds integer default 600,
  p_expected_state text default null,
  p_expected_revision integer default null,
  p_idempotency_key text default null
) returns public.mission_publication_proof_assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.mission_publication_proof_assets;
  v_workflow public.mission_workflows;
  v_item public.mission_work_items;
  v_instruction public.mission_publication_instructions;
  v_key uuid;
  v_extension text;
begin
  if coalesce((select auth.jwt()->>'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  begin
    v_key := p_idempotency_key::uuid;
  exception when others then
    raise exception 'validation_failed';
  end;
  if p_expected_state not in ('approved_to_publish', 'proof_correction_requested')
     or p_expected_revision is null
     or p_expected_revision < 0 then
    raise exception 'workflow_stale';
  end if;

  select workflow.*
  into v_workflow
  from public.mission_workflows workflow
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  where workflow.mission_submission_id = p_submission
    and workflow.workspace_id = p_workspace
    and submission.creator_id = p_creator;
  if v_workflow.id is null then raise exception 'not_found'; end if;

  select *
  into v_item
  from public.mission_work_items
  where id = p_work_item
    and workspace_id = p_workspace
    and mission_workflow_id = v_workflow.id;
  select *
  into v_instruction
  from public.mission_publication_instructions
  where workspace_id = p_workspace
    and mission_work_item_id = p_work_item;
  if v_item.id is null or v_instruction.id is null then raise exception 'not_found'; end if;

  select *
  into v_asset
  from public.mission_publication_proof_assets
  where workspace_id = p_workspace
    and creator_id = p_creator
    and mission_work_item_id = p_work_item
    and upload_idempotency_key = v_key;
  if v_asset.id is not null then
    if v_asset.original_filename <> btrim(p_filename)
       or v_asset.mime_type <> p_mime_type
       or v_asset.byte_size <> p_byte_size
       or v_asset.storage_object_path <> p_storage_object_path then
      raise exception 'idempotency_conflict';
    end if;
    return v_asset;
  end if;

  if v_item.state <> p_expected_state
     or v_instruction.revision <> p_expected_revision then
    raise exception 'workflow_stale';
  end if;
  if p_mime_type not in (
       'image/jpeg',
       'image/png',
       'image/webp',
       'image/gif',
       'video/mp4',
       'video/quicktime',
       'video/webm'
     )
     or p_byte_size < 1
     or p_byte_size > 20971520
     or p_grant_seconds < 1
     or p_grant_seconds > 600 then
    raise exception 'validation_failed';
  end if;
  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/gif' then 'gif'
    when 'video/mp4' then 'mp4'
    when 'video/quicktime' then 'mov'
    when 'video/webm' then 'webm'
  end;
  if p_storage_object_path !~ (
    '^'
    || p_creator::text
    || '/'
    || v_workflow.id::text
    || '/'
    || p_work_item::text
    || '/proof-evidence/'
    || v_key::text
    || '\.'
    || v_extension
    || '$'
  ) then
    raise exception 'validation_failed';
  end if;

  insert into public.mission_publication_proof_assets (
    workspace_id,
    mission_submission_id,
    mission_workflow_id,
    mission_work_item_id,
    creator_id,
    storage_object_path,
    original_filename,
    mime_type,
    byte_size,
    upload_state,
    upload_grant_expires_at,
    upload_idempotency_key
  )
  values (
    p_workspace,
    p_submission,
    v_workflow.id,
    p_work_item,
    p_creator,
    p_storage_object_path,
    btrim(p_filename),
    p_mime_type,
    p_byte_size,
    'pending',
    now() + make_interval(secs => p_grant_seconds),
    v_key
  )
  on conflict (
    workspace_id,
    creator_id,
    mission_work_item_id,
    upload_idempotency_key
  ) where upload_idempotency_key is not null
  do nothing
  returning * into v_asset;

  if v_asset.id is null then
    select *
    into v_asset
    from public.mission_publication_proof_assets
    where workspace_id = p_workspace
      and creator_id = p_creator
      and mission_work_item_id = p_work_item
      and upload_idempotency_key = v_key;
    if v_asset.id is null
       or v_asset.original_filename <> btrim(p_filename)
       or v_asset.mime_type <> p_mime_type
       or v_asset.byte_size <> p_byte_size
       or v_asset.storage_object_path <> p_storage_object_path then
      raise exception 'idempotency_conflict';
    end if;
  end if;
  return v_asset;
end;
$$;

-- SOURCE: derived-sql/20260729010000-align_publication_proof_asset_mime_contract.sql; sha256=5e99d2b5a0cab543309c457c3df2a57a93675857ade6f92f4cdcd9878608611d
alter table public.mission_publication_proof_assets
  drop constraint if exists mission_publication_proof_assets_mime_type_check;
alter table public.mission_publication_proof_assets
  add constraint mission_publication_proof_assets_mime_type_check
  check (
    mime_type in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/quicktime',
      'video/webm'
    )
  );
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'mission-publication-proof-assets',
  'mission-publication-proof-assets',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- SOURCE: derived-sql/20260731100000-reward_handoff_schema.sql; sha256=f9db70060f200c37902bc47ba2889fb5d66d11baf485232e55ee91d843752317
-- Reward handoff foundation. Rewards remain pending until a later, explicit ledger settlement phase.

alter table public.workspaces
  add column reward_processing_window_days smallint
  check (reward_processing_window_days between 0 and 365);
alter table public.mission_workflows
  add column revision integer not null default 0 check (revision >= 0),
  drop constraint if exists mission_workflows_state_check,
  add constraint mission_workflows_state_check check (
    state in (
      'accepted','fulfillment_pending','drafting','in_review','revision_requested',
      'approved_to_publish','publication_in_progress','proof_verified',
      'reward_pending','cancelled','expired'
    )
  );
create table public.mission_reward_contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_workflow_id uuid not null unique references public.mission_workflows(id),
  mission_submission_id uuid not null references public.mission_submissions(id),
  mission_id uuid not null references public.missions(id),
  points_amount integer not null check (points_amount >= 0),
  cash_amount numeric(10,2) not null check (cash_amount >= 0),
  currency text not null default 'HKD' check (currency ~ '^[A-Z]{3}$'),
  xp_amount integer not null default 0 check (xp_amount >= 0),
  source text not null check (source in ('join','operator_backfill')),
  source_mission_updated_at timestamptz,
  confirmed_by uuid references auth.users(id),
  confirmation_evidence_source text check (
    confirmation_evidence_source in ('mission_brief','signed_agreement','operator_record','other')
  ),
  confirmation_reason text,
  created_at timestamptz not null default now(),
  check (
    (source = 'join' and confirmed_by is null
      and confirmation_evidence_source is null and confirmation_reason is null)
    or
    (source = 'operator_backfill' and confirmed_by is not null
      and confirmation_evidence_source is not null
      and nullif(btrim(confirmation_reason), '') is not null)
  )
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_reward_contracts FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_completion_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_workflow_id uuid not null references public.mission_workflows(id),
  decision_kind text not null check (decision_kind in ('approved','cancelled')),
  reward_contract_id uuid not null references public.mission_reward_contracts(id),
  pending_reward_id uuid,
  supersedes_decision_id uuid references public.mission_completion_decisions(id),
  workflow_revision integer not null check (workflow_revision >= 0),
  required_item_count integer not null check (required_item_count >= 0),
  verified_required_item_count integer not null check (verified_required_item_count >= 0),
  evidence_snapshot jsonb not null check (jsonb_typeof(evidence_snapshot) = 'object'),
  reason_category text,
  reason_note text,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  idempotency_key uuid not null,
  request_hash text not null check (btrim(request_hash) <> ''),
  unique (workspace_id, idempotency_key)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_completion_decisions FROM PUBLIC, anon, authenticated, service_role;

create table public.mission_pending_rewards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  mission_workflow_id uuid not null references public.mission_workflows(id),
  mission_submission_id uuid not null references public.mission_submissions(id),
  creator_id uuid not null references public.creators(id),
  mission_id uuid not null references public.missions(id),
  reward_contract_id uuid not null references public.mission_reward_contracts(id),
  completion_decision_id uuid not null unique references public.mission_completion_decisions(id),
  points_amount integer not null check (points_amount >= 0),
  cash_amount numeric(10,2) not null check (cash_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  xp_amount integer not null check (xp_amount >= 0),
  status text not null default 'pending' check (status in ('pending','cancelled')),
  processing_window_days smallint check (processing_window_days between 0 and 365),
  target_at timestamptz,
  cancellation_decision_id uuid unique references public.mission_completion_decisions(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.mission_pending_rewards FROM PUBLIC, anon, authenticated, service_role;

alter table public.mission_completion_decisions
  add constraint mission_completion_decisions_pending_reward_fk
  foreign key (pending_reward_id) references public.mission_pending_rewards(id);
create unique index mission_pending_rewards_one_pending_idx
  on public.mission_pending_rewards (mission_workflow_id)
  where status = 'pending';
create index mission_reward_contracts_workspace_workflow_idx
  on public.mission_reward_contracts (workspace_id, mission_workflow_id);
create index mission_reward_contracts_workspace_submission_idx
  on public.mission_reward_contracts (workspace_id, mission_submission_id);
create index mission_reward_contracts_workspace_mission_idx
  on public.mission_reward_contracts (workspace_id, mission_id);
create index mission_completion_decisions_workspace_workflow_idx
  on public.mission_completion_decisions (workspace_id, mission_workflow_id, decided_at desc);
create index mission_completion_decisions_workspace_contract_idx
  on public.mission_completion_decisions (workspace_id, reward_contract_id);
create index mission_completion_decisions_workspace_pending_reward_idx
  on public.mission_completion_decisions (workspace_id, pending_reward_id)
  where pending_reward_id is not null;
create index mission_pending_rewards_workspace_creator_idx
  on public.mission_pending_rewards (workspace_id, creator_id, created_at desc);
create index mission_pending_rewards_workspace_workflow_idx
  on public.mission_pending_rewards (workspace_id, mission_workflow_id);
create index mission_pending_rewards_workspace_submission_idx
  on public.mission_pending_rewards (workspace_id, mission_submission_id);
create index mission_pending_rewards_workspace_mission_idx
  on public.mission_pending_rewards (workspace_id, mission_id);
alter table public.mission_reward_contracts enable row level security;
alter table public.mission_completion_decisions enable row level security;
alter table public.mission_pending_rewards enable row level security;
-- Browser clients receive bounded creator data through a later ownership-checking RPC.
revoke all on table
  public.mission_reward_contracts,
  public.mission_completion_decisions,
  public.mission_pending_rewards
from public, anon, authenticated;
grant all on table
  public.mission_reward_contracts,
  public.mission_completion_decisions,
  public.mission_pending_rewards
to service_role;
create or replace function private.guard_reward_contract_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_record';
end;
$$;
create or replace function private.guard_completion_decision_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_record';
end;
$$;
create or replace function private.guard_pending_reward_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'pending'
     and old.cancellation_decision_id is null
     and old.cancelled_at is null
     and new.status = 'cancelled'
     and new.cancellation_decision_id is not null
     and new.cancelled_at is not null
     and (to_jsonb(new) - array['status', 'cancellation_decision_id', 'cancelled_at'])
       is not distinct from
       (to_jsonb(old) - array['status', 'cancellation_decision_id', 'cancelled_at'])
  then
    return new;
  end if;

  raise exception 'immutable_record';
end;
$$;
create trigger mission_reward_contracts_immutable
  before update or delete on public.mission_reward_contracts
  for each row execute function private.guard_reward_contract_immutable();
create trigger mission_completion_decisions_immutable
  before update or delete on public.mission_completion_decisions
  for each row execute function private.guard_completion_decision_immutable();
create trigger mission_pending_rewards_guarded_update
  before update or delete on public.mission_pending_rewards
  for each row execute function private.guard_pending_reward_update();
revoke all on function private.guard_reward_contract_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_completion_decision_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_pending_reward_update()
  from public, anon, authenticated, service_role;

-- SOURCE: derived-sql/20260731110000-reward_contract_capture.sql; sha256=33836d4d06a4aa46099d03f46b3efdfc030644344c7d605f94cfaba2c1be0ebf
-- Freeze active-workspace reward promises at join time and provide explicit,
-- audited service-only recovery for workflows that predate contract capture.

create or replace function public.join_active_mission(p_mission uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.mission_submissions;
  v_workflow public.mission_workflows;
  v_contract public.mission_reward_contracts;
begin
  v_submission := public.join_mission(p_mission);
  v_workflow := private.create_mission_workflow(v_submission.id);

  insert into public.mission_reward_contracts (
    workspace_id,
    mission_workflow_id,
    mission_submission_id,
    mission_id,
    points_amount,
    cash_amount,
    currency,
    xp_amount,
    source,
    source_mission_updated_at
  )
  select
    v_workflow.workspace_id,
    v_workflow.id,
    v_submission.id,
    mission.id,
    mission.points_reward,
    coalesce(mission.cash_reward, 0),
    'HKD',
    0,
    'join',
    mission.updated_at
  from public.missions mission
  where mission.id = v_submission.mission_id
    and mission.workspace_id = v_submission.workspace_id
  returning * into v_contract;

  if not found then
    raise exception 'reward_contract_source_missing';
  end if;

  return jsonb_build_object(
    'submission', to_jsonb(v_submission),
    'workflow', to_jsonb(v_workflow),
    'rewardContract', to_jsonb(v_contract)
  );
end;
$$;
create or replace function private.backfill_mission_reward_contract(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_points_amount integer,
  p_cash_amount numeric,
  p_currency text,
  p_xp_amount integer,
  p_source_mission_updated_at timestamptz,
  p_confirmation_evidence_source text,
  p_confirmation_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_submission public.mission_submissions;
  v_mission public.missions;
  v_contract public.mission_reward_contracts;
begin
  perform private.assert_active_mission_operator(p_operator);

  if not exists (
    select 1
    from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then
    raise exception 'not_authorized';
  end if;

  if nullif(btrim(p_confirmation_reason), '') is null then
    raise exception 'backfill_reason_required';
  end if;

  if p_workspace is null
    or p_workflow is null
    or p_operator is null
    or p_points_amount is null
    or p_points_amount < 0
    or p_cash_amount is null
    or p_cash_amount < 0
    or p_currency is null
    or p_currency !~ '^[A-Z]{3}$'
    or p_xp_amount is null
    or p_xp_amount < 0
    or p_confirmation_evidence_source is null
    or p_confirmation_evidence_source not in (
      'mission_brief',
      'signed_agreement',
      'operator_record',
      'other'
    )
    or p_idempotency_key is null
  then
    raise exception 'backfill_contract_invalid';
  end if;

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow
    and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then
    raise exception 'reward_workflow_not_found';
  end if;

  select submission.* into v_submission
  from public.mission_submissions submission
  where submission.id = v_workflow.mission_submission_id
    and submission.workspace_id = p_workspace;
  if v_submission.id is null then
    raise exception 'reward_contract_source_missing';
  end if;

  select mission.* into v_mission
  from public.missions mission
  where mission.id = v_submission.mission_id
    and mission.workspace_id = p_workspace;
  if v_mission.id is null then
    raise exception 'reward_contract_source_missing';
  end if;

  if exists (
    select 1
    from public.mission_reward_contracts contract
    where contract.mission_workflow_id = v_workflow.id
      and contract.workspace_id = p_workspace
  ) then
    raise exception 'reward_contract_exists';
  end if;

  insert into public.mission_reward_contracts (
    workspace_id,
    mission_workflow_id,
    mission_submission_id,
    mission_id,
    points_amount,
    cash_amount,
    currency,
    xp_amount,
    source,
    source_mission_updated_at,
    confirmed_by,
    confirmation_evidence_source,
    confirmation_reason
  ) values (
    p_workspace,
    v_workflow.id,
    v_submission.id,
    v_mission.id,
    p_points_amount,
    p_cash_amount,
    p_currency,
    p_xp_amount,
    'operator_backfill',
    p_source_mission_updated_at,
    p_operator,
    p_confirmation_evidence_source,
    btrim(p_confirmation_reason)
  )
  returning * into v_contract;

  return jsonb_build_object(
    'contract', to_jsonb(v_contract),
    'idempotent', false
  );
end;
$$;
create or replace function public.backfill_mission_reward_contract(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_points_amount integer,
  p_cash_amount numeric,
  p_currency text,
  p_xp_amount integer,
  p_source_mission_updated_at timestamptz,
  p_confirmation_evidence_source text,
  p_confirmation_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.backfill_mission_reward_contract(
    p_workspace,
    p_workflow,
    p_operator,
    p_points_amount,
    p_cash_amount,
    p_currency,
    p_xp_amount,
    p_source_mission_updated_at,
    p_confirmation_evidence_source,
    p_confirmation_reason,
    p_idempotency_key
  );
end;
$$;
create or replace function private.set_reward_processing_window(
  p_workspace uuid,
  p_operator uuid,
  p_days smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_active_mission_operator(p_operator);

  if not exists (
    select 1
    from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then
    raise exception 'not_authorized';
  end if;

  if p_days is not null and (p_days < 0 or p_days > 365) then
    raise exception 'reward_processing_window_invalid';
  end if;

  update public.workspaces
  set reward_processing_window_days = p_days
  where id = p_workspace;

  if not found then
    raise exception 'workspace_not_found';
  end if;

  return jsonb_build_object(
    'workspaceId', p_workspace,
    'rewardProcessingWindowDays', p_days
  );
end;
$$;
create or replace function public.set_reward_processing_window(
  p_workspace uuid,
  p_operator uuid,
  p_days smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.set_reward_processing_window(p_workspace, p_operator, p_days);
end;
$$;
revoke all on function public.join_active_mission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_active_mission(uuid) to authenticated;
revoke all on function private.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) to service_role;
revoke all on function private.set_reward_processing_window(uuid, uuid, smallint) from public, anon, authenticated, service_role;
revoke all on function public.set_reward_processing_window(uuid, uuid, smallint) from public, anon, authenticated, service_role;
grant execute on function public.set_reward_processing_window(uuid, uuid, smallint) to service_role;
-- The workflow helper remains an internal transaction building block.
revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role;

-- SOURCE: derived-sql/20260731120000-reward_handoff_transitions.sql; sha256=ec85e028037644d42e91f416d9bbc1bb6dc200513ac434b9e77d99750b6fe45a
-- Atomic completion approval, pending-reward cancellation, and bounded creator reads.
-- These transitions are deliberately neutral to reward ledgers, balances, and budgets.

create or replace function private.approve_mission_completion(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_expected_state text;
  v_request jsonb;
  v_request_hash text;
  v_workflow public.mission_workflows;
  v_contract public.mission_reward_contracts;
  v_submission public.mission_submissions;
  v_decision public.mission_completion_decisions;
  v_pending public.mission_pending_rewards;
  v_replay record;
  v_required_item_count integer;
  v_verified_required_item_count integer;
  v_evidence_snapshot jsonb;
  v_processing_days smallint;
  v_target_at timestamptz;
  v_constraint_name text;
begin
  perform private.assert_active_mission_operator(p_operator);
  if not exists (
    select 1
    from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then
    raise exception 'not_authorized';
  end if;

  v_expected_state := lower(btrim(coalesce(p_expected_state, '')));
  if p_workspace is null
    or p_workflow is null
    or p_operator is null
    or v_expected_state <> 'proof_verified'
    or p_expected_revision is null
    or p_expected_revision < 0
    or p_idempotency_key is null
  then
    raise exception 'validation_failed';
  end if;

  v_request := jsonb_build_object(
    'action', 'approve_mission_completion',
    'workspaceId', p_workspace::text,
    'workflowId', p_workflow::text,
    'operatorId', p_operator::text,
    'expectedState', v_expected_state,
    'expectedRevision', p_expected_revision
  );
  v_request_hash := encode(
    extensions.digest(convert_to(v_request::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow
    and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then
    raise exception 'not_found';
  end if;

  -- Idempotency keys are claimed workspace-wide. Compare the immutable request
  -- before state/revision checks or any replay reconstruction.
  select decision.* into v_decision
  from public.mission_completion_decisions decision
  where decision.workspace_id = p_workspace
    and decision.idempotency_key = p_idempotency_key;
  if v_decision.id is not null then
    if v_decision.request_hash <> v_request_hash then
      raise exception 'idempotency_conflict';
    end if;
    if v_decision.mission_workflow_id <> p_workflow
      or v_decision.decision_kind <> 'approved'
    then
      raise exception 'idempotency_conflict';
    end if;
  end if;

  select submission.* into v_submission
  from public.mission_submissions submission
  where submission.id = v_workflow.mission_submission_id
    and submission.workspace_id = p_workspace;
  if v_submission.id is null then
    if v_decision.id is not null then
      raise exception 'idempotency_conflict';
    end if;
    raise exception 'completion_not_eligible';
  end if;

  select contract.* into v_contract
  from public.mission_reward_contracts contract
  where contract.workspace_id = p_workspace
    and contract.mission_workflow_id = p_workflow
    and contract.mission_submission_id = v_submission.id
    and contract.mission_id = v_submission.mission_id;
  if v_contract.id is null then
    if v_decision.id is not null then
      raise exception 'idempotency_conflict';
    end if;
    raise exception 'reward_contract_required';
  end if;

  if v_decision.id is not null then
    select pending as pending_row
    into v_replay
    from public.mission_pending_rewards pending
    join public.mission_completion_decisions approval
      on approval.workspace_id = pending.workspace_id
     and approval.mission_workflow_id = pending.mission_workflow_id
     and approval.reward_contract_id = pending.reward_contract_id
     and pending.completion_decision_id = approval.id
     and approval.decision_kind = 'approved'
     and approval.pending_reward_id is null
    left join public.mission_completion_decisions cancellation
      on cancellation.workspace_id = pending.workspace_id
     and cancellation.mission_workflow_id = pending.mission_workflow_id
     and cancellation.reward_contract_id = pending.reward_contract_id
     and pending.id = cancellation.pending_reward_id
     and pending.cancellation_decision_id = cancellation.id
     and cancellation.supersedes_decision_id = pending.completion_decision_id
     and cancellation.decision_kind = 'cancelled'
    where pending.workspace_id = p_workspace
      and pending.mission_workflow_id = p_workflow
      and pending.mission_submission_id = v_submission.id
      and pending.creator_id = v_submission.creator_id
      and pending.mission_id = v_submission.mission_id
      and pending.reward_contract_id = v_contract.id
      and approval.id = v_decision.id
      and (
        (
          pending.status = 'pending'
          and pending.cancellation_decision_id is null
          and pending.cancelled_at is null
          and cancellation.id is null
        )
        or (
          pending.status = 'cancelled'
          and pending.cancellation_decision_id is not null
          and pending.cancelled_at is not null
          and cancellation.id is not null
        )
      )
    limit 1;
    if not found then
      raise exception 'idempotency_conflict';
    end if;
    v_pending := v_replay.pending_row;
    return jsonb_build_object(
      'workflow', jsonb_build_object(
        'id', v_decision.mission_workflow_id,
        'state', 'reward_pending',
        'revision', v_decision.workflow_revision + 1,
        'updated_at', v_decision.decided_at
      ),
      'decision', to_jsonb(v_decision),
      'pendingReward', to_jsonb(v_pending) || jsonb_build_object(
        'status', 'pending',
        'cancellation_decision_id', null,
        'cancelled_at', null
      ),
      'idempotent', true
    );
  end if;

  if v_workflow.state <> v_expected_state then
    raise exception 'wrong_state';
  end if;
  if v_workflow.revision <> p_expected_revision then
    raise exception 'workflow_stale';
  end if;

  select count(*) into v_required_item_count
  from public.mission_work_items item
  where item.mission_workflow_id = v_workflow.id
    and item.workspace_id = p_workspace
    and item.required;

  select count(*) into v_verified_required_item_count
  from public.mission_work_items item
  where item.mission_workflow_id = v_workflow.id
    and item.workspace_id = p_workspace
    and item.required
    and item.state = 'proof_verified'
    and item.verified_proof_attempt_id is not null
    and item.current_proof_attempt_id = item.verified_proof_attempt_id
    and exists (
      select 1
      from public.mission_publication_proof_attempts attempt
      join public.mission_publication_proof_reviews review
        on review.workspace_id = attempt.workspace_id
       and review.mission_publication_proof_attempt_id = attempt.id
       and review.state = 'verified'
       and review.decision = 'verified'
      where attempt.id = item.verified_proof_attempt_id
        and attempt.mission_work_item_id = item.id
        and attempt.workspace_id = item.workspace_id
    );
  if v_required_item_count = 0
    or v_verified_required_item_count <> v_required_item_count
  then
    raise exception 'completion_not_eligible';
  end if;

  select jsonb_build_object(
    'requiredItems',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'workItemId', item.id,
          'proofAttemptId', attempt.id,
          'proofReviewId', review.id,
          'attemptNumber', attempt.attempt_number,
          'submittedAt', attempt.submitted_at,
          'contentChecksum', attempt.content_checksum,
          'metadataStatus', attempt.metadata_status,
          'reviewNumber', review.review_number,
          'reviewedAt', review.reviewed_at,
          'reviewDecision', review.decision
        )
        order by item.position, item.id
      ),
      '[]'::jsonb
    )
  )
  into v_evidence_snapshot
  from public.mission_work_items item
  join public.mission_publication_proof_attempts attempt
    on attempt.id = item.verified_proof_attempt_id
   and attempt.mission_work_item_id = item.id
   and attempt.workspace_id = item.workspace_id
  join public.mission_publication_proof_reviews review
    on review.workspace_id = item.workspace_id
   and review.mission_publication_proof_attempt_id = attempt.id
   and review.state = 'verified'
   and review.decision = 'verified'
  where item.mission_workflow_id = v_workflow.id
    and item.workspace_id = p_workspace
    and item.required
    and item.state = 'proof_verified'
    and item.current_proof_attempt_id = item.verified_proof_attempt_id;

  select workspace.reward_processing_window_days
  into v_processing_days
  from public.workspaces workspace
  where workspace.id = p_workspace;
  v_target_at := case
    when v_processing_days is null then null
    else v_now + make_interval(days => v_processing_days)
  end;

  begin
    insert into public.mission_completion_decisions (
      workspace_id,
      mission_workflow_id,
      decision_kind,
      reward_contract_id,
      pending_reward_id,
      supersedes_decision_id,
      workflow_revision,
      required_item_count,
      verified_required_item_count,
      evidence_snapshot,
      reason_category,
      reason_note,
      decided_by,
      decided_at,
      idempotency_key,
      request_hash
    ) values (
      p_workspace,
      v_workflow.id,
      'approved',
      v_contract.id,
      null,
      null,
      v_workflow.revision,
      v_required_item_count,
      v_verified_required_item_count,
      v_evidence_snapshot,
      null,
      null,
      p_operator,
      v_now,
      p_idempotency_key,
      v_request_hash
    )
    returning * into v_decision;

    insert into public.mission_pending_rewards (
      workspace_id,
      mission_workflow_id,
      mission_submission_id,
      creator_id,
      mission_id,
      reward_contract_id,
      completion_decision_id,
      points_amount,
      cash_amount,
      currency,
      xp_amount,
      status,
      processing_window_days,
      target_at,
      created_at
    ) values (
      p_workspace,
      v_workflow.id,
      v_submission.id,
      v_submission.creator_id,
      v_contract.mission_id,
      v_contract.id,
      v_decision.id,
      v_contract.points_amount,
      v_contract.cash_amount,
      v_contract.currency,
      v_contract.xp_amount,
      'pending',
      v_processing_days,
      v_target_at,
      v_now
    )
    returning * into v_pending;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'mission_pending_rewards_one_pending_idx' then
      raise exception 'pending_reward_exists';
    end if;
    raise exception 'idempotency_conflict';
  end;

  update public.mission_workflows
  set state = 'reward_pending',
      revision = revision + 1,
      updated_at = v_now
  where id = v_workflow.id
    and workspace_id = p_workspace
    and state = v_expected_state
    and revision = p_expected_revision
  returning * into v_workflow;
  if v_workflow.id is null then
    raise exception 'workflow_stale';
  end if;

  insert into public.mission_workflow_events (
    workspace_id,
    mission_workflow_id,
    actor_type,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata,
    created_at
  ) values (
    p_workspace,
    v_workflow.id,
    'operator',
    p_operator,
    'mission_completion_approved',
    'mission_pending_reward',
    v_pending.id,
    jsonb_build_object(
      'decision_id', v_decision.id,
      'pending_reward_id', v_pending.id,
      'workflow_revision', v_workflow.revision
    ),
    v_now
  );

  return jsonb_build_object(
    'workflow', jsonb_build_object(
      'id', v_decision.mission_workflow_id,
      'state', 'reward_pending',
      'revision', v_decision.workflow_revision + 1,
      'updated_at', v_decision.decided_at
    ),
    'decision', to_jsonb(v_decision),
    'pendingReward', to_jsonb(v_pending) || jsonb_build_object(
      'status', 'pending',
      'cancellation_decision_id', null,
      'cancelled_at', null
    ),
    'idempotent', false
  );
end;
$$;
create or replace function public.approve_mission_completion(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.approve_mission_completion(
    p_workspace,
    p_workflow,
    p_operator,
    p_expected_state,
    p_expected_revision,
    p_idempotency_key
  );
end;
$$;
create or replace function private.cancel_mission_reward_handoff(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid,
  p_reason_category text,
  p_reason_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_expected_state text;
  v_reason_category text;
  v_reason_note text;
  v_request jsonb;
  v_request_hash text;
  v_workflow public.mission_workflows;
  v_submission public.mission_submissions;
  v_contract public.mission_reward_contracts;
  v_approval public.mission_completion_decisions;
  v_decision public.mission_completion_decisions;
  v_pending public.mission_pending_rewards;
  v_replay record;
begin
  perform private.assert_active_mission_operator(p_operator);
  if not exists (
    select 1
    from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then
    raise exception 'not_authorized';
  end if;

  v_expected_state := lower(btrim(coalesce(p_expected_state, '')));
  v_reason_category := lower(btrim(p_reason_category));
  v_reason_note := btrim(p_reason_note);
  if p_workspace is null
    or p_workflow is null
    or p_operator is null
    or v_expected_state <> 'reward_pending'
    or p_expected_revision is null
    or p_expected_revision < 0
    or p_idempotency_key is null
    or v_reason_category is null
    or v_reason_category not in ('contract_error','eligibility_error','duplicate','other')
    or nullif(v_reason_note, '') is null
  then
    raise exception 'validation_failed';
  end if;

  v_request := jsonb_build_object(
    'action', 'cancel_mission_reward_handoff',
    'workspaceId', p_workspace::text,
    'workflowId', p_workflow::text,
    'operatorId', p_operator::text,
    'expectedState', v_expected_state,
    'expectedRevision', p_expected_revision,
    'reasonCategory', v_reason_category,
    'reasonNote', v_reason_note
  );
  v_request_hash := encode(
    extensions.digest(convert_to(v_request::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow
    and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then
    raise exception 'not_found';
  end if;

  -- The workspace owns the key; stale state/revision cannot mask a prior claim.
  select decision.* into v_decision
  from public.mission_completion_decisions decision
  where decision.workspace_id = p_workspace
    and decision.idempotency_key = p_idempotency_key;
  if v_decision.id is not null then
    if v_decision.request_hash <> v_request_hash then
      raise exception 'idempotency_conflict';
    end if;
    if v_decision.mission_workflow_id <> p_workflow
      or v_decision.decision_kind <> 'cancelled'
    then
      raise exception 'idempotency_conflict';
    end if;
  end if;

  select submission.* into v_submission
  from public.mission_submissions submission
  where submission.id = v_workflow.mission_submission_id
    and submission.workspace_id = p_workspace;
  if v_submission.id is null then
    if v_decision.id is not null then
      raise exception 'idempotency_conflict';
    end if;
    raise exception 'pending_reward_not_found';
  end if;

  select contract.* into v_contract
  from public.mission_reward_contracts contract
  where contract.workspace_id = p_workspace
    and contract.mission_workflow_id = p_workflow
    and contract.mission_submission_id = v_submission.id
    and contract.mission_id = v_submission.mission_id;
  if v_contract.id is null then
    if v_decision.id is not null then
      raise exception 'idempotency_conflict';
    end if;
    raise exception 'pending_reward_not_found';
  end if;

  if v_decision.id is not null then
    select pending as pending_row
    into v_replay
    from public.mission_pending_rewards pending
    join public.mission_completion_decisions approval
      on approval.workspace_id = pending.workspace_id
     and approval.mission_workflow_id = pending.mission_workflow_id
     and approval.reward_contract_id = pending.reward_contract_id
     and pending.completion_decision_id = approval.id
     and approval.decision_kind = 'approved'
     and approval.pending_reward_id is null
    join public.mission_completion_decisions cancellation
      on cancellation.workspace_id = pending.workspace_id
     and cancellation.mission_workflow_id = pending.mission_workflow_id
     and cancellation.reward_contract_id = pending.reward_contract_id
     and pending.id = cancellation.pending_reward_id
     and pending.cancellation_decision_id = cancellation.id
     and cancellation.supersedes_decision_id = pending.completion_decision_id
     and cancellation.decision_kind = 'cancelled'
    where pending.workspace_id = p_workspace
      and pending.mission_workflow_id = p_workflow
      and pending.mission_submission_id = v_submission.id
      and pending.creator_id = v_submission.creator_id
      and pending.mission_id = v_submission.mission_id
      and pending.reward_contract_id = v_contract.id
      and pending.status = 'cancelled'
      and pending.cancelled_at is not null
      and cancellation.id = v_decision.id
    limit 1;
    if not found then
      raise exception 'idempotency_conflict';
    end if;
    v_pending := v_replay.pending_row;
    return jsonb_build_object(
      'workflow', jsonb_build_object(
        'id', v_decision.mission_workflow_id,
        'state', 'proof_verified',
        'revision', v_decision.workflow_revision + 1,
        'updated_at', v_decision.decided_at
      ),
      'decision', to_jsonb(v_decision),
      'pendingReward', to_jsonb(v_pending) || jsonb_build_object(
        'status', 'cancelled',
        'cancellation_decision_id', v_decision.id,
        'cancelled_at', v_decision.decided_at
      ),
      'idempotent', true
    );
  end if;

  if v_workflow.state <> v_expected_state then
    raise exception 'wrong_state';
  end if;
  if v_workflow.revision <> p_expected_revision then
    raise exception 'workflow_stale';
  end if;

  select pending.* into v_pending
  from public.mission_pending_rewards pending
  where pending.workspace_id = p_workspace
    and pending.mission_workflow_id = p_workflow
    and pending.mission_submission_id = v_submission.id
    and pending.creator_id = v_submission.creator_id
    and pending.mission_id = v_submission.mission_id
    and pending.reward_contract_id = v_contract.id
    and pending.status = 'pending'
    and pending.cancellation_decision_id is null
    and pending.cancelled_at is null
  for update of pending;
  if v_pending.id is null then
    raise exception 'pending_reward_not_found';
  end if;

  select decision.* into v_approval
  from public.mission_completion_decisions decision
  where decision.id = v_pending.completion_decision_id
    and decision.workspace_id = p_workspace
    and decision.mission_workflow_id = v_workflow.id
    and decision.reward_contract_id = v_pending.reward_contract_id
    and decision.pending_reward_id is null
    and decision.decision_kind = 'approved';
  if v_approval.id is null then
    raise exception 'cancellation_not_allowed';
  end if;

  begin
    insert into public.mission_completion_decisions (
      workspace_id,
      mission_workflow_id,
      decision_kind,
      reward_contract_id,
      pending_reward_id,
      supersedes_decision_id,
      workflow_revision,
      required_item_count,
      verified_required_item_count,
      evidence_snapshot,
      reason_category,
      reason_note,
      decided_by,
      decided_at,
      idempotency_key,
      request_hash
    ) values (
      p_workspace,
      v_workflow.id,
      'cancelled',
      v_pending.reward_contract_id,
      v_pending.id,
      v_approval.id,
      v_workflow.revision,
      v_approval.required_item_count,
      v_approval.verified_required_item_count,
      v_approval.evidence_snapshot,
      v_reason_category,
      v_reason_note,
      p_operator,
      v_now,
      p_idempotency_key,
      v_request_hash
    )
    returning * into v_decision;
  exception when unique_violation then
    raise exception 'idempotency_conflict';
  end;

  update public.mission_pending_rewards
  set status = 'cancelled',
      cancellation_decision_id = v_decision.id,
      cancelled_at = v_now
  where id = v_pending.id
    and workspace_id = p_workspace
    and mission_workflow_id = v_workflow.id
    and reward_contract_id = v_pending.reward_contract_id
    and completion_decision_id = v_approval.id
    and status = 'pending'
    and cancellation_decision_id is null
  returning * into v_pending;
  if v_pending.id is null then
    raise exception 'cancellation_not_allowed';
  end if;

  update public.mission_workflows
  set state = 'proof_verified',
      revision = revision + 1,
      updated_at = v_now
  where id = v_workflow.id
    and workspace_id = p_workspace
    and state = v_expected_state
    and revision = p_expected_revision
  returning * into v_workflow;
  if v_workflow.id is null then
    raise exception 'workflow_stale';
  end if;

  insert into public.mission_workflow_events (
    workspace_id,
    mission_workflow_id,
    actor_type,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata,
    created_at
  ) values (
    p_workspace,
    v_workflow.id,
    'operator',
    p_operator,
    'mission_reward_pending_cancelled',
    'mission_pending_reward',
    v_pending.id,
    jsonb_build_object(
      'decision_id', v_decision.id,
      'pending_reward_id', v_pending.id,
      'workflow_revision', v_workflow.revision,
      'reason_category', v_reason_category
    ),
    v_now
  );

  return jsonb_build_object(
    'workflow', jsonb_build_object(
      'id', v_decision.mission_workflow_id,
      'state', 'proof_verified',
      'revision', v_decision.workflow_revision + 1,
      'updated_at', v_decision.decided_at
    ),
    'decision', to_jsonb(v_decision),
    'pendingReward', to_jsonb(v_pending) || jsonb_build_object(
      'status', 'cancelled',
      'cancellation_decision_id', v_decision.id,
      'cancelled_at', v_decision.decided_at
    ),
    'idempotent', false
  );
end;
$$;
create or replace function public.cancel_mission_reward_handoff(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_expected_state text,
  p_expected_revision integer,
  p_idempotency_key uuid,
  p_reason_category text,
  p_reason_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  return private.cancel_mission_reward_handoff(
    p_workspace,
    p_workflow,
    p_operator,
    p_expected_state,
    p_expected_revision,
    p_idempotency_key,
    p_reason_category,
    p_reason_note
  );
end;
$$;
create or replace function public.get_my_mission_reward_handoff(
  p_submission uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := (select auth.uid());
  v_workspace uuid;
  v_workflow uuid;
  v_mission uuid;
  v_contract uuid;
  v_pending public.mission_pending_rewards;
  v_decision_kind text;
  v_decided_at timestamptz;
  v_read record;
begin
  if v_creator is null then
    raise exception 'not_found';
  end if;

  select workflow.id, submission.workspace_id, submission.mission_id
  into v_workflow, v_workspace, v_mission
  from public.mission_submissions submission
  join public.mission_workflows workflow
    on workflow.mission_submission_id = submission.id
   and workflow.workspace_id = submission.workspace_id
  where submission.id = p_submission
    and submission.creator_id = v_creator;
  if v_workflow is null then
    raise exception 'not_found';
  end if;

  select contract.id into v_contract
  from public.mission_reward_contracts contract
  where contract.workspace_id = v_workspace
    and contract.mission_workflow_id = v_workflow
    and contract.mission_submission_id = p_submission
    and contract.mission_id = v_mission;
  if v_contract is null then
    return null;
  end if;

  select pending as pending_row,
    case
      when pending.status = 'cancelled' then cancellation.decision_kind
      else approval.decision_kind
    end as decision_kind,
    case
      when pending.status = 'cancelled' then cancellation.decided_at
      else approval.decided_at
    end as decided_at
  into v_read
  from public.mission_pending_rewards pending
  join public.mission_completion_decisions approval
    on approval.workspace_id = pending.workspace_id
   and approval.mission_workflow_id = pending.mission_workflow_id
   and approval.reward_contract_id = pending.reward_contract_id
   and approval.id = pending.completion_decision_id
   and approval.decision_kind = 'approved'
   and approval.pending_reward_id is null
  left join public.mission_completion_decisions cancellation
    on cancellation.workspace_id = pending.workspace_id
   and cancellation.mission_workflow_id = pending.mission_workflow_id
   and cancellation.reward_contract_id = pending.reward_contract_id
   and cancellation.id = pending.cancellation_decision_id
   and cancellation.pending_reward_id = pending.id
   and cancellation.supersedes_decision_id = approval.id
   and cancellation.decision_kind = 'cancelled'
  where pending.workspace_id = v_workspace
    and pending.mission_workflow_id = v_workflow
    and pending.mission_submission_id = p_submission
    and pending.creator_id = v_creator
    and pending.mission_id = v_mission
    and pending.reward_contract_id = v_contract
    and (
      (
        pending.status = 'pending'
        and pending.cancellation_decision_id is null
        and cancellation.id is null
      )
      or (
        pending.status = 'cancelled'
        and pending.cancellation_decision_id is not null
        and cancellation.id is not null
      )
    )
  order by pending.created_at desc, pending.id desc
  limit 1;
  if not found then
    return null;
  end if;
  v_pending := v_read.pending_row;
  v_decision_kind := v_read.decision_kind;
  v_decided_at := v_read.decided_at;

  return jsonb_build_object(
    'reward', jsonb_build_object(
      'pointsAmount', v_pending.points_amount,
      'cashAmount', v_pending.cash_amount,
      'currency', v_pending.currency,
      'xpAmount', v_pending.xp_amount
    ),
    'status', v_pending.status,
    'processingWindowDays', v_pending.processing_window_days,
    'targetAt', v_pending.target_at,
    'createdAt', v_pending.created_at,
    'cancelledAt', v_pending.cancelled_at,
    'decisionState', jsonb_build_object(
      'kind', v_decision_kind,
      'decidedAt', v_decided_at
    )
  );
end;
$$;
revoke all on function private.approve_mission_completion(uuid, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_mission_completion(uuid, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_mission_completion(uuid, uuid, uuid, text, integer, uuid)
  to service_role;
revoke all on function private.cancel_mission_reward_handoff(uuid, uuid, uuid, text, integer, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_mission_reward_handoff(uuid, uuid, uuid, text, integer, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_mission_reward_handoff(uuid, uuid, uuid, text, integer, uuid, text, text)
  to service_role;
revoke all on function public.get_my_mission_reward_handoff(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_mission_reward_handoff(uuid)
  to authenticated;

-- SOURCE: derived-sql/20260731130000-reward_handoff_notifications.sql; sha256=185d465ce141791f385462e54563dc5d1a54106d2a25e1239190eaa63da5a540
-- Reward handoff notifications observe append-only workflow decisions. Delivery is
-- best-effort: notification failures cannot roll back a valid workflow event.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started',
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue',
    'mission_publication_correction_requested',
    'mission_publication_verified',
    'mission_reward_pending',
    'mission_reward_pending_cancelled'
  ));
alter table public.notifications drop constraint if exists notifications_workflow_payload_size_check;
alter table public.notifications add constraint notifications_workflow_payload_size_check
  check (
    type not in (
      'mission_product_shipped','mission_receipt_required',
      'mission_revision_requested','mission_draft_approved',
      'mission_approved_to_publish','mission_deadline_approaching',
      'mission_deadline_overdue',
      'mission_publication_correction_requested',
      'mission_publication_verified',
      'mission_reward_pending',
      'mission_reward_pending_cancelled'
    )
    or octet_length(data::text) <= 8192
  );
create or replace function private.notify_reward_handoff_outcome(
  p_recipient uuid,
  p_type text,
  p_pending_reward uuid,
  p_semantic_key text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_claimed integer;
  v_data jsonb;
begin
  if p_recipient is null
     or p_pending_reward is null
     or nullif(btrim(p_semantic_key), '') is null
     or p_type not in (
       'mission_reward_pending',
       'mission_reward_pending_cancelled'
     )
     or jsonb_typeof(p_payload) <> 'object'
  then
    return false;
  end if;

  select pending.workspace_id
  into v_workspace
  from public.mission_pending_rewards pending
  where pending.id = p_pending_reward;

  if v_workspace is null then
    return false;
  end if;

  v_data := jsonb_strip_nulls(jsonb_build_object(
    'mission_title', p_payload->'mission_title',
    'mission_slug', p_payload->'mission_slug',
    'submission_id', p_payload->'submission_id',
    'target_at', p_payload->'target_at',
    'reward_components', p_payload->'reward_components',
    'reason_category', p_payload->'reason_category'
  ));

  begin
    insert into private.mission_workflow_notification_dedupe
      (recipient_id, notification_type, entity_type, entity_id, semantic_key)
    values
      (p_recipient, p_type, 'mission_pending_reward', p_pending_reward, p_semantic_key)
    on conflict do nothing;

    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
      return false;
    end if;

    insert into public.notifications
      (user_id, workspace_id, type, data, entity_type, entity_id)
    values
      (p_recipient, v_workspace, p_type, v_data, 'mission_pending_reward', p_pending_reward);

    return true;
  exception
    when others then
      return false;
  end;
exception
  when others then
    return false;
end;
$$;
create or replace function private.notify_reward_handoff_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_mission_title text;
  v_mission_slug text;
  v_submission uuid;
  v_target_at timestamptz;
  v_points_amount integer;
  v_cash_amount numeric;
  v_xp_amount integer;
  v_reason_category text;
  v_reward_components text[];
  v_type text;
  v_semantic_key text;
  v_payload jsonb;
begin
  v_type := case new.event_type
    when 'mission_completion_approved'
      then 'mission_reward_pending'
    when 'mission_reward_pending_cancelled'
      then 'mission_reward_pending_cancelled'
    else null
  end;

  if v_type is null
     or new.entity_type is distinct from 'mission_pending_reward'
     or new.entity_id is null
     or nullif(new.metadata->>'decision_id', '') is null
  then
    return new;
  end if;

  select
    pending.creator_id,
    mission.title,
    mission.slug,
    submission.id,
    pending.target_at,
    pending.points_amount,
    pending.cash_amount,
    pending.xp_amount,
    case
      when new.event_type = 'mission_reward_pending_cancelled'
        then cancellation.reason_category
      else approval.reason_category
    end
  into
    v_recipient,
    v_mission_title,
    v_mission_slug,
    v_submission,
    v_target_at,
    v_points_amount,
    v_cash_amount,
    v_xp_amount,
    v_reason_category
  from public.mission_pending_rewards pending
  join public.mission_workflows workflow
    on workflow.id = pending.mission_workflow_id
   and workflow.workspace_id = pending.workspace_id
  join public.mission_submissions submission
    on submission.id = pending.mission_submission_id
   and submission.workspace_id = pending.workspace_id
   and submission.creator_id = pending.creator_id
   and submission.mission_id = pending.mission_id
   and workflow.mission_submission_id = submission.id
  join public.missions mission
    on mission.id = pending.mission_id
   and mission.workspace_id = pending.workspace_id
   and mission.id = submission.mission_id
  join public.mission_reward_contracts contract
    on contract.id = pending.reward_contract_id
   and contract.workspace_id = pending.workspace_id
   and contract.mission_workflow_id = pending.mission_workflow_id
   and contract.mission_submission_id = pending.mission_submission_id
   and contract.mission_id = pending.mission_id
  join public.mission_completion_decisions approval
    on approval.id = pending.completion_decision_id
   and approval.workspace_id = pending.workspace_id
   and approval.mission_workflow_id = pending.mission_workflow_id
   and approval.reward_contract_id = contract.id
   and approval.decision_kind = 'approved'
  left join public.mission_completion_decisions cancellation
    on cancellation.id = pending.cancellation_decision_id
   and cancellation.workspace_id = pending.workspace_id
   and cancellation.mission_workflow_id = pending.mission_workflow_id
   and cancellation.reward_contract_id = contract.id
   and cancellation.pending_reward_id = pending.id
   and cancellation.supersedes_decision_id = pending.completion_decision_id
   and cancellation.decision_kind = 'cancelled'
  where pending.id = new.entity_id
    and pending.workspace_id = new.workspace_id
    and pending.mission_workflow_id = new.mission_workflow_id
    and (
      (new.event_type = 'mission_completion_approved'
        and approval.id::text = new.metadata->>'decision_id')
      or
      (new.event_type = 'mission_reward_pending_cancelled'
        and cancellation.id::text = new.metadata->>'decision_id')
    );

  if v_recipient is null then
    return new;
  end if;

  v_reward_components := array_remove(array[
    case when v_points_amount > 0 then 'points' end,
    case when v_cash_amount > 0 then 'cash' end,
    case when v_xp_amount > 0 then 'xp' end
  ], null);
  v_semantic_key := concat('decision:', new.metadata->>'decision_id');
  v_payload := jsonb_build_object(
    'mission_title', v_mission_title,
    'mission_slug', v_mission_slug,
    'submission_id', v_submission,
    'target_at', v_target_at,
    'reward_components', to_jsonb(v_reward_components),
    'reason_category', case
      when v_type = 'mission_reward_pending_cancelled' then v_reason_category
      else null
    end
  );

  perform private.notify_reward_handoff_outcome(
    v_recipient,
    v_type,
    new.entity_id,
    v_semantic_key,
    v_payload
  );

  return new;
exception
  when others then
    return new;
end;
$$;
drop trigger if exists reward_handoff_workflow_event_notifications
  on public.mission_workflow_events;
create trigger reward_handoff_workflow_event_notifications
after insert on public.mission_workflow_events
for each row execute function private.notify_reward_handoff_event();
revoke all on function private.notify_reward_handoff_outcome(uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.notify_reward_handoff_event()
  from public, anon, authenticated, service_role;

-- SOURCE: derived-sql/20260731140000-reward_handoff_release_hardening.sql; sha256=2f16bf3832091191bbdbe2206bdcb9bfe6f41fa04bc526ca61929e0bfc568f24
-- Release hardening: durable backfill replay and an authorized, idempotent
-- retry path for failure-isolated in-app reward-handoff notifications.

alter table public.mission_reward_contracts
  add column backfill_idempotency_key uuid,
  add column backfill_request_hash text;
alter table public.mission_reward_contracts
  add constraint mission_reward_contracts_backfill_replay_check check (
    (source = 'join' and backfill_idempotency_key is null and backfill_request_hash is null)
    or
    (source = 'operator_backfill' and (
      (backfill_idempotency_key is null and backfill_request_hash is null)
      or
      (backfill_idempotency_key is not null
        and nullif(btrim(backfill_request_hash), '') is not null)
    ))
  ),
  add constraint mission_reward_contracts_workspace_backfill_key_unique
    unique (workspace_id, backfill_idempotency_key);
create or replace function private.backfill_mission_reward_contract(
  p_workspace uuid,
  p_workflow uuid,
  p_operator uuid,
  p_points_amount integer,
  p_cash_amount numeric,
  p_currency text,
  p_xp_amount integer,
  p_source_mission_updated_at timestamptz,
  p_confirmation_evidence_source text,
  p_confirmation_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_submission public.mission_submissions;
  v_mission public.missions;
  v_contract public.mission_reward_contracts;
  v_request_hash text;
begin
  perform private.assert_active_mission_operator(p_operator);
  if not exists (
    select 1 from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then raise exception 'not_authorized'; end if;

  if nullif(btrim(p_confirmation_reason), '') is null then
    raise exception 'backfill_reason_required';
  end if;
  if p_workspace is null or p_workflow is null or p_operator is null
    or p_points_amount is null or p_points_amount < 0
    or p_cash_amount is null or p_cash_amount < 0
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_xp_amount is null or p_xp_amount <> 0
    or p_confirmation_evidence_source not in ('mission_brief','signed_agreement','operator_record','other')
    or p_idempotency_key is null
  then raise exception 'backfill_contract_invalid'; end if;

  v_request_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_array(
        'reward_contract_backfill', p_workspace, p_operator, p_workflow, p_points_amount, p_cash_amount,
        p_currency, p_xp_amount, p_source_mission_updated_at,
        p_confirmation_evidence_source, btrim(p_confirmation_reason)
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select workflow.* into v_workflow
  from public.mission_workflows workflow
  where workflow.id = p_workflow and workflow.workspace_id = p_workspace
  for update;
  if v_workflow.id is null then raise exception 'reward_workflow_not_found'; end if;

  select contract.* into v_contract
  from public.mission_reward_contracts contract
  where contract.workspace_id = p_workspace
    and contract.backfill_idempotency_key = p_idempotency_key
  for update;
  if v_contract.id is not null then
    if v_contract.mission_workflow_id = p_workflow
      and v_contract.backfill_request_hash = v_request_hash
    then
      return jsonb_build_object('contract', to_jsonb(v_contract), 'idempotent', true);
    end if;
    raise exception 'idempotency_conflict';
  end if;

  select contract.* into v_contract
  from public.mission_reward_contracts contract
  where contract.mission_workflow_id = p_workflow
    and contract.workspace_id = p_workspace
  for update;
  if v_contract.id is not null then raise exception 'reward_contract_exists'; end if;

  select submission.* into v_submission
  from public.mission_submissions submission
  where submission.id = v_workflow.mission_submission_id
    and submission.workspace_id = p_workspace;
  if v_submission.id is null then raise exception 'reward_contract_source_missing'; end if;

  select mission.* into v_mission
  from public.missions mission
  where mission.id = v_submission.mission_id
    and mission.workspace_id = p_workspace;
  if v_mission.id is null then raise exception 'reward_contract_source_missing'; end if;

  insert into public.mission_reward_contracts (
    workspace_id, mission_workflow_id, mission_submission_id, mission_id,
    points_amount, cash_amount, currency, xp_amount, source,
    source_mission_updated_at, confirmed_by, confirmation_evidence_source,
    confirmation_reason, backfill_idempotency_key, backfill_request_hash
  ) values (
    p_workspace, v_workflow.id, v_submission.id, v_mission.id,
    p_points_amount, p_cash_amount, p_currency, p_xp_amount, 'operator_backfill',
    p_source_mission_updated_at, p_operator, p_confirmation_evidence_source,
    btrim(p_confirmation_reason), p_idempotency_key, v_request_hash
  ) returning * into v_contract;

  return jsonb_build_object('contract', to_jsonb(v_contract), 'idempotent', false);
exception
  when unique_violation then
    select contract.* into v_contract
    from public.mission_reward_contracts contract
    where contract.workspace_id = p_workspace
      and contract.backfill_idempotency_key = p_idempotency_key;
    if v_contract.id is not null
      and v_contract.mission_workflow_id = p_workflow
      and v_contract.backfill_request_hash = v_request_hash
    then
      return jsonb_build_object('contract', to_jsonb(v_contract), 'idempotent', true);
    end if;
    raise exception 'idempotency_conflict';
end;
$$;
create or replace function public.retry_reward_handoff_notification(
  p_workspace uuid,
  p_operator uuid,
  p_pending_reward uuid,
  p_notification_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_mission_title text;
  v_mission_slug text;
  v_submission uuid;
  v_target_at timestamptz;
  v_points integer;
  v_cash numeric;
  v_xp integer;
  v_reason text;
  v_decision uuid;
  v_components text[];
  v_semantic_key text;
  v_delivered boolean;
  v_exists boolean;
begin
  if coalesce((select auth.jwt() ->> 'role') = 'service_role', false) is not true then
    raise exception 'not_authorized';
  end if;
  perform private.assert_active_mission_operator(p_operator);
  if not exists (
    select 1 from public.brand_users membership
    where membership.user_id = p_operator
      and membership.workspace_id = p_workspace
      and membership.active
  ) then raise exception 'not_authorized'; end if;
  if p_notification_type not in ('mission_reward_pending','mission_reward_pending_cancelled') then
    raise exception 'validation_failed';
  end if;

  select pending.creator_id, mission.title, mission.slug, submission.id,
    pending.target_at, pending.points_amount, pending.cash_amount, pending.xp_amount,
    case when p_notification_type = 'mission_reward_pending_cancelled'
      then cancellation.reason_category else null end,
    case when p_notification_type = 'mission_reward_pending_cancelled'
      then cancellation.id else approval.id end
  into v_recipient, v_mission_title, v_mission_slug, v_submission,
    v_target_at, v_points, v_cash, v_xp, v_reason, v_decision
  from public.mission_pending_rewards pending
  join public.mission_workflows workflow
    on workflow.id = pending.mission_workflow_id
   and workflow.workspace_id = pending.workspace_id
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.id = pending.mission_submission_id
   and submission.workspace_id = pending.workspace_id
   and submission.creator_id = pending.creator_id
   and submission.mission_id = pending.mission_id
  join public.missions mission
    on mission.id = submission.mission_id
   and mission.id = pending.mission_id
   and mission.workspace_id = pending.workspace_id
  join public.mission_reward_contracts contract
    on contract.id = pending.reward_contract_id
   and contract.workspace_id = pending.workspace_id
   and contract.mission_workflow_id = pending.mission_workflow_id
   and contract.mission_submission_id = pending.mission_submission_id
   and contract.mission_id = pending.mission_id
  join public.mission_completion_decisions approval
    on approval.id = pending.completion_decision_id
   and approval.workspace_id = pending.workspace_id
   and approval.mission_workflow_id = pending.mission_workflow_id
   and approval.reward_contract_id = contract.id
   and approval.decision_kind = 'approved'
    and approval.pending_reward_id is null
  left join public.mission_completion_decisions cancellation
    on cancellation.id = pending.cancellation_decision_id
   and cancellation.workspace_id = pending.workspace_id
   and cancellation.mission_workflow_id = pending.mission_workflow_id
   and cancellation.reward_contract_id = contract.id
   and cancellation.pending_reward_id = pending.id
   and cancellation.supersedes_decision_id = approval.id
   and cancellation.decision_kind = 'cancelled'
  where pending.id = p_pending_reward
    and pending.workspace_id = p_workspace
    and ((p_notification_type = 'mission_reward_pending' and pending.status = 'pending' and pending.cancellation_decision_id is null)
      or (p_notification_type = 'mission_reward_pending_cancelled' and pending.status = 'cancelled' and cancellation.id is not null));
  if v_recipient is null or v_decision is null then raise exception 'not_found'; end if;

  v_components := array_remove(array[
    case when v_points > 0 then 'points' end,
    case when v_cash > 0 then 'cash' end,
    case when v_xp > 0 then 'xp' end
  ], null);
  v_semantic_key := concat('decision:', v_decision);
  v_delivered := private.notify_reward_handoff_outcome(
    v_recipient, p_notification_type, p_pending_reward, v_semantic_key,
    jsonb_build_object(
      'mission_title', v_mission_title,
      'mission_slug', v_mission_slug,
      'submission_id', v_submission,
      'target_at', v_target_at,
      'reward_components', to_jsonb(v_components),
      'reason_category', case when p_notification_type = 'mission_reward_pending_cancelled' then v_reason else null end
    )
  );
  select exists (
    select 1 from public.notifications notification
    where notification.user_id = v_recipient
      and notification.workspace_id = p_workspace
      and notification.type = p_notification_type
      and notification.entity_type = 'mission_pending_reward'
      and notification.entity_id = p_pending_reward
  ) into v_exists;
  if not v_exists then raise exception 'notification_retry_failed'; end if;
  return jsonb_build_object('delivered', true, 'idempotent', not v_delivered);
end;
$$;
revoke all on function public.retry_reward_handoff_notification(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.retry_reward_handoff_notification(uuid, uuid, uuid, text)
  to service_role;

-- SOURCE: derived-sql/20260731150000-enable_pilot_if_empty.sql; sha256=f72b21b70d158c20965683bdf65e2874400d1fe235fdb27065e72fdb32898b2d
-- Atomically enable one pilot mission without racing a creator submission.
-- The service role is the only caller; browser roles must never mutate mode.
create or replace function public.enable_pilot_if_empty(
  p_workspace_id uuid,
  p_mission_id uuid,
  p_expected_workflow_mode text default 'legacy',
  p_next_workflow_mode text default 'active_workspace',
  p_expected_status text default 'draft',
  p_reject_if_submission_exists boolean default true
)
returns setof public.missions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission public.missions;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  -- Lock the exact mission row before evaluating the submission guard.
  select * into v_mission
    from public.missions
   where id = p_mission_id
     and workspace_id = p_workspace_id
   for update;

  if not found then
    return;
  end if;

  update public.missions as mission
     set creator_workflow_mode = p_next_workflow_mode
   where mission.id = p_mission_id
     and mission.workspace_id = p_workspace_id
     and mission.creator_workflow_mode = p_expected_workflow_mode
     and mission.status = p_expected_status
     and (
       not p_reject_if_submission_exists
       or not exists (
         select 1
           from public.mission_submissions submission
          where submission.mission_id = mission.id
       )
     )
  returning mission.* into v_mission;

  if found then
    return next v_mission;
  end if;
end;
$$;
revoke all on function public.enable_pilot_if_empty(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.enable_pilot_if_empty(uuid, uuid, text, text, text, boolean)
  to service_role;

-- SOURCE: derived-sql/20260805120000-review_hardening.sql; sha256=7c1ef9751eaeef53069d4f4835cb10aa9afc0f1c1850806002a3669bf069e191
-- 20260805120000_review_hardening.sql
-- Close six direct-PostgREST write/read paths that bypass the Hono handlers:
--   A. brand table-wide UPDATE on missions          -> column grant + live-reward freeze
--   B. brand table-wide UPDATE on campaigns         -> column grant + settle budget guard
--   C. legacy join/submit RPCs on active missions   -> creator_workflow_mode gate
--   D. creator-forced workflow refresh              -> operator-owned state short-circuit
--   E. verified-identity spoofing on social handles -> verification cleared on identity change
--   F. draft missions readable by creators          -> status predicate in the RLS policy

-- A. missions: brands may only write the authoring surface --------------------------------------
-- 0023 granted `update` table-wide and 0004 granted `select`; the table-wide UPDATE is the one
-- that let a brand PATCH filled/creator_workflow_mode/reward columns straight through PostgREST.
-- The column list is exactly what routes/brand.ts writes (EDITABLE_COLS + the brief fields +
-- the publish/close lifecycle stamps).
revoke update on public.missions from authenticated;
grant update (
  slug, title, description, category, mission_type, access_type, required_level,
  points_reward, cash_reward, cpm_rate, cpm_budget_pool, deadline, quota,
  deliverables, requirements, platforms, effort,
  target_audience, dos, donts, key_messages, reference_links,
  status, published_at, closed_at, updated_at
) on public.missions to authenticated;
-- approve_submission reads the reward live at approval time, so a reward edit after publish
-- silently repays every creator who already delivered. A policy cannot see the OLD row, so the
-- pre-image is read through a SECURITY DEFINER helper: it is `stable`, therefore it runs on the
-- statement snapshot and sees the row as it was before this UPDATE. SECURITY DEFINER also means
-- the read is not re-filtered by the very policy that calls it (no policy recursion).
-- The status arm is what makes the reward arm hold: without it a brand demotes a live mission to
-- 'draft' and then edits the rewards freely on the next request.
create or replace function private.mission_brand_update_allowed(
  p_mission uuid,
  p_status text,
  p_points_reward integer,
  p_cash_reward numeric,
  p_cpm_rate numeric,
  p_cpm_budget_pool numeric
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (mission.status = 'draft' or p_status <> 'draft')
     and (mission.status = 'draft'
       or (mission.points_reward   is not distinct from p_points_reward
       and mission.cash_reward     is not distinct from p_cash_reward
       and mission.cpm_rate        is not distinct from p_cpm_rate
       and mission.cpm_budget_pool is not distinct from p_cpm_budget_pool))
  from public.missions mission
  where mission.id = p_mission
$$;
revoke all on function private.mission_brand_update_allowed(uuid, text, integer, numeric, numeric, numeric)
  from public, anon;
grant execute on function private.mission_brand_update_allowed(uuid, text, integer, numeric, numeric, numeric)
  to authenticated;
drop policy if exists missions_brand_update on public.missions;
create policy missions_brand_update on public.missions
  for update to authenticated
  using (workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active))
  with check (
    workspace_id in (select workspace_id from public.brand_users where user_id = auth.uid() and active)
    and private.mission_brand_update_allowed(id, status, points_reward, cash_reward, cpm_rate, cpm_budget_pool)
  );
-- B. campaigns: status/settled_at/prize_tiers belong to close_campaign / settle_campaign --------
-- 0025 granted `update` table-wide, so PATCH {"status":"settled"} terminated a campaign without
-- settle_campaign ever running. The column list mirrors CAMPAIGN_EDITABLE_COLS.
revoke update on public.campaigns from authenticated;
grant update (
  slug, title, description, starts_at, ends_at,
  goal_target, completion_bonus_points, completion_bonus_xp, updated_at
) on public.campaigns to authenticated;
-- settle_campaign, verbatim from 0025 except the points branch now consults the campaign
-- workspace wallet before minting. Points carry no HK$ denomination, so the assertion is the
-- one the wallet can express without an invented rate: an ENFORCED wallet that is exhausted
-- cannot fund a prize round. Enforcement is off by default, so unfunded workspaces are unaffected.
create or replace function public.settle_campaign(p_campaign uuid)
returns public.campaigns
language plpgsql security definer set search_path = public
as $$
declare
  v_c        public.campaigns;
  v_tier     jsonb;
  v_prev_to  int := 0;
  v_row      record;
  v_home     uuid;
  v_pbal     int;
  v_ebal     numeric;
  v_bgt_bal  numeric;
  v_bgt_enf  boolean;
  v_cash     numeric;
  v_points   int;
  v_xp       int;
  v_ref      text;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if v_c.id is null then raise exception 'not_found'; end if;
  if v_c.settled_at is not null then return v_c; end if;        -- idempotent: already settled
  if v_c.status <> 'closed' then raise exception 'wrong_state'; end if;

  -- Re-validate prize_tiers in-RPC: ascending, non-overlapping, non-negative.
  for v_tier in select * from jsonb_array_elements(v_c.prize_tiers) loop
    if (v_tier->>'rank_from')::int < 1
       or (v_tier->>'rank_to')::int < (v_tier->>'rank_from')::int
       or (v_tier->>'rank_from')::int <= v_prev_to
       or coalesce((v_tier->>'cash')::numeric, 0)  < 0
       or coalesce((v_tier->>'points')::int, 0)    < 0
       or coalesce((v_tier->>'xp')::int, 0)        < 0
    then raise exception 'invalid_prize_tiers'; end if;
    v_prev_to := (v_tier->>'rank_to')::int;
  end loop;

  -- Rank via the shared ranker; stamp prize_rank (defensively upserting any missing row).
  for v_row in select * from public.rank_campaign(p_campaign) loop
    insert into public.campaign_participants (campaign_id, creator_id, workspace_id, approved_count)
      values (p_campaign, v_row.creator_id, v_c.workspace_id, v_row.approved)
      on conflict (campaign_id, creator_id) do nothing;
    update public.campaign_participants set prize_rank = v_row.rank
      where campaign_id = p_campaign and creator_id = v_row.creator_id;
  end loop;

  -- Pay each tier. A creator wins at most one rank → one campaign_prize: ref per (campaign,creator).
  for v_tier in select * from jsonb_array_elements(v_c.prize_tiers) loop
    v_cash   := coalesce((v_tier->>'cash')::numeric, 0);
    v_points := coalesce((v_tier->>'points')::int, 0);
    v_xp     := coalesce((v_tier->>'xp')::int, 0);
    for v_row in
      select cp.id as part_id, cp.creator_id, cp.prize_rank
        from public.campaign_participants cp
       where cp.campaign_id = p_campaign
         and cp.prize_rank between (v_tier->>'rank_from')::int and (v_tier->>'rank_to')::int
         and cp.prize_granted_at is null
    loop
      v_ref := 'campaign_prize:' || p_campaign || ':' || v_row.creator_id;
      begin   -- per-winner savepoint
        select workspace_id into v_home from public.creators where id = v_row.creator_id;

        -- CASH: debit the CAMPAIGN workspace budget (hard cap); credit the HOME workspace earnings.
        if v_cash > 0 then
          select balance, enforced into v_bgt_bal, v_bgt_enf
            from public.workspace_budgets where workspace_id = v_c.workspace_id for update;
          if coalesce(v_bgt_enf, false) and coalesce(v_bgt_bal, 0) < v_cash then
            raise exception 'insufficient_budget';   -- NOT caught here → rolls back the whole settle
          end if;
          if v_bgt_bal is not null then
            update public.workspace_budgets set balance = balance - v_cash, updated_at = now()
              where workspace_id = v_c.workspace_id returning balance into v_bgt_bal;
            insert into public.workspace_budget_transactions
              (workspace_id, type, delta, balance_after, source_ref, description)
              values (v_c.workspace_id, 'debit', -v_cash, v_bgt_bal, v_ref, v_c.title);
          end if;
          insert into public.earnings_balances (creator_id, workspace_id, available)
            values (v_row.creator_id, v_home, 0) on conflict (creator_id, workspace_id) do nothing;
          select available into v_ebal from public.earnings_balances
            where creator_id = v_row.creator_id and workspace_id = v_home for update;
          insert into public.earnings_transactions
            (creator_id, workspace_id, type, amount, balance_after, source_ref, description)
            values (v_row.creator_id, v_home, 'earn', v_cash, v_ebal + v_cash, v_ref, v_c.title);
          update public.earnings_balances set available = available + v_cash, updated_at = now()
            where creator_id = v_row.creator_id and workspace_id = v_home;
        end if;

        -- POINTS: HOME workspace, gated by the CAMPAIGN workspace wallet.
        if v_points > 0 then
          select balance, enforced into v_bgt_bal, v_bgt_enf
            from public.workspace_budgets where workspace_id = v_c.workspace_id for update;
          if coalesce(v_bgt_enf, false) and coalesce(v_bgt_bal, 0) <= 0 then
            raise exception 'insufficient_budget';   -- NOT caught here → rolls back the whole settle
          end if;
          insert into public.point_balances (creator_id, workspace_id, balance)
            values (v_row.creator_id, v_home, 0) on conflict (creator_id, workspace_id) do nothing;
          select balance into v_pbal from public.point_balances
            where creator_id = v_row.creator_id and workspace_id = v_home for update;
          insert into public.point_transactions
            (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
            values (v_row.creator_id, v_home, 'bonus', v_points, v_pbal + v_points, v_ref, v_c.title);
          update public.point_balances set balance = balance + v_points, updated_at = now()
            where creator_id = v_row.creator_id and workspace_id = v_home;
        end if;

        -- XP.
        if v_xp > 0 then
          update public.creators set xp = xp + v_xp where id = v_row.creator_id;
        end if;

        update public.campaign_participants set prize_granted_at = now() where id = v_row.part_id;

        begin   -- best-effort notification
          insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
            values (v_row.creator_id, v_c.workspace_id, 'campaign_prize_awarded', 'campaign', p_campaign,
                    jsonb_build_object('campaign_title', coalesce(v_c.title, ''),
                                       'campaign_slug',  coalesce(v_c.slug, ''),
                                       'rank',   v_row.prize_rank,
                                       'cash',   v_cash,
                                       'points', v_points,
                                       'xp',     v_xp));
        exception when others then
          raise warning 'campaign_prize_awarded notification failed for campaign % creator %', p_campaign, v_row.creator_id;
        end;

      exception
        when unique_violation then null;   -- already paid → skip this winner (DB backstop)
      end;
    end loop;
  end loop;

  update public.campaigns set status = 'settled', settled_at = now(), updated_at = now()
    where id = p_campaign returning * into v_c;
  return v_c;
end;
$$;
revoke all on function public.settle_campaign(uuid) from public, anon, authenticated;
grant execute on function public.settle_campaign(uuid) to service_role;
-- C. legacy join/submit may not touch an active-workspace mission -------------------------------
-- Both RPCs are granted to `authenticated`, so a creator could call them directly and inject a
-- row into the legacy payout queue without deliverables, publication proof or proof review.
-- creator_workflow_mode defaults to 'legacy' and is CHECKed to ('legacy','active_workspace'), so
-- the gate keys on the active value and leaves every legacy (and pre-column NULL) row untouched.
-- public.join_active_mission calls the join body, so that body moves to `private` and the public
-- entry point carries the gate.
create or replace function private.join_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_level text;
  m record;
  v_rows int;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;

  select workspace_id, level into v_ws, v_level
    from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  select id, workspace_id, status, access_type, deadline, required_level, quota, filled
    into m from public.missions where id = p_mission;
  if m.id is null or m.workspace_id <> v_ws then raise exception 'not_found'; end if;
  if m.status <> 'active' then raise exception 'closed'; end if;
  if m.access_type <> 'open' then raise exception 'not_open'; end if;
  if m.deadline is not null and m.deadline < current_date then raise exception 'closed'; end if;

  -- Effective-level gate. L2+ missions need both XP and a verified handle;
  -- the codes are decomposed so the message is honest (earn XP vs verify).
  -- level_ordinal is 1-indexed (L0=1, L1=2, L2=3...) — compare against
  -- level_ordinal('L2'), NOT a bare 2, so the verification gate applies to L2+
  -- only and L0/L1 missions stay XP-only.
  if public.level_ordinal(m.required_level) >= public.level_ordinal('L2') then
    if public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
      raise exception 'level_locked';
    elsif not exists (
      select 1 from public.creator_social_accounts
      where creator_id = v_creator and owner_verified
    ) then
      raise exception 'verification_required';
    end if;
  elsif public.level_ordinal(v_level) < public.level_ordinal(m.required_level) then
    raise exception 'level_locked';
  end if;

  if exists (select 1 from public.mission_submissions
             where mission_id = p_mission and creator_id = v_creator)
    then raise exception 'already_joined'; end if;

  update public.missions set filled = filled + 1
    where id = p_mission and filled < quota;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'mission_full'; end if;

  begin
    insert into public.mission_submissions
      (mission_id, creator_id, workspace_id, status, xp_awarded)
      values (p_mission, v_creator, v_ws, 'joined', 10)
      returning * into v_sub;
  exception when unique_violation then
    raise exception 'already_joined';
  end;
  update public.creators set xp = xp + 10 where id = v_creator;
  return v_sub;
end;
$$;
create or replace function public.join_mission(p_mission uuid)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_mode text;
begin
  -- A missing mission falls through so the shared body keeps raising 'not_found'.
  select creator_workflow_mode into v_mode from public.missions where id = p_mission;
  if v_mode = 'active_workspace' then raise exception 'workflow_mode_mismatch'; end if;
  return private.join_mission(p_mission);
end;
$$;
create or replace function public.submit_mission(p_mission uuid, p_urls text[], p_data jsonb)
returns public.mission_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_creator uuid := auth.uid();
  v_mode text;
  v_sub public.mission_submissions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;
  if p_urls is null or array_length(p_urls, 1) is null then raise exception 'empty_urls'; end if;

  select creator_workflow_mode into v_mode from public.missions where id = p_mission;
  if v_mode = 'active_workspace' then raise exception 'workflow_mode_mismatch'; end if;

  select * into v_sub from public.mission_submissions
    where mission_id = p_mission and creator_id = v_creator for update;
  if v_sub.id is null then raise exception 'wrong_state'; end if;
  if v_sub.status <> 'joined' then raise exception 'wrong_state'; end if;

  update public.mission_submissions set
    status = 'submitted',
    content_urls = p_urls,
    submission_data = coalesce(p_data, '{}'::jsonb),
    submitted_at = now(),
    review_deadline = now() + interval '48 hours',   -- fixed SLA; per-mission column lands with the S9 cron
    xp_awarded = xp_awarded + 25
    where id = v_sub.id
    returning * into v_sub;
  update public.creators set xp = xp + 25 where id = v_creator;
  return v_sub;
end;
$$;
create or replace function public.join_active_mission(p_mission uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.mission_submissions;
  v_workflow public.mission_workflows;
  v_contract public.mission_reward_contracts;
begin
  v_submission := private.join_mission(p_mission);
  v_workflow := private.create_mission_workflow(v_submission.id);

  insert into public.mission_reward_contracts (
    workspace_id,
    mission_workflow_id,
    mission_submission_id,
    mission_id,
    points_amount,
    cash_amount,
    currency,
    xp_amount,
    source,
    source_mission_updated_at
  )
  select
    v_workflow.workspace_id,
    v_workflow.id,
    v_submission.id,
    mission.id,
    mission.points_reward,
    coalesce(mission.cash_reward, 0),
    'HKD',
    0,
    'join',
    mission.updated_at
  from public.missions mission
  where mission.id = v_submission.mission_id
    and mission.workspace_id = v_submission.workspace_id
  returning * into v_contract;

  if not found then
    raise exception 'reward_contract_source_missing';
  end if;

  return jsonb_build_object(
    'submission', to_jsonb(v_submission),
    'workflow', to_jsonb(v_workflow),
    'rewardContract', to_jsonb(v_contract)
  );
end;
$$;
revoke all on function private.join_mission(uuid) from public, anon, authenticated, service_role;
revoke all on function public.join_mission(uuid)                  from public, anon;
revoke all on function public.submit_mission(uuid, text[], jsonb) from public, anon;
revoke all on function public.join_active_mission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_mission(uuid)                  to authenticated, service_role;
grant execute on function public.submit_mission(uuid, text[], jsonb) to authenticated, service_role;
grant execute on function public.join_active_mission(uuid) to authenticated;
-- D. reward_pending is operator-owned; refresh must not recompute it ----------------------------
-- approve_mission_completion writes 'reward_pending' and cancel_mission_reward_handoff matches on
-- it (`state = v_expected_state`) before reverting to 'proof_verified'. The work-item derivation
-- below cannot produce 'reward_pending', so any refresh silently undid the approval and stranded
-- the pending reward. 'cancelled'/'expired' were already excluded for the same reason: they are
-- written by the lifecycle, never derived. Verbatim from 20260723090000 except that guard.
create or replace function private.refresh_mission_workflow_state(p_workflow uuid)
returns public.mission_workflows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow public.mission_workflows;
  v_state text;
  v_actor uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_required_count integer;
begin
  select workflow.* into v_workflow
  from public.mission_workflows workflow
  join public.mission_submissions submission
    on submission.id = workflow.mission_submission_id
   and submission.workspace_id = workflow.workspace_id
  where workflow.id = p_workflow
    and (v_service or exists (
      select 1 from public.creators creator
      where creator.id = v_actor
        and creator.id = submission.creator_id
        and creator.workspace_id = workflow.workspace_id
    ))
  for update of workflow;
  if v_workflow.id is null then raise exception 'not_found'; end if;
  if v_workflow.state in ('reward_pending', 'cancelled', 'expired') then return v_workflow; end if;

  select count(*) into v_required_count
  from public.mission_work_items item
  where item.mission_workflow_id = v_workflow.id
    and item.workspace_id = v_workflow.workspace_id
    and item.required;

  if exists (
    select 1 from public.mission_fulfillments fulfillment
    where fulfillment.mission_workflow_id = v_workflow.id
      and fulfillment.workspace_id = v_workflow.workspace_id
      and fulfillment.status <> 'received'
  ) then
    v_state := 'fulfillment_pending';
  elsif v_required_count > 0 and not exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.required
      and item.state <> 'proof_verified'
  ) then
    v_state := 'proof_verified';
  elsif exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.required
      and item.state in (
        'proof_submitted', 'proof_under_review',
        'proof_correction_requested', 'proof_verified'
      )
  ) then
    v_state := 'publication_in_progress';
  elsif not exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.required
      and item.state <> 'approved_to_publish'
  ) then
    v_state := 'approved_to_publish';
  elsif exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.state = 'revision_requested'
  ) then
    v_state := 'revision_requested';
  elsif exists (
    select 1 from public.mission_work_items item
    where item.mission_workflow_id = v_workflow.id
      and item.workspace_id = v_workflow.workspace_id
      and item.state in ('submitted', 'under_review')
  ) then
    v_state := 'in_review';
  else
    v_state := 'drafting';
  end if;

  update public.mission_workflows
  set state = v_state, updated_at = now()
  where id = v_workflow.id and workspace_id = v_workflow.workspace_id
  returning * into v_workflow;
  return v_workflow;
end;
$$;
revoke all on function private.refresh_mission_workflow_state(uuid)
  from public, anon, authenticated, service_role;
-- The public wrapper stays creator-callable: it carries its own ownership check (a workflow the
-- caller does not own raises 'not_found'), and every state it can still derive comes from work
-- items the creator already drives through their own RPCs. The short-circuit above is what closes
-- the escalation, so revoking the wrapper would remove a granted capability without adding safety.
grant execute on function public.refresh_mission_workflow_state(uuid) to authenticated, service_role;
-- E. a verified badge may not follow a handle to another account --------------------------------
-- 0012 grants column UPDATE on (handle, profile_url) and the self-update policy never looks at
-- owner_verified, so a creator could verify a throwaway account, repoint it at someone else's
-- handle, and keep the badge — permanently squatting that handle under the verified-handle unique
-- index. Clearing (rather than blocking) matches the flow: /verification then
-- /verification/confirm re-runs markVerified on the new handle, so re-verification still works.
-- handle_normalized is a stored generated column and is not populated in a BEFORE trigger, so the
-- comparison recomputes it with the generation expression from 0012.
create or replace function private.clear_social_account_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(regexp_replace(new.handle, '^@+', '')) is distinct from old.handle_normalized
     or new.profile_url is distinct from old.profile_url
  then
    new.owner_verified := false;
    new.verified_at := null;
    new.verification_code := null;
    new.verification_code_expires_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_social_account_verification()
  from public, anon, authenticated, service_role;
drop trigger if exists creator_social_accounts_clear_verification on public.creator_social_accounts;
create trigger creator_social_accounts_clear_verification
  before update of handle, profile_url on public.creator_social_accounts
  for each row when (old.owner_verified)
  execute function private.clear_social_account_verification();
-- F. creators never see an unpublished brief ----------------------------------------------------
-- routes/missions.ts filters status='active', but the policy did not, so the anon key plus a
-- session token read draft briefs, cash_reward, cpm_budget_pool and target-audience notes.
-- 'closed' stays readable: a creator must still open a mission they already engaged with.
-- The brand (missions_brand_select) and staff (service_role) read paths are untouched.
drop policy if exists missions_workspace on public.missions;
create policy missions_workspace on public.missions
  for select using (
    workspace_id = private.current_workspace_id()
    and status in ('active', 'closed')
  );

-- SOURCE: derived-sql/20261022170454-audit_legacy_evidence.sql; sha256=97f20d911f3a36152746a5c64c9066580aad975b0163c3b60849a12dd65fc204
alter table public.mission_submissions add column evidence_revision bigint not null default 0 check (evidence_revision >= 0);
create table public.legacy_evidence_corrections (
  workspace_id uuid not null references public.workspaces(id),
  operator_id uuid not null references auth.users(id),
  request_id uuid not null,
  submission_id uuid not null references public.mission_submissions(id),
  payload_hash text not null,
  previous_evidence jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, operator_id, request_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.legacy_evidence_corrections FROM PUBLIC, anon, authenticated, service_role;

alter table public.legacy_evidence_corrections enable row level security;
revoke all on public.legacy_evidence_corrections from public, anon, authenticated;
grant select on public.legacy_evidence_corrections to service_role;
create function private.valid_legacy_evidence(p_urls text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(p_urls) > 0 and not exists (
    select 1 from unnest(p_urls) u(url)
    where url is null or btrim(url) = ''
      or btrim(url) !~* '^https?://(\[[0-9a-f:.]+\]|[^/@:?#[:space:]\\]+)(:[0-9]{1,5})?([/?#][^[:space:]\\]*)?$'
  ), false);
$$;
create function private.guard_legacy_submission_evidence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.content_urls is distinct from old.content_urls or new.status is distinct from old.status then
      new.evidence_revision := old.evidence_revision + 1;
    end if;
  end if;
  if new.status in ('submitted', 'under_review', 'approved')
    and exists (select 1 from public.missions m where m.id = new.mission_id and m.creator_workflow_mode = 'legacy')
    and not private.valid_legacy_evidence(new.content_urls) then
    raise exception using errcode = '22023', message = 'invalid_evidence';
  end if;
  return new;
end;
$$;
revoke all on function private.valid_legacy_evidence(text[]) from public, anon, authenticated;
revoke all on function private.guard_legacy_submission_evidence() from public, anon, authenticated;
grant execute on function private.valid_legacy_evidence(text[]) to service_role;
grant execute on function private.guard_legacy_submission_evidence() to service_role;
create trigger legacy_submission_evidence_guard
  before insert or update of content_urls, status on public.mission_submissions
  for each row execute function private.guard_legacy_submission_evidence();
create function public.request_legacy_evidence_correction(p_workspace uuid, p_operator uuid, p_submission uuid,
  p_request uuid, p_expected_revision bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_submission public.mission_submissions%rowtype; v_receipt public.legacy_evidence_corrections%rowtype;
  v_hash text; v_result jsonb; v_actor text;
begin
  select email into v_actor from public.staff_users where user_id=p_operator and active;
  if not found or not exists(select 1 from public.brand_users where user_id=p_operator and workspace_id=p_workspace and active) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if p_request is null or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_note),'') is null then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  select * into v_submission from public.mission_submissions where id=p_submission and workspace_id=p_workspace for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('submission',p_submission,'revision',p_expected_revision,'note',btrim(p_note))::text,'UTF8')),'hex');
  select * into v_receipt from public.legacy_evidence_corrections where workspace_id=p_workspace and operator_id=p_operator and request_id=p_request;
  if found then
    if v_receipt.payload_hash<>v_hash then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return v_receipt.result;
  end if;
  if v_submission.evidence_revision<>p_expected_revision then raise exception using errcode='P0001',message='EVIDENCE_STALE'; end if;
  if v_submission.status not in ('submitted','under_review','rejected') or private.valid_legacy_evidence(v_submission.content_urls)
    or not exists(select 1 from public.missions where id=v_submission.mission_id and workspace_id=p_workspace and creator_workflow_mode='legacy') then
    raise exception using errcode='P0001',message='wrong_state';
  end if;
  update public.mission_submissions set status='joined',review_notes=btrim(p_note),reviewed_at=null where id=p_submission;
  v_result:=jsonb_build_object('submission_id',p_submission,'status','joined','revision',v_submission.evidence_revision+1,'receipt_id',p_request);
  insert into public.legacy_evidence_corrections(workspace_id,operator_id,request_id,submission_id,payload_hash,previous_evidence,result)
    values(p_workspace,p_operator,p_request,p_submission,v_hash,jsonb_build_object('status',v_submission.status,'urls',v_submission.content_urls,
      'review_notes',v_submission.review_notes,'reviewed_at',v_submission.reviewed_at,'revision',v_submission.evidence_revision),v_result);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'legacy_evidence.correction_requested','submission',p_submission::text,v_submission.creator_id,
      jsonb_build_object('request_id',p_request,'revision',v_submission.evidence_revision+1));
  return v_result;
end;
$$;
revoke all on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) to service_role;

-- SOURCE: derived-sql/20261022170751-audit_crm_commands.sql; sha256=e3a49e72e7c85ebce752e5ab220eaae7aed142eedbfd32a039c334740239000d
alter table public.creator_review_statuses add column revision bigint not null default 0 check (revision >= 0);
create table public.operator_crm_command_receipts (
  workspace_id uuid not null references public.workspaces(id),
  operator_id uuid not null references auth.users(id),
  request_id uuid not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, operator_id, request_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.operator_crm_command_receipts FROM PUBLIC, anon, authenticated, service_role;

alter table public.operator_crm_command_receipts enable row level security;
revoke all on public.operator_crm_command_receipts from public, anon, authenticated;
grant select on public.operator_crm_command_receipts to service_role;
create function private.execute_creator_crm_command(
  p_workspace uuid, p_operator uuid, p_request uuid, p_expected_revision bigint,
  p_creator uuid, p_kind text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_review public.creator_review_statuses%rowtype;
  v_receipt public.operator_crm_command_receipts%rowtype;
  v_revision bigint;
  v_hash text;
  v_note jsonb;
  v_result jsonb;
  v_actor text;
  v_body text;
begin
  if p_request is null or p_expected_revision is null or p_expected_revision < 0 or p_kind not in ('review', 'note') then
    raise exception using errcode = '22023', message = 'invalid_command';
  end if;
  select email into v_actor from public.staff_users where user_id = p_operator and active;
  if not found or not exists (select 1 from public.brand_users where user_id = p_operator and workspace_id = p_workspace and active) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  -- This existing row is the lock anchor even before a creator has a review record.
  perform 1 from public.creators where id = p_creator and workspace_id = p_workspace for update;
  if not found then raise exception using errcode = 'P0002', message = 'creator_not_found'; end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('creator', p_creator, 'kind', p_kind,
    'revision', p_expected_revision, 'payload', p_payload)::text, 'UTF8')), 'hex');
  select * into v_receipt from public.operator_crm_command_receipts
    where workspace_id = p_workspace and operator_id = p_operator and request_id = p_request;
  if found then
    if v_receipt.payload_hash <> v_hash then raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT'; end if;
    return v_receipt.result;
  end if;
  select * into v_review from public.creator_review_statuses where workspace_id = p_workspace and creator_id = p_creator;
  v_revision := coalesce(v_review.revision, 0);
  if v_revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'CRM_STALE'; end if;

  if p_kind = 'review' then
    if coalesce(p_payload->>'status', '') not in ('needs_review', 'approved', 'flagged')
      or coalesce(p_payload->>'risk_level', '') not in ('low', 'medium', 'high', 'unknown') then
      raise exception using errcode = '22023', message = 'invalid_command';
    end if;
    v_body := nullif(btrim(p_payload->>'note'), '');
    if p_payload->>'status' = 'flagged' and v_body is null then
      raise exception using errcode = '22023', message = 'flagged_note_required';
    end if;
    insert into public.creator_review_statuses(creator_id, workspace_id, status, risk_level, summary, reviewed_by, last_reviewed_at, revision)
      values (p_creator, p_workspace, p_payload->>'status', p_payload->>'risk_level', nullif(btrim(p_payload->>'summary'), ''), p_operator::text, now(), v_revision + 1)
      on conflict (workspace_id, creator_id) do update set status = excluded.status, risk_level = excluded.risk_level,
        summary = excluded.summary, reviewed_by = excluded.reviewed_by, last_reviewed_at = excluded.last_reviewed_at, revision = excluded.revision
      returning * into v_review;
    insert into public.operator_audit_events(workspace_id, operator_id, actor_label, event_type, target_type, target_id, creator_id, metadata)
      values (p_workspace, p_operator::text, v_actor, 'creator_review.updated', 'creator', p_creator::text, p_creator,
        jsonb_build_object('request_id', p_request, 'revision', v_review.revision, 'status', v_review.status, 'risk_level', v_review.risk_level));
  else
    v_body := nullif(btrim(p_payload->>'body'), '');
    if v_body is null or coalesce(p_payload->>'category', '') not in ('quality', 'brand_safety', 'fit', 'social', 'other') then
      raise exception using errcode = '22023', message = 'invalid_command';
    end if;
    insert into public.creator_review_statuses(creator_id, workspace_id, revision) values(p_creator, p_workspace, v_revision + 1)
      on conflict (workspace_id, creator_id) do update set revision = excluded.revision returning * into v_review;
  end if;
  if v_body is not null then
    insert into public.creator_review_notes(creator_id, workspace_id, operator_id, category, body)
      values (p_creator, p_workspace, p_operator::text, case when p_kind = 'review' then 'other' else p_payload->>'category' end, v_body)
      returning to_jsonb(creator_review_notes.*) into v_note;
    insert into public.operator_audit_events(workspace_id, operator_id, actor_label, event_type, target_type, target_id, creator_id, metadata)
      values (p_workspace, p_operator::text, v_actor, 'creator_note.created', 'creator', p_creator::text, p_creator,
        jsonb_build_object('request_id', p_request, 'revision', v_review.revision, 'category', case when p_kind = 'review' then 'other' else p_payload->>'category' end));
  end if;
  v_result := jsonb_build_object('revision', v_review.revision, 'receipt_id', p_request, 'review', to_jsonb(v_review), 'note', v_note);
  insert into public.operator_crm_command_receipts(workspace_id, operator_id, request_id, payload_hash, result)
    values (p_workspace, p_operator, p_request, v_hash, v_result);
  return v_result;
end;
$$;
create function public.apply_creator_review_command(p_workspace uuid, p_operator uuid, p_request uuid, p_expected_revision bigint,
  p_creator uuid, p_status text, p_risk_level text, p_summary text, p_note text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.execute_creator_crm_command(p_workspace, p_operator, p_request, p_expected_revision, p_creator, 'review',
    jsonb_build_object('status', p_status, 'risk_level', p_risk_level, 'summary', nullif(btrim(p_summary), ''), 'note', nullif(btrim(p_note), '')));
$$;
create function public.add_creator_review_note_command(p_workspace uuid, p_operator uuid, p_request uuid, p_expected_revision bigint,
  p_creator uuid, p_category text, p_body text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.execute_creator_crm_command(p_workspace, p_operator, p_request, p_expected_revision, p_creator, 'note',
    jsonb_build_object('category', p_category, 'body', nullif(btrim(p_body), '')));
$$;
revoke all on function private.execute_creator_crm_command(uuid,uuid,uuid,bigint,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.apply_creator_review_command(uuid,uuid,uuid,bigint,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.add_creator_review_note_command(uuid,uuid,uuid,bigint,uuid,text,text) from public, anon, authenticated;
grant execute on function private.execute_creator_crm_command(uuid,uuid,uuid,bigint,uuid,text,jsonb) to service_role;
grant execute on function public.apply_creator_review_command(uuid,uuid,uuid,bigint,uuid,text,text,text,text) to service_role;
grant execute on function public.add_creator_review_note_command(uuid,uuid,uuid,bigint,uuid,text,text) to service_role;

-- SOURCE: derived-sql/20261022171111-audit_creator_queue.sql; sha256=c066134df67c0a58bab2d773b7cad8b358a34a8a5a5422a4f11c5c5dd9ed7c27
create function public.list_creator_review_queue_page(
  p_workspace uuid, p_operator uuid, p_mission uuid default null, p_query text default '',
  p_status text default null, p_risk text default null, p_sort text default 'last_activity', p_page integer default 1
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists (select 1 from public.staff_users where user_id = p_operator and active)
    or not exists (select 1 from public.brand_users where user_id = p_operator and workspace_id = p_workspace and active) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_mission is not null and not exists (select 1 from public.missions where id = p_mission and workspace_id = p_workspace) then
    raise exception using errcode = 'P0002', message = 'mission_not_found';
  end if;
  if p_page is null or p_page < 1 or p_page > 1000000 or char_length(p_query) > 200
    or p_sort not in ('last_activity', 'trust_score', 'level', 'social_freshness')
    or (p_status is not null and p_status not in ('needs_review', 'approved', 'flagged'))
    or (p_risk is not null and p_risk not in ('low', 'medium', 'high', 'unknown')) then
    raise exception using errcode = '22023', message = 'invalid_command';
  end if;
  with filtered as (
    select c.id, coalesce(r.status, 'needs_review') as review_status,
      greatest(c.created_at, r.updated_at, social.synced_at, shortlist.updated_at) as activity_at,
      social.synced_at, coalesce(trust.score, -1) as trust_score,
      case when c.level ~* '^L?[0-9]+$' then regexp_replace(c.level, '^[Ll]', '')::integer else -1 end as level_rank
    from public.creators c
    left join public.creator_review_statuses r on r.creator_id = c.id and r.workspace_id = p_workspace
    left join lateral (select max(s.api_synced_at) synced_at from public.creator_social_accounts s
      where s.creator_id = c.id and s.sync_status = 'synced') social on true
    left join lateral (select max(s.updated_at) updated_at from public.mission_shortlists s
      where s.creator_id = c.id and s.workspace_id = p_workspace and (p_mission is null or s.mission_id = p_mission)) shortlist on true
    left join lateral (select avg((value::text)::numeric) score from jsonb_each(coalesce(c.scores, '{}'::jsonb)) where jsonb_typeof(value) = 'number') trust on true
    where c.workspace_id = p_workspace
      and (coalesce(p_query, '') = '' or strpos(lower(coalesce(c.display_name, '')), lower(p_query)) > 0)
      and (p_status is null or coalesce(r.status, 'needs_review') = p_status)
      and (p_risk is null or coalesce(r.risk_level, 'unknown') = p_risk)
      and not (p_mission is not null and p_status is null and coalesce(r.status, 'needs_review') = 'flagged')
  ), ordered as (
    select id, row_number() over(order by
      case when p_mission is not null and review_status = 'approved' then 0 else 1 end,
      case when p_sort = 'last_activity' then activity_at end desc nulls last,
      case when p_sort = 'social_freshness' then synced_at end desc nulls last,
      case when p_sort = 'trust_score' then trust_score end desc nulls last,
      case when p_sort = 'level' then level_rank end desc nulls last, id) as rank
    from filtered
  ), page as (select id, rank from ordered order by rank limit 25 offset (p_page::bigint - 1) * 25)
  select jsonb_build_object('creatorIds', coalesce((select jsonb_agg(id order by rank) from page), '[]'::jsonb),
    'total', (select count(*) from filtered), 'page', p_page, 'pageSize', 25) into v_result;
  return v_result;
end;
$$;
revoke all on function public.list_creator_review_queue_page(uuid,uuid,uuid,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.list_creator_review_queue_page(uuid,uuid,uuid,text,text,text,text,integer) to service_role;
create index creators_workspace_id_page_idx on public.creators(workspace_id, id);

-- SOURCE: derived-sql/20261022171843-audit_assistant_requests.sql; sha256=ca4bf535b629bc3511da23e3cfcb580f07f30630f3b346d1970bdb5e0acb1da2
create table public.assistant_requests (
  creator_id uuid not null references public.creators(id),
  workspace_id uuid not null references public.workspaces(id),
  request_id uuid not null,
  payload_hash text not null,
  message text not null check (char_length(message) between 1 and 4000),
  locale text not null,
  context_version text not null,
  conversation_id uuid references public.assistant_conversations(id),
  state text not null check (state in ('reserved','generating','saved','unknown')),
  lease_until timestamptz not null,
  provider_started_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (creator_id, workspace_id, request_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.assistant_requests FROM PUBLIC, anon, authenticated, service_role;

create index assistant_requests_quota_idx on public.assistant_requests(creator_id, workspace_id, created_at desc);
alter table public.assistant_requests enable row level security;
revoke all on public.assistant_requests from public, anon, authenticated;
grant select on public.assistant_requests to authenticated, service_role;
create policy assistant_requests_self on public.assistant_requests for select to authenticated using (
  creator_id = (select auth.uid()) and exists (select 1 from public.creators c where c.id = creator_id and c.workspace_id = assistant_requests.workspace_id)
);
alter table public.assistant_messages add column request_id uuid;
alter table public.assistant_messages add column turn_order smallint not null default 0 check (turn_order in (0,1));
create unique index assistant_messages_request_role_idx on public.assistant_messages(conversation_id, request_id, role);
create function public.reserve_assistant_request(p_workspace uuid, p_creator uuid, p_request uuid, p_message text, p_locale text,
  p_conversation uuid default null, p_context_version text default 'r1') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_request public.assistant_requests%rowtype; v_hash text; v_creator uuid := p_creator;
begin
  perform 1 from public.creators where id = v_creator and workspace_id = p_workspace for update;
  if not found then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  if p_request is null or p_message is null or char_length(p_message) not between 1 and 4000
    or p_locale not in ('zh-HK','en') or p_context_version is null or char_length(p_context_version) > 80 then
    raise exception using errcode = '22023', message = 'bad_request';
  end if;
  if p_conversation is not null and not exists (select 1 from public.assistant_conversations where id = p_conversation and creator_id = v_creator and workspace = p_workspace::text) then
    raise exception using errcode = 'P0002', message = 'not_found';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('message',p_message,'locale',p_locale,
    'conversation',p_conversation,'context_version',p_context_version)::text,'UTF8')),'hex');
  select * into v_request from public.assistant_requests where creator_id = v_creator and workspace_id = p_workspace and request_id = p_request;
  if found then
    if v_request.payload_hash <> v_hash then raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT'; end if;
    if v_request.state = 'saved' then return jsonb_build_object('action','replay','result',v_request.result); end if;
    if v_request.state = 'reserved' then return jsonb_build_object('action','reserved','request_id',p_request); end if;
    return jsonb_build_object('action','wait','request_id',p_request,'persistence','unknown');
  end if;
  update public.assistant_requests set state = 'unknown'
    where creator_id = v_creator and workspace_id = p_workspace and state in ('reserved','generating') and lease_until < clock_timestamp();
  if (select count(*) from public.assistant_requests where creator_id = v_creator and workspace_id = p_workspace and created_at > clock_timestamp() - interval '1 minute') >= 5 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;
  if exists (select 1 from public.assistant_requests where creator_id = v_creator and workspace_id = p_workspace and state in ('reserved','generating')) then
    raise exception using errcode = 'P0001', message = 'REQUEST_INFLIGHT';
  end if;
  insert into public.assistant_requests(creator_id,workspace_id,request_id,payload_hash,message,locale,context_version,conversation_id,state,lease_until)
    values(v_creator,p_workspace,p_request,v_hash,p_message,p_locale,p_context_version,p_conversation,'reserved',clock_timestamp()+interval '30 seconds');
  return jsonb_build_object('action','reserved','request_id',p_request);
end;
$$;
create function public.claim_assistant_request(p_workspace uuid,p_creator uuid,p_request uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.creators where id = p_creator and workspace_id = p_workspace) then return false; end if;
  update public.assistant_requests set state='generating', provider_started_at=clock_timestamp(), lease_until=clock_timestamp()+interval '30 seconds'
    where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request and state='reserved' and lease_until>=clock_timestamp();
  return found;
end;
$$;
create function public.save_assistant_turn(p_workspace uuid,p_creator uuid,p_request uuid,p_answer text,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_request public.assistant_requests%rowtype; v_conversation uuid; v_result jsonb;
begin
  select * into v_request from public.assistant_requests where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request for update;
  if not found or not exists(select 1 from public.creators where id=p_creator and workspace_id=p_workspace) then
    raise exception using errcode='P0002',message='not_found';
  end if;
  if v_request.state='saved' then
    if v_request.result->>'answer' is distinct from p_answer or v_request.result->'citations' is distinct from p_citations then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT';
    end if;
    return v_request.result;
  end if;
  if v_request.state<>'generating' then raise exception using errcode='P0001',message='outcome_unknown'; end if;
  if p_answer is null or char_length(p_answer)>40000 or jsonb_typeof(p_citations) is distinct from 'array' then
    raise exception using errcode='22023',message='bad_result';
  end if;
  v_conversation:=v_request.conversation_id;
  if v_conversation is null then
    insert into public.assistant_conversations(creator_id,workspace) values(p_creator,p_workspace::text) returning id into v_conversation;
  elsif not exists(select 1 from public.assistant_conversations where id=v_conversation and creator_id=p_creator and workspace=p_workspace::text) then
    raise exception using errcode='P0002',message='not_found';
  end if;
  insert into public.assistant_messages(conversation_id,role,content,citations,request_id,turn_order) values
    (v_conversation,'user',v_request.message,'[]'::jsonb,p_request,0), (v_conversation,'assistant',p_answer,p_citations,p_request,1);
  update public.assistant_conversations set last_message_at=clock_timestamp() where id=v_conversation;
  v_result:=jsonb_build_object('conversation_id',v_conversation,'request_id',p_request,'answer',p_answer,'citations',p_citations,'persistence','saved');
  update public.assistant_requests set state='saved',conversation_id=v_conversation,result=v_result
    where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request;
  return v_result;
end;
$$;
create function public.mark_assistant_request_unknown(p_workspace uuid,p_creator uuid,p_request uuid) returns void
language sql security definer set search_path = '' as $$
  update public.assistant_requests set state='unknown' where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request and state='generating';
$$;
create function public.get_assistant_request(p_workspace uuid,p_request uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(r.result,jsonb_build_object('request_id',r.request_id,'state',r.state,'persistence','unknown'))
    from public.assistant_requests r where r.creator_id=auth.uid() and r.workspace_id=p_workspace and r.request_id=p_request
    and exists(select 1 from public.creators c where c.id=auth.uid() and c.workspace_id=p_workspace);
$$;
revoke all on function public.reserve_assistant_request(uuid,uuid,uuid,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.claim_assistant_request(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.mark_assistant_request_unknown(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_assistant_request(uuid,uuid) from public, anon;
grant execute on function public.reserve_assistant_request(uuid,uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.claim_assistant_request(uuid,uuid,uuid) to service_role;
grant execute on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.mark_assistant_request_unknown(uuid,uuid,uuid) to service_role;
grant execute on function public.get_assistant_request(uuid,uuid) to authenticated;

-- SOURCE: derived-sql/20261022182544-audit_legacy_review_notes.sql; sha256=6d34a166c82e8beabfe53e9b8f5cb382abeecbee12f638a59b3cf4eb095c220d
create or replace function public.request_legacy_evidence_correction(p_workspace uuid, p_operator uuid, p_submission uuid,
  p_request uuid, p_expected_revision bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_submission public.mission_submissions%rowtype; v_receipt public.legacy_evidence_corrections%rowtype;
  v_hash text; v_result jsonb; v_actor text;
begin
  select email into v_actor from public.staff_users where user_id=p_operator and active;
  if not found or not exists(select 1 from public.brand_users where user_id=p_operator and workspace_id=p_workspace and active) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if p_request is null or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_note),'') is null then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  select * into v_submission from public.mission_submissions where id=p_submission and workspace_id=p_workspace for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('submission',p_submission,'revision',p_expected_revision,'note',btrim(p_note))::text,'UTF8')),'hex');
  select * into v_receipt from public.legacy_evidence_corrections where workspace_id=p_workspace and operator_id=p_operator and request_id=p_request;
  if found then
    if v_receipt.payload_hash<>v_hash then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return v_receipt.result;
  end if;
  if v_submission.evidence_revision<>p_expected_revision then raise exception using errcode='P0001',message='EVIDENCE_STALE'; end if;
  if v_submission.status not in ('submitted','under_review','rejected') or private.valid_legacy_evidence(v_submission.content_urls)
    or not exists(select 1 from public.missions where id=v_submission.mission_id and workspace_id=p_workspace and creator_workflow_mode='legacy') then
    raise exception using errcode='P0001',message='wrong_state';
  end if;
  update public.mission_submissions set status='joined',reviewer_notes=btrim(p_note),reviewed_at=null where id=p_submission;
  v_result:=jsonb_build_object('submission_id',p_submission,'status','joined','revision',v_submission.evidence_revision+1,'receipt_id',p_request);
  insert into public.legacy_evidence_corrections(workspace_id,operator_id,request_id,submission_id,payload_hash,previous_evidence,result)
    values(p_workspace,p_operator,p_request,p_submission,v_hash,jsonb_build_object('status',v_submission.status,'urls',v_submission.content_urls,
      'review_notes',v_submission.reviewer_notes,'reviewed_at',v_submission.reviewed_at,'revision',v_submission.evidence_revision),v_result);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'legacy_evidence.correction_requested','submission',p_submission::text,v_submission.creator_id,
      jsonb_build_object('request_id',p_request,'revision',v_submission.evidence_revision+1));
  return v_result;
end;
$$;
revoke all on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) to service_role;

-- SOURCE: derived-sql/20261023091050-academy_learning.sql; sha256=bb5c4bd6c4b7811dc28dad837caaf9b66abe4488e88886fe96ec034d017be115
create table public.academy_lessons (
  id uuid not null default gen_random_uuid(),
  content_version integer not null default 1 check (content_version > 0),
  track_id uuid not null references public.academy_content(id) on delete restrict,
  title_zh text not null default '' check (length(title_zh) <= 200),
  title_en text not null default '' check (length(title_en) <= 200),
  body_zh text not null default '' check (length(body_zh) <= 50000),
  body_en text not null default '' check (length(body_en) <= 50000),
  position integer not null default 0 check (position between 0 and 10000),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  revision integer not null default 1 check (revision > 0),
  approval_ref text check (length(approval_ref) between 1 and 500),
  approved_by uuid references auth.users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, content_version),
  constraint academy_lesson_published_content check (status <> 'published' or
    (nullif(btrim(title_zh),'') is not null and nullif(btrim(body_zh),'') is not null
     and approval_ref is not null and approved_by is not null and published_at is not null))
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.academy_lessons FROM PUBLIC, anon, authenticated, service_role;

create unique index academy_lesson_one_published on public.academy_lessons(id) where status='published';
create unique index academy_lesson_one_draft on public.academy_lessons(id) where status='draft';
create index academy_lessons_track_order on public.academy_lessons(track_id,status,position,id);
create table public.creator_lesson_progress (
  creator_id uuid not null references public.creators(id) on delete restrict,
  lesson_id uuid not null,
  content_version integer not null,
  status text not null default 'completed' check (status='completed'),
  completed_at timestamptz not null default now(),
  primary key (creator_id,lesson_id,content_version),
  foreign key (lesson_id,content_version) references public.academy_lessons(id,content_version) on delete restrict
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.creator_lesson_progress FROM PUBLIC, anon, authenticated, service_role;

create index creator_lesson_progress_lesson on public.creator_lesson_progress(lesson_id,content_version);
alter table public.academy_lessons enable row level security;
alter table public.creator_lesson_progress enable row level security;
revoke all on public.academy_lessons,public.creator_lesson_progress from public,anon,authenticated,service_role;
grant select on public.academy_lessons,public.creator_lesson_progress to authenticated,service_role;
-- Reuse the existing raw-level ordinal and verified-owner trust authority.
create function private.can_read_academy_track(p_track uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.academy_content t join public.creators c on c.id=(select auth.uid())
    where t.id=p_track and t.kind='track' and t.status='published'
      and coalesce(t.required_level,'L0') in ('L0','L1','L2','L3','L4','L5','L6')
      and public.level_ordinal(c.level)>=public.level_ordinal(coalesce(t.required_level,'L0'))
      and (public.level_ordinal(coalesce(t.required_level,'L0'))<public.level_ordinal('L2')
        or private.creator_is_trusted(c.id))
  );
$$;
revoke all on function private.can_read_academy_track(uuid) from public,anon,service_role;
grant execute on function private.can_read_academy_track(uuid) to authenticated;
create function public.can_read_academy_track(p_track uuid) returns boolean
language sql stable security invoker set search_path='' as $$ select private.can_read_academy_track(p_track); $$;
revoke all on function public.can_read_academy_track(uuid) from public,anon,service_role;
grant execute on function public.can_read_academy_track(uuid) to authenticated;
create policy academy_lessons_published_eligible on public.academy_lessons for select to authenticated
using (status='published' and private.can_read_academy_track(track_id));
create policy creator_lesson_progress_self on public.creator_lesson_progress for select to authenticated
using (creator_id=(select auth.uid()));
create function private.guard_academy_lesson_history() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status in ('published','archived') and
    (row(new.id,new.content_version,new.track_id,new.title_zh,new.title_en,new.body_zh,new.body_en,new.position,new.approval_ref,new.approved_by,new.published_at)
     is distinct from row(old.id,old.content_version,old.track_id,old.title_zh,old.title_en,old.body_zh,old.body_en,old.position,old.approval_ref,old.approved_by,old.published_at)
     or new.status not in ('published','archived') or (old.status='archived' and new.status<>'archived')) then
    raise exception using errcode='23514',message='published_lesson_immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_academy_lesson_history() from public,anon,authenticated,service_role;
create trigger academy_lesson_history_guard before update on public.academy_lessons
for each row execute function private.guard_academy_lesson_history();
create function public.complete_academy_lesson(p_track uuid,p_lesson uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_creator uuid:=auth.uid(); v_row public.creator_lesson_progress%rowtype;
begin
  -- Consistent lock order with author commands; a publish cannot swap versions mid-completion.
  perform 1 from public.academy_content where id=p_track for share;
  if v_creator is null or not private.can_read_academy_track(p_track) then
    raise exception using errcode='42501',message='academy_locked';
  end if;
  perform 1 from public.academy_lessons where id=p_lesson and track_id=p_track and content_version=p_version and status='published' for share;
  if not found then raise exception using errcode='40001',message='version_changed'; end if;
  insert into public.creator_lesson_progress(creator_id,lesson_id,content_version)
  values(v_creator,p_lesson,p_version) on conflict (creator_id,lesson_id,content_version) do nothing;
  select * into strict v_row from public.creator_lesson_progress
    where creator_id=v_creator and lesson_id=p_lesson and content_version=p_version;
  return jsonb_build_object('lessonId',v_row.lesson_id,'contentVersion',v_row.content_version,'status',v_row.status,'completedAt',v_row.completed_at);
end;
$$;
revoke all on function public.complete_academy_lesson(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.complete_academy_lesson(uuid,uuid,integer) to authenticated;
create function public.get_academy_learning(p_track uuid,p_lang text default 'zh-HK') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_creator uuid:=auth.uid(); v_lessons jsonb; v_history jsonb; v_total integer; v_completed integer;
begin
  perform 1 from public.academy_content where id=p_track for share;
  if v_creator is null or not private.can_read_academy_track(p_track) then
    raise exception using errcode='42501',message='academy_locked';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'trackId',l.track_id,'contentVersion',l.content_version,'status',l.status,'position',l.position,
    'title',case when p_lang='en' and l.title_en<>'' then l.title_en else l.title_zh end,
    'body',case when p_lang='en' and l.body_en<>'' then l.body_en else l.body_zh end,
    'completed',p.creator_id is not null,'completedAt',p.completed_at) order by l.position,l.id),'[]'::jsonb),
    count(*),count(p.creator_id) into v_lessons,v_total,v_completed
  from public.academy_lessons l left join public.creator_lesson_progress p
    on p.lesson_id=l.id and p.content_version=l.content_version and p.creator_id=v_creator
  where l.track_id=p_track and l.status='published';
  select coalesce(jsonb_agg(jsonb_build_object('lessonId',p.lesson_id,'contentVersion',p.content_version,'completedAt',p.completed_at)
    order by p.completed_at,p.lesson_id,p.content_version),'[]'::jsonb) into v_history
  from public.creator_lesson_progress p join public.academy_lessons l on l.id=p.lesson_id and l.content_version=p.content_version
  where p.creator_id=v_creator and l.track_id=p_track;
  return jsonb_build_object('lessons',v_lessons,'progress',jsonb_build_object('completed',v_completed,'total',v_total),'history',v_history);
end;
$$;
revoke all on function public.get_academy_learning(uuid,text) from public,anon,service_role;
grant execute on function public.get_academy_learning(uuid,text) to authenticated;
-- Service-only command; the API supplies its authenticated human staff identity.
-- Parent row lock serializes edits/publish, revision checks reject stale drafts.
create function public.author_academy_lesson(p_staff uuid,p_track uuid,p_lesson uuid,p_version integer,p_revision integer,p_input jsonb,p_action text,p_approval_ref text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.academy_lessons%rowtype; v_values jsonb; v_next integer;
begin
  if p_staff is null or not exists(select 1 from public.staff_users where user_id=p_staff and active) then
    raise exception using errcode='42501',message='staff_required';
  end if;
  perform 1 from public.academy_content where id=p_track and kind='track' for update;
  if not found then raise exception using errcode='P0002',message='track_not_found'; end if;
  if p_action is null or p_action not in ('save','publish','archive') or p_input is null or jsonb_typeof(p_input)<>'object' then
    raise exception using errcode='22023',message='invalid_lesson_command';
  end if;
  if p_lesson is null then
    if p_action<>'save' then raise exception using errcode='22023',message='invalid_lesson_command'; end if;
    insert into public.academy_lessons(track_id,title_zh,title_en,body_zh,body_en,position)
      values(p_track,coalesce(p_input->>'title_zh',''),coalesce(p_input->>'title_en',''),coalesce(p_input->>'body_zh',''),coalesce(p_input->>'body_en',''),coalesce((p_input->>'position')::integer,0)) returning * into v;
    return to_jsonb(v);
  end if;
  select * into v from public.academy_lessons where id=p_lesson and track_id=p_track and content_version=p_version for update;
  if not found then raise exception using errcode='P0002',message='lesson_not_found'; end if;
  -- Exact publish replay is a no-op; it never reapproves or rewrites the snapshot.
  if p_action='publish' and v.status='published' and v.approval_ref=p_approval_ref and p_revision=v.revision-1 then return to_jsonb(v); end if;
  if p_revision is null or v.revision<>p_revision or v.status='archived' then
    raise exception using errcode='40001',message='lesson_revision_conflict';
  end if;
  if p_action='save' then
    v_values:=to_jsonb(v)||p_input;
    if v.status='published' then
      if exists(select 1 from public.academy_lessons where id=p_lesson and status='draft') then
        raise exception using errcode='40001',message='lesson_draft_exists';
      end if;
      select max(content_version)+1 into v_next from public.academy_lessons where id=p_lesson;
      insert into public.academy_lessons(id,content_version,track_id,title_zh,title_en,body_zh,body_en,position)
        values(p_lesson,v_next,p_track,v_values->>'title_zh',v_values->>'title_en',v_values->>'body_zh',v_values->>'body_en',(v_values->>'position')::integer) returning * into v;
    else
      update public.academy_lessons set title_zh=v_values->>'title_zh',title_en=v_values->>'title_en',body_zh=v_values->>'body_zh',body_en=v_values->>'body_en',position=(v_values->>'position')::integer,revision=revision+1,updated_at=clock_timestamp()
        where id=p_lesson and content_version=p_version returning * into v;
    end if;
  elsif p_action='publish' then
    if v.status<>'draft' or nullif(btrim(v.title_zh),'') is null or nullif(btrim(v.body_zh),'') is null or nullif(btrim(p_approval_ref),'') is null or length(p_approval_ref)>500 then
      raise exception using errcode='22023',message='approved_content_required';
    end if;
    update public.academy_lessons set status='archived',revision=revision+1,updated_at=clock_timestamp() where id=p_lesson and status='published';
    update public.academy_lessons set status='published',approval_ref=p_approval_ref,approved_by=p_staff,published_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      where id=p_lesson and content_version=p_version returning * into v;
  else
    update public.academy_lessons set status='archived',revision=revision+1,updated_at=clock_timestamp()
      where id=p_lesson and content_version=p_version returning * into v;
  end if;
  return to_jsonb(v);
end;
$$;
revoke all on function public.author_academy_lesson(uuid,uuid,uuid,integer,integer,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.author_academy_lesson(uuid,uuid,uuid,integer,integer,jsonb,text,text) to service_role;
notify pgrst,'reload schema';

-- SOURCE: derived-sql/20261023093445-academy_learning_conflicts.sql; sha256=83ffc5f26bcd8f154adc9a2df883457d78d2013e618cc9c8923e27e531a5a801
alter function public.can_read_academy_track(uuid) security definer;
create or replace function public.complete_academy_lesson(p_track uuid,p_lesson uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_creator uuid:=auth.uid(); v_row public.creator_lesson_progress%rowtype;
begin
  -- Consistent lock order with author commands; a publish cannot swap versions mid-completion.
  perform 1 from public.academy_content where id=p_track for share;
  if v_creator is null or not private.can_read_academy_track(p_track) then
    raise exception using errcode='42501',message='academy_locked';
  end if;
  perform 1 from public.academy_lessons where id=p_lesson and track_id=p_track and content_version=p_version and status='published' for share;
  if not found then raise exception using errcode='PT409',message='version_changed'; end if;
  insert into public.creator_lesson_progress(creator_id,lesson_id,content_version)
  values(v_creator,p_lesson,p_version) on conflict (creator_id,lesson_id,content_version) do nothing;
  select * into strict v_row from public.creator_lesson_progress
    where creator_id=v_creator and lesson_id=p_lesson and content_version=p_version;
  return jsonb_build_object('lessonId',v_row.lesson_id,'contentVersion',v_row.content_version,'status',v_row.status,'completedAt',v_row.completed_at);
end;
$$;
create or replace function public.author_academy_lesson(p_staff uuid,p_track uuid,p_lesson uuid,p_version integer,p_revision integer,p_input jsonb,p_action text,p_approval_ref text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.academy_lessons%rowtype; v_values jsonb; v_next integer;
begin
  if p_staff is null or not exists(select 1 from public.staff_users where user_id=p_staff and active) then
    raise exception using errcode='42501',message='staff_required';
  end if;
  perform 1 from public.academy_content where id=p_track and kind='track' for update;
  if not found then raise exception using errcode='P0002',message='track_not_found'; end if;
  if p_action is null or p_action not in ('save','publish','archive') or p_input is null or jsonb_typeof(p_input)<>'object' then
    raise exception using errcode='22023',message='invalid_lesson_command';
  end if;
  if p_lesson is null then
    if p_action<>'save' then raise exception using errcode='22023',message='invalid_lesson_command'; end if;
    insert into public.academy_lessons(track_id,title_zh,title_en,body_zh,body_en,position)
      values(p_track,coalesce(p_input->>'title_zh',''),coalesce(p_input->>'title_en',''),coalesce(p_input->>'body_zh',''),coalesce(p_input->>'body_en',''),coalesce((p_input->>'position')::integer,0)) returning * into v;
    return to_jsonb(v);
  end if;
  select * into v from public.academy_lessons where id=p_lesson and track_id=p_track and content_version=p_version for update;
  if not found then raise exception using errcode='P0002',message='lesson_not_found'; end if;
  -- Exact publish replay is a no-op; it never reapproves or rewrites the snapshot.
  if p_action='publish' and v.status='published' and v.approval_ref=p_approval_ref and p_revision=v.revision-1 then return to_jsonb(v); end if;
  if p_revision is null or v.revision<>p_revision or v.status='archived' then
    raise exception using errcode='PT409',message='lesson_revision_conflict';
  end if;
  if p_action='save' then
    v_values:=to_jsonb(v)||p_input;
    if v.status='published' then
      if exists(select 1 from public.academy_lessons where id=p_lesson and status='draft') then
        raise exception using errcode='PT409',message='lesson_draft_exists';
      end if;
      select max(content_version)+1 into v_next from public.academy_lessons where id=p_lesson;
      insert into public.academy_lessons(id,content_version,track_id,title_zh,title_en,body_zh,body_en,position)
        values(p_lesson,v_next,p_track,v_values->>'title_zh',v_values->>'title_en',v_values->>'body_zh',v_values->>'body_en',(v_values->>'position')::integer) returning * into v;
    else
      update public.academy_lessons set title_zh=v_values->>'title_zh',title_en=v_values->>'title_en',body_zh=v_values->>'body_zh',body_en=v_values->>'body_en',position=(v_values->>'position')::integer,revision=revision+1,updated_at=clock_timestamp()
        where id=p_lesson and content_version=p_version returning * into v;
    end if;
  elsif p_action='publish' then
    if v.status<>'draft' or nullif(btrim(v.title_zh),'') is null or nullif(btrim(v.body_zh),'') is null or nullif(btrim(p_approval_ref),'') is null or length(p_approval_ref)>500 then
      raise exception using errcode='22023',message='approved_content_required';
    end if;
    update public.academy_lessons set status='archived',revision=revision+1,updated_at=clock_timestamp() where id=p_lesson and status='published';
    update public.academy_lessons set status='published',approval_ref=p_approval_ref,approved_by=p_staff,published_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      where id=p_lesson and content_version=p_version returning * into v;
  else
    update public.academy_lessons set status='archived',revision=revision+1,updated_at=clock_timestamp()
      where id=p_lesson and content_version=p_version returning * into v;
  end if;
  return to_jsonb(v);
end;
$$;
notify pgrst,'reload schema';

-- SOURCE: derived-sql/20261023095521-academy_approval_index.sql; sha256=38091681fe27a0f9f088809d533cf87c9fa1fe42398119d289e0c5df33da0bc1
create index academy_lessons_approved_by on public.academy_lessons(approved_by);

-- SOURCE: derived-sql/20261023124149-staff_access_capabilities.sql; sha256=3eead63c8a25c6ff658c6dad827b45c36066871142b62c23b67494f6cf4cf1c7
-- Additive only. No existing staff or brand membership is promoted or rewritten.
create table public.staff_workspace_roles (
  user_id uuid not null references auth.users(id),
  workspace_id uuid not null references public.workspaces(id),
  role text not null check (role in ('workspace_admin','operator','reviewer','finance_viewer')),
  active boolean not null default true,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default clock_timestamp(),
  revision integer not null default 1 check (revision > 0),
  primary key (user_id,workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.staff_workspace_roles FROM PUBLIC, anon, authenticated, service_role;

create index staff_workspace_roles_workspace on public.staff_workspace_roles(workspace_id,active,user_id);
create index staff_workspace_roles_granted_by on public.staff_workspace_roles(granted_by);
create table public.staff_platform_roles (
  user_id uuid not null references auth.users(id),
  role text not null check (role='content_editor'),
  active boolean not null default true,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default clock_timestamp(),
  revision integer not null default 1 check (revision > 0),
  primary key (user_id,role)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.staff_platform_roles FROM PUBLIC, anon, authenticated, service_role;

create index staff_platform_roles_granted_by on public.staff_platform_roles(granted_by);
create table public.staff_access_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  workspace_id uuid references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  actor_id uuid not null references auth.users(id),
  actor_kind text not null check (actor_kind in ('workspace_admin','db_owner_bootstrap')),
  db_session_user text not null,
  before_state jsonb,
  after_state jsonb not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  approval_ref text,
  created_at timestamptz not null default clock_timestamp()
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.staff_access_audit FROM PUBLIC, anon, authenticated, service_role;

create index staff_access_audit_workspace on public.staff_access_audit(workspace_id,created_at);
create index staff_access_audit_user on public.staff_access_audit(user_id,created_at);
create index staff_access_audit_actor on public.staff_access_audit(actor_id,created_at);
create table public.staff_access_commands (
  request_id uuid primary key references public.staff_access_audit(request_id),
  payload jsonb not null,
  result jsonb not null
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.staff_access_commands FROM PUBLIC, anon, authenticated, service_role;

alter table public.staff_workspace_roles enable row level security;
alter table public.staff_platform_roles enable row level security;
alter table public.staff_access_audit enable row level security;
alter table public.staff_access_commands enable row level security;
revoke all on public.staff_workspace_roles,public.staff_platform_roles,public.staff_access_audit,public.staff_access_commands from public,anon,authenticated,service_role;
grant select on public.staff_workspace_roles,public.staff_platform_roles,public.staff_access_audit,public.staff_access_commands to service_role;
-- One write engine: authorization, optimistic revision, receipt and audit share a transaction.
-- Only owner-executed wrappers can call it; application callers cannot select bootstrap mode.
create function private.apply_staff_access(
  p_actor uuid,p_workspace uuid,p_subject uuid,p_role text,p_active boolean,
  p_expected_revision integer,p_request uuid,p_reason text,p_approval_ref text,p_owner_bootstrap boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before jsonb; v_after jsonb; v_result jsonb; v_payload jsonb; v_saved public.staff_access_commands%rowtype; v_revision integer;
begin
  if p_actor is null or p_subject is null or p_request is null or p_active is null or p_owner_bootstrap is null
    or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_reason),'') is null or length(p_reason)>500 then
    raise exception using errcode='22023',message='STAFF_ACCESS_INVALID';
  end if;
  if (p_workspace is null and p_role is distinct from 'content_editor')
    or (p_workspace is not null and (p_role is null or p_role not in ('workspace_admin','operator','reviewer','finance_viewer'))) then
    raise exception using errcode='22023',message='STAFF_ACCESS_INVALID';
  end if;
  -- Serialize role changes within a workspace before locking actor and target grants.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(p_workspace::text,'platform')||':staff-access',0));
  perform 1 from public.staff_users where user_id=p_actor and active for share;
  if not found then raise exception using errcode='42501',message='STAFF_ACCESS_FORBIDDEN'; end if;
  if p_owner_bootstrap then
    if nullif(btrim(p_approval_ref),'') is null or length(p_approval_ref)>500 then
      raise exception using errcode='22023',message='STAFF_OWNER_APPROVAL_REQUIRED';
    end if;
  else
    if p_workspace is null or p_actor=p_subject then
      raise exception using errcode='42501',message='STAFF_SELF_CHANGE_FORBIDDEN';
    end if;
    perform 1 from public.brand_users b join public.staff_workspace_roles r on r.user_id=b.user_id and r.workspace_id=b.workspace_id
      where b.user_id=p_actor and b.workspace_id=p_workspace and b.active and r.active and r.role='workspace_admin' for share of b,r;
    if not found then raise exception using errcode='42501',message='STAFF_ACCESS_FORBIDDEN'; end if;
  end if;
  if p_active then
    perform 1 from public.staff_users where user_id=p_subject and active for share;
    if not found then raise exception using errcode='42501',message='STAFF_TARGET_NOT_ELIGIBLE'; end if;
    if p_workspace is not null then
      perform 1 from public.brand_users where user_id=p_subject and workspace_id=p_workspace and active for share;
      if not found then raise exception using errcode='42501',message='STAFF_TARGET_NOT_ELIGIBLE'; end if;
    end if;
  elsif not ((p_workspace is not null and exists(select 1 from public.staff_workspace_roles where user_id=p_subject and workspace_id=p_workspace))
    or (p_workspace is null and exists(select 1 from public.staff_platform_roles where user_id=p_subject and role=p_role))) then
    -- Revoking a known scoped grant remains possible after staff/membership removal.
    raise exception using errcode='42501',message='STAFF_TARGET_NOT_ELIGIBLE';
  end if;
  -- Authorization is checked even for exact replay, so revocation takes effect immediately.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request::text,1));
  v_payload:=jsonb_build_object('actor',p_actor,'workspace',p_workspace,'subject',p_subject,'role',p_role,'active',p_active,
    'expectedRevision',p_expected_revision,'reason',p_reason,'approvalRef',p_approval_ref,'ownerBootstrap',p_owner_bootstrap);
  select * into v_saved from public.staff_access_commands where request_id=p_request;
  if found then
    if v_saved.payload<>v_payload then raise exception using errcode='PT409',message='STAFF_ACCESS_IDEMPOTENCY_CONFLICT'; end if;
    return v_saved.result;
  end if;
  if p_workspace is null then
    select to_jsonb(r) into v_before from public.staff_platform_roles r where user_id=p_subject and role=p_role for update;
  else
    select to_jsonb(r) into v_before from public.staff_workspace_roles r where user_id=p_subject and workspace_id=p_workspace for update;
  end if;
  v_revision:=coalesce((v_before->>'revision')::integer,0);
  if v_revision<>p_expected_revision then raise exception using errcode='PT409',message='STAFF_ACCESS_STALE'; end if;
  if p_workspace is null then
    insert into public.staff_platform_roles as r(user_id,role,active,granted_by,revision)
      values(p_subject,p_role,p_active,p_actor,v_revision+1)
      on conflict(user_id,role) do update set active=excluded.active,granted_by=excluded.granted_by,granted_at=clock_timestamp(),revision=excluded.revision
      returning to_jsonb(r) into v_after;
  else
    insert into public.staff_workspace_roles as r(user_id,workspace_id,role,active,granted_by,revision)
      values(p_subject,p_workspace,p_role,p_active,p_actor,v_revision+1)
      on conflict(user_id,workspace_id) do update set role=excluded.role,active=excluded.active,granted_by=excluded.granted_by,granted_at=clock_timestamp(),revision=excluded.revision
      returning to_jsonb(r) into v_after;
  end if;
  v_result:=jsonb_build_object('userId',p_subject,'workspaceId',p_workspace,'role',p_role,'active',p_active,
    'revision',v_revision+1,'grantedBy',p_actor,'grantedAt',v_after->'granted_at');
  insert into public.staff_access_audit(request_id,workspace_id,user_id,actor_id,actor_kind,db_session_user,before_state,after_state,reason,approval_ref)
    values(p_request,p_workspace,p_subject,p_actor,case when p_owner_bootstrap then 'db_owner_bootstrap' else 'workspace_admin' end,
      session_user,v_before,v_after,p_reason,p_approval_ref);
  insert into public.staff_access_commands(request_id,payload,result) values(p_request,v_payload,v_result);
  return v_result;
end;
$$;
revoke all on function private.apply_staff_access(uuid,uuid,uuid,text,boolean,integer,uuid,text,text,boolean) from public,anon,authenticated,service_role;
create function public.set_staff_workspace_role(p_workspace uuid,p_actor uuid,p_subject uuid,p_role text,p_active boolean,p_expected_revision integer,p_request uuid,p_reason text)
returns jsonb language sql security definer set search_path='' as $$
  select private.apply_staff_access(p_actor,p_workspace,p_subject,p_role,p_active,p_expected_revision,p_request,p_reason,null,false);
$$;
revoke all on function public.set_staff_workspace_role(uuid,uuid,uuid,text,boolean,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_staff_workspace_role(uuid,uuid,uuid,text,boolean,integer,uuid,text) to service_role;
-- Explicit protected DB-owner step, never exposed by an API or granted to service_role.
-- The reference is an owner's attestation; it is not independently verified approval.
create function private.bootstrap_staff_access(p_actor uuid,p_workspace uuid,p_subject uuid,p_role text,p_active boolean,p_expected_revision integer,p_request uuid,p_reason text,p_approval_ref text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.apply_staff_access(p_actor,p_workspace,p_subject,p_role,p_active,p_expected_revision,p_request,p_reason,p_approval_ref,true);
$$;
revoke all on function private.bootstrap_staff_access(uuid,uuid,uuid,text,boolean,integer,uuid,text,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';

-- SOURCE: derived-sql/20261023192141-pilot_legacy_access_hardening.sql; sha256=bcd4ff0d6fae48800dd25f1699626eccbb03162ad85fd465df7676ce97d61963
revoke all on public.creator_social_accounts, public.creator_social_scan_snapshots,
  public.creator_public_passports, public.creator_review_statuses, public.creator_review_notes,
  public.mission_shortlists, public.operator_audit_events from public, anon, authenticated;
grant select, delete on public.creator_social_accounts, public.creator_public_passports to authenticated;
grant select on public.creator_social_scan_snapshots to authenticated;
grant insert (creator_id, workspace_id, platform, handle, profile_url)
  on public.creator_social_accounts to authenticated;
grant update (handle, profile_url) on public.creator_social_accounts to authenticated;

-- SOURCE: derived-sql/20261025120934-application_decisions.sql; sha256=5467db0677ff215b90937d4d8951b0cd06f93ecc4a3f5fad59d68738b2fa24ad
-- The existing application, workflow, CRM receipt and audit engines share this
-- transaction. Historical decisions are not backfilled with invented actors.
create function public.decide_mission_application(
  p_workspace uuid, p_operator uuid, p_submission uuid, p_request uuid,
  p_expected_revision bigint, p_decision text, p_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.mission_submissions%rowtype;
  v_saved public.operator_crm_command_receipts%rowtype;
  v_actor text; v_hash text; v_mode text; v_notes text;
  v_workflow jsonb; v_result jsonb; v_decision jsonb;
  v_at timestamptz;
begin
  if p_request is null or p_expected_revision is null or p_expected_revision < 0
    or p_decision is null or p_decision not in ('accept','decline') then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  v_notes := nullif(btrim(p_notes),'');
  if p_decision='decline' and v_notes is null then
    raise exception using errcode='22023',message='application_reason_required';
  end if;
  if length(coalesce(p_notes,''))>500 then
    raise exception using errcode='22023',message='application_reason_too_long';
  end if;
  select s.email into v_actor from public.staff_users s
    join public.brand_users b on b.user_id=s.user_id
    join public.staff_workspace_roles r on r.user_id=s.user_id and r.workspace_id=b.workspace_id
    where s.user_id=p_operator and s.active and b.workspace_id=p_workspace and b.active
      and r.active and r.role in ('workspace_admin','operator') for share of s,b,r;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;

  -- Serialize request-key reuse across application resources before the row lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace::text||':'||p_operator::text||':'||p_request::text,21));
  select s.* into v_sub from public.mission_submissions s
    join public.missions m on m.id=s.mission_id and m.workspace_id=s.workspace_id
    join public.creators c on c.id=s.creator_id and c.workspace_id=s.workspace_id
    where s.id=p_submission and s.workspace_id=p_workspace for update of s;
  if not found then raise exception using errcode='P0002',message='application_not_found'; end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('kind','application_decision',
    'submission',p_submission,'revision',p_expected_revision,'decision',p_decision,
    'notes',case when p_decision='decline' then v_notes else null end)::text,'UTF8')),'hex');
  select * into v_saved from public.operator_crm_command_receipts
    where workspace_id=p_workspace and operator_id=p_operator and request_id=p_request;
  if found then
    if v_saved.payload_hash<>v_hash then
      raise exception using errcode='PT409',message='IDEMPOTENCY_CONFLICT';
    end if;
    return v_saved.result;
  end if;
  if v_sub.status<>'applied' then
    select metadata->'decision' into v_decision from public.operator_audit_events
      where workspace_id=p_workspace and target_type='application' and target_id=p_submission::text
        and event_type='application.decided' order by created_at desc,id desc limit 1;
    if v_decision is null then
      v_decision:=jsonb_build_object('action',null,'status',v_sub.status,
        'actorId',null,'actorLabel',null,'decidedAt',null,'revision',null,'historicalUnknown',true);
    end if;
    return jsonb_build_object('conflict',true,'decision',v_decision);
  end if;
  if p_expected_revision<>0 then raise exception using errcode='PT409',message='APPLICATION_STALE'; end if;
  select creator_workflow_mode into v_mode from public.missions where id=v_sub.mission_id;
  if p_decision='accept' then
    v_sub:=public.accept_application(p_submission);
    if v_mode='active_workspace' then
      select to_jsonb(public.create_mission_workflow(p_submission)) into v_workflow;
    end if;
  else
    v_sub:=public.decline_application(p_submission,v_notes);
  end if;
  v_at:=clock_timestamp();
  update public.mission_submissions set reviewed_at=v_at where id=p_submission returning * into v_sub;
  v_decision:=jsonb_build_object('action',p_decision,'actorId',p_operator,
    'actorLabel',v_actor,'decidedAt',v_at,'revision',1,
    'reason',case when p_decision='decline' then v_notes else null end);
  v_result:=case when v_workflow is null then to_jsonb(v_sub)
    else jsonb_build_object('submission',to_jsonb(v_sub),'workflow',v_workflow) end
    ||jsonb_build_object('decision',v_decision);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'application.decided','application',p_submission::text,v_sub.creator_id,
      jsonb_build_object('request_id',p_request,'decision',v_decision));
  insert into public.operator_crm_command_receipts(workspace_id,operator_id,request_id,payload_hash,result)
    values(p_workspace,p_operator,p_request,v_hash,v_result);
  return v_result;
end;
$$;
revoke all on function public.decide_mission_application(uuid,uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.decide_mission_application(uuid,uuid,uuid,uuid,bigint,text,text) to service_role;

-- SOURCE: derived-sql/20261025194402-redemption_intents.sql; sha256=e9e79337c76fee864713326895a5ce84e02d046616ca7c1a6025b675f4707294
alter table public.redemptions add column client_request_id uuid;
create unique index redemptions_creator_request_uniq
  on public.redemptions (creator_id, client_request_id)
  where client_request_id is not null;
-- A unique RPC name preserves the old one-argument API without API overloads.
create function public.redeem_gift_with_request(p_gift uuid, p_request_id uuid)
returns public.redemptions
language plpgsql security definer set search_path = ''
as $$
declare
  v_creator uuid := auth.uid();
  v_ws uuid;
  v_red public.redemptions;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null then raise exception 'bad_request'; end if;
  select workspace_id into v_ws from public.creators where id = v_creator;
  if v_ws is null then raise exception 'not_found'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('redemption:' || v_creator::text || ':' || p_request_id::text, 0)
  );
  select * into v_red from public.redemptions
    where creator_id = v_creator and client_request_id = p_request_id;
  if v_red.id is not null then
    if v_red.gift_id is distinct from p_gift or v_red.workspace_id is distinct from v_ws then
      raise exception 'request_conflict';
    end if;
    -- A saved result is recoverable even if the first action exhausted stock.
    return v_red;
  end if;

  v_red := public.redeem_gift(p_gift);
  update public.redemptions as r set client_request_id = p_request_id
    where r.id = v_red.id and r.creator_id = v_creator
    returning r.* into v_red;
  if v_red.id is null then raise exception 'redemption_receipt_failed'; end if;
  return v_red;
end;
$$;
revoke all on function public.redeem_gift_with_request(uuid, uuid) from public, anon;
grant execute on function public.redeem_gift_with_request(uuid, uuid) to authenticated, service_role;

-- SOURCE: derived-sql/20261028140231-legacy_submission_xp_once.sql; sha256=a7663b51b21f498c7d0107ebd5016ddb6772822b8b8ca0e067e395c40c24427d
create or replace function public.submit_mission(p_mission uuid, p_urls text[], p_data jsonb)
returns public.mission_submissions
language plpgsql security definer set search_path = ''
as $$
declare
  v_creator uuid := auth.uid();
  v_mode text;
  v_sub public.mission_submissions;
  v_submission_xp integer;
begin
  if v_creator is null then raise exception 'not_authenticated'; end if;
  if p_urls is null or array_length(p_urls, 1) is null then raise exception 'empty_urls'; end if;

  select creator_workflow_mode into v_mode from public.missions where id = p_mission;
  if v_mode = 'active_workspace' then raise exception 'workflow_mode_mismatch'; end if;

  select * into v_sub from public.mission_submissions
    where mission_id = p_mission and creator_id = v_creator for update;
  if v_sub.id is null then raise exception 'wrong_state'; end if;
  if v_sub.status <> 'joined' then raise exception 'wrong_state'; end if;

  v_submission_xp := case when exists (
    select 1 from public.legacy_evidence_corrections
    where submission_id = v_sub.id and workspace_id = v_sub.workspace_id
  ) then 0 else 25 end;

  update public.mission_submissions set
    status = 'submitted',
    content_urls = p_urls,
    submission_data = coalesce(p_data, '{}'::jsonb),
    submitted_at = now(),
    review_deadline = now() + interval '48 hours',
    xp_awarded = xp_awarded + v_submission_xp
    where id = v_sub.id
    returning * into v_sub;
  if v_submission_xp > 0 then
    update public.creators set xp = xp + v_submission_xp where id = v_creator;
  end if;
  return v_sub;
end;
$$;
revoke all on function public.submit_mission(uuid, text[], jsonb) from public, anon;
grant execute on function public.submit_mission(uuid, text[], jsonb) to authenticated, service_role;

-- SOURCE: derived-sql/20261028140709-legacy_evidence_url_authority.sql; sha256=880471864b5a2fec346ec16c45a8af721ae67c0a6e01bdc65981b517ac4163cb
create or replace function private.valid_legacy_evidence(p_urls text[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_url text;
  v_parts text[];
  v_host text;
  v_bytes bytea;
  v_index integer;
  v_octet text;
  v_ipv4_parts text[];
  v_part text;
  v_part_index integer;
  v_radix integer;
  v_number bigint;
  v_digit integer;
begin
  if p_urls is null or cardinality(p_urls) = 0 then return false; end if;
  foreach v_url in array p_urls loop
    if v_url is null then return false; end if;
    v_parts := regexp_match(btrim(v_url),
      '^https?://(\[[0-9a-f:.]+\]|[^/@:?#[:space:]\\]+)(:([0-9]{1,5}))?([/?#][^[:space:]\\]*)?$', 'i');
    if v_parts is null or (v_parts[3] is not null and v_parts[3]::integer > 65535) then return false; end if;
    v_host := v_parts[1];
    if left(v_host, 1) = '[' then
      -- A bracketed authority must contain a real IPv6 address, not merely hex/colon text.
      if right(v_host, 1) <> ']' or family(substring(v_host from 2 for length(v_host) - 2)::inet) <> 6 then return false; end if;
    else
      -- WHATWG HTTP hosts decode percent escapes before checking forbidden host
      -- characters. Retain valid escaped DNS/UTF-8 hosts rather than banning '%'.
      if position('%' in v_host) > 0 then
        v_bytes := ''::bytea;
        v_index := 1;
        while v_index <= length(v_host) loop
          if substring(v_host from v_index for 1) = '%' then
            v_octet := substring(v_host from v_index + 1 for 2);
            if v_octet !~ '^[0-9a-fA-F]{2}$' then return false; end if;
            v_bytes := v_bytes || decode(v_octet, 'hex');
            v_index := v_index + 3;
          else
            v_bytes := v_bytes || convert_to(substring(v_host from v_index for 1), 'UTF8');
            v_index := v_index + 1;
          end if;
        end loop;
        v_host := convert_from(v_bytes, 'UTF8');
      end if;
      -- Width variants and Unicode DNS separators participate in numeric-host
      -- validation too. This normalization checks syntax; it never rewrites evidence.
      v_host := translate(normalize(v_host, NFKC), '。．｡', '...');
      if v_host ~ '[[:cntrl:][:space:]#%/:<>?@^|]'
        or position('[' in v_host) > 0 or position(']' in v_host) > 0
        or position(chr(92) in v_host) > 0 then return false; end if;
      v_ipv4_parts := string_to_array(v_host, '.');
      if cardinality(v_ipv4_parts) > 1 and v_ipv4_parts[cardinality(v_ipv4_parts)] = '' then
        v_ipv4_parts := v_ipv4_parts[1:cardinality(v_ipv4_parts) - 1];
      end if;
      -- A host ending in an IPv4 number uses IPv4 limits, not arbitrary DNS
      -- labels. Preserve the URL parser's valid short, octal and hexadecimal forms.
      if v_ipv4_parts[cardinality(v_ipv4_parts)] ~* '^([0-9]+|0x[0-9a-f]*)$' then
        if cardinality(v_ipv4_parts) > 4 then return false; end if;
        for v_part_index in 1..cardinality(v_ipv4_parts) loop
          v_part := lower(v_ipv4_parts[v_part_index]);
          if v_part = '' then return false; end if;
          v_radix := 10;
          if left(v_part, 2) = '0x' then v_radix := 16; v_part := substring(v_part from 3);
          elsif length(v_part) > 1 and left(v_part, 1) = '0' then v_radix := 8; v_part := substring(v_part from 2);
          end if;
          v_number := 0;
          for v_index in 1..length(v_part) loop
            v_digit := position(substring(v_part from v_index for 1) in '0123456789abcdef') - 1;
            if v_digit < 0 or v_digit >= v_radix then return false; end if;
            v_number := v_number * v_radix + v_digit;
            if v_number > 4294967295 then return false; end if;
          end loop;
          if (v_part_index < cardinality(v_ipv4_parts) and v_number > 255)
            or (v_part_index = cardinality(v_ipv4_parts) and v_number >= power(256::bigint, 5 - cardinality(v_ipv4_parts))) then return false; end if;
        end loop;
      end if;
    end if;
  end loop;
  return true;
exception when invalid_text_representation or character_not_in_repertoire or invalid_parameter_value then
  return false;
end;
$$;
revoke all on function private.valid_legacy_evidence(text[]) from public, anon, authenticated;
grant execute on function private.valid_legacy_evidence(text[]) to service_role;
-- The trusted API must observe the exact same scoped evidence revision and SQL
-- validity together; either parser's rejection makes historical work repairable.
create function public.get_legacy_correction_evidence(p_workspace uuid, p_submission uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('content_urls', s.content_urls, 'evidence_revision', s.evidence_revision,
    'sql_valid', private.valid_legacy_evidence(s.content_urls))
  from public.mission_submissions s where s.workspace_id = p_workspace and s.id = p_submission;
$$;
revoke all on function public.get_legacy_correction_evidence(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_legacy_correction_evidence(uuid,uuid) to service_role;
-- The API's URL parser handles IDNA and other browser-specific validity rules.
-- Only that staff-authorized service path may initiate fresh corrections. Do not
-- strand parser-invalid evidence merely because the bounded SQL guard accepts it.
create or replace function public.request_legacy_evidence_correction(p_workspace uuid, p_operator uuid, p_submission uuid,
  p_request uuid, p_expected_revision bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_submission public.mission_submissions%rowtype; v_receipt public.legacy_evidence_corrections%rowtype;
  v_hash text; v_result jsonb; v_actor text;
begin
  select email into v_actor from public.staff_users where user_id=p_operator and active;
  if not found or not exists(select 1 from public.brand_users where user_id=p_operator and workspace_id=p_workspace and active) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if p_request is null or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_note),'') is null then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  select * into v_submission from public.mission_submissions where id=p_submission and workspace_id=p_workspace for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('submission',p_submission,'revision',p_expected_revision,'note',btrim(p_note))::text,'UTF8')),'hex');
  select * into v_receipt from public.legacy_evidence_corrections where workspace_id=p_workspace and operator_id=p_operator and request_id=p_request;
  if found then
    if v_receipt.payload_hash<>v_hash then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return v_receipt.result;
  end if;
  if v_submission.evidence_revision<>p_expected_revision then raise exception using errcode='P0001',message='EVIDENCE_STALE'; end if;
  if v_submission.status not in ('submitted','under_review','rejected')
    or not exists(select 1 from public.missions where id=v_submission.mission_id and workspace_id=p_workspace and creator_workflow_mode='legacy') then
    raise exception using errcode='P0001',message='wrong_state';
  end if;
  update public.mission_submissions set status='joined',reviewer_notes=btrim(p_note),reviewed_at=null where id=p_submission;
  v_result:=jsonb_build_object('submission_id',p_submission,'status','joined','revision',v_submission.evidence_revision+1,'receipt_id',p_request);
  insert into public.legacy_evidence_corrections(workspace_id,operator_id,request_id,submission_id,payload_hash,previous_evidence,result)
    values(p_workspace,p_operator,p_request,p_submission,v_hash,jsonb_build_object('status',v_submission.status,'urls',v_submission.content_urls,
      'review_notes',v_submission.reviewer_notes,'reviewed_at',v_submission.reviewed_at,'revision',v_submission.evidence_revision),v_result);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'legacy_evidence.correction_requested','submission',p_submission::text,v_submission.creator_id,
      jsonb_build_object('request_id',p_request,'revision',v_submission.evidence_revision+1));
  return v_result;
end;
$$;
revoke all on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text) to service_role;

-- SOURCE: derived-sql/20261028155000-legacy_evidence_review_validity.sql; sha256=5bbecb5ac4efdd4c617bf922e85f25d29fc3fc79b1d4a5c224c69265e71077d1
create function public.legacy_evidence_sql_valid(public.mission_submissions)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.valid_legacy_evidence(($1).content_urls);
$$;
revoke all on function public.legacy_evidence_sql_valid(public.mission_submissions) from public, anon, authenticated, service_role;
grant execute on function public.legacy_evidence_sql_valid(public.mission_submissions) to service_role;
notify pgrst, 'reload schema';

-- SOURCE: derived-sql/20261029000000-assistant_reservation_claim.sql; sha256=de1eb8b8e61264a4c099b9c03e160b9f1f6cd1f315aa444b94922a189de8441d
create or replace function public.claim_assistant_request(p_workspace uuid,p_creator uuid,p_request uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.creators where id = p_creator and workspace_id = p_workspace) then return false; end if;
  update public.assistant_requests set state='generating', provider_started_at=clock_timestamp(), lease_until=clock_timestamp()+interval '30 seconds'
    where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request and state='reserved';
  return found;
end;
$$;
revoke all on function public.claim_assistant_request(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_assistant_request(uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';

-- SOURCE: derived-sql/20261029100000-brand_write_hardening.sql; sha256=56d276e8832345b7e360d9387596065ea27d5b6e25d9e18e804bc9012b1cbd77
revoke insert, delete on table public.missions from anon, authenticated;
revoke update (status, published_at, closed_at) on table public.missions from anon, authenticated;
revoke insert, update, delete on table public.campaigns from anon, authenticated;
revoke insert, update, delete on table public.campaign_missions from anon, authenticated;
-- NOT VALID: enforced for every new or updated row without failing the deploy on any legacy
-- production row; validate after the data check in the release runbook.
alter table public.missions
  add constraint missions_points_reward_nonneg check (points_reward >= 0) not valid,
  add constraint missions_cash_reward_nonneg check (cash_reward is null or cash_reward >= 0) not valid,
  add constraint missions_cpm_nonneg check ((cpm_rate is null or cpm_rate >= 0) and (cpm_budget_pool is null or cpm_budget_pool >= 0)) not valid,
  add constraint missions_quota_filled_nonneg check (quota >= 0 and filled >= 0) not valid;
alter table public.campaigns
  add constraint campaigns_bonus_nonneg check (completion_bonus_points >= 0 and completion_bonus_xp >= 0) not valid,
  add constraint campaigns_goal_target_positive check (goal_target > 0) not valid;

-- SOURCE: derived-sql/20261029110000-legacy_decision_audit.sql; sha256=d534e224f31853e3b9568ea86dd0350e5ef295e4395874364572ffffa759b930
-- Legacy approve/reject credited points, cash and budget without recording who decided.
-- This command wraps the existing engines in one transaction: it checks the operator's
-- active review role in the workspace, requires a rejection reason, and appends an
-- operator_audit_events row whenever the status actually changes (idempotent replays of an
-- already-decided submission add nothing). Historical decisions are not backfilled.
create function public.decide_legacy_submission(
  p_workspace uuid, p_operator uuid, p_submission uuid, p_decision text, p_notes text,
  p_quality_rating smallint default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor text; v_before text; v_notes text;
  v_sub public.mission_submissions%rowtype;
begin
  if p_decision is null or p_decision not in ('approve','reject') then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  v_notes := nullif(btrim(p_notes),'');
  if p_decision='reject' and v_notes is null then
    raise exception using errcode='22023',message='rejection_reason_required';
  end if;
  if char_length(coalesce(p_notes,''))>500 then
    raise exception using errcode='22023',message='rejection_reason_too_long';
  end if;
  select s.email into v_actor from public.staff_users s
    join public.brand_users b on b.user_id=s.user_id
    join public.staff_workspace_roles r on r.user_id=s.user_id and r.workspace_id=b.workspace_id
    where s.user_id=p_operator and s.active and b.workspace_id=p_workspace and b.active
      and r.active and r.role in ('workspace_admin','operator','reviewer') for share of s,b,r;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;

  select s.status into v_before from public.mission_submissions s
    where s.id=p_submission and s.workspace_id=p_workspace for update;
  if not found then raise exception 'not_found'; end if;

  if p_decision='approve' then
    select * into v_sub from public.approve_submission(p_submission, v_notes, p_quality_rating);
  else
    select * into v_sub from public.reject_submission(p_submission, v_notes);
  end if;

  if v_sub.status is distinct from v_before then
    insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,mission_id,metadata)
      values(p_workspace,p_operator::text,v_actor,
        case p_decision when 'approve' then 'submission.approved' else 'submission.rejected' end,
        'submission',p_submission::text,v_sub.creator_id,v_sub.mission_id,
        jsonb_build_object('quality_rating',p_quality_rating,'reason_provided',v_notes is not null));
  end if;
  return to_jsonb(v_sub);
end;
$$;
revoke all on function public.decide_legacy_submission(uuid,uuid,uuid,text,text,smallint) from public,anon,authenticated;
grant execute on function public.decide_legacy_submission(uuid,uuid,uuid,text,text,smallint) to service_role;

-- SOURCE: derived-sql/20261029120000-application_reward_contract.sql; sha256=852cc21101bbb6f3646c52d0d093a8e7eb1670ee145ef5bc354feef1704676ff
-- Accepting an application into an active-workspace mission created the workflow without a
-- reward contract, so approve_mission_completion later raised reward_contract_required and
-- every accepted applicant needed a manual operator backfill. The decision command is
-- unchanged except that it now freezes the contract in the same transaction (idempotent on
-- the one-contract-per-workflow key). Missions in legacy mode are unaffected.
CREATE OR REPLACE FUNCTION public.decide_mission_application(p_workspace uuid, p_operator uuid, p_submission uuid, p_request uuid, p_expected_revision bigint, p_decision text, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sub public.mission_submissions%rowtype;
  v_saved public.operator_crm_command_receipts%rowtype;
  v_actor text; v_hash text; v_mode text; v_notes text;
  v_workflow jsonb; v_result jsonb; v_decision jsonb;
  v_at timestamptz;
begin
  if p_request is null or p_expected_revision is null or p_expected_revision < 0
    or p_decision is null or p_decision not in ('accept','decline') then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  v_notes := nullif(btrim(p_notes),'');
  if p_decision='decline' and v_notes is null then
    raise exception using errcode='22023',message='application_reason_required';
  end if;
  if length(coalesce(p_notes,''))>500 then
    raise exception using errcode='22023',message='application_reason_too_long';
  end if;
  select s.email into v_actor from public.staff_users s
    join public.brand_users b on b.user_id=s.user_id
    join public.staff_workspace_roles r on r.user_id=s.user_id and r.workspace_id=b.workspace_id
    where s.user_id=p_operator and s.active and b.workspace_id=p_workspace and b.active
      and r.active and r.role in ('workspace_admin','operator') for share of s,b,r;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;

  -- Serialize request-key reuse across application resources before the row lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace::text||':'||p_operator::text||':'||p_request::text,21));
  select s.* into v_sub from public.mission_submissions s
    join public.missions m on m.id=s.mission_id and m.workspace_id=s.workspace_id
    join public.creators c on c.id=s.creator_id and c.workspace_id=s.workspace_id
    where s.id=p_submission and s.workspace_id=p_workspace for update of s;
  if not found then raise exception using errcode='P0002',message='application_not_found'; end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object('kind','application_decision',
    'submission',p_submission,'revision',p_expected_revision,'decision',p_decision,
    'notes',case when p_decision='decline' then v_notes else null end)::text,'UTF8')),'hex');
  select * into v_saved from public.operator_crm_command_receipts
    where workspace_id=p_workspace and operator_id=p_operator and request_id=p_request;
  if found then
    if v_saved.payload_hash<>v_hash then
      raise exception using errcode='PT409',message='IDEMPOTENCY_CONFLICT';
    end if;
    return v_saved.result;
  end if;
  if v_sub.status<>'applied' then
    select metadata->'decision' into v_decision from public.operator_audit_events
      where workspace_id=p_workspace and target_type='application' and target_id=p_submission::text
        and event_type='application.decided' order by created_at desc,id desc limit 1;
    if v_decision is null then
      v_decision:=jsonb_build_object('action',null,'status',v_sub.status,
        'actorId',null,'actorLabel',null,'decidedAt',null,'revision',null,'historicalUnknown',true);
    end if;
    return jsonb_build_object('conflict',true,'decision',v_decision);
  end if;
  if p_expected_revision<>0 then raise exception using errcode='PT409',message='APPLICATION_STALE'; end if;
  select creator_workflow_mode into v_mode from public.missions where id=v_sub.mission_id;
  if p_decision='accept' then
    v_sub:=public.accept_application(p_submission);
    if v_mode='active_workspace' then
      select to_jsonb(public.create_mission_workflow(p_submission)) into v_workflow;
      -- F-038: freeze the reward promise at acceptance, exactly like join_active_mission does
      -- at join, so completion does not stop at reward_contract_required.
      insert into public.mission_reward_contracts(
        workspace_id, mission_workflow_id, mission_submission_id, mission_id,
        points_amount, cash_amount, currency, xp_amount, source, source_mission_updated_at)
      select (v_workflow->>'workspace_id')::uuid, (v_workflow->>'id')::uuid, p_submission, mission.id,
        mission.points_reward, coalesce(mission.cash_reward, 0), 'HKD', 0, 'join', mission.updated_at
      from public.missions mission
      where mission.id = v_sub.mission_id and mission.workspace_id = p_workspace
      on conflict (mission_workflow_id) do nothing;
    end if;
  else
    v_sub:=public.decline_application(p_submission,v_notes);
  end if;
  v_at:=clock_timestamp();
  update public.mission_submissions set reviewed_at=v_at where id=p_submission returning * into v_sub;
  v_decision:=jsonb_build_object('action',p_decision,'actorId',p_operator,
    'actorLabel',v_actor,'decidedAt',v_at,'revision',1,
    'reason',case when p_decision='decline' then v_notes else null end);
  v_result:=case when v_workflow is null then to_jsonb(v_sub)
    else jsonb_build_object('submission',to_jsonb(v_sub),'workflow',v_workflow) end
    ||jsonb_build_object('decision',v_decision);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'application.decided','application',p_submission::text,v_sub.creator_id,
      jsonb_build_object('request_id',p_request,'decision',v_decision));
  insert into public.operator_crm_command_receipts(workspace_id,operator_id,request_id,payload_hash,result)
    values(p_workspace,p_operator,p_request,v_hash,v_result);
  return v_result;
end;
$function$;
revoke all on function public.decide_mission_application(uuid,uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.decide_mission_application(uuid,uuid,uuid,uuid,bigint,text,text) to service_role;

-- SOURCE: derived-sql/20261029130000-reward_settlement.sql; sha256=739782534f97a21e805e568877e13d335fb53c10b3bfee1c1009b6913dddb2fa
-- F-007: active-workspace rewards stopped at mission_pending_rewards.status = 'pending'
-- ("finance review pending") and were never credited to any ledger. A workspace admin now
-- settles a hand-off: in one transaction the frozen points, cash and XP are credited (and an
-- enforced workspace budget debited, as legacy approval does), the row moves pending ->
-- settled, the creator is notified and the action is audited. Unique mission_reward:
-- ledger references make a double credit impossible even outside this command.

alter table public.mission_pending_rewards
  add column settled_at timestamptz,
  add column settled_by uuid references auth.users(id),
  add column settlement_idempotency_key uuid unique;
alter table public.mission_pending_rewards drop constraint mission_pending_rewards_status_check;
alter table public.mission_pending_rewards
  add constraint mission_pending_rewards_status_check check (status in ('pending','cancelled','settled')),
  add constraint mission_pending_rewards_settlement_check check (
    (status = 'settled') = (settled_at is not null and settled_by is not null and settlement_idempotency_key is not null));
create unique index point_transactions_mission_reward_uniq on public.point_transactions(source_ref)
  where source_ref like 'mission_reward:%';
create unique index earnings_transactions_mission_reward_uniq on public.earnings_transactions(source_ref)
  where source_ref like 'mission_reward:%';
create or replace function private.guard_pending_reward_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'pending'
     and old.cancellation_decision_id is null
     and old.cancelled_at is null
     and new.status = 'cancelled'
     and new.cancellation_decision_id is not null
     and new.cancelled_at is not null
     and (to_jsonb(new) - array['status', 'cancellation_decision_id', 'cancelled_at'])
       is not distinct from
       (to_jsonb(old) - array['status', 'cancellation_decision_id', 'cancelled_at'])
  then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'pending'
     and old.settled_at is null
     and new.status = 'settled'
     and new.settled_at is not null and new.settled_by is not null and new.settlement_idempotency_key is not null
     and (to_jsonb(new) - array['status', 'settled_at', 'settled_by', 'settlement_idempotency_key'])
       is not distinct from
       (to_jsonb(old) - array['status', 'settled_at', 'settled_by', 'settlement_idempotency_key'])
  then
    return new;
  end if;
  raise exception 'immutable_record';
end;
$$;
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started',
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue',
    'mission_publication_correction_requested',
    'mission_publication_verified',
    'mission_reward_pending',
    'mission_reward_pending_cancelled',
    'mission_reward_settled'
  ));
create function public.settle_mission_reward_handoff(
  p_workspace uuid, p_pending_reward uuid, p_operator uuid, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor text; v_row public.mission_pending_rewards%rowtype;
  v_title text; v_slug text; v_bal integer; v_earn numeric;
  v_bgt_bal numeric; v_bgt_enforced boolean; v_ref text;
begin
  if p_idempotency_key is null then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  select s.email into v_actor from public.staff_users s
    join public.brand_users b on b.user_id=s.user_id
    join public.staff_workspace_roles r on r.user_id=s.user_id and r.workspace_id=b.workspace_id
    where s.user_id=p_operator and s.active and b.workspace_id=p_workspace and b.active
      and r.active and r.role = 'workspace_admin' for share of s,b,r;
  if not found then raise exception using errcode='42501',message='FORBIDDEN'; end if;

  select * into v_row from public.mission_pending_rewards
    where id = p_pending_reward and workspace_id = p_workspace for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.status = 'settled' then
    if v_row.settlement_idempotency_key = p_idempotency_key then return to_jsonb(v_row); end if;
    raise exception 'wrong_state';
  end if;
  if v_row.status <> 'pending' then raise exception 'wrong_state'; end if;

  select title, slug into v_title, v_slug from public.missions where id = v_row.mission_id;
  v_ref := 'mission_reward:' || v_row.id;

  if v_row.cash_amount > 0 then
    select balance, enforced into v_bgt_bal, v_bgt_enforced
      from public.workspace_budgets where workspace_id = p_workspace for update;
    if v_bgt_enforced is true then
      if v_bgt_bal < v_row.cash_amount then raise exception 'insufficient_budget'; end if;
      update public.workspace_budgets set balance = balance - v_row.cash_amount, updated_at = now()
        where workspace_id = p_workspace;
      insert into public.workspace_budget_transactions (workspace_id, type, delta, balance_after, source_ref, description)
        values (p_workspace, 'debit', -v_row.cash_amount, v_bgt_bal - v_row.cash_amount, v_ref, v_title);
    end if;
  end if;

  if v_row.points_amount > 0 then
    update public.point_balances set balance = balance + v_row.points_amount, updated_at = now()
      where creator_id = v_row.creator_id and workspace_id = p_workspace returning balance into v_bal;
    if v_bal is null then raise exception 'point_balances_missing'; end if;
    insert into public.point_transactions (creator_id, workspace_id, type, delta, balance_after, source_ref, description)
      values (v_row.creator_id, p_workspace, 'earn', v_row.points_amount, v_bal, v_ref, v_title);
  end if;

  if v_row.cash_amount > 0 then
    update public.earnings_balances set available = available + v_row.cash_amount, updated_at = now()
      where creator_id = v_row.creator_id and workspace_id = p_workspace returning available into v_earn;
    if v_earn is null then raise exception 'earnings_balances_missing'; end if;
    insert into public.earnings_transactions (creator_id, workspace_id, type, amount, balance_after, source_ref, description)
      values (v_row.creator_id, p_workspace, 'earn', v_row.cash_amount, v_earn, v_ref, v_title);
  end if;

  if v_row.xp_amount > 0 then
    update public.creators set xp = xp + v_row.xp_amount where id = v_row.creator_id;
  end if;

  update public.mission_pending_rewards
    set status = 'settled', settled_at = clock_timestamp(), settled_by = p_operator,
        settlement_idempotency_key = p_idempotency_key
    where id = v_row.id returning * into v_row;

  insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
    values (v_row.creator_id, p_workspace, 'mission_reward_settled', 'mission_pending_reward', v_row.id,
      jsonb_build_object('mission_title', v_title, 'mission_slug', v_slug,
        'submission_id', v_row.mission_submission_id, 'points', v_row.points_amount,
        'cash', v_row.cash_amount, 'xp', v_row.xp_amount, 'currency', v_row.currency));

  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,mission_id,metadata)
    values (p_workspace, p_operator::text, v_actor, 'reward.settled', 'mission_pending_reward', v_row.id::text,
      v_row.creator_id, v_row.mission_id,
      jsonb_build_object('points', v_row.points_amount, 'cash', v_row.cash_amount, 'xp', v_row.xp_amount,
        'idempotency_key', p_idempotency_key));
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.settle_mission_reward_handoff(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.settle_mission_reward_handoff(uuid,uuid,uuid,uuid) to service_role;
-- The creator's hand-off read now also returns settled rows (with settledAt); otherwise
-- unchanged from its current definition.
CREATE OR REPLACE FUNCTION public.get_my_mission_reward_handoff(p_submission uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_creator uuid := (select auth.uid());
  v_workspace uuid;
  v_workflow uuid;
  v_mission uuid;
  v_contract uuid;
  v_pending public.mission_pending_rewards;
  v_decision_kind text;
  v_decided_at timestamptz;
  v_read record;
begin
  if v_creator is null then
    raise exception 'not_found';
  end if;

  select workflow.id, submission.workspace_id, submission.mission_id
  into v_workflow, v_workspace, v_mission
  from public.mission_submissions submission
  join public.mission_workflows workflow
    on workflow.mission_submission_id = submission.id
   and workflow.workspace_id = submission.workspace_id
  where submission.id = p_submission
    and submission.creator_id = v_creator;
  if v_workflow is null then
    raise exception 'not_found';
  end if;

  select contract.id into v_contract
  from public.mission_reward_contracts contract
  where contract.workspace_id = v_workspace
    and contract.mission_workflow_id = v_workflow
    and contract.mission_submission_id = p_submission
    and contract.mission_id = v_mission;
  if v_contract is null then
    return null;
  end if;

  select pending as pending_row,
    case
      when pending.status = 'cancelled' then cancellation.decision_kind
      else approval.decision_kind
    end as decision_kind,
    case
      when pending.status = 'cancelled' then cancellation.decided_at
      else approval.decided_at
    end as decided_at
  into v_read
  from public.mission_pending_rewards pending
  join public.mission_completion_decisions approval
    on approval.workspace_id = pending.workspace_id
   and approval.mission_workflow_id = pending.mission_workflow_id
   and approval.reward_contract_id = pending.reward_contract_id
   and approval.id = pending.completion_decision_id
   and approval.decision_kind = 'approved'
   and approval.pending_reward_id is null
  left join public.mission_completion_decisions cancellation
    on cancellation.workspace_id = pending.workspace_id
   and cancellation.mission_workflow_id = pending.mission_workflow_id
   and cancellation.reward_contract_id = pending.reward_contract_id
   and cancellation.id = pending.cancellation_decision_id
   and cancellation.pending_reward_id = pending.id
   and cancellation.supersedes_decision_id = approval.id
   and cancellation.decision_kind = 'cancelled'
  where pending.workspace_id = v_workspace
    and pending.mission_workflow_id = v_workflow
    and pending.mission_submission_id = p_submission
    and pending.creator_id = v_creator
    and pending.mission_id = v_mission
    and pending.reward_contract_id = v_contract
    and (
      (
        pending.status = 'pending'
        and pending.cancellation_decision_id is null
        and cancellation.id is null
      )
      or (
        pending.status = 'cancelled'
        and pending.cancellation_decision_id is not null
        and cancellation.id is not null
      )
      or (
        pending.status = 'settled'
        and pending.cancellation_decision_id is null
        and cancellation.id is null
      )
    )
  order by pending.created_at desc, pending.id desc
  limit 1;
  if not found then
    return null;
  end if;
  v_pending := v_read.pending_row;
  v_decision_kind := v_read.decision_kind;
  v_decided_at := v_read.decided_at;

  return jsonb_build_object(
    'reward', jsonb_build_object(
      'pointsAmount', v_pending.points_amount,
      'cashAmount', v_pending.cash_amount,
      'currency', v_pending.currency,
      'xpAmount', v_pending.xp_amount
    ),
    'status', v_pending.status,
    'processingWindowDays', v_pending.processing_window_days,
    'targetAt', v_pending.target_at,
    'createdAt', v_pending.created_at,
    'cancelledAt', v_pending.cancelled_at,
    'settledAt', v_pending.settled_at,
    'decisionState', jsonb_build_object(
      'kind', v_decision_kind,
      'decidedAt', v_decided_at
    )
  );
end;
$function$;

-- SOURCE: derived-sql/20261029140000-correction_notification.sql; sha256=3a69a6b0b4381ae0cce25f6914196e97906e2d2175b7f47dd3d66dacb5152b56
-- F-012: a legacy correction request returns the submission to 'joined', but the creator was
-- never told (the submission notification trigger only covers approve/reject/decide). Adds the
-- submission_correction_requested type and emits it from the correction command; the command
-- is otherwise unchanged from its current definition.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'submission_approved','submission_rejected','submission_correction_requested','redemption_ready',
    'level_up','application_accepted','application_declined',
    'campaign_goal_reached','campaign_prize_awarded','campaign_started',
    'mission_product_shipped','mission_receipt_required',
    'mission_revision_requested','mission_draft_approved',
    'mission_approved_to_publish','mission_deadline_approaching',
    'mission_deadline_overdue',
    'mission_publication_correction_requested',
    'mission_publication_verified',
    'mission_reward_pending',
    'mission_reward_pending_cancelled',
    'mission_reward_settled'
  ));
CREATE OR REPLACE FUNCTION public.request_legacy_evidence_correction(p_workspace uuid, p_operator uuid, p_submission uuid, p_request uuid, p_expected_revision bigint, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_submission public.mission_submissions%rowtype; v_receipt public.legacy_evidence_corrections%rowtype;
  v_hash text; v_result jsonb; v_actor text;
begin
  select email into v_actor from public.staff_users where user_id=p_operator and active;
  if not found or not exists(select 1 from public.brand_users where user_id=p_operator and workspace_id=p_workspace and active) then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if p_request is null or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_note),'') is null then
    raise exception using errcode='22023',message='invalid_command';
  end if;
  select * into v_submission from public.mission_submissions where id=p_submission and workspace_id=p_workspace for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('submission',p_submission,'revision',p_expected_revision,'note',btrim(p_note))::text,'UTF8')),'hex');
  select * into v_receipt from public.legacy_evidence_corrections where workspace_id=p_workspace and operator_id=p_operator and request_id=p_request;
  if found then
    if v_receipt.payload_hash<>v_hash then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
    return v_receipt.result;
  end if;
  if v_submission.evidence_revision<>p_expected_revision then raise exception using errcode='P0001',message='EVIDENCE_STALE'; end if;
  if v_submission.status not in ('submitted','under_review','rejected')
    or not exists(select 1 from public.missions where id=v_submission.mission_id and workspace_id=p_workspace and creator_workflow_mode='legacy') then
    raise exception using errcode='P0001',message='wrong_state';
  end if;
  update public.mission_submissions set status='joined',reviewer_notes=btrim(p_note),reviewed_at=null where id=p_submission;
  v_result:=jsonb_build_object('submission_id',p_submission,'status','joined','revision',v_submission.evidence_revision+1,'receipt_id',p_request);
  insert into public.legacy_evidence_corrections(workspace_id,operator_id,request_id,submission_id,payload_hash,previous_evidence,result)
    values(p_workspace,p_operator,p_request,p_submission,v_hash,jsonb_build_object('status',v_submission.status,'urls',v_submission.content_urls,
      'review_notes',v_submission.reviewer_notes,'reviewed_at',v_submission.reviewed_at,'revision',v_submission.evidence_revision),v_result);
  insert into public.operator_audit_events(workspace_id,operator_id,actor_label,event_type,target_type,target_id,creator_id,metadata)
    values(p_workspace,p_operator::text,v_actor,'legacy_evidence.correction_requested','submission',p_submission::text,v_submission.creator_id,
      jsonb_build_object('request_id',p_request,'revision',v_submission.evidence_revision+1));
  -- F-012: tell the creator their work came back (best-effort: never blocks the correction).
  begin
    insert into public.notifications(user_id,workspace_id,type,entity_type,entity_id,data)
      select v_submission.creator_id,p_workspace,'submission_correction_requested','mission_submission',p_submission,
        jsonb_build_object('mission_title',m.title,'mission_slug',m.slug,'notes',btrim(p_note))
      from public.missions m where m.id=v_submission.mission_id;
  exception when others then null;
  end;
  return v_result;
end;
$function$;

-- SOURCE: derived-sql/20261029150000-kb_workspace_scope.sql; sha256=5ec7134340419a3c040bbc658e8e9ebe1c5a85eff84901cc44e985803644a207
-- F-047: kb_documents/kb_chunks were readable by every authenticated user (`using (true)`),
-- and match_kb_chunks (SECURITY INVOKER) trusted a caller-supplied filter_workspace, so any
-- creator could read another brand's workspace-scoped knowledge. Reads are now limited to
-- global documents plus the caller's own workspace (stored as its id or slug); chunks follow
-- their document. Server-side ingestion uses the service role and is unaffected.
drop policy if exists kb_documents_read on public.kb_documents;
create policy kb_documents_read on public.kb_documents for select to authenticated
  using (
    workspace is null
    or workspace = (select private.current_workspace_id())::text
    or workspace = (select w.slug from public.workspaces w where w.id = (select private.current_workspace_id()))
  );
drop policy if exists kb_chunks_read on public.kb_chunks;
create policy kb_chunks_read on public.kb_chunks for select to authenticated
  using (exists (select 1 from public.kb_documents d where d.id = kb_chunks.document_id));

-- SOURCE: derived-sql/20261029160000-assistant_history_readonly.sql; sha256=1945d81a9c8ea11ec13c87295f598a076fd7acd6dd308dee65c5bd687d6b9456
-- F-048: creators held INSERT/UPDATE/DELETE on their assistant conversations and messages
-- (grant all + `for all` policies), so a creator could forge role='assistant' replies or
-- delete history that assistant_requests receipts reference. History is written only by the
-- SECURITY DEFINER assistant RPCs (reserve_assistant_request / save_assistant_turn), so
-- browser roles keep read access to their own rows and nothing else.
revoke insert, update, delete, truncate on table public.assistant_conversations from anon, authenticated;
revoke insert, update, delete, truncate on table public.assistant_messages from anon, authenticated;
drop policy if exists conv_self on public.assistant_conversations;
create policy conv_self on public.assistant_conversations for select to authenticated
  using (creator_id = (select auth.uid()));
drop policy if exists msg_self on public.assistant_messages;
create policy msg_self on public.assistant_messages for select to authenticated
  using (exists (select 1 from public.assistant_conversations conv
    where conv.id = assistant_messages.conversation_id and conv.creator_id = (select auth.uid())));

-- SOURCE: derived-sql/20261029170000-creator_consents.sql; sha256=710b739c21d5066ee5ec22b30a72cbd42bf9f8348d002c844739a6d55edd43e8
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
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.creator_consents FROM PUBLIC, anon, authenticated, service_role;

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

-- SOURCE: derived-sql/20261029180000-creator_account_deletion.sql; sha256=4c9690c71d9556d90052bee1b56c1b6c5457ebf9f2d89a2be7e3af5c7ad1cd87
-- F-009: creators could not delete their account, and a hard delete of auth.users is blocked
-- by RESTRICT/NO ACTION references (lesson progress, redemption codes, proof attempts, pending
-- rewards, assistant requests, referrals) and append-only workflow history. Deletion is
-- therefore an anonymisation: personal data is removed or scrubbed, while ledgers, decisions
-- and audit rows stay intact under the now-pseudonymous creator id. The API additionally
-- removes stored avatar files and scrambles/bans the auth identity.
alter table public.creators drop constraint creators_status_chk;
alter table public.creators add constraint creators_status_chk
  check (status in ('active', 'suspended', 'pending_review', 'deleted'));
alter table public.creators add column deleted_at timestamptz;
create function public.anonymize_creator_account(p_creator uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_creator public.creators%rowtype;
begin
  select * into v_creator from public.creators where id = p_creator for update;
  if not found then raise exception 'not_found'; end if;
  if v_creator.status = 'deleted' then
    return jsonb_build_object('creator_id', p_creator, 'deleted_at', v_creator.deleted_at, 'replay', true);
  end if;

  update public.creators set
    display_name = 'Deleted KOC', avatar_url = null, phone = null, referral_code = null,
    social_handles = '[]'::jsonb, categories = '{}', status = 'deleted', deleted_at = clock_timestamp()
  where id = p_creator returning * into v_creator;

  delete from public.creator_social_accounts where creator_id = p_creator;
  delete from public.creator_portfolio_links where creator_id = p_creator;
  delete from public.creator_public_profile_snapshots where creator_id = p_creator;
  delete from public.creator_public_passports where creator_id = p_creator;
  delete from public.notifications where user_id = p_creator;
  delete from public.campaign_participants where creator_id = p_creator;
  delete from public.mission_shortlists where creator_id = p_creator;
  -- Conversations are referenced by request receipts, so their free text is scrubbed instead.
  update public.assistant_messages set content = '[deleted]', tool_calls = '[]'::jsonb
    where conversation_id in (select id from public.assistant_conversations where creator_id = p_creator);
  -- Request receipts keep their ids and states for audit, but not the prompt or the answer.
  update public.assistant_requests set message = '[deleted]',
    result = case when result ? 'answer' then jsonb_set(result, '{answer}', '"[deleted]"') else result end
    where creator_id = p_creator;

  return jsonb_build_object('creator_id', p_creator, 'deleted_at', v_creator.deleted_at, 'replay', false);
end;
$$;
revoke all on function public.anonymize_creator_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_creator_account(uuid) to service_role;

-- SOURCE: derived-sql/20261030195424-creator_studio_private_artifacts.sql; sha256=88246b4e6f8455eef2a2b99645942e6defb89930292556354b1883b71ef00e51
alter table public.missions add column public_preview_enabled boolean not null default false;
-- Additive, opt-in studio. Browser clients may only read their own private rows.
-- All mutations are authenticated by workspaceAuth and executed by this scoped RPC.
create table public.studio_threads (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  creator_id uuid not null references public.creators(id), title text not null check(length(title) between 1 and 160),
  topic text not null check(topic in ('missions','creation','performance','rewards')),
  initial_prompt text check(length(initial_prompt)<=4000),
  mission_id uuid references public.missions(id), conversation_id uuid not null unique references public.assistant_conversations(id),
  revision integer not null default 0, created_at timestamptz not null default now(),
  unique(id,workspace_id,creator_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.studio_threads FROM PUBLIC, anon, authenticated, service_role;

create index studio_threads_owner on public.studio_threads(creator_id,workspace_id,created_at desc);
create table public.studio_sources (
  id uuid primary key default gen_random_uuid(), thread_id uuid not null,
  workspace_id uuid not null, creator_id uuid not null,
  title text not null check(length(title) between 1 and 160), content text not null check(length(content) between 1 and 8000),
  url text, kind text not null check(kind in ('manual','public','private')), shareable boolean not null default false,
  question text not null check(length(question) between 1 and 500), platform text not null check(length(platform) between 1 and 80),
  region text not null check(region='HK'), language text not null check(language='zh-Hant'),
  observed_at timestamptz not null, status text not null default 'unverified' check(status='unverified'),
  revoked_at timestamptz, created_at timestamptz not null default now(),
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.studio_sources FROM PUBLIC, anon, authenticated, service_role;

create index studio_sources_thread on public.studio_sources(thread_id);
create table public.studio_briefs (
  id uuid primary key default gen_random_uuid(), thread_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  version integer not null check(version>0), sections jsonb not null check(jsonb_typeof(sections)='array'),
  created_at timestamptz not null default now(), unique(thread_id,version),
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.studio_briefs FROM PUBLIC, anon, authenticated, service_role;

create table public.studio_shares (
  id uuid primary key default gen_random_uuid(), thread_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  brief_id uuid not null references public.studio_briefs(id) on delete cascade,
  submission_id uuid not null references public.mission_submissions(id), work_item_id uuid not null references public.mission_work_items(id),
  section_ids jsonb not null, source_snapshot jsonb not null, draft_revision integer not null,
  recipient text not null default 'task_review' check(recipient='task_review'), created_at timestamptz not null default now(),
  foreign key(thread_id,workspace_id,creator_id) references public.studio_threads(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.studio_shares FROM PUBLIC, anon, authenticated, service_role;

create index studio_shares_thread on public.studio_shares(thread_id);
create table public.studio_commands (
  workspace_id uuid not null, creator_id uuid not null, request_id uuid not null,
  action text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key(workspace_id,creator_id,request_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.studio_commands FROM PUBLIC, anon, authenticated, service_role;

create table public.studio_badges (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  creator_id uuid not null references public.creators(id), badge_key text not null default 'first_verified_task',
  policy_version integer not null default 1, source_event text not null, created_at timestamptz not null default now(),
  unique(workspace_id,creator_id,badge_key,policy_version)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.studio_badges FROM PUBLIC, anon, authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['studio_threads','studio_sources','studio_briefs','studio_shares','studio_commands','studio_badges'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy studio_owner_read on public.%1$I for select to authenticated using (creator_id=(select auth.uid()) and exists(select 1 from public.creators c where c.id=(select auth.uid()) and c.workspace_id=%1$I.workspace_id and c.status<>''deleted''))',t);
  end loop;
end $$;
create function public.studio_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  t public.studio_threads; s public.studio_sources; b public.studio_briefs; receipt public.studio_commands;
  section jsonb; source_id text; selected jsonb; result jsonb; draft jsonb; sources jsonb:='[]';
  caption text:=''; part text; conv uuid; next_version integer; share_id uuid; expected_revision integer;
begin
  if p_workspace is null or p_creator is null or p_request is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>64000 then raise exception 'INVALID_INPUT'; end if;
  -- Serialize with account anonymisation before reading private data or writing receipts.
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status in ('active','pending_review') for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_creator::text||p_request::text,0));
  select * into receipt from public.studio_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  if found then
    if receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return receipt.result;
  end if;
  if p_action='create_thread' then
    if coalesce(p_payload->>'topic','') not in ('missions','creation','performance','rewards') or coalesce(length(trim(p_payload->>'title')),0) not between 1 and 160 then raise exception 'INVALID_INPUT'; end if;
    if p_payload->>'missionId' is not null and not exists(select 1 from public.missions where id=(p_payload->>'missionId')::uuid and workspace_id=p_workspace) then raise exception 'NOT_FOUND'; end if;
    insert into public.assistant_conversations(creator_id,workspace) values(p_creator,p_workspace::text) returning id into conv;
    insert into public.studio_threads(workspace_id,creator_id,title,topic,mission_id,conversation_id,initial_prompt)
      values(p_workspace,p_creator,trim(p_payload->>'title'),p_payload->>'topic',(p_payload->>'missionId')::uuid,conv,p_payload->>'initialPrompt') returning * into t;
    result:=to_jsonb(t);
  else
    select * into t from public.studio_threads where id=(p_payload->>'threadId')::uuid and creator_id=p_creator and workspace_id=p_workspace for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    expected_revision:=(p_payload->>'revision')::integer;
    if expected_revision is null or t.revision<>expected_revision then raise exception 'WORKFLOW_STALE'; end if;
    if p_action='add_source' then
      if (select count(*) from public.studio_sources where thread_id=t.id)>=100 then raise exception 'SOURCE_LIMIT'; end if;
      if coalesce(p_payload->>'region','')<>'HK' or coalesce(p_payload->>'language','')<>'zh-Hant' then raise exception 'UNSUPPORTED_COVERAGE'; end if;
      if p_payload->>'url' is not null and ((p_payload->>'url') !~ '^https://[^/@[:space:]]+([/?#]|$)' or length(p_payload->>'url')>2000) then raise exception 'INVALID_SOURCE'; end if;
      insert into public.studio_sources(thread_id,workspace_id,creator_id,title,content,url,kind,shareable,question,platform,region,language,observed_at)
        values(t.id,p_workspace,p_creator,trim(p_payload->>'title'),trim(p_payload->>'content'),p_payload->>'url',p_payload->>'kind',coalesce((p_payload->>'shareable')::boolean,false),trim(p_payload->>'question'),trim(p_payload->>'platform'),'HK','zh-Hant',(p_payload->>'observed_at')::timestamptz) returning * into s;
      result:=to_jsonb(s);
    elsif p_action='revoke_source' then
      update public.studio_sources set revoked_at=coalesce(revoked_at,now()),shareable=false where id=(p_payload->>'sourceId')::uuid and thread_id=t.id returning * into s;
      if not found then raise exception 'NOT_FOUND'; end if;
      result:=to_jsonb(s);
    elsif p_action='save_brief' then
      if jsonb_typeof(p_payload->'sections') is distinct from 'array' or jsonb_array_length(p_payload->'sections') not between 1 and 12 then raise exception 'INVALID_INPUT'; end if;
      selected:='[]';
      for section in select value from jsonb_array_elements(p_payload->'sections') loop
        if coalesce(section->>'id','') !~ '^[a-zA-Z0-9_-]{1,60}$' or selected ? (section->>'id') or coalesce(length(trim(section->>'text')),0) not between 1 and 3000
          or jsonb_typeof(section->'sourceIds') is distinct from 'array' or jsonb_array_length(section->'sourceIds')>8 then raise exception 'INVALID_INPUT'; end if;
        selected:=selected||jsonb_build_array(section->>'id');
        -- Edits cannot erase the lineage of a paragraph from an earlier immutable version.
        if exists(select 1 from public.studio_briefs prior, lateral jsonb_array_elements(prior.sections) old_section,
          lateral jsonb_array_elements_text(old_section->'sourceIds') old_source
          where prior.thread_id=t.id and old_section->>'id'=section->>'id' and not (section->'sourceIds') ? old_source)
          then raise exception 'SOURCE_LINEAGE_REQUIRED'; end if;
        for source_id in select jsonb_array_elements_text(section->'sourceIds') loop
          if not exists(select 1 from public.studio_sources where id=source_id::uuid and thread_id=t.id and revoked_at is null) then raise exception 'SOURCE_UNAVAILABLE'; end if;
        end loop;
      end loop;
      select coalesce(max(version),0)+1 into next_version from public.studio_briefs where thread_id=t.id;
      insert into public.studio_briefs(thread_id,workspace_id,creator_id,version,sections)
        values(t.id,p_workspace,p_creator,next_version,p_payload->'sections') returning * into b;
      result:=to_jsonb(b);
    elsif p_action='share_brief' then
      select * into b from public.studio_briefs where id=(p_payload->>'briefId')::uuid and thread_id=t.id;
      if not found then raise exception 'NOT_FOUND'; end if;
      if exists(select 1 from public.studio_briefs where thread_id=t.id and version>b.version) then raise exception 'STALE_BRIEF'; end if;
      selected:=p_payload->'sectionIds';
      if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected) not between 1 and 12
        or (select count(distinct value) from jsonb_array_elements_text(selected))<>jsonb_array_length(selected)
        or exists(select 1 from jsonb_array_elements_text(selected) x where not exists(select 1 from jsonb_array_elements(b.sections) y where y->>'id'=x)) then raise exception 'INVALID_SELECTION'; end if;
      if not exists(select 1 from public.mission_submissions ms join public.mission_workflows w on w.mission_submission_id=ms.id and w.workspace_id=ms.workspace_id
        join public.mission_work_items i on i.mission_workflow_id=w.id and i.workspace_id=w.workspace_id
        where ms.id=(p_payload->>'submissionId')::uuid and i.id=(p_payload->>'workItemId')::uuid and ms.creator_id=p_creator and ms.workspace_id=p_workspace and (t.mission_id is null or t.mission_id=ms.mission_id)) then raise exception 'NOT_FOUND'; end if;
      for section in select value from jsonb_array_elements(b.sections) loop
        if not selected ? (section->>'id') then continue; end if;
        part:=section->>'text';
        for source_id in select jsonb_array_elements_text(section->'sourceIds') loop
          select * into s from public.studio_sources where id=source_id::uuid and thread_id=t.id;
          if not found or s.revoked_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
          if not s.shareable then raise exception 'SOURCE_PRIVATE'; end if;
          -- Share only the cited metadata; never include the complete private document body.
          sources:=sources||jsonb_build_array(jsonb_build_object('id',s.id,'title',s.title,'question',s.question,'platform',s.platform,'observedAt',s.observed_at,'url',s.url,'status',s.status,'region',s.region,'language',s.language));
          part:=part||E'\n來源：'||s.title||' · '||s.platform||' · '||to_char(s.observed_at at time zone 'Asia/Hong_Kong','YYYY-MM-DD HH24:MI')||' HKT · HK / 繁中 · 未驗證'||coalesce(' · '||s.url,'')||E'\n問題：'||s.question;
        end loop;
        caption:=caption||case when caption='' then '' else E'\n\n' end||part;
      end loop;
      if length(caption)>10000 or (p_payload->>'draftRevision')::integer is null then raise exception 'INVALID_INPUT'; end if;
      -- Use the canonical transaction, preserving checklist/assets and its loaded revision check.
      draft:=private.save_active_mission_draft((p_payload->>'submissionId')::uuid,p_creator,p_workspace,(p_payload->>'workItemId')::uuid,(p_payload->>'draftRevision')::integer,jsonb_build_object('caption',caption));
      if draft ? 'code' then raise exception '%',draft->>'code'; end if;
      if draft->'draft'->>'revision' is null then raise exception 'DRAFT_UNAVAILABLE'; end if;
      insert into public.studio_shares(thread_id,workspace_id,creator_id,brief_id,submission_id,work_item_id,section_ids,source_snapshot,draft_revision)
        values(t.id,p_workspace,p_creator,b.id,(p_payload->>'submissionId')::uuid,(p_payload->>'workItemId')::uuid,selected,sources,(draft->'draft'->>'revision')::integer) returning id into share_id;
      select to_jsonb(sh) into result from public.studio_shares sh where sh.id=share_id;
    else raise exception 'INVALID_ACTION';
    end if;
    update public.studio_threads set revision=revision+1 where id=t.id;
  end if;
  insert into public.studio_commands(workspace_id,creator_id,request_id,action,payload,result) values(p_workspace,p_creator,p_request,p_action,p_payload,result);
  return result;
end $$;
revoke all on function public.studio_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_command(uuid,uuid,uuid,text,jsonb) to service_role;
-- Badge-only projections: no ledger, balance, XP, notification or workflow mutation.
create function private.studio_settlement_badge() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='settled' and old.status is distinct from 'settled' then
    insert into public.studio_badges(workspace_id,creator_id,source_event) values(new.workspace_id,new.creator_id,'mission_reward:'||new.id) on conflict do nothing;
  end if; return new;
end $$;
create trigger studio_settlement_badge after update of status on public.mission_pending_rewards for each row execute function private.studio_settlement_badge();
create function private.studio_legacy_badge() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='approved' and old.status is distinct from 'approved'
    and exists(select 1 from public.point_transactions p where p.source_ref='mission_submission:'||new.id and p.creator_id=new.creator_id and p.workspace_id=new.workspace_id and p.type='earn' and p.delta>0) then
    insert into public.studio_badges(workspace_id,creator_id,source_event) values(new.workspace_id,new.creator_id,'mission_submission:'||new.id) on conflict do nothing;
  end if; return new;
end $$;
create trigger studio_legacy_badge after update of status on public.mission_submissions for each row execute function private.studio_legacy_badge();
-- The existing account deletion transaction changes creators.status before scrubbing chat.
-- Clean private studio records in that same transaction; canonical financial audit stays intact.
create function private.studio_account_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='deleted' then
    update public.assistant_messages set citations='[]'::jsonb
      where conversation_id in (select id from public.assistant_conversations where creator_id=new.id);
    update public.assistant_requests set result=case when result ? 'citations' then jsonb_set(result,'{citations}','[]'::jsonb) else result end
      where creator_id=new.id;
    delete from public.studio_threads where creator_id=new.id;
    delete from public.studio_commands where creator_id=new.id;
    delete from public.studio_badges where creator_id=new.id;
  end if; return new;
end $$;
create trigger studio_account_cleanup after update of status on public.creators for each row execute function private.studio_account_cleanup();
revoke all on function private.studio_settlement_badge(),private.studio_legacy_badge(),private.studio_account_cleanup() from public,anon,authenticated;
-- Preserve the existing durable-save signature and replay contract. Take the same creator
-- lock as anonymisation BEFORE the request lock, so a late generation cannot restore PII.
create or replace function public.save_assistant_turn(p_workspace uuid,p_creator uuid,p_request uuid,p_answer text,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_request public.assistant_requests%rowtype; v_conversation uuid; v_result jsonb;
begin
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status<>'deleted' for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_request from public.assistant_requests where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_request.state='saved' then
    if v_request.result->>'answer' is distinct from p_answer or v_request.result->'citations' is distinct from p_citations then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT';
    end if;
    return v_request.result;
  end if;
  if v_request.state<>'generating' then raise exception using errcode='P0001',message='outcome_unknown'; end if;
  if p_answer is null or char_length(p_answer)>40000 or jsonb_typeof(p_citations) is distinct from 'array' then
    raise exception using errcode='22023',message='bad_result';
  end if;
  v_conversation:=v_request.conversation_id;
  if v_conversation is null then
    insert into public.assistant_conversations(creator_id,workspace) values(p_creator,p_workspace::text) returning id into v_conversation;
  elsif not exists(select 1 from public.assistant_conversations where id=v_conversation and creator_id=p_creator and workspace=p_workspace::text) then
    raise exception using errcode='P0002',message='not_found';
  end if;
  insert into public.assistant_messages(conversation_id,role,content,citations,request_id,turn_order) values
    (v_conversation,'user',v_request.message,'[]'::jsonb,p_request,0), (v_conversation,'assistant',p_answer,p_citations,p_request,1);
  update public.assistant_conversations set last_message_at=clock_timestamp() where id=v_conversation;
  v_result:=jsonb_build_object('conversation_id',v_conversation,'request_id',p_request,'answer',p_answer,'citations',p_citations,'persistence','saved');
  update public.assistant_requests set state='saved',conversation_id=v_conversation,result=v_result
    where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request;
  return v_result;
end $$;
revoke all on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) to service_role;
-- Resolve only an identical creator intent whose evidence basis changed. Never start a
-- second generation automatically, cancel a running provider, or replace a saved receipt.
create function public.resolve_studio_request_context(p_workspace uuid,p_creator uuid,p_request uuid,p_message text,p_locale text,p_conversation uuid,p_context_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assistant_requests%rowtype; outcome jsonb;
begin
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status<>'deleted' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists(select 1 from public.studio_threads where creator_id=p_creator and workspace_id=p_workspace and conversation_id=p_conversation)
    or p_context_version is null or p_context_version not like 'studio:%' or length(p_context_version)>80 then raise exception 'NOT_FOUND'; end if;
  select * into r from public.assistant_requests where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request for update;
  if not found or r.message is distinct from p_message or r.locale is distinct from p_locale or r.conversation_id is distinct from p_conversation
    or r.context_version=p_context_version then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if r.result is not null then return r.result; end if;
  if r.state='reserved' then
    outcome:=jsonb_build_object('request_id',p_request,'conversation_id',p_conversation,'code','studio_context_changed','persistence','failed','generation','not_started');
    update public.assistant_requests set state='unknown',result=outcome,lease_until=clock_timestamp() where creator_id=p_creator and workspace_id=p_workspace and request_id=p_request;
    return outcome;
  end if;
  return jsonb_build_object('request_id',p_request,'state',r.state,'persistence','unknown');
end $$;
revoke all on function public.resolve_studio_request_context(uuid,uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_studio_request_context(uuid,uuid,uuid,text,text,uuid,text) to service_role;

-- SOURCE: derived-sql/20261031120000-creator_integrations.sql; sha256=d73deda4da821f938617257c79f1975b9986c6aeda70afa004a6ad4a2b3e9bef
-- Opt-in, service-mediated integration storage. No provider calls or credentials are
-- provisioned by this migration. The service owns feature flags and external ACL checks.
alter table public.creators add constraint integration_creator_workspace_key unique(id,workspace_id);
create table public.integration_connections (
  id uuid primary key, workspace_id uuid not null, creator_id uuid not null,
  provider text not null check(provider in ('instagram','google_drive')),
  generation integer not null check(generation>0),
  status text not null check(status in ('connected','partial','reauth_required','revoked')),
  data jsonb not null check(jsonb_typeof(data)='object'),
  revoked_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,creator_id,provider), unique(id,workspace_id,creator_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_connections FROM PUBLIC, anon, authenticated, service_role;

create table public.integration_resources (
  id uuid primary key, connection_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  generation integer not null check(generation>0), snapshot_id uuid,
  data jsonb not null check(jsonb_typeof(data)='object'),
  unique(id,connection_id,workspace_id,creator_id),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_resources FROM PUBLIC, anon, authenticated, service_role;

create unique index integration_resource_external on public.integration_resources(connection_id,(data->>'externalId'));
create table public.integration_snapshots (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null, resource_id uuid not null,
  workspace_id uuid not null, creator_id uuid not null, generation integer not null check(generation>0),
  data jsonb not null check(jsonb_typeof(data)='object'),
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '30 days',
  unique(id,resource_id,connection_id,workspace_id,creator_id),
  foreign key(resource_id,connection_id,workspace_id,creator_id) references public.integration_resources(id,connection_id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_snapshots FROM PUBLIC, anon, authenticated, service_role;

alter table public.integration_resources add constraint integration_resource_snapshot_fk
  foreign key(snapshot_id,id,connection_id,workspace_id,creator_id)
  references public.integration_snapshots(id,resource_id,connection_id,workspace_id,creator_id);
create index integration_snapshots_expiry on public.integration_snapshots(creator_id,workspace_id,expires_at);
create table public.integration_events (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  event text not null check(event in ('connected','revoked','revoke_result','purged','credential_expired')),
  generation integer not null, outcome text check(outcome in ('revoked','pending','manual_action','complete')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_events FROM PUBLIC, anon, authenticated, service_role;

create table public.integration_sync_runs (
  workspace_id uuid not null, creator_id uuid not null, request_id uuid not null,
  connection_id uuid not null, generation integer not null,
  payload_hash text not null, status text not null check(status in ('running','completed','partial','unknown','revoked')),
  result jsonb check(result is null or jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  primary key(workspace_id,creator_id,request_id),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE public.integration_sync_runs FROM PUBLIC, anon, authenticated, service_role;

create index integration_sync_connection on public.integration_sync_runs(connection_id,generation,status);
create table private.integration_credentials (
  connection_id uuid primary key, workspace_id uuid not null, creator_id uuid not null,
  generation integer not null, credential jsonb not null check(jsonb_typeof(credential)='object'),
  expires_at timestamptz not null, revoke_until timestamptz,
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_credentials FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_oauth_states (
  state_hash text primary key, session_hash text not null, workspace_id uuid not null, creator_id uuid not null,
  provider text not null check(provider in ('instagram','google_drive')), expected_generation integer not null check(expected_generation>=0),
  return_path text not null check(return_path='/connections'), expires_at timestamptz not null, consumed_at timestamptz,
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_oauth_states FROM PUBLIC, anon, authenticated, service_role;

create index integration_oauth_owner on private.integration_oauth_states(creator_id,workspace_id,provider);
create table private.integration_commands (
  workspace_id uuid not null, creator_id uuid not null, request_id uuid not null,
  action text not null, payload_hash text not null, result jsonb not null,
  connection_id uuid, generation integer, source_ids uuid[] not null default '{}', invalidated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key(workspace_id,creator_id,request_id),
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id),
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_commands FROM PUBLIC, anon, authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['integration_connections','integration_resources','integration_snapshots','integration_events','integration_sync_runs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
    execute format('create policy integration_owner_read on public.%1$I for select to authenticated using (creator_id=(select auth.uid()) and exists(select 1 from public.creators c where c.id=(select auth.uid()) and c.workspace_id=%1$I.workspace_id and c.status=''active''))',t);
  end loop;
  foreach t in array array['integration_credentials','integration_oauth_states','integration_commands'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
create function private.integration_hash(p_value jsonb) returns text language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(p_value::text,'UTF8')),'hex');
$$;
create function private.integration_keys(p_value jsonb,p_keys text[]) returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value)='object' then not exists(select 1 from jsonb_object_keys(p_value) k where not k=any(p_keys)) else false end;
$$;
create function private.integration_envelope(p_value jsonb) returns boolean language sql immutable set search_path='' as $$
  select private.integration_keys(p_value,array['keyId','iv','ciphertext']) and p_value ?& array['keyId','iv','ciphertext']
    and jsonb_typeof(p_value->'keyId')='string' and length(p_value->>'keyId') between 1 and 100
    and jsonb_typeof(p_value->'iv')='string' and length(p_value->>'iv') between 1 and 100
    and jsonb_typeof(p_value->'ciphertext')='string' and length(p_value->>'ciphertext') between 1 and 16000;
$$;
create function private.integration_cached_resources(p_workspace uuid,p_creator uuid,p_connection uuid,p_generation integer,p_resources jsonb)
returns boolean language sql stable set search_path='' as $$
  select not exists(select 1 from jsonb_array_elements(p_resources) v where not exists(
    select 1 from public.integration_resources live where live.workspace_id=p_workspace and live.creator_id=p_creator
      and live.connection_id=p_connection and live.generation=p_generation and live.id=(v->>'id')::uuid
      and live.snapshot_id=(v->>'snapshotId')::uuid and live.data->>'availability' not in ('revoked','stale')
      and live.data->'availability' is not distinct from v->'availability' and live.data->'rights' is not distinct from v->'rights'
      and live.data->'selected' is not distinct from v->'selected' and live.data->'canDownload' is not distinct from v->'canDownload'));
$$;
create function private.integration_immutable_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.connection_id,new.resource_id,new.workspace_id,new.creator_id,new.generation,new.data)
    is distinct from (old.id,old.connection_id,old.resource_id,old.workspace_id,old.creator_id,old.generation,old.data)
    then raise exception 'IMMUTABLE_SNAPSHOT'; end if;
  return new;
end $$;
create trigger integration_immutable_snapshot before update on public.integration_snapshots for each row execute function private.integration_immutable_snapshot();
create function private.integration_connection(p_workspace uuid,p_creator uuid,p_id uuid,p_generation integer,p_scopes boolean default true)
returns public.integration_connections language plpgsql set search_path='' as $$
declare c public.integration_connections;
begin
  select * into c from public.integration_connections where id=p_id and workspace_id=p_workspace and creator_id=p_creator for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_generation is null or c.generation<>p_generation then raise exception 'STALE_CONNECTION'; end if;
  if c.status not in ('connected','partial') then raise exception 'SOURCE_UNAVAILABLE'; end if;
  if p_scopes and ((c.provider='google_drive' and not coalesce(c.data->'scopes' ? 'https://www.googleapis.com/auth/drive.file',false))
    or (c.provider='instagram' and not coalesce(c.data->'scopes' ?& array['instagram_business_basic','instagram_business_manage_insights'],false))) then raise exception 'SCOPE_REQUIRED'; end if;
  return c;
end $$;
-- All helpers are unexposed and called only under the actor lock in integration_command.
create function private.integration_foundation_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  c public.integration_connections; previous public.integration_connections; r public.integration_resources;
  snap public.integration_snapshots; state private.integration_oauth_states; run public.integration_sync_runs;
  d jsonb; x jsonb; metric jsonb; output jsonb:='[]'; v_result jsonb; sid uuid; expected integer; expiry timestamptz;
  fingerprint text:=private.integration_hash(p_payload);
begin
  if p_action='start' then
    if coalesce(p_payload->>'stateHash','') !~ '^[a-fA-F0-9]{64}$' or coalesce(p_payload->>'sessionHash','') !~ '^[a-fA-F0-9]{64}$'
      or coalesce(p_payload->>'provider','') not in ('instagram','google_drive') or p_payload->>'returnPath' is distinct from '/connections'
      or coalesce((p_payload->>'expectedGeneration')::integer,-1)<0 then raise exception 'INVALID_INPUT'; end if;
    expiry:=(p_payload->>'expiresAt')::timestamptz;
    if expiry is null or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '10 minutes' then raise exception 'INVALID_INPUT'; end if;
    select * into c from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=p_payload->>'provider';
    if coalesce(c.generation,0)<>(p_payload->>'expectedGeneration')::integer then raise exception 'STALE_CONNECTION'; end if;
    insert into private.integration_oauth_states(state_hash,session_hash,workspace_id,creator_id,provider,expected_generation,return_path,expires_at)
      values(p_payload->>'stateHash',p_payload->>'sessionHash',p_workspace,p_creator,p_payload->>'provider',(p_payload->>'expectedGeneration')::integer,'/connections',expiry);
    return '{}';
  elsif p_action='consume_state' then
    update private.integration_oauth_states set consumed_at=clock_timestamp()
      where state_hash=p_payload->>'stateHash' and session_hash=p_payload->>'sessionHash' and provider=p_payload->>'provider'
        and workspace_id=p_workspace and creator_id=p_creator and consumed_at is null and expires_at>clock_timestamp()
        and expected_generation=coalesce((select generation from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=p_payload->>'provider'),0)
      returning * into state;
    if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
    return jsonb_build_object('expectedGeneration',state.expected_generation,'returnPath',state.return_path);
  elsif p_action='connect' then
    d:=p_payload->'connection'; expected:=(p_payload->>'expectedGeneration')::integer;
    if private.integration_keys(d,array['id','workspaceId','creatorId','provider','subject','consentVersion','label','status','scopes','generation','lastSyncAt','expiresAt','lastError','sampleOnly','providerRevocation']) is not true
      or exists(select 1 from unnest(array['id','workspaceId','creatorId','provider','subject','consentVersion','label','status','expiresAt']) k where jsonb_typeof(d->k) is distinct from 'string')
      or jsonb_typeof(d->'generation') is distinct from 'number'
      or d->>'provider' not in ('instagram','google_drive') or coalesce(d->>'status','') not in ('connected','partial')
      or jsonb_typeof(d->'scopes') is distinct from 'array' or jsonb_array_length(d->'scopes')>10
      or coalesce(length(d->>'subject'),0) not between 1 and 500 or coalesce(length(d->>'consentVersion'),0) not between 1 and 100
      or coalesce(length(d->>'label'),0) not between 1 and 160 or d->'sampleOnly' is distinct from 'true'::jsonb
      or private.integration_envelope(p_payload->'credential') is not true or octet_length((p_payload->'credential')::text)>16384
      or expected is null or expected<0 then raise exception 'INVALID_INPUT'; end if;
    if (d->>'workspaceId')::uuid is distinct from p_workspace or (d->>'creatorId')::uuid is distinct from p_creator then raise exception 'NOT_FOUND'; end if;
    if exists(select 1 from jsonb_array_elements(d->'scopes') v where jsonb_typeof(v)<>'string'
      or (d->>'provider'='google_drive' and v#>>'{}'<>'https://www.googleapis.com/auth/drive.file')
      or (d->>'provider'='instagram' and v#>>'{}' not in ('instagram_business_basic','instagram_business_manage_insights'))) then raise exception 'INVALID_INPUT'; end if;
    expiry:=(d->>'expiresAt')::timestamptz;
    if expiry is null or expiry<=clock_timestamp() then raise exception 'INVALID_INPUT'; end if;
    select * into previous from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=d->>'provider' for update;
    if coalesce(previous.generation,0)<>expected or (d->>'generation')::integer is distinct from expected+1
      or (previous.id is not null and (previous.id<>(d->>'id')::uuid or (previous.data->>'subject' is distinct from d->>'subject' and previous.status<>'revoked'))) then raise exception 'STALE_CONNECTION'; end if;
    if previous.id is not null then perform private.integration_invalidate(p_workspace,p_creator,previous.id); end if;
    d:=d||jsonb_build_object('generation',expected+1,'lastError',null,'lastSyncAt',null,'providerRevocation','not_requested');
    insert into public.integration_connections(id,workspace_id,creator_id,provider,generation,status,data)
      values((d->>'id')::uuid,p_workspace,p_creator,d->>'provider',expected+1,d->>'status',d)
      on conflict(workspace_id,creator_id,provider) do update set generation=excluded.generation,status=excluded.status,data=excluded.data,revoked_at=null returning * into c;
    insert into private.integration_credentials(connection_id,workspace_id,creator_id,generation,credential,expires_at)
      values(c.id,p_workspace,p_creator,c.generation,p_payload->'credential',expiry)
      on conflict(connection_id) do update set generation=excluded.generation,credential=excluded.credential,expires_at=excluded.expires_at,revoke_until=null;
    insert into public.integration_events(connection_id,workspace_id,creator_id,event,generation) values(c.id,p_workspace,p_creator,'connected',c.generation);
    return jsonb_build_object('connection',c.data);
  elsif p_action='reauth' then
    select * into c from public.integration_connections where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if c.generation is distinct from (p_payload->>'generation')::integer or c.status='revoked' then raise exception 'STALE_CONNECTION'; end if;
    update public.integration_connections set status='reauth_required',data=data||'{"status":"reauth_required","lastError":"REAUTH_REQUIRED"}'::jsonb where id=c.id returning * into c;
    return jsonb_build_object('connection',c.data);
  end if;

  -- These are current-generation reads/writes. Revocation credentials have no general
  -- read route: only a separately approved platform-revocation worker may use them.
  c:=private.integration_connection(p_workspace,p_creator,(p_payload->>'id')::uuid,(p_payload->>'generation')::integer,p_action not in ('credentials','update_credentials'));
  if p_action='credentials' then
    select credential into v_result from private.integration_credentials where connection_id=c.id and generation=c.generation and revoke_until is null;
    if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
    return jsonb_build_object('credential',v_result);
  elsif p_action='update_credentials' then
    if private.integration_envelope(p_payload->'credential') is not true or octet_length((p_payload->'credential')::text)>16384 then raise exception 'INVALID_INPUT'; end if;
    expiry:=(p_payload->>'expiresAt')::timestamptz;
    if expiry is null or expiry<=clock_timestamp() then raise exception 'INVALID_INPUT'; end if;
    update private.integration_credentials set credential=p_payload->'credential',expires_at=expiry where connection_id=c.id and generation=c.generation and revoke_until is null;
    if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
    update public.integration_connections set data=jsonb_set(data,'{expiresAt}',p_payload->'expiresAt') where id=c.id;
    return '{}';
  elsif p_action='resources' then
    if jsonb_typeof(p_payload->'resources') is distinct from 'array' or jsonb_array_length(p_payload->'resources')>50 then raise exception 'INVALID_INPUT'; end if;
    if p_payload ? 'intent' and (c.provider<>'google_drive' or jsonb_array_length(p_payload->'resources')<>jsonb_array_length(p_payload->'intent'->'fileIds')
      or exists(select 1 from jsonb_array_elements(p_payload->'resources') v where not (p_payload->'intent'->'fileIds') ? (v->>'externalId'))) then raise exception 'INVALID_INPUT'; end if;
    if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'resources'))<>jsonb_array_length(p_payload->'resources') then raise exception 'INVALID_INPUT'; end if;
    for d in select value from jsonb_array_elements(p_payload->'resources') loop
      if private.integration_keys(d,array['id','connectionId','workspaceId','creatorId','generation','externalId','title','mimeType','version','selected','canDownload','rights','availability','excerpt','metrics','observedAt','fetchedAt','coverage','contentHash','sizeBytes','sampleOnly','snapshotId']) is not true
        or exists(select 1 from unnest(array['id','connectionId','workspaceId','creatorId','externalId','title','mimeType','version','rights','availability','observedAt','fetchedAt','contentHash']) k where jsonb_typeof(d->k) is distinct from 'string')
        or jsonb_typeof(d->'generation') is distinct from 'number' or jsonb_typeof(d->'sizeBytes') is distinct from 'number'
        or not (d ? 'excerpt') or jsonb_typeof(d->'excerpt') not in ('null','string')
        or coalesce(length(d->>'title'),0) not between 1 and 160 or coalesce(length(d->>'externalId'),0) not between 1 and 500
        or coalesce(length(d->>'version'),0) not between 1 and 500 or coalesce(length(d->>'contentHash'),0) not between 1 and 256
        or coalesce(length(d->>'mimeType'),0) not between 1 and 160 or length(d->>'excerpt')>8000
        or jsonb_typeof(d->'selected') is distinct from 'boolean' or jsonb_typeof(d->'canDownload') is distinct from 'boolean'
        or coalesce(d->>'rights','') not in ('owned','licensed','unknown')
        or coalesce(d->>'availability','') not in ('available','missing','unsupported','stale','revoked','rate_limited')
        or d->'sampleOnly' is distinct from 'true'::jsonb or jsonb_typeof(d->'metrics') is distinct from 'object'
        or private.integration_keys(d->'coverage',array['region','language','partial']) is not true
        or not (d->'coverage' ?& array['region','language','partial'])
        or jsonb_typeof(d->'coverage'->'partial') is distinct from 'boolean'
        or jsonb_typeof(d->'coverage'->'region') not in ('null','string') or jsonb_typeof(d->'coverage'->'language') not in ('null','string')
        or length(d->'coverage'->>'region')>80 or length(d->'coverage'->>'language')>80
        or coalesce((d->>'sizeBytes')::bigint,-1) not between 0 and 5242880 then raise exception 'INVALID_INPUT'; end if;
      if (d->>'workspaceId')::uuid is distinct from p_workspace or (d->>'creatorId')::uuid is distinct from p_creator or (d->>'connectionId')::uuid is distinct from c.id then raise exception 'NOT_FOUND'; end if;
      if (d->>'generation')::integer is distinct from c.generation then raise exception 'STALE_CONNECTION'; end if;
      if (d->>'observedAt')::timestamptz is null or (d->>'fetchedAt')::timestamptz is null then raise exception 'INVALID_INPUT'; end if;
      for metric in select value from jsonb_each(d->'metrics') loop
        if private.integration_keys(metric,array['value','availability','reason']) is not true or not (metric ?& array['value','availability','reason'])
          or jsonb_typeof(metric->'value') not in ('null','number') or jsonb_typeof(metric->'reason') not in ('null','string')
          or length(metric->>'reason')>300 or coalesce(metric->>'availability','') not in ('available','missing','unsupported','stale','revoked','rate_limited')
          or (metric->>'availability'<>'available' and metric->'value'<>'null'::jsonb) then raise exception 'INVALID_INPUT'; end if;
      end loop;
      select * into r from public.integration_resources where id=(d->>'id')::uuid for update;
      if found and (r.connection_id<>c.id or r.workspace_id<>p_workspace or r.creator_id<>p_creator) then raise exception 'NOT_FOUND'; end if;
      if r.id is not null and r.data->>'externalId' is distinct from d->>'externalId' then raise exception 'INVALID_INPUT'; end if;
      if r.id is not null and r.data->'rights' is distinct from d->'rights' then
        perform private.integration_invalidate_sources(p_workspace,p_creator,array(select id from public.studio_sources
          where integration_resource_id=r.id and workspace_id=p_workspace and creator_id=p_creator and revoked_at is null));
      end if;
      d:=d-'snapshotId';
      insert into public.integration_resources(id,connection_id,workspace_id,creator_id,generation,data)
        values((d->>'id')::uuid,c.id,p_workspace,p_creator,c.generation,d)
        on conflict(id) do update set generation=excluded.generation,data=excluded.data;
      -- Reuse only the unchanged current snapshot. Returning to a historical
      -- rights/version state must never reactivate its old source consent.
      select * into snap from public.integration_snapshots where id=r.snapshot_id and resource_id=(d->>'id')::uuid and generation=c.generation
        and data->>'version'=d->>'version' and data->>'contentHash'=d->>'contentHash' and data->'rights'=d->'rights';
      if snap.id is null then
        insert into public.integration_snapshots(connection_id,resource_id,workspace_id,creator_id,generation,data)
          values(c.id,(d->>'id')::uuid,p_workspace,p_creator,c.generation,d) returning * into snap;
      end if;
      d:=d||jsonb_build_object('snapshotId',snap.id);
      update public.integration_resources set snapshot_id=snap.id,data=d where id=(d->>'id')::uuid;
      output:=output||jsonb_build_array(d);
    end loop;
    if p_payload ? 'lastSyncAt' then
      if (p_payload->>'lastSyncAt')::timestamptz is null then raise exception 'INVALID_INPUT'; end if;
      update public.integration_connections set data=jsonb_set(data,'{lastSyncAt}',p_payload->'lastSyncAt') where id=c.id;
    end if;
    return jsonb_build_object('resources',output);
  elsif p_action='reserve_sync' then
    select * into run from public.integration_sync_runs where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request for update;
    if found then
      if run.payload_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if run.status in ('completed','partial') then
        if not private.integration_cached_resources(p_workspace,p_creator,c.id,c.generation,run.result->'resources') then raise exception 'SOURCE_UNAVAILABLE'; end if;
        return jsonb_build_object('action','replay','result',run.result);
      end if;
      return '{"action":"pending"}';
    end if;
    if (c.data->>'lastSyncAt')::timestamptz>clock_timestamp()-interval '60 minutes' then raise exception 'RATE_LIMITED'; end if;
    -- An explicit new request after an unknown outcome may start a new run. An
    -- in-flight run is never taken over or implicitly re-executed by lease expiry.
    if exists(select 1 from public.integration_sync_runs where connection_id=c.id and generation=c.generation and status='running') then
      insert into public.integration_sync_runs(workspace_id,creator_id,request_id,connection_id,generation,payload_hash,status)
        values(p_workspace,p_creator,p_request,c.id,c.generation,fingerprint,'unknown');
      return '{"action":"pending"}';
    end if;
    insert into public.integration_sync_runs(workspace_id,creator_id,request_id,connection_id,generation,payload_hash,status)
      values(p_workspace,p_creator,p_request,c.id,c.generation,fingerprint,'running');
    return '{"action":"reserved"}';
  elsif p_action in ('finish_sync','fail_sync') then
    select * into run from public.integration_sync_runs where workspace_id=p_workspace and creator_id=p_creator and connection_id=c.id and generation=c.generation and request_id=(p_payload->>'runRequestId')::uuid for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if run.status<>'running' then raise exception 'SOURCE_UNAVAILABLE'; end if;
    if p_action='fail_sync' then
      update public.integration_sync_runs set status='unknown',finished_at=clock_timestamp() where workspace_id=p_workspace and creator_id=p_creator and request_id=run.request_id;
    else
      v_result:=p_payload->'result';
      if private.integration_keys(v_result,array['status','resources']) is not true or coalesce(v_result->>'status','') not in ('completed','partial')
        or jsonb_typeof(v_result->'resources') is distinct from 'array' or jsonb_array_length(v_result->'resources')>50 then raise exception 'INVALID_INPUT'; end if;
      for x in select value from jsonb_array_elements(v_result->'resources') loop
        if not exists(select 1 from public.integration_resources where id=(x->>'id')::uuid and connection_id=c.id and generation=c.generation and data=x) then raise exception 'INVALID_INPUT'; end if;
      end loop;
      update public.integration_sync_runs set status=v_result->>'status',result=v_result,finished_at=clock_timestamp() where workspace_id=p_workspace and creator_id=p_creator and request_id=run.request_id;
      update public.integration_connections set data=jsonb_set(data,'{lastSyncAt}',to_jsonb(clock_timestamp())) where id=c.id;
    end if;
    return '{}';
  end if;
  raise exception 'INVALID_INPUT';
end $$;
revoke all on function private.integration_hash(jsonb),private.integration_keys(jsonb,text[]),private.integration_envelope(jsonb),private.integration_cached_resources(uuid,uuid,uuid,integer,jsonb),private.integration_immutable_snapshot(),
  private.integration_connection(uuid,uuid,uuid,integer,boolean),private.integration_foundation_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- SOURCE: derived-sql/20261031121000-studio_integration_evidence.sql; sha256=f01c5e4e8557915dc6054ed1fc8b63bdd72443ec5b4bde39f7a788f7e66f60d1
-- Only server-imported rows may carry actual/unknown coverage. The manual command
-- retains its original HK/zh-Hant validation as well as this database constraint.
alter table public.studio_sources
  alter column region drop not null, alter column language drop not null,
  drop constraint studio_sources_region_check, drop constraint studio_sources_language_check,
  add column integration jsonb,
  add column integration_connection_id uuid generated always as ((integration->>'connection_id')::uuid) stored,
  add column integration_resource_id uuid generated always as ((integration->>'resource_id')::uuid) stored,
  add column integration_snapshot_id uuid generated always as ((integration->>'snapshot_id')::uuid) stored,
  add constraint studio_source_owner_key unique(id,workspace_id,creator_id),
  add constraint studio_source_coverage check (
    (integration is null and region is not null and region='HK' and language is not null and language='zh-Hant')
    or (integration is not null and jsonb_typeof(integration)='object' and kind='private'
      and integration ?& array['connection_id','resource_id','snapshot_id','generation','content_hash','source_version','model_allowed','provenance','availability','sample_only','coverage']
      and integration_connection_id is not null and integration_resource_id is not null and integration_snapshot_id is not null
      and jsonb_typeof(integration->'model_allowed')='boolean' and (integration->>'generation')::integer>0
      and (region is not distinct from integration->'coverage'->>'region') and (language is not distinct from integration->'coverage'->>'language'))),
  add constraint studio_source_integration_fk foreign key(integration_snapshot_id,integration_resource_id,integration_connection_id,workspace_id,creator_id)
    references public.integration_snapshots(id,resource_id,connection_id,workspace_id,creator_id);
create unique index studio_source_snapshot_once on public.studio_sources(thread_id,integration_snapshot_id) where integration_snapshot_id is not null and revoked_at is null;
create index studio_source_integration_connection on public.studio_sources(integration_connection_id);
alter table public.studio_shares add column integration_receipt jsonb;
create table private.integration_use_permits (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creator_id uuid not null,
  source_id uuid not null, snapshot_id uuid not null, generation integer not null, content_hash text not null,
  use_kind text not null check(use_kind in ('read','model','save_brief','share')), payload_hash text,
  created_at timestamptz not null, expires_at timestamptz not null, consumed_at timestamptz, revoked_at timestamptz,
  check(expires_at<=created_at+interval '60 seconds'),
  foreign key(source_id,workspace_id,creator_id) references public.studio_sources(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_use_permits FROM PUBLIC, anon, authenticated, service_role;

create index integration_permit_use on private.integration_use_permits(source_id,use_kind,payload_hash,expires_at);
alter table private.integration_use_permits enable row level security;
revoke all on private.integration_use_permits from public,anon,authenticated,service_role;
create function private.integration_source(p_workspace uuid,p_creator uuid,p_id uuid,p_use text)
returns public.studio_sources language plpgsql set search_path='' as $$
declare s public.studio_sources; c public.integration_connections; r public.integration_resources; snap public.integration_snapshots;
begin
  select * into s from public.studio_sources where id=p_id and workspace_id=p_workspace and creator_id=p_creator;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.integration is null or s.revoked_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
  select * into c from public.integration_connections where id=s.integration_connection_id;
  select * into r from public.integration_resources where id=s.integration_resource_id;
  select * into snap from public.integration_snapshots where id=s.integration_snapshot_id;
  if c.status not in ('connected','partial') or c.generation is distinct from (s.integration->>'generation')::integer
    or r.generation is distinct from c.generation or snap.generation is distinct from c.generation
    or r.snapshot_id is distinct from snap.id or r.data->>'availability' is distinct from 'available'
    or r.data->'selected' is distinct from 'true'::jsonb or r.data->'canDownload' is distinct from 'true'::jsonb
    or s.integration->>'content_hash' is distinct from snap.data->>'contentHash'
    or s.integration->>'availability' is distinct from 'available' then raise exception 'SOURCE_UNAVAILABLE'; end if;
  perform private.integration_connection(p_workspace,p_creator,c.id,c.generation);
  if p_use='model' and s.integration->'model_allowed' is distinct from 'true'::jsonb then raise exception 'MODEL_CONSENT_REQUIRED'; end if;
  if p_use='share' and (not s.shareable or r.data->>'rights' not in ('owned','licensed')) then raise exception 'SOURCE_PRIVATE'; end if;
  return s;
end $$;
create function private.integration_evidence_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  c public.integration_connections; t public.studio_threads; r public.integration_resources; s public.studio_sources;
  permission private.integration_use_permits; ids jsonb; sid text; content text; result jsonb:='[]'; metadata jsonb; snapshot_data jsonb;
  inserted integer:=0; stamp timestamptz:=clock_timestamp(); usage text; fingerprint text;
begin
  if p_action='source_refs' then
    ids:=p_payload->'sourceIds';
    if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>100 then raise exception 'INVALID_INPUT'; end if;
    for sid in select distinct jsonb_array_elements_text(ids) loop
      select * into s from public.studio_sources where id=sid::uuid and workspace_id=p_workspace and creator_id=p_creator;
      if not found then raise exception 'NOT_FOUND'; end if;
      result:=result||jsonb_build_array(to_jsonb(s));
    end loop;
    return jsonb_build_object('sources',result);
  elsif p_action='import' then
    c:=private.integration_connection(p_workspace,p_creator,(p_payload->>'id')::uuid,(p_payload->>'generation')::integer);
    select * into t from public.studio_threads where id=(p_payload->>'threadId')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if t.revision is distinct from (p_payload->>'revision')::integer then raise exception 'WORKFLOW_STALE'; end if;
    ids:=p_payload->'resourceIds';
    if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 1 and 5
      or (select count(distinct value) from jsonb_array_elements_text(ids))<>jsonb_array_length(ids)
      or coalesce(length(trim(p_payload->>'question')),0) not between 1 and 500
      or jsonb_typeof(p_payload->'modelConsent') is distinct from 'boolean' or jsonb_typeof(p_payload->'processingRights') is distinct from 'boolean'
      or jsonb_typeof(p_payload->'shareRights') is distinct from 'boolean' then raise exception 'INVALID_INPUT'; end if;
    for sid in select jsonb_array_elements_text(ids) loop
      select * into r from public.integration_resources where id=sid::uuid and connection_id=c.id and workspace_id=p_workspace and creator_id=p_creator;
      if not found then raise exception 'NOT_FOUND'; end if;
      if r.generation<>c.generation then raise exception 'STALE_CONNECTION'; end if;
      if r.snapshot_id is null or r.data->>'availability'<>'available' or r.data->'selected'<>'true'::jsonb or r.data->'canDownload'<>'true'::jsonb then raise exception 'SOURCE_UNAVAILABLE'; end if;
      select * into s from public.studio_sources where thread_id=t.id and integration_snapshot_id=r.snapshot_id and revoked_at is null;
      if found then
        if s.revoked_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
        result:=result||jsonb_build_array(to_jsonb(s)); continue;
      end if;
      if (select count(*) from public.studio_sources where thread_id=t.id)>=100 then raise exception 'SOURCE_LIMIT'; end if;
      select data into snapshot_data from public.integration_snapshots where id=r.snapshot_id;
      -- Reading/selecting a resource does not authorize retaining its excerpt in
      -- Studio. Without processing rights retain only the permission notice.
      content:=case when (p_payload->>'processingRights')::boolean
        then coalesce(nullif(trim(snapshot_data->>'excerpt'),''),nullif((snapshot_data->'metrics')::text,'{}'))
        else '未確認此來源的處理權限；僅保留來源資訊，不會使用原文。' end;
      if coalesce(length(content),0) not between 1 and 8000 then raise exception 'INVALID_INPUT'; end if;
      metadata:=jsonb_build_object('connection_id',c.id,'resource_id',r.id,'snapshot_id',r.snapshot_id,'generation',c.generation,
        'source_version',r.data->>'version','content_hash',r.data->>'contentHash','model_allowed',(p_payload->>'modelConsent')::boolean and (p_payload->>'processingRights')::boolean,
        'provenance',c.provider,'availability',r.data->>'availability','sample_only',true,'coverage',snapshot_data->'coverage','consent_version',c.data->>'consentVersion');
      insert into public.studio_sources(thread_id,workspace_id,creator_id,title,content,kind,shareable,question,platform,region,language,observed_at,integration)
        values(t.id,p_workspace,p_creator,snapshot_data->>'title',content,'private',(p_payload->>'processingRights')::boolean and (p_payload->>'shareRights')::boolean and r.data->>'rights' in ('owned','licensed'),
          trim(p_payload->>'question'),case c.provider when 'instagram' then 'instagram_api' else 'google_drive' end,
          snapshot_data->'coverage'->>'region',snapshot_data->'coverage'->>'language',(snapshot_data->>'observedAt')::timestamptz,metadata) returning * into s;
      inserted:=inserted+1; result:=result||jsonb_build_array(to_jsonb(s));
    end loop;
    if inserted>0 then update public.studio_threads set revision=revision+1 where id=t.id; end if;
    return jsonb_build_object('sources',result);
  elsif p_action='permit' then
    ids:=p_payload->'sourceIds'; usage:=p_payload->>'use';
    if coalesce(usage,'') not in ('read','model','save_brief','share') or jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 1 and 100
      or (select count(distinct value) from jsonb_array_elements_text(ids))<>jsonb_array_length(ids) then raise exception 'INVALID_INPUT'; end if;
    if usage in ('save_brief','share') then
      if jsonb_typeof(p_payload->'commandPayload') is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
      fingerprint:=private.integration_hash(p_payload->'commandPayload');
    end if;
    for sid in select jsonb_array_elements_text(ids) loop
      s:=private.integration_source(p_workspace,p_creator,sid::uuid,usage);
      if usage='model' then
        if private.integration_keys(p_payload->'commandPayload',array['requestId']) is not true
          or (p_payload->'commandPayload'->>'requestId')::uuid is null then raise exception 'INVALID_INPUT'; end if;
        fingerprint:=private.integration_hash(p_payload->'commandPayload');
      end if;
      insert into private.integration_use_permits(workspace_id,creator_id,source_id,snapshot_id,generation,content_hash,use_kind,payload_hash,created_at,expires_at,consumed_at)
        values(p_workspace,p_creator,s.id,s.integration_snapshot_id,(s.integration->>'generation')::integer,s.integration->>'content_hash',usage,fingerprint,
          stamp,stamp+interval '60 seconds',null) returning * into permission;
      -- Model permits bind to an assistant request and are consumed by durable
      -- persistence; save/share permits bind to the complete Studio command JSON.
      result:=result||jsonb_build_array(jsonb_build_object('id',permission.id,'sourceId',s.id,'snapshotId',permission.snapshot_id,
        'generation',permission.generation,'contentHash',permission.content_hash,'use',usage,'expiresAt',permission.expires_at));
    end loop;
    return jsonb_build_object('permits',result);
  end if;
  raise exception 'INVALID_INPUT';
end $$;
-- Preserve the original body byte-for-byte, including manual source, revision,
-- lineage and canonical-draft behavior. It is not a second service/browser API.
alter function public.studio_command(uuid,uuid,uuid,text,jsonb) set schema private;
alter function private.studio_command(uuid,uuid,uuid,text,jsonb) rename to studio_command_stage3;
revoke all on function private.studio_command_stage3(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.studio_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  t public.studio_threads; b public.studio_briefs; s public.studio_sources; cached public.studio_commands;
  permission private.integration_use_permits; sections jsonb; section jsonb; selected jsonb; source_id text;
  source_ids uuid[]:='{}'; sid uuid; fingerprint text; result jsonb; draft jsonb; snapshots jsonb:='[]'; evidence jsonb:='[]';
  caption text:=''; part text; share_id uuid; receipt jsonb; already_saved boolean;
begin
  if p_workspace is null or p_creator is null or p_request is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>64000 then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status in ('active','pending_review') for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action='add_source' and (p_payload ?| array['integration','integration_connection_id','integration_snapshot_id','integration_resource_id','snapshotId','connectionId','generation','provenance']
    or lower(coalesce(p_payload->>'platform','')) in ('google_drive','instagram','instagram_api')) then raise exception 'INVALID_INPUT'; end if;
  if p_action not in ('save_brief','share_brief') then
    -- Stage 3 uses transaction-start now(). For imported sources the privacy
    -- boundary must follow answers committed while this transaction awaited the
    -- creator lock above. Pre-stamp only a fresh revocation; Stage 3 then preserves
    -- it in both the row and receipt. Its validation failure rolls this back too.
    if p_action='revoke_source' and not exists(select 1 from public.studio_commands
      where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request) then
      update public.studio_sources set revoked_at=clock_timestamp()
        where id=(p_payload->>'sourceId')::uuid and thread_id=(p_payload->>'threadId')::uuid
          and workspace_id=p_workspace and creator_id=p_creator and integration is not null and revoked_at is null;
    end if;
    result:=private.studio_command_stage3(p_workspace,p_creator,p_request,p_action,p_payload);
    if p_action='revoke_source' then
      update private.integration_use_permits u set revoked_at=clock_timestamp() where u.source_id=(p_payload->>'sourceId')::uuid;
      -- Invalidate pending model results without discarding the user's input.
      update public.assistant_requests set state='unknown',result=jsonb_build_object('code','studio_context_changed','persistence','failed'),lease_until=clock_timestamp()
        where creator_id=p_creator and workspace_id=p_workspace and state in ('reserved','generating')
          and conversation_id in (select conversation_id from public.studio_threads where id=(p_payload->>'threadId')::uuid);
    end if;
    return result;
  end if;
  if p_action='share_brief' and p_payload ? 'recipient' and p_payload->>'recipient' is distinct from 'task_review' then raise exception 'INVALID_INPUT'; end if;
  select * into t from public.studio_threads where id=(p_payload->>'threadId')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into cached from public.studio_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  already_saved:=found;
  if already_saved and (cached.action<>p_action or cached.payload<>p_payload) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if p_action='save_brief' then
    sections:=p_payload->'sections';
    if jsonb_typeof(sections) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
  else
    select * into b from public.studio_briefs where id=(p_payload->>'briefId')::uuid and thread_id=t.id;
    if not found then raise exception 'NOT_FOUND'; end if;
    selected:=p_payload->'sectionIds';
    if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected) not between 1 and 12
      or (select count(distinct value) from jsonb_array_elements_text(selected))<>jsonb_array_length(selected)
      or exists(select 1 from jsonb_array_elements_text(selected) x where not exists(select 1 from jsonb_array_elements(b.sections) y where y->>'id'=x)) then raise exception 'INVALID_SELECTION'; end if;
    select coalesce(jsonb_agg(value),'[]') into sections from jsonb_array_elements(b.sections) where selected ? (value->>'id');
  end if;
  for section in select value from jsonb_array_elements(sections) loop
    if jsonb_typeof(section->'sourceIds') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
    for source_id in select jsonb_array_elements_text(section->'sourceIds') loop
      select * into s from public.studio_sources where id=source_id::uuid and thread_id=t.id;
      if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
      if s.integration is not null and not s.id=any(source_ids) then source_ids:=array_append(source_ids,s.id); end if;
    end loop;
  end loop;
  fingerprint:=private.integration_hash(p_payload);
  foreach sid in array source_ids loop
    perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status='active';
    if not found then raise exception 'NOT_FOUND'; end if;
    s:=private.integration_source(p_workspace,p_creator,sid,case p_action when 'share_brief' then 'share' else 'save_brief' end);
    if not already_saved then
      select u.* into permission from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator
        and u.source_id=s.id and u.snapshot_id=s.integration_snapshot_id and u.generation=(s.integration->>'generation')::integer
        and u.content_hash=s.integration->>'content_hash' and u.use_kind=case p_action when 'share_brief' then 'share' else 'save_brief' end
        and u.payload_hash=fingerprint and u.expires_at>clock_timestamp() and u.consumed_at is null and u.revoked_at is null order by u.created_at limit 1 for update;
      if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
      update private.integration_use_permits set consumed_at=clock_timestamp() where id=permission.id;
    end if;
  end loop;
  -- Successful command replay doesn't need a second permit, but still rechecks all
  -- provider sources above. Revocation can never resurrect cached private output.
  if already_saved then return cached.result; end if;
  if p_action='save_brief' or cardinality(source_ids)=0 then
    return private.studio_command_stage3(p_workspace,p_creator,p_request,p_action,p_payload);
  end if;

  -- Provider-aware share uses the same canonical draft transaction and validations.
  -- Only citation coverage and the permission receipt differ from the legacy path.
  if t.revision is distinct from (p_payload->>'revision')::integer then raise exception 'WORKFLOW_STALE'; end if;
  if exists(select 1 from public.studio_briefs where thread_id=t.id and version>b.version) then raise exception 'STALE_BRIEF'; end if;
  if not exists(select 1 from public.mission_submissions ms join public.mission_workflows w on w.mission_submission_id=ms.id and w.workspace_id=ms.workspace_id
    join public.mission_work_items i on i.mission_workflow_id=w.id and i.workspace_id=w.workspace_id
    where ms.id=(p_payload->>'submissionId')::uuid and i.id=(p_payload->>'workItemId')::uuid and ms.creator_id=p_creator and ms.workspace_id=p_workspace
      and (t.mission_id is null or t.mission_id=ms.mission_id)) then raise exception 'NOT_FOUND'; end if;
  for section in select value from jsonb_array_elements(sections) loop
    part:=section->>'text';
    for source_id in select jsonb_array_elements_text(section->'sourceIds') loop
      select * into s from public.studio_sources where id=source_id::uuid and thread_id=t.id;
      if not found or s.revoked_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
      if not s.shareable then raise exception 'SOURCE_PRIVATE'; end if;
      snapshots:=snapshots||jsonb_build_array(jsonb_build_object('id',s.id,'title',s.title,'question',s.question,'platform',s.platform,
        'observedAt',s.observed_at,'url',s.url,'status',s.status,'region',s.region,'language',s.language));
      part:=part||E'\n來源：'||s.title||' · '||s.platform||' · '||to_char(s.observed_at at time zone 'Asia/Hong_Kong','YYYY-MM-DD HH24:MI')||' HKT · '
        ||case when s.integration is null then 'HK / 繁中' else coalesce(s.region,'地區未驗證')||' / '||coalesce(s.language,'語言未驗證') end
        ||' · 未驗證'||coalesce(' · '||s.url,'')||E'\n問題：'||s.question;
      if s.integration is not null then
        evidence:=evidence||jsonb_build_array(jsonb_build_object('source_id',s.id,'snapshot_id',s.integration_snapshot_id,'generation',(s.integration->>'generation')::integer,
          'content_hash',s.integration->>'content_hash','source_version',s.integration->>'source_version','consent_version',s.integration->>'consent_version',
          'provenance',s.integration->>'provenance','coverage',s.integration->'coverage'));
      end if;
    end loop;
    caption:=caption||case when caption='' then '' else E'\n\n' end||part;
  end loop;
  if length(caption)>10000 or (p_payload->>'draftRevision')::integer is null then raise exception 'INVALID_INPUT'; end if;
  draft:=private.save_active_mission_draft((p_payload->>'submissionId')::uuid,p_creator,p_workspace,(p_payload->>'workItemId')::uuid,(p_payload->>'draftRevision')::integer,jsonb_build_object('caption',caption));
  if draft ? 'code' then raise exception '%',draft->>'code'; end if;
  if draft->'draft'->>'revision' is null then raise exception 'DRAFT_UNAVAILABLE'; end if;
  receipt:=jsonb_build_object('brief_id',b.id,'brief_version',b.version,'section_ids',selected,'sources',evidence,'command_hash',fingerprint,
    'content_hash',private.integration_hash(sections),'submission_id',p_payload->>'submissionId','work_item_id',p_payload->>'workItemId','recipient','task_review');
  insert into public.studio_shares(thread_id,workspace_id,creator_id,brief_id,submission_id,work_item_id,section_ids,source_snapshot,draft_revision,integration_receipt)
    values(t.id,p_workspace,p_creator,b.id,(p_payload->>'submissionId')::uuid,(p_payload->>'workItemId')::uuid,selected,snapshots,(draft->'draft'->>'revision')::integer,receipt) returning id into share_id;
  select to_jsonb(sh) into result from public.studio_shares sh where sh.id=share_id;
  update public.studio_threads set revision=revision+1 where id=t.id;
  insert into public.studio_commands(workspace_id,creator_id,request_id,action,payload,result) values(p_workspace,p_creator,p_request,p_action,p_payload,result);
  return result;
end $$;
revoke all on function public.studio_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_command(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function private.integration_source(uuid,uuid,uuid,text),private.integration_evidence_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- SOURCE: derived-sql/20261031122000-integration_privacy_cleanup.sql; sha256=8bd30ba43306b6ace3ab97090e3bd016d01ea35df81acf8c0aef16ee31eafacc
-- Caller holds the creator lock. Both resource-rights changes and connection
-- revocation quarantine affected source/model state through the same fence.
create function private.integration_invalidate_sources(p_workspace uuid,p_creator uuid,p_source_ids uuid[])
returns void language plpgsql set search_path='' as $$
declare affected_threads uuid[]; affected_sources uuid[];
begin
  select coalesce(array_agg(distinct thread_id),'{}'),coalesce(array_agg(id),'{}') into affected_threads,affected_sources
    from public.studio_sources where id=any(p_source_ids) and workspace_id=p_workspace and creator_id=p_creator;
  update public.studio_sources set revoked_at=coalesce(revoked_at,clock_timestamp()),shareable=false,
    integration=integration||'{"availability":"revoked","model_allowed":false}'::jsonb where id=any(affected_sources);
  update public.studio_threads set revision=revision+1 where id=any(affected_threads);
  update private.integration_use_permits set revoked_at=coalesce(revoked_at,clock_timestamp()) where source_id=any(affected_sources);
  -- Pending requests cannot complete against a changed Studio context. Completed
  -- answers are quarantined only with source provenance; safe turns and user text
  -- remain. Model permits retain lineage even if a cached citation was removed.
  update public.assistant_requests r set state='unknown',result=jsonb_build_object('code','studio_context_changed','persistence','failed'),lease_until=clock_timestamp()
    where r.workspace_id=p_workspace and r.creator_id=p_creator
      and r.conversation_id in (select conversation_id from public.studio_threads where id=any(affected_threads))
      and (r.state in ('reserved','generating')
        or exists(select 1 from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator
          and u.use_kind='model' and u.source_id=any(affected_sources) and u.payload_hash=private.integration_hash(jsonb_build_object('requestId',r.request_id)))
        or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(r.result->'citations')='array' then r.result->'citations' else '[]'::jsonb end) ref
          where ref->>'sourceRef'=any(affected_sources::text[]))
        or exists(select 1 from public.assistant_messages m where m.conversation_id=r.conversation_id and m.request_id=r.request_id and m.role='assistant'
          and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m.citations)='array' then m.citations else '[]'::jsonb end) ref
            where ref->>'sourceRef'=any(affected_sources::text[]))));
end $$;
create function private.integration_invalidate(p_workspace uuid,p_creator uuid,p_connection uuid)
returns void language plpgsql set search_path='' as $$
declare affected_sources uuid[];
begin
  select coalesce(array_agg(id),'{}') into affected_sources from public.studio_sources
    where integration_connection_id=p_connection and workspace_id=p_workspace and creator_id=p_creator;
  perform private.integration_invalidate_sources(p_workspace,p_creator,affected_sources);
  update public.integration_resources set data=jsonb_set(data,'{availability}','"revoked"') where connection_id=p_connection;
  update public.integration_snapshots set expires_at=least(expires_at,clock_timestamp()+interval '24 hours') where connection_id=p_connection;
  update private.integration_oauth_states set consumed_at=coalesce(consumed_at,clock_timestamp())
    where workspace_id=p_workspace and creator_id=p_creator and provider=(select provider from public.integration_connections where id=p_connection);
  update public.integration_sync_runs set status='revoked',result=null,finished_at=clock_timestamp() where connection_id=p_connection;
end $$;
create function private.integration_purge(p_workspace uuid,p_creator uuid,p_connection uuid)
returns void language plpgsql set search_path='' as $$
declare c public.integration_connections; v_source_ids uuid[]; thread_ids uuid[];
begin
  select * into c from public.integration_connections where id=p_connection and workspace_id=p_workspace and creator_id=p_creator for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(id),'{}'),coalesce(array_agg(distinct thread_id),'{}') into v_source_ids,thread_ids
    from public.studio_sources where integration_connection_id=c.id;
  perform private.integration_invalidate(p_workspace,p_creator,c.id);
  if c.status<>'revoked' then c.generation:=c.generation+1; end if;
  update public.integration_connections set generation=c.generation,status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),
    data=data||jsonb_build_object('generation',c.generation,'status','revoked','label','Disconnected','subject','','scopes','[]'::jsonb,
      'lastSyncAt',null,'lastError',null,'providerRevocation',case when data->>'providerRevocation'='revoked' then 'revoked' else 'manual_action' end)
    where id=c.id;
  delete from private.integration_credentials where connection_id=c.id;
  delete from private.integration_oauth_states where workspace_id=p_workspace and creator_id=p_creator and provider=c.provider;
  -- Privacy erasure is the sole exception to immutable private Brief history.
  -- Retain unrelated paragraphs and independent, already-delivered task copies.
  update public.studio_briefs b set sections=(select coalesce(jsonb_agg(section),'[]') from jsonb_array_elements(b.sections) section
    where not exists(select 1 from jsonb_array_elements_text(section->'sourceIds') ref where ref::uuid=any(v_source_ids)))
    where b.thread_id=any(thread_ids);
  update public.studio_shares sh set source_snapshot=(select coalesce(jsonb_agg(case when (s->>'id')::uuid=any(v_source_ids)
    then jsonb_build_object('id',s->>'id','status','purged') else s end),'[]') from jsonb_array_elements(sh.source_snapshot) s)
    where sh.thread_id=any(thread_ids);
  -- Retained integration receipts contain IDs, hashes, versions and destination,
  -- never original excerpts. Canonical drafts, rewards and ledgers are untouched.
  delete from public.studio_commands where workspace_id=p_workspace and creator_id=p_creator
    and ((payload->>'threadId')::uuid=any(thread_ids) or (result->>'id')::uuid=any(v_source_ids));
  update private.integration_commands set result='{}',invalidated_at=clock_timestamp()
    where workspace_id=p_workspace and creator_id=p_creator and action<>'purge'
      and (connection_id=c.id or v_source_ids && integration_commands.source_ids);
  update public.assistant_messages m set content='[integration content removed]',citations='[]',tool_calls='[]'
    where m.role='assistant' and m.conversation_id in (select conversation_id from public.studio_threads where id=any(thread_ids))
      and (exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m.citations)='array' then m.citations else '[]'::jsonb end) ref
          where ref->>'sourceRef'=any(v_source_ids::text[]))
        or exists(select 1 from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator
          and u.use_kind='model' and u.source_id=any(v_source_ids) and u.payload_hash=private.integration_hash(jsonb_build_object('requestId',m.request_id))));
  delete from public.studio_sources where id=any(v_source_ids);
  update public.integration_resources set snapshot_id=null where connection_id=c.id;
  delete from public.integration_resources where connection_id=c.id;
  update public.integration_sync_runs set status='revoked',result=null where connection_id=c.id;
end $$;
create function private.integration_privacy_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare c public.integration_connections; cleanup_at timestamptz; expired_ids uuid[]; n integer:=0; retained private.integration_credentials;
begin
  if p_action='export' then
    return jsonb_build_object(
      'connections',coalesce((select jsonb_agg(data order by id) from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator),'[]'),
      'resources',coalesce((select jsonb_agg(data order by id) from public.integration_resources where workspace_id=p_workspace and creator_id=p_creator),'[]'),
      'sources',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.studio_sources s where workspace_id=p_workspace and creator_id=p_creator and integration is not null),'[]'));
  elsif p_action='expire' then
    cleanup_at:=(p_payload->>'now')::timestamptz;
    if cleanup_at is null then raise exception 'INVALID_INPUT'; end if;
    update public.integration_connections conn set data=jsonb_set(data,'{providerRevocation}','"manual_action"')
      where conn.workspace_id=p_workspace and conn.creator_id=p_creator and conn.status='revoked' and conn.data->>'providerRevocation'='pending'
        and exists(select 1 from private.integration_credentials k where k.connection_id=conn.id and k.revoke_until<=cleanup_at);
    delete from private.integration_credentials where workspace_id=p_workspace and creator_id=p_creator
      and (revoke_until<=cleanup_at or (revoke_until is null and expires_at<=cleanup_at));
    get diagnostics n=row_count;
    select coalesce(array_agg(id),'{}') into expired_ids from public.integration_snapshots snap where workspace_id=p_workspace and creator_id=p_creator
      and expires_at<=cleanup_at and not exists(select 1 from public.studio_sources s where s.integration_snapshot_id=snap.id);
    update public.integration_resources set snapshot_id=null,data=data||'{"snapshotId":null,"excerpt":null,"metrics":{},"availability":"stale"}'::jsonb where snapshot_id=any(expired_ids);
    delete from public.integration_snapshots where id=any(expired_ids);
    delete from private.integration_oauth_states where workspace_id=p_workspace and creator_id=p_creator and expires_at<=cleanup_at;
    -- Keep expired model lineage as a content-free tombstone until source/account
    -- purge. Deleting it would let a late result omit all citations and look manual.
    delete from private.integration_use_permits where workspace_id=p_workspace and creator_id=p_creator and expires_at<=cleanup_at and consumed_at is null and use_kind<>'model';
    -- A result cache is also retained source content: scrub it when its snapshot is
    -- expired. Preserve fingerprints as tombstones to prevent request resurrection.
    update private.integration_commands cmd set result='{}',invalidated_at=cleanup_at
      where cmd.workspace_id=p_workspace and cmd.creator_id=p_creator and cmd.action='resources'
        and exists(select 1 from jsonb_array_elements(cmd.result->'resources') r where (r->>'snapshotId')::uuid=any(expired_ids));
    update public.integration_sync_runs run set result=null,status='unknown' where run.workspace_id=p_workspace and run.creator_id=p_creator
      and exists(select 1 from jsonb_array_elements(run.result->'resources') r where (r->>'snapshotId')::uuid=any(expired_ids));
    delete from public.integration_events where workspace_id=p_workspace and creator_id=p_creator and created_at<cleanup_at-interval '90 days';
    return jsonb_build_object('purged',n+cardinality(expired_ids));
  end if;
  select * into c from public.integration_connections where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action='revocation_credentials' then
    if jsonb_typeof(p_payload->'generation') is distinct from 'number' or coalesce((p_payload->>'generation')::integer,0)<=0 then raise exception 'INVALID_INPUT'; end if;
    if c.generation<>(p_payload->>'generation')::integer or c.status<>'revoked' or c.data->>'providerRevocation' is distinct from 'pending' then raise exception 'STALE_CONNECTION'; end if;
    -- A dedicated management read only. Normal credentials remain unavailable
    -- after revoke. Return the original generation for authenticated decryption.
    select * into retained from private.integration_credentials where connection_id=c.id and workspace_id=p_workspace and creator_id=p_creator
      and revoke_until>clock_timestamp() and c.revoked_at>clock_timestamp()-interval '24 hours';
    return jsonb_build_object('credential',retained.credential,'credentialGeneration',retained.generation);
  elsif p_action='revoke' then
    if c.generation is distinct from (p_payload->>'generation')::integer then raise exception 'STALE_CONNECTION'; end if;
    if c.status<>'revoked' then
      perform private.integration_invalidate(p_workspace,p_creator,c.id);
      update public.integration_connections set status='revoked',generation=generation+1,revoked_at=clock_timestamp(),
        data=data||jsonb_build_object('status','revoked','generation',generation+1,'providerRevocation','pending') where id=c.id returning * into c;
      update private.integration_credentials set revoke_until=clock_timestamp()+interval '24 hours' where connection_id=c.id;
      insert into public.integration_events(connection_id,workspace_id,creator_id,event,generation,outcome) values(c.id,p_workspace,p_creator,'revoked',c.generation,'pending');
    end if;
    return jsonb_build_object('connection',c.data);
  elsif p_action='revoke_result' then
    -- Provider completion belongs to the generation returned by local revoke.
    -- The status alone cannot distinguish an old completion from a newer revoke
    -- after reconnect; fence before touching the newer credential or receipt.
    if jsonb_typeof(p_payload->'generation') is distinct from 'number' or coalesce((p_payload->>'generation')::integer,0)<=0 then raise exception 'INVALID_INPUT'; end if;
    if c.status<>'revoked' or c.generation<>(p_payload->>'generation')::integer then raise exception 'STALE_CONNECTION'; end if;
    if coalesce(p_payload->>'provider','') not in ('revoked','pending','manual_action') then raise exception 'INVALID_INPUT'; end if;
    if p_payload->>'provider' in ('revoked','manual_action') then delete from private.integration_credentials where connection_id=c.id; end if;
    update public.integration_connections set data=jsonb_set(data,'{providerRevocation}',p_payload->'provider') where id=c.id returning * into c;
    insert into public.integration_events(connection_id,workspace_id,creator_id,event,generation,outcome) values(c.id,p_workspace,p_creator,'revoke_result',c.generation,p_payload->>'provider');
    return jsonb_build_object('connection',c.data);
  elsif p_action='purge' then
    perform private.integration_purge(p_workspace,p_creator,c.id);
    insert into public.integration_events(connection_id,workspace_id,creator_id,event,generation,outcome)
      select id,p_workspace,p_creator,'purged',generation,'complete' from public.integration_connections where id=c.id;
    return '{"state":"complete"}';
  end if;
  raise exception 'INVALID_INPUT';
end $$;
create function public.integration_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cached private.integration_commands; c public.integration_connections; run public.integration_sync_runs; sid uuid;
  fingerprint text; result jsonb; cacheable boolean; v_connection_id uuid; v_generation integer; source_ids uuid[]:='{}'; item jsonb;
begin
  if p_workspace is null or p_creator is null or p_request is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>1048576 then raise exception 'INVALID_INPUT'; end if;
  -- Serialize every operation (including secret reads and replay) with deletion,
  -- revoke, reconnect and Studio persistence. Browser JWT claims are never actors.
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status='active' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  fingerprint:=private.integration_hash(p_payload);
  if p_action='resources' and p_payload ? 'intent' then
    if private.integration_keys(p_payload->'intent',array['fileIds']) is not true
      or jsonb_typeof(p_payload->'intent'->'fileIds') is distinct from 'array' or jsonb_array_length(p_payload->'intent'->'fileIds') not between 1 and 5
      or exists(select 1 from jsonb_array_elements(p_payload->'intent'->'fileIds') v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 500)
      or (select count(distinct v) from jsonb_array_elements(p_payload->'intent'->'fileIds') v)<>jsonb_array_length(p_payload->'intent'->'fileIds') then raise exception 'INVALID_INPUT'; end if;
    fingerprint:=private.integration_hash(jsonb_build_object('action',p_action,'id',p_payload->'id','generation',p_payload->'generation','intent',p_payload->'intent'));
  end if;
  cacheable:=p_action not in ('start','consume_state','credentials','update_credentials','revocation_credentials','source_refs','export','expire','reserve_sync');
  select * into run from public.integration_sync_runs where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  if found and (p_action<>'reserve_sync' or run.payload_hash<>fingerprint) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select * into cached from private.integration_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  if found then
    if cached.action<>p_action or cached.payload_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if cached.invalidated_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
    if cached.connection_id is not null and p_action<>'purge' then
      select * into c from public.integration_connections where id=cached.connection_id and workspace_id=p_workspace and creator_id=p_creator;
      if not found or c.generation is distinct from cached.generation then raise exception 'STALE_CONNECTION'; end if;
      if p_action not in ('revoke','revoke_result','reauth') and c.status not in ('connected','partial') then raise exception 'SOURCE_UNAVAILABLE'; end if;
    end if;
    foreach sid in array cached.source_ids loop
      perform private.integration_source(p_workspace,p_creator,sid,case when p_action='permit' then p_payload->>'use' else 'read' end);
    end loop;
    if p_action='permit' and exists(select 1 from jsonb_array_elements(cached.result->'permits') p where not exists(
      select 1 from private.integration_use_permits u where u.id=(p->>'id')::uuid and u.expires_at>clock_timestamp() and u.consumed_at is null and u.revoked_at is null)) then raise exception 'SOURCE_UNAVAILABLE'; end if;
    if p_action='resources' and not private.integration_cached_resources(p_workspace,p_creator,cached.connection_id,cached.generation,cached.result->'resources') then raise exception 'SOURCE_UNAVAILABLE'; end if;
    return cached.result;
  end if;
  if p_action in ('start','consume_state','connect','credentials','update_credentials','resources','reserve_sync','finish_sync','fail_sync','reauth') then
    result:=private.integration_foundation_command(p_workspace,p_creator,p_request,p_action,p_payload);
  elsif p_action in ('source_refs','import','permit') then
    result:=private.integration_evidence_command(p_workspace,p_creator,p_request,p_action,p_payload);
  elsif p_action in ('revoke','revoke_result','revocation_credentials','purge','export','expire') then
    result:=private.integration_privacy_command(p_workspace,p_creator,p_request,p_action,p_payload);
  else raise exception 'INVALID_INPUT'; end if;
  if cacheable then
    v_connection_id:=coalesce((p_payload->>'id')::uuid,(result->'connection'->>'id')::uuid);
    if v_connection_id is not null then select conn.generation into v_generation from public.integration_connections conn where conn.id=v_connection_id; end if;
    if p_action='import' then select coalesce(array_agg((s->>'id')::uuid),'{}') into source_ids from jsonb_array_elements(result->'sources') s;
    elsif p_action='permit' then select coalesce(array_agg(s::uuid),'{}') into source_ids from jsonb_array_elements_text(p_payload->'sourceIds') s; end if;
    -- Full-payload hash detects changed credentials without persisting ciphertext,
    -- state secrets or request bodies in any result/audit cache.
    insert into private.integration_commands(workspace_id,creator_id,request_id,action,payload_hash,result,connection_id,generation,source_ids)
      values(p_workspace,p_creator,p_request,p_action,fingerprint,result,v_connection_id,v_generation,source_ids);
  end if;
  return result;
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format
    or not_null_violation or check_violation or invalid_parameter_value then raise exception 'INVALID_INPUT' using detail='',hint='';
  when foreign_key_violation then raise exception 'NOT_FOUND' using detail='',hint='';
  when unique_violation then raise exception 'IDEMPOTENCY_CONFLICT' using detail='',hint='';
end $$;
revoke all on function public.integration_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.integration_command(uuid,uuid,uuid,text,jsonb) to service_role;
-- Atomic model-result fencing. Keep the original manual/request semantics intact,
-- and never use a service-supplied sourceType as the authority for source ownership.
alter function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) set schema private;
alter function private.save_assistant_turn(uuid,uuid,uuid,text,jsonb) rename to save_assistant_turn_stage3;
revoke all on function private.save_assistant_turn_stage3(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.save_assistant_turn(p_workspace uuid,p_creator uuid,p_request uuid,p_answer text,p_citations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.assistant_requests; s public.studio_sources; permission private.integration_use_permits;
  citation jsonb; sid uuid; source_ids uuid[]:='{}'; permit_ids uuid[]:='{}'; result jsonb;
  fingerprint text:=private.integration_hash(jsonb_build_object('requestId',p_request));
begin
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status<>'deleted' for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into r from public.assistant_requests where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request for update;
  if not found or jsonb_typeof(p_citations) is distinct from 'array' then
    return private.save_assistant_turn_stage3(p_workspace,p_creator,p_request,p_answer,p_citations);
  end if;
  for citation in select value from jsonb_array_elements(p_citations) loop
    select * into s from public.studio_sources where id::text=citation->>'sourceRef' and integration is not null;
    if found then
      if s.workspace_id<>p_workspace or s.creator_id<>p_creator then raise exception 'SOURCE_UNAVAILABLE'; end if;
      if not s.id=any(source_ids) then source_ids:=array_append(source_ids,s.id); end if;
    elsif citation->>'sourceType'='integration_mock_unverified' then raise exception 'SOURCE_UNAVAILABLE';
    end if;
  end loop;
  -- A result cannot remove citations after obtaining authorization for those
  -- sources, even if the caller also removes their sourceType labels.
  for sid in select distinct u.source_id from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator and u.use_kind='model' and u.payload_hash=fingerprint loop
    if not sid=any(source_ids) then raise exception 'SOURCE_LINEAGE_REQUIRED'; end if;
  end loop;
  foreach sid in array source_ids loop
    perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and status='active';
    if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
    s:=private.integration_source(p_workspace,p_creator,sid,'model');
    if not exists(select 1 from public.studio_threads t where t.id=s.thread_id and t.conversation_id=r.conversation_id) then raise exception 'SOURCE_UNAVAILABLE'; end if;
    select u.* into permission from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=p_creator and u.source_id=s.id
      and u.snapshot_id=s.integration_snapshot_id and u.generation=(s.integration->>'generation')::integer and u.content_hash=s.integration->>'content_hash'
      and u.use_kind='model' and u.payload_hash=fingerprint and u.revoked_at is null
      and ((r.state='saved' and u.consumed_at is not null) or (r.state<>'saved' and u.consumed_at is null and u.expires_at>clock_timestamp()))
      order by u.created_at limit 1 for update;
    if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
    permit_ids:=array_append(permit_ids,permission.id);
  end loop;
  result:=private.save_assistant_turn_stage3(p_workspace,p_creator,p_request,p_answer,p_citations);
  update private.integration_use_permits set consumed_at=coalesce(consumed_at,clock_timestamp()) where id=any(permit_ids);
  return result;
end $$;
revoke all on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_assistant_turn(uuid,uuid,uuid,text,jsonb) to service_role;
alter function public.get_assistant_request(uuid,uuid) set schema private;
alter function private.get_assistant_request(uuid,uuid) rename to get_assistant_request_stage3;
revoke all on function private.get_assistant_request_stage3(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_assistant_request(p_workspace uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.assistant_requests; s public.studio_sources; sid uuid; actor uuid:=auth.uid();
begin
  perform 1 from public.creators where id=actor and workspace_id=p_workspace for update;
  if not found then return null; end if;
  select * into r from public.assistant_requests where creator_id=actor and workspace_id=p_workspace and request_id=p_request;
  for sid in select distinct u.source_id from private.integration_use_permits u where u.workspace_id=p_workspace and u.creator_id=actor
    and u.use_kind='model' and u.payload_hash=private.integration_hash(jsonb_build_object('requestId',p_request)) loop
    begin
      s:=private.integration_source(p_workspace,actor,sid,'model');
    exception when raise_exception then
      return jsonb_build_object('request_id',p_request,'conversation_id',r.conversation_id,'code','studio_context_changed','persistence','failed');
    end;
  end loop;
  return private.get_assistant_request_stage3(p_workspace,p_request);
end $$;
revoke all on function public.get_assistant_request(uuid,uuid) from public,anon;
grant execute on function public.get_assistant_request(uuid,uuid) to authenticated;
-- Run before the existing Studio cleanup so private lineage is still available.
-- The existing anonymisation/settlement functions and their bodies are unchanged.
create function private.integration_account_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.integration_connections;
begin
  if new.status='deleted' then
    for c in select * from public.integration_connections where creator_id=new.id order by id loop
      perform private.integration_purge(c.workspace_id,new.id,c.id);
    end loop;
    delete from private.integration_commands where creator_id=new.id;
    delete from private.integration_oauth_states where creator_id=new.id;
    delete from private.integration_use_permits where creator_id=new.id;
    delete from public.integration_connections where creator_id=new.id;
  end if;
  return new;
end $$;
create trigger integration_account_cleanup before update of status on public.creators for each row execute function private.integration_account_cleanup();
revoke all on function private.integration_invalidate_sources(uuid,uuid,uuid[]),private.integration_invalidate(uuid,uuid,uuid),private.integration_purge(uuid,uuid,uuid),
  private.integration_privacy_command(uuid,uuid,uuid,text,jsonb),private.integration_account_cleanup() from public,anon,authenticated,service_role;

-- SOURCE: derived-sql/20261031123000-integration_pilot_persistence.sql; sha256=765ef36d3e9f0784f4e9ddbc244fbf293629c4de485bc829997c3a925d930280
-- D0 installs no provider credentials, jobs, target settings, or network clients.
-- The existing 4A-C functions remain intact behind this service-only boundary.
create table private.integration_pilot_grants (
  grant_key text primary key, state text not null default 'active' check(state in ('active','pending','manual_action','confirmed')),
  changed_at timestamptz not null default clock_timestamp()
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_grants FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_pilot_bindings (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null, workspace_id uuid not null, creator_id uuid not null,
  generation integer not null check(generation>0), provider text not null check(provider in ('google_drive','instagram')),
  environment_id text not null, database_project_id text not null, origin text not null, provider_project_id text not null,
  subject_hash text not null check(subject_hash ~ '^[a-f0-9]{64}$'), api_version text not null,
  grant_key text not null references private.integration_pilot_grants, activated boolean not null default false,
  unique(connection_id,generation), foreign key(creator_id,workspace_id) references public.creators(id,workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_bindings FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_pilot_oauth (
  state_hash text primary key references private.integration_oauth_states(state_hash) on delete cascade,
  workspace_id uuid not null, creator_id uuid not null, secret jsonb,
  ticket_hash text unique check(ticket_hash ~ '^[a-f0-9]{64}$'), code jsonb, ticket_expires_at timestamptz, completed_at timestamptz,
  foreign key(creator_id,workspace_id) references public.creators(id,workspace_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_oauth FROM PUBLIC, anon, authenticated, service_role;

alter table private.integration_credentials add column credential_version integer not null default 1 check(credential_version>0);
create table private.integration_refresh_leases (
  connection_id uuid primary key, workspace_id uuid not null, creator_id uuid not null, generation integer not null,
  lease_id uuid not null default gen_random_uuid(), holder_id text not null, credential_version integer not null,
  expires_at timestamptz not null,
  foreign key(connection_id,workspace_id,creator_id) references public.integration_connections(id,workspace_id,creator_id) on delete cascade
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_refresh_leases FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_pilot_evidence (
  resource_id uuid not null, workspace_id uuid not null, creator_id uuid not null, generation integer not null,
  content_hash text not null, fetched_at timestamptz not null, evidence jsonb not null,
  primary key(resource_id,generation,content_hash,fetched_at),
  foreign key(resource_id) references public.integration_resources(id) on delete cascade deferrable initially deferred
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_evidence FROM PUBLIC, anon, authenticated, service_role;

-- Deliberately no FK: erasure fences must survive deletion and backup restoration.
create table private.integration_pilot_tombstones (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, creator_id uuid not null, connection_id uuid,
  through_generation integer not null check(through_generation>0), kind text not null check(kind in ('revoke','purge','account_delete')),
  created_at timestamptz not null default clock_timestamp(), unique(workspace_id,creator_id,connection_id,through_generation,kind)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_tombstones FROM PUBLIC, anon, authenticated, service_role;

create table private.integration_pilot_maintenance (
  workspace_id uuid not null, creator_id uuid not null, lease_id uuid, expires_at timestamptz,
  restore_pending boolean not null default false, primary key(workspace_id,creator_id)
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_maintenance FROM PUBLIC, anon, authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['integration_pilot_grants','integration_pilot_bindings','integration_pilot_oauth','integration_refresh_leases',
    'integration_pilot_evidence','integration_pilot_tombstones','integration_pilot_maintenance'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
create function private.integration_pilot_return_path(p_path text) returns boolean language sql immutable set search_path='' as $$
  select p_path is not null and length(p_path) between 1 and 2048 and p_path ~ '^/(connections|studio|home)([?]|$)'
    and position(chr(92) in p_path)=0 and position('%' in p_path)=0 and p_path !~ '[[:space:][:cntrl:]]';
$$;
alter table private.integration_oauth_states drop constraint integration_oauth_states_return_path_check;
alter table private.integration_oauth_states add constraint integration_oauth_states_return_path_check check(private.integration_pilot_return_path(return_path));
revoke all on function private.integration_pilot_return_path(text) from public,anon,authenticated,service_role;
create function private.integration_pilot_metadata(p_connection uuid,p_generation integer) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('sampleOnly',b.id is null,'mode',case when b.id is null then 'mock' else 'live_pilot' end,
    'acquisitionMethod',case when b.id is null then 'mock' else 'provider_api' end,'apiVersion',b.api_version,'claimVerification','unverified')
  from (select 1) seed left join private.integration_pilot_bindings b on b.connection_id=p_connection and b.generation=p_generation and b.activated;
$$;
create function private.integration_pilot_provenance() returns trigger language plpgsql set search_path='' as $$
declare meta jsonb; proof jsonb;
begin
  if tg_table_name='studio_sources' then
    if new.integration is null then return new; end if;
    select data into proof from public.integration_snapshots where id=(new.integration->>'snapshot_id')::uuid
      and workspace_id=new.workspace_id and creator_id=new.creator_id;
    if proof is null then raise exception 'NOT_FOUND'; end if;
    new.integration:=new.integration||jsonb_build_object('sample_only',coalesce(proof->'sampleOnly','true'),
      'mode',coalesce(proof->>'mode','mock'),'acquisition_method',coalesce(proof->>'acquisitionMethod','mock'),
      'api_version',proof->'apiVersion','claim_verification','unverified');
    if proof ? 'evidence' then new.integration:=new.integration||jsonb_build_object('evidence',proof->'evidence'); end if;
  else
    if tg_table_name='integration_connections' then meta:=private.integration_pilot_metadata(new.id,new.generation);
    else meta:=private.integration_pilot_metadata(new.connection_id,new.generation); end if;
    -- Revocation increments the connection generation; provenance stays that of the original grant.
    if tg_table_name='integration_connections' and tg_op='UPDATE' then
      if new.status='revoked' then
      meta:=jsonb_build_object('sampleOnly',coalesce(old.data->'sampleOnly','true'),'mode',coalesce(old.data->>'mode','mock'),
        'acquisitionMethod',coalesce(old.data->>'acquisitionMethod','mock'),'apiVersion',old.data->'apiVersion','claimVerification','unverified');
      end if;
    end if;
    new.data:=new.data||meta;
    if tg_table_name<>'integration_connections' then
      select evidence into proof from private.integration_pilot_evidence where resource_id=(new.data->>'id')::uuid
        and workspace_id=new.workspace_id and creator_id=new.creator_id and generation=new.generation and content_hash=new.data->>'contentHash'
        and fetched_at=(new.data->>'fetchedAt')::timestamptz;
      if proof is not null then new.data:=new.data||jsonb_build_object('evidence',proof); end if;
    end if;
  end if;
  return new;
end $$;
create trigger integration_pilot_connection_provenance before insert or update on public.integration_connections for each row execute function private.integration_pilot_provenance();
create trigger integration_pilot_resource_provenance before insert or update on public.integration_resources for each row execute function private.integration_pilot_provenance();
create trigger integration_pilot_snapshot_provenance before insert on public.integration_snapshots for each row execute function private.integration_pilot_provenance();
create trigger integration_pilot_source_provenance before insert on public.studio_sources for each row execute function private.integration_pilot_provenance();
create function private.integration_pilot_tombstone() returns trigger language plpgsql set search_path='' as $$
declare c public.integration_connections;
begin
  if tg_table_name='creators' then
    if new.status='deleted' and old.status is distinct from 'deleted' then
      insert into private.integration_pilot_tombstones(workspace_id,creator_id,through_generation,kind)
        values(old.workspace_id,old.id,2147483647,'account_delete');
    end if;
    return new;
  end if;
  if tg_op='DELETE' then c:=old; else c:=new; end if;
  if tg_op='DELETE' or c.status='revoked' then
    insert into private.integration_pilot_tombstones(workspace_id,creator_id,connection_id,through_generation,kind)
      values(c.workspace_id,c.creator_id,c.id,c.generation,case when tg_op='DELETE' or c.data->>'subject'='' then 'purge' else 'revoke' end)
      on conflict do nothing;
    delete from private.integration_refresh_leases where connection_id=c.id;
    update private.integration_pilot_oauth o set secret=null,code=null,completed_at=clock_timestamp()
      from private.integration_oauth_states s where s.state_hash=o.state_hash and s.workspace_id=c.workspace_id and s.creator_id=c.creator_id and s.provider=c.provider;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger integration_pilot_tombstone after update or delete on public.integration_connections for each row execute function private.integration_pilot_tombstone();
create trigger integration_pilot_account_tombstone before update of status on public.creators for each row execute function private.integration_pilot_tombstone();
-- Only the callback service can resolve the original owner, before encrypting its code.
create function public.integration_oauth_lookup(p_state_hash text,p_provider text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.integration_oauth_states;
begin
  select st.* into s from private.integration_oauth_states st join private.integration_pilot_oauth o on o.state_hash=st.state_hash
    join public.creators c on c.id=st.creator_id and c.workspace_id=st.workspace_id and c.status='active'
    where st.state_hash=p_state_hash and st.provider=p_provider and st.consumed_at is null and st.expires_at>clock_timestamp()
      and o.secret is not null and o.completed_at is null and st.expected_generation=coalesce((select generation from public.integration_connections
        where workspace_id=st.workspace_id and creator_id=st.creator_id and provider=st.provider),0);
  if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
  return jsonb_build_object('actor',jsonb_build_object('workspaceId',s.workspace_id,'creatorId',s.creator_id),
    'expectedGeneration',s.expected_generation,'returnPath',s.return_path,'expiresAt',s.expires_at);
end $$;
revoke all on function public.integration_oauth_lookup(text,text) from public,anon,authenticated;
grant execute on function public.integration_oauth_lookup(text,text) to service_role;
-- Callback service has no actor argument. The original state is the only lookup authority.
create function public.integration_oauth_callback(p_state_hash text,p_provider text,p_ticket_hash text,p_code jsonb,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.integration_oauth_states;
begin
  if coalesce(p_state_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_ticket_hash,'') !~ '^[a-f0-9]{64}$'
    or private.integration_envelope(p_code) is not true or octet_length(p_code::text)>16384
    or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '5 minutes' then raise exception 'OAUTH_STATE_INVALID'; end if;
  select * into s from private.integration_oauth_states where state_hash=p_state_hash;
  perform 1 from public.creators where id=s.creator_id and workspace_id=s.workspace_id and status='active' for update;
  if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
  update private.integration_oauth_states set consumed_at=clock_timestamp()
    where state_hash=p_state_hash and provider=p_provider and consumed_at is null and expires_at>clock_timestamp()
      and expected_generation=coalesce((select generation from public.integration_connections where workspace_id=s.workspace_id and creator_id=s.creator_id and provider=p_provider),0)
    returning * into s;
  if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
  update private.integration_pilot_oauth set ticket_hash=p_ticket_hash,code=p_code,ticket_expires_at=least(p_expires_at,s.expires_at)
    where state_hash=p_state_hash and secret is not null and ticket_hash is null and completed_at is null;
  if not found then raise exception 'OAUTH_STATE_INVALID'; end if;
  return '{"stored":true}';
end $$;
revoke all on function public.integration_oauth_callback(text,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.integration_oauth_callback(text,text,text,jsonb,timestamptz) to service_role;
-- Rename rather than rewrite the reviewed 4A-C command dispatcher and helpers.
alter function public.integration_command(uuid,uuid,uuid,text,jsonb) set schema private;
alter function private.integration_command(uuid,uuid,uuid,text,jsonb) rename to integration_command_stage4abc;
revoke all on function private.integration_command_stage4abc(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.integration_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<pilot>>
declare
  c public.integration_connections; peer public.integration_connections; b private.integration_pilot_bindings;
  o private.integration_pilot_oauth; s private.integration_oauth_states; k private.integration_credentials; lease private.integration_refresh_leases; cached private.integration_commands;
  d jsonb; v jsonb; proof jsonb; result jsonb; payload jsonb:=p_payload; clean jsonb:='[]'; grantkey text; expiry timestamptz; duration integer;
begin
  if p_workspace is null or p_creator is null or p_request is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>1048576 then raise exception 'INVALID_INPUT'; end if;
  -- Small pilot: one DB transaction advisory lock gives a deterministic order for
  -- cross-owner grant invalidation BEFORE any creator lock (Studio uses creator locks).
  perform pg_advisory_xact_lock(431230);
  perform 1 from public.creators where id=p_creator and workspace_id=p_workspace and (status='active'
    or p_action in ('tombstone_export','restore_import','restore_replay','maintenance','maintenance_acquire')) for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from private.integration_pilot_tombstones where workspace_id=p_workspace and creator_id=p_creator and kind='account_delete')
    and p_action not in ('tombstone_export','restore_import','restore_replay','maintenance','maintenance_acquire','revoke','purge','export') then raise exception 'SOURCE_UNAVAILABLE'; end if;
  if exists(select 1 from private.integration_pilot_maintenance where workspace_id=p_workspace and creator_id=p_creator and restore_pending)
    and p_action not in ('restore_replay','restore_import','tombstone_export','maintenance') then raise exception 'RESTORE_PENDING'; end if;

  if p_action='pilot_bind' then
    if coalesce(p_payload->>'provider','') not in ('google_drive','instagram') or coalesce(p_payload->>'subjectHash','') !~ '^[a-f0-9]{64}$'
      or exists(select 1 from unnest(array['environmentId','databaseProjectId','providerProjectId','apiVersion']) x
        where jsonb_typeof(p_payload->x) is distinct from 'string' or length(p_payload->>x) not between 1 and 160)
      or coalesce(p_payload->>'origin','') !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'
      or coalesce((p_payload->>'generation')::integer,0)<1 then raise exception 'INVALID_INPUT'; end if;
    select * into c from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=p_payload->>'provider';
    if coalesce(c.generation,0)+1<>(p_payload->>'generation')::integer or (c.id is not null and c.id<>(p_payload->>'id')::uuid) then raise exception 'STALE_CONNECTION'; end if;
    grantkey:=private.integration_hash(jsonb_build_array(p_payload->>'provider',p_payload->>'providerProjectId',p_payload->>'subjectHash'));
    insert into private.integration_pilot_grants(grant_key) values(grantkey) on conflict do nothing;
    if exists(select 1 from private.integration_pilot_grants where grant_key=grantkey and state in ('pending','manual_action')) then raise exception 'REVOCATION_PENDING'; end if;
    insert into private.integration_pilot_bindings(connection_id,workspace_id,creator_id,generation,provider,environment_id,database_project_id,origin,provider_project_id,subject_hash,api_version,grant_key)
      values((p_payload->>'id')::uuid,p_workspace,p_creator,(p_payload->>'generation')::integer,p_payload->>'provider',p_payload->>'environmentId',p_payload->>'databaseProjectId',p_payload->>'origin',p_payload->>'providerProjectId',p_payload->>'subjectHash',p_payload->>'apiVersion',grantkey)
      returning * into b;
    return jsonb_build_object('bindingId',b.id);
  elsif p_action='oauth_start' then
    if private.integration_envelope(p_payload->'secret') is not true or octet_length((p_payload->'secret')::text)>16384
      or jsonb_typeof(p_payload->'returnPath') is distinct from 'string' or private.integration_pilot_return_path(p_payload->>'returnPath') is not true then raise exception 'INVALID_INPUT'; end if;
    -- Preserve the old mock start validator, then store the separately validated pilot path.
    perform private.integration_command_stage4abc(p_workspace,p_creator,p_request,'start',jsonb_set(p_payload-'secret','{returnPath}','"/connections"'));
    update private.integration_oauth_states set return_path=p_payload->>'returnPath'
      where state_hash=p_payload->>'stateHash' and workspace_id=p_workspace and creator_id=p_creator;
    insert into private.integration_pilot_oauth(state_hash,workspace_id,creator_id,secret) values(p_payload->>'stateHash',p_workspace,p_creator,p_payload->'secret');
    return '{}';
  elsif p_action in ('oauth_consume','oauth_complete') then
    select * into o from private.integration_pilot_oauth where workspace_id=p_workspace and creator_id=p_creator
      and case when p_action='oauth_complete' then ticket_hash=p_payload->>'ticketHash' else state_hash=p_payload->>'stateHash' end for update;
    if not found or o.completed_at is not null or o.secret is null then raise exception 'OAUTH_STATE_INVALID'; end if;
    select * into s from private.integration_oauth_states where state_hash=o.state_hash for update;
    if s.provider is distinct from p_payload->>'provider' or s.expires_at<=clock_timestamp()
      or s.expected_generation<>coalesce((select generation from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and provider=s.provider),0)
      or (s.session_hash is distinct from p_payload->>'sessionHash' and (p_action<>'oauth_complete' or p_payload->'allowRelogin' is distinct from 'true'::jsonb))
      or (p_action='oauth_complete' and (o.code is null or o.ticket_expires_at<=clock_timestamp()))
      or (p_action='oauth_consume' and (s.consumed_at is not null or o.ticket_hash is not null)) then raise exception 'OAUTH_STATE_INVALID'; end if;
    result:=jsonb_build_object('stateHash',s.state_hash,'expectedGeneration',s.expected_generation,'returnPath',s.return_path,'secret',o.secret);
    if p_action='oauth_complete' then result:=result||jsonb_build_object('code',o.code); end if;
    update private.integration_oauth_states set consumed_at=coalesce(consumed_at,clock_timestamp()) where state_hash=s.state_hash;
    update private.integration_pilot_oauth set secret=null,code=null,completed_at=clock_timestamp() where state_hash=s.state_hash;
    return result;
  end if;

  if p_action in ('refresh_acquire','refresh_commit','refresh_abandon') then
    if p_action<>'refresh_acquire' and (jsonb_typeof(p_payload->'leaseId') is distinct from 'string'
      or coalesce(p_payload->>'leaseId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
      or jsonb_typeof(p_payload->'credentialVersion') is distinct from 'number'
      or coalesce(p_payload->>'credentialVersion','') !~ '^[1-9][0-9]*$'
      or (p_payload->>'credentialVersion')::numeric>2147483647) then raise exception 'INVALID_INPUT'; end if;
    select * into c from public.integration_connections where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if c.generation is distinct from (p_payload->>'generation')::integer or c.status='revoked' then raise exception 'STALE_CONNECTION'; end if;
    if c.status='reauth_required' then raise exception 'REAUTH_REQUIRED'; end if;
    select * into k from private.integration_credentials where connection_id=c.id and generation=c.generation and revoke_until is null;
    if not found then raise exception 'REAUTH_REQUIRED'; end if;
    select * into lease from private.integration_refresh_leases where connection_id=c.id;
    if p_action='refresh_acquire' then
      duration:=coalesce((p_payload->>'leaseSeconds')::integer,30);
      if duration not between 1 and 60 or coalesce(length(p_payload->>'holderId'),0) not between 1 and 160 then raise exception 'INVALID_INPUT'; end if;
      if lease.connection_id is not null then
        if lease.expires_at>clock_timestamp() then return '{"status":"busy"}'; end if;
        update public.integration_connections set status='reauth_required',data=data||'{"status":"reauth_required","lastError":"REAUTH_REQUIRED"}'::jsonb where id=c.id;
        delete from private.integration_credentials where connection_id=c.id;
        delete from private.integration_refresh_leases where connection_id=c.id;
        return '{"status":"reauth_required"}';
      end if;
      insert into private.integration_refresh_leases(connection_id,workspace_id,creator_id,generation,holder_id,credential_version,expires_at)
        values(c.id,p_workspace,p_creator,c.generation,p_payload->>'holderId',k.credential_version,clock_timestamp()+duration*interval '1 second') returning * into lease;
      return jsonb_build_object('status','acquired','leaseId',lease.lease_id,'credentialVersion',k.credential_version,'credential',k.credential,'expiresAt',lease.expires_at);
    end if;
    if not found then raise exception 'REFRESH_LEASE_STALE'; end if;
    if lease.lease_id is distinct from (p_payload->>'leaseId')::uuid or lease.generation is distinct from c.generation
      or lease.credential_version is distinct from (p_payload->>'credentialVersion')::integer or k.credential_version is distinct from lease.credential_version
      or (p_action='refresh_commit' and lease.expires_at<=clock_timestamp()) then raise exception 'REFRESH_LEASE_STALE'; end if;
    if p_action='refresh_abandon' then
      update public.integration_connections set status='reauth_required',data=data||'{"status":"reauth_required","lastError":"REAUTH_REQUIRED"}'::jsonb where id=c.id;
      delete from private.integration_credentials where connection_id=c.id;
      delete from private.integration_refresh_leases where connection_id=c.id;
      return '{"status":"reauth_required"}';
    end if;
    expiry:=(p_payload->>'expiresAt')::timestamptz;
    if private.integration_envelope(p_payload->'credential') is not true or octet_length((p_payload->'credential')::text)>16384
      or expiry is null or expiry<=clock_timestamp() then raise exception 'INVALID_INPUT'; end if;
    update private.integration_credentials set credential=p_payload->'credential',credential_version=k.credential_version + 1,expires_at=expiry where connection_id=c.id;
    update public.integration_connections set data=jsonb_set(data,'{expiresAt}',p_payload->'expiresAt') where id=c.id;
    delete from private.integration_refresh_leases where connection_id=c.id;
    return jsonb_build_object('credentialVersion',k.credential_version+1);
  end if;

  if p_action in ('maintenance_acquire','maintenance','tombstone_export','restore_import','restore_replay') then
    return private.integration_pilot_maintenance_command(p_workspace,p_creator,p_request,p_action,p_payload);
  end if;

  if p_action='connect' then
    d:=p_payload->'connection';
    if exists(select 1 from public.integration_connections cc join private.integration_pilot_bindings bb on bb.connection_id=cc.id and bb.activated
      and bb.generation=case when cc.status='revoked' then cc.generation-1 else cc.generation end
      join private.integration_pilot_grants gg on gg.grant_key=bb.grant_key where cc.workspace_id=p_workspace and cc.creator_id=p_creator
      and cc.provider=d->>'provider' and gg.state in ('pending','manual_action')) then raise exception 'REVOCATION_PENDING'; end if;
    if d->'sampleOnly'='false'::jsonb then
      select * into b from private.integration_pilot_bindings where id=(p_payload->>'bindingId')::uuid and connection_id=(d->>'id')::uuid
        and workspace_id=p_workspace and creator_id=p_creator and provider=d->>'provider' and generation=(d->>'generation')::integer;
      if not found then raise exception 'PILOT_BINDING_REQUIRED'; end if;
      if exists(select 1 from private.integration_pilot_grants where grant_key=b.grant_key and state in ('pending','manual_action')) then raise exception 'REVOCATION_PENDING'; end if;
      update private.integration_pilot_bindings set activated=true where id=b.id;
      update private.integration_pilot_grants set state='active',changed_at=clock_timestamp() where grant_key=b.grant_key;
    elsif exists(select 1 from private.integration_pilot_bindings where connection_id=(d->>'id')::uuid and generation=(d->>'generation')::integer and activated) then
      raise exception 'PILOT_BINDING_REQUIRED';
    end if;
    if d->>'provider'='google_drive' then
      -- Offline injected adapters also use OIDC; retaining its scope does not activate live provenance.
      d:=jsonb_set(d,'{scopes}',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(d->'scopes') x where x<>'"openid"'::jsonb));
    end if;
    d:=(d-array['mode','acquisitionMethod','apiVersion','claimVerification'])||'{"sampleOnly":true}'::jsonb;
    payload:=jsonb_set(payload-'bindingId','{connection}',d);
  elsif p_action='resources' then
    select * into b from private.integration_pilot_bindings where connection_id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator
      and generation=(p_payload->>'generation')::integer and activated;
    for v in select value from jsonb_array_elements(p_payload->'resources') loop
      if v->'sampleOnly'='false'::jsonb and b.id is null then raise exception 'PILOT_BINDING_REQUIRED'; end if;
      if b.id is not null and v->'sampleOnly' is distinct from 'false'::jsonb then raise exception 'PILOT_BINDING_REQUIRED'; end if;
      proof:=v->'evidence';
      if proof is not null then
        if private.integration_keys(proof,array['apiVersion','endpoint','measurementPeriod','selectionPeriod','permalink']) is not true
          or exists(select 1 from unnest(array['apiVersion','endpoint','measurementPeriod']) x where jsonb_typeof(proof->x) is distinct from 'string' or length(proof->>x) not between 1 and 300)
          or (proof ? 'permalink' and (jsonb_typeof(proof->'permalink')<>'string' or length(proof->>'permalink')>2000 or proof->>'permalink' !~ '^https://'))
          or (proof ? 'selectionPeriod' and (private.integration_keys(proof->'selectionPeriod',array['start','end']) is not true
            or (proof->'selectionPeriod'->>'start')::timestamptz is null or (proof->'selectionPeriod'->>'end')::timestamptz is null)) then raise exception 'INVALID_INPUT'; end if;
      end if;
      clean:=clean||jsonb_build_array((v-array['mode','acquisitionMethod','apiVersion','claimVerification','evidence'])||'{"sampleOnly":true}'::jsonb);
    end loop;
    payload:=jsonb_set(payload,'{resources}',clean);
    -- The legacy dispatcher validates cached intent, current generation and source
    -- availability before replay. A provider reread must not mutate that state first.
    if exists(select 1 from private.integration_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request) then
      return private.integration_command_stage4abc(p_workspace,p_creator,p_request,p_action,payload);
    end if;
    for v in select value from jsonb_array_elements(p_payload->'resources') loop
      proof:=v->'evidence';
      if proof is not null then
        insert into private.integration_pilot_evidence(resource_id,workspace_id,creator_id,generation,content_hash,fetched_at,evidence)
          values((v->>'id')::uuid,p_workspace,p_creator,(p_payload->>'generation')::integer,v->>'contentHash',(v->>'fetchedAt')::timestamptz,proof) on conflict do nothing;
        if not exists(select 1 from private.integration_pilot_evidence where resource_id=(v->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator
          and generation=(p_payload->>'generation')::integer and content_hash=v->>'contentHash' and fetched_at=(v->>'fetchedAt')::timestamptz and evidence=proof) then raise exception 'SOURCE_CHANGED'; end if;
        -- Observation metadata can evolve without changing the provider content hash.
        -- Detach only the current pointer so the original dispatcher appends a snapshot;
        -- historical snapshots and imported source evidence remain immutable.
        update public.integration_resources r set snapshot_id=null where r.id=(v->>'id')::uuid and r.workspace_id=p_workspace and r.creator_id=p_creator
          and r.connection_id=(p_payload->>'id')::uuid and r.generation=(p_payload->>'generation')::integer
          and exists(select 1 from public.integration_snapshots snap where snap.id=r.snapshot_id
            and ((snap.data->>'fetchedAt')::timestamptz is distinct from (v->>'fetchedAt')::timestamptz or snap.data->'evidence' is distinct from proof));
      end if;
    end loop;
  elsif p_action='update_credentials' then
    if exists(select 1 from private.integration_pilot_bindings where connection_id=(p_payload->>'id')::uuid and generation=(p_payload->>'generation')::integer and activated)
      or exists(select 1 from private.integration_refresh_leases where connection_id=(p_payload->>'id')::uuid) then raise exception 'REFRESH_LEASE_REQUIRED'; end if;
  end if;

  if p_action in ('revoke','purge','revoke_result') then
    select * into c from public.integration_connections where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator;
    if not found then raise exception 'NOT_FOUND'; end if;
    select * into b from private.integration_pilot_bindings where connection_id=c.id and activated
      and generation=case when c.status='revoked' then c.generation-1 else c.generation end;
    if b.id is not null and c.provider='google_drive' then
      select * into cached from private.integration_commands where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
      if found then
        if cached.action<>p_action or cached.payload_hash<>private.integration_hash(p_payload) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
        if cached.invalidated_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
        if p_action<>'purge' and c.generation is distinct from cached.generation then raise exception 'STALE_CONNECTION'; end if;
        return cached.result;
      end if;
      if p_action<>'purge' and c.generation is distinct from (p_payload->>'generation')::integer then raise exception 'STALE_CONNECTION'; end if;
      -- Cleanup/retry of an already revoked grant cannot revoke a peer's later authorization.
      if c.status='revoked' and p_action in ('purge','revoke') then
        return private.integration_command_stage4abc(p_workspace,p_creator,p_request,p_action,p_payload);
      end if;
      if p_action='revoke_result' then
        if c.status<>'revoked' then raise exception 'STALE_CONNECTION'; end if;
        if coalesce(p_payload->>'provider','') not in ('revoked','pending','manual_action') then raise exception 'INVALID_INPUT'; end if;
        if c.data->>'providerRevocation'='revoked' then return jsonb_build_object('connection',c.data); end if;
      end if;
      -- Never disclose peer IDs, owner names, scopes, credentials or connection count.
      for peer in select distinct cc.* from public.integration_connections cc join private.integration_pilot_bindings bb on bb.connection_id=cc.id
        and bb.generation=case when cc.status='revoked' then cc.generation-1 else cc.generation end and bb.activated
        where bb.grant_key=b.grant_key order by cc.workspace_id,cc.creator_id,cc.id loop
        perform 1 from public.creators where id=peer.creator_id and workspace_id=peer.workspace_id for update;
        if p_action in ('revoke','purge') and peer.status<>'revoked' then
          perform private.integration_privacy_command(peer.workspace_id,peer.creator_id,gen_random_uuid(),'revoke',jsonb_build_object('id',peer.id,'generation',peer.generation));
        elsif p_action='revoke_result' and peer.status='revoked' then
          perform private.integration_privacy_command(peer.workspace_id,peer.creator_id,gen_random_uuid(),'revoke_result',jsonb_build_object('id',peer.id,'generation',peer.generation,'provider',p_payload->>'provider'));
        end if;
      end loop;
      update private.integration_pilot_grants set state=case when p_action='revoke_result' then case p_payload->>'provider' when 'revoked' then 'confirmed' when 'pending' then 'pending' else 'manual_action' end
        when state='confirmed' and c.status='revoked' then state else 'pending' end,changed_at=clock_timestamp() where grant_key=b.grant_key;
      if p_action='purge' then perform private.integration_purge(p_workspace,p_creator,c.id); result:='{"state":"complete"}';
      else select jsonb_build_object('connection',data) into result from public.integration_connections where id=c.id; end if;
      insert into private.integration_commands(workspace_id,creator_id,request_id,action,payload_hash,result,connection_id,generation)
        select p_workspace,p_creator,p_request,p_action,private.integration_hash(p_payload),pilot.result,c.id,generation from public.integration_connections where id=c.id;
      return result;
    end if;
  end if;

  result:=private.integration_command_stage4abc(p_workspace,p_creator,p_request,p_action,payload);
  if p_action='connect' then
    delete from private.integration_refresh_leases where connection_id=(result->'connection'->>'id')::uuid;
    if p_payload->'connection'->>'provider'='google_drive' and p_payload->'connection'->'scopes' ? 'openid' then
      update public.integration_connections set data=jsonb_set(data,'{scopes}',p_payload->'connection'->'scopes') where id=(result->'connection'->>'id')::uuid returning data into d;
      result:=jsonb_build_object('connection',d);
    end if;
  elsif p_action='resources' then
    select jsonb_build_object('resources',coalesce(jsonb_agg(r.data order by x.ord),'[]')) into result
      from jsonb_array_elements(result->'resources') with ordinality x(value,ord) join public.integration_resources r on r.id=(x.value->>'id')::uuid;
  end if;
  if p_action in ('resources','connect') then
    update private.integration_commands set result=pilot.result where workspace_id=p_workspace and creator_id=p_creator and request_id=p_request;
  end if;
  return result;
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format
    or not_null_violation or check_violation or invalid_parameter_value then raise exception 'INVALID_INPUT' using detail='',hint='';
  when foreign_key_violation then raise exception 'NOT_FOUND' using detail='',hint='';
  when unique_violation then raise exception 'IDEMPOTENCY_CONFLICT' using detail='',hint='';
end $$;
revoke all on function public.integration_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.integration_command(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function private.integration_pilot_metadata(uuid,integer),private.integration_pilot_provenance(),private.integration_pilot_tombstone() from public,anon,authenticated,service_role;
create function private.integration_pilot_restore_candidates(p_workspace uuid,p_creator uuid)
returns setof public.integration_connections language sql stable set search_path='' as $$
  select c.* from public.integration_connections c where c.workspace_id=p_workspace and c.creator_id=p_creator and exists(
    select 1 from private.integration_pilot_tombstones t where t.workspace_id=p_workspace and t.creator_id=p_creator
      and (t.kind='account_delete' or (t.connection_id=c.id and c.generation<=t.through_generation))
      and (c.status<>'revoked' or (t.kind in ('purge','account_delete') and (
        exists(select 1 from public.integration_resources where connection_id=c.id)
        or exists(select 1 from private.integration_credentials where connection_id=c.id))))) order by c.id;
$$;
create function private.integration_pilot_maintenance_command(p_workspace uuid,p_creator uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  m private.integration_pilot_maintenance; c public.integration_connections; t private.integration_pilot_tombstones;
  n integer:=coalesce((p_payload->>'batchSize')::integer,50); duration integer; dry boolean:=coalesce((p_payload->>'dryRun')::boolean,true);
  stamp timestamptz:=clock_timestamp(); snaps uuid[]; creds uuid[]; states text[]; permits uuid[]; events uuid[];
  v jsonb; output jsonb:='[]'; counts jsonb; more boolean; replayed integer:=0;
begin
  if n not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
  select * into m from private.integration_pilot_maintenance where workspace_id=p_workspace and creator_id=p_creator for update;
  if p_action='maintenance_acquire' then
    duration:=coalesce((p_payload->>'leaseSeconds')::integer,30);
    if duration not between 1 and 60 then raise exception 'INVALID_INPUT'; end if;
    if m.expires_at>clock_timestamp() then return '{"status":"busy"}'; end if;
    insert into private.integration_pilot_maintenance(workspace_id,creator_id,lease_id,expires_at) values(p_workspace,p_creator,gen_random_uuid(),clock_timestamp()+duration*interval '1 second')
      on conflict(workspace_id,creator_id) do update set lease_id=excluded.lease_id,expires_at=excluded.expires_at returning * into m;
    return jsonb_build_object('status','acquired','leaseId',m.lease_id,'expiresAt',m.expires_at);
  elsif p_action='tombstone_export' then
    n:=coalesce((p_payload->>'limit')::integer,100);
    if n not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
    for t in select * from private.integration_pilot_tombstones where workspace_id=p_workspace and creator_id=p_creator
      and (p_payload->>'after' is null or id>(p_payload->>'after')::uuid) order by id limit n loop
      output:=output||jsonb_build_array(jsonb_build_object('id',t.id,'workspaceId',t.workspace_id,'creatorId',t.creator_id,
        'connectionId',t.connection_id,'throughGeneration',t.through_generation,'kind',t.kind,'createdAt',t.created_at));
    end loop;
    return jsonb_build_object('tombstones',output,'nextCursor',case when jsonb_array_length(output)=n then output->-1->>'id' else null end);
  elsif p_action='restore_import' then
    if jsonb_typeof(p_payload->'tombstones') is distinct from 'array' or jsonb_array_length(p_payload->'tombstones') not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
    for v in select value from jsonb_array_elements(p_payload->'tombstones') loop
      if private.integration_keys(v,array['id','workspaceId','creatorId','connectionId','throughGeneration','kind','createdAt']) is not true then raise exception 'INVALID_INPUT'; end if;
      if (v->>'workspaceId')::uuid is distinct from p_workspace or (v->>'creatorId')::uuid is distinct from p_creator then raise exception 'NOT_FOUND'; end if;
      if v->>'kind'<>'account_delete' and v->>'connectionId' is null then raise exception 'INVALID_INPUT'; end if;
      insert into private.integration_pilot_tombstones(id,workspace_id,creator_id,connection_id,through_generation,kind,created_at)
        values((v->>'id')::uuid,p_workspace,p_creator,(v->>'connectionId')::uuid,(v->>'throughGeneration')::integer,v->>'kind',(v->>'createdAt')::timestamptz) on conflict do nothing;
      if not exists(select 1 from private.integration_pilot_tombstones where id=(v->>'id')::uuid and workspace_id=p_workspace and creator_id=p_creator
        and connection_id is not distinct from (v->>'connectionId')::uuid and through_generation=(v->>'throughGeneration')::integer and kind=v->>'kind') then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    end loop;
    insert into private.integration_pilot_maintenance(workspace_id,creator_id,restore_pending) values(p_workspace,p_creator,true)
      on conflict(workspace_id,creator_id) do update set restore_pending=true;
    return jsonb_build_object('imported',jsonb_array_length(p_payload->'tombstones'),'restorePending',true);
  elsif p_action='restore_replay' then
    for c in select * from private.integration_pilot_restore_candidates(p_workspace,p_creator) limit n loop
      if exists(select 1 from private.integration_pilot_tombstones where workspace_id=p_workspace and creator_id=p_creator
        and (kind='account_delete' or (connection_id=c.id and through_generation>=c.generation and kind='purge'))) then
        perform private.integration_purge(p_workspace,p_creator,c.id);
      else
        perform private.integration_privacy_command(p_workspace,p_creator,p_request,'revoke',jsonb_build_object('id',c.id,'generation',c.generation));
      end if;
      replayed:=replayed+1;
    end loop;
    more:=exists(select 1 from private.integration_pilot_restore_candidates(p_workspace,p_creator));
    update private.integration_pilot_maintenance set restore_pending=more where workspace_id=p_workspace and creator_id=p_creator;
    return jsonb_build_object('replayed',replayed,'complete',not more);
  elsif p_action<>'maintenance' then raise exception 'INVALID_INPUT'; end if;

  if not dry and (m.lease_id is null or m.lease_id is distinct from (p_payload->>'leaseId')::uuid or m.expires_at<=clock_timestamp()) then raise exception 'MAINTENANCE_LEASE_REQUIRED'; end if;
  select coalesce(array_agg(id),'{}') into snaps from (select id from public.integration_snapshots snap where workspace_id=p_workspace and creator_id=p_creator
    and expires_at<=stamp and not exists(select 1 from public.studio_sources s where s.integration_snapshot_id=snap.id) order by expires_at,id limit n+1) q;
  select coalesce(array_agg(connection_id),'{}') into creds from (select connection_id from private.integration_credentials where workspace_id=p_workspace and creator_id=p_creator
    and revoke_until<=stamp order by revoke_until,connection_id limit n+1) q;
  select coalesce(array_agg(state_hash),'{}') into states from (select state_hash from private.integration_oauth_states where workspace_id=p_workspace and creator_id=p_creator
    and expires_at<=stamp order by expires_at,state_hash limit n+1) q;
  select coalesce(array_agg(id),'{}') into permits from (select id from private.integration_use_permits where workspace_id=p_workspace and creator_id=p_creator
    and expires_at<=stamp and consumed_at is null and use_kind<>'model' order by expires_at,id limit n+1) q;
  select coalesce(array_agg(id),'{}') into events from (select id from public.integration_events where workspace_id=p_workspace and creator_id=p_creator
    and created_at<stamp-interval '90 days' order by created_at,id limit n+1) q;
  more:=greatest(cardinality(snaps),cardinality(creds),cardinality(states),cardinality(permits),cardinality(events))>n;
  snaps:=snaps[1:n]; creds:=creds[1:n]; states:=states[1:n]; permits:=permits[1:n]; events:=events[1:n];
  counts:=jsonb_build_object('snapshots',cardinality(snaps),'credentials',cardinality(creds),'states',cardinality(states),'permits',cardinality(permits),'events',cardinality(events));
  if not dry then
    update public.integration_resources set snapshot_id=null,data=data||'{"snapshotId":null,"excerpt":null,"metrics":{},"availability":"stale"}'::jsonb where snapshot_id=any(snaps);
    update private.integration_commands cmd set result='{}',invalidated_at=stamp where cmd.workspace_id=p_workspace and cmd.creator_id=p_creator and cmd.action='resources'
      and exists(select 1 from jsonb_array_elements(cmd.result->'resources') r where (r->>'snapshotId')::uuid=any(snaps));
    update public.integration_sync_runs run set result=null,status='unknown' where run.workspace_id=p_workspace and run.creator_id=p_creator
      and exists(select 1 from jsonb_array_elements(run.result->'resources') r where (r->>'snapshotId')::uuid=any(snaps));
    delete from public.integration_snapshots where id=any(snaps);
    update public.integration_connections set data=jsonb_set(data,'{providerRevocation}','"manual_action"') where id=any(creds) and status='revoked' and data->>'providerRevocation'='pending';
    update private.integration_pilot_grants set state='manual_action',changed_at=stamp where state='pending' and grant_key in
      (select grant_key from private.integration_pilot_bindings where connection_id=any(creds) and activated);
    delete from private.integration_credentials where connection_id=any(creds);
    delete from private.integration_oauth_states where state_hash=any(states);
    delete from private.integration_use_permits where id=any(permits);
    delete from public.integration_events where id=any(events);
  end if;
  return jsonb_build_object('dryRun',dry,'counts',counts,'hasMore',more,
    'pendingRevocations',(select count(*) from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and data->>'providerRevocation'='pending'),
    'manualAction',(select count(*) from public.integration_connections where workspace_id=p_workspace and creator_id=p_creator and data->>'providerRevocation'='manual_action'));
end $$;
revoke all on function private.integration_pilot_restore_candidates(uuid,uuid),private.integration_pilot_maintenance_command(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
-- Verified mapping is injected by the server verifier. This function never accepts
-- an app-scoped user_id and never equates it with the raw provider subject.
create table private.integration_pilot_notices (
  receipt_hash text primary key check(receipt_hash ~ '^[a-f0-9]{64}$'),
  provider_project_id text not null, subject_hash text not null check(subject_hash ~ '^[a-f0-9]{64}$'),
  kind text not null check(kind in ('deauthorization','deletion')),
  confirmation_code text not null unique default replace(gen_random_uuid()::text,'-',''),
  status text not null default 'pending' check(status in ('pending','completed')),
  created_at timestamptz not null default clock_timestamp()
);
-- Shared-target overlay: discard inherited broad grants on this NEW table only.
REVOKE ALL ON TABLE private.integration_pilot_notices FROM PUBLIC, anon, authenticated, service_role;

alter table private.integration_pilot_notices enable row level security;
revoke all on private.integration_pilot_notices from public,anon,authenticated,service_role;
alter table private.integration_pilot_bindings add column notice_invalidated_at timestamptz;
create function private.integration_notice_binding_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.activated and new.notice_invalidated_at is not null then raise exception 'SOURCE_UNAVAILABLE'; end if;
  return new;
end $$;
create trigger integration_notice_binding_guard before update of activated on private.integration_pilot_bindings
  for each row execute function private.integration_notice_binding_guard();
revoke all on function private.integration_notice_binding_guard() from public,anon,authenticated,service_role;
create function public.integration_provider_notice(p_provider_project_id text,p_subject_hash text,p_receipt_hash text,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  receipt private.integration_pilot_notices; affected record; c public.integration_connections;
  stamp timestamptz:=clock_timestamp(); remaining boolean:=false;
begin
  if p_provider_project_id is null or length(p_provider_project_id) not between 1 and 160
    or p_provider_project_id<>trim(p_provider_project_id) or p_provider_project_id ~ '[[:cntrl:]]'
    or coalesce(p_subject_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_receipt_hash,'') !~ '^[a-f0-9]{64}$'
    or coalesce(p_kind,'') not in ('deauthorization','deletion') then raise exception 'INVALID_INPUT'; end if;
  -- Same lock order as all pilot connect/refresh/management commands. The receipt
  -- and every affected owner mutation commit or roll back together.
  perform pg_advisory_xact_lock(431230);
  select * into receipt from private.integration_pilot_notices where receipt_hash=p_receipt_hash for update;
  if found then
    if receipt.provider_project_id<>p_provider_project_id or receipt.subject_hash<>p_subject_hash or receipt.kind<>p_kind then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('confirmationCode',receipt.confirmation_code,'status',receipt.status);
  end if;
  insert into private.integration_pilot_notices(receipt_hash,provider_project_id,subject_hash,kind)
    values(p_receipt_hash,p_provider_project_id,p_subject_hash,p_kind) returning * into receipt;

  for affected in select distinct b.workspace_id,b.creator_id from private.integration_pilot_bindings b
    where b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash
    order by b.workspace_id,b.creator_id loop
    perform 1 from public.creators where workspace_id=affected.workspace_id and id=affected.creator_id for update;
    -- Source invalidation is lineage-scoped, including retained historical sources.
    -- It uses the unchanged creator-lock/redaction/permit fence from Stage 4A-C.
    perform private.integration_invalidate_sources(affected.workspace_id,affected.creator_id,array(
      select s.id from public.studio_sources s join private.integration_pilot_bindings b
        on b.connection_id=s.integration_connection_id and b.generation=(s.integration->>'generation')::integer
        and b.workspace_id=s.workspace_id and b.creator_id=s.creator_id
      where b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash
        and s.workspace_id=affected.workspace_id and s.creator_id=affected.creator_id and s.revoked_at is null));
    -- A historical binding must not cancel a different current account's OAuth.
    -- Current/revoked-current or prepared future bindings do fence unfinished work.
    if exists(select 1 from private.integration_pilot_bindings b left join public.integration_connections cc
      on cc.id=b.connection_id and cc.provider='instagram' and cc.workspace_id=b.workspace_id and cc.creator_id=b.creator_id
      where b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash
        and b.workspace_id=affected.workspace_id and b.creator_id=affected.creator_id
        and b.generation>=coalesce(case when cc.status='revoked' then cc.generation-1 else cc.generation end,0)) then
      update private.integration_oauth_states set consumed_at=coalesce(consumed_at,stamp)
        where workspace_id=affected.workspace_id and creator_id=affected.creator_id and provider='instagram';
      update private.integration_pilot_oauth o set secret=null,code=null,completed_at=coalesce(completed_at,stamp)
        from private.integration_oauth_states s where s.state_hash=o.state_hash and s.workspace_id=affected.workspace_id
          and s.creator_id=affected.creator_id and s.provider='instagram';
    end if;
  end loop;
  -- Keep provenance intact; prohibit any later activation using a prepared binding.
  update private.integration_pilot_bindings set notice_invalidated_at=coalesce(notice_invalidated_at,stamp)
    where provider='instagram' and provider_project_id=p_provider_project_id and subject_hash=p_subject_hash;

  for c in select cc.* from public.integration_connections cc where cc.provider='instagram' and exists(
    select 1 from private.integration_pilot_bindings b where b.connection_id=cc.id and b.workspace_id=cc.workspace_id and b.creator_id=cc.creator_id
      and b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash and b.activated
      and b.generation=case when cc.status='revoked' then cc.generation-1 else cc.generation end)
    order by cc.workspace_id,cc.creator_id,cc.id for update loop
    if c.status<>'revoked' then
      perform private.integration_privacy_command(c.workspace_id,c.creator_id,gen_random_uuid(),'revoke',jsonb_build_object('id',c.id,'generation',c.generation));
      select * into c from public.integration_connections where id=c.id;
    end if;
    if p_kind='deauthorization' then
      -- The verified notice attests deauthorization; no provider HTTP call occurs.
      perform private.integration_privacy_command(c.workspace_id,c.creator_id,gen_random_uuid(),'revoke_result',jsonb_build_object('id',c.id,'generation',c.generation,'provider','revoked'));
    else
      -- completed refers to local erasure. A deletion request alone is not a
      -- claim that a separate remote token revocation request succeeded.
      if exists(select 1 from public.integration_snapshots snap where snap.connection_id=c.id and not exists(
        select 1 from private.integration_pilot_bindings b where b.connection_id=c.id and b.generation=snap.generation
          and b.workspace_id=c.workspace_id and b.creator_id=c.creator_id and b.provider='instagram'
          and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash))
        or exists(select 1 from public.integration_resources r where r.connection_id=c.id and not exists(
        select 1 from private.integration_pilot_bindings b where b.connection_id=c.id and b.generation=r.generation
          and b.workspace_id=c.workspace_id and b.creator_id=c.creator_id and b.provider='instagram'
          and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash)) then
        -- Whole-connection purge would erase unrelated account history. Quarantine
        -- matching uses and erase its credential now; keep deletion visibly pending.
        perform private.integration_privacy_command(c.workspace_id,c.creator_id,gen_random_uuid(),'revoke_result',jsonb_build_object('id',c.id,'generation',c.generation,'provider','manual_action'));
        remaining:=true;
      else perform private.integration_purge(c.workspace_id,c.creator_id,c.id); end if;
    end if;
  end loop;
  if p_kind='deletion' then
    -- Do not purge a newer, differently mapped account that reused a connection ID.
    -- Historical lineage needing narrower erasure is explicit pending work.
    remaining:=remaining or exists(select 1 from public.integration_snapshots snap join private.integration_pilot_bindings b
      on b.connection_id=snap.connection_id and b.workspace_id=snap.workspace_id and b.creator_id=snap.creator_id and b.generation=snap.generation
      where b.provider='instagram' and b.provider_project_id=p_provider_project_id and b.subject_hash=p_subject_hash);
  end if;
  update private.integration_pilot_notices set status=case when remaining then 'pending' else 'completed' end
    where receipt_hash=p_receipt_hash returning * into receipt;
  return jsonb_build_object('confirmationCode',receipt.confirmation_code,'status',receipt.status);
end $$;
revoke all on function public.integration_provider_notice(text,text,text,text) from public,anon,authenticated;
grant execute on function public.integration_provider_notice(text,text,text,text) to service_role;

-- SOURCE: 12-baseline-acl.sql; sha256=2e63e019443f9b38baba6336dbf79b89fd7002c973480809ad4f07bf0219a53d
-- PREPARATION ONLY. No database execution has been performed by this sidecar.
-- Bounded reconciliation of the 39 observed EXISTING public tables.
-- ORDER: apply AFTER the complete 62-source forward envelope and the parent-owned
-- apply_mission repair, BEFORE fixture exercises, inside the parent transaction.
-- The numeric filename is not execution order. Parent owns BEGIN / ROLLBACK.
-- No new tables, service_role grants, functions, schemas, policies, memberships,
-- owners or default privileges are changed. No application function is invoked.
-- Metadata inputs: observed-catalog.json + observed-privileges.json.
-- observed-privileges.json raw SHA256:
-- 735e22c4efd546e7b8a2fdc7aa1a7d9a2d54eac0a17a390beea208b43ae8ed1a
-- A single DO statement makes an assertion failure atomic even if mis-submitted.
-- RESTRICT is deliberate: dependent grants must be reviewed, never cascaded.

DO $baseline_acl$
DECLARE
  v_tables constant text[] := ARRAY[
    'academy_content',
    'assistant_conversations',
    'assistant_messages',
    'brand_invites',
    'brand_users',
    'campaign_missions',
    'campaign_participants',
    'campaign_rank_snapshots',
    'campaigns',
    'content_categories',
    'content_item_tags',
    'content_items',
    'content_tags',
    'creator_portfolio_links',
    'creator_public_passports',
    'creator_public_profile_snapshots',
    'creator_review_notes',
    'creator_review_statuses',
    'creator_social_accounts',
    'creator_social_scan_snapshots',
    'creators',
    'earnings_balances',
    'earnings_transactions',
    'kb_chunks',
    'kb_documents',
    'mission_shortlists',
    'mission_submissions',
    'missions',
    'notifications',
    'operator_audit_events',
    'point_balances',
    'point_transactions',
    'redemption_codes',
    'redemption_gifts',
    'redemptions',
    'staff_users',
    'workspace_budget_transactions',
    'workspace_budgets',
    'workspaces'
  ]::text[];
  v_no_read constant text[] := ARRAY[
    'brand_invites',
    'campaign_rank_snapshots',
    'creator_review_notes',
    'creator_review_statuses',
    'mission_shortlists',
    'operator_audit_events',
    'redemption_codes',
    'staff_users'
  ]::text[];
  v_creator_update constant text[] := ARRAY['display_name', 'avatar_url', 'categories', 'social_handles', 'onboarding_step', 'phone', 'level_seen']::text[];
  v_social_insert constant text[] := ARRAY['creator_id', 'workspace_id', 'platform', 'handle', 'profile_url']::text[];
  v_social_update constant text[] := ARRAY['handle', 'profile_url']::text[];
  v_mission_update constant text[] := ARRAY['slug', 'title', 'description', 'category', 'mission_type', 'access_type', 'required_level', 'points_reward', 'cash_reward', 'cpm_rate', 'cpm_budget_pool', 'deadline', 'quota', 'deliverables', 'requirements', 'platforms', 'effort', 'target_audience', 'dos', 'donts', 'key_messages', 'reference_links', 'updated_at']::text[];
  v_table_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_table text;
  v_role text;
  v_privilege text;
  v_signature text;
  v_relation oid;
  v_function oid;
  v_columns text;
  v_column record;
  v_expected boolean;
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    v_table_privileges := array_append(v_table_privileges, 'MAINTAIN');
  END IF;

  -- Placement sentinels are not a substitute for the parent manifest/hash check.
  IF to_regclass('private.integration_pilot_notices') IS NULL
     OR to_regclass('public.studio_sources') IS NULL THEN
    RAISE EXCEPTION 'baseline_acl_requires_complete_forward_envelope';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      RAISE EXCEPTION 'baseline_acl_role_missing:%', v_role;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'baseline_acl_browser_role_bypasses_rls';
  END IF;
  FOREACH v_table IN ARRAY v_tables LOOP
    v_relation := to_regclass(format('public.%I', v_table));
    IF v_relation IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid = v_relation AND c.relkind IN ('r','p')
        AND c.relrowsecurity AND c.relowner = current_user::regrole
    ) THEN
      RAISE EXCEPTION 'baseline_acl_owner_or_rls_drift:%', v_table;
    END IF;
    FOREACH v_privilege IN ARRAY v_table_privileges LOOP
      IF NOT has_table_privilege('service_role', v_relation, v_privilege) THEN
        RAISE EXCEPTION 'baseline_acl_existing_service_grant_missing:%.%', v_table, v_privilege;
      END IF;
    END LOOP;
  END LOOP;

  -- Preserve the source private-schema boundary and retained helper access.
  IF has_schema_privilege('anon', 'private', 'USAGE')
     OR has_schema_privilege('authenticated', 'private', 'USAGE')
     OR NOT has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'baseline_acl_private_schema_boundary_drift';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'private.current_workspace_id()',
    'private.creator_is_trusted(uuid)',
    'private.mission_brand_update_allowed(uuid,text,integer,numeric,numeric,numeric)',
    'private.can_read_academy_track(uuid)'
  ]::text[] LOOP
    v_function := to_regprocedure(v_signature);
    IF v_function IS NULL OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'baseline_acl_rls_helper_execute_missing:%', v_signature;
    END IF;
  END LOOP;
  FOREACH v_signature IN ARRAY ARRAY[
    'private.uuid_lock_key(uuid)',
    'private.is_valid_public_http_url(text)',
    'private.is_valid_public_profile_highlights(jsonb)',
    'private.enforce_creator_portfolio_highlight_limit()',
    'private.touch_creator_profile_media_updated_at()'
  ]::text[] LOOP
    v_function := to_regprocedure(v_signature);
    IF v_function IS NULL OR NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'baseline_acl_service_helper_execute_missing:%', v_signature;
    END IF;
  END LOOP;

  -- Table REVOKE alone does not remove independently held column privileges.
  -- Enumerate only columns of the fixed 39-table allowlist; never scan app rows.
  FOREACH v_table IN ARRAY v_tables LOOP
    v_relation := to_regclass(format('public.%I', v_table));
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated RESTRICT', v_table);
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO v_columns FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = v_relation AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_columns IS NULL THEN
      RAISE EXCEPTION 'baseline_acl_columns_missing:%', v_table;
    END IF;
    EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated RESTRICT', v_columns, v_table);
  END LOOP;

  -- RLS continues to decide which rows these authenticated SELECTs can expose.
  GRANT SELECT ON TABLE
    public.academy_content,
    public.assistant_conversations,
    public.assistant_messages,
    public.brand_users,
    public.campaign_missions,
    public.campaign_participants,
    public.campaigns,
    public.content_categories,
    public.content_item_tags,
    public.content_items,
    public.content_tags,
    public.creator_portfolio_links,
    public.creator_public_passports,
    public.creator_public_profile_snapshots,
    public.creator_social_accounts,
    public.creator_social_scan_snapshots,
    public.creators,
    public.earnings_balances,
    public.earnings_transactions,
    public.kb_chunks,
    public.kb_documents,
    public.mission_submissions,
    public.missions,
    public.notifications,
    public.point_balances,
    public.point_transactions,
    public.redemption_gifts,
    public.redemptions,
    public.workspace_budget_transactions,
    public.workspace_budgets,
    public.workspaces
    TO authenticated;

  -- Original profile/onboarding fields and notification acknowledgement only.
  GRANT UPDATE (display_name, avatar_url, categories, social_handles, onboarding_step, phone, level_seen)
    ON TABLE public.creators TO authenticated;
  GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;

  -- Preserve original social account connect/edit/delete and passport revoke.
  GRANT INSERT (creator_id, workspace_id, platform, handle, profile_url)
    ON TABLE public.creator_social_accounts TO authenticated;
  GRANT UPDATE (handle, profile_url)
    ON TABLE public.creator_social_accounts TO authenticated;
  GRANT DELETE ON TABLE public.creator_social_accounts, public.creator_public_passports TO authenticated;

  -- Original portfolio CRUD retained. Known routes use service_role; direct
  -- legacy highlight writes still need caller review (see acl-review.md).
  GRANT INSERT, UPDATE, DELETE ON TABLE public.creator_portfolio_links TO authenticated;

  -- Brand PUT uses the user JWT. Lifecycle and server-owned fields stay denied.
  GRANT UPDATE (
    slug, title, description, category, mission_type, access_type, required_level,
    points_reward, cash_reward, cpm_rate, cpm_budget_pool, deadline, quota,
    deliverables, requirements, platforms, effort,
    target_audience, dos, donts, key_messages, reference_links, updated_at
  ) ON TABLE public.missions TO authenticated;

  -- Assert effective privileges, including PUBLIC and inherited role grants.
  -- Check each privilege separately: comma-separated has_* checks mean ANY.
  FOREACH v_table IN ARRAY v_tables LOOP
    v_relation := to_regclass(format('public.%I', v_table));
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH v_privilege IN ARRAY v_table_privileges LOOP
        v_expected := v_role = 'authenticated' AND CASE v_privilege
          WHEN 'SELECT' THEN NOT (v_table = ANY (v_no_read))
          WHEN 'INSERT' THEN v_table = 'creator_portfolio_links'
          WHEN 'UPDATE' THEN v_table = 'creator_portfolio_links'
          WHEN 'DELETE' THEN v_table IN ('creator_portfolio_links','creator_social_accounts','creator_public_passports')
          ELSE false END;
        IF has_table_privilege(v_role, v_relation, v_privilege) IS DISTINCT FROM v_expected
           OR has_table_privilege(v_role, v_relation, v_privilege || ' WITH GRANT OPTION') THEN
          RAISE EXCEPTION 'baseline_acl_table_mismatch:%.%.%', v_role, v_table, v_privilege;
        END IF;
      END LOOP;
      FOR v_column IN
        SELECT a.attnum, a.attname FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = v_relation AND a.attnum > 0 AND NOT a.attisdropped
      LOOP
        FOREACH v_privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
          v_expected := v_role = 'authenticated' AND CASE v_privilege
            WHEN 'SELECT' THEN NOT (v_table = ANY (v_no_read))
            WHEN 'INSERT' THEN v_table = 'creator_portfolio_links'
              OR (v_table = 'creator_social_accounts' AND v_column.attname = ANY (v_social_insert))
            WHEN 'UPDATE' THEN v_table = 'creator_portfolio_links'
              OR (v_table = 'creators' AND v_column.attname = ANY (v_creator_update))
              OR (v_table = 'creator_social_accounts' AND v_column.attname = ANY (v_social_update))
              OR (v_table = 'notifications' AND v_column.attname = 'read_at')
              OR (v_table = 'missions' AND v_column.attname = ANY (v_mission_update))
            ELSE false END;
          IF has_column_privilege(v_role, v_relation, v_column.attnum, v_privilege) IS DISTINCT FROM v_expected
             OR has_column_privilege(v_role, v_relation, v_column.attnum, v_privilege || ' WITH GRANT OPTION') THEN
            RAISE EXCEPTION 'baseline_acl_column_mismatch:%.%.%.%', v_role, v_table, v_column.attname, v_privilege;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
    FOREACH v_privilege IN ARRAY v_table_privileges LOOP
      IF NOT has_table_privilege('service_role', v_relation, v_privilege) THEN
        RAISE EXCEPTION 'baseline_acl_service_grant_lost:%.%', v_table, v_privilege;
      END IF;
    END LOOP;
  END LOOP;
END;
$baseline_acl$;

-- SOURCE: 13-portfolio-compatibility.sql; sha256=8b5955b9fe05e8b07e5769f7d7ba715b3bb740648cc6a9f6d7fe061ea1e674c2
-- Prepared compatibility overlay, not applied. Same owner/ACL/invoker/search_path.
-- Inline the EXACT captured immutable UUID lock expression at its two call sites.
-- No private-schema grant or SECURITY DEFINER elevation; lock keys/count limit unchanged.
DO $portfolio_guard$ BEGIN
 IF md5(pg_get_functiondef('private.enforce_creator_portfolio_highlight_limit()'::regprocedure)) IS DISTINCT FROM '827e2456773e83de6d118f8fe5352365'
 OR md5(pg_get_functiondef('private.uuid_lock_key(uuid)'::regprocedure)) IS DISTINCT FROM '9f5fb256f4eb14f1df4fe850acf3866c'
 THEN RAISE EXCEPTION 'PORTFOLIO_COMPAT_SOURCE_DRIFT_STOP'; END IF;
END $portfolio_guard$;
CREATE OR REPLACE FUNCTION private.enforce_creator_portfolio_highlight_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if new.public_highlight then
    perform pg_advisory_xact_lock(
      (((get_byte(uuid_send(new.workspace_id), 0)::int << 24)
      | (get_byte(uuid_send(new.workspace_id), 1)::int << 16)
      | (get_byte(uuid_send(new.workspace_id), 2)::int << 8)
      | get_byte(uuid_send(new.workspace_id), 3)::int)
    # ((get_byte(uuid_send(new.workspace_id), 4)::int << 24)
      | (get_byte(uuid_send(new.workspace_id), 5)::int << 16)
      | (get_byte(uuid_send(new.workspace_id), 6)::int << 8)
      | get_byte(uuid_send(new.workspace_id), 7)::int)
    # ((get_byte(uuid_send(new.workspace_id), 8)::int << 24)
      | (get_byte(uuid_send(new.workspace_id), 9)::int << 16)
      | (get_byte(uuid_send(new.workspace_id), 10)::int << 8)
      | get_byte(uuid_send(new.workspace_id), 11)::int)
    # ((get_byte(uuid_send(new.workspace_id), 12)::int << 24)
      | (get_byte(uuid_send(new.workspace_id), 13)::int << 16)
      | (get_byte(uuid_send(new.workspace_id), 14)::int << 8)
      | get_byte(uuid_send(new.workspace_id), 15)::int)),
      (((get_byte(uuid_send(new.creator_id), 0)::int << 24)
      | (get_byte(uuid_send(new.creator_id), 1)::int << 16)
      | (get_byte(uuid_send(new.creator_id), 2)::int << 8)
      | get_byte(uuid_send(new.creator_id), 3)::int)
    # ((get_byte(uuid_send(new.creator_id), 4)::int << 24)
      | (get_byte(uuid_send(new.creator_id), 5)::int << 16)
      | (get_byte(uuid_send(new.creator_id), 6)::int << 8)
      | get_byte(uuid_send(new.creator_id), 7)::int)
    # ((get_byte(uuid_send(new.creator_id), 8)::int << 24)
      | (get_byte(uuid_send(new.creator_id), 9)::int << 16)
      | (get_byte(uuid_send(new.creator_id), 10)::int << 8)
      | get_byte(uuid_send(new.creator_id), 11)::int)
    # ((get_byte(uuid_send(new.creator_id), 12)::int << 24)
      | (get_byte(uuid_send(new.creator_id), 13)::int << 16)
      | (get_byte(uuid_send(new.creator_id), 14)::int << 8)
      | get_byte(uuid_send(new.creator_id), 15)::int))
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
$function$;

-- SOURCE: 20-postconditions.sql; sha256=5f8ebc08cecac020b66dc81029eb9fdd2a45e1caf3aec224e073d4c69c948182
-- Transaction-local checks only; they do not replace real Auth/JWT or browser acceptance.
DO $postconditions$
DECLARE relation_name text; rows_present boolean;
BEGIN
 FOREACH relation_name IN ARRAY ARRAY['public.mission_deliverable_templates','public.mission_deliverable_requirements','public.mission_workflows','public.mission_work_items','public.mission_working_drafts','public.mission_draft_versions','public.mission_draft_assets','public.mission_review_rounds','public.mission_review_items','public.mission_revision_grants','public.mission_fulfillments','public.mission_workflow_events','private.mission_workflow_notification_dedupe','private.mission_draft_submission_idempotency','public.mission_publication_instructions','public.mission_publication_proof_attempts','public.mission_publication_proof_assets','public.mission_publication_proof_reviews','public.mission_publication_proof_review_items','public.mission_reward_contracts','public.mission_completion_decisions','public.mission_pending_rewards','public.legacy_evidence_corrections','public.operator_crm_command_receipts','public.assistant_requests','public.academy_lessons','public.creator_lesson_progress','public.staff_workspace_roles','public.staff_platform_roles','public.staff_access_audit','public.staff_access_commands','public.creator_consents','public.studio_threads','public.studio_sources','public.studio_briefs','public.studio_shares','public.studio_commands','public.studio_badges','public.integration_connections','public.integration_resources','public.integration_snapshots','public.integration_events','public.integration_sync_runs','private.integration_credentials','private.integration_oauth_states','private.integration_commands','private.integration_use_permits','private.integration_pilot_grants','private.integration_pilot_bindings','private.integration_pilot_oauth','private.integration_refresh_leases','private.integration_pilot_evidence','private.integration_pilot_tombstones','private.integration_pilot_maintenance','private.integration_pilot_notices'] LOOP
   IF to_regclass(relation_name) IS NULL THEN RAISE EXCEPTION 'EXPECTED_RELATION_MISSING: %',relation_name; END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s)',relation_name::regclass) INTO rows_present;
   IF rows_present THEN RAISE EXCEPTION 'SCHEMA_PREPARATION_CREATED_APPLICATION_ROWS: %',relation_name; END IF;
   IF relation_name LIKE 'public.%' AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid=relation_name::regclass) THEN
     RAISE EXCEPTION 'NEW_PUBLIC_TABLE_REQUIRES_RLS: %',relation_name;
   END IF;
 END LOOP;
 IF (SELECT count(*) FROM storage.buckets WHERE id IN ('mission-draft-assets','mission-publication-proof-assets') AND public=false AND file_size_limit=20971520)<>2 THEN
   RAISE EXCEPTION 'PRIVATE_ASSET_BUCKET_CONTRACT_FAILED';
 END IF;
 IF has_table_privilege('anon','public.studio_sources','SELECT')
   OR has_table_privilege('authenticated','public.studio_sources','INSERT')
   OR has_table_privilege('authenticated','public.integration_connections','UPDATE')
   OR has_table_privilege('authenticated','private.integration_credentials','SELECT')
   OR has_table_privilege('service_role','private.integration_credentials','SELECT')
 THEN RAISE EXCEPTION 'PRIVATE_OR_INTEGRATION_DIRECT_ACCESS_FAILED'; END IF;
END
$postconditions$;
-- END REVIEWED PAYLOAD
-- No history rows are inserted or repaired. No rollout/settlement/pilot RPC is invoked.
ROLLBACK;
