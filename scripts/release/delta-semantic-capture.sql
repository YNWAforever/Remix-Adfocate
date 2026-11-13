-- Read-only collector. Caller owns BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY
-- and the exported snapshot; this file never begins/commits a transaction or DDL.
-- Only hashes/counts leave SQL. Unknown member catalogs, unrendered node trees,
-- unresolved OID references, missing privileges and boundedness failures are HOLD.
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL row_security = off;
DO $delta_semantic_capture$
DECLARE
  components jsonb := '[]'; unsupported jsonb := '[]';
  payload jsonb; profile_hash text; row_count bigint; digest text;
  ext record; member record; child record; fk record; col record; item record;
  member_rows jsonb := '[]'; member_hashes text[] := '{}';
  raw_row jsonb; normalized jsonb; address jsonb; ref_address jsonb;
  cat_oid oid; cat_name text; config_row_count bigint; rendered text; field_name text; field_type text; element_type text;
  processed text[]; refs oid[]; ref_oid oid; mapped jsonb; i integer;
  field_oid oid; element_oid oid; locator_column text; locator_oid oid;
  has_oid_alias boolean; has_configuration_rows boolean; type_count bigint;
  alias_oid_types oid[]:=ARRAY['regproc'::regtype,'regprocedure'::regtype,'regoper'::regtype,'regoperator'::regtype,'regclass'::regtype,'regtype'::regtype,'regnamespace'::regtype,'regrole'::regtype,'regcollation'::regtype];
  known_member_catalogs text[] := ARRAY['pg_proc','pg_type','pg_class','pg_namespace','pg_language','pg_operator','pg_cast','pg_am','pg_amop','pg_amproc',
    'pg_collation','pg_conversion','pg_opclass','pg_opfamily','pg_transform','pg_ts_config','pg_ts_dict','pg_ts_parser','pg_ts_template',
    'pg_constraint','pg_attrdef','pg_trigger','pg_rewrite','pg_policy','pg_statistic_ext','pg_foreign_data_wrapper','pg_foreign_server'];
