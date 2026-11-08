-- OFFLINE REVIEW ARTIFACT. No live or persistent execution is authorized.
-- Whole-growth rollback for 20261103215321_kocmax_creator_growth_private.sql
-- SHA256 bfe4fab81bb23198a2f57c804a521b03b83c2a41815acc86f8966ac49b2d0e43
-- First stop growth/publication routes, uploaders and cleanup workers. Preserve
-- backups and unresolved publication/consumption evidence, then complete the
-- separate publication rollback. This script cannot resolve unknown outcomes.
-- Execute as the migration object owner only after separate target approval.
-- One DO statement is atomic in autocommit and can also run inside a caller's
-- transaction/savepoint without committing it. Errors undo every change here.
-- Locks protect the bucket/cleanup checks from database writes until completion;
-- they do not fence external Storage uploads. Native restore remains unverified.
do $creator_growth_rollback$
declare
  previous_lock_timeout text := pg_catalog.current_setting('lock_timeout');
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  -- Fixed object list, owner tables first; fail on missing/drifted prerequisites.
  lock table public.creators, public.integration_connections,
    private.creator_growth_assets,
    private.creator_growth_media_sources,
    private.creator_growth_consents,
    private.creator_growth_analyses,
    private.creator_growth_skill_invocations,
    private.creator_growth_skill_sources,
    private.creator_growth_drafts,
    private.creator_growth_events,
    private.creator_growth_storage_cleanup,
    private.creator_growth_commands,
    private.creator_growth_route_commands,
    storage.buckets, storage.objects
    in access exclusive mode;

  -- Conservative refusal also covers a partially removed publication install.
  -- Catalog discovery is used only to refuse, never to construct a DROP command.
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private')
      and pg_catalog.left(c.relname::text,16)='creator_publish_'
  ) or exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private')
      and pg_catalog.left(p.proname::text,16)='creator_publish_'
  ) or exists (
    select 1 from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private')
      and pg_catalog.left(t.tgname::text,16)='creator_publish_'
  ) then
    raise exception 'CREATOR_GROWTH_ROLLBACK_PUBLICATION_DEPENDENCIES';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id='creator-growth-private' and name='creator-growth-private'
      and public=false and file_size_limit=8388608
      and allowed_mime_types=array['image/jpeg','image/png','image/webp']
  ) then
    raise exception 'CREATOR_GROWTH_ROLLBACK_BUCKET_CONFLICT';
  end if;
  if exists (select 1 from storage.objects where bucket_id='creator-growth-private') then
    raise exception 'CREATOR_GROWTH_ROLLBACK_BUCKET_NOT_EMPTY';
  end if;
  -- Exhausted attempts still need physical cleanup; a label alone is not proof.
  if exists (
    select 1 from private.creator_growth_storage_cleanup
    where state<>'completed' or completed_at is null
  ) then
    raise exception 'CREATOR_GROWTH_ROLLBACK_CLEANUP_PENDING';
  end if;

  drop trigger creator_growth_account_cleanup on public.creators;
  drop trigger creator_growth_integration_revocation on public.integration_connections;
  drop trigger creator_growth_asset_delete_cleanup on private.creator_growth_assets;

  -- Public wrappers and maintenance RPCs before their command/private helpers.
  drop function public.creator_growth_reserve_asset(uuid,uuid,uuid,jsonb);
  drop function public.creator_growth_confirm_asset(uuid,uuid,uuid,uuid);
  drop function public.creator_growth_abandon_asset(uuid,uuid,uuid,uuid);
  drop function public.creator_growth_get_asset(uuid,uuid,uuid,uuid);
  drop function public.creator_growth_save_media_source(uuid,uuid,uuid,jsonb);
  drop function public.creator_growth_save_consent(uuid,uuid,uuid,jsonb);
  drop function public.creator_growth_save_analysis(uuid,uuid,uuid,jsonb);
  drop function public.creator_growth_save_skill_invocation(uuid,uuid,uuid,jsonb);
  drop function public.creator_growth_save_draft(uuid,uuid,uuid,jsonb);
  drop function public.creator_growth_get_draft(uuid,uuid,uuid,uuid);
  drop function public.creator_growth_set_draft_status(uuid,uuid,uuid,uuid,jsonb);
  drop function public.creator_growth_record_event(uuid,uuid,uuid,jsonb);
  drop function public.creator_growth_apply_retention(uuid,uuid,uuid,timestamptz);
  drop function public.creator_growth_purge_owner(uuid,uuid,uuid);
  drop function public.creator_growth_export_owner(uuid,uuid,uuid);
  drop function public.creator_growth_list_cleanup(uuid,uuid,uuid);
  drop function public.creator_growth_claim_cleanup(uuid,uuid,uuid,uuid,timestamptz,integer,integer);
  drop function public.creator_growth_finish_cleanup(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz);
  drop function public.creator_growth_route_command(uuid,uuid,uuid,jsonb,jsonb);
  drop function public.creator_growth_command(uuid,uuid,uuid,text,jsonb);

  drop function private.creator_growth_account_cleanup();
  drop function private.creator_growth_integration_revocation();
  drop function private.creator_growth_queue_deleted_asset();
  drop function private.creator_growth_purge_private(uuid,uuid);
  drop function private.creator_growth_invalidate_generation(uuid,uuid,uuid,integer,timestamptz);
  drop function private.creator_growth_validate_skill_report(uuid,uuid,uuid,uuid,uuid,jsonb);
  drop function private.creator_growth_report_has_citation(jsonb,text,text);
  drop function private.creator_growth_replay(uuid,uuid,text,uuid,jsonb);
  drop function private.creator_growth_queue_cleanup(uuid,uuid,private.creator_growth_assets,text,timestamptz);
  drop function private.creator_growth_assert_owner(uuid,uuid);
  drop function private.creator_growth_assert_non_deleted(uuid,uuid);
  -- Composite-typed helpers must disappear before their backing tables.
  drop function private.creator_growth_asset_json(private.creator_growth_assets);
  drop function private.creator_growth_source_json(private.creator_growth_media_sources);
  drop function private.creator_growth_consent_json(private.creator_growth_consents);
  drop function private.creator_growth_analysis_json(private.creator_growth_analyses);
  drop function private.creator_growth_skill_json(private.creator_growth_skill_invocations);
  drop function private.creator_growth_draft_json(private.creator_growth_drafts);
  drop function private.creator_growth_event_json(private.creator_growth_events);
  drop function private.creator_growth_cleanup_json(private.creator_growth_storage_cleanup);

  -- Children before parents; default RESTRICT rejects any unexpected dependency.
  -- Owned indexes, constraints and composite types disappear with these tables.
  drop table private.creator_growth_route_commands;
  drop table private.creator_growth_commands;
  drop table private.creator_growth_events;
  drop table private.creator_growth_drafts;
  drop table private.creator_growth_skill_sources;
  drop table private.creator_growth_skill_invocations;
  drop table private.creator_growth_analyses;
  drop table private.creator_growth_media_sources;
  drop table private.creator_growth_consents;
  drop table private.creator_growth_assets;
  drop table private.creator_growth_storage_cleanup;

  -- Always retain the empty bucket: the forward migration can reuse pre-existing
  -- metadata, and this generic rollback cannot prove who created it. Any separate
  -- exact removal needs verified pre-migration provenance and explicit approval.
  -- There is intentionally no bucket-deletion option in this artifact.
  perform pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
end
$creator_growth_rollback$;
