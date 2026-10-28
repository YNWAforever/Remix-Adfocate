from pathlib import Path
import datetime, hashlib, json, shutil, subprocess, sys
R = Path.cwd(); P = R / 'docs/verification/D19-assistant-offline-20261026'
mode = sys.argv[1]
assert mode in ['preseal', 'final']
if mode == 'preseal': shutil.copyfile(Path(__file__), P / 'finalize-verification.py')
command = [sys.executable, 'docs/verification/D19-assistant-offline-20261026/verify-assistant.py'] + (['--preseal'] if mode == 'preseal' else [])
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
process = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace')
result = {'command': command, 'startedAt': started, 'endedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exit': process.returncode, 'stdout': process.stdout, 'stderr': process.stderr}
if process.returncode == 0: result['result'] = json.loads(process.stdout)
if mode == 'preseal':
    summary = {'checkerSha256': hashlib.sha256((P / 'verify-assistant.py').read_bytes()).hexdigest(), 'preseal': result, 'scope': 'File-only evidence checker; not an application/memory test suite or physical-target runtime. Final terminal receipt is captured, resealed, then checked again.'}
else:
    summary = json.loads((P / 'verification-summary.json').read_text(encoding='utf-8'))
    summary['final'] = result
(P / 'verification-summary.json').write_text(json.dumps(summary, ensure_ascii=True, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'stage': mode, 'exit': process.returncode, 'result': result.get('result'), 'stderr': process.stderr}))
sys.exit(process.returncode)
