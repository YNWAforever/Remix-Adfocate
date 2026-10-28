from pathlib import Path
from datetime import datetime,timezone
import copy,hashlib,json,re,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8')
R=Path.cwd();D=R/'docs/verification';S=R/'.codex-tmp';B=S/'D19-B1-before';P='D19-B1-';sha=lambda b:hashlib.sha256(b).hexdigest()
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def get(n):return read(D/n)
def a(n):return get(P+n+'.json')
def put(n,v):(D/n).write_bytes((json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
def git(*args):return subprocess.check_output(['git',*args],encoding='utf-8').strip()
checks=[]
def check(name,result):
 assert result,name
 checks.append(name)
old=read(B/'docs/verification/adfocate-delivery.json');oldseal=read(B/'docs/verification/evidence-integrity.json');before=read(B/'index.json');root=get('adfocate-delivery.json');fp=get('code-fingerprint.json');delivery=a('delivery')
source={'scripts/run-integration-tests.mjs','scripts/audit/local-targets.mjs','server/test/acceptance-target-retirement.test.ts'}
existingSource=source-{'server/test/acceptance-target-retirement.test.ts'}
shared={'docs/verification/'+n for n in ['adfocate-delivery.json','code-fingerprint.json','adfocate-task-ledger.md','implementation-path-mapping.md','release-review-request.json']}
check('354 canonical source records and fingerprint',len(fp['files'])==354 and sha(json.dumps(fp['files'],separators=(',',':')).encode())==fp['fingerprint']==root['codeFingerprint']==delivery['sourceFingerprint'])
check('all current source hashes',all(sha((R/f['path']).read_bytes().replace(b'\r\n',b'\n'))==f['sha256']for f in fp['files']))
oldfp=read(B/'docs/verification/code-fingerprint.json');oldfiles={f['path']:f['sha256']for f in oldfp['files']}
changedSource={f['path']for f in fp['files']if oldfiles.get(f['path'])!=f['sha256']}
check('only two existing tooling files and one regression change',changedSource==source)
priorChanged={f['path']for f in oldseal['files']if not(R/f['path']).is_file()or sha((R/f['path']).read_bytes())!=f['sha256']}
check('1204 original evidence files byte identical',len(oldseal['files'])==1209 and priorChanged==shared)
modified=[]
for f in before['files']:
 check('pre-existing path retained '+f['path'],(R/f['path']).is_file())
 if sha((R/f['path']).read_bytes())!=f['sha256']:modified.append(f['path'])
check('no unrelated dirty work overwritten',set(modified)<=existingSource|shared|{'docs/verification/evidence-integrity.json'})
check('all 107 case rows preserved',len(root['caseResults'])==107 and root['caseResults']==old['caseResults'])
check('20 tasks and exactly one D19 followup appended',len(root['taskResults'])==20 and next(t for t in root['taskResults']if t['task']=='D19')['followupResults'][:-1]==next(t for t in old['taskResults']if t['task']=='D19')['followupResults'])
normalized=copy.deepcopy(root);historical=normalized.pop('historicalBeforeD19B1');normalized.pop('D19B1Followup')
for k,v in historical.items():
 check('historical root field retained '+k,v==old[k]);normalized[k]=v
normalized['schema'].pop('currentD19B1')
next(t for t in normalized['taskResults']if t['task']=='D19')['followupResults'].pop()
check('all other root fields and 19 task results unchanged',normalized==old)
check('four result layers agree',root['D19B1Followup']['newResult']==delivery['newResult']==next(t for t in root['taskResults']if t['task']=='D19')['followupResults'][-1]['newResult']and set(delivery['newResult'])=={'code','test','deployment','runtime'})
review=get('release-review-request.json');oldreview=read(B/'docs/verification/release-review-request.json');normalized=copy.deepcopy(review)
check('release current binding updated only',normalized.pop('historicalFingerprintBeforeD19B1')==oldreview['currentWorktreeFingerprint']and normalized['currentWorktreeFingerprint']==fp['fingerprint'])
normalized['currentWorktreeFingerprint']=oldreview['currentWorktreeFingerprint'];normalized['laterLocalEvidence'].pop('D19B1')
check('release authorization expiry and protected evidence untouched',normalized==oldreview and review['protectedEvidenceExpiry']==oldreview['protectedEvidenceExpiry']and not review['canDeploy']and not review['canEnablePilot'])
check('provider membership single-workspace blockers preserved',root['D15']==old['D15']and root['D18']==old['D18']and root['D20']==old['D20']and root['remainingRisks']==old['remainingRisks']and not root['D20']['providerEnabled'])
for n in ['adfocate-task-ledger.md','implementation-path-mapping.md']:
 check('append-only '+n,(D/n).read_bytes().startswith((B/'docs/verification'/n).read_bytes()))
for n in ['implementation_backlog.csv','audit_case_coverage.csv']:
 check('CSV byte-identical '+n,(D/n).read_bytes()==(B/'docs/verification'/n).read_bytes())
for n in ['adfocate-delivery.json','code-fingerprint.json','evidence-integrity.json','adfocate-task-ledger.md','implementation-path-mapping.md','release-review-request.json']:
 check('rollback before copy '+n,(D/(P+'prior-'+n)).read_bytes()==(B/'docs/verification'/n).read_bytes())
for p in existingSource:check('source before copy '+p,(D/(P+'prior-'+Path(p).name+'.txt')).read_bytes()==(B/p).read_bytes())
check('schema and migration source unchanged',a('schema-diff')['sourceManifestUnchanged']and a('schema-diff')['schemaRpcGrantsRlsHistoryChanges']==0 and sha((R/'supabase/release-manifest.json').read_bytes())==a('schema-diff')['rawSha256'])
full=a('full-results');check('full offline results and preserved16+194',(full['passed'],full['failed'],full['skipped'],full['testFiles'],full['originalAudit16'],full['protected194'])==(1993,0,363,278,16,194))
for g in ['type','lint','manifest','environment','full','build']:
 receipt=a(g+'-receipt');check('current gate '+g,receipt['exit']==0 and receipt['error']is None and receipt['sourceFingerprint']==fp['fingerprint']and receipt['sourceUnchangedAfter']and not receipt['integrationEnabled'])
 check('public and private log bindings '+g,sha((D/receipt['publicLog']).read_bytes())==receipt['publicLogSha256']and sha((S/(P+g+'.log')).read_bytes())==receipt['logSha256'])
history=a('test-history');check('effective red before code and same test binding',history['redProductionFilesStillEqualBefore']and history['redBinding']['testSha256']==sha((R/'server/test/acceptance-target-retirement.test.ts').read_bytes())and[(h['phase'],h['passed'],h['failed'])for h in history['history']][-2:]==[('VALID_RED_MISSING_EXCLUSION',1,10),('GREEN_NEW_AND_EXISTING_IDENTITY_TESTS',29,0)])
check('watchdog and sandbox failures retained not relabelled green',a('full-watchdog-receipt')['error']=='ETIMEDOUT'and a('full-sandbox-failures-receipt')['exit']==1 and a('sandbox-failures')['failed']==11 and a('environment-recheck')['passed']==25 and a('environment-recheck')['failed']==0 and not a('environment-recheck')['sourceChanged'])
probes=a('cli-probes');check('five actual Node refusal probes with zero subprocess/fetch attempts',len(probes['results'])==5 and all(x['passed']and x['exit']==1 and x['attempts']==[]and x['subprocessesOrFetchExecuted']==0 for x in probes['results'])and probes['actualDockerApiSqlCalls']==0 and not probes['clientOrFixtureSetupReached'])
retirement=a('retirement');identity=get('D19-incident-A-identity.json')
check('exact retired identifiers bound to original evidence',retirement['projectId']==identity['expectedIdentity']['projectId']and retirement['apiContainerId']==identity['api']['id']and retirement['databaseContainerId']==identity['database']['id']and retirement['networkId']==identity['network']['id']and retirement['dataVolume']==identity['dataVolume']['name'])
check('B1 only approved verified, B2 and C unapproved',delivery['B1Approved']and delivery['B1LocallyVerified']and not delivery['B2Approved']and not delivery['CApproved'])
check('incident OPEN unrestored HOLD no release',delivery['incidentOpen']and not delivery['restored']and not delivery['incidentClosed']and delivery['releaseHold']and not delivery['wholeCurrentR1Verified']and not delivery['realProviderEnabled']and not delivery['canDeploy']and not delivery['canEnablePilot'])
check('no new service target fixture E2E or pristine rerun',not delivery['newTargetFixtureOrRoleBrowserE2E']and not delivery['pristineAcceptanceRerun']and delivery['businessDataActions']==0)
check('no Git publication deployment',delivery['commit']is None and not any(delivery[k]for k in ['push','merge','deploy'])and git('rev-parse','HEAD')==before['head']and git('branch','--show-current')==before['branch']and git('remote','get-url','origin')=='https://github.com/YNWAforever/Remix-Adfocate.git'and not git('diff','--cached','--name-only'))
coverage=a('case-coverage');check('case coverage digest retains each original/current row',len(coverage['cases'])==107 and all(c['caseId']==r['caseId']and c['originalAuditResult']==r['originalAuditResult']and c['savedCaseRowSha256']==sha(json.dumps(r,ensure_ascii=False,separators=(',',':')).encode())and not c['runtimeRenewedByB1']for c,r in zip(coverage['cases'],root['caseResults'])))
check('remaining acceptance includes dependencies and done conditions',all(x['doneWhen']and x['stillNotRun']and x['dependencies']is not None for x in a('r1-checklist')['items']))
rollback=a('rollback');check('rollback reverse check only',rollback['mechanicallyPass']and rollback['reverseCheckOnly']and not rollback['applied']and not rollback['businessDataRollback']and subprocess.run(['git','apply','--check','--reverse','--ignore-space-change',str(D/(P+'changes.patch'))],capture_output=True).returncode==0)
diff=subprocess.run(['git','diff','--check'],capture_output=True,text=True);check('Git diff check',diff.returncode==0)
(D/'logs'/(P+'diff-check.log')).write_bytes((diff.stdout+diff.stderr+'check-only exit=0\n').encode())
put(P+'integrity.json',{});put(P+'changed-files.json',{})
paths=set(p for p in subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard']).decode('utf-8').split('\0')if p and(R/p).is_file());added=sorted(paths-{f['path']for f in before['files']})
check('new paths limited to one regression and B1 evidence',all(p=='server/test/acceptance-target-retirement.test.ts'or p.startswith('docs/verification/'+P)or p.startswith('docs/verification/logs/'+P)for p in added))
pattern=re.compile(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{16,}')
scanned=0
for p in added:
 if '-prior-'in p:continue
 text=(R/p).read_text(encoding='utf-8-sig');scanned+=1
 check('new evidence credential pattern scan '+p,not pattern.search(text))
 if p.endswith('.json'):read(R/p)
 if p.startswith('docs/verification/')and not p.endswith('.patch'):check('new evidence personal email scan '+p,not re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',text))
for link in re.findall(r'\[[^\]]+\]\(([^)]+)\)',(D/(P+'delivery.md')).read_text(encoding='utf-8')):
 check('delivery link '+link,(D/link.split('#')[0]).is_file())
put(P+'changed-files.json',{'sourceFingerprint':fp['fingerprint'],'sourceFiles':sorted(source),'modifiedSourceFiles':sorted(existingSource),'newSourceFiles':['server/test/acceptance-target-retirement.test.ts'],'modifiedExisting':sorted(existingSource|shared|{'docs/verification/evidence-integrity.json'}),'newFiles':added,'applicationApiUiSqlChanged':False,'previousDirtyWorkPreserved':True,'ignoredHelpers':'.codex-tmp/D19-B1-*.mjs and assemble_D19_B1.py/check_D19_B1.py; local evidence work only'})
files=[p for p in sorted(D.rglob('*'))if p.is_file()and p.name!='evidence-integrity.json']
summary={'at':datetime.now(timezone.utc).isoformat(),'status':'PASS_LOCAL_B1_EXCLUSION_INCIDENT_OPEN_R1_HOLD','checksPassed':len(checks),'sourceFingerprint':fp['fingerprint'],'sourceRecords':354,'sourceFilesChanged':3,'applicationApiUiSqlChanged':False,'priorEvidenceFiles':1209,'priorEvidenceUnchanged':1204,'originalIncidentAAndPristineArtifactsByteIdentical':True,'originalAuditCasesPreserved':107,'unselected19TasksPreserved':True,'fullPassed':1993,'fullFailed':0,'fullGatedSkipped':363,'fullFiles':278,'originalAudit16':16,'originalContracts194':194,'targetedPassed':29,'negativeCliProbesPassed':5,'serviceTargetDockerSqlAuthApiActions':0,'B1OnlyApproved':True,'B2Approved':False,'restored':False,'incidentOpen':True,'releaseHold':True,'wholeCurrentR1Verified':False,'D15AdvisorOwnerDeviceHostedStaffBlockersRetained':True,'realProviderEnabled':False,'evidenceExpiryUnchanged':True,'commit':None,'push':False,'merge':False,'deploy':False,'sealedEvidenceCount':len(files),'newTextFilesScanned':scanned,'unclassifiedCredentialOrEmailPatterns':0,'rollbackApplied':False,'checks':checks}
put(P+'integrity.json',summary)
records=[{'path':p.relative_to(R).as_posix(),'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}for p in files];put('evidence-integrity.json',{'codeFingerprint':fp['fingerprint'],'excludes':['self-referential evidence-integrity.json'],'files':records})
check('independent complete seal readback',all(sha((R/r['path']).read_bytes())==r['sha256']and(R/r['path']).stat().st_size==r['bytes']for r in get('evidence-integrity.json')['files']))
print(json.dumps({k:summary[k]for k in ['status','checksPassed','sourceFingerprint','sourceRecords','priorEvidenceUnchanged','fullPassed','fullFailed','fullGatedSkipped','targetedPassed','negativeCliProbesPassed','sealedEvidenceCount','incidentOpen','releaseHold','B2Approved','realProviderEnabled']},ensure_ascii=False))
