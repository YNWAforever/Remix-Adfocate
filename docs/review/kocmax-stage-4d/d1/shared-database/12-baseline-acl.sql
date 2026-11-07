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
