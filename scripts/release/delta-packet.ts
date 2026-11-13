import { createHash } from "node:crypto";
// @ts-expect-error The existing executable SQL parser has no declaration file.
import { topLevelStatements } from "../audit/b2-bootstrap-profile.mjs";

export const ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256 = "846cf3b5afd94d38f398170308f8e62c1f90f4a9a96b516d41f185986878bae2";
export type DeltaFunctionSignature = "private.join_mission(uuid)" | "public.accept_application(uuid)";
export interface DeltaFunctionExpectation {
  readonly signature: DeltaFunctionSignature;
  /** SHA256 of the entire exact pg_proc.prosrc UTF8 text, including its newlines. */
  readonly bodySha256: string;
  readonly owner: "postgres";
  readonly securityDefiner: true;
  readonly config: readonly string[];
  readonly execute: {
    readonly public: boolean;
    readonly anon: boolean;
    readonly authenticated: boolean;
    readonly service_role: boolean;
  };
}
export interface DeltaHistoryRow {
  readonly version: string;
  readonly name: string | null;
  readonly statementCount: number;
  readonly statementsSha256: string | null;
}
export interface DeltaPacketInput {
  readonly baselineHistory: readonly DeltaHistoryRow[];
  readonly predecessors: readonly DeltaFunctionExpectation[];
  readonly delta: {
    readonly version: string;
    readonly name: string;
    readonly sourceSql: string;
    readonly sourceSha256: string;
  };
}
export interface DeltaPacket {
  readonly kind: "forward-delta-preparation";
  readonly validReleaseEvidence: false;
  readonly sql: string;
  readonly sqlSha256: string;
  readonly sourceSha256: string;
  readonly version: string;
  readonly name: string;
  readonly baselineHistorySha256: string;
}

