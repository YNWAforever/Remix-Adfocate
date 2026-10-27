from pathlib import Path
import ctypes, datetime, hashlib, json, os, shutil, subprocess, sys

R = Path.cwd()
P = R / 'docs/verification/D19-wallet-notifications-offline-20261026'
node = Path('C:/Users/laich/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe')
label = sys.argv[1]
args = sys.argv[2:]
assert label.replace('-', '').isalnum() and args
assert not (P / f'{label}-started.json').exists() and not (P / f'{label}-command.json').exists(), 'Retain terminal evidence; use a new label for a justified rerun'

def put(path, value):
    path.write_text(json.dumps(value, ensure_ascii=True, indent=2) + '\n', encoding='utf-8', newline='\n')

class Memory(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(n, ctypes.c_ulonglong) for n in ['totalPhys', 'availPhys', 'totalCommit', 'availCommit', 'totalVirtual', 'availVirtual', 'extended']]

m = Memory(); m.length = ctypes.sizeof(m)
assert ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
resource = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'freePhysicalGiB': m.availPhys / 2**30, 'freeCommitGiB': m.availCommit / 2**30, 'minimumGiB': 3, 'freeDiskGiB': shutil.disk_usage(R).free / 2**30}
put(P / f'{label}-resource.json', resource)
assert min(resource['freePhysicalGiB'], resource['freeCommitGiB']) >= 3, 'RESOURCE_GATE_BLOCKED_BEFORE_CHILD'
source = json.loads((R / 'docs/verification/code-fingerprint.json').read_text(encoding='utf-8'))
def check_source():
    assert hashlib.sha256(json.dumps(source['files'], separators=(',', ':'), ensure_ascii=False).encode()).hexdigest() == source['fingerprint']
    for item in source['files']:
        assert hashlib.sha256((R / item['path']).read_text(encoding='utf-8').replace('\r\n', '\n').encode()).hexdigest() == item['sha256'], item['path']
check_source()
env = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG') and not any(s in k.upper() for s in ['SUPABASE', 'DATABASE', 'INTEGRATION', 'ADFOCATE', 'OPENAI', 'OPENROUTER', 'ANTHROPIC', 'GATEWAY', 'PROVIDER', 'API_KEY', 'TOKEN', 'SECRET', 'PASS' + 'WORD'])}
for name in ['NODE_OPTIONS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'GLOBAL_AGENT_HTTP_PROXY', 'NODE_USE_ENV_PROXY', 'DOCKER_HOST']:
    env.pop(name, None)
env.update({'NO_PROXY': '127.0.0.1,localhost', 'TZ': 'Asia/Hong_Kong', 'RUN_INTEGRATION': '0', 'RUN_AUDIT_INTEGRATION': '0', 'CI': 'true', 'PATH': str(node.parent) + os.pathsep + env.get('PATH', '')})
npm_cli = Path('C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js')
assert npm_cli.is_file(), 'Use the installed npm CLI explicitly; cached Node22 has no adjacent npm'
env['npm_execpath'] = str(npm_cli)
env['GATE14_READBACK'] = str(P / f'{label}-readback.json')
assert not Path(env['GATE14_READBACK']).exists()
logpath = P / f'{label}.log'
command = [str(node), *args]
receipt = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'command': command, 'node': subprocess.check_output([str(node), '--version'], text=True).strip(), 'resource': resource, 'credentialsProxiesPreloadsStripped': True, 'integrationDisabled': True, 'label': label, 'log': logpath.relative_to(R).as_posix(), 'runtimeTargetCallsRequested': False, 'sourceFingerprint': source['fingerprint'], 'sourceRecords': len(source['files'])}
receipt['npmExecpathProvided'] = str(npm_cli)
with logpath.open('x', encoding='utf-8') as log:
    child = subprocess.Popen(command, cwd=R, env=env, stdout=log, stderr=subprocess.STDOUT)
    receipt['pid'] = child.pid
    put(P / f'{label}-started.json', receipt)
    print(json.dumps({'label': label, 'pid': child.pid, 'status': 'RUNNING_LOCAL_ONLY'}), flush=True)
    code = child.wait()
try:
    check_source()
    receipt['sourceUnchangedAfter'] = True
except AssertionError as changed:
    receipt['sourceUnchangedAfter'] = False
    receipt['sourceAfterMismatchPath'] = str(changed)
receipt.update(endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), exit=code)
put(P / f'{label}-command.json', receipt)
print(json.dumps({'label': label, 'exit': code, 'log': receipt['log']}), flush=True)
sys.exit(code if receipt['sourceUnchangedAfter'] else 1)
