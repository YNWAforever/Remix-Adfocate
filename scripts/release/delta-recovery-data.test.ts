// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDeltaRecoveryDataEqual, buildDeltaRecoveryDataFingerprint, DELTA_RECOVERY_DATA_ALGORITHM,
  normalizeDeltaRecoveryData, type DeltaRecoveryDataFingerprint, type DeltaRecoveryDataRelation } from "./delta-recovery-data";

// Disposable PG18 WASM kernels only. Positive kernel copies change ONLY the
// major guard. Observed metadata stays PG18 and is never promoted to native PG17.
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const binding = { scopeDigest: hash("synthetic-scope"), collectorSha256: hash("synthetic-collector") };
const fixture = () => ({ schemaVersion: 1, kind: "delta-recovery-data", algorithm: DELTA_RECOVERY_DATA_ALGORITHM,
  databaseName: "postgres", serverVersionNum: "170006", isolationLevel: "repeatable read", transactionReadOnly: true,
  fullCoverage: true, sequenceStateNonMvcc: true, inventoryCount: 2, tableCount: 1, sequenceCount: 1, rowCount: 3,
  relations: [{ identitySha256: hash("table"), kind: "r", columnCount: 2, columnsSha256: hash("columns"), rowCount: 3, dataSha256: hash("rows") },
    { identitySha256: hash("sequence"), kind: "S", columnCount: 0, columnsSha256: hash("sequence-shape"), rowCount: 0, dataSha256: hash("sequence-state") }], unsupported: [] });
interface KernelCollection { serverVersionNum: string; fullCoverage: boolean; relations: DeltaRecoveryDataRelation[]; unsupported: unknown[];
  inventoryCount: number; tableCount: number; sequenceCount: number; rowCount: number }
let sql: string;
const kernel = (source: string) => {
  const result = source.replace("current_setting('server_version_num')::integer/10000<>17", "current_setting('server_version_num')::integer/10000<>18");
  if (result === source) throw new Error("PG18 test instrumentation missing");
  return result;
};
let db: PGlite;
beforeAll(async () => { sql = await readFile("scripts/release/delta-recovery-data.sql", "utf8"); db = await PGlite.create("memory://"); }, 60000);
afterAll(async () => { await db?.close(); });
async function capture(database: PGlite, options: { source?: string; role?: string } = {}): Promise<KernelCollection> {
  await database.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    if (options.role) await database.exec("SET LOCAL ROLE " + options.role);
    const results = await database.exec(options.source ?? kernel(sql));
    return results.at(-1)!.rows[0]!.delta_recovery_data as KernelCollection;
  } finally { await database.exec("ROLLBACK"); }
}
const content = (value: KernelCollection) => JSON.stringify([...value.relations].sort((a, b) => a.identitySha256.localeCompare(b.identitySha256)));