BEGIN
  IF current_setting('transaction_isolation') <> 'repeatable read' OR current_setting('transaction_read_only') <> 'on'
    OR current_database() <> 'postgres' OR current_setting('server_version_num')::int / 10000 <> 17 THEN
    RAISE EXCEPTION 'DELTA_SEMANTIC_COLLECTOR_CONTEXT';
  END IF;
  -- A schema-only pg_dump is not a cluster-global/data backup. Recognized but
  -- unmodeled nonempty categories are explicitly HOLD; absence must be readable.
  BEGIN
    IF EXISTS(SELECT 1 FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')) THEN unsupported:=unsupported||'"scope:custom-tablespace-unreviewed"'::jsonb; END IF;
    IF EXISTS(SELECT 1 FROM pg_largeobject_metadata) OR EXISTS(SELECT 1 FROM pg_largeobject) THEN unsupported:=unsupported||'"scope:large-objects-unreviewed"'::jsonb; END IF;
    IF EXISTS(SELECT 1 FROM pg_replication_origin) THEN unsupported:=unsupported||'"scope:replication-origin-unreviewed"'::jsonb; END IF;
    IF EXISTS(SELECT 1 FROM pg_subscription) THEN unsupported:=unsupported||'"scope:subscription-unreviewed"'::jsonb; END IF;
    IF EXISTS(SELECT 1 FROM pg_user_mapping) THEN unsupported:=unsupported||'"scope:user-mapping-unreviewed"'::jsonb; END IF;
  EXCEPTION WHEN OTHERS THEN unsupported:=unsupported||'"scope:global-absence-unreadable"'::jsonb; END;
  SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion)
    ORDER BY e.extname COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') INTO profile_hash
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace;

  -- Cross-database configuration rows cannot use physical binary OIDs. Until
  -- alias-bearing values have an explicit stable-address renderer, nonempty
  -- configuration relations containing aliases anywhere in their type graph HOLD.
  BEGIN
    FOR child IN
      SELECT to_regclass('storage.buckets')::oid AS relation_oid,'storage-configuration'::text AS category
      UNION ALL SELECT unnest(e.extconfig),'extension-configuration' FROM pg_extension e
    LOOP
      IF child.relation_oid IS NULL THEN CONTINUE; END IF;
      WITH RECURSIVE type_closure(oid) AS (
        SELECT a.atttypid FROM pg_attribute a WHERE a.attrelid=child.relation_oid AND a.attnum>0 AND NOT a.attisdropped
        UNION
        SELECT edge.oid FROM type_closure c JOIN pg_type t ON t.oid=c.oid CROSS JOIN LATERAL (
          SELECT t.typbasetype AS oid WHERE t.typbasetype<>0
          UNION SELECT t.typelem WHERE t.typelem<>0
          UNION SELECT a.atttypid FROM pg_attribute a WHERE t.typtype='c' AND a.attrelid=t.typrelid AND a.attnum>0 AND NOT a.attisdropped
          UNION SELECT r.rngsubtype FROM pg_range r WHERE r.rngtypid=t.oid OR r.rngmultitypid=t.oid
        ) edge
      ) SELECT count(*),coalesce(bool_or(oid=ANY(alias_oid_types)),false) INTO type_count,has_oid_alias FROM type_closure;
      IF type_count>1000000 THEN RAISE EXCEPTION 'DELTA_CONFIG_TYPE_BOUND'; END IF;
      IF has_oid_alias THEN
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s)',child.relation_oid::regclass) INTO has_configuration_rows;
        IF has_configuration_rows THEN unsupported:=unsupported||jsonb_build_array(child.category||':oid-alias-values-unreviewed'); END IF;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN unsupported:=unsupported||'"scope:configuration-types-unreadable-or-unbounded"'::jsonb; END;

  BEGIN
    IF EXISTS(SELECT 1 FROM pg_auth_members a LEFT JOIN pg_roles r ON r.oid=a.roleid LEFT JOIN pg_roles m ON m.oid=a.member LEFT JOIN pg_roles g ON g.oid=a.grantor
      WHERE r.oid IS NULL OR m.oid IS NULL OR g.oid IS NULL) THEN RAISE EXCEPTION 'DELTA_ROLE_REFERENCE_UNRESOLVED'; END IF;
    IF EXISTS(SELECT 1 FROM pg_shdescription WHERE classoid NOT IN ('pg_authid'::regclass,'pg_database'::regclass,'pg_tablespace'::regclass))
      OR EXISTS(SELECT 1 FROM pg_shseclabel WHERE classoid NOT IN ('pg_authid'::regclass,'pg_database'::regclass,'pg_tablespace'::regclass))
      OR EXISTS(SELECT 1 FROM pg_tablespace t LEFT JOIN pg_roles r ON r.oid=t.spcowner WHERE r.oid IS NULL) THEN RAISE EXCEPTION 'DELTA_SHARED_METADATA_UNSUPPORTED'; END IF;
    SELECT jsonb_build_object(
      'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r)-ARRAY['oid','rolpassword'] ORDER BY r.rolname COLLATE "C"),'[]'::jsonb) FROM pg_roles r),
      'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,
        'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option)
        ORDER BY r.rolname COLLATE "C",m.rolname COLLATE "C",g.rolname COLLATE "C"),'[]'::jsonb)
        FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor),
      'parameterAcl',(SELECT coalesce(jsonb_agg(to_jsonb(a)-'oid' ORDER BY a.parname COLLATE "C"),'[]'::jsonb) FROM pg_parameter_acl a),
      'tablespaces',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.spcname,'owner',r.rolname,'acl',t.spcacl,'options',t.spcoptions) ORDER BY t.spcname COLLATE "C"),'[]'::jsonb)
        FROM pg_tablespace t JOIN pg_roles r ON r.oid=t.spcowner),
      'sharedComments',(SELECT coalesce(jsonb_agg(v ORDER BY v::text COLLATE "C"),'[]'::jsonb) FROM (
        SELECT jsonb_build_object('address',(SELECT to_jsonb(a) FROM pg_identify_object(d.classoid,d.objoid,0) a),'comment',d.description) v FROM pg_shdescription d) s),
      'sharedLabels',(SELECT coalesce(jsonb_agg(v ORDER BY v::text COLLATE "C"),'[]'::jsonb) FROM (
        SELECT jsonb_build_object('address',(SELECT to_jsonb(a) FROM pg_identify_object(d.classoid,d.objoid,0) a),'provider',d.provider,'label',d.label) v FROM pg_shseclabel d) s)) INTO payload;
    SELECT (SELECT count(*) FROM pg_roles)+(SELECT count(*) FROM pg_auth_members)+(SELECT count(*) FROM pg_parameter_acl)
      +(SELECT count(*) FROM pg_tablespace)+(SELECT count(*) FROM pg_shdescription)+(SELECT count(*) FROM pg_shseclabel) INTO row_count;
    IF row_count>1000000 THEN RAISE EXCEPTION 'DELTA_COMPONENT_BOUND'; END IF;
    components := components||jsonb_build_array(jsonb_build_object('category','roles-and-memberships','coverage','complete','objectCount',row_count,
      'sha256',encode(sha256(convert_to(payload::text,'UTF8')),'hex')));
  EXCEPTION WHEN OTHERS THEN unsupported := unsupported||'"roles-and-memberships:unreadable-or-unbounded"'::jsonb; END;

  BEGIN
    SELECT jsonb_build_object(
      'database',(SELECT (to_jsonb(d)-ARRAY['oid','datdba','dattablespace','datfrozenxid','datminmxid'])
        ||jsonb_build_object('owner',r.rolname,'tablespace',s.spcname)
        FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba JOIN pg_tablespace s ON s.oid=d.dattablespace WHERE d.datname=current_database()),
      'settings',(SELECT coalesce(jsonb_agg(jsonb_build_object('database',CASE WHEN s.setdatabase=0 THEN 'ALL' ELSE d.datname END,
        'role',CASE WHEN s.setrole=0 THEN 'ALL' ELSE r.rolname END,
        'settings',to_jsonb(s.setconfig))
        ORDER BY coalesce(d.datname,'') COLLATE "C",coalesce(r.rolname,'') COLLATE "C"),'[]'::jsonb)
        FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase LEFT JOIN pg_roles r ON r.oid=s.setrole
        WHERE s.setdatabase=0 OR d.datname=current_database())) INTO payload;
    SELECT 1+count(*) INTO row_count FROM pg_db_role_setting s WHERE s.setdatabase=0 OR s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database());
    IF row_count>1000000 THEN RAISE EXCEPTION 'DELTA_COMPONENT_BOUND'; END IF;
    components := components||jsonb_build_array(jsonb_build_object('category','database-role-settings','coverage','complete','objectCount',row_count,
      'sha256',encode(sha256(convert_to(payload::text,'UTF8')),'hex')));
  EXCEPTION WHEN OTHERS THEN unsupported := unsupported||'"database-role-settings:unreadable-or-unbounded"'::jsonb; END;

  BEGIN
    IF to_regclass('storage.buckets') IS NULL THEN RAISE EXCEPTION 'DELTA_STORAGE_REQUIRED'; END IF;
    EXECUTE 'SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(h,'''' ORDER BY h COLLATE "C"),''''),''UTF8'')),''hex'') FROM (SELECT encode(sha256(convert_to(b::text,''UTF8'')),''hex'') h FROM storage.buckets b) s'
      INTO row_count,digest;
    IF row_count>1000000 THEN RAISE EXCEPTION 'DELTA_COMPONENT_BOUND'; END IF;
    components := components||jsonb_build_array(jsonb_build_object('category','storage-configuration','coverage','complete','objectCount',row_count,'sha256',digest));
  EXCEPTION WHEN OTHERS THEN unsupported := unsupported||'"storage-configuration:unreadable-or-unbounded"'::jsonb; END;

  BEGIN
    payload := '[]'; row_count := 0;
    FOR ext IN SELECT e.extname,e.extconfig,e.extcondition FROM pg_extension e ORDER BY e.extname COLLATE "C" LOOP
      IF cardinality(ext.extconfig) IS DISTINCT FROM cardinality(ext.extcondition) THEN RAISE EXCEPTION 'DELTA_EXTENSION_CONFIG_SHAPE'; END IF;
      FOR i IN 1..coalesce(cardinality(ext.extconfig),0) LOOP
        SELECT to_jsonb(a) INTO address FROM pg_identify_object('pg_class'::regclass,ext.extconfig[i],0) a;
        IF address->>'identity' IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=ext.extconfig[i] AND relkind IN ('r','p','m')) THEN RAISE EXCEPTION 'DELTA_EXTENSION_CONFIG_UNSUPPORTED'; END IF;
        EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(h,'''' ORDER BY h COLLATE "C"),''''),''UTF8'')),''hex'') FROM (SELECT encode(sha256(convert_to(t::text,''UTF8'')),''hex'') h FROM %s t) s',ext.extconfig[i]::regclass)
          INTO config_row_count,digest;
        IF config_row_count>1000000 THEN RAISE EXCEPTION 'DELTA_COMPONENT_BOUND'; END IF;
        payload := payload||jsonb_build_array(jsonb_build_object('extension',ext.extname,'relation',address,'condition',ext.extcondition[i],'rows',config_row_count,'sha256',digest));
        row_count := row_count+1;
      END LOOP;
    END LOOP;
    components := components||jsonb_build_array(jsonb_build_object('category','extension-configuration','coverage','complete','objectCount',row_count,
      'sha256',encode(sha256(convert_to(payload::text,'UTF8')),'hex')));
  EXCEPTION WHEN OTHERS THEN unsupported := unsupported||'"extension-configuration:unreadable-or-unbounded"'::jsonb; END;

  BEGIN
    IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'DELTA_HISTORY_REQUIRED'; END IF;
    SELECT count(*),encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('version',h.version,'name',h.name,
      'statementCount',coalesce(cardinality(h.statements),0),'statementsSha256',CASE WHEN h.statements IS NULL THEN NULL
      ELSE encode(sha256(convert_to(array_to_string(h.statements,E'\n'),'UTF8')),'hex') END) ORDER BY h.version COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex')
      INTO row_count,digest FROM supabase_migrations.schema_migrations h;
    IF row_count NOT IN (17,18) THEN RAISE EXCEPTION 'DELTA_HISTORY_SCOPE'; END IF;
    SELECT encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') INTO rendered
      FROM (SELECT encode(sha256(convert_to(h::text,'UTF8')),'hex') h FROM supabase_migrations.schema_migrations h) s;
    digest:=encode(sha256(convert_to(jsonb_build_object('metadataSha256',digest,'typedRowsSha256',rendered)::text,'UTF8')),'hex');
    components := components||jsonb_build_array(jsonb_build_object('category','migration-history','coverage','complete','objectCount',row_count,'sha256',digest));
  EXCEPTION WHEN OTHERS THEN unsupported := unsupported||'"migration-history:unreadable-or-wrong-scope"'::jsonb; END;

  BEGIN
    -- Membership plus the auto/internal ownership closure. Normal dependencies are
    -- serialized as stable references, not pulled in as extension-owned objects.
    FOR member IN
      WITH RECURSIVE owned AS (
        SELECT e.extname,d.classid,d.objid,d.objsubid FROM pg_extension e JOIN pg_depend d ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e'
        UNION
        SELECT o.extname,d.classid,d.objid,d.objsubid FROM owned o JOIN pg_depend d ON d.refclassid=o.classid AND d.refobjid=o.objid
          AND (o.objsubid=0 OR d.refobjsubid=o.objsubid) AND d.deptype IN ('a','i')
      ) SELECT DISTINCT o.extname,o.classid,o.objid FROM owned o WHERE o.objsubid=0 ORDER BY o.extname,o.classid,o.objid
    LOOP
      field_name:=NULL;
      SELECT c.relname INTO cat_name FROM pg_class c WHERE c.oid=member.classid AND c.relnamespace='pg_catalog'::regnamespace;
      IF cat_name IS NULL OR NOT cat_name=ANY(known_member_catalogs) THEN RAISE EXCEPTION 'DELTA_MEMBER_CATALOG_UNSUPPORTED'; END IF;
      -- TOAST names/filenodes are physical implementation details. The owning
      -- relation, all logical columns and all logical indexes are retained.
      IF member.classid='pg_class'::regclass AND EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=member.objid AND n.nspname LIKE 'pg_toast%') THEN CONTINUE; END IF;
      SELECT to_jsonb(a) INTO address FROM pg_identify_object(member.classid,member.objid,0) a;
      IF address->>'identity' IS NULL THEN RAISE EXCEPTION 'DELTA_MEMBER_ADDRESS_UNSUPPORTED'; END IF;
      EXECUTE format('SELECT to_jsonb(t) FROM pg_catalog.%I t WHERE oid=$1',cat_name) INTO raw_row USING member.objid;
      IF raw_row IS NULL THEN RAISE EXCEPTION 'DELTA_MEMBER_ROW_MISSING'; END IF;
      member_rows := member_rows||jsonb_build_array(jsonb_build_object('extension',member.extname,'catalog',cat_name,'catalogOid',member.classid,'owner',address,'row',raw_row));
      IF member.classid='pg_proc'::regclass THEN
        FOR child IN SELECT 'pg_aggregate' AS catalog,'pg_aggregate'::regclass::oid AS catalog_oid,to_jsonb(a) AS body FROM pg_aggregate a WHERE a.aggfnoid=member.objid LOOP
          member_rows:=member_rows||jsonb_build_array(jsonb_build_object('extension',member.extname,'catalog',child.catalog,'catalogOid',child.catalog_oid,'sourceOid',member.objid,'owner',address,'row',child.body));
        END LOOP;
      ELSIF member.classid='pg_type'::regclass THEN
        FOR child IN
          SELECT 'pg_enum' AS catalog,'pg_enum'::regclass::oid AS catalog_oid,to_jsonb(e)||jsonb_build_object('enumsortorder',row_number() OVER(ORDER BY e.enumsortorder)) AS body FROM pg_enum e WHERE e.enumtypid=member.objid
          UNION ALL SELECT 'pg_range','pg_range'::regclass::oid,to_jsonb(r) FROM pg_range r WHERE r.rngtypid=member.objid
        LOOP member_rows:=member_rows||jsonb_build_array(jsonb_build_object('extension',member.extname,'catalog',child.catalog,'catalogOid',child.catalog_oid,'sourceOid',member.objid,'owner',address,'row',child.body)); END LOOP;
      ELSIF member.classid='pg_class'::regclass THEN
        FOR child IN
          SELECT 'pg_attribute' AS catalog,'pg_attribute'::regclass::oid AS catalog_oid,to_jsonb(a) AS body FROM pg_attribute a WHERE a.attrelid=member.objid AND a.attnum>0
          UNION ALL SELECT 'pg_index','pg_index'::regclass::oid,to_jsonb(r) FROM pg_index r WHERE r.indexrelid=member.objid
          UNION ALL SELECT 'pg_partitioned_table','pg_partitioned_table'::regclass::oid,to_jsonb(r) FROM pg_partitioned_table r WHERE r.partrelid=member.objid
          UNION ALL SELECT 'pg_sequence','pg_sequence'::regclass::oid,to_jsonb(r) FROM pg_sequence r WHERE r.seqrelid=member.objid
          UNION ALL SELECT 'pg_foreign_table','pg_foreign_table'::regclass::oid,to_jsonb(r) FROM pg_foreign_table r WHERE r.ftrelid=member.objid
          UNION ALL SELECT 'pg_inherits','pg_inherits'::regclass::oid,to_jsonb(r) FROM pg_inherits r WHERE r.inhrelid=member.objid
        LOOP member_rows:=member_rows||jsonb_build_array(jsonb_build_object('extension',member.extname,'catalog',child.catalog,'catalogOid',child.catalog_oid,'sourceOid',member.objid,'owner',address,'row',child.body)); END LOOP;
      ELSIF member.classid='pg_ts_config'::regclass THEN
        FOR child IN SELECT 'pg_ts_config_map' AS catalog,'pg_ts_config_map'::regclass::oid AS catalog_oid,to_jsonb(r) AS body FROM pg_ts_config_map r WHERE r.mapcfg=member.objid
        LOOP member_rows:=member_rows||jsonb_build_array(jsonb_build_object('extension',member.extname,'catalog',child.catalog,'catalogOid',child.catalog_oid,'sourceOid',member.objid,'owner',address,'row',child.body)); END LOOP;
      ELSIF member.classid='pg_opfamily'::regclass THEN
        FOR child IN
          SELECT 'pg_amop' AS catalog,'pg_amop'::regclass::oid AS catalog_oid,to_jsonb(r) AS body FROM pg_amop r WHERE r.amopfamily=member.objid
          UNION ALL SELECT 'pg_amproc','pg_amproc'::regclass::oid,to_jsonb(r) FROM pg_amproc r WHERE r.amprocfamily=member.objid
        LOOP member_rows:=member_rows||jsonb_build_array(jsonb_build_object('extension',member.extname,'catalog',child.catalog,'catalogOid',child.catalog_oid,'sourceOid',member.objid,'owner',address,'row',child.body)); END LOOP;
      END IF;
      FOR child IN
        SELECT 'pg_depend' AS catalog,'pg_depend'::regclass::oid AS catalog_oid,to_jsonb(d) AS body FROM pg_depend d WHERE d.classid=member.classid AND d.objid=member.objid
        UNION ALL SELECT 'pg_shdepend','pg_shdepend'::regclass::oid,to_jsonb(d) FROM pg_shdepend d WHERE d.classid=member.classid AND d.objid=member.objid AND d.dbid IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))
        UNION ALL SELECT 'pg_init_privs','pg_init_privs'::regclass::oid,to_jsonb(d) FROM pg_init_privs d WHERE d.classoid=member.classid AND d.objoid=member.objid
        UNION ALL SELECT 'pg_description','pg_description'::regclass::oid,to_jsonb(d) FROM pg_description d WHERE d.classoid=member.classid AND d.objoid=member.objid
        UNION ALL SELECT 'pg_seclabel','pg_seclabel'::regclass::oid,to_jsonb(d) FROM pg_seclabel d WHERE d.classoid=member.classid AND d.objoid=member.objid
      LOOP member_rows:=member_rows||jsonb_build_array(jsonb_build_object('extension',member.extname,'catalog',child.catalog,'catalogOid',child.catalog_oid,'sourceOid',member.objid,'owner',address,'row',child.body)); END LOOP;
      IF jsonb_array_length(member_rows)>20000 THEN RAISE EXCEPTION 'DELTA_MEMBER_BOUND'; END IF;
    END LOOP;

    FOR item IN SELECT v FROM jsonb_array_elements(member_rows) v LOOP
      field_name:=NULL;
      cat_oid:=(item.v->>'catalogOid')::oid; cat_name:=item.v->>'catalog'; raw_row:=item.v->'row'; normalized:=raw_row-'oid'; processed:=ARRAY['oid'];
      IF cat_name='pg_class' THEN
        normalized:=normalized-ARRAY['relfilenode','reltoastrelid','relpages','reltuples','relallvisible','relfrozenxid','relminmxid'];
        processed:=processed||ARRAY['relfilenode','reltoastrelid'];
      END IF;
      -- Polymorphic references are NOT ordinary catalog FKs. Resolve complete
      -- (class,object,subobject) addresses together, including column privileges.
      IF cat_name IN ('pg_depend','pg_shdepend') THEN
        SELECT to_jsonb(a) INTO ref_address FROM pg_identify_object((raw_row->>'classid')::oid,(raw_row->>'objid')::oid,coalesce((raw_row->>'objsubid')::int,0)) a;
        normalized:=normalized-ARRAY['classid','objid','objsubid']||jsonb_build_object('objectAddress',ref_address);
        SELECT to_jsonb(a) INTO ref_address FROM pg_identify_object((raw_row->>'refclassid')::oid,(raw_row->>'refobjid')::oid,coalesce((raw_row->>'refobjsubid')::int,0)) a;
        normalized:=normalized-ARRAY['refclassid','refobjid','refobjsubid']||jsonb_build_object('referencedAddress',ref_address);
        processed:=processed||ARRAY['classid','objid','refclassid','refobjid'];
      ELSIF cat_name IN ('pg_init_privs','pg_description','pg_seclabel') THEN
        SELECT to_jsonb(a) INTO ref_address FROM pg_identify_object((raw_row->>'classoid')::oid,(raw_row->>'objoid')::oid,coalesce((raw_row->>'objsubid')::int,0)) a;
        normalized:=normalized-ARRAY['classoid','objoid','objsubid']||jsonb_build_object('objectAddress',ref_address);
        processed:=processed||ARRAY['classoid','objoid'];
      END IF;
      FOR fk IN SELECT f.* FROM pg_get_catalog_foreign_keys() f WHERE f.fktable=cat_oid AND cardinality(f.fkcols)=1 AND cardinality(f.pkcols)=1 AND f.pkcols[1]='oid' LOOP
        field_name:=fk.fkcols[1];
        IF field_name=ANY(processed) THEN CONTINUE; END IF;
        IF raw_row->field_name IS NULL OR raw_row->field_name='null'::jsonb THEN normalized:=jsonb_set(normalized,ARRAY[field_name],'null'); processed:=array_append(processed,field_name); CONTINUE; END IF;
        mapped:='[]';
        SELECT format_type(a.atttypid,NULL),format_type(t.typelem,NULL),a.atttypid,t.typelem INTO field_type,element_type,field_oid,element_oid
          FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid WHERE a.attrelid=cat_oid AND a.attname=field_name;
        -- OID aliases such as regproc render overloaded names ambiguously. Read
        -- the original typed field numerically; never cast its JSON name back.
        IF field_oid=ANY(alias_oid_types) OR (fk.is_array AND element_oid=ANY(alias_oid_types)) THEN
          IF raw_row?'oid' THEN locator_column:='oid';locator_oid:=(raw_row->>'oid')::oid;
          ELSIF cat_name='pg_aggregate' AND item.v?'sourceOid' THEN locator_column:='aggfnoid';locator_oid:=(item.v->>'sourceOid')::oid;
          ELSIF cat_name='pg_range' THEN locator_column:='rngtypid';locator_oid:=(raw_row->>'rngtypid')::oid;
          ELSE RAISE EXCEPTION 'DELTA_MEMBER_ALIAS_LOCATOR_UNSUPPORTED'; END IF;
          IF fk.is_array THEN
            EXECUTE format('SELECT %I::oid[] FROM pg_catalog.%I WHERE %I::oid=$1',field_name,cat_name,locator_column) INTO STRICT refs USING locator_oid;
            refs:=coalesce(refs,'{}');
          ELSE
            EXECUTE format('SELECT %I::oid FROM pg_catalog.%I WHERE %I::oid=$1',field_name,cat_name,locator_column) INTO STRICT ref_oid USING locator_oid;
            refs:=ARRAY[ref_oid];
          END IF;
        -- Cast only this numeric FK field. A whole-row cast would invoke the
        -- forbidden pg_node_tree input function for unrelated expressions.
        ELSIF fk.is_array THEN
          IF jsonb_typeof(raw_row->field_name)='array' THEN
            EXECUTE format('SELECT array_agg(v::%s::oid ORDER BY n) FROM jsonb_array_elements_text($1) WITH ORDINALITY x(v,n)',element_type)
              INTO refs USING raw_row->field_name;
          ELSE EXECUTE format('SELECT $1::%s::oid[]',field_type) INTO refs USING raw_row->>field_name;
          END IF;
          refs:=coalesce(refs,'{}');
        ELSE
          EXECUTE format('SELECT $1::%s::oid',field_type) INTO ref_oid USING raw_row->>field_name;
          refs:=ARRAY[ref_oid];
        END IF;
        FOREACH ref_oid IN ARRAY refs LOOP
          IF ref_oid=0 THEN
            IF NOT fk.is_opt AND NOT(cat_name='pg_policy' AND field_name='polroles') THEN RAISE EXCEPTION 'DELTA_MEMBER_REQUIRED_REFERENCE_MISSING'; END IF;
            ref_address:=CASE WHEN cat_name='pg_policy' AND field_name='polroles' THEN '"PUBLIC"'::jsonb ELSE 'null'::jsonb END;
          ELSE
            SELECT to_jsonb(a) INTO ref_address FROM pg_identify_object(fk.pktable,ref_oid,0) a;
            IF ref_address->>'identity' IS NULL THEN RAISE EXCEPTION 'DELTA_MEMBER_REFERENCE_UNRESOLVED'; END IF;
          END IF;
          mapped:=mapped||jsonb_build_array(ref_address);
        END LOOP;
        normalized:=jsonb_set(normalized,ARRAY[field_name],CASE WHEN fk.is_array THEN mapped ELSE mapped->0 END);
        processed:=array_append(processed,field_name);
      END LOOP;
      FOR col IN SELECT a.attname,a.atttypid FROM pg_attribute a WHERE a.attrelid=cat_oid AND a.attnum>0 AND NOT a.attisdropped LOOP
        IF col.attname=ANY(processed) OR raw_row->col.attname IS NULL OR raw_row->col.attname='null'::jsonb THEN CONTINUE; END IF;
        field_name:=col.attname;
        IF col.atttypid='pg_node_tree'::regtype THEN
          rendered:=NULL;
          IF cat_name='pg_proc' AND col.attname='proargdefaults' THEN rendered:=pg_get_function_arguments((raw_row->>'oid')::oid);
          ELSIF cat_name='pg_proc' AND col.attname='prosqlbody' AND raw_row->>'prokind'<>'a' THEN rendered:=pg_get_functiondef((raw_row->>'oid')::oid);
          ELSIF cat_name='pg_type' AND col.attname='typdefaultbin' THEN SELECT pg_get_expr(t.typdefaultbin,0) INTO rendered FROM pg_type t WHERE t.oid=(raw_row->>'oid')::oid;
          ELSIF cat_name='pg_class' AND col.attname='relpartbound' THEN SELECT pg_get_expr(t.relpartbound,t.oid) INTO rendered FROM pg_class t WHERE t.oid=(raw_row->>'oid')::oid;
          ELSIF cat_name='pg_constraint' AND col.attname='conbin' THEN rendered:=pg_get_constraintdef((raw_row->>'oid')::oid,true);
          ELSIF cat_name='pg_attrdef' AND col.attname='adbin' THEN SELECT pg_get_expr(t.adbin,t.adrelid) INTO rendered FROM pg_attrdef t WHERE t.oid=(raw_row->>'oid')::oid;
          ELSIF cat_name='pg_index' AND col.attname IN ('indexprs','indpred') THEN rendered:=pg_get_indexdef((raw_row->>'indexrelid')::oid);
          ELSIF cat_name='pg_partitioned_table' AND col.attname='partexprs' THEN rendered:=pg_get_partkeydef((raw_row->>'partrelid')::oid);
          ELSIF cat_name='pg_policy' AND col.attname IN ('polqual','polwithcheck') THEN EXECUTE format('SELECT pg_get_expr(%I,polrelid) FROM pg_policy WHERE oid=$1',col.attname) INTO rendered USING (raw_row->>'oid')::oid;
          ELSIF cat_name='pg_rewrite' AND col.attname IN ('ev_action','ev_qual') THEN rendered:=pg_get_ruledef((raw_row->>'oid')::oid,true);
          ELSIF cat_name='pg_trigger' AND col.attname='tgqual' THEN rendered:=pg_get_triggerdef((raw_row->>'oid')::oid,true);
          ELSIF cat_name='pg_statistic_ext' AND col.attname='stxexprs' THEN rendered:=pg_get_statisticsobjdef((raw_row->>'oid')::oid);
          END IF;
          IF rendered IS NULL THEN RAISE EXCEPTION 'DELTA_MEMBER_NODE_TREE_UNSUPPORTED'; END IF;
          normalized:=jsonb_set(normalized,ARRAY[col.attname],to_jsonb(rendered));
        ELSIF col.atttypid=ANY(ARRAY['oid'::regtype,'oidvector'::regtype,'oid[]'::regtype,'regproc'::regtype,'regprocedure'::regtype,'regoper'::regtype,'regoperator'::regtype,'regclass'::regtype,'regtype'::regtype,'regnamespace'::regtype,'regrole'::regtype,'regcollation'::regtype]) THEN
          RAISE EXCEPTION 'DELTA_MEMBER_OID_FIELD_UNSUPPORTED';
        END IF;
      END LOOP;
      member_hashes:=array_append(member_hashes,encode(sha256(convert_to(jsonb_build_object('extension',item.v->'extension','catalog',cat_name,'owner',item.v->'owner','row',normalized)::text,'UTF8')),'hex'));
    END LOOP;
    SELECT encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') INTO digest FROM unnest(member_hashes) h;
    components:=components||jsonb_build_array(jsonb_build_object('category','extension-members','coverage','complete','objectCount',cardinality(member_hashes),'sha256',digest));
  EXCEPTION WHEN OTHERS THEN
    -- Closed diagnostic labels only. Never return SQL error text, row contents,
    -- function source, exception detail or context from a provider database.
    unsupported:=unsupported||jsonb_build_array('extension-members:unsupported-unreadable-or-unbounded',
      'extension-members:sqlstate:'||SQLSTATE,
      'extension-members:reason:'||CASE WHEN SQLERRM IN ('DELTA_MEMBER_CATALOG_UNSUPPORTED','DELTA_MEMBER_ADDRESS_UNSUPPORTED','DELTA_MEMBER_ROW_MISSING','DELTA_MEMBER_BOUND',
        'DELTA_MEMBER_REQUIRED_REFERENCE_MISSING','DELTA_MEMBER_REFERENCE_UNRESOLVED','DELTA_MEMBER_NODE_TREE_UNSUPPORTED','DELTA_MEMBER_OID_FIELD_UNSUPPORTED','DELTA_MEMBER_ALIAS_LOCATOR_UNSUPPORTED') THEN SQLERRM ELSE 'UNREADABLE' END,
      'extension-members:catalog:'||CASE WHEN cat_name=ANY(known_member_catalogs||ARRAY['pg_aggregate','pg_enum','pg_range','pg_attribute','pg_index','pg_partitioned_table','pg_sequence','pg_foreign_table','pg_inherits','pg_ts_config_map','pg_amop','pg_amproc','pg_depend','pg_shdepend','pg_init_privs','pg_description','pg_seclabel']) THEN cat_name ELSE 'unknown' END,
      'extension-members:field:'||CASE WHEN field_name=ANY(ARRAY['prolang','proowner','prorettype','proargtypes','proallargtypes','prosupport','proargdefaults','prosqlbody',
        'typnamespace','typowner','typrelid','typelem','typarray','typinput','typoutput','typreceive','typsend','typmodin','typmodout','typanalyze','typsubscript','typbasetype','typcollation','typdefaultbin',
        'amhandler','opcfamily','opcnamespace','opcowner','opcmethod','opcintype','opckeytype','opfmethod','opfnamespace','opfowner',
        'amopfamily','amoplefttype','amoprighttype','amopopr','amopmethod','amopsortfamily','amprocfamily','amproclefttype','amprocrighttype','amproc',
        'oprnamespace','oprowner','oprleft','oprright','oprresult','oprcode','oprcom','oprnegate','oprrest','oprjoin','aggfnoid','aggtransfn','aggfinalfn','aggcombinefn','aggserialfn','aggdeserialfn','aggmtransfn','aggminvtransfn','aggmfinalfn','aggsortop','aggtranstype','aggmtranstype']) THEN field_name ELSE 'unknown' END);
  END;
  PERFORM set_config('adfocate.delta_semantic_collection',jsonb_build_object('schemaVersion',1,'kind','delta-semantic-components',
    'serverVersionNum',current_setting('server_version_num'),'databaseName',current_database(),'transactionReadOnly',current_setting('transaction_read_only')='on',
    'isolationLevel',current_setting('transaction_isolation'),'extensionProfileHash',profile_hash,'components',components,'unsupported',unsupported)::text,true);
END;
$delta_semantic_capture$;
SELECT current_setting('adfocate.delta_semantic_collection')::jsonb AS delta_semantic_collection;
