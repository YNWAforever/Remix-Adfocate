// Local-only platform/launch adapters. No work occurs at import time.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
const exec = promisify(execFile);
const fail = () => { throw new Error('LOCAL_GUARD_FAILED'); };
const PRIVATE = 'C:/Users/laich/AppData/Local/KOCmax/AuthPilot/5f694251-c6eb-4f5f-a281-25e91db81c04';
// Windows redirects this exact LocalAppData location for the installed Codex
// package. Admit its observed physical directory, never arbitrary realpaths.
// Both logical and physical locations still undergo owner/DACL/reparse checks.
const PACKAGED_PRIVATE = 'C:/Users/laich/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/KOCmax/AuthPilot/5f694251-c6eb-4f5f-a281-25e91db81c04';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKER = fileURLToPath(new URL('./auth-pilot-worker.mjs', import.meta.url));

export function cleanEnvironment(source = process.env) {
  // No inherited NODE_OPTIONS, proxy, service keys, AI keys, VITE_* or dotenv.
  const allowed = ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP',
    'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PROCESSOR_ARCHITECTURE'];
  return Object.fromEntries(allowed.filter((key) => source[key]).map((key) => [key, source[key]]));
}

export function isPinnedPrivateDirectoryResolution(directory, real) {
  if (typeof directory !== 'string' || typeof real !== 'string') return false;
  const normalize = (value) => path.win32.resolve(value).toLowerCase();
  return normalize(directory) === normalize(PRIVATE) &&
    [PRIVATE, PACKAGED_PRIVATE].some((expected) => normalize(real) === normalize(expected));
}
export function isPinnedPrivateCacheResolution(directory, real) {
  if (typeof directory !== 'string' || typeof real !== 'string') return false;
  const normalize = (value) => path.win32.resolve(value).toLowerCase();
  return ['A', 'B'].some((alias) =>
    normalize(directory) === normalize(path.win32.join(PRIVATE, 'vite-cache-' + alias)) &&
    [PRIVATE, PACKAGED_PRIVATE].some((root) =>
      normalize(real) === normalize(path.win32.join(root, 'vite-cache-' + alias))));
}

export async function assertPrivateDirectory(directory) {
  if (process.platform !== 'win32' ||
      path.resolve(directory).replaceAll('\\', '/').toLowerCase() !== PRIVATE.toLowerCase()) fail();
  const real = await fs.realpath(directory);
  if (!isPinnedPrivateDirectoryResolution(directory, real)) fail();
  // Read-only ACL inspection, fixed script, no key in args/environment/output.
  const script = [
    '$ErrorActionPreference="Stop"',
    '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$paths=@($env:AUTH_PILOT_PRIVATE_DIR,$env:AUTH_PILOT_PHYSICAL_DIR) | Select-Object -Unique',
    'foreach($p in $paths){',
    '$walk=[IO.DirectoryInfo]::new($p)',
    'while($null -ne $walk){ if($walk.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "link"}; $walk=$walk.Parent }',
    '$root=Get-Acl -LiteralPath $p',
    'if(-not $root.AreAccessRulesProtected){throw "unprotected"}',
    '$items=@((Get-Item -LiteralPath $p)) + @(Get-ChildItem -LiteralPath $p -Force)',
    'foreach($item in $items){',
    ' if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "link"}',
    ' $a=Get-Acl -LiteralPath $item.FullName',
    ' if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){throw "owner"}',
    ' $rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))',
    ' if($rules.Count -ne 2){throw "acl"}',
    ' foreach($s in @($sid,"S-1-5-18")){',
    '  $r=@($rules | Where-Object {$_.IdentityReference.Value -eq $s})',
    '  if($r.Count -ne 1 -or $r[0].AccessControlType -ne "Allow" -or $r[0].FileSystemRights -ne "FullControl"){throw "acl"}',
    ' }',
    '}',
    '}',
    '[Console]::Write("OK")',
  ].join('\n');
  const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = await exec(executable, ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...cleanEnvironment(), AUTH_PILOT_PRIVATE_DIR: directory, AUTH_PILOT_PHYSICAL_DIR: real },
      windowsHide: true, timeout: 15000, maxBuffer: 4096 });
  if (result.stdout !== 'OK' || result.stderr.trim()) fail();
}

export async function readJsonFile(file, optional = false) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1_048_576) fail();
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}

export async function writeJsonAtomic(file, data) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail();
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = file + '.' + randomBytes(8).toString('hex') + '.partial';
  try {
    await fs.writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  }
  catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}

