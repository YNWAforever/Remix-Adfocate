from pathlib import Path
import ctypes, datetime, hashlib, json, os, re, shutil, subprocess, sys
R = Path.cwd(); P = R / 'docs/verification/D19-assistant-offline-20261026'
mode, label = sys.argv[1:3]
assert mode in ['test', 'lint', 'type'] and re.fullmatch('[a-z0-9-]+', label)
assert not (P / f'{label}-command.json').exists(), 'Never overwrite a terminal receipt'
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def put(p, value): Path(p).write_text(json.dumps(value, ensure_ascii=True, indent=2) + '\n', encoding='utf-8', newline='\n')
node = Path('C:/Users/laich/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe')
source = json.loads((R / 'docs/verification/code-fingerprint.json').read_text(encoding='utf-8'))
def check_source():
    assert source['fingerprint'] == 'e8a3ad3d7d35ed33eedf6486068dfa1aec6486a0e97b9ad8dcf4915744cb2993'
    assert len(source['files']) == 788
    for row in source['files']: assert hashlib.sha256((R / row['path']).read_text(encoding='utf-8').replace('\r\n', '\n').encode()).hexdigest() == row['sha256'], row['path']
    assert sha(R / 'docs/verification/D19-C2-application-runtime-manifest.json') == 'eb5ca8f03a85c5589cc6cbf27ec0ca5524e8600fd2914ad1d4d73f17eec5009a'
check_source()
class Memory(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(n, ctypes.c_ulonglong) for n in ['totalPhys', 'availPhys', 'totalCommit', 'availCommit', 'totalVirtual', 'availVirtual', 'extended']]
m = Memory(); m.length = ctypes.sizeof(m); assert ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
resource = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'freePhysicalGiB': m.availPhys / 2**30, 'freeCommitGiB': m.availCommit / 2**30, 'minimumGiB': 3}
put(P / f'{label}-resource.json', resource)
assert min(resource['freePhysicalGiB'], resource['freeCommitGiB']) >= 3, 'RESOURCE_GATE_BLOCKED_NO_CHILD'
files = [P / 'assistant-boundary.test.tsx', P / 'vitest.offline.mjs']
artifacts = [{'path': p.relative_to(R).as_posix(), 'sha256': sha(p)} for p in files]
fingerprint = hashlib.sha256(json.dumps(artifacts, separators=(',', ':')).encode()).hexdigest()
revision = P / 'source-revisions' / fingerprint
if not revision.exists():
    revision.mkdir(parents=True)
    for file in files: shutil.copyfile(file, revision / file.name)
    put(revision / 'manifest.json', {'artifactFingerprint': fingerprint, 'files': artifacts, 'applicationFingerprint': source['fingerprint'], 'includedInNativeFullOrC2Runtime': False})
command = [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--config', str(P / 'vitest.offline.mjs'), '--reporter=default', '--reporter=json', '--outputFile=' + str(P / f'{label}-native.json')] if mode == 'test' else [str(node), 'node_modules/eslint/bin/eslint.js', *map(str, files)]
if mode == 'type': command = [str(node), 'node_modules/typescript/bin/tsc', '--noEmit', '--project', str(P / 'tsconfig.offline.json')]
env = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG') and not any(s in k.upper() for s in ['SUPABASE', 'DATABASE', 'INTEGRATION', 'ADFOCATE_B2', 'OPENAI', 'OPENROUTER', 'ANTHROPIC', 'GATEWAY', 'PROVIDER', 'API_KEY', 'TOKEN', 'SECRET', ('PASS' + 'WORD')])}
env.pop('NODE_OPTIONS', None); env['TZ'] = 'Asia/Hong_Kong'; env['PATH'] = str(node.parent) + os.pathsep + env.get('PATH', '')
receipt = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'command': command, 'sourceFingerprint': source['fingerprint'], 'sourceRecordsUnchanged': 788, 'verificationArtifacts': artifacts, 'verificationArtifactFingerprint': fingerprint, 'node': subprocess.check_output([str(node), '--version'], text=True).strip(), 'resource': resource, 'envCredentialsAndPreloadsStripped': True, 'configEnvDir': False, 'actualTargetCalls': 0, 'actualSdkClients': 0, 'actualProviderCalls': 0, 'scope': 'Standalone offline JSDOM/Hono with explicit fake Auth/DB and injected mock provider; no native full or real integration claim'}
if mode == 'type': receipt['additionalConfiguration'] = {'path': (P / 'tsconfig.offline.json').relative_to(R).as_posix(), 'sha256': sha(P / 'tsconfig.offline.json')}
with (P / f'{label}.log').open('w', encoding='utf-8') as log:
    child = subprocess.Popen(command, cwd=R, env=env, stdout=log, stderr=subprocess.STDOUT)
    receipt['pid'] = child.pid; put(P / f'{label}-started.json', receipt)
    print(json.dumps({'label': label, 'pid': child.pid, 'status': 'RUNNING_OFFLINE_ONLY'}), flush=True)
    code = child.wait()
check_source(); assert artifacts == [{'path': p.relative_to(R).as_posix(), 'sha256': sha(p)} for p in files]
if mode == 'type': assert sha(R / receipt['additionalConfiguration']['path']) == receipt['additionalConfiguration']['sha256']
receipt.update(endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), exit=code)
if mode == 'test':
    if (P / f'{label}-native.json').exists():
        native = json.loads((P / f'{label}-native.json').read_text(encoding='utf-8'))
        receipt['nativeCounts'] = {k: native[k] for k in ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests']}
    if (P / 'offline-readback.json').exists(): shutil.copyfile(P / 'offline-readback.json', P / f'{label}-readback.json')
put(P / f'{label}-command.json', receipt)
print(json.dumps({'label': label, 'exit': code, 'nativeCounts': receipt.get('nativeCounts')}), flush=True)
sys.exit(code)
