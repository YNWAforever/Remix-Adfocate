"""Local record integrity only. Does not connect to Docker, SQL, Auth or APIs."""
from pathlib import Path
from datetime import datetime,timezone
import copy,hashlib,json,re,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8')
R=Path.cwd();D=R/'docs/verification';B=R/'.codex-tmp/D19-incident-A-20261024-before';P='D19-incident-A-'
sha=lambda b:hashlib.sha256(b).hexdigest()
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def get(n):return read(D/n)
def a(n):return get(P+n+'.json')
def put(n,v):(D/n).write_bytes((json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
def git(*args):return subprocess.check_output(['git',*args],encoding='utf-8').strip()
checks=[]
def check(label,condition):
 assert condition,label
 checks.append(label)

before=read(B/'index.json');old=read(B/'adfocate-delivery.json');oldseal=read(B/'evidence-integrity.json')
root=get('adfocate-delivery.json');delivery=a('delivery');fp=get('code-fingerprint.json')
fingerprint='9812cc7755dd6443f8fa4b39bc92e6c26536b54e15ba1c0cbc494815375dd5e1'
check('source fingerprint and 353 records',len(fp['files'])==353 and fp['fingerprint']==fingerprint==root['codeFingerprint']==before['sourceFingerprint']==delivery['sourceFingerprint'])
check('canonical source bytes and digest',all(sha((R/r['path']).read_bytes().replace(b'\r\n',b'\n'))==r['sha256']for r in fp['files'])and sha(json.dumps(fp['files'],separators=(',',':')).encode())==fingerprint)
check('all 883 non-verification files unchanged',len(before['nonVerificationFiles'])==883 and all((R/r['path']).is_file()and sha((R/r['path']).read_bytes())==r['sha256']for r in before['nonVerificationFiles']))
shared={'docs/verification/adfocate-delivery.json','docs/verification/adfocate-task-ledger.md'}
changedPrior=[r['path']for r in oldseal['files']if not(R/r['path']).is_file()or sha((R/r['path']).read_bytes())!=r['sha256']]
check('1159 original evidence files byte-identical, only two shared edits',len(oldseal['files'])==1161 and set(changedPrior)==shared)
for n in ['adfocate-delivery.json','adfocate-task-ledger.md','evidence-integrity.json']:
 check('exact rollback copy '+n,(D/(P+'prior-'+n)).read_bytes()==(B/n).read_bytes())
check('ledger append only',(D/'adfocate-task-ledger.md').read_bytes().startswith((B/'adfocate-task-ledger.md').read_bytes()))
check('all 107 case results and original audit semantics unchanged',len(root['caseResults'])==107 and root['caseResults']==old['caseResults'])
check('all 20 tasks present',len(root['taskResults'])==20)
check('task D19 appended exactly one follow-up',next(r for r in root['taskResults']if r['task']=='D19')['followupResults'][:-1]==next(r for r in old['taskResults']if r['task']=='D19')['followupResults'])
restored=copy.deepcopy(root)
for key in ['D19IncidentAReadonlyFollowup','historicalNextTaskBeforeIncidentA']:restored.pop(key)
restored['nextTask']=old['nextTask']
restored['finalDeliveryReview'].pop('incidentReadonlyFollowup')
restored['D19IncidentDecisionPackage'].pop('latestReadonlyFollowup')
next(r for r in restored['taskResults']if r['task']=='D19')['followupResults'].pop()
check('all other root fields and 19 tasks unchanged',restored==old and root['historicalNextTaskBeforeIncidentA']==old['nextTask'])
check('code test deployment runtime match',root['D19IncidentAReadonlyFollowup']['newResult']==delivery['newResult']==next(r for r in root['taskResults']if r['task']=='D19')['followupResults'][-1]['newResult']and set(delivery['newResult'])=={'code','test','deployment','runtime'})
check('OPEN HOLD disabled provider preserved',delivery['originalIncidentStatus']=='OPEN'and not delivery['restored']and delivery['releaseHold']and not delivery['providerEnabled']and not delivery['wholeCurrentR1Verified']and not delivery['canDeploy']and not delivery['canEnablePilot']and root['commit']is None and root['deploymentStatus']=='not-deployed'and not root['D20']['providerEnabled'])
check('D15 and owner device hosted staff blockers preserved',delivery['D15ContentBlocked']and delivery['advisorOwnerDeviceHostedAndFormalStaffBlocked'])
check('no Git mutations or deployment',delivery['commit']is None and not any(delivery[k]for k in ['push','merge','deploy']))

identity=a('identity');post=a('identity-after');project='adfocate-r1-shaped-20261023'
check('identity passed before SQL and same target after',identity['status']=='PASS_IDENTITY_GATE_BEFORE_SQL'and identity['exactMetadataMatched']and not identity['clientsCreated']and not identity['sqlExecuted']and post['status']=='PASS_SAME_AUTHORIZED_TARGET_AFTER_READS')
check('project volume network members',identity['expectedIdentity']['projectId']==project and identity['dataVolume']['name']==post['sameDataVolume']=='supabase_db_'+project and identity['network']['id']==post['sameNetworkId']and len(identity['networkMembers'])==5 and all(r['project']==project for r in identity['networkMembers']))
check('same API DB IDs images and ports',all(all(c[k]==identity[key][k]for k in ['id','image','ports','project'])for key,c in zip(['api','database'],post['containers'])))
journal=a('read-journal');sessions=journal['sessions'];good=[s for s in sessions if s['exit']==0];bad=[s for s in sessions if s['exit']!=0]
check('13 successful and two aborted SQL sessions',len(sessions)==15 and len(good)==journal['successfulReadOnlySessions']==13 and len(bad)==journal['failedReadOnlySessions']==2)
check('each SQL receipt read-only bound to identity',all(s['readOnlyTransactionRequired']and s['projectId']==project and s['databaseContainerId']==identity['database']['id']and not s['sdkOrBusinessRpc']for s in sessions))
check('identity before first SQL',identity['verifiedAt']<min(s['startedAt']for s in sessions))
for s in good:
 receipt=get(s['publicResult'])
 check('read-only receipt and query digest '+s['label'],s['transactionReadOnly']==receipt['transactionReadOnly']=='on'and receipt['identityReverifiedBeforeQuery']and sha(receipt['query'].encode())==s['querySha256'])
check('no SDK API RPC test lifecycle or business mutations',all(journal[k]==0 for k in ['sdkClients','businessApiCalls','businessRpcCalls','testsRerun','serviceLifecycleActions','businessDataWritesDeletesCreates']))
denied=a('server-file-denial')
check('server file permission denial preserved without bypass',denied['backupsOrWalContentsConclusion']=='UNKNOWN'and denied['readOnlyTransactionAborted']and not any(denied[k]for k in ['businessWrites','sameCapabilityRetried','roleOrGrantsChanged','osFilesystemBypassUsed']))
check('one pre-SQL guard refusal',not a('query-guard-refusal')['newSqlExecutedByRefusedAttempt']and delivery['outcome']['preSqlGuardRefusal']==1)
catalog=a('q1-catalog')['payload'];recovery=a('q1-recovery-catalog')['payload']
check('current-only recovery metadata',catalog['settings']['archive_mode']=='off'and catalog['settings']['log_statement']=='ddl'and not catalog['archiveCommandConfigured']and not catalog['restoreCommandConfigured']and not recovery['queryRoleIsSuperuser']and recovery['replicationSlots']==[]and recovery['dataDirectory']=='/var/lib/postgresql/data')
check('Q1 partial Q2 no preimage Q3 scoped states',delivery['Q1Q2Q3']['Q1']['status'].startswith('PARTIAL_')and delivery['Q1Q2Q3']['Q2']['status'].startswith('NO_CREDIBLE_READABLE_')and delivery['Q1Q2Q3']['Q3']['status'].startswith('VERIFIED_SCOPED_')and not delivery['outcome']['exactRestoreSupportedNow']and not delivery['outcome']['noBackupAnywhereClaimed'])
for channel in ['operator','workflow','staff']:
 x=a('q2-audit-'+channel)['payload']
 check('zero scoped audit references '+channel,x['matchedReferenceCount']==0 and x['references']==[])
db=a('q2-database-log-scan');api=a('q2-api-log-scan');structure=a('q2-api-log-structure')
check('bounded retained log scan, no raw bodies retained',db['lineCount']==420 and api['lineCount']==5592 and not db['limitTruncated']and not api['limitTruncated']and not db['rawLogBodiesRetainedOrDisplayed']and not api['rawLogBodiesRetainedOrDisplayed']and len(db['exactIdMatches'])==0 and len(api['exactIdMatches'])==3)
check('three access records with no full row image',structure['sameRawStreamSha256']==api['streamSha256']and len(structure['records'])==3 and all(r['isHttpAccessRecord']and not r['containsCompleteKeyedCampaignRow']and not r['bodyOrAuthDataExported']for r in structure['records'])and not structure['completeKeyedBeforeRowObserved'])
rows=a('q3-current-rows')['payload'];final=a('q3-final-rows')['payload'];cases=a('case-findings')['cases'];ids={c['campaignId']for c in cases}
check('three exact current rows stable at final read',len(rows)==3 and rows==final and {r['id']for r in rows}==ids and all(r['status']=='closed'and r['closedAt']==r['updatedAt']=='2026-10-24T07:12:04.875188+00:00'for r in rows))
check('per-ID before values UNKNOWN and restoration unsupported',all(c['beforeValues']['closed_at']==c['beforeValues']['updated_at']=='UNKNOWN'and c['originalMissingBeforeHashForThisId']=='UNKNOWN'and not c['originalIdToMissingBeforeHashMapResolved']and not c['preciseRestoreSupported']for c in cases))
check('case observations match direct receipts',all(next(r for r in rows if r['id']==c['campaignId'])['fullCurrentRowMd5']==c['directCurrentObservation']['fullCurrentRowMd5']and c['directCurrentObservation']['sameAtFinalRead']for c in cases))
corroboration=a('q3-after-hash-corroboration')
check('AFTER vectors corroborated without BEFORE mapping',len(corroboration['rows'])==3 and all(r['postIncidentVectorContainsCurrentAfterHash']and r['postRecoveryVectorContainsCurrentAfterHash']and not r['matchesOriginalMissingBeforeHashes']for r in corroboration['rows'])and corroboration['beforeValuesRemain']=='UNKNOWN')
visibility=a('q3-query-visibility')['payload']
check('eight relations SELECT-visible, RLS not hiding rows',len(visibility)==8 and all(v['selectAllowed']and not v['rowSecurityActiveForQueryRole']for v in visibility))
schema=a('q3-campaign-schema')['payload'];dependencies=a('dependency-recovery-summary')
check('no current user triggers, three CASCADE FK families',schema['triggers']==[]and len(schema['inboundFks'])==3 and all('ON DELETE CASCADE'in f['definition']for f in schema['inboundFks']))
check('per-ID identified FK and known notification dependencies zero',len(dependencies['foreignKeyDependencies'])==3 and all(set(x['counts'])==ids and set(x['counts'].values())=={0}for x in dependencies['foreignKeyDependencies'])and set(dependencies['notificationReferences'])==ids and set(dependencies['notificationReferences'].values())=={0})
decisions=a('next-decisions');check('A only, C ineligible, no automatic other approval',decisions['AExecuted']and not any(decisions[k]for k in ['B1Approved','B2Approved','CApproved','CEligible'])and not decisions['exactRestorationC']['eligible']and not decisions['realProviderEnabled'])
checklist=a('r1-checklist')
check('R1 dependencies and completion criteria retained, no tests rerun',len(checklist['items'])==len(get('D19-incident-decision-r1-checklist.json')['items'])and all(x['dependencies']is not None and x['doneWhen']and x['stillNotRun']for x in checklist['items'])and checklist['newTestRunCount']==0)
for r in a('evidence-sources')['records']:
 check('source evidence digest '+r['path'],sha((R/r['path']).read_bytes())==r['sha256']and(R/r['path']).stat().st_size==r['bytes'])

check('Git HEAD branch origin index unchanged',git('rev-parse','HEAD')==before['head']==delivery['headSha']and git('branch','--show-current')==before['branch']==delivery['branch']and git('remote','get-url','origin')=='https://github.com/YNWAforever/Remix-Adfocate.git'and not git('diff','--cached','--name-only'))
diff=subprocess.run(['git','diff','--check'],capture_output=True,text=True)
check('Git whitespace check',diff.returncode==0)
(D/'logs'/(P+'diff-check.log')).write_bytes((diff.stdout+diff.stderr+'check-only exit=0\n').encode())
(D/'logs'/(P+'document-check.log')).touch(exist_ok=True)
put(P+'integrity.json',{})
currentPaths=set(p for p in subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard']).decode('utf-8').split('\0')if p and(R/p).is_file())
added=sorted(currentPaths-set(before['allExistingPaths']))
check('new versionable files limited to incident A evidence',all(p.startswith('docs/verification/'+P)or p.startswith('docs/verification/logs/'+P)for p in added))
check('all pre-existing versionable paths retained',set(before['allExistingPaths'])<=currentPaths)
pattern=re.compile(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{16,}')
scanned=0
for path in added:
 if '-prior-'in path:continue
 content=(R/path).read_text(encoding='utf-8-sig');scanned+=1
 check('new evidence credential/email pattern scan '+path,not pattern.search(content)and not re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',content))
 if path.endswith('.json'):read(R/path)
for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)',(D/(P+'report.md')).read_text(encoding='utf-8')):
 check('report link '+target,(D/target.split('#')[0]).is_file())

put(P+'changed-files.json',{'sourceFingerprint':fingerprint,'applicationTestConfigMigrationChanges':0,'modifiedExisting':sorted(shared|{'docs/verification/evidence-integrity.json'}),'newFiles':sorted(set(added)|{'docs/verification/'+P+'changed-files.json'}),'ignoredHelpers':'.codex-tmp/D19_incident_A_*.py, finalize_D19_incident_A.py, polish_D19_incident_A.py, check_D19_incident_A.py; local evidence work only','previousDirtyWorkPreserved':True})
files=[p for p in sorted(D.rglob('*'))if p.is_file()and p.name!='evidence-integrity.json']
result={'at':datetime.now(timezone.utc).isoformat(),'status':'PASS_LOCAL_RECORD_INTEGRITY_Q1_PARTIAL_NO_PREIMAGE_NO_R1_PROMOTION','checksPassed':len(checks),'sourceFingerprint':fingerprint,'sourceRecords':353,'applicationTestConfigMigrationChanges':0,'nonVerificationFilesUnchanged':883,'priorEvidenceFiles':1161,'priorEvidenceUnchanged':1159,'sharedEvidenceUpdated':sorted(shared),'sealedEvidenceCount':len(files),'originalAuditCaseResultsPreserved':107,'taskResultsPreservedExceptD19AppendedFollowup':True,'originalIncidentAndDecisionPacketUnchanged':True,'pristineAcceptanceArtifactsUnchangedNotRerun':True,'readOnlySqlSessionsSucceeded':13,'readOnlySqlSessionsAborted':2,'preSqlGuardRefusal':1,'serverFileDenialNotBypassed':True,'Q1':'PARTIAL','Q2':'NO_CREDIBLE_READABLE_PREIMAGE_FOUND','Q3':'SCOPED_CURRENT_STATE_VERIFIED','exactRestoreSupported':False,'originalBeforeValues':'UNKNOWN','originalMissingBeforeHashMap':'UNKNOWN','currentCampaignsDirectlyConfirmed':3,'knownPerIdForeignKeyNotificationReferences':0,'auditReferencesInThreeChannels':0,'actualSqlRoleVisibilityConfirmed':8,'currentRetainedLogLinesScanned':6012,'newEvidencePatternScanned':scanned,'unclassifiedCredentialOrEmailPatterns':0,'caseCoverageAndOriginalAuditResultsUnchanged':True,'DBRollbackApplied':False,'D15ContentBlocked':True,'advisorOwnerDeviceHostedFormalStaffBlocked':True,'realProviderEnabled':False,'incidentOpen':True,'restored':False,'releaseHold':True,'wholeCurrentR1Verified':False,'commit':None,'push':False,'merge':False,'deploy':False,'businessDataActions':0,'newApplicationOrAcceptanceTestRuns':0,'gitDiffCheck':True,'checks':checks}
put(P+'integrity.json',result)
summary={k:result[k]for k in ['status','checksPassed','sealedEvidenceCount','sourceRecords','applicationTestConfigMigrationChanges','priorEvidenceUnchanged','Q1','Q2','Q3','exactRestoreSupported','incidentOpen','releaseHold','realProviderEnabled','businessDataActions','newApplicationOrAcceptanceTestRuns']}
(D/'logs'/(P+'document-check.log')).write_bytes(('command: python docs/verification/D19-incident-A-check-records.py\n'+json.dumps(summary,ensure_ascii=False)+'\nThis is local document/hash verification, not product acceptance.\n').encode('utf-8'))
records=[{'path':p.relative_to(R).as_posix(),'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}for p in files]
put('evidence-integrity.json',{'codeFingerprint':fingerprint,'excludes':['self-referential evidence-integrity.json'],'files':records})
sealed=get('evidence-integrity.json')
assert len(sealed['files'])==len(records)and all(sha((R/r['path']).read_bytes())==r['sha256']and(R/r['path']).stat().st_size==r['bytes']for r in sealed['files'])
print(json.dumps(summary,ensure_ascii=False))
