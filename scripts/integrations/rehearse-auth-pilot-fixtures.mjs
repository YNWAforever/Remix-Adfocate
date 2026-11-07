// Disposable local SQL projection. Fake Auth IDs never leave this process.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { localBaseline } from './shared-db-local-baseline.mjs';
import { createAuthPilotFixtures } from './auth-pilot-fixtures.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = path.join(root, 'docs/review/kocmax-stage-4d/d1/shared-database');
const review = path.join(root, 'docs/review/kocmax-stage-4d/d1/auth-permission-execution');
const report = { mode: 'LOCAL_SQL_WITH_FAKE_AUTH_ONLY', result: 'NOT_RUN', checks: [], networkAttempts: 0, realAuthAccountsCreated: 0 };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { report.networkAttempts++; throw new Error('NETWORK_FORBIDDEN'); };
let db;
const digest = value => createHash('sha256').update(value).digest('hex');
try {
  const full = await fs.readFile(path.join(folder, '10-forward-proposed.sql'), 'utf8');
  const payload = full.split('-- BEGIN REVIEWED PAYLOAD\n')[1]?.split('-- END REVIEWED PAYLOAD')[0];
  if (digest(payload || '') !== 'c879b204d9b2928c6426b641262096fff23ef1a1b49b33a8f2003afd5ee9dbff') throw new Error('FOUNDATION_PAYLOAD_DRIFT');
  const sql = await fs.readFile(path.join(review, '22-proposed-auth-boundary-apply.sql'), 'utf8');
  if (digest(sql) !== 'ae276f3dfc22539b48e482dceb1aeab8de2774c75f32816fe58665bfef8b7b8d') throw new Error('AUTH_SQL_DRIFT');
  db = (await localBaseline(folder)).db;
  await db.exec(`begin;\n${payload}\ncommit;`);
  await db.exec(sql);
  await db.exec('alter table auth.users add column email_confirmed_at timestamptz;');
  const manifestText = await fs.readFile(path.join(review, 'fixture-manifest.prepared.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  const users = manifest.accounts.map((a, index) => ({
    alias: a.alias, email: a.email, authId: `c2205cc1-972c-44aa-93d4-6b5d620a76${String(index + 1).padStart(2, '0')}`, createdThisRun: true,
  }));
  for (const user of users) await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())", [user.authId, user.email]);
  const fixture = createAuthPilotFixtures({
    manifestText, usersCreated: { phase: 'users_created', projectRef: manifest.projectRef, runId: manifest.runId, users },
    approvalRef: 'LOCAL_ONLY_SYNTHETIC_AUTH', observedAt: '2026-11-01T08:00:00.000Z',
  });
  await db.exec(fixture.seedSql());
  const counts = async () => (await db.query(`select
    (select count(*)::int from public.workspaces) as workspaces,
    (select count(*)::int from public.staff_users) as staff,
    (select count(*)::int from public.brand_users) as brands,
    (select count(*)::int from public.staff_workspace_roles) as roles,
    (select count(*)::int from public.staff_access_audit) as audits,
    (select count(*)::int from public.creators) as creators,
    (select count(*)::int from public.point_transactions) as point_events,
    (select count(*)::int from public.earnings_transactions) as cash_events`)).rows[0];
  const before = await counts();
  if (JSON.stringify(before) !== JSON.stringify({ workspaces: 2, staff: 4, brands: 5, roles: 4, audits: 4, creators: 0, point_events: 0, cash_events: 0 })) throw new Error('SEED_COUNTS_MISMATCH');
  report.checks.push('exact seed creates 2 workspaces, 4 staff, 5 memberships and 4 audited roles without bootstrapping creators or rewards');
  try {
    await db.exec(fixture.seedSql());
    throw new Error('SEED_COLLISION_ACCEPTED');
  } catch (error) {
    await db.exec('rollback;');
    if (!error.message.includes('FIXTURE_COLLISION_STOP_NO_UPSERT')) throw error;
  }
  if (JSON.stringify(await counts()) !== JSON.stringify(before)) throw new Error('COLLISION_CHANGED_DATA');
  report.checks.push('second seed rejects collisions without changing rows or granting twice');
  await db.exec(fixture.roleRevokeSql());
  const reviewer = (await db.query('select role,active,revision from public.staff_workspace_roles where user_id=$1', [users.find(u => u.alias === 'S-R').authId])).rows[0];
  if (reviewer.role !== 'reviewer' || reviewer.active || reviewer.revision !== 2) throw new Error('REVIEWER_REVOCATION_FAILED');
  if ((await counts()).audits !== 5) throw new Error('REVIEWER_AUDIT_MISSING');
  report.checks.push('reviewer revocation advances 1 to 2 and retains the required audit');
  try {
    await db.exec(fixture.roleRevokeSql());
    throw new Error('STALE_REVISION_ACCEPTED');
  } catch (error) {
    await db.exec('rollback;');
    if (!error.message.includes('EXACT_REVIEWER_REVISION_ONE_REQUIRED')) throw error;
  }
  if ((await counts()).audits !== 5) throw new Error('STALE_REPLAY_WROTE_AUDIT');
  report.checks.push('stale role revocation rejects without a duplicate audit');
  report.result = 'LOCAL_FIXTURE_SEED_AND_REVOCATION_PASSED';
} catch (error) {
  report.result = 'LOCAL_FIXTURE_REHEARSAL_FAILED';
  report.error = { message: error.message, code: error.code };
  process.exitCode = 1;
} finally {
  if (db) { await db.exec('rollback;').catch(() => {}); await db.close(); }
  globalThis.fetch = originalFetch;
  report.recordedAtUtc = new Date().toISOString();
  await fs.writeFile(path.join(review, 'fixture-local-rehearsal.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report) + '\n');
}
