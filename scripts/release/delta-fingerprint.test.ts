// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELTA_EXPORT_COMPONENTS } from "./delta-release-contracts";
import { digestDeltaProofPayload, digestDeltaSemanticFingerprint } from "./delta-evidence";
import { DELTA_DUMP_RESTRICT_KEY, canonicalizeDeltaSchemaExport, buildDeltaSemanticFingerprint, parseDeltaSemanticCollection,
  deriveSemanticComponents, normalizeDeltaInvariant, assertDeltaInvariantTransition, type DeltaFingerprintBinding } from "./delta-fingerprint";

// Credential-free single-connection WASM fixtures only; no native PostgreSQL,
// network, source backup, provider Auth, release evidence or external credentials.
// Unvalidated, deliberately mutable negative-test inputs cannot use proof types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutableFixture = Record<string, any>;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const dump = (statements: string) => `-- PostgreSQL database dump\n-- Dumped from database version 17.6\n-- Dumped by pg_dump version 17.11\n\\restrict ${DELTA_DUMP_RESTRICT_KEY}\nCREATE DATABASE "postgres" WITH TEMPLATE = template0;\n\\unrestrict ${DELTA_DUMP_RESTRICT_KEY}\n\\connect postgres\n\\restrict ${DELTA_DUMP_RESTRICT_KEY}\n${statements}\n-- PostgreSQL database dump complete\n\\unrestrict ${DELTA_DUMP_RESTRICT_KEY}\n`;
const collection = () => ({ schemaVersion: 1, kind: "delta-semantic-components", serverVersionNum: "170006", databaseName: "postgres",
  transactionReadOnly: true, isolationLevel: "repeatable read", extensionProfileHash: sha("synthetic-extension-profile"), unsupported: [],
  components: DELTA_EXPORT_COMPONENTS.filter(category => category !== "schema-export").map(category => ({ category, coverage: "complete", objectCount: 1, sha256: sha(category) })) });
const binding = (): DeltaFingerprintBinding => ({ scopeDigest: sha("scope"), collectorSha256: sha("collector"), canonicalizerSha256: sha("canonicalizer"),
  targetBindingHash: sha("target"), snapshotBindingHash: sha("snapshot"), observedAt: "2026-11-13T16:00:00Z", expiresAt: "2026-11-13T16:30:00Z",
  environment: { serverVersionNum: "170006", dumpVersion: "17.11", extensionProfileHash: sha("synthetic-extension-profile"), databaseName: "postgres" } });
let db: PGlite;
beforeAll(async () => { db = await PGlite.create("memory://"); }, 60000);
afterAll(async () => { await db?.close(); });

