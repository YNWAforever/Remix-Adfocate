"""File-only evidence check. No client, subprocess, network, SQL or target."""
from pathlib import Path
import binascii,csv,hashlib,json,struct,sys,zlib
R=Path(__file__).resolve().parents[3];V=R/'docs/verification';P=Path(__file__).resolve().parent
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def bound(x):
 p=(R/x['path']).resolve();assert p.is_relative_to(R);assert sha(p)==x['sha256'],x['path'];return p
def rows(p):
 with Path(p).open(encoding='utf-8-sig',newline='')as f:return list(csv.DictReader(f))
cp=read(P/'checkpoint.json');before={x['path']:x for x in cp['files']}
for x in before.values():assert sha(R/x['before'])==x['sha256']
for n in ['code-fingerprint.json','D19-C2-current-source-runtime-manifest.json','D19-redemption-replay-20261026/runtime-authorization.json','D19-application-runtime-preparation-20261025/runtime-authorization.json']:assert sha(V/n)==before['docs/verification/'+n]['sha256']
source=read(V/'code-fingerprint.json');fp=source['fingerprint'];assert fp==cp['sourceFingerprint']and len(source['files'])==793
assert hashlib.sha256(json.dumps(source['files'],separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==fp
for x in source['files']:assert hashlib.sha256((R/x['path']).read_text(encoding='utf-8').encode()).hexdigest()==x['sha256'],x['path']
assert read(V/'D19-redemption-replay-20261026/runtime-authorization.json')['approved']is False
assert read(V/'D19-application-runtime-preparation-20261025/runtime-authorization.json')['approved']is True
main=read(V/'adfocate-delivery.json');prior=read(R/before['docs/verification/adfocate-delivery.json']['before']);delivery=read(P/'delivery.json');gates=read(P/'gates.json')
assert main['D15']==prior['D15']and main['D19RedemptionReplay']==prior['D19RedemptionReplay']and main['D19C2RuntimeTransport']==prior['D19C2RuntimeTransport']
assert main['codeFingerprint']==delivery['sourceFingerprint']==gates['sourceFingerprint']==fp
assert main['currentRecordAuthority']['currentSummary']==(P/'delivery.json').relative_to(R).as_posix()and main['currentRecordAuthority']['currentRuntimeSource']is None
assert main['commit']is None and main['deploymentStatus']=='not-deployed'and not main['finalDeliveryReview']['wholeCurrentR1Verified']
assert delivery['c2ProposalUnchangedAndPending']and not delivery['wholeR1Verified']and delivery['incidentOpen']and delivery['releaseHold']and not delivery['providerEnabled']and not delivery['restored']
for k in ['actualTargetCalls','realSdkClients','physicalSqlCalls','authSubjectsCreated','productionOrFormalStaffWrites','actualProviderCalls']:assert delivery[k]==0
assert gates['standalone']=={'passed':11,'failed':0,'skipped':0,'files':1}
assert gates['retainedNativeFull']=={'passed':2155,'failed':0,'skipped':363,'files':295,'rerun':False,'reason':'All793 source records unchanged; new standalone docs tests are excluded by explicit native include paths.'}
for z in gates['checks'].values():
 c=read(bound(z['receipt']));bound(z['log']);m=read(bound(z['resource']));assert c['exit']==0 and c['sourceFingerprint']==fp and c['sourceUnchangedAfter']
 assert min(m['freePhysicalGiB'],m['freeCommitGiB'])>=3
report=read(P/'boundary-valid-fixture-native.json');assert report['success']and report['numPassedTests']==11 and report['numFailedTests']==report['numPendingTests']==0
trace=read(P/'boundary-valid-fixture-readback.json')['observations'];assert len(trace)==11 and all(o['realSdkClients']==o['deniedExternalFetches']==0 for o in trace)
allowed={'create_publication_proof_asset','finalize_publication_proof_asset','abandon_publication_proof_asset','create_active_mission_asset','abandon_active_mission_asset'}
assert all(c['name']in allowed for o in trace for c in o['commands'])
assert trace[0]['uploads'][0]['bytes']==70 and trace[0]['uploads'][0]['upsert']is False and trace[0]['rows'][1]['upload_state']=='finalized'
assert [q['status']for q in trace[7]['requests']if q['method']=='POST']==[400,400]
assert [q['status']for q in trace[9]['requests']]==[404,404]and trace[9]['commands']==[]
assert any(q['status']==409 for q in trace[5]['requests'])and any(q['status']==409 for q in trace[8]['requests'])
assert trace[3]['rows'][1]['upload_state']=='pending'
stops=read(P/'resource-stops.json')['stops'];assert len(stops)==2
for s in stops:
 m=read(bound(s['resource']));assert min(m['freePhysicalGiB'],m['freeCommitGiB'])<3 and s['childStarted']is False and s['testResult']is None
 assert not(P/(s['label']+'-started.json')).exists()and not(P/(s['label']+'-command.json')).exists()
assert read(P/'tsconfig.offline.json')=={'extends':'../../../tsconfig.json','include':['assets.test.tsx',*['../../../'+x for x in read(R/'tsconfig.json')['include']]]}
png=(P/'one-pixel.png').read_bytes();assert len(png)==70 and png[:8]==b'\x89PNG\r\n\x1a\n';offset=8;idat=b''
while offset<len(png):
 size=struct.unpack('>I',png[offset:offset+4])[0];kind=png[offset+4:offset+8];data=png[offset+8:offset+8+size]
 assert binascii.crc32(kind+data)&0xffffffff==struct.unpack('>I',png[offset+8+size:offset+12+size])[0]
 if kind==b'IHDR':assert struct.unpack('>IIBBBBB',data)==(1,1,8,6,0,0,0)
 if kind==b'IDAT':idat+=data
 offset+=size+12
assert zlib.decompress(idat)==b'\x00\x00\x00\x00\xff'
cases=rows(V/'audit_case_coverage.csv');old=rows(R/before['docs/verification/audit_case_coverage.csv']['before']);assert len(cases)==len(old)==107 and main['caseResults']==cases
columns=['case_id','title','primary_task','secondary_tasks','phase','original_audit_result','original_environment','expected','implementation_result','evidence_required','release_note'];changed=[]
for a,b in zip(cases,old):
 assert all(a[k]==b[k]for k in columns),a['case_id']
 if a!=b:changed.append(a['case_id'])
assert changed==['UC-C29']
tasks=rows(V/'implementation_backlog.csv');oldtasks=rows(R/before['docs/verification/implementation_backlog.csv']['before']);assert len(tasks)==len(main['taskResults'])==20 and main['taskResults']==tasks
assert all(a==b for a,b in zip(tasks,oldtasks)if a['task_id']!='D19')
oldseal=read(R/before['docs/verification/evidence-integrity.json']['before']);assert len(oldseal['files'])==2724
for x in oldseal['files']:
 a=R/x['path']
 if a.is_file()and sha(a)==x['sha256']:continue
 saved=before.get(x['path']);assert saved and sha(R/saved['before'])==x['sha256'],x['path']
if '--preseal'not in sys.argv:
 seal=read(V/'evidence-integrity.json');actual={x.relative_to(R).as_posix()for x in V.rglob('*')if x.is_file()and x!=V/'evidence-integrity.json'}
 assert {x['path']for x in seal['files']}==actual and main['evidenceIntegrity']['records']==len(actual)
 for x in seal['files']:assert bound(x).stat().st_size==x['bytes']
 for x in read(V/'D19-asset-offline-integrity.json')['files']:bound(x)
print(json.dumps({'status':'PASS_ASSET_OFFLINE_DELIVERY_NOT_R1','sourceUnchanged':793,'standalonePassed':11,'retainedFullNativeNotRerun':2155,'originalCases':107,'priorEvidenceRecordsPreserved':2724,'c2ManifestUnchangedAndPending':True,'actualTargetCalls':0,'incidentOpen':True,'releaseHold':True,'providerEnabled':False,'preseal':'--preseal'in sys.argv}))