const SIGNATURES = ["private.join_mission(uuid)", "public.accept_application(uuid)"] as const;
const HASH = /^[a-f0-9]{64}$/;
const HISTORY_VERSION = /^\d{4}(?:\d{10})?$/;
const DELTA_VERSION = /^\d{14}$/;
const NAME = /^[a-z0-9][a-z0-9_]{0,159}$/;
const EXECUTE_ROLES = ["public", "anon", "authenticated", "service_role"] as const;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${literal(JSON.stringify(value))}::pg_catalog.jsonb`;

function invalid(message: string): never {
  throw new Error(`invalid delta preparation: ${message}`);
}
function object(value: unknown, keys: readonly string[], context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(context);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || !keys.every(key => Object.hasOwn(result, key))) invalid(context);
  return result;
}
function text(value: unknown, pattern: RegExp, context: string): string {
  if (typeof value !== "string" || !pattern.test(value)) invalid(context);
  return value;
}
function historyRows(value: unknown): DeltaHistoryRow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10000) invalid("bounded nonempty baseline history required");
  const seen = new Set<string>();
  return value.map(item => {
    const row = object(item, ["version", "name", "statementCount", "statementsSha256"], "history row fields");
    const version = text(row.version, HISTORY_VERSION, "history version");
    if (seen.has(version)) invalid("duplicate baseline history version");
    seen.add(version);
    const name = row.name === null ? null : text(row.name, NAME, "history name");
    if (!Number.isSafeInteger(row.statementCount) || (row.statementCount as number) < 0) invalid("history statement count");
    const statementCount = row.statementCount as number;
    const statementsSha256 = row.statementsSha256 === null ? null : text(row.statementsSha256, HASH, "archived statements hash");
    if (statementCount > 0 && statementsSha256 === null) invalid("nonempty archived statements require a hash");
    return { version, name, statementCount, statementsSha256 };
  }).sort((a, b) => compare(a.version, b.version));
}
function expectedExecute(signature: DeltaFunctionSignature) {
  return { public: false, anon: false, authenticated: false, service_role: signature === "public.accept_application(uuid)" };
}
function functionExpectations(value: unknown): DeltaFunctionExpectation[] {
  if (!Array.isArray(value) || value.length !== 2) invalid("exactly two predecessor expectations required");
  const seen = new Set<string>();
  const states = value.map(item => {
    const state = object(item, ["signature", "bodySha256", "owner", "securityDefiner", "config", "execute"], "function expectation fields");
    if (!SIGNATURES.includes(state.signature as DeltaFunctionSignature) || seen.has(state.signature as string)) invalid("predecessor signatures");
    const signature = state.signature as DeltaFunctionSignature;
    seen.add(signature);
    const bodySha256 = text(state.bodySha256, HASH, "function body hash");
    if (state.owner !== "postgres" || state.securityDefiner !== true || !Array.isArray(state.config)
      || state.config.length !== 1 || state.config[0] !== "search_path=public") invalid("function owner, definer or configuration");
    const execute = object(state.execute, EXECUTE_ROLES, "execute expectations");
    const expected = expectedExecute(signature);
    if (EXECUTE_ROLES.some(role => execute[role] !== expected[role])) invalid("reviewed execute boundary");
    return { signature, bodySha256, owner: "postgres" as const, securityDefiner: true as const,
      config: ["search_path=public"], execute: expected };
  });
  return states.sort((a, b) => compare(a.signature, b.signature));
}
function quoted(text: string, stem: string): string {
  let suffix = 0;
  while (text.includes(`$${stem}_${suffix}$`)) suffix++;
  const tag = `$${stem}_${suffix}$`;
  return `${tag}${text}${tag}`;
}

/** Accept only the one reviewed source, not caller-authored replacement SQL. */
function reviewedSource(source: unknown, declaredHash: unknown) {
  if (typeof source !== "string" || source.length > 100000) invalid("bounded source text required");
  const canonical = source.replace(/\r\n?/g, "\n");
  if (declaredHash !== ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256 || hash(canonical) !== ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256) {
    invalid("source must match the exact reviewed assignment migration");
  }
  const statements = topLevelStatements(canonical) as string[];
  if (statements.length !== 7 || statements[0] !== "begin" || statements[6] !== "commit") invalid("single outer source transaction");
  const functionPattern = /^create or replace function (private\.join_mission|public\.accept_application)\((p_mission|p_submission) uuid\)\s+returns public\.mission_submissions\s+language plpgsql security definer set search_path = public\s+as \$\$([\s\S]*)\$\$$/;
  const bodies = new Map<DeltaFunctionSignature, string>();
  for (let index = 0; index < 2; index++) {
    const match = functionPattern.exec(statements[index + 1]!);
    const name = index === 0 ? "private.join_mission" : "public.accept_application";
    const argument = index === 0 ? "p_mission" : "p_submission";
    if (!match || match[1] !== name || match[2] !== argument) invalid("reviewed function signatures");
    bodies.set(`${name}(uuid)` as DeltaFunctionSignature, match[3]!);
  }
  const acls = statements.slice(3, 6).map(statement => statement.replace(/\s+/g, " "));
  if (JSON.stringify(acls) !== JSON.stringify([
    "revoke all on function private.join_mission(uuid) from public, anon, authenticated, service_role",
    "revoke all on function public.accept_application(uuid) from public, anon, authenticated",
    "grant execute on function public.accept_application(uuid) to service_role",
  ])) invalid("reviewed function ACL statements");
  return { canonical, ddl: statements.slice(1, -1), bodies };
}

function stateGuard(expectations: readonly DeltaFunctionExpectation[], phase: "PRE" | "POST" | "REPLAY") {
  // The fixed source also fixes the function language, result and ordinary function
  // attributes. to_regprocedure pins the qualified UUID signature even when its
  // display form omits the public schema in the session search_path.
  const expected = expectations.map(state => ({ ...state, language: "plpgsql", kind: "f", returnsSet: false,
    resultTypeMatches: true, volatility: "v", strict: false, leakproof: false, parallel: "u" }));
  return `
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'signature', expected->>'signature',
    'bodySha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex'),
    'owner', owner.rolname, 'securityDefiner', p.prosecdef, 'config', p.proconfig,
    'execute', pg_catalog.jsonb_build_object(
      'public', (select coalesce(pg_catalog.bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE'), false)
        from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a),
      'anon', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'service_role', pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')),
    'language', language.lanname, 'kind', p.prokind, 'returnsSet', p.proretset,
    'resultTypeMatches', p.prorettype = 'public.mission_submissions'::pg_catalog.regtype,
    'volatility', p.provolatile, 'strict', p.proisstrict, 'leakproof', p.proleakproof, 'parallel', p.proparallel
  ) order by expected->>'signature' collate "C"), '[]'::pg_catalog.jsonb)
  into v_functions
  from pg_catalog.jsonb_array_elements(${json(expected)}) expected
  join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(expected->>'signature')
  join pg_catalog.pg_roles owner on owner.oid = p.proowner
  join pg_catalog.pg_language language on language.oid = p.prolang;
  if v_functions is distinct from ${json(expected)} then
    raise exception 'DELTA_${phase}_FUNCTION_STATE_MISMATCH';
  end if;
