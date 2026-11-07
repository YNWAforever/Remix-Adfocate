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
  it("rejects known product DB receipts even if the caller omits its production denylist", () => {
    const target = {environmentId:"pilot",projectRef:"mhkoayftiuojxlrkollf",origin:"https://pilot.example",sourceSha:"a".repeat(40),schemaDigest:"b".repeat(64)};
    expect(inspectPilotTarget(target,target,[]).matches).toBe(false);
  });
  it.each(["adfocate-2", "adfocate-site", "prj_tBHX5vuMvZ4dEbQJpzhkM3VRJd0g", "prj_xHgVQRoZheStpNLVAUMZvq2p9R11"])("rejects known product hosting %s in an otherwise matching receipt", environmentId => {
    const target = { environmentId, projectRef: "disposable", origin: "https://pilot.example", sourceSha: "a".repeat(40), schemaDigest: "b".repeat(64) };
    expect(inspectPilotTarget(target, target, []).matches).toBe(false);
  });
  it.each(["https://adfocate-2.vercel.app", "https://adfocate-site.vercel.app"])("rejects product origin %s despite isolated-looking IDs", origin => {
    const target = { environmentId: "pilot", projectRef: "disposable", origin, sourceSha: "a".repeat(40), schemaDigest: "b".repeat(64) };
    expect(inspectPilotTarget(target, target, []).matches).toBe(false);
  });
});
