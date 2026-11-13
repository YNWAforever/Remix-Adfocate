-- Caller owns BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY and its imported
-- snapshot. No DDL, credentials, source values, BEGIN/COMMIT or exclusion options.
-- Sequence state is NOT MVCC: the caller must freeze writers and verify samples
-- around the archive. This collector never invokes nextval/setval.
SET LOCAL search_path = pg_catalog;
SET LOCAL client_encoding = 'UTF8';
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL intervalstyle = 'postgres';
SET LOCAL extra_float_digits = 3;
SET LOCAL bytea_output = 'hex';
SET LOCAL row_security = off;
DO $delta_recovery_data$
DECLARE
  relations jsonb:='[]'; unsupported jsonb:='[]'; relation record; col record; typ record; leaf record;
  inventory_count integer:=0; table_count integer:=0; sequence_count integer:=0; total_rows bigint:=0;
  rows_found bigint; column_count integer; columns_payload jsonb; identity_hash text; data_hash text;
  cells text[]; cell_sql text; send_sql text; cast_sql text; send_name text; shape jsonb;
  current_oid oid; expected_send oid; domains jsonb; domain_sends oid[]; root_domain_sends oid[];
  root_type_sql text; is_array boolean; root_shape jsonb; depth integer; poisoned boolean;
  failure_stage text; result jsonb;
  -- Fixed PG17 native system catalogs only. Extension-owned tables are NOT
  -- excluded, including tables in auth/storage/vault/realtime/private schemas.
  system_catalogs text[]:=ARRAY['pg_aggregate','pg_am','pg_amop','pg_amproc','pg_attrdef','pg_attribute','pg_auth_members','pg_authid',
    'pg_cast','pg_class','pg_collation','pg_constraint','pg_conversion','pg_database','pg_db_role_setting','pg_default_acl','pg_depend',
    'pg_description','pg_enum','pg_event_trigger','pg_extension','pg_foreign_data_wrapper','pg_foreign_server','pg_foreign_table','pg_index',
    'pg_inherits','pg_init_privs','pg_language','pg_largeobject','pg_largeobject_metadata','pg_namespace','pg_opclass','pg_operator','pg_opfamily',
    'pg_parameter_acl','pg_partitioned_table','pg_policy','pg_proc','pg_publication','pg_publication_namespace','pg_publication_rel','pg_range',
    'pg_replication_origin','pg_rewrite','pg_seclabel','pg_sequence','pg_shdepend','pg_shdescription','pg_shseclabel','pg_statistic','pg_statistic_ext',
    'pg_statistic_ext_data','pg_subscription','pg_subscription_rel','pg_tablespace','pg_transform','pg_trigger','pg_ts_config','pg_ts_config_map',
    'pg_ts_dict','pg_ts_parser','pg_ts_template','pg_type','pg_user_mapping'];
  native_sends jsonb:='{"bool":"boolsend","bytea":"byteasend","char":"charsend","name":"namesend","int2":"int2send","int4":"int4send","int8":"int8send","float4":"float4send","float8":"float8send","numeric":"numeric_send","text":"textsend","varchar":"varcharsend","bpchar":"bpcharsend","json":"json_send","jsonb":"jsonb_send","xml":"xml_send","date":"date_send","time":"time_send","timetz":"timetz_send","timestamp":"timestamp_send","timestamptz":"timestamptz_send","interval":"interval_send","uuid":"uuid_send","inet":"inet_send","cidr":"cidr_send","macaddr":"macaddr_send","macaddr8":"macaddr8_send","bit":"bit_send","varbit":"varbit_send","money":"cash_send","pg_lsn":"pg_lsn_send","point":"point_send","lseg":"lseg_send","box":"box_send","path":"path_send","polygon":"poly_send","line":"line_send","circle":"circle_send","tsvector":"tsvectorsend","tsquery":"tsquerysend"}';