describe("complete canonical export", () => {
  it("sorts top-level statements as a multiset and strips only external dump comments", () => {
    const a = canonicalizeDeltaSchemaExport(dump('CREATE TYPE "public"."mood" AS ENUM (\'new\',\'old\');\n-- Dump comment\nCREATE TABLE "public"."x" ("id" integer);'));
    const b = canonicalizeDeltaSchemaExport(dump('CREATE TABLE "public"."x" ("id" integer);\nCREATE TYPE "public"."mood" AS ENUM (\'new\',\'old\');'));
    expect(a).toEqual(b);
    expect(canonicalizeDeltaSchemaExport(dump('CREATE TABLE "public"."x" ("id" integer);\nCREATE TABLE "public"."x" ("id" integer);')).sha256).not.toBe(b.sha256);
    expect(JSON.stringify(a)).not.toContain("CREATE TYPE");
  });
  it("preserves literal, dollar-body and SQL-standard-body comments, case expressions and semicolons", () => {
    const sql = `CREATE FUNCTION "public"."f"() RETURNS text LANGUAGE sql AS $body$SELECT '-- retained; /* literal */'; -- body comment\n$body$;\nCREATE FUNCTION "public"."g"() RETURNS integer LANGUAGE sql BEGIN ATOMIC SELECT CASE WHEN true THEN 1 ELSE 2 END; RETURN 3; END;`;
    const result = canonicalizeDeltaSchemaExport(dump(sql));
    expect(result.objectCount).toBe(3);
    expect(canonicalizeDeltaSchemaExport(dump(sql.replace("body comment", "changed comment"))).sha256).not.toBe(result.sha256);
    expect(canonicalizeDeltaSchemaExport(dump(sql.replace("RETURN 3", "/* retained body comment */ RETURN 3"))).sha256).not.toBe(result.sha256);
  });
  it.each(["\\! whoami", "\\i arbitrary.sql", "\\connect other", "\\restrict wrong", "\\copy x to stdout"])("rejects unreviewed psql meta-command %s", command => {
    expect(() => canonicalizeDeltaSchemaExport(dump(`${command}\nCREATE TABLE "public"."x" ("id" integer);`))).toThrow("Delta fingerprint rejected");
  });
  it.each(["CREATE TABLE x (id integer)", "CREATE FUNCTION f() RETURNS text AS $$missing;", "CREATE TABLE x (id integer;", "INSERT INTO x VALUES (1);"])("rejects incomplete or non-schema SQL", sql => {
    expect(() => canonicalizeDeltaSchemaExport(dump(sql))).toThrow("Delta fingerprint rejected");
  });
  it("binds effective SET context so swapped access methods or tablespaces cannot collide", () => {
    for (const setting of ["default_table_access_method", "default_tablespace"]) {
      const a = dump(`SET ${setting} = 'first';\nCREATE TABLE "public"."a" ("id" integer);\nSET ${setting} = 'second';\nCREATE TABLE "public"."b" ("id" integer);`);
      const b = dump(`SET ${setting} = 'second';\nCREATE TABLE "public"."a" ("id" integer);\nSET ${setting} = 'first';\nCREATE TABLE "public"."b" ("id" integer);`);
      expect(canonicalizeDeltaSchemaExport(a).sha256).not.toBe(canonicalizeDeltaSchemaExport(b).sha256);
    }
    expect(()=>canonicalizeDeltaSchemaExport(dump("SET standard_conforming_strings = off;"))).toThrow("unsupported string interpretation");
    expect(()=>canonicalizeDeltaSchemaExport(dump("SET ROLE authenticated;"))).toThrow("unreviewed dump setting");
  });
  it("preserves CRLF inside body and literal values", () => {
    const sql = `CREATE FUNCTION "public"."newline"() RETURNS text LANGUAGE sql AS $$SELECT 'a\nb'$$;`;
    expect(canonicalizeDeltaSchemaExport(dump(sql.replace('a\nb','a\r\nb'))).sha256).not.toBe(canonicalizeDeltaSchemaExport(dump(sql)).sha256);
  });
  it("accepts the actual two-block PG17.11 create/connect framing",()=>{
    const source=dump('CREATE TABLE "public"."x" ("id" integer);'),slash=String.fromCharCode(92);
    expect(canonicalizeDeltaSchemaExport(source).objectCount).toBe(2);
    const quoted=source.replace(slash+'connect postgres',slash+'connect "postgres"');
    expect(quoted).not.toBe(source);
    expect(canonicalizeDeltaSchemaExport(quoted)).toEqual(canonicalizeDeltaSchemaExport(source));
  });
  it.each(['missing-prelude-close','missing-second-open','wrong-prelude-key','wrong-db','sql-unrestricted','extra-command'])("rejects malformed native framing: %s",kind=>{
    const original=dump('CREATE TABLE "public"."x" ("id" integer);'),slash=String.fromCharCode(92),lf=String.fromCharCode(10);
    let source=original;
    const close=slash+`unrestrict ${DELTA_DUMP_RESTRICT_KEY}`,open=slash+`restrict ${DELTA_DUMP_RESTRICT_KEY}`;
    if(kind==='missing-prelude-close')source=source.replace(close,'');
    if(kind==='missing-second-open')source=source.replace(slash+'connect postgres'+lf+open,slash+'connect postgres');
    if(kind==='wrong-prelude-key')source=source.replace(close,slash+'unrestrict wrong');
    if(kind==='wrong-db')source=source.replace(slash+'connect postgres',slash+'connect other');
    if(kind==='sql-unrestricted')source=source.replace(close,close+lf+'CREATE TABLE "public"."unsafe" ("id" integer);');
    if(kind==='extra-command')source=source.replace(close,close+lf+slash+'i arbitrary.sql');
    expect(source).not.toBe(original);
    expect(()=>canonicalizeDeltaSchemaExport(source)).toThrow('Delta fingerprint rejected');
  });
  it("requires the exact complete PG17.11 envelope", () => {
    const source = dump('CREATE TABLE "public"."x" ("id" integer);');
    for (const invalid of [source.replace("17.11", "17.6"), source.replace("database dump complete", "incomplete"), source.replace(`\\unrestrict ${DELTA_DUMP_RESTRICT_KEY}`, ""), source.replace('CREATE DATABASE "postgres"', 'CREATE DATABASE "other"')]) {
      expect(() => canonicalizeDeltaSchemaExport(invalid)).toThrow("Delta fingerprint rejected");
    }
  });
  it("makes schema/type/enum/owner/ACL/operator/policy changes visible", () => {
    const sql = `CREATE TYPE "public"."mood" AS ENUM ('new','old');\nCREATE DOMAIN "public"."positive" AS integer CHECK (VALUE > 0);\nCREATE TABLE "public"."x" ("id" integer);\nALTER TABLE "public"."x" OWNER TO "postgres";\nGRANT SELECT ON TABLE "public"."x" TO "authenticated";\nCREATE OPERATOR "public".=== (FUNCTION = "public"."same", LEFTARG = integer, RIGHTARG = integer);\nCREATE POLICY "p" ON "public"."x" USING ("id" > 0);`;
    const hash = canonicalizeDeltaSchemaExport(dump(sql)).sha256;
    for (const mutation of [sql.replace("'new','old'", "'old','new'"), sql.replace("VALUE > 0", "VALUE >= 0"), sql.replace('OWNER TO "postgres"', 'OWNER TO "other"'), sql.replace("GRANT SELECT", "GRANT ALL"), sql.replace('"same"', '"different"'), sql.replace('"id" > 0', '"id" >= 0')]) {
      expect(canonicalizeDeltaSchemaExport(dump(mutation)).sha256).not.toBe(hash);
    }
  });
});

