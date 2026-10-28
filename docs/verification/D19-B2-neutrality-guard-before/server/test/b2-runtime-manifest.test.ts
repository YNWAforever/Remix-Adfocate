import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read=(p:string)=>JSON.parse(readFileSync(p,"utf8"));
describe("B2 reviewable runtime manifest is explicit authority, not P0 permission",()=>{
 it("requires a separate unapproved digest-bound runtime receipt and keeps original incident/release/provider states",()=>{
  const m=read("docs/verification/D19-B2-runtime-manifest.json"),a=read("docs/verification/D19-B2-runtime-authorization-template.json");
  expect(m.kind).toBe("D19_B2_EXECUTION_SPEC");expect(m.specificationReady).toBe(true);expect(a.approved).toBe(false);
  expect(a.manifestSha256).toBe(createHash("sha256").update(readFileSync("docs/verification/D19-B2-runtime-manifest.json")).digest("hex"));
  expect(m.invariants).toMatchObject({incidentOpen:true,restored:false,releaseHold:true,providerEnabled:false,wholeR1Verified:false,D15ContentBlocked:true,advisorOwnerDeviceHostedStaffBlocked:true});
 });
 it("separates bounded fixture additions from migration seeds and the adopted historical checkpoint",()=>{
  const m=read("docs/verification/D19-B2-runtime-manifest.json"),caps=m.fixture.rowCaps;
  expect(caps.role.auth_users+caps.core.auth_users+caps.browser.auth_users).toBe(84);
  expect(caps.role.workspaces+caps.core.workspaces+caps.browser.workspaces).toBe(6);
  expect(caps.role.mission_submissions+caps.core.mission_submissions+caps.browser.mission_submissions).toBe(7);
  expect(m.fixture.phases.find((p:{phase:string})=>p.phase==="core").plannedQueueCreatorIds).toContain(m.bootstrap.historicalLegacy.creatorId);
  expect(m.bootstrap.historicalLegacy.countedWithinCoreCaps).toBe(true);
  for(const phase of ["role","core","browser"]){expect(caps[phase].academy_lessons).toBe(0);expect(caps[phase].mission_draft_assets).toBe(0);expect(caps[phase].storage_objects).toBe(0);}
 });
 it("binds current source and bootstrap profile without reusing pristine/global RPC acceptance",()=>{
  const m=read("docs/verification/D19-B2-runtime-manifest.json"),fp=read("docs/verification/code-fingerprint.json"),profile=read("docs/verification/D19-B2-bootstrap-profile.json");
  expect(m.candidate.fingerprint).toBe(fp.fingerprint);expect(m.bootstrap.profileDigest).toBe(profile.profileDigest);expect(profile.migrations).toHaveLength(72);
  expect(m.execution.pristineRpcRerun).toBe(false);expect(m.fixture.legacyExistingIssuanceRequiresExplicitRuntimeApproval.approvalXpDelta).toBe(100);
  expect(m.execution.commands).toHaveLength(3);
 });
});
