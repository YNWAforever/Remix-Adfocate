// Read-only persistence observer for the two original global-job integration cases.
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { verifyIntegrationIdentity } from '../run-integration-tests.mjs';
// The shared preload allows only the two older targets. This observer instead
// permits exactly this live-attested new origin and rejects every other origin.

const env = process.env;
const identity = verifyIntegrationIdentity(env);
const definition = JSON.parse(readFileSync(env.INTEGRATION_PRISTINE_OBSERVER_JSON, 'utf8'));
if (definition.runId !== identity.runId || definition.projectId !== identity.projectId) throw new Error('Pristine observer identity mismatch');
const origin = new URL(env.SUPABASE_URL).origin;
const delegate = globalThis.fetch;
const { Request } = globalThis;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function snapshot() {
  const result = spawnSync('docker', ['exec', '-i', identity.databaseContainerId, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', definition.databaseRole, '-d', definition.databaseName], {
    encoding: 'utf8', timeout: 15000, input: `begin read only;${definition.query}commit;`,
  });
  if (result.status !== 0 || result.error) throw new Error('Pristine financial persistence snapshot unavailable');
  return JSON.parse(result.stdout);
}
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== origin) throw new Error('Pristine verification cannot leave its attested API target');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(close_due_campaigns|snapshot_campaign_leaderboards)$/)?.[1];
  if (!rpc || method !== 'POST') return delegate(input, init);
  const before = snapshot();
  const response = await delegate(input, init);
  const after = snapshot();
  const neutral = digest(before.finance) === digest(after.finance);
  const value = await response.clone().json().catch(() => null);
  appendFileSync(env.INTEGRATION_PRISTINE_CALL_JOURNAL, JSON.stringify({
    at: new Date().toISOString(), runId: identity.runId, rpc, status: response.status,
    result: typeof value === 'number' ? value : null, before, after, financialNeutrality: neutral,
  }) + '\n');
  if (!neutral) throw new Error('Global campaign job changed the financial snapshot');
  return response;
};