describe("strict shared semantic root", () => {
  const sql = dump('CREATE TABLE "public"."x" ("id" integer);');
  it("builds all seven components using the evidence peer's root projection", () => {
    const result = buildDeltaSemanticFingerprint(sql, collection(), binding());
    expect(result.components.map(component => component.category).sort()).toEqual([...DELTA_EXPORT_COMPONENTS].sort());
    expect(result.rootSha256).toBe(digestDeltaSemanticFingerprint(result));
    const changedBinding = buildDeltaSemanticFingerprint(sql, collection(), { ...binding(), targetBindingHash: sha("clone"), snapshotBindingHash: sha("clone snapshot"), observedAt: "2026-11-13T16:01:00Z" });
    expect(changedBinding.rootSha256).toBe(result.rootSha256);
    expect(digestDeltaProofPayload(changedBinding)).not.toBe(digestDeltaProofPayload(result));
  });
  it("fails closed on incomplete, unknown, duplicate or unreadable extension-member coverage", () => {
    const original = collection();
    for (const mutate of [(r: MutableFixture) => r.components.pop(), (r: MutableFixture) => r.components.push(r.components[0]),
      (r: MutableFixture) => r.components[0].category = "unknown", (r: MutableFixture) => r.unsupported.push("pg_unknown"),
      (r: MutableFixture) => r.components.find((c: MutableFixture) => c.category === "extension-members").coverage = "partial"]) {
      const row = structuredClone(original); mutate(row);
      expect(() => deriveSemanticComponents(sql, row)).toThrow("Delta fingerprint rejected");
    }
    expect(() => parseDeltaSemanticCollection('{"bad":')).toThrow("collection JSON");
  });
  it("binds role, settings, storage, extension membership and history tampering to the root", () => {
    const expected = buildDeltaSemanticFingerprint(sql, collection(), binding());
    for (const category of DELTA_EXPORT_COMPONENTS.filter(category => category !== "schema-export")) {
      const row = collection(); row.components.find(component => component.category === category)!.sha256 = sha("changed " + category);
      expect(buildDeltaSemanticFingerprint(sql, row, binding()).rootSha256).not.toBe(expected.rootSha256);
    }
  });
});

it("WASM exposes catalog foreign-key reference metadata required by the honest normalizer", async () => {
  const result = await db.query<{ row: Record<string, unknown> }>("select to_jsonb(f) as row from pg_catalog.pg_get_catalog_foreign_keys() f limit 1");
  expect(Object.keys(result.rows[0]!.row).sort()).toEqual(["fktable", "fkcols", "pktable", "pkcols", "is_array", "is_opt"].sort());
});