export async function removePrivateCredentials(directory) {
  await assertPrivateDirectory(directory);
  const owned = (await fs.readdir(directory)).filter((name) =>
    name === 'accounts.json' || /^accounts\.json\.[a-f0-9]{16}\.partial$/.test(name));
  for (const name of owned) {
    const file = path.join(directory, name);
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail();
    await fs.unlink(file); // Exact credential files, never recursive deletion or other private files.
  }
  // Logical removal only, not a promise of secure erasure on SSD/backups.
}

export async function verifyCheckout(root) {
  const options = { cwd: root, env: cleanEnvironment(), windowsHide: true, timeout: 10000, maxBuffer: 1024 };
  const branch = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], options);
  const head = await exec('git', ['rev-parse', 'HEAD'], options);
  if (branch.stdout.trim() !== 'codex/kocmax-studio-stages-1-2' ||
      head.stdout.trim() !== '5c60020091e8e6fee934b61c498bf7518944c433') fail();
}

export async function acquireLock(directory) {
  const file = path.join(directory, 'worker.lock');
  const handle = await fs.open(file, 'wx', 0o600);
  await handle.writeFile(String(process.pid));
  await handle.close();
  return async () => {
    if ((await fs.readFile(file, 'utf8')) === String(process.pid)) await fs.unlink(file);
  };
}

export async function launchApps(children, config) {
  if (children.size) fail();
  const results = [];
  try {
    for (const [index, workspace] of config.workspaces.entries()) {
      const port = 8784 + index;
      const child = fork(WORKER, ['--app-child'], {
        cwd: config.root, env: cleanEnvironment(), windowsHide: true,
        execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      children.set(workspace.alias, child);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('APP_START_FAILED')), 45000);
        const failed = () => { clearTimeout(timer); reject(new Error('APP_START_FAILED')); };
        child.once('error', failed); child.once('exit', failed);
        child.on('message', (message) => {
          if (message?.type !== 'ready' || message.port !== port || message.alias !== workspace.alias) return;
          clearTimeout(timer); child.removeListener('exit', failed); child.removeListener('error', failed);
          resolve();
        });
        // Root service key is sent only across the inherited IPC pipe, never argv/env/file.
        child.send({ type: 'config', ...config, workspace, port }, (error) => { if (error) failed(); });
      });
      results.push({ alias: workspace.alias, origin: 'http://127.0.0.1:' + port, pid: child.pid, status: 'STARTED' });
    }
    return results;
  } catch (error) { await stopApps(children); throw error; }
}

export async function stopApps(children) {
  for (const [alias, child] of children) {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          const hard = setTimeout(() => reject(new Error('OWNED_APP_STOP_UNCONFIRMED')), 5000);
          child.once('exit', () => { clearTimeout(hard); resolve(); });
        }, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        if (child.connected) child.send({ type: 'stop' }, () => {});
        else child.kill();
      });
    }
    children.delete(alias); // Only child handles created by this process; never arbitrary PIDs.
  }
}

export async function enableProductCleanup(children, authIds) {
  if (children.size !== 2) fail();
  for (const child of children.values()) {
    await new Promise((resolve, reject) => {
      const nonce = randomBytes(16).toString('hex');
      const timer = setTimeout(() => { child.off('message', listener); reject(new Error('CLEANUP_APP_NOT_READY')); }, 5000);
      const listener = (message) => {
        if (message?.type !== 'cleanup-enabled' || message.nonce !== nonce) return;
        clearTimeout(timer); child.off('message', listener); resolve();
      };
      child.on('message', listener);
      child.send({ type: 'enable-product-cleanup', authIds, nonce }, (error) => {
        if (error) { clearTimeout(timer); child.off('message', listener); reject(error); }
      });
    });
  }
}

export function allowedProductCleanup(address, method, body, authId, supabaseUrl) {
  if (!authId) return false;
  const url = new URL(address);
  if (url.origin !== supabaseUrl) return false;
  let value; try { value = typeof body === 'string' ? JSON.parse(body) : null; } catch { return false; }
  if (url.pathname === '/rest/v1/rpc/anonymize_creator_account') {
    return method === 'POST' && value?.p_creator === authId && Object.keys(value).length === 1;
  }
  if (url.pathname !== '/auth/v1/admin/users/' + authId) return false;
  if (method === 'GET') return true;
  if (method !== 'PUT' || !value) return false;
  if (Object.keys(value).length === 1 && value.phone === '') return true;
  return Object.keys(value).sort().join(',') === 'ban_duration,email,email_confirm,user_metadata' &&
    value.email === 'deleted-' + authId + '@deleted.invalid' && value.email_confirm === true &&
    value.ban_duration === '876000h' && value.user_metadata &&
    Object.keys(value.user_metadata).length === 0;
}

