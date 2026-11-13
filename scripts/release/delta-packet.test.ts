// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256, buildDeltaPacket } from "./delta-packet";
import type { DeltaFunctionExpectation, DeltaPacketInput } from "./delta-packet";
// @ts-expect-error The existing executable SQL parser has no declaration file.
import { topLevelStatements } from "../audit/b2-bootstrap-profile.mjs";

// Synthetic, single-connection SQL fixtures only. They are not production-shaped
// release evidence, hosted Auth/RLS validation, or multi-connection race evidence.
const target = Object.freeze({ storage: "memory://", transport: "in-process-wasm", network: "none" });
const version = "20261113090001";
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const baseline = [
  { version: "0001", name: "synthetic_init", statements: ["select 'synthetic baseline';"] },
  { version: "20261031201901", name: "synthetic_combined_packet", statements: ["select 'part one';", "select 'part two';"] },
  { version: "20261113090000", name: "synthetic_manual_receipt", statements: null },
];
let db: PGlite;
let sourceSql: string;
let sourceFunctions: string[];
let predecessors: DeltaFunctionExpectation[];
let input: DeltaPacketInput;

const baseSql = `
create schema auth; create schema private; create schema supabase_migrations;
create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
create table public.mission_submissions(id uuid primary key,xp_awarded integer not null default 93,status text default 'joined');
create table public.creators(id uuid primary key,xp integer not null default 217);
insert into public.creators(id) values('00000000-0000-4000-8000-000000000011');
insert into public.mission_submissions(id) values('00000000-0000-4000-8000-000000000021');
create table supabase_migrations.schema_migrations(version varchar primary key,name text,statements text[]);
`;
function body(statement: string) {
  const match = /as \$\$([\s\S]*)\$\$$/i.exec(statement);
  expect(match).not.toBeNull();
  return match![1]!;
}
async function sourceFunction(file: string, name: string) {
  const sql = (await readFile(`supabase/migrations/${file}`, "utf8")).replace(/\r\n?/g, "\n");
  const found = (topLevelStatements(sql) as string[]).filter(statement => statement.startsWith(`create or replace function ${name}(`));
  expect(found).toHaveLength(1);
  return found[0]!;
}
async function value<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(sql, params)).rows[0]!.value;
}
async function snapshot() {
  return value(`select jsonb_build_object(
    'history',(select jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements,'xmin',xmin::text)order by version)from supabase_migrations.schema_migrations),
    'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'xmin',p.xmin::text)order by p.oid)
      from pg_proc p where p.oid in (pg_catalog.to_regprocedure('private.join_mission(uuid)'),pg_catalog.to_regprocedure('public.accept_application(uuid)'))),
    'xp',(select xp from public.creators),'awarded',(select xp_awarded from public.mission_submissions),
    'status',(select status from public.mission_submissions))as value`);
}
async function rejectPacket(sql: string, message: string) {
  await expect(db.exec(sql)).rejects.toThrow(message);
  await db.exec("rollback");
}
type MutableInput = { -readonly [Key in keyof DeltaPacketInput]: DeltaPacketInput[Key] };
const cloneInput = (): MutableInput => structuredClone(input);
const packet = () => buildDeltaPacket(input);