// Pure parser inputs are synthetic and deliberately have PG17 context fields.
describe("strict portable recovery data API", () => {
  it("binds logical portable content to collector and scope, independent of inventory order", () => {
    const a = fixture(), b = fixture(); b.relations.reverse();
    const first = buildDeltaRecoveryDataFingerprint(a, binding), second = buildDeltaRecoveryDataFingerprint(b, binding);
    expect(first).toEqual(second); expect(() => assertDeltaRecoveryDataEqual(first, second)).not.toThrow();
    expect(first).toMatchObject({ tableCount: 1, sequenceCount: 1, rowCount: 3, fullCoverage: true, sequenceStateNonMvcc: true });
    expect(buildDeltaRecoveryDataFingerprint(a, { ...binding, collectorSha256: hash("other") }).rootSha256).not.toBe(first.rootSha256);
    expect(buildDeltaRecoveryDataFingerprint(a, { ...binding, scopeDigest: hash("other") }).rootSha256).not.toBe(first.rootSha256);
  });
  it.each(["dataSha256", "columnsSha256", "identitySha256"] as const)("detects changes to %s", field => {
    const a = buildDeltaRecoveryDataFingerprint(fixture(), binding), b = fixture(); b.relations[0]![field] = hash("changed");
    expect(() => assertDeltaRecoveryDataEqual(a, buildDeltaRecoveryDataFingerprint(b, binding))).toThrow("restored data mismatch");
  });
  it.each([
    { fullCoverage: false }, { transactionReadOnly: false }, { isolationLevel: "read committed" }, { databaseName: "other" },
    { serverVersionNum: "180000" }, { sequenceStateNonMvcc: false }, { inventoryCount: 1 }, { tableCount: 2 },
    { rowCount: 2 }, { unsupported: ["private-row-value"] }, { skipTables: [] }, { rowCount: 10_000_001 },
  ])("rejects incomplete, overridden or unmodeled observations", override => {
    expect(() => normalizeDeltaRecoveryData({ ...fixture(), ...override })).toThrow(/^Delta recovery data rejected:/);
  });
  it("rejects duplicate relations, unsafe sequence counts and unknown fields without echoing values", () => {
    const duplicate = fixture(); duplicate.relations[1]!.identitySha256 = duplicate.relations[0]!.identitySha256;
    expect(() => normalizeDeltaRecoveryData(duplicate)).toThrow("duplicate relation");
    const sequence = fixture(); sequence.relations[1]!.rowCount = 1;
    expect(() => normalizeDeltaRecoveryData(sequence)).toThrow("sequence shape");
    const privateValue = "synthetic-private-person@example.test";
    try { normalizeDeltaRecoveryData({ ...fixture(), credentials: privateValue }); throw new Error("missing rejection"); }
    catch (error) { expect(String(error)).not.toContain(privateValue); expect(String(error)).toContain("Delta recovery data rejected"); }
    const invalid = { ...buildDeltaRecoveryDataFingerprint(fixture(), binding), rootSha256: privateValue } as DeltaRecoveryDataFingerprint;
    expect(() => assertDeltaRecoveryDataEqual(invalid, invalid)).toThrow("hash shape");
  });
});