/** Deliberately excludes email/OAuth, AI and reward-writing RPCs from this pilot. */
export function allowedAppFetch(address, method, supabaseUrl) {
  const url = new URL(address);
  if (url.origin !== supabaseUrl || url.username || url.password) return false;
  if (url.pathname.startsWith('/auth/v1/')) {
    return (url.pathname === '/auth/v1/user' && method === 'GET') ||
      (url.pathname === '/auth/v1/logout' && method === 'POST') ||
      (url.pathname === '/auth/v1/token' && method === 'POST' &&
        ['password', 'refresh_token'].includes(url.searchParams.get('grant_type')));
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const name = url.pathname.slice('/rest/v1/rpc/'.length);
    if (name === 'studio_command') return method === 'POST';
    return name === 'bootstrap_creator_account' || /^(get_|can_read_)/.test(name);
  }
  if (method !== 'GET' && method !== 'HEAD' &&
      /^\/rest\/v1\/(point_|earnings_|redemption|redemptions|campaign_rank|notifications)/.test(url.pathname)) return false;
  return url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/');
}

export function appEnvironment(config) {
  return {
    ...cleanEnvironment(), NODE_ENV: 'development',
    SUPABASE_URL: config.supabaseUrl, SUPABASE_ANON_KEY: config.publicKey,
    VITE_SUPABASE_URL: config.supabaseUrl, VITE_SUPABASE_ANON_KEY: config.publicKey,
    VITE_DEFAULT_WORKSPACE: config.workspace.slug, BOOTSTRAP_WORKSPACE_SLUGS: config.workspace.slug,
    STUDIO_THREADS: 'true', VITE_STUDIO_THREADS: 'true', VITE_STUDIO_SHELL: 'true',
    VITE_STUDIO_FIXTURE: 'false', INTEGRATIONS_ENABLED: 'false', INTEGRATIONS_MODE: '',
    INSTAGRAM_CONNECTIONS_ENABLED: 'false', DRIVE_CONNECTIONS_ENABLED: 'false',
    VITE_ENABLE_GOOGLE: 'false', VITE_ENABLE_WHATSAPP: 'false',
    AI_GATEWAY_API_KEY: '', OPENAI_API_KEY: '',
  };
}