let semanticSql: string, invariantSql: string, sourceSql: string;
function wasmKernel(sql: string): string {
  // PGlite 0.5.11 is PG18. ONLY this in-memory unit-test copy changes the major
  // guard to exercise SQL kernels. Production files stay PG17-only; raw WASM
  // reports retain PG18 and cannot pass the native fingerprint normalizer.
  const guard = "current_setting('server_version_num')::int / 10000 <> 17";
  expect(sql.split(guard)).toHaveLength(2);
  return sql.replace(guard, "current_setting('server_version_num')::int / 10000 <> 18");
}
async function collectFrom(target: PGlite, sql: string, key: string): Promise<MutableFixture> {
  const results = await target.exec(sql);
  const rows = results.flatMap(result => result.rows) as MutableFixture[];
  return rows.find(row => Object.hasOwn(row, key))![key];
}
async function collect(sql: string, key: string) { return collectFrom(db,sql,key); }
beforeAll(async () => {
  [semanticSql, invariantSql, sourceSql] = await Promise.all([
    readFile("scripts/release/delta-semantic-capture.sql", "utf8"),
    readFile("scripts/release/delta-invariant-capture.sql", "utf8"),
    readFile("supabase/migrations/20261113090001_active_assignment_xp_neutrality.sql", "utf8"),
  ]);
  await db.exec(`create schema private; create schema auth; create schema storage; create schema supabase_migrations;
    create role authenticated; create role service_role;
    create table storage.buckets(id text primary key,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    insert into storage.buckets values('fixture',false,1000,array['image/png']);
    create table auth.fixture_users(id integer primary key,marker text);insert into auth.fixture_users values(1,'synthetic');
    create type public.fixture_mood as enum('new','old');
    create domain public.fixture_positive as integer check(value>0);
    create table public.fixture_rows(id integer primary key,mood public.fixture_mood,amount public.fixture_positive,values_array integer[],raw_json json);
    insert into public.fixture_rows values(1,'new',10,array[1,2],'{"a":1,"a":2}');
    create schema pgsodium;create table pgsodium.fixture_config(id integer);insert into pgsodium.fixture_config values(1);
    create sequence public.fixture_sequence;
    create function private.join_mission(uuid) returns integer language plpgsql as $$begin return 1;end$$;
    create function public.accept_application(uuid) returns integer language plpgsql as $$begin return 1;end$$;
    create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
    insert into supabase_migrations.schema_migrations select '202610010000'||lpad(n::text,2,'0'),'fixture_'||n,array['select '||n||';'] from generate_series(0,16)n;`);
}, 60000);