BEGIN
  IF current_setting('server_version_num')::integer/10000<>17 OR current_database()<>'postgres'
    OR current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
    OR current_setting('server_encoding')<>'UTF8' THEN RAISE EXCEPTION 'DELTA_RECOVERY_DATA_CONTEXT'; END IF;
  BEGIN
    IF EXISTS(SELECT 1 FROM pg_largeobject_metadata) OR EXISTS(SELECT 1 FROM pg_largeobject) THEN
      unsupported:=unsupported||'"large-objects-unmodeled"'::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN unsupported:=unsupported||'"large-object-coverage-unreadable"'::jsonb; END;
  FOR relation IN SELECT c.oid,c.relkind,c.relpersistence,c.relispopulated,n.nspname,c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','m','S','f')
    ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
  LOOP
    IF relation.nspname='pg_catalog' AND relation.relname=ANY(system_catalogs) THEN CONTINUE; END IF;
    IF relation.nspname='information_schema' AND relation.relname=ANY(ARRAY['sql_features','sql_implementation_info','sql_parts','sql_sizing']) THEN CONTINUE; END IF;
    -- TOAST storage has relkind=t (indexes=i), so it is absent from this logical
    -- relation inventory. Unknown pg_catalog/user/extension tables remain here.
    inventory_count:=inventory_count+1;
    IF inventory_count>10000 THEN unsupported:=unsupported||'"relation-count-bound"'::jsonb; EXIT; END IF;
    identity_hash:=encode(sha256(convert_to(jsonb_build_array(relation.nspname,relation.relname)::text,'UTF8')),'hex');
    BEGIN
      failure_stage:='relation-kind-unportable';
      IF relation.relkind='f' OR relation.relpersistence='t' OR (relation.relkind='m' AND NOT relation.relispopulated) THEN
        RAISE EXCEPTION 'DELTA_RECOVERY_RELATION_UNPORTABLE';
      END IF;
      IF relation.relkind='S' THEN
        failure_stage:='sequence-unreadable';
        EXECUTE format('SELECT encode(sha256(convert_to(jsonb_build_object(''lastValue'',last_value::text,''isCalled'',is_called)::text,''UTF8'')),''hex'') FROM %I.%I',relation.nspname,relation.relname) INTO STRICT data_hash;
        relations:=relations||jsonb_build_array(jsonb_build_object('identitySha256',identity_hash,'kind','S','columnCount',0,
          'columnsSha256',encode(sha256(convert_to('["sequence-state-v1"]','UTF8')),'hex'),'rowCount',0,'dataSha256',data_hash));
        sequence_count:=sequence_count+1; CONTINUE;
      END IF;
      column_count:=0;columns_payload:='[]';cells:='{}';
      FOR col IN SELECT a.attname,a.atttypid,a.atttypmod,a.attcollation FROM pg_attribute a
        WHERE a.attrelid=relation.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum
      LOOP
        failure_stage:='type-unportable';column_count:=column_count+1;
        IF column_count>1600 THEN RAISE EXCEPTION 'DELTA_RECOVERY_COLUMN_BOUND'; END IF;
        current_oid:=col.atttypid;domains:='[]';domain_sends:='{}';
        FOR depth IN 1..17 LOOP
          SELECT t.*,n.nspname INTO STRICT typ FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.oid=current_oid;
          EXIT WHEN typ.typtype<>'d';
          IF depth>16 THEN RAISE EXCEPTION 'DELTA_RECOVERY_TYPE_DEPTH'; END IF;
          domains:=domains||jsonb_build_array(jsonb_build_object('identity',jsonb_build_array(typ.nspname,typ.typname),'typmod',typ.typtypmod));
          domain_sends:=array_append(domain_sends,typ.typsend::oid);current_oid:=typ.typbasetype;
        END LOOP;
        root_domain_sends:=domain_sends;
        root_shape:=jsonb_build_object('domains',domains);
        root_type_sql:=format('%I.%I',typ.nspname,typ.typname);
        is_array:=typ.typcategory='A' AND typ.typelem<>0 AND typ.typsend='pg_catalog.array_send(anyarray)'::regprocedure;
        IF is_array THEN
          IF NOT EXISTS(SELECT 1 FROM pg_type e WHERE e.oid=typ.typelem AND e.typarray=typ.oid)
            OR EXISTS(SELECT 1 FROM unnest(root_domain_sends) s WHERE s<>'pg_catalog.array_send(anyarray)'::regprocedure::oid) THEN
            RAISE EXCEPTION 'DELTA_RECOVERY_ARRAY_CODEC';
          END IF;
          root_shape:=root_shape||jsonb_build_object('kind','array');current_oid:=typ.typelem;domains:='[]';domain_sends:='{}';
          FOR depth IN 1..17 LOOP
            SELECT t.*,n.nspname INTO STRICT typ FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.oid=current_oid;
            EXIT WHEN typ.typtype<>'d';
            IF depth>16 THEN RAISE EXCEPTION 'DELTA_RECOVERY_TYPE_DEPTH'; END IF;
            domains:=domains||jsonb_build_array(jsonb_build_object('identity',jsonb_build_array(typ.nspname,typ.typname),'typmod',typ.typtypmod));
            domain_sends:=array_append(domain_sends,typ.typsend::oid);current_oid:=typ.typbasetype;
          END LOOP;
          root_shape:=root_shape||jsonb_build_object('elementDomains',domains);
        ELSE root_shape:=root_shape||jsonb_build_object('kind','scalar'); END IF;
        leaf:=typ;
        IF leaf.typtype='e' AND leaf.typsend='pg_catalog.enum_send(anyenum)'::regprocedure THEN
          expected_send:='pg_catalog.enum_send(anyenum)'::regprocedure;send_name:='enum_send';
          shape:=jsonb_build_object('kind','enum','identity',jsonb_build_array(leaf.nspname,leaf.typname));
        ELSIF leaf.typtype='b' AND leaf.nspname='pg_catalog' AND native_sends?leaf.typname THEN
          send_name:=native_sends->>leaf.typname;expected_send:=to_regproc('pg_catalog.'||send_name);
          IF expected_send IS NULL OR leaf.typsend::oid<>expected_send THEN RAISE EXCEPTION 'DELTA_RECOVERY_NATIVE_CODEC'; END IF;
          shape:=jsonb_build_object('kind','native','identity',jsonb_build_array('pg_catalog',leaf.typname));
        ELSE
          -- Includes raw oid, EVERY reg* alias, record/composite, ranges and
          -- extension/custom base types. No text or binary fallback is allowed.
          RAISE EXCEPTION 'DELTA_RECOVERY_TYPE_UNSUPPORTED';
        END IF;
        IF EXISTS(SELECT 1 FROM unnest(domain_sends) s WHERE s<>expected_send)
          OR (NOT is_array AND EXISTS(SELECT 1 FROM unnest(root_domain_sends) s WHERE s<>expected_send)) THEN
          RAISE EXCEPTION 'DELTA_RECOVERY_DOMAIN_CODEC';
        END IF;
        shape:=root_shape||jsonb_build_object('leaf',shape);
        cast_sql:=format('t.%I',col.attname);
        IF is_array THEN
          -- REL_17_6 array_send writes ndim, null-bitmap flag, element OID,
          -- dimensions/lower bounds and length-prefixed element send payloads.
          -- Flags reflect optional internal bitmap storage, not logical NULLs.
          -- Normalize ONLY flags+physical element OID; NULL sentinels and all
          -- dimensions/bounds/element bytes remain. Nested array/composite leaves
          -- were rejected above. Enum sends labels; no enum OID enters payloads.
          send_sql:=format('overlay(pg_catalog.array_send((%s)::%s) placing decode(''0000000000000000'',''hex'') from 5 for 8)',cast_sql,root_type_sql);
        ELSE send_sql:=format('pg_catalog.%I((%s)::%I.%I)',send_name,cast_sql,leaf.nspname,leaf.typname); END IF;
        cell_sql:=format('CASE WHEN %s IS NULL THEN ''n'' WHEN octet_length(%s)>1048576 THEN NULL ELSE ''v''||encode(sha256(%s),''hex'') END',cast_sql,send_sql,send_sql);
        cells:=array_append(cells,cell_sql);
        columns_payload:=columns_payload||jsonb_build_array(jsonb_build_object('ordinal',column_count,'name',col.attname,'type',shape,'typmod',col.atttypmod,
          'collation',(SELECT jsonb_build_array(n.nspname,c.collname) FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE c.oid=col.attcollation)));
      END LOOP;
      failure_stage:='relation-unreadable-or-unbounded';
      -- ONLY prevents inheritance/partition duplication. Each leaf is separately
      -- inventoried. LIMIT+1 detects excess rows before building an unbounded bag.
      EXECUTE format('SELECT count(*),coalesce(bool_or(array_position(v,NULL) IS NOT NULL),false),encode(sha256(convert_to(coalesce(string_agg(h,'''' ORDER BY h COLLATE "C"),''''),''UTF8'')),''hex'') FROM (SELECT v,encode(sha256(convert_to(to_jsonb(v)::text,''UTF8'')),''hex'') h FROM (SELECT ARRAY[%s]::text[] v FROM ONLY %I.%I t LIMIT 1000001) cells) hashes',array_to_string(cells,','),relation.nspname,relation.relname)
        INTO rows_found,poisoned,data_hash;
      IF rows_found>1000000 OR total_rows+rows_found>10000000 OR poisoned OR (relation.relkind='p' AND rows_found<>0) THEN RAISE EXCEPTION 'DELTA_RECOVERY_DATA_BOUND'; END IF;
      relations:=relations||jsonb_build_array(jsonb_build_object('identitySha256',identity_hash,'kind',relation.relkind,'columnCount',column_count,
        'columnsSha256',encode(sha256(convert_to(columns_payload::text,'UTF8')),'hex'),'rowCount',rows_found,'dataSha256',data_hash));
      table_count:=table_count+1;total_rows:=total_rows+rows_found;
    EXCEPTION WHEN OTHERS THEN
      -- SQLSTATE + closed stage + hashed identity only. Never SQLERRM, detail,
      -- context, row values, names, function source or connection information.
      unsupported:=unsupported||jsonb_build_array(jsonb_build_object('code',failure_stage,'identitySha256',identity_hash,'sqlState',SQLSTATE));
    END;
  END LOOP;
  result:=jsonb_build_object('schemaVersion',1,'kind','delta-recovery-data','algorithm','pg17-portable-data-v1',
    'databaseName',current_database(),'serverVersionNum',current_setting('server_version_num'),'isolationLevel',current_setting('transaction_isolation'),
    'transactionReadOnly',current_setting('transaction_read_only')='on','sequenceStateNonMvcc',true,
    'fullCoverage',unsupported='[]'::jsonb AND inventory_count=jsonb_array_length(relations),'inventoryCount',inventory_count,
    'tableCount',table_count,'sequenceCount',sequence_count,'rowCount',total_rows,'relations',relations,'unsupported',unsupported);
  IF octet_length(result::text)>8388608 THEN
    result:=jsonb_set(jsonb_set(jsonb_set(result,'{relations}','[]'::jsonb),'{fullCoverage}','false'::jsonb),'{unsupported}','["collection-bound"]'::jsonb);
  END IF;
  PERFORM set_config('adfocate.delta_recovery_data',result::text,true);
END;
$delta_recovery_data$;
SELECT current_setting('adfocate.delta_recovery_data')::jsonb AS delta_recovery_data;
