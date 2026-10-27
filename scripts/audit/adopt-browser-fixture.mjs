// Reviewed continuation of exact existing synthetic rows; never a fixture creator or DB reset.
import {readFileSync,existsSync,readdirSync} from "node:fs";
import {resolve,relative,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import process from "node:process";
import {verifiedTarget} from "./local-targets.mjs";
import {FixtureJournal,durableJson,journalTransportFetch} from "./fixture-journal.mjs";
import {fixtureInventorySql,assertInventoryCaps} from "./b2-fixture-inventory.mjs";
import {browserContinuation,assertUnchangedRecoverySources} from "./browser-recovery.mjs";

const root=process.cwd(),manifestPath=process.argv[2],mode=process.argv[3]??"--offline-check";
if(!manifestPath||!["--offline-check","--adopt"].includes(mode))throw Error("Use adopt-browser-fixture.mjs <reviewed-manifest> --offline-check|--adopt");
const hash=value=>createHash("sha256").update(value).digest("hex");
const read=path=>JSON.parse(readFileSync(path,"utf8"));
function local(path){const absolute=resolve(root,path),part=relative(root,absolute);if(part.startsWith("..")||isAbsolute(part))throw Error("Recovery reference escapes worktree");return absolute;}
const manifest=read(local(manifestPath)),recovery=manifest.execution?.recovery;
assert.equal(recovery?.mode,"resume-owned-browser-draft");
function bound(reference){assert(reference&&/^[a-f0-9]{64}$/.test(reference.sha256));const bytes=readFileSync(local(reference.path));assert.equal(hash(bytes),reference.sha256,reference.path+" changed");return JSON.parse(bytes);}
const before=bound(recovery.references.fingerprint),current=read(local("docs/verification/code-fingerprint.json"));
assert.equal(before.fingerprint,recovery.origin.sourceFingerprint);assert.equal(current.fingerprint,manifest.candidate.fingerprint);
const changed=assertUnchangedRecoverySources(before,current,recovery.allowedSourceChanges);
for(const file of current.files)assert.equal(hash(readFileSync(local(file.path),"utf8").replace(/\r\n/g,"\n")),file.sha256,"Actual source differs from reviewed fingerprint");
const originManifest=bound(recovery.references.manifest),originState=bound(recovery.references.state),originSchema=bound(recovery.references.schema),originBaseline=bound(recovery.references.baseline),legacyRecord=bound(recovery.references.legacy);
assert.equal(recovery.references.manifest.sha256,recovery.origin.manifestSha256);
assert.equal(originManifest.target.projectId,manifest.target.projectId);assert.equal(recovery.origin.projectId,manifest.target.projectId);
assert.deepEqual(manifest.fixture,originManifest.fixture,"Existing fixture namespaces/caps/IDs cannot change");
assert.equal(manifest.bootstrap.profileDigest,originManifest.bootstrap.profileDigest);
assert.equal(hash(readFileSync(local(recovery.implementation.path),"utf8").replace(/\r\n/g,"\n")),recovery.implementation.sha256);
const checkpoint={workspaceId:originState.resumeCheckpoint.workspaceId,workflowId:originState.resumeCheckpoint.id,submissionId:originState.resumeCheckpoint.submissionId,itemId:originState.resumeCheckpoint.requiredDraft.itemId,revision:originState.resumeCheckpoint.requiredDraft.revision,captionSha256:originState.resumeCheckpoint.requiredDraft.captionSha256,state:originState.resumeCheckpoint.state,itemState:originState.resumeCheckpoint.requiredDraft.state};
const legacy={submissionId:legacyRecord.submissionId,creatorId:legacyRecord.creatorId,missionId:legacyRecord.missionId};
assert.deepEqual(recovery.checkpoint,checkpoint);assert.deepEqual(recovery.legacy,legacy);
if(mode==="--offline-check"){
  process.stdout.write(JSON.stringify({status:"PASS_OFFLINE_EXISTING_FIXTURE_RECOVERY_REVIEW",changedSourcePaths:changed,newAuthSubjects:0,newWorkspaces:0,newMissions:0,newWorkflows:0,legacyReplay:false,privateCredentialRecordsRead:false,dockerSqlOrClientCalls:0})+"\n");
}else{
  // No private credentials, Docker, SQL or Auth request precedes reviewed source checks above.
  for(const key of Object.keys(process.env))if(/SUPABASE|ADFOCATE|INTEGRATION|OPENAI|OPENROUTER|ANTHROPIC|GEMINI|SMTP|SENDGRID|RESEND|TWILIO/.test(key))delete process.env[key];
  for(const key of Object.keys(process.env))if(key.startsWith("DOCKER_"))delete process.env[key];
  Object.assign(process.env,manifest.execution.environment,{DOCKER_CONTEXT:"desktop-linux",ADFOCATE_B2_MANIFEST_PATH:manifestPath,ADFOCATE_B2_PHASE:"role",NODE_OPTIONS:""});
  const target=verifiedTarget(),context=target.context,privateRoot=resolve(context.privatePath("owned-journal.jsonl"),"../.."),publicRoot=resolve(context.publicPath("phase-result.json"),"../..");
  assert(context.lineage.executionNamespace);assert(!existsSync(privateRoot),"Recovery already attempted; no automatic retry or reseed");
  durableJson(resolve(privateRoot,"adoption-intent.private.json"),{lineage:context.lineage,state:"intent",origin:recovery.origin,changedSourcePaths:changed});
  const norm=value=>Array.isArray(value)?value.map(norm).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,norm(value[k])])):value;
  const workspaceIds=manifest.fixture.phases.flatMap(p=>[p.plannedPrimaryWorkspaceId,p.plannedDenialWorkspaceId]);assert(workspaceIds.every(id=>/^[a-f0-9-]{36}$/.test(id)));
  const originInventories={},owned={};
  for(const plan of manifest.fixture.phases){
    const originLineage={...recovery.origin,phase:plan.phase,namespace:plan.plannedNamespace};
    const reference=recovery.references.phases[plan.phase],directory=local(reference.privateDirectory);
    for(const item of reference.journals){assert.equal(hash(readFileSync(local(item.path))),item.sha256);}
    const journal=new FixtureJournal(resolve(directory,"owned-journal.jsonl"),originLineage,manifest.fixture.rowCaps[plan.phase]);journal.assertReady();owned[plan.phase]=journal.owned();
    for(const name of readdirSync(directory).filter(n=>/^(?:(?:owner-)?transport-\d+|transport-browser-[a-z0-9-]+)\.jsonl$/.test(n)))new FixtureJournal(resolve(directory,name),originLineage,{requests:manifest.fixture.transportWriteCapPerProcess}).assertReady();
    const expected=bound(reference.inventory);assert.deepEqual(expected.lineage,originLineage);
    const actual=JSON.parse(target.sql(fixtureInventorySql(manifest.fixture.rowScopes,owned[plan.phase])));assertInventoryCaps(actual,manifest.fixture.rowCaps[plan.phase]);assert.deepEqual(actual,expected.inventory,"Existing scoped rows changed before adoption");originInventories[plan.phase]=actual;
    const old=bound(reference.result);assert.deepEqual(old.lineage,originLineage);
    if(plan.phase!=="browser"){
      assert.equal(old.exitCode,0);
      const tests=bound(reference.tests),count=plan.phase==="role"?8:9;
      assert.equal(tests.success,true);assert.equal(tests.numTotalTests,count);assert.equal(tests.numPassedTests,count);
      assert.equal(tests.numFailedTests,0);assert.equal(tests.numPendingTests,0);assert.equal(tests.testResults.length,1);
      assert(tests.testResults[0].name.replaceAll("\\","/").endsWith(plan.phase==="role"?"/server/test/audit-staff-capabilities.test.ts":"/server/test/audit-workflow-roundtrip.test.ts"));
    }else assert.equal(old.exitCode,1,"The original failed browser result must remain a failure");
  }
  const catalog=JSON.parse(target.sql("begin read only;"+originSchema.query+"commit;"));assert.deepEqual(norm(catalog),norm(originSchema.observed));
  for(const seed of originBaseline.seeds){const now=JSON.parse(target.sql(seed.query));for(const id of seed.ids)assert.equal(now.rowHashes[id],seed.rowHashes[id],seed.table+" seed changed");}
  const serviceHistory=JSON.parse(target.sql(originBaseline.serviceMigrationHistory.query));assert.deepEqual(serviceHistory.authHistory,originBaseline.serviceMigrationHistory.authHistory);assert.deepEqual(serviceHistory.storageHistory,originBaseline.serviceMigrationHistory.storageHistory);
  const financial=JSON.parse(target.sql(originState.query));assert.deepEqual(financial,originState.financialTotals);
  const query=`begin read only;select jsonb_agg(jsonb_build_object('workspaceId',w.workspace_id,'workflowId',w.id,'submissionId',w.mission_submission_id,'itemId',i.id,'revision',d.revision,'captionSha256',encode(extensions.digest(coalesce(d.caption_text,''),'sha256'),'hex'),'state',w.state,'itemState',i.state))from public.mission_workflows w join public.mission_work_items i on i.mission_workflow_id=w.id join public.mission_working_drafts d on d.mission_work_item_id=i.id where w.id='${checkpoint.workflowId}'and i.id='${checkpoint.itemId}';commit;`;
  const liveCheckpoint=JSON.parse(target.sql(query));assert.deepEqual(liveCheckpoint,[checkpoint]);
  const authQuery="begin read only;select jsonb_agg(id order by id)from auth.users;commit;",authBefore=JSON.parse(target.sql(authQuery));
  const intended=[...new Set(Object.values(owned).flatMap(ids=>ids.auth_users??[]))].toSorted();assert.deepEqual(authBefore,intended);assert.equal(intended.length,84);
  const legacyQuery=`begin read only;select jsonb_agg(s.id order by s.id)from public.mission_submissions s join public.missions m on m.id=s.mission_id and m.workspace_id=s.workspace_id where s.workspace_id in(${workspaceIds.map(id=>"'"+id+"'").join(",")})and m.creator_workflow_mode='legacy'and s.status='approved';commit;`;
  const legacyBefore=JSON.parse(target.sql(legacyQuery));assert.equal(legacyBefore.length,2);assert(legacyBefore.includes(legacy.submissionId));
  // Only now may the original private credential fixture be read or Auth sessions renewed.
  const original=bound(recovery.references.browserFixture);assert.equal(original.lineage.sourceFingerprint,recovery.origin.sourceFingerprint);assert.equal(original.lineage.manifestSha256,recovery.origin.manifestSha256);
  for(const key of ["projectId","runId","apiPort","apiContainerId","databaseContainerId","apiImageId","databaseImageId","networkId","proxy","disposable"])assert.deepEqual(original.target[key],target.identity[key],"Physical C1 target changed");
  const actors=[original.creator,...["operator","reviewer","finance_viewer","foreign","content_editor"].map(role=>original.roles[role])];assert.equal(new Set(actors.map(a=>a.id)).size,6);
  for(const actor of actors)assert(intended.includes(actor.id)&&actor.email?.endsWith("@example.test")&&typeof actor.password==="string","Exact existing synthetic credentials missing");
  assert.equal(recovery.authRenewal.existingSubjects,6);assert.equal(recovery.noNewSubjects,true);assert.equal(recovery.noLegacyReplay,true);
  for(const plan of manifest.fixture.phases){
    const additional=recovery.authRenewal.maxSessionAdds[plan.phase];assert.equal(additional,plan.phase==="role"?1:plan.phase==="browser"?6:0);
    for(const family of ["auth_sessions","auth_refresh_tokens"])
      assert(originInventories[plan.phase][family].count+additional<=manifest.fixture.rowCaps[plan.phase][family],"Insufficient original Auth session budget; no sign-in allowed");
  }
  await import(pathToFileURL(resolve(root,"scripts/audit/deny-external-fetch.mjs")).href);
  const journal=new FixtureJournal(context.privatePath(`transport-browser-session-renewal-${process.pid}.jsonl`,"browser"),context.lineageFor("browser"),{requests:manifest.fixture.transportWriteCapPerProcess});
  const fetch=journalTransportFetch(globalThis.fetch,journal,context.origins),sessions=new Map();
  for(const actor of actors){
    const response=await fetch(target.env.SUPABASE_URL+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:target.env.SUPABASE_ANON_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:actor.email,password:actor.password})});
    if(response.status!==200)throw Error("Existing synthetic session renewal failed; retain exact receipts and stop");
    const session=await response.json();assert.equal(session.user?.id,actor.id);assert(session.access_token&&session.refresh_token);session.expires_at??=Math.floor(Date.now()/1000)+session.expires_in;sessions.set(actor.id,session);
    durableJson(resolve(privateRoot,"session-renewal.private.json"),{lineage:context.lineageFor("browser"),sessions:Object.fromEntries(sessions)});
  }
  journal.assertReady();const authAfter=JSON.parse(target.sql(authQuery)),legacyAfter=JSON.parse(target.sql(legacyQuery));assert.deepEqual(authAfter,authBefore);assert.deepEqual(legacyAfter,legacyBefore);
  assert.deepEqual(JSON.parse(target.sql(originState.query)),financial);
  const inventories={};
  for(const plan of manifest.fixture.phases){
    const now=JSON.parse(target.sql(fixtureInventorySql(manifest.fixture.rowScopes,owned[plan.phase])));assertInventoryCaps(now,manifest.fixture.rowCaps[plan.phase]);
    for(const[family,scope]of Object.entries(manifest.fixture.rowScopes))if(!scope.relation.startsWith("auth."))assert.deepEqual(now[family],originInventories[plan.phase][family],"Non-Auth rows changed during session renewal");inventories[plan.phase]=now;
    const lineage=context.lineageFor(plan.phase),observations=new FixtureJournal(context.privatePath("owned-journal.jsonl",plan.phase),lineage,manifest.fixture.rowCaps[plan.phase]);observations.observe(owned[plan.phase]);observations.assertReady();
    durableJson(context.privatePath("fixture-claim.json",plan.phase),{lineage,state:"adopted-existing-no-reseed",origin:recovery.origin});
    durableJson(context.publicPath("fixture-inventory.json",plan.phase),{lineage,target:target.identity,inventory:now,adoptedExisting:true,newSubjects:0});
  }
  function renew(value){
    if(Array.isArray(value))return value.map(renew);if(!value||typeof value!=="object")return value;
    if(value.access_token&&value.user?.id&&sessions.has(value.user.id))return globalThis.structuredClone(sessions.get(value.user.id));
    const result=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,renew(item)]));
    if(sessions.has(value.id)&&(typeof value.jwt==="string"||value.email&&value.password)){result.jwt=sessions.get(value.id).access_token;result.session=globalThis.structuredClone(sessions.get(value.id));}return result;
  }
  const fixture=renew(original);fixture.lineage=context.lineageFor("browser");fixture.target=target.identity;fixture.legacy=legacy;
  fixture.recovery={origin:recovery.origin,checkpoint,legacy,setupComplete:true};
  const proof={lineage:context.lineageFor("browser"),target:target.identity,origin:recovery.origin,checkpoint,legacy,backendSourceUnchanged:true,inventoryWithinCaps:true,journalsResolved:true,immutableSeedsUnchanged:true,physicalTargetMatched:true,legacyRowsUnchanged:true,authSubjectIdsBefore:authBefore,authSubjectIdsAfter:authAfter,legacyIdsBefore:legacyBefore,legacyIdsAfter:legacyAfter};
  browserContinuation({...context,phase:"browser",lineage:context.lineageFor("browser")},fixture,proof);
  durableJson(context.privatePath("recovery-readback.private.json","browser"),proof);durableJson(context.privatePath("browser-fixture.private.json","browser"),fixture);
  const baseline={...originBaseline,at:new Date().toISOString(),identity:target.identity,lineage:context.lineageFor("role"),adoptedFrom:recovery.references.baseline};
  durableJson(resolve(publicRoot,"immutable-bootstrap-baseline.json"),baseline);
  const receipt=read(local(process.env.ADFOCATE_B2_TARGET_RECEIPT_PATH));receipt.bootstrap.baselinePath=relative(root,resolve(publicRoot,"immutable-bootstrap-baseline.json")).replaceAll("\\","/");receipt.bootstrap.baselineSha256=hash(readFileSync(local(receipt.bootstrap.baselinePath)));durableJson(local(process.env.ADFOCATE_B2_TARGET_RECEIPT_PATH),receipt);
  for(const plan of manifest.fixture.phases.filter(p=>p.phase!=="browser")){
    durableJson(context.publicPath("phase-result.json",plan.phase),{lineage:context.lineageFor(plan.phase),target:target.identity,exitCode:0,signal:null,source:"Fresh read-only source/schema/ownership dependency revalidation; original API tests are carried unchanged, not rerun",reusedApiEvidence:recovery.references.phases[plan.phase].result,originalSourceFingerprint:recovery.origin.sourceFingerprint,originalCaseCount:plan.phase==="role"?8:9,apiCasesRerun:0,at:new Date().toISOString()});
  }
  durableJson(resolve(publicRoot,"browser-recovery-preparation.json"),{at:new Date().toISOString(),origin:recovery.origin,currentSourceFingerprint:manifest.candidate.fingerprint,currentManifestSha256:context.manifestSha256,identity:target.identity,checkpoint,legacy,changedSourcePaths:changed,backendAndApiTestSourcesUnchanged:true,originalSchemaAndSeedsUnchanged:true,authSubjectsBefore:authBefore.length,authSubjectsAfter:authAfter.length,existingSubjectSessionsRenewed:6,newAuthSubjects:0,newWorkspaces:0,newMissions:0,newWorkflows:0,newLegacyIssuance:0,legacyIdsUnchanged:true,originalFailureAndAllOriginalFilesPreserved:true,carriedApiCases:{role:8,core:9,rerun:0},remainingUiMode:"Original five cases, journey continued after verified original cold steps; original finance/role assertions retained",wholeR1Verified:false,providerEnabled:false,releaseHold:true});
  durableJson(resolve(privateRoot,"adoption-complete.private.json"),{lineage:context.lineageFor("browser"),state:"complete",newDomainFixtureRows:0,authenticationRowsMayIncreaseWithinOriginalCaps:true,existingSubjectSessionsRenewed:6});
  process.stdout.write(JSON.stringify({status:"PASS_EXACT_EXISTING_FIXTURE_ADOPTION_AND_DEPENDENCY_REVALIDATION",authSubjects:84,newSubjects:0,newWorkspaces:0,newMissions:0,newWorkflows:0,existingSubjectSessionsRenewed:6,apiCasesCarriedNotRerun:17,legacyReplay:false,fullBrowserAcceptance:"NOT_RUN"})+"\n");
}
