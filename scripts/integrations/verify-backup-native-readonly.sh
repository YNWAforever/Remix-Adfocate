#!/bin/sh
# Synthetic PostgreSQL 17 proof only. Run in a network-disabled disposable
# container with a read-only root and /tmp tmpfs; never mount real backups.
set -eu
export PGHOST=/tmp PGUSER=koc_backup_probe PGDATABASE=postgres
unset PGOPTIONS PGPASSWORD PGSERVICE PGSERVICEFILE
export PGPASSFILE=/tmp/koc-no-password-file PGCONNECT_TIMEOUT=5
phase=initialize
fail() {
  printf 'FAILED: %s\n' "$phase"
  # This proof contains synthetic fixtures only and has no network or secrets.
  if [ "$phase" = native_dump ]; then cat /tmp/dump.error; fi
  exit 1
}
trap 'pg_ctl -D /tmp/koc-probe-db -m immediate -w stop >/dev/null 2>&1 || true' EXIT
initdb -D /tmp/koc-probe-db -U koc_backup_probe --auth-local=trust --auth-host=reject --no-locale >/tmp/init.log 2>&1 || fail
pg_ctl -D /tmp/koc-probe-db -l /tmp/probe.log -o "-c listen_addresses='' -c unix_socket_directories=/tmp -c log_statement=all -c log_line_prefix='%a|'" -w start >/tmp/start.log 2>&1 || fail
phase=synthetic_fixture
PGAPPNAME=koc_fixture_seed psql -X -w -q -v ON_ERROR_STOP=1 > /tmp/seed.log 2>&1 <<'SQL' || fail
CREATE TABLE public.backup_probe(id integer PRIMARY KEY, note text NOT NULL);
INSERT INTO public.backup_probe VALUES (1, 'synthetic example one'), (2, 'synthetic example two');
CREATE SCHEMA auth;
CREATE TABLE auth.backup_probe(id integer PRIMARY KEY);
INSERT INTO auth.backup_probe VALUES (1);
CREATE SCHEMA storage;
CREATE TABLE storage.backup_probe(id integer PRIMARY KEY);
INSERT INTO storage.backup_probe VALUES (1);
SQL
phase=explicit_metadata_transaction
PGAPPNAME=koc_metadata_probe psql -X -w -qAt -v ON_ERROR_STOP=1 > /tmp/metadata.result 2>/tmp/metadata.error <<'SQL' || fail
BEGIN READ ONLY;
SET LOCAL row_security = off;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT current_setting('default_transaction_read_only')='off'
 AND current_setting('transaction_read_only')='on'
 AND current_setting('row_security')='off';
ROLLBACK;
SQL
grep -qx 't' /tmp/metadata.result || fail
phase=metadata_write_rejection
if PGAPPNAME=koc_negative_write psql -X -w -q -v ON_ERROR_STOP=1 --command "BEGIN READ ONLY; UPDATE public.backup_probe SET note='must never persist';" >/tmp/negative.result 2>/tmp/negative.error; then fail; fi
grep -q 'read-only transaction' /tmp/negative.error || fail
phase=native_dump
PGAPPNAME=koc_native_dump pg_dump -w --format=custom --create --lock-wait-timeout=5s --file=/tmp/probe.dump >/tmp/dump.output 2>/tmp/dump.error || fail
test ! -s /tmp/dump.output && test ! -s /tmp/dump.error || fail
phase=native_roles_export
PGAPPNAME=koc_native_roles pg_dumpall -w --database=postgres --roles-only --no-role-passwords --file=/tmp/roles.sql >/tmp/roles.output 2>/tmp/roles.error || fail
test ! -s /tmp/roles.output && test ! -s /tmp/roles.error || fail
phase=unfiltered_archive_read
pg_restore --no-password --format=custom --file=/dev/null /tmp/probe.dump >/tmp/restore.output 2>/tmp/restore.error || fail
test ! -s /tmp/restore.output && test ! -s /tmp/restore.error || fail
phase=native_transaction_evidence
grep -F 'koc_native_dump|' /tmp/probe.log > /tmp/dump.statements || fail
grep -F 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY' /tmp/dump.statements >/dev/null || fail
grep -F 'SET row_security = off' /tmp/dump.statements >/dev/null || fail
grep -F 'COPY public.backup_probe' /tmp/dump.statements >/dev/null || fail
if grep -E 'statement: (INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO)[[:space:]]' /tmp/dump.statements >/dev/null; then fail; fi
phase=roles_catalog_queries_only
grep -F 'koc_native_roles|' /tmp/probe.log | grep 'statement:' > /tmp/roles.statements || fail
test -s /tmp/roles.statements || fail
if grep -v 'statement: SELECT ' /tmp/roles.statements >/dev/null; then fail; fi
phase=original_synthetic_rows_unchanged
PGAPPNAME=koc_final_probe psql -X -w -qAt -v ON_ERROR_STOP=1 --command "SELECT count(*)=2 AND bool_and(note IN ('synthetic example one','synthetic example two')) FROM public.backup_probe;" > /tmp/final.result 2>/tmp/final.error || fail
grep -qx 't' /tmp/final.result || fail
printf '%s\n' 'PASS: explicit metadata transaction remained read-only with default_read_only=off.'
printf '%s\n' 'PASS: attempted synthetic UPDATE was rejected; original rows unchanged.'
printf '%s\n' 'PASS: pinned native pg_dump issued READ ONLY and row_security=off before extraction.'
printf '%s\n' 'PASS: native roles-only exporter issued catalog SELECT statements only.'
printf '%s\n' 'PASS: synthetic custom archive fully read offline; no real backup or remote database accessed.'
