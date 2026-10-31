// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { IntegrationService, connectionDTO, resourceDTO } from "./service.js";
import { MemoryIntegrationRepository } from "./memoryRepo.js";
import { createMockProviders } from "./mockProviders.js";
import { CredentialVault } from "./credentials.js";
import type { ConnectionRecord, IntegrationProvider, ProviderId, ResourceRecord } from "./types.js";
const actor={creatorId:crypto.randomUUID(),workspaceId:crypto.randomUUID()};
const vault = new CredentialVault(new Uint8Array(32).fill(4),"offline-fixture");
describe("offline adapter orchestration", () => {
  it("requires an explicit offline adapter opt-in and refuses network providers even with that opt-in", () => {
    const providers = createMockProviders();
    const offline = {...providers,instagram:{...providers.instagram,mode:"live_pilot",sampleOnly:true}} as Record<ProviderId,IntegrationProvider>;
    expect(()=>new IntegrationService(new MemoryIntegrationRepository(),offline,vault)).toThrow("LIVE_PROVIDER_DISABLED");
    expect(()=>new IntegrationService(new MemoryIntegrationRepository(),offline,vault,()=>new Date(),{offlineAdapters:true})).not.toThrow();
    const network = {...offline,instagram:{...offline.instagram,sampleOnly:false}};
    expect(()=>new IntegrationService(new MemoryIntegrationRepository(),network,vault,()=>new Date(),{offlineAdapters:true})).toThrow("LIVE_PROVIDER_DISABLED");
  });
  it("does not route real protocol adapters through the mock consent callback", async () => {
    const providers=createMockProviders();
    const offline={...providers,instagram:{...providers.instagram,mode:"live_pilot",sampleOnly:true}} as Record<ProviderId,IntegrationProvider>;
    const service=new IntegrationService(new MemoryIntegrationRepository(),offline,vault,()=>new Date(),{offlineAdapters:true});
    await expect(service.beginConnection(actor,"instagram","session","/studio")).rejects.toThrow("OAUTH_REQUIRED");
  });
  it("preserves provenance in safe DTOs and excludes credentials and ownership keys", () => {
    const row={...actor,id:"connection",provider:"instagram",label:"Private",subject:"subject",scopes:[],sampleOnly:false,accessToken:"hidden"} as unknown as ConnectionRecord;
    expect(connectionDTO(row).sampleOnly).toBe(false);
    expect(connectionDTO(row)).not.toHaveProperty("subject");
    expect(connectionDTO(row)).not.toHaveProperty("accessToken");
    const evidence={apiVersion:"fixture",endpoint:"media/insights",measurementPeriod:"lifetime"};
    expect(resourceDTO({...row,evidence} as unknown as ResourceRecord)).toMatchObject({sampleOnly:false,evidence});
  });
  it("uses authenticated request-scoped candidates before storing selected files", async()=>{
    const repo=new MemoryIntegrationRepository(),providers=createMockProviders();
    const base=providers.google_drive;
    const selectedFiles=vi.fn(async(connection,grant,ids:string[])=>Promise.all(ids.map(id=>base.file(connection,grant,id))));
    const drive={...base,mode:"live_pilot" as const,sampleOnly:true,selectedFiles};
    const service=new IntegrationService(repo,{...providers,google_drive:drive},vault,()=>new Date(),{offlineAdapters:true});
    const grant={...await base.authorize("allow",actor,new Date()),scopes:["https://www.googleapis.com/auth/drive.file","openid"]};
    const connection=await service.acceptAuthorizedGrant(actor,"google_drive",grant,0);
    const candidates=await base.files({...actor,id:connection.id,generation:connection.generation,provider:"google_drive"},grant);
    await service.registerSelectedFiles(actor,connection.id,[candidates[0].externalId],crypto.randomUUID());
    expect(selectedFiles).toHaveBeenCalledOnce();
    expect(selectedFiles.mock.calls[0][0]).toMatchObject(actor);
    await expect(service.registerSelectedFiles({...actor,creatorId:crypto.randomUUID()},connection.id,[candidates[0].externalId],crypto.randomUUID())).rejects.toThrow();
    expect(selectedFiles).toHaveBeenCalledOnce();
  });
});
