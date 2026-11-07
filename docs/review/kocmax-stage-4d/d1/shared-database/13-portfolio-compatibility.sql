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
