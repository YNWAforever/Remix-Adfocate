#!/bin/sh
# The caller must use the reviewed local image, --network=none, no ports,
# a read-only root and backup mount, and private /tmp tmpfs. No source credentials.
set -eu
unset PGPASSWORD PGOPTIONS PGSERVICE PGSERVICEFILE PGHOSTADDR PGSSLCERT PGSSLKEY
# The source's actual OID-10 bootstrap role was independently checked read-only.
# Matching it preserves pg_dumpall's original GRANTED BY semantics.
export PGHOST=/tmp PGPORT=5432 PGUSER=supabase_admin PGDATABASE=postgres
export PGPASSFILE=/tmp/koc-no-password-file PGCONNECT_TIMEOUT=5
phase=initialize
fail() {
  error_class=UNCLASSIFIED
  error_state=NONE
  error_file=/tmp/no-error-file
  case "$phase" in
    roles_restore) error_file=/tmp/roles.error ;;
    database_restore|event_trigger_restore) error_file=/tmp/restore.error ;;
  esac
  if [ -r "$error_file" ]; then
    if grep -q 'invalid command' "$error_file"; then error_class=CLIENT_META_COMMAND_UNSUPPORTED
    elif grep -q 'already exists' "$error_file"; then error_class=OBJECT_ALREADY_EXISTS
    elif grep -q 'permission denied\|must be owner\|must be superuser' "$error_file"; then error_class=PRIVILEGE_ERROR
    elif grep -q 'is not available\|could not access file' "$error_file"; then error_class=EXTENSION_OR_LIBRARY_UNAVAILABLE
    elif grep -q 'WARNING:' "$error_file"; then error_class=WARNING_REQUIRES_REVIEW
    fi
    error_state=$(grep -Eo '(ERROR|FATAL|WARNING):[[:space:]]+[0-9A-Z]{5}([[:space:]]|$)' "$error_file" | head -n 1 | sed -E 's/.*:[[:space:]]*([0-9A-Z]{5}).*/\1/' || true)
    test -n "$error_state" || error_state=NONE
  fi
  # At this stage only native pg_dumpall role statements have run in a fresh
  # local cluster. Classify fixed PostgreSQL wording; never emit identifiers,
  # values, SQL text or raw diagnostics.
  if [ "$phase" = roles_restore ] && [ -r "$error_file" ]; then
    if grep -q 'permission denied to alter role' "$error_file"; then error_class=ALTER_ROLE_DENIED
    elif grep -q 'permission denied to create role' "$error_file"; then error_class=CREATE_ROLE_DENIED
    elif grep -q 'permission denied to grant role' "$error_file"; then error_class=GRANT_ROLE_DENIED
    elif grep -q 'must have admin option' "$error_file"; then error_class=ROLE_ADMIN_OPTION_REQUIRED
    elif grep -q 'must be superuser' "$error_file"; then error_class=SUPERUSER_REQUIRED
    elif grep -q 'reserved role\|reserved roles' "$error_file"; then error_class=RESERVED_ROLE_PROTECTION
    elif grep -q 'permission denied to set parameter' "$error_file"; then error_class=ROLE_PARAMETER_DENIED
    fi
  fi
  if [ "$phase" = database_restore ] && [ -r "$error_file" ]; then
    if grep -q 'permission denied for schema' "$error_file"; then error_class=SCHEMA_ACCESS_DENIED
    elif grep -q 'permission denied for table' "$error_file"; then error_class=TABLE_ACCESS_DENIED
    elif grep -q 'permission denied for database' "$error_file"; then error_class=DATABASE_ACCESS_DENIED
    elif grep -q 'permission denied to create extension' "$error_file"; then error_class=EXTENSION_CREATE_DENIED
    elif grep -q 'permission denied to set parameter' "$error_file"; then error_class=PARAMETER_ACCESS_DENIED
    elif grep -q 'must be owner of extension' "$error_file"; then error_class=EXTENSION_OWNER_REQUIRED
    elif grep -q 'must be owner of event trigger' "$error_file"; then error_class=EVENT_TRIGGER_OWNER_REQUIRED
    elif grep -q 'must be superuser' "$error_file"; then error_class=SUPERUSER_REQUIRED
    fi
  fi
  error_line=0
  statement_type=UNKNOWN
  if [ "$phase" = roles_restore ] && [ -r "$error_file" ]; then
    error_line=$(sed -n 's/^psql:\/backup\/roles.sql:\([0-9][0-9]*\):.*/\1/p' "$error_file" | head -n 1)
    test -n "$error_line" || error_line=0
    statement_type=$(awk -v n="$error_line" 'NR==n { if ($0 ~ /^CREATE ROLE /) print "CREATE_ROLE"; else if ($0 ~ /^ALTER ROLE / && $0 ~ / SET /) print "ALTER_ROLE_SETTING"; else if ($0 ~ /^ALTER ROLE /) print "ALTER_ROLE_ATTRIBUTES"; else if ($0 ~ /^GRANT /) print "ROLE_GRANT"; else print "OTHER"; }' /backup/roles.sql)
    test -n "$statement_type" || statement_type=UNKNOWN
  fi
  error_keywords=NONE
  if [ -r "$error_file" ]; then
    error_keywords=$(grep 'ERROR:' "$error_file" | grep -Eo '\b(role|schema|table|database|extension|event|trigger|parameter|publication|file|owner|superuser|superusers|reserved|replication|setting|tablespace)\b' | sort -u | paste -sd ',' || true)
    test -n "$error_keywords" || error_keywords=NONE
  fi
  printf '{"status":"RESTORE_NOT_VERIFIED","phase":"%s","errorClass":"%s","sqlState":"%s","roleStatementLine":%s,"roleStatementType":"%s","errorKeywords":"%s","localBootstrap":' "$phase" "$error_class" "$error_state" "$error_line" "$statement_type" "$error_keywords"
  if [ -s /tmp/bootstrap.json ]; then cat /tmp/bootstrap.json; else printf 'null'; fi
  printf '}\n'
  exit 1
}
trap 'pg_ctl -D /tmp/koc-restore-data -m immediate -w stop >/dev/null 2>&1 || true' EXIT
test -r /backup/database.dump && test -r /backup/roles.sql && test -r /checks.sql || fail
initdb -D /tmp/koc-restore-data -U supabase_admin --auth-local=trust --auth-host=reject --locale=C --encoding=UTF8 >/tmp/init.log 2>&1 || fail
# Match the source's managed event-trigger ownership support. No schedulers,
# network workers, source secrets or hosted services are started.
pg_ctl -D /tmp/koc-restore-data -l /tmp/server.log -o "-c listen_addresses='' -c unix_socket_directories=/tmp -c shared_preload_libraries='' -c session_preload_libraries=supautils -c supautils.privileged_role=supabase_privileged_role -c log_statement=none" -w start >/tmp/start.log 2>&1 || fail
psql -X -w -qAt --set=ON_ERROR_STOP=1 --command "SELECT json_build_object('superuser',rolsuper,'createrole',rolcreaterole,'session_user',session_user,'shared_preload',current_setting('shared_preload_libraries'),'session_preload',current_setting('session_preload_libraries'),'local_preload',current_setting('local_preload_libraries')) FROM pg_roles WHERE rolname=current_user;" >/tmp/bootstrap.json 2>/tmp/bootstrap.error || fail
phase=roles_restore
# initdb already created precisely this role. Remove only that redundant CREATE
# in a tmpfs copy; retain every original ALTER, membership and grantor statement.
test "$(grep -Fxc 'CREATE ROLE supabase_admin;' /backup/roles.sql)" = 1 || fail
sed '/^CREATE ROLE supabase_admin;$/d' /backup/roles.sql >/tmp/roles-for-existing-bootstrap.sql
psql -X -w -q --set=ON_ERROR_STOP=1 --set=VERBOSITY=terse --file=/tmp/roles-for-existing-bootstrap.sql >/tmp/roles.output 2>/tmp/roles.error || fail
test ! -s /tmp/roles.error || fail
phase=isolated_control_database
createdb -w koc_restore_control >/tmp/createdb.output 2>/tmp/createdb.error || fail
phase=complete_archive_partition
pg_restore --list /backup/database.dump >/tmp/toc.all 2>/tmp/toc.error || fail
test ! -s /tmp/toc.error || fail
# Managed event triggers must be created under their original owner so supautils
# can preserve its non-superuser protections. Every TOC entry is retained once.
awk '!(/^[0-9]+;/ && / EVENT TRIGGER /)' /tmp/toc.all >/tmp/toc.base
awk '/^[0-9]+;/ && / EVENT TRIGGER /' /tmp/toc.all >/tmp/toc.events
test -s /tmp/toc.events || fail
awk '/^[0-9]+;/ {print $1}' /tmp/toc.all | sort >/tmp/toc.expected.ids
cat /tmp/toc.base /tmp/toc.events | awk '/^[0-9]+;/ {print $1}' | sort >/tmp/toc.actual.ids
cmp -s /tmp/toc.expected.ids /tmp/toc.actual.ids || fail
phase=database_restore
# Only the disposable local postgres database is dropped/recreated. The control
# connection is a different local database; Unix socket + no network is mandatory.
pg_restore --no-password --exit-on-error --clean --if-exists --create --use-list=/tmp/toc.base --dbname=koc_restore_control /backup/database.dump >/tmp/restore.output 2>/tmp/restore.error || fail
test ! -s /tmp/restore.error || fail
phase=event_trigger_restore
pg_restore --no-password --exit-on-error --use-set-session-authorization --use-list=/tmp/toc.events --dbname=postgres /backup/database.dump >/tmp/restore.output 2>/tmp/restore.error || fail
test ! -s /tmp/restore.error || fail
phase=original_column_fingerprints
psql -X -w -qAt --set=ON_ERROR_STOP=1 --file=/checks.sql >/tmp/fingerprints.json 2>/tmp/checks.error || fail
test ! -s /tmp/checks.error && test -s /tmp/fingerprints.json || fail
phase=restored_database_metadata
psql -X -w -qAt --set=ON_ERROR_STOP=1 >/tmp/metadata.json 2>/tmp/metadata.error <<'SQL' || fail
BEGIN READ ONLY;
SELECT json_build_object(
 'database',current_database(), 'server_version_num',current_setting('server_version_num')::int,
 'public_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
 'auth_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relkind IN ('r','p')),
 'storage_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relkind IN ('r','p')),
 'public_policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public'),
 'event_triggers',(SELECT count(*) FROM pg_event_trigger),
 'migration_rows',(SELECT count(*) FROM supabase_migrations.schema_migrations));
ROLLBACK;
SQL
test ! -s /tmp/metadata.error && test -s /tmp/metadata.json || fail
phase=local_shutdown
pg_ctl -D /tmp/koc-restore-data -m fast -w stop >/tmp/stop.log 2>&1 || fail
trap - EXIT
printf '{"status":"RESTORE_EXECUTED_PENDING_SOURCE_COMPARISON","metadata":'
cat /tmp/metadata.json
printf ',"originalData":'
cat /tmp/fingerprints.json
printf '}\n'
