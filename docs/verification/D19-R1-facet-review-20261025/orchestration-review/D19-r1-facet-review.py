from pathlib import Path
import csv,datetime,hashlib,json,re,subprocess
R=Path.cwd();V=R/'docs/verification';P=V/'D19-R1-facet-review-20261025';C=V/'D19-application-runtime-preparation-20261025'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def put(p,d):Path(p).write_text(json.dumps(d,ensure_ascii=True,indent=2)+'\n',encoding='utf-8',newline='\n')
def ref(p):
 p=R/p if not Path(p).is_absolute()else Path(p)
 return {'path':p.relative_to(R).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def rows(p):
 with Path(p).open(encoding='utf-8-sig',newline='')as f:r=csv.DictReader(f);return r.fieldnames,list(r)
def writeRows(p,fields,data):
 with Path(p).open('w',encoding='utf-8-sig',newline='')as f:w=csv.DictWriter(f,fieldnames=fields,lineterminator='\n');w.writeheader();w.writerows(data)
now=datetime.datetime.now(datetime.timezone.utc).isoformat();checkpoint=read(P/'checkpoint.json');fp=checkpoint['sourceFingerprint']
assert ref(V/'D19-C2-application-runtime-manifest.json')['sha256']==checkpoint['manifestSha256']
native=read(C/'supplement-full-final.json');assert native['numPassedTests']==2129 and native['numFailedTests']==0 and native['numPendingTests']==363
fields,cases=rows(V/'audit_case_coverage.csv');byId={r['case_id']:r for r in cases}
assert not(P/'review.json').exists(),'Do not duplicate this review or overwrite completed evidence'
red=subprocess.run(['python',str(P/'verify-facets.py'),'--claims'],capture_output=True,text=True)
assert red.returncode==1
put(P/'claims-red.json',{'command':['python','docs/verification/D19-R1-facet-review-20261025/verify-facets.py','--claims'],'exit':red.returncode,'stdout':json.loads(red.stdout),'stderr':red.stderr,'classification':'Expected documentation regression: four current full-case labels lack explicit partial/unverified qualifier.'})
references={}
def witnessRef(path):
 record=ref(path);references[record['path']]=record;return record
nativeRef=witnessRef(C/'supplement-full-final.json')
assertions=[]
for file in native['testResults']:
 path=Path(file['name']).relative_to(R).as_posix()
 for a in file['assertionResults']:
  assertions.append({'path':path,'title':a.get('fullName',a['title']),'status':a['status']})
selected=[]
for a in assertions:
 if any(s in a['path']for s in ['active-missions.test','active-mission-schema.test','publication-proof-asset-grant-live','publication-proof-review-live','publicationProof.test','admin.test','wallet.test']):
  if re.search(r'asset|tenant|cross.owner|cross.creator|another creator|publication proof|approve.*once|cash|abandon',a['title'],re.I):selected.append(a)
put(P/'current-native-witnesses.json',{'sourceFingerprint':fp,'reference':nativeRef,'sourceScope':'Existing native full result, not rerun; passed local contracts remain distinct from skipped live tests.','assertions':selected,'newTestRuns':0})
logs={}
for name in ['logs/proof-assets-ownership-final.log','logs/proof-review-real-final.log','logs/legacy-owned-integration-complete.log','logs/R1-disposable-complete.log']:
 p=V/name;lines=p.read_text(encoding='utf-8').splitlines();passes=[]
 for i,line in enumerate(lines,1):
  if re.match(r'^\s*\u2713',line)and re.search(r'asset|proof|cross|tenant|approv|cash|idempotent|rating',line,re.I):passes.append({'line':i,'text':line.strip()})
 logs[name]={'reference':witnessRef(p),'reportedPassLines':passes,'hasExactSourceDigestInLog':any(re.search(r'fingerprint\s*[:=]\s*[a-f0-9]{64}',s,re.I)for s in lines),'scope':'Historical console pass report. A title alone is not an exact current-source/target/Auth/Storage/data preservation receipt.'}
put(P/'historical-log-witnesses.json',logs)
for path in ['server/test/publication-proof-asset-grant-live.test.ts','server/test/publication-proof-review-live.test.ts','server/test/active-mission-schema.test.ts','server/test/active-missions.test.ts','server/test/admin.test.ts','server/test/wallet.test.ts','server/test/audit-workflow-roundtrip.test.ts']:
 witnessRef(path)
legacy=V/'adfocate-d19-b2-20261025-recovery-4d6ca2c8'
c1final=witnessRef(legacy/'68d510a8-82a8-42bd-b3e8-4561580a7a19/final-readback-after-collection.json')
c1case=witnessRef(V/'D19-C1-continuation-case-coverage.json')
c1core=witnessRef(legacy/'core/phase-result.json')
c1origin=read(legacy/'core/phase-result.json');assert c1origin['exitCode']==0
c1=read(legacy/'68d510a8-82a8-42bd-b3e8-4561580a7a19/final-readback-after-collection.json')
assert all(p['inventory']['storage_objects']['count']==0 and p['inventory']['mission_publication_proof_assets']['count']==0 for p in c1['phaseInventories'])
put(P/'retained-c1-scope.json',{'originalApiSource':c1origin['lineage']['sourceFingerprint'],'originalApiManifest':c1origin['lineage']['manifestSha256'],'originalCorePhase':c1core,'lastApprovedContinuationSource':c1['lineage']['sourceFingerprint'],'lastApprovedContinuationManifest':c1['manifestSha256'],'lastApprovedContinuation':c1final,'coverage':c1case,'allPhaseBinaryProofAssetsAndStorageObjects':0,'originalApiRerunsThisReview':0,'newTargetCalls':0,'notProofOf':['Stored binary object access denial','Existing older attempt refused and both attempts unchanged','Same legacy approval replay/concurrency','Same-workspace cross-Creator draft/proof writes with both rows unchanged']})
oldFp=witnessRef(V/'D08-prior-code-fingerprint.json');older=read(V/'D08-prior-code-fingerprint.json');oldMap={r['path']:r['sha256']for r in older['files']};cur=read(V/'code-fingerprint.json');curMap={r['path']:r['sha256']for r in cur['files']}
put(P/'historical-source-binding-limit.json',{'reference':oldFp,'oldScopeRecords':len(oldMap),'currentScopeRecords':len(curMap),'currentProofGrantTestMatchesOldLaterSnapshot':oldMap.get('server/test/publication-proof-asset-grant-live.test.ts')==curMap['server/test/publication-proof-asset-grant-live.test.ts'],'qualification':'Matching one test file in a later partial source snapshot is not a direct binding of the earlier standalone log to its full application/SQL/target/auth state. Missing source records remain unbound, not assumed unchanged.'})
def f(id,requirement,status,evidence,limit,next):return {'facet':id,'requirement':requirement,'status':status,'evidence':evidence,'limit':limit,'nextAcceptance':next}
reviewCases=[
 {'caseId':'UC-C29','facets':[
  f('mime-and-size','Enforce media type/size limits','CURRENT_LOCAL_ONLY',['current-native-witnesses.json'],'Native MIME/20MB policy and schema assertions pass; live upload-limit path is gated/skipped.','Use real owned grant/object flow to verify rejection at limits and recovery without losing draft input.'),
  f('positive-upload','Owned media can be uploaded/finalized','SOURCE_UNBOUND_HISTORICAL_ONLY',['historical-log-witnesses.json'],'Three reported passes: PNG grant only; GIF/MP4 use four synthetic signature bytes. No full media-decoder/browser file chooser acceptance; exact run source/target binding missing in standalone log.','Valid bounded synthetic object through actual client/Storage/API finalization, exact IDs captured.'),
  f('failed-upload-cleanup','Incomplete failed upload can be cleaned up safely','CURRENT_LOCAL_ONLY',['current-native-witnesses.json'],'Signed-URL failure/owner-path abandon mock and migration contracts pass; historic positive tests do not execute failed-grant cleanup branch.','Force a bounded grant/upload/finalize failure on a new exact-owned asset; capture before/after row/object evidence and only explicitly authorized exact cleanup.'),
  f('owned-ui-recovery','Permission/error/expiry/retry UI preserves authored input','MISSING_CURRENT_ACCEPTANCE',['retained-c1-scope.json'],'C1 all binary asset/object caps and observed counts are0; URL proof success is not media chooser/failure/recovery coverage.','Actual isolated Creator UI + nonempty Storage asset, recoverable failure and retained input; physical-device evidence separate.') ]},
 {'caseId':'UC-A14','facets':[
  f('current-url-proof','Review/correction of current URL proof attempt','RETAINED_C1_SCOPE_ONLY',['retained-c1-scope.json'],'Original core passed at6285 and was carried after696e dependency revalidation at e839. Current source e8 has no new runtime. This facet uses URL evidence and zero binary objects.','Retain the original facet with its original bindings; do not rerun completed696e.'),
  f('existing-old-attempt','Only current attempt may be affected; old attempts remain unchanged','MISSING_CURRENT_ACCEPTANCE',['server/test/publication-proof-review-live.test.ts'],'The historical exact-attempt test rejects randomUUID(), an absent attempt. It does not try an existing older attempt and hash both persisted rows.','Create/carry two exact owned real attempts; attempt mutation of existing older ID using otherwise valid current context, assert rejection and unchanged old/current rows.'),
  f('asset-row-rls','Foreign Creator cannot enumerate private proof asset rows','SOURCE_UNBOUND_HISTORICAL_ONLY',['server/test/publication-proof-asset-grant-live.test.ts','historical-log-witnesses.json'],'Current source includes a foreign raw asset SELECT expecting[] and existing workflow404 in PNG test; current full run skips that live test. Standalone older log lacks full source/target binding.','Actual signed-in foreign Creator on a real existing asset; non-enumerating denial and exact row preservation.'),
  f('stored-file-denial','Cross-tenant stored proof file bytes cannot be read','MISSING_CURRENT_ACCEPTANCE',['retained-c1-scope.json'],'No binary object exists in C1 scope. Raw DB SELECT denial alone is not a Storage/object read denial or scoped signed-read API test.','Owned private nonempty object plus wrong Creator/workspace request to actual read/grant boundary; deny access and verify object/row hashes unchanged.') ]},
 {'caseId':'UC-S01','facets':[
  f('owner-anchor','Non-enumerating owner anchor and route error','CURRENT_LOCAL_ONLY',['current-native-witnesses.json'],'Current repository/route tests stub null ownership and verify404; they do not instantiate real Creator B Auth/RLS against existing A rows.','Retain local contract; actual denial must use existing owned IDs, not a random missing resource.'),
  f('historical-owner-denial','Historical cross-owner/workspace reads or schema relationship rejection','SOURCE_UNBOUND_HISTORICAL_ONLY',['historical-log-witnesses.json','server/test/active-mission-schema.test.ts'],'Console reports cross-owner/schema passes and source has relationship guards. Some assertions use privileged inserts/FK failures; no current live run-source/row witness established.','Use real non-owner user client for the intended API/RPC read/write surface.'),
  f('unrelated-assistant-null','Do not substitute assistant-request ownership for active workflow isolation','NOT_AN_ACTIVE_WORKFLOW_WITNESS',['server/test/audit-workflow-roundtrip.test.ts'],'C1 stranger get_assistant_request=null is scoped to assistant data. Staff cross-workspace denial is also distinct from same-workspace Creator resource isolation.','No blanket inference to workflow/item/draft/proof.'),
  f('read-write-state','Cross-Creator reads/writes denied and protected data unchanged','MISSING_CURRENT_ACCEPTANCE',['retained-c1-scope.json'],'Missing real signed-in B request to A workflow/item/draft/proof and saved before/after A+B row hashes; old grant test only supplies a narrower read facet.','Two real same-workspace Creator subjects and exact existing resource IDs; read/write denial, non-enumeration and full relevant saved-state equality.') ]},
 {'caseId':'UC-A11','facets':[
  f('points-retry','Original points award remains once on retry','SOURCE_UNBOUND_HISTORICAL_ONLY',['historical-log-witnesses.json','server/test/admin.test.ts'],'Older test checks250 points after first and second approve. Current full run skips that live group; exact current-source/target receipt absent for older console report.','Read both balance and immutable transaction rows around same-submission retry/concurrent approval.'),
  f('xp-rating-notes','Original XP, quality rating, notes and score snapshot correct','PARTIAL_HISTORICAL_ONLY',['server/test/admin.test.ts','historical-log-witnesses.json'],'Older source checks first XP135 and separate5-star XP185/rating/scores; retry test does not reread XP after second approval and rating test is a distinct submission. Notes persistence is not established by sending a notes payload.','Actual saved XP/notes/rating/score rows read after approval and retry, including exact actor/history where applicable.'),
  f('cash-first','Original legacy nonzero cash credited once to available/ledger','PARTIAL_HISTORICAL_ONLY',['server/test/wallet.test.ts','historical-log-witnesses.json'],'Older wallet test checks first available50,pending0,one earn transaction; it never reapproves that same cash-bearing submission. This is existing legacy credit, not payment and not new pending reward.','A separately approved legacy financial fixture window with nonzero original rewards and exact balance/ledger assertions.'),
  f('same-submission-concurrency','Points/XP/cash are each once across same legacy approval retry/race','MISSING_CURRENT_ACCEPTANCE',['retained-c1-scope.json'],'C1 core/browser issued distinct legacy submissions once. The C1 reapproval case reapproves ACTIVE completion while asserting old legacy anchors unchanged; it is not legacy approval replay. C2 expressly forbids legacy issuance/replay.','Only a separate explicit exact-owned legacy financial scope may run this; do not invoke under pending-neutrality authority or touch old legacy fixtures.') ]},
]
for c in reviewCases:
 row=byId[c['caseId']];c.update(originalTitle=row['title'],originalExpected=row['expected'],originalAuditResult=row['original_audit_result'],originalEnvironment=row['original_environment'],wholeCurrentCaseVerified=False)
review={'at':now,'sourceFingerprint':fp,'mode':'File-only current native evidence and historical source/scope review','newProductCodeChanges':0,'newApplicationTestRuns':0,'actualTargetCalls':0,'wholeR1Verified':False,'cases':reviewCases,'references':list(references.values()),'claimRule':'Pass titles, skipped live tests, nonexistent IDs, raw asset-row SELECT and active completion reapproval cannot replace the missing original acceptance facet. Preserve each historical positive report; do not claim the whole current case verified.','c2ManifestUnchanged':True,'c2ApprovalPending':True,'oldTargetPolicy':'Shaped remains forensic-only; no target or credential access/query. Old3-campaign incident OPEN/unrestored; no new pristine/global RPC acceptance.'}
put(P/'review.json',review)
gateIds={'UC-C13','UC-C14','UC-C15','UC-C16','UC-C17','UC-C33','UC-C36','UC-A09','UC-A18','UC-A19','UC-S04','UC-A45','UC-A46','UC-A49'}
notes={
 'UC-C13':'Read-only wallet/balance/history evidence may be inspected; pending reward must not be equated with withdrawable cash.',
 'UC-C14':'Test disabled/shortfall/out-of-stock UI and recovery with synthetic fixtures/mocks. No real redemption or inventory write is implied.',
 'UC-C15':'Empty redemption UI plus return link; current named local assertions are not live wallet/redemption acceptance.',
 'UC-C16':'Empty active-challenge UI is distinct from settlement/global RPC acceptance.',
 'UC-C17':'List/lock/qualification UI is distinct from actual D15 lessons/progress. UC-C18/A51 content blocker remains.',
 'UC-C33':'Same-person debit/code once and never another recipient. Any real isolated fixture debit/code creation requires its own explicit bounded scope; no real redemption/payment.',
 'UC-C36':'C2 proposes application recipient/type/mission_slug/initial unread checks only. That does not prove active work-item deep-link/read-state UI.',
 'UC-A09':'Flagged Creator invitation gate must be verified with mocks/synthetic sandbox. No actual message/invitation is authorized.',
 'UC-A18':'Prize/ledger uniqueness,ties and eligibility need their own approved synthetic financial scope. C2 does not permit settlement/global jobs or payments.',
 'UC-A19':'Read source-bound bilingual content/link/visibility evidence with synthetic content; no publication. Real approved D15 lessons cannot be invented.',
 'UC-S04':'Retain passed pristine global RPC supplement; do not rerun either global RPC. Match schedule authorization,dedupe and last-success expectations separately; incident remains OPEN.',
 'UC-A45':'Local empty/pending list assertions and new C2 application scenarios are distinct; C2 is still unapproved.',
 'UC-A46':'Read existing participation projections/status with appropriate role and saved-state witness; aggregate core/role counts alone do not prove this case.',
 'UC-A49':'Empty challenge/content UI and add entry are local UI facets; content authoring/publication remains separate and restricted.'}
gate=[]
for id in sorted(gateIds):
 row=byId[id];named=[a for a in assertions if re.search(r'(?<![A-Z0-9])'+re.escape(id)+r'(?![A-Z0-9])',a['title'])]
 gate.append({'caseId':id,'title':row['title'],'originalExpected':row['expected'],'originalAuditResult':row['original_audit_result'],'applicability':'REQUIRED_ORIGINAL_EXPECTATION_NO_WAIVER_APPROVED','wholeCaseVerifiedByThisReview':False,'namedCurrentNativeAssertions':named,'namedAssertionCounts':{s:sum(a['status']==s for a in named)for s in ['passed','failed','skipped']},'limit':'Only exact named assertions extracted; zero exact-name matches is not proof that no equivalent behavior test exists. No blanket runtime/browser/current full-case inference.','nextEvidenceOrRestriction':notes[id],'pilotRestrictionApproved':False,'c2CoversWholeCase':False})
put(P/'gate14-applicability.json',{'at':now,'sourceFingerprint':fp,'cases':gate,'waiversApproved':0,'newRuntimeExecuted':0,'rule':'All14 original expectations remain required; no requested restriction/waiver is inferred from empty fixtures, absent navigation evidence, paid-provider restrictions or aggregate pass counts.'})
changedIds={c['caseId']for c in reviewCases}|gateIds
for row in cases:
 id=row['case_id']
 if id not in changedIds:continue
 if id in gateIds:
  g=next(g for g in gate if g['caseId']==id)
  row['newResult']=('RETAINED_PRISTINE_GLOBAL_RPC_FACET_ONLY'if id=='UC-S04'else 'CURRENT_NAMED_LOCAL_FACETS_PASS'if g['namedAssertionCounts']['passed']else 'HISTORICAL_SCOPED_OR_CURRENT_LOCAL_EVIDENCE_ONLY')+'; ORIGINAL_FULL_CASE_NOT_VERIFIED; ORIGINAL_EXPECTATION_REQUIRED_NO_WAIVER'
  row['testStatus']+=' | Facet review: exact named current assertions '+json.dumps(g['namedAssertionCounts'],separators=(',',':'))+'; no new test runs; absent exact ID is not absent behavior coverage.'
  row['runtimeStatus']='RETAIN_ORIGINAL_SOURCE_BOUND_FACETS_ONLY; no new runtime this review. '+notes[id]
 else:
  row['newResult']='PARTIAL_HISTORICAL_AND_CURRENT_LOCAL_EVIDENCE; CURRENT_FULL_CASE_NOT_VERIFIED'
  row['testStatus']+=' | Explicit local-versus-skipped-live facets reviewed against current full2129/0/363; no new application suite run.'
  row['runtimeStatus']='NOT_REACCEPTED_CURRENT_FULL_CASE. See D19-R1-facet-review-20261025/review.json for direct evidence, historical/source-binding limits and exact missing acceptance. No target/client/fixture/cleanup action this review.'
 row['newEvidence']+=';D19-R1-facet-review-20261025/review.json;D19-R1-facet-review-20261025/gate14-applicability.json'
 row['limitations']+=' | Scope correction only: prior positive observations preserved in exact before snapshots and witness registry; no full-case waiver or fresh-runtime claim. C2 source/manifest stays frozen and unapproved.'
writeRows(V/'audit_case_coverage.csv',fields,cases)
put(P/'case-coverage.json',{'at':now,'sourceFingerprint':fp,'cases':cases,'count':107,'originalFieldsPreserved':True,'newResultRowsCorrected':sorted(changedIds),'newApplicationTestRuns':0,'actualTargetCalls':0})
fields,tasks=rows(V/'implementation_backlog.csv')
for t in tasks:
 if t['task_id']=='D19':
  t['newResult']+='; original-case facet review:4 R1 cases remain partial,14 GATE expectations retained without waiver'
  t['runtimeStatus']+=' Local-only scope review corrects18 new-result rows; no new live assertion, C2 remains pending and unchanged.'
  t['evidence']+=';D19-R1-facet-review-20261025/delivery.json;D19-R1-facet-review-20261025/review.json'
writeRows(V/'implementation_backlog.csv',fields,tasks)
remaining=read(C/'remaining-acceptance.json');remaining.update(at=now,currentFacetReview=(P/'review.json').relative_to(R).as_posix(),gate14Review=(P/'gate14-applicability.json').relative_to(R).as_posix())
for group in remaining['remainingCaseGroups']:
 if group['id']in ['BINARY-ASSET-OWNERSHIP','CROSS-CREATOR-WORKFLOW','LEGACY-APPROVAL-REPLAY']:
  group['status']='LOCAL_EVIDENCE_SCOPE_REVIEW_COMPLETE; ORIGINAL_CURRENT_ACCEPTANCE_STILL_INCOMPLETE'
  group['reviewEvidence']=(P/'review.json').relative_to(R).as_posix()
  group['next']='Keep exact missing facets in review.json. Do not execute them under C2 applications-only or completed696e authority; any actual new fixture/asset/legacy financial scope needs a concrete separately approved manifest.'
 if group['id']=='GATE14-APPLICABILITY':
  group['status']='ALL14_ORIGINAL_EXPECTATIONS_RETAINED_REQUIRED; NO_WAIVER_OR_WHOLE_CASE_ACCEPTANCE'
  group['reviewEvidence']=(P/'gate14-applicability.json').relative_to(R).as_posix()
  group['next']='Use exact current local/historical facets without blanket acceptance; complete necessary authorized synthetic/runtime/UI evidence. No default pilot restriction or payment/message approval.'
remaining['nextTask']='D19: C2 applications-only runtime awaits the existing pending exact-manifest approval. The original4 R1 missing facets and14 applicable expectations remain explicit. Do not alter/reapprove C2, rerun696e/pristine, or start asset/legacy fixture actions without their own bounded scope. Independent local evidence/behavior work can continue.'
put(P/'remaining-acceptance.json',remaining)
rollback={'kind':'LOCAL_METADATA_REVIEW_ONLY_NOT_EXECUTED','sourceFingerprint':fp,'sourceChanges':0,'before':checkpoint['files'],'instructions':['Verify this review after-hashes and preserve any later/user edits before any selective local metadata restoration.','Use only checkpoint exact before copies for changed verification metadata; do not reset/clean dirty checkout.','Retain this review and all historical logs/results/seals. Restoring an older label does not prove acceptance.','No data or schema rollback is applicable: no runtime action was performed. Original incident remains OPEN and unrestored.'],'c2ManifestUnchanged':True,'c2ApprovalUnchanged':True,'releaseHold':True,'providerEnabled':False}
put(P/'rollback.json',rollback)
delivery={'at':now,'status':'LOCAL_R1_FACET_REVIEW_COMPLETED_ACCEPTANCE_GAPS_EXPLICIT','sourceFingerprint':fp,'sourceFilesUnchanged':788,'applicationCodeChanges':0,'newApplicationTestRuns':0,'retainedCurrentFull':{'passed':2129,'failed':0,'skipped':363,'files':292,'reference':nativeRef},'correctedNewResultCases':sorted(changedIds),'original107Preserved':True,'r1CasesReviewed':[c['caseId']for c in reviewCases],'r1WholeCaseVerified':0,'gate14ExpectationsRetained':14,'waiversApproved':0,'review':ref(P/'review.json'),'caseCoverage':ref(P/'case-coverage.json'),'remaining':ref(P/'remaining-acceptance.json'),'rollback':ref(P/'rollback.json'),'c2Manifest':ref(V/'D19-C2-application-runtime-manifest.json'),'c2ApprovalPending':True,'c2ManifestOrSourceChanged':False,'actualTargetCalls':0,'productionWrites':0,'membershipOrRoleWrites':0,'commit':None,'push':False,'merge':False,'deployment':'NOT_DEPLOYED','incidentOpen':True,'restored':False,'releaseHold':True,'providerEnabled':False,'wholeR1Verified':False,'nextTask':remaining['nextTask']}
put(P/'delivery.json',delivery)
main=read(V/'adfocate-delivery.json');main.update(updatedAt=now,caseResults=cases,nextTask=remaining['nextTask'],d19Status='C2_PREPARED_PENDING_APPROVAL_R1_FACET_GAPS_EXPLICIT_RELEASE_HOLD')
main['D19R1FacetReview']=delivery
main['currentRecordAuthority'].update(currentSummary=(P/'delivery.json').relative_to(R).as_posix(),currentCaseCoverage=(P/'case-coverage.json').relative_to(R).as_posix(),checker=(P/'verify-facets.py').relative_to(R).as_posix())
main['evidenceIntegrity'].update(taskSubset='docs/verification/D19-r1-facet-review-integrity.json',checker=(P/'verify-facets.py').relative_to(R).as_posix())
main['changedFiles']=sorted(set(main['changedFiles']+[P.relative_to(R).as_posix()+'/']))
for task in main['taskResults']:
 if task.get('task_id')=='D19':task.update(next(t for t in tasks if t['task_id']=='D19'))
put(V/'adfocate-delivery.json',main)
ledger=V/'adfocate-task-ledger.md';text=ledger.read_text(encoding='utf-8');title='D19 R1 facet scope review - local evidence only';assert title not in text
ledger.write_text(text+f'\n\n## {title}\n\nSource `{fp}` unchanged (788 files); C2 manifest frozen, pending prior question. Four R1 original cases (UC-C29/A14/S01/A11) remain partially proven;14 GATE expectations remain required without waiver.18 new-result rows corrected; all107 original audit fields and D15 rows preserved. Native2129/0/363 is retained, not rerun. No Docker/SQL/Auth/client/fixture/browser/cleanup action. Incident OPEN, release HOLD, provider disabled; see `D19-R1-facet-review-20261025/delivery.json`.\n',encoding='utf-8')
lines=['# R1 acceptance facet review','', 'Local review corrected the scope of18 current case labels. No application source or runtime action changed. R1 remains unverified.','',f'Source `{fp}` (788 files) and C2 manifest `{checkpoint["manifestSha256"]}` remain frozen. The already-pending C2 approval question remains the only application-runtime decision; no second approval was requested.','', '| Case | Directly observed/retained scope | Missing original acceptance |','| --- | --- | --- |',
 '| UC-C29 | Current MIME/size and owner/path cleanup contracts pass locally; old console reports PNG grant and GIF/MP4 synthetic-byte success. | Real failure/unfinished upload cleanup and recovery, limit/permission boundary and saved input with actual Storage. |',
 '| UC-A14 | C1 URL proof correction/verification retained in original scope; older raw asset-row RLS read denial is a narrower historical report. | Existing old attempt rejection with both rows unchanged; real nonempty private object read denial across Creator/workspace. |',
 '| UC-S01 | Current mock owner-anchor404; narrower historical read/schema guards. | Real signed-in cross-Creator workflow/item/draft/proof read/write denial against existing IDs and unchanged saved data. |',
 '| UC-A11 | Historical points retry, first XP/rating and first cash/one-earn-row facets; distinct C1 legacy approvals retained. | Same legacy submission retry/concurrency with points/XP/cash ledger once plus saved notes/rating. Active completion reapproval is not legacy replay. |','',
 'The exact-attempt historical source rejects a random absent UUID; it does not try a persisted older attempt. The historic points retry test does not reread XP after retry; the cash test does not retry its cash-bearing submission. No inference from a positive title or aggregate pass count fills these gaps.','',
 '[Facet register](review.json), [current native witnesses](current-native-witnesses.json), [historical pass lines](historical-log-witnesses.json), [C1 scope](retained-c1-scope.json), [source-binding limit](historical-source-binding-limit.json), [all107 case mapping](case-coverage.json), [remaining acceptance](remaining-acceptance.json), and [rollback](rollback.json) preserve the evidence and missing conditions.','',
 '## GATE14 applicability','', 'All14 original expectations remain required; no pilot exclusion/waiver is approved. Exact named current assertions are listed below; a zero count is not evidence that an equivalent behavior test is absent. Neither a local assertion nor original C1 aggregate counts prove the full case.','', '| Case | Original expectation | Exact named current assertions | Evidence boundary |','| --- | --- | --- | --- |']
for g in gate:lines.append('| '+g['caseId']+' | '+g['originalExpected'].replace('|','/')+' | '+str(g['namedAssertionCounts']['passed'])+' passed, '+str(g['namedAssertionCounts']['skipped'])+' skipped | '+g['nextEvidenceOrRestriction'].replace('|','/')+' |')
lines+=['','[Machine-readable GATE14](gate14-applicability.json). No global/pristine RPC or old fixture was rerun. Any future asset/legacy financial action needs its own exact approved scope; C2 remains applications-only.','', 'Current Node22 native2129 passed/0 failed/363 gated skips (292 files), original16/194 and static/build results are retained from the unchanged source. This review ran only file-based evidence consistency checks, not another application test suite.','', 'D15 content, named advisor owner/device/manual AT/hosted, formal staff and model-interface/audit-archive limitations remain. Original3-campaign incident OPEN/unrestored, shaped forensic-only, release HOLD, provider disabled. No commit/push/merge/deploy. **Not deployed.**','']
(P/'delivery.md').write_text('\n'.join(lines),encoding='utf-8')
print(json.dumps({'source':fp,'sourceChanges':0,'correctedNewResults':sorted(changedIds),'gate14NoWaivers':14,'actualTargetCalls':0,'c2Unchanged':True}))
