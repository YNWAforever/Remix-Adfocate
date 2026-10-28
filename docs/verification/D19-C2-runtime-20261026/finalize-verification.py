"""Capture terminal receipts for the file-only delivery checker; no target calls."""
from pathlib import Path
import datetime, hashlib, json, subprocess, sys
R=Path(__file__).resolve().parents[3];P=Path(__file__).resolve().parent
mode=sys.argv[1];assert mode in ['preseal','final']
summary_path=P/'verification-summary.json'
if mode=='preseal':
    assert not summary_path.exists(), 'Retain earlier verification receipts'
    summary={'checkerSha256':hashlib.sha256((P/'verify-delivery.py').read_bytes()).hexdigest(),'scope':'File-only current delivery/source/before-image/case/approval/rollback/evidence-integrity checks; not new app tests, SQL or runtime acceptance.'}
else:
    summary=json.loads(summary_path.read_text(encoding='utf-8'));assert 'final'not in summary
command=[sys.executable,str(P/'verify-delivery.py')]+(['--preseal']if mode=='preseal'else [])
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
child=subprocess.run(command,cwd=R,capture_output=True,text=True,encoding='utf-8',errors='replace')
result={'command':command,'startedAt':started,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':child.returncode,'stdout':child.stdout,'stderr':child.stderr}
if child.returncode==0:result['result']=json.loads(child.stdout)
summary[mode]=result
summary_path.write_text(json.dumps(summary,ensure_ascii=True,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'stage':mode,'exit':child.returncode,'result':result.get('result'),'stderr':child.stderr}))
sys.exit(child.returncode)
