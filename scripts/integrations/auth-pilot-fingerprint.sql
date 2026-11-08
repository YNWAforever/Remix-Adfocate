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
BEGIN
  FOR item IN
    SELECT ns.nspname AS schema_name, cls.relname AS table_name
    FROM pg_catalog.pg_class cls
    JOIN pg_catalog.pg_namespace ns ON ns.oid=cls.relnamespace
    WHERE ns.nspname IN ('public','private') AND cls.relkind IN ('r','p')
    ORDER BY ns.nspname COLLATE "C", cls.relname COLLATE "C"
  LOOP
    EXECUTE format(
      'SELECT count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), '','' ORDER BY to_jsonb(r)::text COLLATE "C"), '''')) FROM %I.%I r',
      item.schema_name, item.table_name
    ) INTO n, row_hash;
    total_rows := total_rows+n;
    inventory := inventory || jsonb_build_array(jsonb_build_object(
      'schema',item.schema_name,'table',item.table_name,'rows',n,'hash',row_hash
    ));
  END LOOP;
  PERFORM set_config('kocmax.auth_pilot_fingerprint', jsonb_build_object(
    'table_count',jsonb_array_length(inventory),'row_count',total_rows,
    'data_digest',md5(inventory::text)
  )::text, true);
END
$fingerprint$;
SELECT current_setting('kocmax.auth_pilot_fingerprint')::jsonb AS application_data,
  (SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS migration_count,
  (SELECT count(*)::int FROM pg_catalog.pg_policies WHERE schemaname IN ('public','private')) AS policy_count,
  (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname='auth') AS auth_table_count,
  (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname='storage') AS storage_table_count;
ROLLBACK;
