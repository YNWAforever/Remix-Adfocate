// Explicit Node test artifact; not discovered by the native Vitest suite or used by C2 runtime.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { createLegacyMemoryProfile } from "./sql-profile.mjs";

const target = Object.freeze({ kind: "in-process-postgres-wasm", locator: "memory://", persistent: false, externalNetwork: false });
const ids = Object.freeze({ workspace: "00000000-0000-4000-8000-000000000101", creator: "00000000-0000-4000-8000-000000000102",
  mission: "00000000-0000-4000-8000-000000000103", submission: "00000000-0000-4000-8000-000000000104",
  invalidMission: "00000000-0000-4000-8000-000000000105", invalidSubmission: "00000000-0000-4000-8000-000000000106" });
const note = "Synthetic saved legacy operator note";
let db, Engine, profile, networkAttempts = 0, enginesCreated = 0, enginesClosed = 0;
const originalFetch = globalThis.fetch;
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => (await query(sql, args))[0]?.value;
const approve = (id = ids.submission, notes = note, rating = 5) => value(
  "select to_jsonb(public.approve_submission($1::uuid,$2::text,$3::smallint)) as value", [id, notes, rating]);
const tables = ["creators", "missions", "mission_submissions", "point_balances", "point_transactions", "earnings_balances", "earnings_transactions", "workspace_budgets", "workspace_budget_transactions"];
const snapshot = () => value("select jsonb_build_object(" + tables.map(t => `'${t}',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)from public.${t} t)`).join(",") + ")as value");
async function rejected(operation, message) {
  await assert.rejects(operation, error => error.message.includes(message));
}

before(async () => {
  // The locator is verified before package import/constructor; no env, URL, directory or host override.
  assert.deepEqual(target, { kind: "in-process-postgres-wasm", locator: "memory://", persistent: false, externalNetwork: false });
  globalThis.fetch = async () => { networkAttempts++; throw new Error("External fetch is forbidden in the standalone memory SQL artifact"); };
  profile = createLegacyMemoryProfile();
  const { PGlite } = await import("@electric-sql/pglite");
  Engine = PGlite;
}, { timeout: 60000 });
beforeEach(async () => {
  assert.equal(target.locator, "memory://");
  // Fresh process-local engine per case. Calls within a case use normal separate
  // autocommit statements: the duplicate approval reads the already committed result.
  db = await Engine.create(target.locator); enginesCreated++;
  await db.exec(profile.beforeFixtureSql);
  await db.exec(`insert into auth.users(id)values('${ids.creator}');
    insert into public.workspaces(id,slug,name)values('${ids.workspace}','synthetic-memory-legacy','Synthetic memory-only workspace');
    insert into public.creators(id,workspace_id,display_name,xp)values('${ids.creator}','${ids.workspace}','Synthetic memory Creator',35);
    insert into public.missions(id,workspace_id,slug,title,mission_type,points_reward,cash_reward)values
      ('${ids.mission}','${ids.workspace}','synthetic-valid','Synthetic valid legacy mission','ugc',250,47.25),
      ('${ids.invalidMission}','${ids.workspace}','synthetic-pre-guard-invalid','Synthetic pre-guard invalid fixture','ugc',250,47.25);
    insert into public.mission_submissions(id,mission_id,creator_id,workspace_id,status,content_urls,xp_awarded)values
      ('${ids.submission}','${ids.mission}','${ids.creator}','${ids.workspace}','submitted',array['https://example.test/memory-only-proof'],35),
      ('${ids.invalidSubmission}','${ids.invalidMission}','${ids.creator}','${ids.workspace}','submitted',array['wwww'],35);
    insert into public.point_balances(creator_id,workspace_id,balance)values('${ids.creator}','${ids.workspace}',0);
    insert into public.earnings_balances(creator_id,workspace_id,available)values('${ids.creator}','${ids.workspace}',0);
    insert into public.workspace_budgets(workspace_id,balance,enforced)values('${ids.workspace}',500,true);`);
  // Synthetic invalid fixture was created before the real guard, without disabling any trigger.
  // Its invented values are never an incident before-image or a restoration of an external row.
  await db.exec(profile.afterFixtureSql);
}, { timeout: 60000 });
afterEach(async () => { if (db) { await db.close(); enginesClosed++; db = undefined; } });
after(async () => {
  globalThis.fetch = originalFetch;
  writeFileSync(fileURLToPath(new URL("./engine-result.json", import.meta.url)), JSON.stringify({ target, enginesCreated, enginesClosed, networkAttempts,
    profileDigest: profile?.profileDigest, tableFamiliesCompared: tables.length, externalClientsOrTargets: 0,
    externalAuthSubjectsOrFixtures: 0, applicationSourceChanges: 0, realPaymentsOrPendingRewards: 0,
    scope: "Core legacy function + real evidence guard on selected original table definitions only; not full migrations/Auth/RLS/campaign/notification/level hooks or independent-connection concurrency." }, null, 2) + "\n");
  assert.equal(networkAttempts, 0);
  assert.equal(enginesClosed, enginesCreated);
});

