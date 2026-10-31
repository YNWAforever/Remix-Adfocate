// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationService } from "../lib/integrations/service.js";
import { MemoryIntegrationRepository } from "../lib/integrations/memoryRepo.js";
import { CredentialVault } from "../lib/integrations/credentials.js";
import { createMockProviders } from "../lib/integrations/mockProviders.js";
const actor={creatorId:"00000000-0000-4000-8000-000000000011",workspaceId:"00000000-0000-4000-8000-000000000001"};
let clock:Date,repo:MemoryIntegrationRepository,providers:ReturnType<typeof createMockProviders>,service:IntegrationService,id:string;
beforeEach(async()=>{clock=new Date("2026-10-31T10:00:00Z");repo=new MemoryIntegrationRepository(()=>clock);providers=createMockProviders();service=new IntegrationService(repo,providers,new CredentialVault(new Uint8Array(32).fill(3),"test"),()=>clock);const state=await service.beginConnection(actor,"google_drive","session","/connections");id=(await service.completeConnection(actor,"google_drive","session","allow",state.state)).id;});
describe("mock privacy retention and cleanup",()=>{
  it("expires unused snapshots after thirty days, without deleting saved evidence",async()=>{
    const selected=await service.registerSelectedFiles(actor,id,["mock-owned-brief","mock-shot-list"],crypto.randomUUID());
    await service.importSources(actor,id,{threadId:"thread",revision:0,resourceIds:[selected.resources[0].id],question:"test",modelConsent:false,processingRights:false,shareRights:false,requestId:crypto.randomUUID()});
    clock=new Date(clock.getTime()+31*86400000);expect(await service.expireData(actor)).toMatchObject({purged:1});
    const exported=await service.exportData(actor);expect(exported.sources).toHaveLength(1);expect(exported.resources).toHaveLength(1);
  });
  it("expires a failed platform revocation after twenty-four hours without claiming remote success",async()=>{
    vi.spyOn(providers.google_drive,"revoke").mockRejectedValue(new Error("offline"));
    await service.revokeConnection(actor,id,crypto.randomUUID());clock=new Date(clock.getTime()+24*3600000+1);
    await service.expireData(actor);expect((await service.list(actor))[0].providerRevocation).toBe("manual_action");
    expect(JSON.stringify(await service.exportData(actor))).not.toMatch(/ciphertext|refreshToken|accessToken/);
  });
  it("purging after a provider outage reports that revocation needs manual action",async()=>{
    vi.spyOn(providers.google_drive,"revoke").mockRejectedValue(new Error("offline"));
    await service.revokeConnection(actor,id,crypto.randomUUID());expect(await service.purgeConnection(actor,id,crypto.randomUUID())).toEqual({state:"complete"});
    expect((await service.list(actor))[0].providerRevocation).toBe("manual_action");
    await expect(service.picker(actor,id)).rejects.toThrow("STALE_CONNECTION");
  });
});
