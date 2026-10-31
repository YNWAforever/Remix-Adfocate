// @vitest-environment node
import { describe, expect, it } from "vitest";
import { inspectOfflinePilot } from "./pilot-preflight.js";

const target = {environmentId:"isolated-test",projectRef:"pilot-project",origin:"https://pilot.invalid",sourceSha:"a".repeat(40),schemaDigest:"b".repeat(64)};
const input = {expected:target,observed:target,productionProjects:["production"],creators:[{creatorId:"c1",workspaceId:"w1"}],fixtures:["ig-owned","drive-owned"],expectedCreators:[{creatorId:"c1",workspaceId:"w1"}],expectedFixtures:["ig-owned","drive-owned"]};
describe("D0 offline preflight",()=>{
 it("compares complete local receipts but never authorizes a live connection",()=>{
  expect(inspectOfflinePilot(input)).toMatchObject({stage:"D0",offlineContractMatches:true,externalAccess:false,liveTests:"NOT_RUN",reason:"PILOT_APPROVAL_REQUIRED"});
 });
 it("fails closed on target, source, actor and fixture mismatch",()=>{
  for(const changes of [{observed:{...target,sourceSha:"c".repeat(40)}},{creators:[{creatorId:"other",workspaceId:"w1"}]},{fixtures:["unapproved"]},{creators:[]},{expected:{...target,projectRef:"production"},observed:{...target,projectRef:"production"}}]) {
   expect(inspectOfflinePilot({...input,...changes}).offlineContractMatches).toBe(false);
  }
 });
 it("does not expose receipt identities or accept duplicate allowlist rows",()=>{
  expect(JSON.stringify(inspectOfflinePilot(input))).not.toContain("c1");
  expect(inspectOfflinePilot({...input,creators:[...input.creators,...input.creators]}).offlineContractMatches).toBe(false);
 });
});
