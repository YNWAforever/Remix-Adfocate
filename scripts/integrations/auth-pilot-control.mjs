// Reads only the private control token. Never reads/prints the service key or passwords.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivateDirectory, readJsonFile } from './auth-pilot-local.mjs';
import { PRIVATE_DIR, ORIGIN, PilotError, safeCode, requirePilot } from './auth-pilot-worker.mjs';

export async function control(args, fetchImpl = globalThis.fetch) {
  requirePilot(args.length === 2 || args.length === 4, 'USAGE_ACTION_AND_OPTIONAL_PRIVATE_DIR');
  const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  requirePilot(Object.keys(options).length === args.length / 2, 'DUPLICATE_ARGUMENT');
  const action = options['--action'];
  requirePilot(['status', 'create-users', 'start-apps', 'login-all', 'cleanup'].includes(action) &&
    Object.keys(options).every((k) => ['--action', '--private-dir'].includes(k)), 'ACTION_NOT_ALLOWED');
  const directory = options['--private-dir'] || PRIVATE_DIR;
  await assertPrivateDirectory(directory);
  const config = await readJsonFile(path.join(directory, 'control.json'));
  requirePilot(config.origin === ORIGIN && /^[A-Za-z0-9_-]{43,128}$/.test(config.token), 'PRIVATE_CONTROL_INVALID');
  const response = await fetchImpl(ORIGIN + '/control', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(300000),
    headers: { 'authorization': 'Bearer ' + config.token, 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const text = await response.text();
  requirePilot(text.length < 32768, 'CONTROL_RESPONSE_TOO_LARGE');
  let data; try { data = JSON.parse(text); } catch { throw new PilotError('CONTROL_RESPONSE_INVALID'); }
  // Never echo arbitrary local-server output: reconstruct this small public projection.
  const clean = {
    ok: data.ok === true,
    code: typeof data.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.code) ? data.code : undefined,
    status: typeof data.status === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.status) ? data.status : undefined,
    accounts: Array.isArray(data.accounts) ? data.accounts.slice(0, 9).map((a) => ({
      alias: typeof a.alias === 'string' && /^[A-Z]-[A-Z]$/.test(a.alias) ? a.alias : null,
      authId: typeof a.authId === 'string' && /^[a-f0-9-]{36}$/i.test(a.authId) ? a.authId : null,
      login: typeof a.login === 'string' && /^[A-Z0-9_]{1,80}$/.test(a.login) ? a.login : null,
      cleanup: typeof a.cleanup === 'string' && /^[A-Z0-9_]{1,80}$/.test(a.cleanup) ? a.cleanup : null,
    })) : [],
  };
  return clean;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  control(process.argv.slice(2)).then((data) => {
    process.stdout.write(JSON.stringify(data) + '\n');
    if (!data.ok) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(JSON.stringify({ ok: false, code: safeCode(error) }) + '\n');
    process.exitCode = 1;
  });
}
