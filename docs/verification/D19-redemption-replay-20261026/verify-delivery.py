"""File-only final delivery check. No subprocess, client, network, SQL or target."""
from pathlib import Path
import csv,hashlib,json,sys
R=Path(__file__).resolve().parents[3];V=R/'docs/verification';P=Path(__file__).resolve().parent
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def bound(x):
 p=(R/x['path']).resolve();assert p.is_relative_to(R);assert sha(p)==x['sha256'],x['path'];return p
def rows(p):
 with Path(p).open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
checkpoint=read(P/'checkpoint.json');before={x['path']:x for x in checkpoint['files']}
for x in before.values():assert sha(R/x['before'])==x['sha256']
for n in ['D19-C2-transport-continuation-runtime-manifest.json','D19-C2-transport-preparation-20261026/runtime-authorization.json','D19-application-runtime-preparation-20261025/runtime-authorization.json']:assert sha(V/n)==before['docs/verification/'+n]['sha256']
assert read(V/'D19-application-runtime-preparation-20261025/runtime-authorization.json')['approved'] is True
assert read(V/'D19-C2-transport-preparation-20261026/runtime-authorization.json')['approved'] is False
source=read(V/'code-fingerprint.json');fp=source['fingerprint'];assert len(source['files'])==793
assert hashlib.sha256(json.dumps(source['files'],separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==fp
for i in source['files']:assert hashlib.sha256((R/i['path']).read_text(encoding='utf-8').encode()).hexdigest()==i['sha256'],i['path']
candidate=read(P/'candidate-source.json');assert candidate['files']==source['files']and candidate['fingerprint']==fp
auth=read(P/'runtime-authorization.json');assert auth['approved']is False and auth['ownerReference']is None and auth['sourceFingerprint']==fp
manifest=read(V/'D19-C2-current-source-runtime-manifest.json');assert sha(V/'D19-C2-current-source-runtime-manifest.json')==auth['manifestSha256']
assert manifest['candidate']['fingerprint']==fp and manifest['candidate']['records']==793
assert manifest['supplement']['schema']['file']=='supabase/migrations/20261025120934_application_decisions.sql'
assert manifest['continuation']['sourceSchemaScope']['excludedFiles']==['supabase/migrations/20261025194402_redemption_intents.sql']
assert manifest['continuation']['sourceSchemaScope']['redemptionRequests']==0
oldmanifest=read(V/'D19-C2-application-runtime-manifest.json')
for k in ['fixture','bootstrap']:assert manifest[k]==oldmanifest[k],k
for k in ['actualContainerIds','actualNetworkId','serviceImageIds']:assert manifest['target'][k]==oldmanifest['target'][k],k
assert manifest['supplement']['resourceAdds']=={'projects':0,'volumes':0,'networks':0,'containers':0}
assert manifest['supplement']['baselineVersions']==oldmanifest['supplement']['baselineVersions']
assert not manifest['ownerApproved']and not manifest['canExecute']and not manifest['supplement']['runtimeApproved']
for x in manifest['continuation']['allowedLocalArchives']:
 bound(x['source']);assert not(R/x['destination']).exists()and not x['executed']
ns=R/'.codex-tmp/adfocate-d19-b2-20261025-recovery-4d6ca2c8/90ffc505-7abe-4b4c-8041-a6c954509278/role'
assert not(ns/'supplement-claim.json').exists()and not(ns/'owned-journal.jsonl').exists()
main=read(V/'adfocate-delivery.json');prior=read(R/before['docs/verification/adfocate-delivery.json']['before']);delivery=read(P/'delivery.json');gates=read(P/'gates.json')
assert main['D15']==prior['D15']and main['D19C2RuntimeTransport']==prior['D19C2RuntimeTransport']
assert main['codeFingerprint']==delivery['sourceFingerprint']==gates['sourceFingerprint']==fp
assert main['currentRecordAuthority']['currentSummary']==(P/'delivery.json').relative_to(R).as_posix()and main['currentRecordAuthority']['currentRuntimeSource']is None
assert main['commit']is None and main['deploymentStatus']=='not-deployed'and not main['finalDeliveryReview']['wholeCurrentR1Verified']
for k in ['wholeR1Verified','restored','providerEnabled','runtimeApproved']:assert delivery[k]is False
assert delivery['incidentOpen']and delivery['releaseHold']and delivery['oldE8ActualApprovalStillTrue']
for k in ['actualTargetCalls','realSdkClients','physicalSqlCalls','authSubjectsCreated','productionOrFormalStaffWrites','actualProviderCalls']:assert delivery[k]==0
assert gates['fullNative']=={'passed':2155,'failed':0,'skipped':363,'files':295}
assert gates['redemptionNative21']=={'memory':10,'client':11,'includedInFullNative':True}
assert gates['walletImpact']=={'passed':8,'failed':0,'skipped':0,'separateStandaloneNotAddedToFull':True}
for z in gates['checks'].values():
 c=read(bound(z['receipt']));bound(z['log']);ram=read(bound(z['resource']));assert c['exit']==0 and c['sourceFingerprint']==fp and c['sourceUnchangedAfter']
 assert min(ram['freePhysicalGiB'],ram['freeCommitGiB'])>=3
full=read(P/'full-native-verified.json');assert full['success']and full['numPassedTests']==2155 and full['numFailedTests']==0 and len(full['testResults'])==295
assert read(P/'release-foundation-green.json')['numPassedTests']==108
for label,count in [('memory-final',10),('client-final',11)]:
 x=read(P/(label+'.json'));assert x['success']and x['numPassedTests']==count
 trace=read(P/(label+'-readback.json'));assert len(trace['observations'])==count and all(o['realSdkClients']==0 for o in trace['observations'])
schema=read(P/'schema-manifest-final.json');assert schema['sourceFingerprint']==fp and len(schema['files'])==74 and schema['original73RawHashesUnchanged']and schema['original73LfHashesUnchanged']
for x in schema['files']:assert sha(R/x['path'])==x['rawSha256']
assert main['schemaManifestDigest']==schema['releaseManifestDigest']
release=read(R/'supabase/release-manifest.json');oldrelease=read(P/'source-revisions/151b0b14fdb30e4b695b4e398dcc145e19a9cb345c469d72183840cd702b5d06/supabase/release-manifest.json.txt')
assert len(release['migrations'])==44 and release['migrations'][:-1]==oldrelease['migrations']
caps=set(c for m in release['migrations']for c in m['capabilities']);assert len(caps)==598
cases=rows(V/'audit_case_coverage.csv');oldcases=rows(R/before['docs/verification/audit_case_coverage.csv']['before']);assert len(cases)==len(oldcases)==107 and main['caseResults']==cases
cols=['case_id','title','primary_task','secondary_tasks','phase','original_audit_result','original_environment','expected','implementation_result','evidence_required','release_note'];changed=[]
for a,b in zip(cases,oldcases):
 assert all(a[k]==b[k]for k in cols),a['case_id']
 if a!=b:changed.append(a['case_id'])
 if a['case_id']in ['UC-C18','UC-A51']:assert a==b
assert set(changed)=={'UC-C33','UC-C13','UC-C14','UC-C36','UC-A45','UC-C25','UC-A10','UC-A06','UC-R04'}
tasks=rows(V/'implementation_backlog.csv');oldtasks=rows(R/before['docs/verification/implementation_backlog.csv']['before']);assert len(tasks)==len(main['taskResults'])==20 and main['taskResults']==tasks
for a,b in zip(tasks,oldtasks):
 if a['task_id']!='D19':assert a==b
 else:assert all(a[k]==b[k]for k in ['task_id','phase','title','dependencies','finding_ids','primary_cases','status','size','completion','scope'])
assert read(V/'D19-C2-proposal-status.json')['currentSource']==fp
oldseal=read(R/before['docs/verification/evidence-integrity.json']['before']);assert len(oldseal['files'])==2439
for entry in oldseal['files']:
 a=R/entry['path']
 if a.is_file()and sha(a)==entry['sha256']:continue
 saved=before.get(entry['path']);assert saved and sha(R/saved['before'])==entry['sha256'],entry['path']
if '--preseal'not in sys.argv:
 seal=read(V/'evidence-integrity.json');actual={x.relative_to(R).as_posix()for x in V.rglob('*')if x.is_file()and x!=V/'evidence-integrity.json'}
 assert {x['path']for x in seal['files']}==actual and main['evidenceIntegrity']['records']==len(actual)
 for x in seal['files']:assert bound(x).stat().st_size==x['bytes']
 for x in read(V/'D19-redemption-replay-integrity.json')['files']:bound(x)
print(json.dumps({'status':'PASS_CURRENT_C33_LOCAL_DELIVERY_NOT_R1','source':fp,'fullNative':2155,'fullSkipped':363,'nativeC33Included':21,'separateWalletImpact':8,'releaseFoundation':108,'sourceMigrations':74,'original73Unchanged':True,'originalCases':107,'priorEvidenceRecordsPreserved':2439,'currentRuntimeApproved':False,'oldE8Approved':True,'actualTargetCalls':0,'incidentOpen':True,'releaseHold':True,'providerEnabled':False,'preseal':'--preseal'in sys.argv}))
