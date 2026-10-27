"""File-only blocked audit; does not create a client, invoke shell or touch targets."""
from pathlib import Path
import contextlib,csv,hashlib,io,json,runpy,sys
R=Path(__file__).resolve().parents[3];V=R/'docs/verification';P=Path(__file__).resolve().parent
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def bound(x):
 p=(R/x['path']).resolve();assert p.is_relative_to(R);assert sha(p)==x['sha256'],x['path'];return p
cp=read(P/'checkpoint.json');saved={x['path']:x for x in cp['before']}
for x in saved.values():assert sha(R/x['before'])==x['sha256']
for x in cp['frozen']:bound(x)
argv=sys.argv[:];capture=io.StringIO()
try:
 sys.argv=[str(V/'D19-asset-offline-20261026/verify-delivery.py'),'--preseal']
 with contextlib.redirect_stdout(capture):runpy.run_path(sys.argv[0],run_name='__main__')
finally:sys.argv=argv
previousCheck=json.loads(capture.getvalue());assert previousCheck['standalonePassed']==11 and previousCheck['sourceUnchanged']==793
audit=read(P/'audit.json');reval=read(P/'revalidation.json');main=read(V/'adfocate-delivery.json')
assert audit['fullObjectiveAchieved']is False and audit['requestedGoalTransition']=='blocked'
assert audit['sameConditionConsecutiveTurns']==audit['threshold']==3 and audit['previousGoalTurnClassification']=='PROGRESS'
assert audit['conditionKey']=='CURRENT_4F_CB_C2_RUNTIME_AUTHORIZATION_NOT_GRANTED'
for w in audit['witnesses']:bound(w['evidence'])
for x in audit['sourceReferences']:bound(x)
assert read(bound(reval['currentAuthorization']))['approved']is False
assert read(bound(reval['oldE8Authorization']))['approved']is True
manifest=read(bound(reval['manifest']));assert manifest['approval']['sourceBound']and not manifest['ownerApproved']and not manifest['canExecute']
assert manifest['candidate']['fingerprint']==audit['sourceFingerprint']==main['codeFingerprint']
assert reval['archive']['exists']is False and not Path(reval['archive']['exactPath']).is_file()
assert reval['archive']['freshArchiveHashVerified']is False and reval['archive']['broaderFilesystemSearch']is False
for x in reval['terminalJobs']:
 c=read(bound(x['receipt']));assert c['exit']==0 and c['endedAt']==x['endedAt']and c['sourceUnchangedAfter']
assert reval['noLiveTargetJobWaitClaim']and reval['actualTargetCallsThisTurn']==0
assert audit['currentRequiredDecision']['approvalQuestionAlreadyPending']and not audit['currentRequiredDecision']['newQuestionSent']
assert audit['constraints']=={'originalIncident':'OPEN_UNRESTORED','oldShaped':'FORENSIC_ONLY','releaseHold':True,'providerEnabled':False,'actualTargetCallsThisTurn':0,'productionWrites':0,'membershipRoleWrites':0,'resourceLifecycleActions':0,'commit':None,'push':False,'merge':False,'deploy':False}
before=read(R/saved['docs/verification/adfocate-delivery.json']['before'])
for k in ['D15','D19AssetOffline','D19RedemptionReplay','currentCandidateVerificationScope','financialNeutrality','currentExecutionModelVerification']:assert main[k]==before[k],k
assert main['caseResults']==before['caseResults']and main['commit']is None and main['deploymentStatus']=='not-deployed'
assert not main['finalDeliveryReview']['wholeCurrentR1Verified']and main['r1Verification']==before['r1Verification']
bound(main['D19GoalBlockedAudit']['audit']);bound(main['D19GoalBlockedAudit']['revalidation'])
plan=R/'docs/superpowers/plans/2026-10-23-adfocate-implementation-plan.md';text=plan.read_text(encoding='utf-8');section=text[text.index('### D19 ·'):text.index('### D20 ·')]
assert '- [ ] **4. 執行以下驗證。**'in section and '- [ ] **5. 核對完成條件並交接。**'in section
assert 'cb933614' in section and '4f2c3faa' in section
with(V/'implementation_backlog.csv').open(encoding='utf-8-sig',newline='')as f:tasks=list(csv.DictReader(f))
with(R/saved['docs/verification/implementation_backlog.csv']['before']).open(encoding='utf-8-sig',newline='')as f:oldtasks=list(csv.DictReader(f))
assert tasks==main['taskResults']and len(tasks)==20
for a,b in zip(tasks,oldtasks):
 if a['task_id']!='D19':assert a==b
 else:assert all(a[k]==b[k]for k in a if k not in ['newResult','runtimeStatus','evidence'])
oldseal=read(R/saved['docs/verification/evidence-integrity.json']['before']);assert len(oldseal['files'])==2787
for x in oldseal['files']:
 p=R/x['path']
 if p.is_file()and sha(p)==x['sha256']:continue
 s=saved.get(x['path']);assert s and sha(R/s['before'])==x['sha256'],x['path']
beforeTransition='--before-transition'in argv
if beforeTransition:
 assert not(P/'goal-transition.json').exists()and main['D19GoalBlockedAudit']['actualGoalStatus']is None
else:
 transition=read(P/'goal-transition.json');goal=transition['toolResult'].get('goal',transition['toolResult'])
 assert goal['status']=='blocked'and goal['threadId']=='01a16483-e55d-7332-9ddc-7e8a3f68eb11'
 assert main['D19GoalBlockedAudit']['actualGoalStatus']=='blocked';bound(main['D19GoalBlockedAudit']['goalTransition'])
if '--preseal'not in argv and not beforeTransition:
 seal=read(V/'evidence-integrity.json');actual={p.relative_to(R).as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}
 assert {x['path']for x in seal['files']}==actual and main['evidenceIntegrity']['records']==len(actual)
 for x in seal['files']:assert bound(x).stat().st_size==x['bytes']
 for x in read(V/'D19-blocked-audit-integrity.json')['files']:bound(x)
print(json.dumps({'status':'PASS_BLOCKED_AUDIT_NOT_R1','previousTurn':'PROGRESS','sameBlockerConsecutiveTurns':3,'sourceUnchanged':793,'currentC2UnchangedAndUnapproved':True,'oldE8Approved':True,'caseRowsUnchanged':107,'priorEvidenceRecordsPreserved':2787,'requiredPlanValidationReopened':True,'newTestsOrRuntime':False,'beforeGoalTransition':beforeTransition,'goalStatus':'active'if beforeTransition else'blocked','preseal':'--preseal'in argv}))