describe("PG18-instrumented SQL kernels, never native PG17 release evidence", () => {
  it("rejects PG18 with each unmodified production collector", async () => {
    for (const sql of [semanticSql,invariantSql]) {
      await db.exec("begin isolation level repeatable read read only");
      try { await expect(db.exec(sql)).rejects.toThrow(/DELTA_(?:SEMANTIC_COLLECTOR|INVARIANT)_CONTEXT/); }
      finally { await db.exec("rollback"); }
    }
  });
  it("captures six SQL components without exporting source definitions, rows or role credentials", async () => {
    await db.exec("begin isolation level repeatable read read only");
    let raw: MutableFixture;
    try {
      const context = await db.query("select current_database() as db,current_setting('server_version_num')::int/10000 as major,current_setting('transaction_isolation') as isolation,current_setting('transaction_read_only') as readonly");
      expect(context.rows[0]).toEqual({ db: "postgres", major: 18, isolation: "repeatable read", readonly: "on" });
      raw = await collect(wasmKernel(semanticSql), "delta_semantic_collection");
    } finally { await db.exec("rollback"); }
    expect(raw!.unsupported).toEqual([]);
    expect(raw!.components.map((c: MutableFixture) => c.category).sort()).toEqual(DELTA_EXPORT_COMPONENTS.filter(category => category !== "schema-export").sort());
    expect(raw!.components.every((c: MutableFixture) => c.coverage === "complete" && /^[a-f0-9]{64}$/.test(c.sha256))).toBe(true);
    expect(JSON.stringify(raw!)).not.toMatch(/CREATE FUNCTION|synthetic|image\/png|fixture_0|rolpassword/);
    expect(() => parseDeltaSemanticCollection(raw!)).toThrow("collection incomplete or context");
  }, 60000);
  it("binds parameter ACL and shared role/database comment changes to the roles component",async()=>{
    const scenarios=[{sql:"GRANT SET ON PARAMETER log_statement TO authenticated;",reset:"REVOKE SET ON PARAMETER log_statement FROM authenticated;"},
      {sql:"COMMENT ON ROLE authenticated IS 'synthetic-role-comment';",reset:"COMMENT ON ROLE authenticated IS NULL;"},
      {sql:"COMMENT ON DATABASE postgres IS 'synthetic-database-comment';",reset:"COMMENT ON DATABASE postgres IS NULL;"}];
    for(const scenario of scenarios){const before=await memberCapture(db);try{await db.exec(scenario.sql);const after=await memberCapture(db);
      expect(after.unsupported).toEqual([]);
      const component=(v:MutableFixture)=>v.components.find((c:MutableFixture)=>c.category==='roles-and-memberships').sha256;
      expect(component(after)).not.toBe(component(before));
    }finally{await db.exec(scenario.reset);}}
  },60000);
  it("holds nonempty large objects and unreviewed global categories",async()=>{
    const created=await db.query<{oid:number}>("SELECT lo_create(0) AS oid");const oid=created.rows[0]!.oid;
    try{const raw=await memberCapture(db);expect(raw.unsupported).toContain('scope:large-objects-unreviewed');}
    finally{await db.query('SELECT lo_unlink($1)',[oid]);}
    await db.exec('begin isolation level repeatable read read only');
    try{const guarded=wasmKernel(semanticSql).replace("spcname NOT IN ('pg_default','pg_global')","spcname NOT IN ('pg_global')");
      const raw=await collect(guarded,'delta_semantic_collection');expect(raw.unsupported).toContain('scope:custom-tablespace-unreviewed');
    }finally{await db.exec('rollback');}
  },60000);
  it("normalizes overloaded aggregate/transition regproc references from original numeric catalog fields",async()=>{
    await db.exec(`CREATE SCHEMA alias_sem;
      CREATE FUNCTION alias_sem.acc(bigint,integer) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$SELECT coalesce($1,0)+$2$$;
      CREATE FUNCTION alias_sem.acc(bigint,smallint) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$SELECT coalesce($1,0)+$2$$;
      CREATE AGGREGATE alias_sem.total(integer)(SFUNC=alias_sem.acc,STYPE=bigint,INITCOND='0');
      CREATE AGGREGATE alias_sem.total(smallint)(SFUNC=alias_sem.acc,STYPE=bigint,INITCOND='0');`);
    const objects=['FUNCTION alias_sem.acc(bigint,integer)','FUNCTION alias_sem.acc(bigint,smallint)','AGGREGATE alias_sem.total(integer)','AGGREGATE alias_sem.total(smallint)'];const attached:string[]=[];
    try{for(const object of objects){await db.exec('ALTER EXTENSION plpgsql ADD '+object);attached.push(object);}const raw=await memberCapture(db);expect(raw.unsupported).toEqual([]);}
    finally{for(const object of attached.reverse())await db.exec('ALTER EXTENSION plpgsql DROP '+object);await db.exec('DROP SCHEMA alias_sem CASCADE');}
  },60000);
  it.each(['scalar','composite','array','domain'])("preserves physical overloaded regproc IDs in %s data despite identical text",async(kind)=>{
    await db.exec(`CREATE SCHEMA alias_data;
      CREATE FUNCTION alias_data.same(integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $$SELECT $1$$;
      CREATE FUNCTION alias_data.same(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT $1$$;
      CREATE TYPE alias_data.box AS(value regproc);CREATE DOMAIN alias_data.ref_domain AS regproc;
      CREATE TABLE alias_data.rows(s regproc,c alias_data.box,a regproc[],d alias_data.ref_domain);
      INSERT INTO alias_data.rows SELECT r,ROW(r)::alias_data.box,ARRAY[r],r::alias_data.ref_domain FROM(SELECT 'alias_data.same(integer)'::regprocedure::oid::regproc r)t;`);
    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try{const before=await collect(wasmKernel(invariantSql),'delta_transaction_invariant');expect(before.unsupported).toEqual([]);
      const textBefore=(await db.query<{value:string}>('SELECT t::text AS value FROM alias_data.rows t')).rows[0]!.value;
      const ref="'alias_data.same(text)'::regprocedure::oid::regproc";
      const assignment=kind==='scalar'?`s=${ref}`:kind==='composite'?`c=ROW(${ref})::alias_data.box`:kind==='array'?`a=ARRAY[${ref}]`:`d=(${ref})::alias_data.ref_domain`;
      await db.exec('UPDATE alias_data.rows SET '+assignment);
      const after=await collect(wasmKernel(invariantSql),'delta_transaction_invariant');expect(after.unsupported).toEqual([]);
      expect((await db.query<{value:string}>('SELECT t::text AS value FROM alias_data.rows t')).rows[0]!.value).toBe(textBefore);
      expect(after.catalogSha256).toBe(before.catalogSha256);expect(after.dataSha256).not.toBe(before.dataSha256);
    }finally{await db.exec('ROLLBACK;DROP SCHEMA alias_data CASCADE');}
  },60000);
  it.each(['scalar','composite','array','domain'])("holds nonempty cross-database configuration with %s OID aliases",async(kind)=>{
    await db.exec('CREATE SCHEMA alias_config;CREATE TYPE alias_config.box AS(value regproc);CREATE DOMAIN alias_config.ref_domain AS regproc');
    const type=kind==='scalar'?'regproc':kind==='composite'?'alias_config.box':kind==='array'?'regproc[]':'alias_config.ref_domain';
    try{await db.exec('ALTER TABLE storage.buckets ADD COLUMN unreviewed_alias '+type);const raw=await memberCapture(db);expect(raw.unsupported).toContain('storage-configuration:oid-alias-values-unreviewed');}
    finally{await db.exec('ALTER TABLE storage.buckets DROP COLUMN IF EXISTS unreviewed_alias;DROP SCHEMA alias_config CASCADE');}
  },60000);
  it("holds data types without binary send instead of falling back to row text",async()=>{
    await db.exec('CREATE TABLE public.alias_node_source(id integer DEFAULT 1);CREATE TABLE public.alias_no_binary(value pg_node_tree);INSERT INTO public.alias_no_binary SELECT adbin FROM pg_attrdef WHERE adrelid=\'public.alias_node_source\'::regclass');
    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try{
      // Deliberately remove binary-send support only in this disposable WASM
      // catalog fixture; production/native collectors are never instrumented.
      await db.exec("UPDATE pg_type SET typsend=0 WHERE oid='pg_node_tree'::regtype");
      expect((await db.query<{count:number}>('SELECT count(*)::integer AS count FROM public.alias_no_binary')).rows[0]!.count).toBe(1);
      const raw=await collect(wasmKernel(invariantSql),'delta_transaction_invariant');expect(raw.unsupported.some((entry:string)=>entry.startsWith('data:'))).toBe(true);
    }finally{await db.exec('ROLLBACK;DROP TABLE public.alias_no_binary,public.alias_node_source');}
  },60000);
  it("returns HOLD for unknown nonempty catalogs and unreadable user data", async () => {
    await db.exec("begin isolation level repeatable read");
    try {
      const unknown = wasmKernel(invariantSql).replace("'pg_enum','pg_event_trigger'","'pg_enum_unknown','pg_event_trigger'");
      expect(unknown).not.toBe(wasmKernel(invariantSql));
      const result = await collect(unknown,"delta_transaction_invariant");
      expect(result.unsupported.length).toBeGreaterThan(0);
      await db.exec("grant usage on schema private,auth,storage,supabase_migrations to authenticated;set local role authenticated");
      const unreadable = await collect(wasmKernel(invariantSql),"delta_transaction_invariant");
      expect(unreadable.unsupported.some((entry:string)=>entry.startsWith('data:'))).toBe(true);
    }finally{await db.exec('rollback');}
  },60000);
  it.each([
    ["enum", "alter type public.fixture_mood add value 'changed'"],
    ["domain", "alter domain public.fixture_positive add constraint upper_bound check(value<100)"],
    ["type", "alter table public.fixture_rows add column extra bigint"],
    ["ACL", "grant select on public.fixture_rows to authenticated"],
    ["owner", "alter table public.fixture_rows owner to service_role"],
    ["role", "alter role authenticated createdb"],
    ["bucket", "update storage.buckets set public=true"],
    ["Auth row", "update auth.fixture_users set marker='changed'"],
    ["user data", "update public.fixture_rows set amount=11"],
    ["array lower bound", "update public.fixture_rows set values_array='[0:1]={1,2}'::integer[]"],
    ["JSON duplicate keys", `update public.fixture_rows set raw_json='{"a":2}'::json`],
    ["provider namespace", "update pgsodium.fixture_config set id=2"],
    ["history", "update supabase_migrations.schema_migrations set name='changed' where version='20261001000000'"],
    ["sequence", "select nextval('public.fixture_sequence')"],
  ])("detects own %s changes inside the same RR snapshot", async (_kind, mutation) => {
    await db.exec("begin isolation level repeatable read");
    try {
      const before = await collect(wasmKernel(invariantSql), "delta_transaction_invariant");
      expect(before.unsupported).toEqual([]);
      await db.exec(mutation);
      const after = await collect(wasmKernel(invariantSql), "delta_transaction_invariant");
      expect(after.unsupported).toEqual([]);
      expect(after.catalogSha256 !== before.catalogSha256 || after.dataSha256 !== before.dataSha256).toBe(true);
    } finally { await db.exec("rollback"); }
  }, 60000);
  it("captures complete physical catalog/data state and only the two exact permitted body exclusions", async () => {
    await db.exec("begin isolation level repeatable read");
    try {
      const before = await collect(wasmKernel(invariantSql), "delta_transaction_invariant");
      expect(before.unsupported).toEqual([]);
      expect(before.catalogCount).toBeGreaterThan(50);
      expect(before.tableCount).toBeGreaterThanOrEqual(5);
      await db.exec(`create or replace function private.join_mission(uuid) returns integer language plpgsql as $$begin return 2;end$$;
        create or replace function public.accept_application(uuid) returns integer language plpgsql as $$begin return 2;end$$;`);
      await db.query("insert into supabase_migrations.schema_migrations values($1,$2,array[$3])", ["20261113090001", "active_assignment_xp_neutrality", sourceSql.replace(/\r\n?/g,"\n")]);
      const after = await collect(wasmKernel(invariantSql), "delta_transaction_invariant");
      expect(after.unsupported).toEqual([]);
      expect(after.catalogSha256).toBe(before.catalogSha256);
      expect(after.dataSha256).toBe(before.dataSha256);
      expect(after.baselineHistoryTupleSha256).toBe(before.baselineHistoryTupleSha256);
      expect(after.migrationRows).toBe(18);
      // Synthetic context adaptation tests the pure API, NOT native acceptance.
      const a = { ...before, serverVersionNum: "170006" }, b = { ...after, serverVersionNum: "170006" };
      expect(assertDeltaInvariantTransition(a,b,"first").replayTupleReceiptHash).toBeNull();
      const replay = await collect(wasmKernel(invariantSql), "delta_transaction_invariant");
      expect(assertDeltaInvariantTransition(b,{...replay,serverVersionNum:"170006"},"replay").replayTupleReceiptHash).toMatch(/^[a-f0-9]{64}$/);
      for (const mutation of [(r: MutableFixture) => r.catalogSha256=sha('catalog drift'), (r: MutableFixture) => r.dataSha256=sha('data drift'),
        (r: MutableFixture) => r.targets[0].attributesAclSha256=sha('ACL drift'), (r: MutableFixture) => r.targets[0].xmin='99999',
        (r: MutableFixture) => r.deltaHistory.xmin='99999', (r: MutableFixture) => r.transactionId='99999',
        (r: MutableFixture) => r.unsupported.push('unknown'), (r: MutableFixture) => r.targets.pop()]) {
        const changed=structuredClone(b);mutation(changed);
        expect(()=>assertDeltaInvariantTransition(b,changed,'replay')).toThrow('Delta fingerprint rejected');
      }
      expect(()=>normalizeDeltaInvariant({...b,serverVersionNum:'180001'})).toThrow('Delta fingerprint rejected');
    } finally { await db.exec("rollback"); }
  }, 60000);
});

