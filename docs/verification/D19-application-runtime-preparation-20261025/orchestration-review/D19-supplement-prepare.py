from pathlib import Path
import hashlib,json
V=Path('docs/verification/D19-application-runtime-preparation-20261025')
s=Path('.codex-tmp/D19-application-local-gates.py').read_text(encoding='utf-8').replace('D19-application-decisions-20261025','D19-application-runtime-preparation-20261025')
s=s.replace('commands={',"commands={\n 'supplement':['node_modules/vitest/vitest.mjs','run','server/test/application-supplement.test.ts','--no-file-parallelism','--reporter=json','--outputFile='+str(V/f'{label}.json')],")
s=s.replace("['operator','release','bindings','permission','creator','api','focused','full']","['supplement','operator','release','bindings','permission','creator','api','focused','full']")
s=s.replace('commands={', "commands={\n 'review':['scripts/audit/execute-application-supplement.mjs','docs/verification/D19-C2-application-runtime-manifest.json','--offline-check'],\n 'denied':['scripts/audit/execute-application-supplement.mjs','docs/verification/D19-C2-application-runtime-manifest.json','--execute'],")
Path('.codex-tmp/D19-supplement-gates.py').write_text(s,encoding='utf-8')
base=json.loads(Path('docs/verification/D19-application-decisions-20261025/candidate-source.json').read_text(encoding='utf-8'))
new=['server/test/application-supplement.test.ts','scripts/audit/application-supplement.mjs','scripts/audit/execute-application-supplement.mjs']
paths=sorted(set(x['path'] for x in base['files'])|{x for x in new if Path(x).is_file()})
files=[{'path':x,'sha256':hashlib.sha256(Path(x).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()} for x in paths]
fp=hashlib.sha256(json.dumps(files,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
old=V/'candidate-source.json'
if old.is_file():
 previous=json.loads(old.read_text(encoding='utf-8')); q=V/'source-revisions'/f"{previous['fingerprint']}.json";q.parent.mkdir(exist_ok=True);q.write_bytes(old.read_bytes())
old.write_text(json.dumps({'fingerprint':fp,'files':files},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'source':fp,'records':len(files)}))
