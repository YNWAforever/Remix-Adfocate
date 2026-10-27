from pathlib import Path
import datetime, hashlib, json, shutil, subprocess, sys

R = Path.cwd()
P = R / 'docs/verification/D19-legacy-sql-memory-20261026'
mode = sys.argv[1]
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def put(p, obj): Path(p).write_text(json.dumps(obj, ensure_ascii=True, indent=2) + '\n', encoding='utf-8', newline='\n')
if mode == 'preseal':
    shutil.copyfile(Path(__file__), P / 'finalize-verification.py')
    command = [sys.executable, 'docs/verification/D19-legacy-sql-memory-20261026/verify-memory.py', '--preseal']
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    process = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace')
    result = {'command': command, 'startedAt': started, 'endedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exit': process.returncode, 'stdout': process.stdout, 'stderr': process.stderr}
    if process.returncode == 0: result['result'] = json.loads(process.stdout)
    summary = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'checkerSha256': sha(P / 'verify-memory.py'), 'preseal': result, 'scope': 'File-only evidence checker, not an application/native suite or physical-target runtime. Final sealed verification is recorded separately, then resealed and checked again.'}
    put(P / 'verification-summary.json', summary)
    print(json.dumps({'stage': 'PRESEAL', 'exit': process.returncode, 'result': result.get('result'), 'stderr': process.stderr}))
    sys.exit(process.returncode)
elif mode == 'final':
    command = [sys.executable, 'docs/verification/D19-legacy-sql-memory-20261026/verify-memory.py']
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    process = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace')
    result = {'command': command, 'startedAt': started, 'endedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exit': process.returncode, 'stdout': process.stdout, 'stderr': process.stderr}
    if process.returncode == 0: result['result'] = json.loads(process.stdout)
    summary = json.loads((P / 'verification-summary.json').read_text(encoding='utf-8'))
    summary['finalVerification'] = result
    put(P / 'verification-summary.json', summary)
    print(json.dumps({'stage': 'FINAL_RECEIPT_CAPTURED_NEEDS_RESEAL', 'exit': process.returncode, 'result': result.get('result'), 'stderr': process.stderr}))
    sys.exit(process.returncode)
else:
    raise SystemExit('Use preseal or final')
