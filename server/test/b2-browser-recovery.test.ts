import {describe,expect,it} from "vitest";
import {createHash} from "node:crypto";
// @ts-expect-error Existing native audit helpers are ESM without declarations.
import {browserContinuation,assertUnchangedRecoverySources} from "../../scripts/audit/browser-recovery.mjs";

const uuid=(n:string)=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
function scenario(){
 const identity={projectId:"adfocate-d19-b2-unit",runId:uuid("1"),apiContainerId:"1".repeat(64),databaseContainerId:"2".repeat(64),networkId:"3".repeat(64),ownerAuthorization:"Unit fixture only; no runtime authority"};
 const origin={projectId:identity.projectId,ownerRunId:identity.runId,sourceFingerprint:"a".repeat(64),manifestSha256:"b".repeat(64)};
 const checkpoint={workspaceId:uuid("2"),workflowId:uuid("3"),submissionId:uuid("4"),itemId:uuid("5"),revision:0,captionSha256:"e".repeat(64),state:"drafting",itemState:"drafting"};
 const legacy={submissionId:uuid("6"),creatorId:uuid("7"),missionId:uuid("8")};
 const lineage={...origin,sourceFingerprint:"c".repeat(64),manifestSha256:"d".repeat(64),phase:"browser",namespace:uuid("9"),executionNamespace:uuid("a")};
 const recovery={mode:"resume-owned-browser-draft",origin,checkpoint,legacy,noNewSubjects:true,noLegacyReplay:true};
 const context={phase:"browser",lineage,manifest:{execution:{artifactNamespace:lineage.executionNamespace,recovery}}};
 const fixture={target:identity,recovery:{origin,checkpoint,legacy,setupComplete:true}};
 const proof={lineage,target:identity,origin,checkpoint,legacy,backendSourceUnchanged:true,inventoryWithinCaps:true,journalsResolved:true,immutableSeedsUnchanged:true,physicalTargetMatched:true,legacyRowsUnchanged:true,authSubjectIdsBefore:[uuid("7")],authSubjectIdsAfter:[uuid("7")],legacyIdsBefore:[uuid("6")],legacyIdsAfter:[uuid("6")]};
 return {context,fixture,proof,checkpoint,legacy};
}
describe("explicit browser continuation without replaying existing issuance",()=>{
 it("keeps the original cold journey when no reviewed continuation is selected",()=>{
  expect(browserContinuation({manifest:{execution:{}}},{},{})).toBeNull();
 });
 it("returns only the exact joined draft and issued legacy frame after complete revalidation",()=>{
  const h=scenario();expect(browserContinuation(h.context,h.fixture,h.proof)).toEqual({checkpoint:h.checkpoint,legacy:h.legacy,origin:h.context.manifest.execution.recovery.origin});
 });
 it.each([
  ["wrong source",(h:ReturnType<typeof scenario>)=>{h.proof.lineage={...h.proof.lineage,sourceFingerprint:"f".repeat(64)};}],
  ["wrong target",(h:ReturnType<typeof scenario>)=>{h.proof.target={...h.proof.target,projectId:"old-shaped"};}],
  ["changed draft",(h:ReturnType<typeof scenario>)=>{h.proof.checkpoint={...h.proof.checkpoint,revision:1};}],
  ["missing fixture",(h:ReturnType<typeof scenario>)=>{h.fixture.recovery.setupComplete=false;}],
  ["unresolved journal",(h:ReturnType<typeof scenario>)=>{h.proof.journalsResolved=false;}],
  ["changed seed",(h:ReturnType<typeof scenario>)=>{h.proof.immutableSeedsUnchanged=false;}],
  ["changed backend",(h:ReturnType<typeof scenario>)=>{h.proof.backendSourceUnchanged=false;}],
  ["extra Auth subject",(h:ReturnType<typeof scenario>)=>{h.proof.authSubjectIdsAfter.push(uuid("b"));}],
  ["extra legacy issuance",(h:ReturnType<typeof scenario>)=>{h.proof.legacyIdsAfter.push(uuid("b"));}],
 ])("refuses %s instead of reseeding or silently narrowing acceptance",(_name,alter)=>{
  const h=scenario();alter(h);expect(()=>browserContinuation(h.context,h.fixture,h.proof)).toThrow(/recovery/i);
 });
});
const source=(files:Array<{path:string;sha256:string}>)=>({files,fingerprint:createHash("sha256").update(JSON.stringify(files)).digest("hex")});
describe("unchanged backend evidence reuse",()=>{
 const old=[{path:"server/routes/missions.ts",sha256:"1".repeat(64)},{path:"src/components/active-mission/DraftEditor.tsx",sha256:"2".repeat(64)}];
 it("identifies only the explicitly reviewed UI change",()=>{
  const next=[old[0],{...old[1],sha256:"3".repeat(64)}];expect(assertUnchangedRecoverySources(source(old),source(next),[old[1].path])).toEqual([old[1].path]);
 });
 it("rejects a backend change even if a caller includes it in an allow list",()=>{
  const next=[{...old[0],sha256:"3".repeat(64)},old[1]];expect(()=>assertUnchangedRecoverySources(source(old),source(next),[old[0].path])).toThrow(/backend/i);
 });
 it("rejects an unlisted source change",()=>{
  const next=[old[0],{...old[1],sha256:"3".repeat(64)}];expect(()=>assertUnchangedRecoverySources(source(old),source(next),[])).toThrow(/source/i);
 });
});
