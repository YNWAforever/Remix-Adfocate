-- Single read-only catalog query for an operator-controlled driver.
-- First BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='15s';
-- Bind $1 to the confirmed project reference. Always ROLLBACK afterwards.
-- No rows containing archived statements, creator content, identities, or credentials are exported.
with relations as (
  select c.oid, n.nspname as schema_name, c.relname as relation_name, c.relkind, c.relrowsecurity
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and c.relname ~ '^[a-z_][a-z0-9_]*$'
), objects as (
  select 'table:' || schema_name || '.' || relation_name as object_name
    from relations where relkind in ('r', 'p')
  union
  select 'rls:' || schema_name || '.' || relation_name
    from relations where relkind in ('r', 'p') and relrowsecurity
  union
  select 'column:' || r.schema_name || '.' || r.relation_name || '.' || a.attname
    from relations r join pg_catalog.pg_attribute a on a.attrelid = r.oid
    where a.attnum > 0 and not a.attisdropped and r.relkind in ('r', 'p')
      and a.attname ~ '^[a-z_][a-z0-9_]*$'
  union
  select 'constraint:' || r.schema_name || '.' || r.relation_name || '.' || c.conname
    from relations r join pg_catalog.pg_constraint c on c.conrelid = r.oid
    where c.conname ~ '^[a-z_][a-z0-9_]*$'
  union
  select 'index:' || r.schema_name || '.' || r.relation_name || '.' || c.relname
    from relations r join pg_catalog.pg_index i on i.indrelid = r.oid
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    where c.relname ~ '^[a-z_][a-z0-9_]*$'
  union
  select 'policy:' || r.schema_name || '.' || r.relation_name || '.' || p.polname
    from relations r join pg_catalog.pg_policy p on p.polrelid = r.oid
    where p.polname ~ '^[a-z_][a-z0-9_]*$'
  union
  select 'trigger:' || r.schema_name || '.' || r.relation_name || '.' || t.tgname
    from relations r join pg_catalog.pg_trigger t on t.tgrelid = r.oid
    where not t.tgisinternal and t.tgname ~ '^[a-z_][a-z0-9_]*$'
  union
  select 'function:' || n.nspname || '.' || p.proname
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
      and p.proname ~ '^[a-z_][a-z0-9_]*$'
  union
  select 'type:' || n.nspname || '.' || t.typname
    from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname in ('public', 'private') and t.typname ~ '^[a-z_][a-z0-9_]*$'
), history as (
  select version,
    case when name ~ '^[a-z0-9][a-z0-9_]{0,159}$' then name else null end as name,
    coalesce(cardinality(statements), 0) as statement_count,
    case when statements is null then null
      else encode(sha256(convert_to(array_to_string(statements, E'\n'), 'UTF8')), 'hex')
    end as statements_sha256
  from supabase_migrations.schema_migrations
)
select jsonb_build_object(
  'schemaVersion', 1,
  'targetProjectRef', $1::text,
  'observedAt', to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'transactionReadOnly', current_setting('transaction_read_only') = 'on',
  'history', coalesce((select jsonb_agg(jsonb_build_object(
    'version', version, 'name', name,
    'statementCount', statement_count, 'statementsSha256', statements_sha256
  ) order by version) from history), '[]'::jsonb),
  'catalogObjects', coalesce((select jsonb_agg(object_name order by object_name) from objects), '[]'::jsonb)
) as snapshot;