beforeAll(async () => {
  db = await (await import("@electric-sql/pglite")).PGlite.create(target.storage);
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create role packet_other superuser;create role packet_inherited;");
  sourceSql = (await readFile("supabase/migrations/20261113090001_active_assignment_xp_neutrality.sql", "utf8")).replace(/\r\n?/g, "\n");
  sourceFunctions = await Promise.all([
    sourceFunction("20260805120000_review_hardening.sql", "private.join_mission"),
    sourceFunction("0010_applications.sql", "public.accept_application"),
  ]);
  predecessors = ["private.join_mission(uuid)", "public.accept_application(uuid)"].map((signature, index) => ({
    signature: signature as DeltaFunctionExpectation["signature"], bodySha256: hash(body(sourceFunctions[index]!)),
    owner: "postgres", securityDefiner: true, config: ["search_path=public"],
    execute: { public: false, anon: false, authenticated: false, service_role: index === 1 },
  }));
  expect(predecessors.map(state => state.bodySha256)).toEqual([
    "c6e2dbf25154897e2aa80cf2366de5c7134e1dae54b61ba77f246bc24197795b",
    "b4504940a4e0579f0ce2f4fb7e349a7abb6fd2333a722d5f15f62a78ac055829",
  ]);
  input = {
    baselineHistory: baseline.map(row => ({ version: row.version, name: row.name,
      statementCount: row.statements?.length ?? 0, statementsSha256: row.statements === null ? null : hash(row.statements.join("\n")) })),
    predecessors,
    delta: { version, name: "active_assignment_xp_neutrality", sourceSql, sourceSha256: ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256 },
  };
}, 60000);
beforeEach(async () => {
  await db.exec("drop schema if exists public cascade;drop schema if exists private cascade;drop schema if exists auth cascade;drop schema if exists supabase_migrations cascade;create schema public;");
  await db.exec(baseSql);
  for (const statement of sourceFunctions) await db.exec(statement);
  // CREATE FUNCTION defaults to PUBLIC EXECUTE. The deployed state is narrower.
  await db.exec(`revoke all on function private.join_mission(uuid)from public,anon,authenticated,service_role;
    revoke all on function public.accept_application(uuid)from public,anon,authenticated;
    grant execute on function public.accept_application(uuid)to service_role;`);
  for (const row of baseline) await db.query("insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)", [row.version, row.name, row.statements]);
});
afterEach(async () => {
  await db?.exec("rollback;reset session authorization;reset role;revoke packet_inherited from authenticated;");
});
afterAll(async () => { await db?.close(); });

