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