test("same saved legacy submission credits points,XP,cash and budget exactly once across retries", async () => {
  const first = await approve();
  assert.equal(first.status, "approved"); assert.equal(first.quality_rating, 5); assert.equal(first.reviewer_notes, note);
  assert.equal(first.points_awarded, 250); assert.equal(first.xp_awarded, 185); assert.equal(first.evidence_revision, 1);
  const saved = await snapshot();
  assert.equal(saved.creators[0].xp, 185); assert.equal(saved.point_balances[0].balance, 250);
  assert.equal(Number(saved.earnings_balances[0].available), 47.25); assert.equal(Number(saved.workspace_budgets[0].balance), 452.75);
  for (const table of ["point_transactions", "earnings_transactions", "workspace_budget_transactions"]) {
    assert.equal(saved[table].length, 1); assert.equal(saved[table][0].source_ref, `mission_submission:${ids.submission}`);
  }
  assert.equal(Number(saved.earnings_transactions[0].amount), 47.25); assert.equal(Number(saved.workspace_budget_transactions[0].delta), -47.25);
  assert.deepEqual(await approve(), first); assert.deepEqual(await snapshot(), saved);
  // Legacy status-based replay returns the original saved notes/rating, not a new CRM command.
  assert.deepEqual(await approve(ids.submission, "Different retry note", 4), first); assert.deepEqual(await snapshot(), saved);
});

test("insufficient budget changes no rows and a separately declared memory top-up permits one approval", async () => {
  await db.query("update public.workspace_budgets set balance=20 where workspace_id=$1", [ids.workspace]);
  const before = await snapshot(); await rejected(() => approve(), "insufficient_budget"); assert.deepEqual(await snapshot(), before);
  await db.query("update public.workspace_budgets set balance=500 where workspace_id=$1", [ids.workspace]);
  await approve(); const saved = await snapshot(); await approve(); assert.deepEqual(await snapshot(), saved);
  assert.equal(Number(saved.workspace_budgets[0].balance), 452.75); assert.equal(saved.earnings_transactions.length, 1);
});

test("a late cash-ledger insert fault rolls back the earlier point and budget effects then permits one recovery", async () => {
  await db.exec(`create function private.memory_cash_fault()returns trigger language plpgsql as $$begin
    if new.source_ref='mission_submission:${ids.submission}'then raise exception 'memory_cash_fault';end if;return new;end;$$;
    create trigger memory_cash_fault before insert on public.earnings_transactions for each row execute function private.memory_cash_fault();`);
  const before = await snapshot(); await rejected(() => approve(), "memory_cash_fault"); assert.deepEqual(await snapshot(), before);
  await db.exec("drop trigger memory_cash_fault on public.earnings_transactions;drop function private.memory_cash_fault()");
  await approve(); const saved = await snapshot(); await approve(); assert.deepEqual(await snapshot(), saved);
});

test("a final Creator XP write fault rolls back saved review,status,revision and every financial row", async () => {
  await db.exec(`create function private.memory_xp_fault()returns trigger language plpgsql as $$begin
    if new.id='${ids.creator}'then raise exception 'memory_xp_fault';end if;return new;end;$$;
    create trigger memory_xp_fault before update of xp on public.creators for each row execute function private.memory_xp_fault();`);
  const before = await snapshot(); await rejected(() => approve(), "memory_xp_fault"); assert.deepEqual(await snapshot(), before);
  await db.exec("drop trigger memory_xp_fault on public.creators;drop function private.memory_xp_fault()");
  await approve(); const saved = await snapshot(); await approve(); assert.deepEqual(await snapshot(), saved);
});

test("the actual evidence guard rejects a synthetic pre-guard invalid URL and rolls back all awards", async () => {
  const before = await snapshot(); await rejected(() => approve(ids.invalidSubmission), "invalid_evidence");
  assert.deepEqual(await snapshot(), before);
});

test("a non-cash legacy mission preserves cash and budget while its points and ordinary XP accrue once", async () => {
  await db.query("update public.missions set cash_reward=null where id=$1", [ids.mission]);
  await approve(ids.submission, note, 4); const saved = await snapshot();
  assert.equal(saved.creators[0].xp, 135); assert.equal(saved.point_balances[0].balance, 250);
  assert.equal(Number(saved.earnings_balances[0].available), 0); assert.equal(Number(saved.workspace_budgets[0].balance), 500);
  assert.equal(saved.earnings_transactions.length, 0); assert.equal(saved.workspace_budget_transactions.length, 0);
  await approve(ids.submission, note, 4); assert.deepEqual(await snapshot(), saved);
});

test("the original ACL denies anon/authenticated and permits service role execution", async () => {
  const before = await snapshot();
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`); await rejected(() => approve(), "permission denied"); await db.exec("reset role");
    assert.deepEqual(await snapshot(), before);
  }
  await db.exec("set role service_role"); await approve(); await db.exec("reset role");
  const saved = await snapshot(); assert.equal(saved.point_transactions.length, 1); assert.equal(saved.earnings_transactions.length, 1);
});
