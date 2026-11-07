-- Offline restored-backup table inventory; emits counts and opaque row hashes only.
BEGIN READ ONLY;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $inventory$
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
    WHERE ns.nspname IN ('public','private','auth','storage') AND cls.relkind IN ('r','p')
    ORDER BY ns.nspname COLLATE "C", cls.relname COLLATE "C"
  LOOP
    EXECUTE format(
      'SELECT count(*), md5(coalesce(string_agg(md5(to_jsonb(r)::text), '','' ORDER BY to_jsonb(r)::text COLLATE "C"), '''')) FROM %I.%I r',
      item.schema_name, item.table_name
    ) INTO n, row_hash;
    total_rows := total_rows + n;
    inventory := inventory || jsonb_build_array(jsonb_build_object(
      'schema',item.schema_name,'table',item.table_name,'rows',n,'hash',row_hash
    ));
  END LOOP;
  PERFORM set_config('kocmax.baseline_table_inventory',jsonb_build_object(
    'table_count',jsonb_array_length(inventory),'row_count',total_rows,
    'data_digest',md5(inventory::text),'inventory',inventory
  )::text,true);
END
$inventory$;
SELECT current_setting('kocmax.baseline_table_inventory')::jsonb AS baseline_data;
ROLLBACK;