`;
}

/**
 * Pure review/rehearsal preparation. This module has no connection, subprocess,
 * file-writing or application path. Caller-specific production attestation and
 * release authorization are deliberately outside this packet and return type.
 */
export function buildDeltaPacket(input: DeltaPacketInput): DeltaPacket {
  const root = object(input, ["baselineHistory", "predecessors", "delta"], "input fields");
  const history = historyRows(root.baselineHistory);
  const predecessors = functionExpectations(root.predecessors);
  const delta = object(root.delta, ["version", "name", "sourceSql", "sourceSha256"], "delta fields");
  const version = text(delta.version, DELTA_VERSION, "new migration version");
  const name = text(delta.name, NAME, "new migration name");
  if (version <= history.at(-1)!.version) invalid("new version must sort after the complete baseline");
  const source = reviewedSource(delta.sourceSql, delta.sourceSha256);
  const post = predecessors.map(state => ({ ...state, bodySha256: hash(source.bodies.get(state.signature)!) }));
  const newRow: DeltaHistoryRow = { version, name, statementCount: 1, statementsSha256: ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256 };
  const archive = quoted(source.canonical, "delta_source_archive");
  const doTag = `$delta_packet_${ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256.slice(0, 16)}$`;
  const ddl = source.ddl.map((statement, index) => `  execute ${quoted(`${statement};`, `delta_ddl_${index}`)};`).join("\n");
  const sql = `-- Forward-delta review/rehearsal preparation only; not release evidence or target attestation.
-- Source SHA256 identifies the complete LF source archived as one new history statement.
-- This outer packet has its own distinct SHA256 supplied by the builder.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;
DO ${doTag}
declare
  v_history pg_catalog.jsonb;
  v_functions pg_catalog.jsonb;
  v_delta_present boolean;
begin
  if pg_catalog.current_database() <> 'postgres' or current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'DELTA_DATABASE_OR_ROLE_MISMATCH';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adfocate:guarded-forward-migration', 0));
  lock table supabase_migrations.schema_migrations in share row exclusive mode;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'version', h.version, 'name', h.name,
    'statementCount', coalesce(pg_catalog.cardinality(h.statements), 0),
    'statementsSha256', case when h.statements is null then null
      else pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.array_to_string(h.statements, E'\\n'), 'UTF8')), 'hex') end
  ) order by h.version collate "C"), '[]'::pg_catalog.jsonb)
  into v_history from supabase_migrations.schema_migrations h;
  select exists(select 1 from supabase_migrations.schema_migrations where version = ${literal(version)}) into v_delta_present;
  if v_delta_present then
    if v_history is distinct from ${json([...history, newRow])} or not exists (
      select 1 from supabase_migrations.schema_migrations where version = ${literal(version)}
        and name = ${literal(name)} and statements is not distinct from array[${archive}]::text[]
    ) then
      raise exception 'DELTA_REPLAY_HISTORY_OR_ARCHIVE_MISMATCH';
    end if;
${stateGuard(post, "REPLAY")}
    return;
  end if;
  if v_history is distinct from ${json(history)} then
    raise exception 'DELTA_BASELINE_HISTORY_MISMATCH';
  end if;
${stateGuard(predecessors, "PRE")}
${ddl}
${stateGuard(post, "POST")}
  insert into supabase_migrations.schema_migrations(version, name, statements)
    values (${literal(version)}, ${literal(name)}, array[${archive}]::text[]);
  -- History INSERT triggers must not alter the new row or another baseline row.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'version', h.version, 'name', h.name,
    'statementCount', coalesce(pg_catalog.cardinality(h.statements), 0),
    'statementsSha256', case when h.statements is null then null
      else pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.array_to_string(h.statements, E'\\n'), 'UTF8')), 'hex') end
  ) order by h.version collate "C"), '[]'::pg_catalog.jsonb)
  into v_history from supabase_migrations.schema_migrations h;
  if v_history is distinct from ${json([...history, newRow])} or not exists (
    select 1 from supabase_migrations.schema_migrations where version = ${literal(version)}
      and name = ${literal(name)} and statements is not distinct from array[${archive}]::text[]
  ) then
    raise exception 'DELTA_POST_HISTORY_OR_ARCHIVE_MISMATCH';
  end if;
${stateGuard(post, "POST")}
end;
${doTag};
COMMIT;
`;
  return Object.freeze({ kind: "forward-delta-preparation", validReleaseEvidence: false, sql,
    sqlSha256: hash(sql), sourceSha256: ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256, version, name,
    baselineHistorySha256: hash(JSON.stringify(history)) });
}
