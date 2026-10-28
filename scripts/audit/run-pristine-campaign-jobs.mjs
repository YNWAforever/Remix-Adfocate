// One-time D19 supplement. This never relaxes global-job isolation on retained targets.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { verifyIntegrationIdentity } from '../run-integration-tests.mjs';

const prefix = 'D19-pristine-rpc';
const planPath = `.codex-tmp/${prefix}-plan.private.json`;
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
if (plan.stage !== 'SCHEMA_READY_PRISTINE') throw new Error('A one-time unused schema-ready target is required');
const targetEnv = JSON.parse(readFileSync(resolve(plan.folder, 'integration-env.private.json'), 'utf8'));
const identity = verifyIntegrationIdentity(targetEnv, undefined, []); // Before SDK/test imports or fixture setup.
const schema = JSON.parse(readFileSync(`docs/verification/${prefix}-schema-before-tests.json`, 'utf8'));
if (JSON.stringify(schema.identity) !== JSON.stringify(identity) || schema.counts.campaigns !== 0 || schema.counts.authUsers !== 0) throw new Error('Pristine schema/baseline identity mismatch');
const observer = JSON.parse(readFileSync(`.codex-tmp/${prefix}-observer.private.json`, 'utf8'));
function sql(query) {
  const result = spawnSync('docker', ['exec', '-i', identity.databaseContainerId, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', observer.databaseRole, '-d', observer.databaseName], { input: query, encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0 || result.error) throw new Error('Pristine target SQL failed');
  return result.stdout.trim();
}
const baseline = JSON.parse(sql("begin read only;select jsonb_build_object('campaigns',(select count(*)from public.campaigns),'authUsers',(select count(*)from auth.users),'submissions',(select count(*)from public.mission_submissions),'cronLaunchActiveJobs',current_setting('cron.launch_active_jobs',true));commit;"));
if (baseline.campaigns || baseline.authUsers || baseline.submissions || baseline.cronLaunchActiveJobs !== 'off') throw new Error('Target is no longer pristine or scheduled jobs are enabled');
const namespace = randomUUID(), workspaceId = randomUUID(), slug = `d19-support-${namespace}`;
const scope = { namespace, workspaceId, slug, createdThisRun: true };
writeFileSync(`docs/verification/${prefix}-fixture.json`, JSON.stringify({ identity, scope, baseline, source: 'New workspace created only after live identity and zero-data checks', cleanup: 'No deletes: exact new fixture IDs retained for inspection', originalIncident: 'OPEN, untouched' }, null, 2) + '\n');
sql(`begin;insert into public.workspaces(id,slug,name)values('${workspaceId}','${slug}','Owned fresh support fixture');commit;`);
const ownedPath = resolve(`.codex-tmp/${prefix}-owned.private.json`), journal = resolve(`.codex-tmp/${prefix}-owned.private.jsonl`), calls = resolve(`.codex-tmp/${prefix}-calls.private.jsonl`);
writeFileSync(ownedPath, JSON.stringify({ tables: { workspaces: { key: 'id', ids: [workspaceId] } } }) + '\n');
writeFileSync(journal, ''); writeFileSync(calls, '');
const env = { ...process.env };
for (const key of Object.keys(env)) if (/SUPABASE|OPENAI|OPENROUTER|ANTHROPIC|RAPIDAPI|^RELEASE_|DATABASE_URL|NODE_OPTIONS/.test(key)) env[key] = '';
Object.assign(env, targetEnv, {
  RUN_INTEGRATION: '1', RUN_AUDIT_INTEGRATION: '0', INTEGRATION_RUNNER: '1',
  INTEGRATION_MUTATION_OWNERSHIP: '1', INTEGRATION_RETAIN_FIXTURES: '1',
  INTEGRATION_FIXTURE_NAMESPACE: namespace, INTEGRATION_FRESH_WORKSPACE_JSON: JSON.stringify(scope),
  INTEGRATION_FIXTURE_SCOPE_JSON: JSON.stringify({ runId: identity.runId, workspaceIds: [workspaceId] }),
  INTEGRATION_OWNED_IDS_PATH: ownedPath, INTEGRATION_OWNED_JOURNAL: journal,
  INTEGRATION_PRISTINE_OBSERVER_JSON: resolve(`.codex-tmp/${prefix}-observer.private.json`),
  INTEGRATION_PRISTINE_CALL_JOURNAL: calls, OPENAI_API_KEY: '', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', RAPIDAPI_KEY: '',
  NODE_OPTIONS: `--import=${pathToFileURL(resolve('scripts/audit/observe-pristine-campaign-jobs.mjs')).href}`,
});
plan.stage = 'TESTING'; writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
const args = ['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', '--maxWorkers=1', '--minWorkers=1', '--testTimeout=60000', '--hookTimeout=60000', '--reporter=dot', '--reporter=json', `--outputFile=.codex-tmp/${prefix}-integration.private.json`, '--testNamePattern=^(close_due_campaigns|snapshot_campaign_leaderboards) ', 'server/test/campaigns-s2.test.ts'];
const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
verifyIntegrationIdentity(targetEnv); // No further mutation on drift.
plan.stage = 'TESTS_FINISHED'; writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
writeFileSync(`docs/verification/${prefix}-run.json`, JSON.stringify({ identity, scope, command: [process.execPath, ...args], exit: result.status ?? 1, providerEnabled: false, productionReadOrWritten: false, cleanup: 'Exact new IDs retained; no delete/reset/restore', testTimeoutReason: 'Container identity and read-only financial observations add synchronous Docker calls; production evidence expiry unchanged' }, null, 2) + '\n');
process.exitCode = result.status ?? 1;
