// Disposable in-process SQL only. No remote URL, Auth client, or customer rows.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";
import { localBaseline } from "./shared-db-local-baseline.mjs";
import { sha256 } from "./shared-db-sql.mjs";
import { checkAtomicBootstrap } from "./check-atomic-bootstrap.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const folder = resolve(root, "docs/review/kocmax-stage-4d/d1/shared-database");
const output = resolve(root, "docs/review/kocmax-stage-4d/d1/auth-permission-execution");
const report = { mode: "LOCAL_MEMORY_POLICY_PROJECTION", result: "NOT_RUN", checks: [], findings: [], networkAttempts: 0 };
const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { report.networkAttempts++; throw new Error("REMOTE_NETWORK_FORBIDDEN"); };
let db;
try {
  const manifest = JSON.parse(await readFile(resolve(folder, "packet-manifest.json"), "utf8"));
  const source = await readFile(resolve(folder, "10-forward-proposed.sql"), "utf8");
  const payload = source.split("-- BEGIN REVIEWED PAYLOAD\n")[1]?.split("-- END REVIEWED PAYLOAD")[0];
  if (!payload || sha256(payload) !== manifest.payloadSha256) throw new Error("REVIEWED_PAYLOAD_DRIFT");
  report.payloadSha256 = manifest.payloadSha256;
  const baseline = await localBaseline(folder);
  db = baseline.db;
  report.limitations = baseline.limitations;
  await db.exec(`begin;\n${payload}\ncommit;`);
  const actors = [
    "b2205cc1-972c-44aa-93d4-6b5d620a7401",
    "b2205cc1-972c-44aa-93d4-6b5d620a7402",
    "b2205cc1-972c-44aa-93d4-6b5d620a7403",
    "b2205cc1-972c-44aa-93d4-6b5d620a7404",
  ];
  for (const id of actors) await db.query("insert into auth.users(id) values($1)", [id]);
  for (const [i, name] of ["creator_a", "creator_peer", "creator_b", "operator_a"].entries()) {
    await db.query("select set_config($1,$2,false)", [`kocmax.fixture_${name}`, actors[i]]);
  }
  await db.query("select set_config('kocmax.fixture_approval','LOCAL_MEMORY_PERMISSION_TEST',false)");
  const fixture = await readFile(resolve(folder, "30-fixture-transaction.sql"), "utf8");
  await db.exec(fixture.replace(/ROLLBACK;\s*$/i, ""));
  const workspace = "b2205cc1-972c-44aa-93d4-6b5d620a7301";
  const mission = "b2205cc1-972c-44aa-93d4-6b5d620a7311";
  const staff = actors[3];
  await db.query(
    "select private.bootstrap_staff_access($1,$2,$1,'finance_viewer',true,1,$3,'Local permission overlap test','LOCAL_ONLY')",
    [staff, workspace, "b2205cc1-972c-44aa-93d4-6b5d620a7491"],
  );
  await db.exec("set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [staff]);
  const edited = await db.query("update public.missions set title='LOCAL FINANCE CROSS-SURFACE PROBE' where id=$1 returning id", [mission]);
  report.checks.push({ case: "finance_direct_mission_update", expectedRows: 0, actualRows: edited.rows.length });
  if (edited.rows.length) report.findings.push({
    code: "FINANCE_BRAND_POLICY_OVERLAP",
    detail: "An active finance_viewer with required brand membership can update a draft mission through the authenticated SQL role.",
    evidenceLayer: "Local SQL claim substitute, not hosted JWT",
  });
  await db.exec("reset role;");
  const candidate = await readFile(resolve(output, "20-proposed-brand-staff-write-boundary.sql"), "utf8");
  report.candidateSha256 = sha256(candidate);
  const bundle = JSON.parse(await readFile(resolve(output, "sql-review-manifest.json"), "utf8"));
  const combined = await readFile(resolve(output, bundle.file), "utf8");
  if (sha256(combined) !== bundle.sha256) throw new Error("CANDIDATE_BUNDLE_DRIFT");
  for (const entry of bundle.sources) {
    if (sha256(await readFile(resolve(output, entry.name), "utf8")) !== entry.sha256) throw new Error("CANDIDATE_SOURCE_DRIFT");
  }
  report.reviewedApplySha256 = bundle.sha256;
  await db.exec(combined.replace(/^BEGIN;\s*$/mi, "").replace(/^COMMIT;\s*$/mi, ""));
  report.candidateChecks = [];
  for (const role of ["finance_viewer", "reviewer", "operator", "workspace_admin"]) {
    const revision = (await db.query("select revision from public.staff_workspace_roles where user_id=$1 and workspace_id=$2", [staff, workspace])).rows[0].revision;
    await db.query(
      "select private.bootstrap_staff_access($1,$2,$1,$3,true,$4,gen_random_uuid(),'Local candidate role test','LOCAL_ONLY')",
      [staff, workspace, role, revision],
    );
    await db.exec("set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [staff]);
    const changed = await db.query("update public.missions set title=$1 where id=$2 returning id", [`LOCAL ${role}`, mission]);
    const expected = role === "workspace_admin" ? 1 : 0;
    if (changed.rows.length !== expected) throw new Error(`CANDIDATE_ROLE_WRITE_MISMATCH:${role}`);
    report.candidateChecks.push({ case: `${role}_mission_update`, rows: changed.rows.length, expectedRows: expected });
    if (role !== "workspace_admin") {
      await db.exec("savepoint rejected_delete;");
      try {
        const removed = await db.query("delete from public.missions where id=$1 returning id", [mission]);
        if (removed.rows.length) throw new Error(`CANDIDATE_ROLE_DELETE_ALLOWED:${role}`);
      } catch (error) {
        await db.exec("rollback to savepoint rejected_delete;");
        if (error.code !== "42501") throw error;
      }
      await db.exec("savepoint rejected_insert;");
      try {
        await db.query("insert into public.missions(workspace_id,slug,title,mission_type) values($1,$2,'LOCAL DENIED','ugc')",
          [workspace, `local-denied-${role}`]);
        throw new Error(`CANDIDATE_ROLE_INSERT_ALLOWED:${role}`);
      } catch (error) {
        await db.exec("rollback to savepoint rejected_insert;");
        if (error.code !== "42501") throw error;
      }
      report.candidateChecks.push({ case: `${role}_insert_delete_denied`, passed: true });
    }
    await db.exec("reset role;");
  }
  await db.query("insert into public.brand_users(user_id,email,workspace_id,role,active) values($1,'local-brand@example.invalid',$2,'owner',true)", [actors[1], workspace]);
  await db.exec("set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actors[1]]);
  const brandWrite = await db.query("update public.missions set title='LOCAL BRAND AUTHOR' where id=$1 returning id", [mission]);
  if (brandWrite.rows.length !== 1) throw new Error("CANDIDATE_BROKE_BRAND_ONLY_AUTHORING");
  report.candidateChecks.push({ case: "brand_only_authoring_preserved", passed: true });
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actors[2]]);
  const outsiderWrite = await db.query("update public.missions set title='LOCAL OUTSIDER' where id=$1 returning id", [mission]);
  if (outsiderWrite.rows.length) throw new Error("CANDIDATE_OUTSIDER_WRITE_ALLOWED");
  report.candidateChecks.push({ case: "other_workspace_write_denied", passed: true });
  await db.exec("reset role;");
  const revision = (await db.query("select revision from public.staff_workspace_roles where user_id=$1 and workspace_id=$2", [staff, workspace])).rows[0].revision;
  await db.query("select private.bootstrap_staff_access($1,$2,$1,'workspace_admin',false,$3,gen_random_uuid(),'Local revoked actor test','LOCAL_ONLY')",
    [staff, workspace, revision]);
  await db.exec("set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [staff]);
  const revokedWrite = await db.query("update public.missions set title='LOCAL REVOKED' where id=$1 returning id", [mission]);
  if (revokedWrite.rows.length) throw new Error("CANDIDATE_REVOKED_ROLE_FELL_BACK_TO_BRAND");
  report.candidateChecks.push({ case: "revoked_staff_no_brand_fallback", passed: true });
  await db.exec("reset role;");
  const atomicCandidate = await readFile(resolve(output, "21-proposed-atomic-bootstrap.sql"), "utf8");
  report.atomicCandidateSha256 = sha256(atomicCandidate);
  report.atomicBootstrapChecks = await checkAtomicBootstrap(db, workspace, "b2205cc1-972c-44aa-93d4-6b5d620a7302");
  report.limits = ["Real Auth/JWT and two-connection deletion/first-login races are not tested by PGlite."];
  const joinDefinitions = (await db.query(
    "select p.proname as name, pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='join_mission'",
  )).rows;
  report.joinXpReview = joinDefinitions.length ? {
    status: "STATIC_REVIEW_ONLY",
    functions: joinDefinitions.map(row => row.name),
    writesXp: joinDefinitions.some(row => /set\s+xp\s*=\s*xp\s*\+/i.test(row.definition)),
    positiveSharedJoin: "NOT_RUN_REQUIRES_XP_SCOPE_RECONCILIATION",
  } : { status: "FUNCTION_NOT_FOUND_NO_CLAIM" };
  const immutable = await db.query(
    "select tgname from pg_trigger where not tgisinternal and tgrelid in ('public.mission_draft_versions'::regclass,'public.mission_workflow_events'::regclass)",
  );
  report.immutableTriggers = immutable.rows.map(row => row.tgname);
  await db.exec("rollback;");
  report.result = "BASELINE_FINDING_REPRODUCED_CANDIDATE_PASSED_OFFLINE";
} catch (error) {
  report.result = "REHEARSAL_FAILED";
  report.error = { message: error.message, code: error.code };
  process.exitCode = 1;
} finally {
  if (db) { await db.exec("rollback;").catch(() => {}); await db.close(); }
  globalThis.fetch = savedFetch;
  report.recordedAtUtc = new Date().toISOString();
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, `local-policy-${report.recordedAtUtc.replaceAll(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n");
  await writeFile(resolve(output, "local-policy-baseline.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
