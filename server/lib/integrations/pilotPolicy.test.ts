import { describe, expect, it } from "vitest";
import { inspectPilotTarget, pilotReadiness } from "./pilotPolicy.js";
import { integrationMode } from "./policy.js";

describe("D0 external access boundary", () => {
  it("never turns a live environment flag into approval or a provider connection", () => {
    const env = {INTEGRATIONS_MODE:"live_pilot",INTEGRATIONS_ENABLED:"true",PILOT_APPROVED:"true"};
    expect(integrationMode(env)).toBe("disabled");
    expect(pilotReadiness()).toEqual({stage:"D0",externalAccess:false,reason:"PILOT_APPROVAL_REQUIRED"});
  });
  it("compares complete target receipts without claiming that a comparison grants access", () => {
    const target = {environmentId:"pilot",projectRef:"disposable",origin:"https://pilot.example",sourceSha:"a".repeat(40),schemaDigest:"b".repeat(64)};
    expect(inspectPilotTarget(target,target,["production"])).toEqual({matches:true,externalAccess:false,reason:"PILOT_APPROVAL_REQUIRED"});
    for (const actual of [{...target,projectRef:"production"},{...target,origin:"https://production.example"},{...target,schemaDigest:"c".repeat(64)}]) {
      expect(inspectPilotTarget(target,actual,["production"]).matches).toBe(false);
    }
    expect(inspectPilotTarget(target,{...target,origin:"http://127.0.0.1:9999"},[]).matches).toBe(false);
  });
});
