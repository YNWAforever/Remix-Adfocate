// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationService } from "./service.js";
import { MemoryIntegrationRepository } from "./memoryRepo.js";
import { createMockProviders } from "./mockProviders.js";
import { CredentialVault } from "./credentials.js";
import { buildSharedCaption } from "../../../src/lib/studio/policy.js";
import type { StudioSource } from "../../../src/lib/studio/types.js";
const actor={creatorId:"00000000-0000-4000-8000-000000000011",workspaceId:"00000000-0000-4000-8000-000000000001"};
let now:Date,service:IntegrationService,repo:MemoryIntegrationRepository,providers:ReturnType<typeof createMockProviders>,connectionId:string,resourceId:string;
beforeEach(async()=>{
  now=new Date("2026-10-31T10:00:00Z");repo=new MemoryIntegrationRepository(()=>now);providers=createMockProviders();service=new IntegrationService(repo,providers,new CredentialVault(new Uint8Array(32).fill(7),"test"),()=>now);
  const start=await service.beginConnection(actor,"google_drive","session","/connections");connectionId=(await service.completeConnection(actor,"google_drive","session","allow",start.state)).id;
  resourceId=(await service.registerSelectedFiles(actor,connectionId,["mock-owned-brief"],crypto.randomUUID())).resources[0].id;
});
async function imported(modelConsent=false,shareRights=false) {const result=await service.importSources(actor,connectionId,{threadId:"thread-one",revision:0,resourceIds:[resourceId],question:"觀眾最想知道甚麼？",modelConsent,processingRights:modelConsent,shareRights,requestId:crypto.randomUUID()});return (result.sources as StudioSource[])[0];}
describe("provider source permission and evidence lineage",()=>{
  it("does not authorize another owner's source by silently returning an empty permit list",async()=>{
    const source=await imported(true,true);
    await expect(service.authorizeSources({...actor,creatorId:"00000000-0000-4000-8000-000000000012"},[source.id],"model")).rejects.toThrow("NOT_FOUND");
  });
  it("keeps imported sources private, unknown coverage and no AI consent by default",async()=>{
    const source=await imported();expect(source.kind).toBe("private");expect(source.shareable).toBe(false);expect(source.region).toBeNull();
    await expect(service.authorizeSources(actor,[source.id],"model")).rejects.toThrow("MODEL_CONSENT_REQUIRED");
    await expect(service.authorizeSources(actor,[source.id],"share",{})).rejects.toThrow("SOURCE_PRIVATE");
  });
  it("requires fresh rights and binds a one-use permit to the entire transfer payload",async()=>{
    const source=await imported(true,true), payload={threadId:"thread-one",briefId:"brief-one",sectionIds:["one"],submissionId:"mission-one"};
    await service.authorizeSources(actor,[source.id],"share",payload);
    expect(()=>repo.consumePermits(actor,[source.id],"share",{...payload,submissionId:"mission-two"})).toThrow("SOURCE_PERMISSION_REQUIRED");
    repo.consumePermits(actor,[source.id],"share",payload);
    expect(()=>repo.consumePermits(actor,[source.id],"share",payload)).toThrow("SOURCE_PERMISSION_REQUIRED");
    await service.authorizeSources(actor,[source.id],"share",payload);now=new Date(now.getTime()+60001);
    expect(()=>repo.consumePermits(actor,[source.id],"share",payload)).toThrow("SOURCE_PERMISSION_REQUIRED");
  });
  it("rejects file version/ACL changes between selection, AI, save and share",async()=>{
    const source=await imported(true,true), original=providers.google_drive.file.bind(providers.google_drive);
    vi.spyOn(providers.google_drive,"file").mockImplementation(async(...args)=>({...await original(...args),version:"new-version"}));
    for(const use of ["model","save_brief","share"] as const) await expect(service.authorizeSources(actor,[source.id],use,{})).rejects.toThrow("SOURCE_CHANGED");
    vi.mocked(providers.google_drive.file).mockRejectedValue(new Error("403 provider-private-details"));
    await expect(service.authorizeSources(actor,[source.id],"model")).rejects.toThrow();
  });
  it("cannot use a third-party file for AI or claim its sharing rights just by checking a box",async()=>{
    const selected=await service.registerSelectedFiles(actor,connectionId,["mock-private-research"],crypto.randomUUID());
    const resource=selected.resources.find(value=>value.externalId==="mock-private-research")!;
    await expect(service.importSources(actor,connectionId,{threadId:"thread-one",revision:0,resourceIds:[resource.id],question:"來源",modelConsent:true,processingRights:true,shareRights:true,requestId:crypto.randomUUID()})).rejects.toThrow("SOURCE_PRIVATE");
  });
  it("keeps sample labels and actual unknown coverage in the canonical caption",async()=>{
    const source=await imported(true,true);const caption=buildSharedCaption([{id:"one",text:"拍攝方向",sourceIds:[source.id]}],[source],["one"]);
    expect(caption).toContain("模擬");expect(caption).toContain("地區／語言未驗證");expect(caption).not.toContain("HK / 繁中");
  });
  it("revokes saved source use and purge clears private cached derivatives",async()=>{
    const source=await imported(true,true);await service.revokeConnection(actor,connectionId,crypto.randomUUID());
    await expect(service.authorizeSources(actor,[source.id],"model")).rejects.toThrow("SOURCE_UNAVAILABLE");
    await service.purgeConnection(actor,connectionId,crypto.randomUUID());const exported=await service.exportData(actor);
    expect(exported.sources).toEqual([]);expect(exported.resources).toEqual([]);expect(JSON.stringify(exported)).not.toContain(source.content);
  });
});