describe("bounded forward-delta preparation", () => {
  it("binds exact source, exposes a separate outer SQL digest and contains one transaction/DO", () => {
    const result = packet();
    expect(result).toMatchObject({ kind: "forward-delta-preparation", validReleaseEvidence: false, sourceSha256: hash(sourceSql), version });
    expect(result.sqlSha256).toBe(hash(result.sql));
    expect(result.sqlSha256).not.toBe(result.sourceSha256);
    expect(result).not.toHaveProperty("releaseEvidenceDigest");
    const statements = topLevelStatements(result.sql) as string[];
    expect(statements).toHaveLength(6);
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements.filter(statement => statement.startsWith("DO $delta_packet_"))).toHaveLength(1);
    expect(result.sql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(result.sql).toContain("SET LOCAL statement_timeout = '30s'");
    expect(result.sql).toContain("pg_advisory_xact_lock");
    expect(result.sql).toContain("lock table supabase_migrations.schema_migrations in share row exclusive mode");
    expect(result.sql).not.toMatch(/mission_submissions_creator_workspace_fk|migration repair|db push|release:execute/);
  });

  it("applies the actual reviewed DDL atomically and archives full LF source as one new row", async () => {
    const before = await snapshot() as Record<string, unknown>;
    await db.exec(packet().sql);
    const after = await snapshot() as Record<string, unknown>;
    expect(after).toMatchObject({ xp: 217, awarded: 93, status: "joined" });
    expect((after.history as unknown[]).slice(0, 3)).toEqual(before.history);
    const archived = await db.query<{ name: string; statements: string[]; sha: string }>(
      "select name,statements,encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex')as sha from supabase_migrations.schema_migrations where version=$1", [version]);
    expect(archived.rows).toEqual([{ name: input.delta.name, statements: [sourceSql], sha: ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256 }]);
    expect(await value("select count(*)::int as value from supabase_migrations.schema_migrations")).toBe(4);
    const expectedBodies = (topLevelStatements(sourceSql) as string[]).slice(1, 3).map(body).map(hash);
    for (const [index, signature] of ["private.join_mission(uuid)", "public.accept_application(uuid)"].entries()) {
      expect(await value("select encode(sha256(convert_to(prosrc,'UTF8')),'hex')as value from pg_proc where oid=$1::regprocedure", [signature])).toBe(expectedBodies[index]);
    }
    expect(await value("select has_function_privilege('authenticated','public.accept_application(uuid)','EXECUTE')as value")).toBe(false);
    expect(await value("select has_function_privilege('service_role','public.accept_application(uuid)','EXECUTE')as value")).toBe(true);
  });

  it("replays as a true guarded no-op with DDL and history-insert traps installed", async () => {
    const sql = packet().sql;
    await db.exec(sql);
    await db.exec(`create function public.packet_no_ddl()returns event_trigger language plpgsql as $$begin raise exception 'replay executed DDL';end;$$;
      create function public.packet_no_insert()returns trigger language plpgsql as $$begin raise exception 'replay inserted history';end;$$;
      create trigger packet_no_insert before insert on supabase_migrations.schema_migrations for each row execute function public.packet_no_insert();
      create event trigger packet_no_ddl on ddl_command_end when tag in ('CREATE FUNCTION','GRANT','REVOKE')execute function public.packet_no_ddl();`);
    const before = await snapshot();
    await db.exec(sql);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["name", "statementCount", "archive", "missing", "extra"])("rejects baseline history %s drift before changing functions", async field => {
    if (field === "name") await db.exec("update supabase_migrations.schema_migrations set name='different'where version='0001'");
    if (field === "statementCount") await db.exec("update supabase_migrations.schema_migrations set statements=array['one','two']where version='0001'");
    if (field === "archive") await db.exec("update supabase_migrations.schema_migrations set statements=array['different archive']where version='0001'");
    if (field === "missing") await db.exec("delete from supabase_migrations.schema_migrations where version='0001'");
    if (field === "extra") await db.exec("insert into supabase_migrations.schema_migrations values('20261113090002','unexpected',null)");
    const before = await snapshot();
    await rejectPacket(packet().sql, "DELTA_BASELINE_HISTORY_MISMATCH");
    expect(await snapshot()).toEqual(before);
  });

  it("compares split archive hashes independently of any source-file hash and distinguishes null from empty archive", async () => {
    const split = input.baselineHistory.find(row => row.version === "20261031201901")!;
    expect(split.statementsSha256).toBe(hash(baseline[1]!.statements!.join("\n")));
    expect(split.statementsSha256).not.toBe(hash(baseline[1]!.statements!.join("\n") + "\n"));
    await db.exec("update supabase_migrations.schema_migrations set statements='{}'::text[] where version='20261113090000'");
    const before = await snapshot();
    await rejectPacket(packet().sql, "DELTA_BASELINE_HISTORY_MISMATCH");
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ["body", ""],
    ["owner", "alter function private.join_mission(uuid)owner to packet_other"],
    ["definer", "alter function private.join_mission(uuid)security invoker"],
    ["config", "alter function private.join_mission(uuid)set search_path to pg_catalog"],
    ["public ACL", "grant execute on function private.join_mission(uuid)to public"],
    ["anon ACL", "grant execute on function private.join_mission(uuid)to anon"],
    ["authenticated ACL", "grant execute on function public.accept_application(uuid)to authenticated"],
    ["service ACL", "revoke execute on function public.accept_application(uuid)from service_role"],
    ["missing function", "drop function private.join_mission(uuid)"],
  ])("rejects predecessor %s drift", async (kind, sql) => {
    if (kind === "body") await db.exec(sourceFunctions[0]!.replace("xp = xp + 10", "xp = xp + 11"));
    else await db.exec(sql);
    const before = await snapshot();
    await rejectPacket(packet().sql, "DELTA_PRE_FUNCTION_STATE_MISMATCH");
    expect(await snapshot()).toEqual(before);
  });

  it("detects inherited role execute rights as well as direct ACL grants", async () => {
    await db.exec("grant packet_inherited to authenticated;grant execute on function private.join_mission(uuid)to packet_inherited");
    const before = await snapshot();
    await rejectPacket(packet().sql, "DELTA_PRE_FUNCTION_STATE_MISMATCH");
    expect(await snapshot()).toEqual(before);
  });

  it.each(["name", "archive", "split", "old baseline", "unexpected history"])("refuses same-version replay with %s mismatch", async field => {
    const sql = packet().sql;
    await db.exec(sql);
    if (field === "name") await db.query("update supabase_migrations.schema_migrations set name='wrong_name'where version=$1", [version]);
    if (field === "archive") await db.query("update supabase_migrations.schema_migrations set statements=array['wrong source']where version=$1", [version]);
    if (field === "split") await db.query("update supabase_migrations.schema_migrations set statements=array['one','two']where version=$1", [version]);
    if (field === "old baseline") await db.exec("update supabase_migrations.schema_migrations set name='old drift'where version='0001'");
    if (field === "unexpected history") await db.exec("insert into supabase_migrations.schema_migrations values('20261113090002','later',null)");
    const before = await snapshot();
    await rejectPacket(sql, "DELTA_REPLAY_HISTORY_OR_ARCHIVE_MISMATCH");
    expect(await snapshot()).toEqual(before);
  });

  it.each(["body", "ACL", "owner", "config"])("refuses to repair replay post-%s drift", async field => {
    const sql = packet().sql;
    await db.exec(sql);
    if (field === "body") await db.exec(sourceFunctions[0]!);
    if (field === "ACL") await db.exec("grant execute on function public.accept_application(uuid)to authenticated");
    if (field === "owner") await db.exec("alter function public.accept_application(uuid)owner to packet_other");
    if (field === "config") await db.exec("alter function public.accept_application(uuid)reset search_path");
    const before = await snapshot();
    await rejectPacket(sql, "DELTA_REPLAY_FUNCTION_STATE_MISMATCH");
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back both function replacements when the post-DDL ACL guard fails", async () => {
    await db.exec(`create function public.packet_corrupt_grant()returns event_trigger language plpgsql as $$begin
      revoke execute on function public.accept_application(uuid)from service_role;end;$$;
      create event trigger packet_corrupt_grant on ddl_command_end when tag in ('GRANT')execute function public.packet_corrupt_grant()`);
    const before = await snapshot();
    await rejectPacket(packet().sql, "DELTA_POST_FUNCTION_STATE_MISMATCH");
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back DDL and the new receipt when a history trigger changes its archive", async () => {
    await db.exec(`create function public.packet_corrupt_archive()returns trigger language plpgsql as $$begin
      new.statements:=array['corrupted'];return new;end;$$;
      create trigger packet_corrupt_archive before insert on supabase_migrations.schema_migrations for each row execute function public.packet_corrupt_archive()`);
    const before = await snapshot();
    await rejectPacket(packet().sql, "DELTA_POST_HISTORY_OR_ARCHIVE_MISMATCH");
    expect(await snapshot()).toEqual(before);
  });

  it("rechecks post-function state after receipt insertion and rolls back trigger side effects", async () => {
    await db.exec(`create function public.packet_corrupt_post_insert()returns trigger language plpgsql as $$begin
      grant execute on function public.accept_application(uuid)to authenticated;return new;end;$$;
      create trigger packet_corrupt_post_insert after insert on supabase_migrations.schema_migrations for each row execute function public.packet_corrupt_post_insert()`);
    const before = await snapshot();
    await rejectPacket(packet().sql, "DELTA_POST_FUNCTION_STATE_MISMATCH");
    expect(await snapshot()).toEqual(before);
  });

  it("rejects wrong current role before DDL", async () => {
    const before = await snapshot();
    await db.exec("set role service_role");
    await rejectPacket(packet().sql, "DELTA_DATABASE_OR_ROLE_MISMATCH");
    await db.exec("reset role");
    expect(await snapshot()).toEqual(before);
  });

  it("rejects wrong session role even when current role is postgres", async () => {
    const before = await snapshot();
    await db.exec("set session authorization packet_other;set role postgres");
    await rejectPacket(packet().sql, "DELTA_DATABASE_OR_ROLE_MISMATCH");
    await db.exec("reset session authorization;reset role");
    expect(await snapshot()).toEqual(before);
  });

  it("normalizes LF/CRLF/lone CR source and sorts expectations without mutating input", () => {
    const expected = packet();
    const candidate = cloneInput();
    (candidate.baselineHistory as unknown[]).reverse();
    (candidate.predecessors as unknown[]).reverse();
    const original = structuredClone(candidate);
    expect(buildDeltaPacket(candidate)).toEqual(expected);
    expect(candidate).toEqual(original);
    for (const newline of ["\r\n", "\r"]) {
      expect(buildDeltaPacket({ ...input, delta: { ...input.delta, sourceSql: sourceSql.replaceAll("\n", newline) } })).toEqual(expected);
    }
  });

  it.each([
    ["same baseline version", (candidate: MutableInput) => { candidate.delta = { ...candidate.delta, version: "20261113090000" }; }],
    ["older version", (candidate: MutableInput) => { candidate.delta = { ...candidate.delta, version: "20261031201900" }; }],
    ["version injection", (candidate: MutableInput) => { candidate.delta = { ...candidate.delta, version: "20261113090001';select 1" }; }],
    ["invalid name", (candidate: MutableInput) => { candidate.delta = { ...candidate.delta, name: "unsafe';select 1" }; }],
    ["duplicate baseline", (candidate: MutableInput) => { candidate.baselineHistory = [...candidate.baselineHistory, candidate.baselineHistory[0]!]; }],
    ["negative count", (candidate: MutableInput) => { candidate.baselineHistory = [{ ...candidate.baselineHistory[0]!, statementCount: -1 }]; }],
    ["missing archive hash", (candidate: MutableInput) => { candidate.baselineHistory = [{ ...candidate.baselineHistory[0]!, statementsSha256: null }]; }],
    ["empty baseline", (candidate: MutableInput) => { candidate.baselineHistory = []; }],
    ["unknown function", (candidate: MutableInput) => { candidate.predecessors = [{ ...candidate.predecessors[0]!, signature: "public.other(uuid)" as DeltaFunctionExpectation["signature"] }, candidate.predecessors[1]!]; }],
    ["duplicate function", (candidate: MutableInput) => { candidate.predecessors = [candidate.predecessors[0]!, candidate.predecessors[0]!]; }],
    ["waived PUBLIC grant", (candidate: MutableInput) => { candidate.predecessors = [{ ...candidate.predecessors[0]!, execute: { ...candidate.predecessors[0]!.execute, public: true } }, candidate.predecessors[1]!]; }],
    ["waived search path", (candidate: MutableInput) => { candidate.predecessors = [{ ...candidate.predecessors[0]!, config: [] }, candidate.predecessors[1]!]; }],
  ])("rejects invalid structured input: %s", (_label, mutate) => {
    const candidate = cloneInput();
    mutate(candidate);
    expect(() => buildDeltaPacket(candidate)).toThrow("invalid delta preparation");
  });

  it.each([
    ["business DML", (sql: string) => sql + "update public.creators set xp=0;"],
    ["other function", (sql: string) => sql.replace("private.join_mission", "private.other")],
    ["unexpected grant", (sql: string) => sql.replace("to service_role;", "to authenticated;")],
    ["body change", (sql: string) => sql.replace("then 0 else 10 end", "then 1 else 10 end")],
    ["nested transaction", (sql: string) => sql.replace("begin;", "begin;begin;")],
    ["unterminated trailer", (sql: string) => sql + "select 'unterminated"],
  ])("rejects unreviewed source: %s even when caller supplies its new hash", (_label, mutate) => {
    const modified = mutate(sourceSql);
    expect(modified).not.toBe(sourceSql);
    expect(() => buildDeltaPacket({ ...input, delta: { ...input.delta, sourceSql: modified, sourceSha256: hash(modified) } })).toThrow("exact reviewed assignment migration");
  });
});
