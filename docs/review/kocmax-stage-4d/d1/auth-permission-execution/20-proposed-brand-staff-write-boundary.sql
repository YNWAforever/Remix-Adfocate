-- REVIEW CANDIDATE ONLY. Not applied to the shared database.
-- Apply only after separate approval and verified project/schema preflight.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('public.staff_workspace_roles') IS NULL
    OR to_regclass('public.brand_users') IS NULL
    OR to_regclass('public.staff_users') IS NULL
    OR to_regclass('public.missions') IS NULL
  THEN RAISE EXCEPTION 'STAFF_BRAND_FOUNDATION_REQUIRED'; END IF;
  IF to_regprocedure('private.brand_staff_mission_write_allowed(uuid)') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy
      WHERE polrelid='public.missions'::regclass
        AND polname IN ('missions_staff_insert_boundary','missions_staff_update_boundary','missions_staff_delete_boundary')
    )
  THEN RAISE EXCEPTION 'STAFF_BRAND_BOUNDARY_ALREADY_EXISTS_REVIEW_DRIFT'; END IF;
END
$preflight$;

-- Staff membership also provides brand access. Never let a revoked or limited
-- staff identity fall back to the broader brand-only authoring permission.
CREATE FUNCTION private.brand_staff_mission_write_allowed(p_workspace uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.brand_users b
      WHERE b.user_id=(SELECT auth.uid())
        AND b.workspace_id=p_workspace AND b.active
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.staff_users s
        WHERE s.user_id=(SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.staff_users s
        JOIN public.staff_workspace_roles r ON r.user_id=s.user_id
        WHERE s.user_id=(SELECT auth.uid()) AND s.active
          AND r.workspace_id=p_workspace AND r.active AND r.role='workspace_admin'
      )
    )
$function$;
REVOKE ALL ON FUNCTION private.brand_staff_mission_write_allowed(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.brand_staff_mission_write_allowed(uuid)
  TO authenticated;

-- Restrictive policies intersect with the existing brand policies and retain
-- their workspace, owner-delete, column-grant and live-reward protections.
CREATE POLICY missions_staff_insert_boundary ON public.missions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (private.brand_staff_mission_write_allowed(workspace_id));
CREATE POLICY missions_staff_update_boundary ON public.missions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (private.brand_staff_mission_write_allowed(workspace_id))
  WITH CHECK (private.brand_staff_mission_write_allowed(workspace_id));
CREATE POLICY missions_staff_delete_boundary ON public.missions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (private.brand_staff_mission_write_allowed(workspace_id));

DO $postflight$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_policy
      WHERE polrelid='public.missions'::regclass AND NOT polpermissive
        AND polname IN ('missions_staff_insert_boundary','missions_staff_update_boundary','missions_staff_delete_boundary'))<>3
    OR has_function_privilege('anon','private.brand_staff_mission_write_allowed(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','private.brand_staff_mission_write_allowed(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'STAFF_BRAND_BOUNDARY_POSTCONDITION_FAILED'; END IF;
END
$postflight$;
COMMIT;