describe("PG18-instrumented portable kernels, not native PG17 proof", () => {
  it("rejects PG18 with the unmodified production SQL and preserves its actual observed version", async () => {
    await expect(capture(db, { source: sql })).rejects.toThrow("DELTA_RECOVERY_DATA_CONTEXT");
    const result = await capture(db); expect(Number(result.serverVersionNum) / 10000 | 0).toBe(18);
    expect(result.fullCoverage).toBe(true); expect(result.unsupported).toEqual([]);
    expect(() => normalizeDeltaRecoveryData(result)).toThrow("incomplete coverage or context");
  });
  it("is genuinely read only and neither writes history nor owns transaction boundaries", async () => {
    expect(sql).not.toMatch(/\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|FUNCTION)|INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM)\b/i);
    expect(sql).not.toMatch(/^\s*(?:BEGIN(?:\s+ISOLATION)?;|COMMIT;|ROLLBACK;)/m);
    await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try { await expect(db.exec(kernel(sql))).rejects.toThrow("DELTA_RECOVERY_DATA_CONTEXT"); }
    finally { await db.exec("ROLLBACK"); }
  });
  it("compares different physical enum/domain/array OIDs and preserves duplicate row bags", async () => {
    const other = await PGlite.create("memory://");
    const setup = `CREATE SCHEMA portable;CREATE TYPE portable.mood AS ENUM('new','old');
      CREATE DOMAIN portable.positive AS integer CHECK(VALUE>0);CREATE DOMAIN portable.enum_domain AS portable.mood;
      CREATE TABLE portable.data(id bigint,m portable.mood,d portable.positive,a portable.mood[],ad portable.enum_domain[],j json,b bytea,z float8,tm timestamptz);
      INSERT INTO portable.data VALUES(9007199254740993,'new',7,'[0:1]={new,old}','{new,NULL}','{ "a":1,"a":2 }','\\x0000ff','-0','2026-11-13 01:02:03.123456+08');
      INSERT INTO portable.data SELECT * FROM portable.data;`;
    try {
      await db.exec(setup);
      await other.exec("CREATE TYPE public.offset_enum AS ENUM('offset');DROP TYPE public.offset_enum;" + setup);
      const first = await capture(db), second = await capture(other);
      expect(first.unsupported).toEqual([]); expect(second.unsupported).toEqual([]); expect(first.rowCount).toBe(2);
      expect(content(first)).toBe(content(second));
      const oid = async (value: PGlite) => (await value.query<{ value: number }>("SELECT 'portable.mood'::regtype::oid AS value")).rows[0]!.value;
      expect(await oid(db)).not.toBe(await oid(other));
      const physical = async (value: PGlite) => (await value.query<{ value: string }>("SELECT encode(sha256(record_send(t)),'hex') AS value FROM portable.data t LIMIT 1")).rows[0]!.value;
      expect(await physical(db)).not.toBe(await physical(other));
      await other.exec("DELETE FROM portable.data WHERE ctid=(SELECT ctid FROM portable.data LIMIT 1)");
      expect(content(await capture(other))).not.toBe(content(first));
      expect(JSON.stringify(first)).not.toMatch(/9007199254740993|"portable"|2026-11-13|"a":|"new"|"old"/);
    } finally { await db.exec("DROP SCHEMA portable CASCADE"); await other.close(); }
  }, 60000);
  it.each([
    ["JSON duplicate keys", "j json", "'{\"a\":1,\"a\":2}'", "'{\"a\":2}'"],
    ["JSON whitespace", "j json", "'{ \"a\": 2 }'", "'{\"a\":2}'"],
    ["array lower bound", "a integer[]", "ARRAY[1,2]", "'[0:1]={1,2}'"],
    ["array dimensions", "a integer[]", "ARRAY[1,2]", "ARRAY[[1,2]]"],
    ["array NULL", "a integer[]", "ARRAY[1,NULL]", "ARRAY[1,2]"],
    ["NULL versus empty", "t text", "NULL", "''"],
    ["signed floating zero", "f float8", "'0'", "'-0'"],
    ["NaN versus infinity", "f float8", "'NaN'", "'Infinity'"],
    ["bytea bytes", "b bytea", "'\\x0001'", "'\\x0100'"],
    ["timestamp precision", "t timestamptz", "'2026-11-13 00:00:00.000001+00'", "'2026-11-13 00:00:00.000002+00'"],
  ])("preserves %s", async (_name, column, before, after) => {
    await db.exec(`CREATE TABLE public.portable_probe(${column});INSERT INTO public.portable_probe VALUES(${before})`);
    try {
      const first = await capture(db); expect(first.unsupported).toEqual([]);
      await db.exec(`UPDATE public.portable_probe SET ${column.split(" ")[0]}=${after}`);
      const second = await capture(db); expect(second.unsupported).toEqual([]); expect(content(first)).not.toBe(content(second));
    } finally { await db.exec("DROP TABLE public.portable_probe"); }
  }, 60000);
  it("renders the explicit native scalar codec set without textual fallbacks", async () => {
    const values: [string,string][] = [["bool","true"],["bytea","\\x0001"],["char","x"],["name","label"],["int2","-7"],["int4","2147483647"],
      ["int8","9007199254740993"],["float4","-0"],["float8","NaN"],["numeric","1234567890.012300"],["text","Unicode-雪"],["varchar","value"],["bpchar","a"],
      ["json",'{"a":1,"a":2}'],["jsonb",'{"a":2}'],["xml","<x/>"],["date","infinity"],["time","12:13:14.000001"],["timetz","12:13:14+08"],
      ["timestamp","2026-11-13 01:02:03.123456"],["timestamptz","2026-11-13 01:02:03.123456+08"],["interval","1 month 2 days 3 microseconds"],
      ["uuid","00000000-0000-4000-8000-000000000001"],["inet","192.0.2.1/24"],["cidr","192.0.2.0/24"],["macaddr","08:00:2b:01:02:03"],["macaddr8","08:00:2b:01:02:03:04:05"],
      ["bit","1"],["varbit","010"],["money","1.23"],["pg_lsn","1/2"],["point","(1,2)"],["lseg","[(0,0),(1,1)]"],["box","(0,0),(1,1)"],
      ["path","[(0,0),(1,1)]"],["polygon","((0,0),(1,0),(0,1))"],["line","{1,2,3}"],["circle","<(0,0),1>"],["tsvector","a:1A"],["tsquery","a&b"]];
    const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'";
    await db.exec(`CREATE TABLE public.native_scalars(${values.map(([type],index)=>`c${index} pg_catalog."${type}"`).join(',')});
      INSERT INTO public.native_scalars VALUES(${values.map(([type,value])=>`${literal(value)}::pg_catalog."${type}"`).join(',')})`);
    try {const raw=await capture(db);expect(raw.unsupported).toEqual([]);expect(raw.fullCoverage).toBe(true);expect(raw.rowCount).toBe(1);}
    finally {await db.exec('DROP TABLE public.native_scalars');}
  });
  it("normalizes optional array null-bitmap storage without losing real NULL values", async () => {
    await db.exec("CREATE TABLE public.array_bitmap(a integer[]);INSERT INTO public.array_bitmap VALUES(ARRAY[1,NULL]);UPDATE public.array_bitmap SET a[2]=2");
    try { const first = await capture(db); await db.exec("UPDATE public.array_bitmap SET a=ARRAY[1,2]"); expect(content(await capture(db))).toBe(content(first)); }
    finally { await db.exec("DROP TABLE public.array_bitmap"); }
  });
  it("uses live logical column order rather than dropped physical attribute numbers", async () => {
    const other = await PGlite.create("memory://");
    try {
      await db.exec("CREATE TABLE public.drop_gap(a integer,junk integer,b text);ALTER TABLE public.drop_gap DROP COLUMN junk;INSERT INTO public.drop_gap VALUES(1,'same')");
      await other.exec("CREATE TABLE public.drop_gap(a integer,b text);INSERT INTO public.drop_gap VALUES(1,'same')");
      expect(content(await capture(db))).toBe(content(await capture(other)));
    } finally { await db.exec("DROP TABLE public.drop_gap"); await other.close(); }
  }, 60000);
  it("covers partitions and inheritance with ONLY and hashes extension-owned table contents", async () => {
    await db.exec(`CREATE SCHEMA coverage;CREATE TABLE coverage.parent(id integer) PARTITION BY RANGE(id);
      CREATE TABLE coverage.p0 PARTITION OF coverage.parent FOR VALUES FROM(0)TO(10);INSERT INTO coverage.parent VALUES(1),(2);
      CREATE TABLE coverage.base(id integer);CREATE TABLE coverage.child()INHERITS(coverage.base);INSERT INTO coverage.base VALUES(3);INSERT INTO coverage.child VALUES(4);
      CREATE TABLE coverage.owned(secret text);INSERT INTO coverage.owned VALUES('synthetic-private');ALTER EXTENSION plpgsql ADD TABLE coverage.owned;`);
    try {
      const first = await capture(db); expect(first.unsupported).toEqual([]); expect(first.rowCount).toBe(5); expect(first.tableCount).toBe(5);
      expect(first.relations.find(value => value.kind === "p")!.rowCount).toBe(0);
      await db.exec("UPDATE coverage.owned SET secret='changed'"); expect(content(await capture(db))).not.toBe(content(first));
    } finally { await db.exec("ALTER EXTENSION plpgsql DROP TABLE coverage.owned;DROP SCHEMA coverage CASCADE"); }
  });
  it("keeps duplicate multiplicity while ignoring physical row order and supports zero-column rows", async () => {
    await db.exec("CREATE TABLE public.bag(value text);INSERT INTO public.bag VALUES('b'),('a'),('b')");
    try {const first=await capture(db);await db.exec("DELETE FROM public.bag;INSERT INTO public.bag VALUES('b'),('b'),('a')");expect(content(await capture(db))).toBe(content(first));
      const bounded=kernel(sql).replace('LIMIT 1000001','LIMIT 3').replace('rows_found>1000000','rows_found>2');expect(bounded).not.toBe(kernel(sql));
      expect((await capture(db,{source:bounded})).fullCoverage).toBe(false);
    }finally{await db.exec('DROP TABLE public.bag');}
    await db.exec('CREATE TABLE public.no_columns();INSERT INTO public.no_columns DEFAULT VALUES;INSERT INTO public.no_columns DEFAULT VALUES');
    try{const raw=await capture(db);expect(raw.fullCoverage).toBe(true);expect(raw.rowCount).toBe(2);expect(raw.relations[0]!.columnCount).toBe(0);}
    finally{await db.exec('DROP TABLE public.no_columns');}
  });
  it("captures sequence last_value/is_called and acknowledges their non-MVCC behavior", async () => {
    await db.exec("CREATE SEQUENCE public.portable_seq");
    try {
      const first = await capture(db); expect(first.sequenceCount).toBe(1); expect(first.rowCount).toBe(0);
      await db.exec("SELECT setval('public.portable_seq',1,true)"); const called = await capture(db); expect(content(called)).not.toBe(content(first));
      await db.exec("BEGIN;SELECT nextval('public.portable_seq');ROLLBACK"); expect(content(await capture(db))).not.toBe(content(called));
    } finally { await db.exec("DROP SEQUENCE public.portable_seq"); }
  });
  it.each(["oid", "regproc", "regprocedure", "regoper", "regoperator", "regclass", "regtype", "regconfig", "regdictionary", "regrole", "regnamespace", "regcollation", "oid[]", "regproc[]"])("holds unsupported %s even in empty tables", async type => {
    await db.exec(`CREATE TABLE public.unportable(value ${type})`);
    try { const raw = await capture(db); expect(raw.fullCoverage).toBe(false); expect(raw.unsupported).not.toEqual([]); }
    finally { await db.exec("DROP TABLE public.unportable"); }
  });
  it("holds nested composites, alias domains and arrays of array-domains", async () => {
    await db.exec("CREATE TYPE public.opaque_box AS(value regproc);CREATE DOMAIN public.opaque_domain AS regproc;CREATE DOMAIN public.array_domain AS integer[]");
    try {
      for (const type of ["public.opaque_box", "public.opaque_domain", "public.opaque_box[]", "public.array_domain[]"]) {
        await db.exec(`CREATE TABLE public.unportable(value ${type})`);
        try { expect((await capture(db)).fullCoverage).toBe(false); } finally { await db.exec("DROP TABLE public.unportable"); }
      }
    } finally { await db.exec("DROP TYPE public.opaque_box;DROP DOMAIN public.opaque_domain,public.array_domain"); }
  });
  it("holds foreign tables, unpopulated materialized views and large objects explicitly", async () => {
    await db.exec('CREATE FOREIGN DATA WRAPPER portable_fdw;CREATE SERVER portable_server FOREIGN DATA WRAPPER portable_fdw;CREATE FOREIGN TABLE public.remote_data(id integer)SERVER portable_server');
    try {expect((await capture(db)).fullCoverage).toBe(false);}
    finally {await db.exec('DROP FOREIGN TABLE public.remote_data;DROP SERVER portable_server;DROP FOREIGN DATA WRAPPER portable_fdw');}
    await db.exec('CREATE MATERIALIZED VIEW public.unpopulated AS SELECT 1 AS id WITH NO DATA');
    try {expect((await capture(db)).fullCoverage).toBe(false);} finally {await db.exec('DROP MATERIALIZED VIEW public.unpopulated');}
    const oid=(await db.query<{value:number}>('SELECT lo_create(0) AS value')).rows[0]!.value;
    try {const raw=await capture(db);expect(raw.fullCoverage).toBe(false);expect(raw.unsupported).toContain('large-objects-unmodeled');}
    finally {await db.query('SELECT lo_unlink($1)',[oid]);}
  });
  it("holds unreadable rows, temporary relations and bounded cell overflow without leaking values", async () => {
    await db.exec("CREATE ROLE portable_reader;CREATE TABLE public.private_rows(value text);INSERT INTO public.private_rows VALUES('synthetic-private-person@example.test')");
    try {
      const denied = await capture(db, { role: "portable_reader" }); expect(denied.fullCoverage).toBe(false); expect(JSON.stringify(denied)).not.toMatch(/private_rows|example\.test/);
      const small = kernel(sql).replaceAll(">1048576", ">4"); expect(small).not.toBe(kernel(sql));
      expect((await capture(db, { source: small })).fullCoverage).toBe(false);
    } finally { await db.exec("DROP TABLE public.private_rows;DROP ROLE portable_reader"); }
    await db.exec("CREATE TEMP TABLE portable_temp(id integer)");
    try { expect((await capture(db)).fullCoverage).toBe(false); } finally { await db.exec("DROP TABLE portable_temp"); }
  });
});
