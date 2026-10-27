from pathlib import Path
import copy,datetime,hashlib,json,uuid
V=Path('docs/verification/D19-application-runtime-preparation-20261025')
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def ref(p):return {'path':p,'sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest()}
def put(p,d):Path(p).write_text(json.dumps(d,ensure_ascii=True,indent=2)+'\n',encoding='utf-8',newline='\n')
originPath='docs/verification/D19-C1-browser-continuation-runtime-manifest.json'
origin=read(originPath); source=read(V/'candidate-source.json')
idsPath=V/'planned-ids.json'
if not idsPath.exists():put(idsPath,{'namespace':str(uuid.uuid4()),'workspace':str(uuid.uuid4()),'missions':[{'kind':kind,**{key:str(uuid.uuid4())for key in ['id','templateId','requirementId']}}for kind in ['race','fault','decline','stale']]})
ids=read(idsPath)
caps={k:0 for k in origin['fixture']['rowCaps']['role']}
caps.update(workspaces=1,creators=2,missions=4,mission_submissions=4,mission_deliverable_templates=4,mission_deliverable_requirements=4,
 mission_workflows=3,mission_work_items=3,mission_working_drafts=3,mission_fulfillments=3,mission_workflow_events=24,mission_publication_instructions=3,mission_reward_contracts=3,
 notifications=12,operator_audit_events=4,operator_crm_command_receipts=4,auth_users=6,staff_users=4,brand_users=3,staff_workspace_roles=3,
 workflow_notification_dedupe=12,auth_identities=6,auth_sessions=6,auth_refresh_tokens=12,auth_audit_log_entries=48,auth_mfa_amr_claims=12,requests=400)
target=copy.deepcopy(origin['target']); target.update(status='EXISTING_C1_REVALIDATE_BEFORE_SQL_OR_CLIENT_NO_CURRENT_RUNTIME_AUTHORITY',credentials='Read only existing exact C1 local key file after physical identity; no hosted or failed-B2 credentials.',provisioning='ZERO Docker resource/lifecycle actions. New exact approved synthetic fixture namespace and forward73 function only after identity and full readonly preservation checks.')
target['ports']['web']=56910; target['ports']['availability']='Exact existing API/DB mappings must match; local web56910 must be free and listening PID must equal new exact child; no fallback/reuse/kill by port.'
target['databaseInitialization']['applicationClientGate']='Do not repeat initialization or72 bootstrap. Fresh physical identity, complete original70-family rows/catalog/history, then exact reviewed forward73 transaction before any SDK or Auth/setup.'
schema=ref('supabase/migrations/20261025120934_application_decisions.sql')
schema={'file':schema['path'],'sha256':schema['sha256'],'baselineMigrationCount':72,'forwardOnly':True,'expectedBefore':'Exact72 history and no new function/history; any partial state stops. No replace/reset/history rewrite.','allowedWrites':['One new function with explicit ACL','One new history row in same transaction','Local PostgREST schema reload notification']}
manifest={
 'schemaVersion':2,'kind':'D19_B2_EXECUTION_SPEC','id':'D19-C2-APPLICATION-SUPPLEMENT','preparedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'reviewOnly':True,'ownerApproved':False,'canExecute':False,'runtimeManifestComplete':True,'specificationReady':True,
 'candidate':{'fingerprint':source['fingerprint'],'records':len(source['files']),'head':'7cfa3dc84c821719a4dff754229a591c81786c53','branch':'codex/adfocate-r1-pilot-20261023','dirty':True},
 'target':target,'bootstrap':copy.deepcopy(origin['bootstrap']),
 'fixture':{'phases':[{'phase':'role','purpose':'Existing shared identity/journal transport selector only; never rerun original role8.','plannedNamespace':ids['namespace'],'plannedPrimaryWorkspaceId':ids['workspace'],'plannedMissions':ids['missions'],'authSubjectsCap':6}],
  'rowScopes':origin['fixture']['rowScopes'],'rowCaps':{'role':caps},'transportWriteCapPerProcess':400,'cleanupApproved':False,'retention':'Keep all business/Auth fixtures and journals, including failures. No data cleanup or reseed.',
  'syntheticRoleBootstrap':'Four additional exact updates of new OperatorA only: membership active false/true and role operator/finance_viewer/operator to prove live replay denial, with verified before values. Failure stops without automatic compensation. Only three exact newly created synthetic staff subjects in new workspace, owner SQL because service_role is SELECT-only. granted_by=self is a fixture bootstrap, not product/admin role-management acceptance.',
  'auth':'Six auto-confirmed example.test subjects; six password sign-ins; three real setup sessions injected into isolated browser contexts. No UI login claim, email, invitation, or original subject session renewal.',
  'children':'Returned Auth/submission/workflow descendants are captured immediately by exact IDs or scoped70-family readback; unresolved response/receipt stops without retry.',
  'ddlFaults':'Create/drop only two namespace-scoped private fault functions and exact triggers, predicate one new submission; verify function hash before exact drop. No original object replace/drop.',
  'financialBoundary':'No ledger/balance/budget/inventory writes or pending/completion creation. Original +10XP and filled increment only for each actually accepted new application, once. Preserve all preexisting70-family rows and full financial row contents.'},
 'execution':{'artifactNamespace':ids['namespace'],'phaseSelector':'role','originalApiReruns':0,'originalBrowserReruns':0,'parallelAgents':False,'parallelRuntimePhases':False,'pristineRpcRerun':False,
  'commands':[{'offline':True,'argv':['node','node_modules/vite-node/vite-node.mjs','--script','scripts/audit/execute-application-supplement.mjs','docs/verification/D19-C2-application-runtime-manifest.json','--offline-check']},
    {'offline':False,'argv':['node','node_modules/vite-node/vite-node.mjs','--script','scripts/audit/execute-application-supplement.mjs','docs/verification/D19-C2-application-runtime-manifest.json','--execute']}],
  'environment':{'ADFOCATE_B2_MANIFEST_PATH':'docs/verification/D19-C2-application-runtime-manifest.json','ADFOCATE_B2_PHASE':'role','ADFOCATE_B2_AUTHORIZATION_PATH':str(V/'runtime-authorization.json').replace('\\','/')},
  'order':['Separate digest/source-bound human runtime approval','File-only authority check','Fresh five-service Docker identity before SQL/keys/client','Readonly original70-family/catalog/history and root-ID check','One-time local claim, no restart','Forward73 and preserved catalog/rows diff','Six bounded Auth subjects/new fixture','API race/rollback/replay/permissions','Three application browser scenarios','Final full row preservation/caps/financial readback'],
  'matrix':{'api':['Four real Creator apply + duplicate409, one saved row each','Missing membership and finance capability403','Direct authenticated RPC403 and wrong workspace argument with own new submission FORBIDDEN','Owned audit and workflow failure503 fully roll back, same request later succeeds','Exact replay no second quota/XP/workflow/audit/receipt; changed payload409','Two real operators accept/decline concurrently; one winner + saved actor/time to loser','Application accepted/declined notification recipient/type/slug/unread match saved state; other Creator cannot see it'],
   'browser':['503 mock preserves row/input, edited reason explicit retry saves','Creator reload displays exact saved decline reason','Second operator commits, stale operator gets real409 attribution and preserved input; explicit refresh removes processed row']},
  'localAppServer':'One new exact-source node/Vite child at56910, ownership PID checked before health/UI, only exact own child stopped on exit. No Docker lifecycle actions.',
  'browser':'Installed Microsoft Edge, desktop only; no Safari/physical mobile/AT claim; trace/video/screenshots disabled to avoid credential/author text artifacts.',
  'providers':'External HTTP denied except exact local app/C1 API; all real AI keys blank. No real notifications/publication/payment.',
  'resourceGate':'Fresh physical and available commit >=3GiB before execution; no automatic fallback.'},
 'supplement':{'kind':'APPLICATION_DECISIONS_ONLY','originManifestSha256':'696e94c29e62a27e820d7d12f5aa74c0d1e7b62f97f3b57db787074512a2626d',
   'originManifest':ref(originPath),'originFinalReadback':ref('docs/verification/adfocate-d19-b2-20261025-recovery-4d6ca2c8/68d510a8-82a8-42bd-b3e8-4561580a7a19/final-readback-after-collection.json'),
   'originTargetReceipt':ref('.codex-tmp/adfocate-d19-b2-20261025-recovery-4d6ca2c8/browser-continuation-target-receipt.private.json'),
   'originCatalog':ref('docs/verification/adfocate-d19-b2-20261025-recovery-4d6ca2c8/application-catalog-after-compatibility.json'),
   'originImmutableBaseline':ref('docs/verification/adfocate-d19-b2-20261025-recovery-4d6ca2c8/68d510a8-82a8-42bd-b3e8-4561580a7a19/immutable-bootstrap-baseline.json'),
   'source':ref(str(V/'candidate-source.json').replace('\\','/')),'resourceAdds':{'projects':0,'volumes':0,'networks':0,'containers':0},'authSubjects':6,'workspaces':1,'missions':4,
   'schema':schema,'baselineVersions':sorted(p.name.split('_')[0]for p in Path('supabase/migrations').glob('*.sql')if p.name!='20261025120934_application_decisions.sql'),
   'originalApiReruns':0,'originalBrowserReruns':0,'legacyIssuance':False,'providerEnabled':False,'cleanupApproved':False,'incidentOpen':True,'releaseHold':True,'runtimeApproved':False},
 'approval':{'runtimeApproved':False,'receipt':str(V/'runtime-authorization.json').replace('\\','/'),'sourceBound':True,'origin696eIsCompletedNotReused':True,
   'requestedDecision':'Approve only this final digest/source and above six new synthetic subjects, one workspace, four missions, forward73, two exact owned temporary fault objects, four exact new-OperatorA membership/capability fixture updates, API checks and three new UI scenarios; zero new Docker resources; preserve original data and blockers.'},
 'abortAndRollback':{'onFailure':'Stop dependent operations; retain exact IDs/claims/journals/receipts as UNKNOWN when response lost. No auto retry/reseed/data compensation or role repair.',
  'schemaRollback':'No automatic down migration. Keep function/history and old code available; future owner-reviewed forward change only. No existing72 checksum changes.',
  'cleanup':'No business/Auth data deletion; only explicitly reviewed exact two owned temporary fault triggers/functions removed after hash and full rollback assertion. Interrupted fault remains for review.',
  'incident':'Original3 campaign incident remains OPEN/unrestored; shaped forensic-only, no target lifecycle or acceptance reuse; release HOLD.'},
 'remaining':['BINARY-ASSET-OWNERSHIP','CROSS-CREATOR-WORKFLOW full read/write/proof isolation','LEGACY-APPROVAL-REPLAY if fresh evidence required','GATE14 applicability and original107 acceptance gaps','D15 content UC-C18/A51','Named advisor owner/device/manual AT/hosted','Formal staff handoff','Model-interface verification','Audit archive absent at supplied exact path'],
 'invariants':{'productionWrites':False,'formalMembershipOrRoleWrites':False,'commit':False,'push':False,'merge':False,'deploy':False,'providerEnabled':False,'incidentOpen':True,'releaseHold':True,'wholeR1Verified':False}}
mp=Path('docs/verification/D19-C2-application-runtime-manifest.json')
if mp.exists():
 archive=V/'manifest-revisions';archive.mkdir(exist_ok=True);(archive/(hashlib.sha256(mp.read_bytes()).hexdigest()+'.json')).write_bytes(mp.read_bytes())
put(mp,manifest)
approval={'kind':'B2_RUNTIME_AUTHORIZATION','approved':False,'ownerReference':None,'manifestSha256':ref(str(mp).replace('\\','/'))['sha256'],'sourceFingerprint':source['fingerprint'],'note':'Template only; original696e approval is completed and cannot authorize this new source/fixture/migration.'}
put(V/'runtime-authorization.json',approval)
print(json.dumps({'manifest':str(mp),'sha256':approval['manifestSha256'],'source':source['fingerprint'],'newDockerResources':0,'newSyntheticSubjects':6,'newWorkspace':1,'newMissions':4,'runtimeApproved':False}))
