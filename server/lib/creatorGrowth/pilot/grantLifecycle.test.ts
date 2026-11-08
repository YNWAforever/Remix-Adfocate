// @vitest-environment node
import {expect,it,vi} from "vitest";
import {PilotGrantLifecycle} from "./grantLifecycle.js";
import {MemoryIntegrationRepository} from "../../integrations/memoryRepo.js";
import {connection,credential,connectionId,actor,ws} from "../../../test/integrations-pilot-fixture.js";
const owner={creatorId:actor,workspaceId:ws,sessionHash:"a".repeat(64)};
async function setup(){
 const repo=new MemoryIntegrationRepository();await repo.command(owner,crypto.randomUUID(),"connect",{expectedGeneration:0,connection:connection({provider:"instagram",subject:"123456789",scopes:["instagram_basic","instagram_content_publish","pages_read_engagement"]}),credential});
 const current=await repo.connection(owner,connectionId);
 const resolve=vi.fn(async()=>({product:"facebook_login" as const,appId:"11111",accountSubject:current!.subject,connectionId,grantGeneration:1}));
 return {repo,resolve,service:new PilotGrantLifecycle(repo,resolve)};
}
it("stops the owned grant locally without asserting provider revocation",async()=>{
 const {service}=await setup();const result=await service.stopPilotGrant(owner,connectionId);
 expect(result).toMatchObject({local:"stopped",providerRevocation:"pending"});expect(result.account.grantGeneration).toBeGreaterThan(1);
 expect(JSON.stringify(result)).not.toMatch(/accessToken|refreshToken|ciphertext/);
 const repeated=await service.stopPilotGrant(owner,connectionId);expect(repeated.account.grantGeneration).toBe(result.account.grantGeneration);
});
it("denies wrong owner and product mapping before mutation",async()=>{
 const {service,repo,resolve}=await setup();
 await expect(service.stopPilotGrant({...owner,creatorId:"other"},connectionId)).rejects.toThrow();
 resolve.mockResolvedValueOnce({product:"instagram_login",appId:"11111",accountSubject:"123456789",connectionId,grantGeneration:1} as never);
 await expect(service.stopPilotGrant(owner,connectionId)).rejects.toThrow();
 expect((await repo.connection(owner,connectionId))!.status).not.toBe("revoked");
});
it("does not infer grant identity from equal provider subject",async()=>{
 const {service,repo,resolve}=await setup();resolve.mockResolvedValueOnce(null as never);
 await expect(service.stopPilotGrant(owner,connectionId)).rejects.toThrow();expect((await repo.connection(owner,connectionId))!.status).not.toBe("revoked");
});
