// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { inspectOfflinePilot } from "../../scripts/integrations/pilot-preflight.js";
import { createOfflineAdapters } from "../lib/integrations/offlineAdapters.js";
import { integrationMode } from "../lib/integrations/policy.js";

/** Guard tests only. A real pilot runner is deliberately unavailable before D1/D2 approval. */
describe("live-pilot entry remains unavailable in D0",()=>{
 it("cannot opt into external access by flags or matching local target receipts",()=>{
  const target={environmentId:"isolated",projectRef:"isolated-project",origin:"https://pilot.invalid",sourceSha:"a".repeat(40),schemaDigest:"b".repeat(64)};
  const actor={creatorId:"allowlisted",workspaceId:"workspace"};
  expect(inspectOfflinePilot({expected:target,observed:target,productionProjects:["production"],creators:[actor],expectedCreators:[actor],fixtures:["owned"],expectedFixtures:["owned"]})).toMatchObject({offlineContractMatches:true,externalAccess:false,liveTests:"NOT_RUN"});
  expect(integrationMode({NODE_ENV:"production",INTEGRATIONS_MODE:"live_pilot",INSTAGRAM_CONNECTIONS_ENABLED:"true",DRIVE_CONNECTIONS_ENABLED:"true"})).toBe("disabled");
 });
 it("rejects a live transport before touching either provider",()=>{
  const json=vi.fn(),bytes=vi.fn();
  expect(()=>createOfflineAdapters({http:{transportKind:"live",json,bytes}} as unknown as Parameters<typeof createOfflineAdapters>[0])).toThrow("LIVE_PROVIDER_DISABLED");
  expect(json).not.toHaveBeenCalled();expect(bytes).not.toHaveBeenCalled();
 });
});
