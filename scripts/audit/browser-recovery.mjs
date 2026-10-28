// Pure validation only. Runtime authorization, Docker identity and actual readback precede use.
import {isDeepStrictEqual as equal} from "node:util";
import {createHash} from "node:crypto";

const uuid=value=>typeof value==="string"&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const fail=reason=>{throw new Error(`Browser recovery ${reason}`);};
function exactIds(value){
  if(!Array.isArray(value)||!value.length||value.some(id=>!uuid(id))||new Set(value).size!==value.length)fail("exact ID evidence invalid");
  return value.toSorted();
}
export function browserContinuation(context,fixture,proof){
  const recovery=context?.manifest?.execution?.recovery;
  if(!recovery)return null;
  if(recovery.mode!=="resume-owned-browser-draft"||context.phase!=="browser"
    ||!uuid(context.manifest.execution.artifactNamespace)
    ||context.lineage?.executionNamespace!==context.manifest.execution.artifactNamespace
    ||recovery.noNewSubjects!==true||recovery.noLegacyReplay!==true)fail("reviewed continuation scope missing");
  const origin=recovery.origin,checkpoint=recovery.checkpoint,legacy=recovery.legacy;
  if(!origin||!digest(origin.sourceFingerprint)||!digest(origin.manifestSha256)
    ||origin.sourceFingerprint===context.lineage.sourceFingerprint
    ||origin.projectId!==context.lineage.projectId||origin.ownerRunId!==context.lineage.ownerRunId)fail("origin identity/source mismatch");
  if(!checkpoint||![checkpoint.workspaceId,checkpoint.workflowId,checkpoint.submissionId,checkpoint.itemId].every(uuid)
    ||!Number.isInteger(checkpoint.revision)||checkpoint.revision<0||!digest(checkpoint.captionSha256)
    ||checkpoint.state!=="drafting"||checkpoint.itemState!=="drafting"
    ||!legacy||![legacy.submissionId,legacy.creatorId,legacy.missionId].every(uuid))fail("draft or legacy checkpoint invalid");
  if(!fixture?.recovery||fixture.recovery.setupComplete!==true
    ||!equal(fixture.recovery.origin,origin)||!equal(fixture.recovery.checkpoint,checkpoint)||!equal(fixture.recovery.legacy,legacy))fail("complete existing fixture missing");
  if(!proof||!equal(proof.lineage,context.lineage)||!equal(proof.target,fixture.target)
    ||proof.target?.projectId!==origin.projectId||proof.target?.runId!==origin.ownerRunId
    ||!equal(proof.origin,origin)||!equal(proof.checkpoint,checkpoint)||!equal(proof.legacy,legacy))fail("fresh proof target/lineage/checkpoint mismatch");
  for(const key of ["backendSourceUnchanged","inventoryWithinCaps","journalsResolved","immutableSeedsUnchanged","physicalTargetMatched","legacyRowsUnchanged"]){
    if(proof[key]!==true)fail(`fresh ${key} proof missing`);
  }
  if(!equal(exactIds(proof.authSubjectIdsBefore),exactIds(proof.authSubjectIdsAfter))
    ||!equal(exactIds(proof.legacyIdsBefore),exactIds(proof.legacyIdsAfter)))fail("new subjects or legacy issuance detected");
  return {checkpoint,legacy,origin};
}

export function assertUnchangedRecoverySources(before,current,allowedChanges){
  for(const scope of [before,current]){
    if(!scope||!Array.isArray(scope.files)||!scope.files.length||!digest(scope.fingerprint)
      ||createHash("sha256").update(JSON.stringify(scope.files)).digest("hex")!==scope.fingerprint
      ||new Set(scope.files.map(f=>f.path)).size!==scope.files.length
      ||scope.files.some(f=>typeof f.path!=="string"||!digest(f.sha256)))fail("source fingerprint evidence invalid");
  }
  const old=new Map(before.files.map(f=>[f.path,f.sha256])),next=new Map(current.files.map(f=>[f.path,f.sha256]));
  const changed=[...new Set([...old.keys(),...next.keys()])].filter(path=>old.get(path)!==next.get(path)).toSorted();
  const retainedCases=new Set(["server/test/audit-staff-capabilities.test.ts","server/test/audit-workflow-roundtrip.test.ts","server/test/auditWorkflowFixture.ts"]);
  if(changed.some(path=>path.startsWith("api/")||path.startsWith("supabase/")
    ||path.startsWith("server/")&&!path.startsWith("server/test/")||retainedCases.has(path)))fail("backend/API evidence cannot be reused after a backend source change");
  if(changed.some(path=>path.startsWith("src/")&&!/\.test\.[tj]sx?$/.test(path)
    &&path!=="src/components/active-mission/DraftEditor.tsx"))fail("application source outside the reviewed editor changed");
  if(!Array.isArray(allowedChanges)||new Set(allowedChanges).size!==allowedChanges.length
    ||!equal(changed,allowedChanges.toSorted()))fail("source changes differ from the exact reviewed list");
  return changed;
}
