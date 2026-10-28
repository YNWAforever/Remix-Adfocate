"""Local review-document verification only; no target or client operations."""
from pathlib import Path
from datetime import datetime,timezone,timedelta
import copy,hashlib,json,re,subprocess,sys,uuid
sys.stdout.reconfigure(encoding='utf-8')
R=Path.cwd();D=R/'docs/verification';B=R/'.codex-tmp/D19-B2-review-before';P='D19-B2-';sha=lambda b:hashlib.sha256(b).hexdigest()
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def get(n):return read(D/n)
def put(n,v):(D/n).write_bytes((json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
def git(*args):return subprocess.check_output(['git',*args],encoding='utf-8').strip()
checks=[]
def check(name,result):
 assert result,name
 checks.append(name)
old=read(B/'adfocate-delivery.json');root=get('adfocate-delivery.json');index=read(B/'index.json');oldseal=read(B/'evidence-integrity.json');fp=get('code-fingerprint.json');m=get(P+'manifest.json');delivery=get(P+'review-delivery.json')
shared={'docs/verification/adfocate-delivery.json','docs/verification/adfocate-task-ledger.md'}
check('source fingerprint unchanged354',len(fp['files'])==354 and fp['fingerprint']==old['codeFingerprint']==root['codeFingerprint']==index['sourceFingerprint']==m['reviewCandidateFingerprint']==delivery['sourceFingerprint'])
check('canonical digest and every source byte',sha(json.dumps(fp['files'],separators=(',',':')).encode())==fp['fingerprint']and all(sha((R/f['path']).read_bytes().replace(b'\r\n',b'\n'))==f['sha256']for f in fp['files']))
changed=set()
for f in index['files']:
 check('old path retained '+f['path'],(R/f['path']).is_file())
 if sha((R/f['path']).read_bytes())!=f['sha256']:changed.add(f['path'])
check('only shared documentation/seal can change',changed<=shared|{'docs/verification/evidence-integrity.json'})
changedEvidence={f['path']for f in oldseal['files']if sha((R/f['path']).read_bytes())!=f['sha256']}
check('1256 historical evidence files unchanged',len(oldseal['files'])==1258 and changedEvidence==shared)
check('107 case results and coverage unchanged',len(root['caseResults'])==107 and root['caseResults']==old['caseResults']and root['caseCoverageSummary']==old['caseCoverageSummary'])
check('20 tasks and one review followup appended',len(root['taskResults'])==20 and next(t for t in root['taskResults']if t['task']=='D19')['followupResults'][:-1]==next(t for t in old['taskResults']if t['task']=='D19')['followupResults'])
n=copy.deepcopy(root);n.pop('D19B2ManifestReview');n['nextTask']=n.pop('historicalNextTaskBeforeD19B2Review');n['evidenceIntegrity']=n.pop('historicalEvidenceIntegrityBeforeD19B2Review');n['finalDeliveryReview'].pop('B2ManifestReview');next(t for t in n['taskResults']if t['task']=='D19')['followupResults'].pop()
check('all other delivery fields and19 tasks untouched',n==old)
check('four layers agree',delivery['newResult']==root['D19B2ManifestReview']['newResult']==next(t for t in root['taskResults']if t['task']=='D19')['followupResults'][-1]['newResult']and set(delivery['newResult'])=={'code','test','deployment','runtime'})
for name in ['adfocate-delivery.json','adfocate-task-ledger.md','evidence-integrity.json']:
 check('exact before copy '+name,(D/(P+'review-prior-'+name)).read_bytes()==(B/name).read_bytes())
check('ledger append only',(D/'adfocate-task-ledger.md').read_bytes().startswith((B/'adfocate-task-ledger.md').read_bytes()))
findings=get(P+'review-findings.json')['findings'];check('seven open blocking findings',len(findings)==7 and len({f['id']for f in findings})==7 and all(f['priority']=='P1'and f['blocksRuntimeExecution']and f['status']=='OPEN_NOT_IMPLEMENTED_THIS_REVIEW'for f in findings))
for f in findings:
 for e in f['evidence']:
  text=(R/e['path']).read_text(encoding='utf-8-sig');check('source reference '+f['id']+' '+e['path'],sha((R/e['path']).read_bytes())==e['sha256']and 0<e['line']<=len(text.splitlines()))
check('not an execution authorization',m['reviewOnly']and not m['ownerApproved']and not m['canExecute']and not m['runtimeManifestComplete']and not m['approval']['localPreparationApproved']and not m['approval']['runtimeApproved']and m['runtimeCommand']is None and m['approval']['runtimeApprovalText']is None)
target=m['target'];caps=target['resourceCaps'];check('one proposed project/volume/network/five containers',caps=={'projects':1,'persistentDataVolumes':1,'networks':1,'containers':5}and len(target['serviceImageIds'])==5)
check('planned resources never presented as actual',target['status']=='PROPOSED_NOT_CREATED_NOT_IDENTITY_VERIFIED'and target['actualContainerIds']is None and target['actualNetworkId']is None and target['actualVolumeCreatedAt']is None and target['ports']['availability'].startswith('NOT_VERIFIED'))
check('client Hong Kong date and new project',m['clientDate']=='2026-10-25'and target['projectId'].startswith('adfocate-d19-b2-20261025-')and m['preparedAtHongKong'].endswith('+08:00')and target['projectId']not in ['adfocate-r1-empty-20261023','adfocate-r1-shaped-20261023','adfocate-d19-pristine-20261024-5e2fa581'])
check('exact image pins are source metadata only',target['serviceImageIds']==get('D19-pristine-rpc-prestart-identity.json')['images']and target['ports']['api']==56821 and target['ports']['web']==56800 and target['ports']['database']==56822 and target['ports']['proxy']=='none')
phases=m['fixture']['phases'];agg=m['fixture']['aggregateAddCaps'];check('phase order and parent arithmetic',[p['phase']for p in phases]==['role','core','browser']and[sum(p[k]for p in phases)for k in ['authSubjectsCap','workspaceCap','missionCap','workflowCap','platformRoleRowCap','workspaceRoleRowCap']]==[84,6,6,4,3,19])
check('historical count vectors independently correct',[p['authSubjectsCap']for p in phases]==[11,62,11]and[p['missionCap']for p in phases]==[1,3,2]and[p['workspaceRoleRowCap']for p in phases]==[7,6,6])
ids=[target['plannedOwnerRunId']]
for p in phases:
 check('intent only '+p['phase'],p['intentOnlyNotCreated']and p['actualCreatedIds']is None and len(p['plannedMissions'])==p['missionCap'])
 ids +=[p['plannedNamespace'],p['plannedPrimaryWorkspaceId'],p['plannedDenialWorkspaceId'],p['plannedBudgetId'],p['plannedGiftId']]+[x['id']for x in p['plannedMissions']]
check('unique well-formed planned IDs',len(ids)==len(set(ids))and all(str(uuid.UUID(x))==x for x in ids))
check('derived actor rows and explicit extra negative fixture',agg['creators']==3*2+51==57 and agg['staffUsers']==3*9==27 and agg['brandUserRows']==3*7==21 and agg['newNegativeLegacySubmission']==1 and agg['submissionRowsMaximumIncludingNegative']==7)
check('separate funded/global data caps',agg['fundedBudgetRows']==agg['giftRows']==3 and agg['platformDraftResources']==1 and agg['handoffRowsLifetime']==agg['pendingRowsAtEnd']+agg['cancelledRowsAtEnd']==4)
check('unresolved scopes fail closed','UNRESOLVED'in m['fixture']['childRowCaps']and'UNRESOLVED'in m['schemaProfile']['bootstrapSeedRowInventory']and'UNRESOLVED'in m['fixture']['legacyExistingIssuanceRequiresExplicitRuntimeApproval']['approvalXpDelta']and m['executionCandidateFingerprint'].startswith('UNKNOWN'))
check('pending neutrality not conflated with legacy issuance',m['fixture']['pendingRewardFinancialWritesAllowed']is False and m['fixture']['legacyExistingIssuanceRequiresExplicitRuntimeApproval']['maxValidApprovals']==2 and m['fixture']['legacyExistingIssuanceRequiresExplicitRuntimeApproval']['budgetDebitEach']==125 and m['fixture']['legacyExistingIssuanceRequiresExplicitRuntimeApproval']['historicalCumulativeSubmissionXpAwarded']==135)
check('transient DDL explicit and no data cleanup',m['fixture']['transientDdlRequiresExplicitRuntimeApproval']['functionMax']==1 and m['fixture']['transientDdlRequiresExplicitRuntimeApproval']['triggerMax']==1 and not m['fixture']['dataCleanupApproved'])
schema=m['schemaProfile'];check('72 full migration byte hashes and42 protected profile',len(schema['fullMigrations'])==72 and schema['protectedEntries']==42 and schema['protectedManifestDigest']==root['schemaManifestDigest']and all(sha((R/f['path']).read_bytes())==f['sha256']for f in schema['fullMigrations']))
check('compatibility9 statements provenance',schema['candidateCompatibilityStatementsNewTargetOnly']==get('D19-pristine-rpc-catalog-diff-resolution.json')['configurationSql']and len(schema['candidateCompatibilityStatementsNewTargetOnly'])==9)
matrix=get(P+'acceptance-matrix.json');check('17 API base and7 browser obligations all not run',len(matrix['matrix'])==24 and matrix['roleBaseCases']==8 and matrix['coreBaseCases']==9 and matrix['browserBaseCases']==5 and matrix['extraBrowserCoverageObligations']==2 and all(r['executionStatus']=='NOT_RUN_B2'for r in matrix['matrix']))
check('no services fixtures tests deployment or approvals promoted',not delivery['B2Approved']and not delivery['P0Approved']and delivery['actualResourcesCreated']==delivery['actualFixtureRowsCreated']==delivery['newProductTestRuns']==delivery['newRoleBrowserE2ERuns']==0 and not delivery['restored']and delivery['incidentOpen']and delivery['releaseHold']and not delivery['providerEnabled']and not delivery['wholeR1Verified']and not delivery['productionAccessed']and delivery['commit']is None and not any(delivery[k]for k in ['push','merge','deploy']))
check('B1 and all existing blockers retained',root['D19B1Followup']==old['D19B1Followup']and root['D15']==old['D15']and root['D17R2Followup']==old['D17R2Followup']and root['D18']==old['D18']and root['D20']==old['D20']and root['remainingRisks']==old['remainingRisks'])
check('HEAD branch remote and empty index unchanged',git('rev-parse','HEAD')==old['headSha']and git('branch','--show-current')==old['branch']and git('remote','get-url','origin')=='https://github.com/YNWAforever/Remix-Adfocate.git'and not git('diff','--cached','--name-only'))
diff=subprocess.run(['git','diff','--check'],capture_output=True,text=True);check('Git whitespace check',diff.returncode==0)
(D/'logs'/(P+'review-diff-check.log')).write_bytes((diff.stdout+diff.stderr+'check-only exit=0\n').encode())
put(P+'review-changed-files.json',{});put(P+'review-integrity.json',{})
paths=set(p for p in subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard']).decode('utf-8').split('\0')if p and(R/p).is_file());added=sorted(paths-{f['path']for f in index['files']})
check('new files only review evidence',all(p.startswith('docs/verification/'+P)or p.startswith('docs/verification/logs/'+P)for p in added))
pattern=re.compile(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{16,}')
for p in added:
 if '-prior-'in p:continue
 text=(R/p).read_text(encoding='utf-8-sig');check('new evidence credential/email patterns '+p,not pattern.search(text)and not re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',text))
 if p.endswith('.json'):read(R/p)
for link in re.findall(r'\[[^\]]+\]\(([^)]+)\)',(D/(P+'manifest-review.md')).read_text(encoding='utf-8')):check('review link '+link,(D/link.split('#')[0]).is_file())
put(P+'review-changed-files.json',{'sourceFingerprint':fp['fingerprint'],'applicationTestConfigMigrationChanges':0,'modifiedExisting':sorted(shared|{'docs/verification/evidence-integrity.json'}),'newFiles':added,'previousDirtyWorkPreserved':True,'commit':None,'deploy':False})
files=[p for p in sorted(D.rglob('*'))if p.is_file()and p.name!='evidence-integrity.json']
summary={'atHongKong':datetime.now(timezone(timedelta(hours=8))).isoformat(),'status':'PASS_REVIEW_DOCUMENT_INTEGRITY_RUNTIME_NOT_APPROVED','checksPassed':len(checks),'sourceFingerprint':fp['fingerprint'],'sourceRecords':354,'applicationTestConfigMigrationChanges':0,'priorEvidenceFiles':1258,'priorEvidenceUnchanged':1256,'originalIncidentAB1PristineEvidenceByteIdentical':True,'originalCaseResultsPreserved':107,'taskResultsPreservedExceptAppendedD19Review':True,'blockingFindings':7,'actualResourcesCreated':0,'actualFixtureRowsCreated':0,'newProductTestRuns':0,'newRoleBrowserE2E':0,'P0Approved':False,'B2Approved':False,'incidentOpen':True,'restored':False,'releaseHold':True,'providerEnabled':False,'wholeR1Verified':False,'commit':None,'push':False,'merge':False,'deploy':False,'sealedEvidenceCount':len(files),'checks':checks}
put(P+'review-integrity.json',summary)
records=[{'path':p.relative_to(R).as_posix(),'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}for p in files];put('evidence-integrity.json',{'codeFingerprint':fp['fingerprint'],'excludes':['self-referential evidence-integrity.json'],'files':records})
assert all(sha((R/f['path']).read_bytes())==f['sha256']and(R/f['path']).stat().st_size==f['bytes']for f in get('evidence-integrity.json')['files'])
print(json.dumps({k:summary[k]for k in ['status','checksPassed','sourceFingerprint','sourceRecords','priorEvidenceUnchanged','blockingFindings','sealedEvidenceCount','actualResourcesCreated','newRoleBrowserE2E','P0Approved','B2Approved','incidentOpen','releaseHold']},ensure_ascii=False))
