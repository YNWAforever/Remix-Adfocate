"""File-only evidence check; no subprocess, network, client, SQL or target."""
from pathlib import Path
import csv,hashlib,json,sys
R=Path(__file__).resolve().parents[3];V=R/'docs/verification';P=Path(__file__).resolve().parent
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def bound(ref):
    p=R/ref['path'];assert p.resolve().is_relative_to(R);assert sha(p)==ref['sha256'],ref['path'];return p
def rows(p):
    with Path(p).open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
checkpoint=read(P/'checkpoint.json');before={x['path']:x for x in checkpoint['files']}
for x in before.values():assert sha(R/x['before'])==x['sha256']
for n in ['code-fingerprint.json','D19-C2-transport-continuation-runtime-manifest.json','D19-C2-transport-preparation-20261026/runtime-authorization.json','D19-application-runtime-preparation-20261025/runtime-authorization.json']:assert sha(V/n)==before['docs/verification/'+n]['sha256']
source=read(V/'code-fingerprint.json');fp=source['fingerprint'];assert fp=='ead55a808470f90d72290905db90933cb4a6df48eaba519d4587339a4659b71d'and len(source['files'])==789
assert hashlib.sha256(json.dumps(source['files'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==fp
for x in source['files']:assert hashlib.sha256((R/x['path']).read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest()==x['sha256'],x['path']
assert read(V/'D19-C2-transport-preparation-20261026/runtime-authorization.json')['approved']is False
assert read(V/'D19-application-runtime-preparation-20261025/runtime-authorization.json')['approved']is True
assert sha(V/'D19-C2-transport-continuation-runtime-manifest.json')=='f5caccfdc354e7209b320064f08c9a59ce73cc0ae4bdfca4bcde6e255b424ba0'
main=read(V/'adfocate-delivery.json');prior=read(R/before['docs/verification/adfocate-delivery.json']['before']);delivery=read(P/'delivery.json');gates=read(P/'gates.json')
assert main['D15']==prior['D15']and main['D19C2RuntimeTransport']==prior['D19C2RuntimeTransport']
assert main['codeFingerprint']==delivery['sourceFingerprint']==gates['sourceFingerprint']==fp
assert main['currentRecordAuthority']['currentSummary']==(P/'delivery.json').relative_to(R).as_posix()and main['currentRecordAuthority']['currentRuntimeSource']is None
assert main['commit']is None and main['deploymentStatus']=='not-deployed'and not main['finalDeliveryReview']['wholeCurrentR1Verified']
assert delivery['c2ProposalUnchangedAndPending']and not delivery['wholeR1Verified']and delivery['incidentOpen']and delivery['releaseHold']and not delivery['providerEnabled']and not delivery['restored']
for key in ['actualTargetCalls','realSdkClients','physicalSqlCalls','authSubjectsCreated','productionOrFormalStaffWrites','actualProviderCalls']:assert delivery[key]==0
assert gates['standalone']=={'passed':8,'failed':0,'skipped':0,'files':1}
assert gates['retainedNativeFull']['passed']==2133 and gates['retainedNativeFull']['rerun']is False
for x in gates['verificationArtifacts']:bound(x)
for label,g in gates['checks'].items():
    c=read(bound(g['receipt']));bound(g['log']);ram=read(bound(g['resource']));assert c['exit']==g['exit']and c['sourceFingerprint']==fp and c['sourceUnchangedAfter']and min(ram['freePhysicalGiB'],ram['freeCommitGiB'])>=3
assert read(P/'boundary-final-native.json')['success']and read(P/'boundary-final-native.json')['numPassedTests']==8
actual=read(P/'boundary-final-readback.json')['observations'];assert len(actual)==8
assert all(x['sdkCalls']==x['deniedExternalFetchAttempts']==0 and x['scriptedFinancialRowsUnchangedSinceLatestFixtureReadback']for x in actual)
assert all(d['method']=='GET'or d['path']=='/api/notifications/read'for x in actual for d in x['requests'])
assert [d['status']for d in actual[-1]['requests']]==[401,403]
assert [d['result']['updated']for d in actual[-2]['requests']]==[1,0]
assert actual[4]['fixtureReadUpdates']==[{'table':'point_balances','balance':49},{'table':'point_balances','balance':50}]
assert any(d['path']=='/api/wallet/points'and d['status']==500 for d in actual[1]['requests'])and any(d['path']=='/api/wallet/points'and d['status']==200 for d in actual[1]['requests'])
cfg=read(P/'tsconfig.offline.json');root=read(R/'tsconfig.json');assert cfg=={'extends':'../../../tsconfig.json','include':['wallet-notifications.test.tsx',*['../../../'+x for x in root['include']]]}
cases=rows(V/'audit_case_coverage.csv');old=rows(R/before['docs/verification/audit_case_coverage.csv']['before']);assert len(cases)==len(old)==107 and main['caseResults']==cases
cols=['case_id','title','primary_task','secondary_tasks','phase','original_audit_result','original_environment','expected','implementation_result','evidence_required','release_note'];changed=[]
for a,b in zip(cases,old):
    assert all(a[k]==b[k]for k in cols)
    if a!=b:changed.append(a['case_id'])
    if a['case_id']in ['UC-C18','UC-A51','UC-A06','UC-A10','UC-C25']:assert a==b
assert set(changed)=={'UC-C13','UC-C14','UC-C36','UC-A45'}
assert len(main['taskResults'])==len(rows(V/'implementation_backlog.csv'))==20
oldseal=read(R/before['docs/verification/evidence-integrity.json']['before']);assert len(oldseal['files'])==2377
for entry in oldseal['files']:
    p=R/entry['path']
    if p.is_file()and sha(p)==entry['sha256']:continue
    snapshot=before.get(entry['path']);assert snapshot and sha(R/snapshot['before'])==entry['sha256'],entry['path']
if '--preseal'not in sys.argv:
    seal=read(V/'evidence-integrity.json');actualpaths={p.relative_to(R).as_posix()for p in V.rglob('*')if p.is_file()and p!=V/'evidence-integrity.json'}
    assert set(x['path']for x in seal['files'])==actualpaths and main['evidenceIntegrity']['records']==len(actualpaths)
    for x in seal['files']:assert bound(x).stat().st_size==x['bytes']
    for x in read(V/'D19-wallet-notifications-offline-integrity.json')['files']:bound(x)
print(json.dumps({'status':'PASS_OFFLINE_WALLET_NOTIFICATION_DELIVERY_NOT_R1','sourceUnchanged':789,'standalonePassed':8,'retainedNativeFullPassedNotRerun':2133,'originalCases':107,'priorEvidenceRecordsPreserved':2377,'c2ManifestUnchanged':True,'c2ApprovalPending':True,'actualTargetCalls':0,'incidentOpen':True,'releaseHold':True,'providerEnabled':False,'preseal':'--preseal'in sys.argv}))
