-- Read-only operations inside the CONTROLLER-OWNED repeatable-read transaction.
-- Do not wrap this collector in its own BEGIN/COMMIT: the same transaction may
-- execute the exact approved DDL between before/after captures. It must not be
-- replaced by an exported pg_dump (which cannot see uncommitted own DDL).
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL row_security = off;
DO $delta_invariant_capture$
DECLARE
  catalog_hashes text[] := '{}'; data_hashes text[] := '{}'; unsupported jsonb := '[]';
  cat record; relation record; row_count bigint; digest text; expression_sql text; filter_sql text; source_catalog text; source_oid oid;
  catalog_count integer := 0; table_count integer := 0; history_count integer;
  history_hash text; history_tuple_hash text; targets jsonb; delta_history jsonb; transaction_id text;
  alias_oid_types oid[]:=ARRAY['regproc'::regtype,'regprocedure'::regtype,'regoper'::regtype,'regoperator'::regtype,'regclass'::regtype,'regtype'::regtype,'regnamespace'::regtype,'regrole'::regtype,'regcollation'::regtype];
  known_catalogs text[] := ARRAY[
    'pg_aggregate','pg_am','pg_amop','pg_amproc','pg_attrdef','pg_attribute','pg_auth_members','pg_authid','pg_cast','pg_class',
    'pg_collation','pg_constraint','pg_conversion','pg_database','pg_db_role_setting','pg_default_acl','pg_depend','pg_description',
    'pg_enum','pg_event_trigger','pg_extension','pg_foreign_data_wrapper','pg_foreign_server','pg_foreign_table','pg_index','pg_inherits',
    'pg_init_privs','pg_language','pg_largeobject','pg_largeobject_metadata','pg_namespace','pg_opclass','pg_operator','pg_opfamily',
    'pg_parameter_acl','pg_partitioned_table','pg_policy','pg_proc','pg_publication','pg_publication_namespace','pg_publication_rel',
    'pg_range','pg_replication_origin','pg_rewrite','pg_seclabel','pg_sequence','pg_shdepend','pg_shdescription','pg_shseclabel',
    'pg_statistic','pg_statistic_ext','pg_statistic_ext_data','pg_subscription','pg_subscription_rel','pg_tablespace','pg_transform',
    'pg_trigger','pg_ts_config','pg_ts_config_map','pg_ts_dict','pg_ts_parser','pg_ts_template','pg_type','pg_user_mapping'];
