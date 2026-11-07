-- REVIEW CANDIDATE ONLY. Not applied to the shared database.
-- The application verifies Auth and the workspace allowlist before this call.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('public.creators') IS NULL
    OR to_regclass('public.point_balances') IS NULL
    OR to_regclass('public.earnings_balances') IS NULL
  THEN RAISE EXCEPTION 'BOOTSTRAP_FOUNDATION_REQUIRED'; END IF;
  IF to_regprocedure('public.bootstrap_creator_account(uuid,uuid,text,text,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'ATOMIC_BOOTSTRAP_ALREADY_EXISTS_REVIEW_DRIFT'; END IF;
END
$preflight$;

CREATE FUNCTION public.bootstrap_creator_account(
  p_creator uuid, p_workspace uuid, p_display_name text, p_phone text, p_ref text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_referred_by uuid;
  v_inserted uuid;
  v_workspace uuid;
  v_status text;
BEGIN
  IF p_creator IS NULL OR p_workspace IS NULL OR nullif(p_display_name,'') IS NULL
  THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='bootstrap_invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id=p_workspace)
  THEN RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='no_workspace'; END IF;
  IF p_ref IS NOT NULL THEN
    SELECT id INTO v_referred_by FROM public.creators
    WHERE referral_code=p_ref AND id<>p_creator;
  END IF;
  INSERT INTO public.creators(id,workspace_id,display_name,phone,referred_by)
    VALUES(p_creator,p_workspace,p_display_name,p_phone,v_referred_by)
    ON CONFLICT(id) DO NOTHING
    RETURNING id INTO v_inserted;
  -- Same row lock as account anonymisation. Balance writes and this lock share
  -- one transaction; competing first-login inserts resolve before this read.
  SELECT workspace_id,status INTO v_workspace,v_status
    FROM public.creators WHERE id=p_creator FOR UPDATE;
  IF v_status='deleted'
  THEN RAISE EXCEPTION USING ERRCODE='PT401', MESSAGE='account_deleted'; END IF;
  IF v_workspace IS DISTINCT FROM p_workspace
  THEN RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='no_workspace'; END IF;
  INSERT INTO public.point_balances(creator_id,workspace_id,balance)
    VALUES(p_creator,p_workspace,0)
    ON CONFLICT(creator_id,workspace_id) DO NOTHING;
  INSERT INTO public.earnings_balances(creator_id,workspace_id,available)
    VALUES(p_creator,p_workspace,0)
    ON CONFLICT(creator_id,workspace_id) DO NOTHING;
  RETURN jsonb_build_object('created',v_inserted IS NOT NULL);
END
$function$;
REVOKE ALL ON FUNCTION public.bootstrap_creator_account(uuid,uuid,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_creator_account(uuid,uuid,text,text,text)
  TO service_role;

DO $postflight$
BEGIN
  IF has_function_privilege('anon','public.bootstrap_creator_account(uuid,uuid,text,text,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.bootstrap_creator_account(uuid,uuid,text,text,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.bootstrap_creator_account(uuid,uuid,text,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'ATOMIC_BOOTSTRAP_ACL_FAILED'; END IF;
END
$postflight$;
COMMIT;
