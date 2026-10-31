import { describe, expect, it, vi } from "vitest";
import { createIntegrationTools } from "./tools.js";
import type { IntegrationService } from "./service.js";
describe("private integration tool allowlist",()=>{
  it("rejects writes, arbitrary URLs, owner overrides and sources outside the selected thread",async()=>{
    const service={list:vi.fn(),readSelectedSource:vi.fn()} as unknown as IntegrationService;
    const tools=createIntegrationTools(service,{creatorId:"owner",workspaceId:"workspace"},["selected"]);
    for(const [name,args] of [["publish",{}],["readSelectedDriveSource",{sourceId:"other"}],["readSelectedDriveSource",{sourceId:"selected",creatorId:"intruder"}],["fetch",{url:"https://evil.test"}]] as const) await expect(tools.execute(name,args)).rejects.toThrow();
    expect(service.readSelectedSource).not.toHaveBeenCalled();
  });
  it("returns safe connection states without account labels or subjects",async()=>{
    const service={list:async()=>[{id:"id",provider:"instagram",status:"connected",label:"private@example.test",subject:"private-subject",sampleOnly:true}]} as unknown as IntegrationService;
    const tools=createIntegrationTools(service,{creatorId:"owner",workspaceId:"workspace"},[]);
    expect(JSON.stringify(await tools.execute("listConnections",{}))).not.toMatch(/private@|private-subject/);
  });
});