export async function runAppChild() {
  if (!process.send || !process.connected) fail();
  const config = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('APP_CONFIG_MISSING')), 15000);
    process.once('message', (message) => { clearTimeout(timer); resolve(message); });
  });
  if (config?.type !== 'config' || config.root !== ROOT ||
      path.resolve(config.privateDir || '').replaceAll('\\', '/').toLowerCase() !== PRIVATE.toLowerCase() ||
      config.supabaseUrl !== 'https://mhkoayftiuojxlrkollf.supabase.co' ||
      !['A', 'B'].includes(config.workspace?.alias) ||
      config.port !== (config.workspace.alias === 'A' ? 8784 : 8785) ||
      !Array.isArray(config.authIds) || config.authIds.length !== 9) fail();
  await assertPrivateDirectory(config.privateDir);
  // Independently recheck the same prerequisite evidence before importing any app client.
  const contract = await import('./auth-pilot-worker.mjs');
  contract.validateEvidence({
    manifestBytes: await fs.readFile(path.join(contract.REPORT_DIR, 'fixture-manifest.prepared.json')),
    sqlBytes: await fs.readFile(path.join(contract.REPORT_DIR, '22-proposed-auth-boundary-apply.sql')),
    receipt: await readJsonFile(path.join(contract.REPORT_DIR, 'application-receipt.json')),
    gate: await readJsonFile(path.join(contract.REPORT_DIR, 'auth-pilot-readonly-gate.json')),
  });
  if (!contract.WORKSPACES.some((w) => JSON.stringify(w) === JSON.stringify(config.workspace))) fail();
  const childEnvironment = appEnvironment(config);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, childEnvironment);
  process.env.SUPABASE_SERVICE_KEY = config.serviceKey; // Memory only; backend modules expect this variable.
  config.serviceKey = '';
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) console[method] = () => {};
  const cleanupScope = new AsyncLocalStorage();
  const cleanupIds = new Set();
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const method = (init.method || input?.method || 'GET').toUpperCase();
    if (!allowedAppFetch(url, method, config.supabaseUrl) &&
        !allowedProductCleanup(url, method, init.body, cleanupScope.getStore(), config.supabaseUrl)) {
      return Promise.reject(new Error('PILOT_EGRESS_DISABLED'));
    }
    return nativeFetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
  };
  const [{ createServer }, { default: react }, { default: tailwind }, { default: tsconfigPaths }] = await Promise.all([
    import('vite'), import('@vitejs/plugin-react'), import('@tailwindcss/vite'), import('vite-tsconfig-paths'),
  ]);
  const logger = { info() {}, warn() {}, warnOnce() {}, error() {}, clearScreen() {},
    hasErrorLogged: () => false, hasWarned: false };
  const restricted = {
    name: 'auth-pilot-local-boundary', enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replaceAll('\\', '/');
      if (file.endsWith('/src/main.tsx')) {
        const exact = 'if (!receiptDocument) initializeActivationAnalytics();';
        if (!code.includes(exact)) fail();
        // This initializer installs only a DOM CustomEvent sink, not external transport.
        return code.replace(exact, '/* Local DOM analytics initializer suppressed for this pilot. */');
      }
      if (file.endsWith('/src/lib/supabase.ts')) {
        const exact = '    auth: {';
        if (!code.includes(exact)) fail();
        const guard = allowedAppFetch.toString();
        return code.replace(exact,
          '    global: { fetch: (input: RequestInfo | URL, init: RequestInit = {}) => {' +
          'const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;' +
          'const method = (init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();' +
          'if (!(' + guard + ')(url, method, ' + JSON.stringify(config.supabaseUrl) + '))' +
          ' return Promise.reject(new Error("PILOT_EGRESS_DISABLED"));' +
          'return fetch(input, {...init, redirect:"error"}); } },\n' + exact);
      }
    },
    async configureServer(server) {
      const origin = 'http://127.0.0.1:' + config.port;
      server.middlewares.use((req, res, next) => {
        if (req.headers.host !== '127.0.0.1:' + config.port ||
            (req.headers.origin && req.headers.origin !== origin)) {
          res.statusCode = 403; res.end('LOCAL_ORIGIN_REQUIRED'); return;
        }
        let subject;
        if (req.url?.startsWith('/api') && req.headers.authorization) {
          try { subject = JSON.parse(Buffer.from(req.headers.authorization.slice(7).split('.')[1], 'base64url')).sub; } catch {}
          // Scope prefilter only: actual JWT validation remains in the original application.
          if (!config.authIds.includes(subject)) { res.statusCode = 403; res.end('PILOT_IDENTITY_REQUIRED'); return; }
        }
        if (req.method === 'POST' && req.url?.split('?')[0] === '/api/me/delete' && cleanupIds.has(subject)) {
          cleanupScope.run(subject, next); return;
        }
        next();
      });
      const [{ createApp }, { createViteApiMiddleware }] = await Promise.all([
        server.ssrLoadModule('/server/app.ts'), server.ssrLoadModule('/server/devApi.ts'),
      ]);
      server.middlewares.use(createViteApiMiddleware(createApp().app));
    },
  };
  // No dotenv/config or router generator: original source and routeTree remain untouched.
  const cacheDir = path.join(config.privateDir, 'vite-cache-' + config.workspace.alias);
  await fs.mkdir(cacheDir).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  const cacheInfo = await fs.lstat(cacheDir);
  if (!cacheInfo.isDirectory() || cacheInfo.isSymbolicLink() ||
      !isPinnedPrivateCacheResolution(cacheDir, await fs.realpath(cacheDir))) fail();
  await assertPrivateDirectory(config.privateDir);
  const server = await createServer({
    root: ROOT, configFile: false, envDir: false,
    cacheDir,
    customLogger: logger, logLevel: 'silent',
    plugins: [restricted, react(), tailwind(), tsconfigPaths()],
    server: { host: '127.0.0.1', port: config.port, strictPort: true, open: false,
      allowedHosts: ['127.0.0.1'], cors: false, hmr: { host: '127.0.0.1' },
      fs: { strict: true, allow: [ROOT], deny: ['.env', '.env.*', '**/.git/**', '**/node_modules/**/credentials*'] } },
  });
  const stop = async () => { await server.close(); process.env.SUPABASE_SERVICE_KEY = ''; process.exit(0); };
  process.on('message', (message) => {
    if (message?.type === 'stop') void stop();
    if (message?.type === 'enable-product-cleanup' && Array.isArray(message.authIds) &&
        message.authIds.every((id) => config.authIds.includes(id))) {
      for (const id of message.authIds) cleanupIds.add(id);
      process.send({ type: 'cleanup-enabled', nonce: message.nonce });
    }
  });
  process.once('disconnect', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  await server.listen();
  const address = server.httpServer.address();
  if (address.address !== '127.0.0.1' || address.port !== config.port) { await server.close(); fail(); }
  process.send({ type: 'ready', alias: config.workspace.alias, port: config.port });
}
