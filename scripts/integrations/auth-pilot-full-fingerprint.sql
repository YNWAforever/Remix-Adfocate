-- Opaque preservation check. Exclusions must be exact IDs owned by this pilot.
BEGIN READ ONLY;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $fingerprint$
DECLARE
  item record;
  n bigint;
  row_hash text;
  inventory jsonb := '[]'::jsonb;
  total_rows bigint := 0;
  excluded text := coalesce(nullif(current_setting('kocmax.auth_pilot_exclude_pattern',true),''),
    '5f694251-c6eb-4f5f-a281-25e91db81c04');
BEGIN
  IF excluded !~ '^[0-9a-f|()-]+$' THEN RAISE EXCEPTION 'INVALID_EXACT_OWNED_ID_PATTERN'; END IF;
  FOR item IN
    SELECT ns.nspname AS schema_name, cls.relname AS table_name
    FROM pg_catalog.pg_class cls
    JOIN pg_catalog.pg_namespace ns ON ns.oid=cls.relnamespace
    WHERE ns.nspname IN ('public','private','auth','storage') AND cls.relkind IN ('r','p')
    ORDER BY ns.nspname COLLATE "C", cls.relname COLLATE "C"
  LOOP
    EXECUTE format(
      'SELECT count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), '','' ORDER BY to_jsonb(r)::text COLLATE "C"), '''')) FROM %I.%I r WHERE to_jsonb(r)::text !~ $1',
      item.schema_name, item.table_name
    ) INTO n, row_hash USING excluded;
    total_rows := total_rows+n;
    inventory := inventory || jsonb_build_array(jsonb_build_object(
      'schema',item.schema_name,'table',item.table_name,'rows',n,'hash',row_hash
    ));
  END LOOP;
  PERFORM set_config('kocmax.auth_pilot_full_fingerprint', jsonb_build_object(
    'table_count',jsonb_array_length(inventory),'row_count',total_rows,
    'data_digest',md5(inventory::text)
  )::text, true);
END
$fingerprint$;
SELECT current_setting('kocmax.auth_pilot_full_fingerprint')::jsonb AS non_pilot_data;
ROLLBACK;