async function extensionFixture(offset: boolean) {
  const target = await PGlite.create('memory://');
  if (offset) await target.exec('create table public.oid_filler(id integer);drop table public.oid_filler;create role oid_filler;drop role oid_filler;');
  await target.exec(`create schema storage;create schema supabase_migrations;
    create role member_reader;
    create table storage.buckets(id text primary key,public boolean);insert into storage.buckets values('same',false);
    create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
    insert into supabase_migrations.schema_migrations select '202610010000'||lpad(n::text,2,'0'),'fixture_'||n,array['select '||n||';']from generate_series(0,16)n;
    create type public.member_enum as enum('alpha','omega');alter extension plpgsql add type public.member_enum;
    create domain public.member_domain as integer check(value>0);alter extension plpgsql add domain public.member_domain;
    create type public.member_composite as(n integer,label text);alter extension plpgsql add type public.member_composite;
    create type public.member_range as range(subtype=integer);alter extension plpgsql add type public.member_range;
    create function public.member_add(s integer,v integer)returns integer language sql immutable as $$select s+v$$;
    alter extension plpgsql add function public.member_add(integer,integer);
    create aggregate public.member_sum(integer)(sfunc=public.member_add,stype=integer,initcond='0');alter extension plpgsql add aggregate public.member_sum(integer);
    create function public.member_equal(a integer,b integer)returns boolean language sql immutable as $$select a=b$$;
    alter extension plpgsql add function public.member_equal(integer,integer);
    create operator public.=== (function=public.member_equal,leftarg=integer,rightarg=integer);alter extension plpgsql add operator public.===(integer,integer);
    create table public.member_table(id integer primary key,n public.member_domain default 1,label public.member_enum);
    alter extension plpgsql add table public.member_table;
    grant select on public.member_table to member_reader;
    create access method member_am type index handler bthandler;alter extension plpgsql add access method member_am;
    create operator family public.member_family using btree;alter extension plpgsql add operator family public.member_family using btree;
    create operator class public.member_ops for type integer using btree family public.member_family as
      operator 1 <(integer,integer),operator 2 <=(integer,integer),operator 3 =(integer,integer),operator 4 >=(integer,integer),operator 5 >(integer,integer),function 1 btint4cmp(integer,integer);
    alter extension plpgsql add operator class public.member_ops using btree;
    create text search configuration public.member_config(copy=pg_catalog.simple);alter extension plpgsql add text search configuration public.member_config;`);
  return target;
}
async function memberCapture(target: PGlite) {
  await target.exec('begin isolation level repeatable read read only');
  try { return await collectFrom(target,wasmKernel(semanticSql),'delta_semantic_collection'); }
  finally { await target.exec('rollback'); }
}
it('normalizes extension-member types/domains/enums/ranges/aggregates/operators and physical OID changes across isolated WASM databases',async()=>{
  const first=await extensionFixture(false),second=await extensionFixture(true);
  try {
    const a=await memberCapture(first),b=await memberCapture(second);
    expect(a.unsupported).toEqual([]);expect(b.unsupported).toEqual([]);
    const c=(v:MutableFixture)=>v.components.find((x:MutableFixture)=>x.category==='extension-members');
    expect(c(a).objectCount).toBeGreaterThan(30);expect(c(b)).toEqual(c(a));
    for (const altered of [wasmKernel(semanticSql).replace("'pg_language','pg_operator'","'pg_language_unknown','pg_operator'"),
      wasmKernel(semanticSql).replace("ELSIF cat_name='pg_constraint' AND col.attname='conbin' THEN","ELSIF false THEN")]) {
      expect(altered).not.toBe(wasmKernel(semanticSql));
      await second.exec('begin isolation level repeatable read read only');
      try {
        const unknown=await collectFrom(second,altered,'delta_semantic_collection');
        expect(unknown.unsupported.some((entry:string)=>entry.startsWith('extension-members:'))).toBe(true);
        expect(unknown.components.some((entry:MutableFixture)=>entry.category==='extension-members')).toBe(false);
      }finally{await second.exec('rollback');}
    }
    await second.exec("alter type public.member_enum add value 'middle' after 'alpha'");
    const changed=await memberCapture(second);expect(changed.unsupported).toEqual([]);expect(c(changed).sha256).not.toBe(c(a).sha256);
    await second.exec('grant select on public.member_table to public');
    const aclChanged=await memberCapture(second);expect(aclChanged.unsupported).toEqual([]);expect(c(aclChanged).sha256).not.toBe(c(changed).sha256);
  }finally{await first.close();await second.close();}
},60000);