BEGIN
  IF current_setting('transaction_isolation') <> 'repeatable read' OR current_database() <> 'postgres'
    OR current_setting('server_version_num')::int / 10000 <> 17 THEN RAISE EXCEPTION 'DELTA_INVARIANT_CONTEXT'; END IF;
  transaction_id:=pg_current_xact_id()::text;
  FOR cat IN SELECT c.relname,c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='pg_catalog' AND c.relkind='r' ORDER BY c.relname COLLATE "C"
  LOOP
    BEGIN
      IF NOT cat.relname=ANY(known_catalogs) THEN
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM pg_catalog.%I)',cat.relname) INTO expression_sql;
        IF expression_sql::boolean THEN RAISE EXCEPTION 'DELTA_UNKNOWN_NONEMPTY_CATALOG'; END IF;
        CONTINUE;
      END IF;
      -- Physical statistics can change without semantic writes. Definitions of
      -- extended statistics remain covered by pg_statistic_ext itself.
      IF cat.relname IN ('pg_statistic','pg_statistic_ext_data') THEN CONTINUE; END IF;
      IF cat.relname IN ('pg_subscription','pg_subscription_rel','pg_user_mapping') THEN
        -- Subscription/user-mapping rows may contain credentials and require a
        -- separately reviewed safe renderer. Nonempty is HOLD, never omitted.
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM pg_catalog.%I)',cat.relname) INTO expression_sql;
        IF expression_sql::boolean THEN RAISE EXCEPTION 'DELTA_UNSUPPORTED_SENSITIVE_CATALOG'; END IF;
        catalog_hashes:=array_append(catalog_hashes,cat.relname||':'||encode(sha256(convert_to('[]','UTF8')),'hex'));
        catalog_count:=catalog_count+1; CONTINUE;
      END IF;
      -- A typed row's text preserves array bounds and JSON text/duplicate keys;
      -- to_jsonb(row) would silently erase those observable distinctions.
      -- Roles use the non-secret pg_roles projection, never pg_authid verifiers.
      source_catalog:=CASE WHEN cat.relname='pg_authid' THEN 'pg_roles' ELSE cat.relname END;
      source_oid:=to_regclass(format('pg_catalog.%I',source_catalog));
      SELECT 'ROW('||string_agg(CASE
        WHEN cat.relname='pg_authid' AND a.attname='rolpassword' THEN 'NULL'
        WHEN cat.relname='pg_class' AND a.attname IN ('relpages','reltuples','relallvisible','relfrozenxid','relminmxid') THEN 'NULL'
        WHEN cat.relname='pg_database' AND a.attname IN ('datfrozenxid','datminmxid') THEN 'NULL'
        WHEN cat.relname='pg_proc' AND a.attname='prosrc' THEN 'CASE WHEN t.oid IN (to_regprocedure(''private.join_mission(uuid)''),to_regprocedure(''public.accept_application(uuid)'')) THEN NULL ELSE t.prosrc END'
        WHEN a.atttypid=ANY(alias_oid_types) THEN format('t.%I::oid',a.attname)
        WHEN ty.typelem=ANY(alias_oid_types) THEN format('t.%I::oid[]',a.attname)
        ELSE format('t.%I',a.attname) END,',' ORDER BY a.attnum)||')::text'
        INTO expression_sql FROM pg_attribute a JOIN pg_type ty ON ty.oid=a.atttypid WHERE a.attrelid=source_oid AND a.attnum>0 AND NOT a.attisdropped;
      IF expression_sql IS NULL THEN RAISE EXCEPTION 'DELTA_CATALOG_PROJECTION_UNSUPPORTED'; END IF;
      EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(h,'''' ORDER BY h COLLATE "C"),''''),''UTF8'')),''hex'') FROM (SELECT encode(sha256(convert_to(%s,''UTF8'')),''hex'') h FROM pg_catalog.%I t) s',expression_sql,source_catalog)
        INTO row_count,digest;
      IF row_count>1000000 THEN RAISE EXCEPTION 'DELTA_CATALOG_BOUND'; END IF;
      catalog_hashes:=array_append(catalog_hashes,cat.relname||':'||row_count||':'||digest); catalog_count:=catalog_count+1;
    EXCEPTION WHEN OTHERS THEN unsupported:=unsupported||jsonb_build_array('catalog:unknown-unreadable-or-unbounded'); END;
  END LOOP;
  IF catalog_count>128 THEN unsupported:=unsupported||'"catalog:bound"'::jsonb; END IF;

  FOR relation IN SELECT c.oid,c.relkind,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','m','S','f')
    ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
  LOOP
    BEGIN
      IF relation.relkind='f' THEN RAISE EXCEPTION 'DELTA_REMOTE_DATA_UNSUPPORTED'; END IF;
      filter_sql:='';
      IF relation.nspname='supabase_migrations' AND relation.relname='schema_migrations' THEN
        -- Exclude ONLY the exact permitted new row. NULL/malformed new rows stay
        -- visible in the data digest and are separately rejected below.
        filter_sql:=' WHERE NOT coalesce((t.version=''20261113090001'' AND t.name=''active_assignment_xp_neutrality'' AND cardinality(t.statements)=1 AND encode(sha256(convert_to(array_to_string(t.statements,E''\n''),''UTF8'')),''hex'')=''846cf3b5afd94d38f398170308f8e62c1f90f4a9a96b516d41f185986878bae2''),false)';
      END IF;
      IF relation.relkind='S' THEN
        EXECUTE format('SELECT 1,encode(sha256(convert_to(jsonb_build_object(''lastValue'',last_value,''isCalled'',is_called)::text,''UTF8'')),''hex'') FROM %I.%I',relation.nspname,relation.relname) INTO row_count,digest;
      ELSE
        -- Binary record output preserves physical OID aliases recursively inside
        -- domains/composites/arrays, JSON text and array bounds. A type without
        -- binary send is unsupported/HOLD; never fall back to lossy row text.
        EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(h,'''' ORDER BY h COLLATE "C"),''''),''UTF8'')),''hex'') FROM (SELECT encode(sha256(record_send(t)),''hex'') h FROM ONLY %I.%I t%s) s',relation.nspname,relation.relname,filter_sql)
          INTO row_count,digest;
      END IF;
      IF row_count>1000000 THEN RAISE EXCEPTION 'DELTA_DATA_BOUND'; END IF;
      data_hashes:=array_append(data_hashes,encode(sha256(convert_to(jsonb_build_object('schema',relation.nspname,'name',relation.relname,'rows',row_count,'sha256',digest)::text,'UTF8')),'hex')); table_count:=table_count+1;
    EXCEPTION WHEN OTHERS THEN unsupported:=unsupported||jsonb_build_array('data:'||SQLSTATE); END;
  END LOOP;
  IF table_count>10000 THEN unsupported:=unsupported||'"data:bound"'::jsonb; END IF;

  BEGIN
    IF to_regclass('supabase_migrations.schema_migrations') IS NULL OR
      (SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped)<>3 OR
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped AND attname NOT IN ('version','name','statements')) THEN
      RAISE EXCEPTION 'DELTA_LEDGER_SHAPE_UNSUPPORTED';
    END IF;
    SELECT count(*) INTO history_count FROM supabase_migrations.schema_migrations;
    SELECT encode(sha256(convert_to(coalesce(jsonb_agg(h::text ORDER BY h.version COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex'),
      encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('row',h::text,'xmin',h.xmin::text) ORDER BY h.version COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex')
      INTO history_hash,history_tuple_hash FROM supabase_migrations.schema_migrations h WHERE h.version<>'20261113090001';
    SELECT jsonb_build_object('version',h.version,'name',h.name,'statementCount',coalesce(cardinality(h.statements),0),
      'statementsSha256',CASE WHEN h.statements IS NULL THEN NULL ELSE encode(sha256(convert_to(array_to_string(h.statements,E'\n'),'UTF8')),'hex') END,'xmin',h.xmin::text)
      INTO delta_history FROM supabase_migrations.schema_migrations h WHERE h.version='20261113090001';
    IF history_count NOT IN (17,18) OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version<>'20261113090001')<>17 THEN RAISE EXCEPTION 'DELTA_HISTORY_SCOPE'; END IF;
  EXCEPTION WHEN OTHERS THEN unsupported:=unsupported||'"history:unsupported-unreadable-or-wrong-scope"'::jsonb; END;

  SELECT 'ROW('||string_agg(CASE WHEN a.atttypid=ANY(alias_oid_types) THEN format('p.%I::oid',a.attname)
      WHEN ty.typelem=ANY(alias_oid_types) THEN format('p.%I::oid[]',a.attname) ELSE format('p.%I',a.attname) END,',' ORDER BY a.attnum)||')::text' INTO expression_sql
    FROM pg_attribute a JOIN pg_type ty ON ty.oid=a.atttypid WHERE a.attrelid='pg_proc'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname NOT IN ('oid','prosrc');
  EXECUTE format('SELECT jsonb_agg(jsonb_build_object(''signature'',e.signature,''oid'',p.oid::text,''xmin'',p.xmin::text,
    ''bodySha256'',encode(sha256(convert_to(p.prosrc,''UTF8'')),''hex''),
    ''attributesAclSha256'',encode(sha256(convert_to(%s,''UTF8'')),''hex'')) ORDER BY e.signature COLLATE "C")
    FROM (VALUES(''private.join_mission(uuid)''),(''public.accept_application(uuid)'')) e(signature)
    JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)',expression_sql) INTO targets;
  IF targets IS NULL OR jsonb_array_length(targets)<>2 THEN unsupported:=unsupported||'"targets:missing"'::jsonb; END IF;
  PERFORM set_config('adfocate.delta_transaction_invariant',jsonb_build_object('schemaVersion',1,'algorithm','pg17-same-database-invariant-v1',
    'databaseName',current_database(),'serverVersionNum',current_setting('server_version_num'),'isolationLevel',current_setting('transaction_isolation'),
    'transactionId',transaction_id,'catalogSha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') FROM unnest(catalog_hashes) h),
    'catalogCount',catalog_count,'dataSha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') FROM unnest(data_hashes) h),
    'tableCount',table_count,'baselineHistoryDataSha256',history_hash,'baselineHistoryTupleSha256',history_tuple_hash,'migrationRows',history_count,
    'deltaHistory',delta_history,'targets',targets,'unsupported',unsupported)::text,true);
END;
$delta_invariant_capture$;
SELECT current_setting('adfocate.delta_transaction_invariant')::jsonb AS delta_transaction_invariant;
