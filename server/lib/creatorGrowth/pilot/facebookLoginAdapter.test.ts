// @vitest-environment node
import {expect,it,vi} from "vitest";
import {FacebookLoginPilotAdapter} from "./facebookLoginAdapter.js";
import type {PilotAccount,ProtocolEvidence,PilotTransport} from "./protocol.js";
const account:PilotAccount={product:"facebook_login",appId:"11111",accountSubject:"22222",connectionId:"00000000-0000-4000-8000-000000000001",grantGeneration:1};
const evidence:ProtocolEvidence={version:"v99.0",host:"graph.facebook.com",scopes:["instagram_basic","instagram_content_publish","pages_read_engagement"],identityEvidence:"fixture:identity",labelEvidence:"fixture:label",revokeEvidence:"fixture:revoke",status:"verified",provenance:"fixture"};
const input={intentId:"00000000-0000-4000-8000-000000000002",target:account,imageSha256:"a".repeat(64),caption:"Tea #合作",mediaHandle:"fixture-lease:approved-jpeg",sponsorIds:["33333"],isPaidPartnership:true as const};
function setup(){const request=vi.fn<PilotTransport["request"]>();return {request,adapter:new FacebookLoginPilotAdapter(account,evidence,{provenance:"fixture",request})};}
it("projects fixture provenance and rejects identity substitution before transport",async()=>{
 const {request,adapter}=setup();request.mockResolvedValue({id:"44444",provenance:"provider"});
 await expect(adapter.createImageContainer(input)).resolves.toEqual({containerId:"44444",sampleOnly:true,provenance:"fixture"});
 expect(request.mock.calls[0][0]).toMatchObject({operation:"create",account,payload:{is_paid_partnership:true,branded_content_sponsor_ids:["33333"]}});
 await expect(adapter.getContainerStatus({...account,appId:"99999"},"44444")).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
});
it("rejects unsupported disclosure and unleased assets without a call",async()=>{
 const {request,adapter}=setup();
 for(const patch of [{isPaidPartnership:false},{sponsorIds:[]},{sponsorIds:[account.accountSubject]},{mediaHandle:"https://private.invalid/image"}])await expect(adapter.createImageContainer({...input,...patch} as typeof input)).rejects.toThrow();
 expect(request).not.toHaveBeenCalled();
});
it("rejects hash strings with extra bytes before any transport",async()=>{
 const s=setup();s.request.mockResolvedValue({id:"44444"});
 await expect(s.adapter.createImageContainer({...input,imageSha256:`prefix${input.imageSha256}`})).rejects.toThrow();
 expect(s.request).not.toHaveBeenCalled();
});
it("does not infer published from container FINISHED or retry an ambiguous publish",async()=>{
 const {request,adapter}=setup();request.mockResolvedValueOnce({id:"44444"});await adapter.createImageContainer(input);
 request.mockResolvedValueOnce({status_code:"FINISHED"});expect((await adapter.getContainerStatus(account,"44444")).state).toBe("ready");
 request.mockRejectedValueOnce(new Error("Bearer SECRET"));await expect(adapter.publishContainer(account,"44444")).rejects.toThrow("PUBLISH_OUTCOME_UNKNOWN");
 await expect(adapter.publishContainer(account,"44444")).rejects.toThrow("PUBLISH_ALREADY_REQUESTED");expect(request).toHaveBeenCalledTimes(3);
});
it("rejects wrong media owner and unsafe permalink",async()=>{
 const {request,adapter}=setup();
 for(const response of [{id:"55555",owner:{id:"99999"},permalink:"https://www.instagram.com/p/example/"},{id:"55555",owner:{id:account.accountSubject},permalink:"https://www.instagram.com.evil.invalid/p/a/"},{id:"55555",owner:{id:account.accountSubject},permalink:"https://www.instagram.com/p/a/?token=secret"}]){
 request.mockResolvedValueOnce(response);await expect(adapter.getPublishedMedia(account,"55555")).rejects.toThrow();}
});
it("ignores extra credential fields in responses and sanitizes transport errors",async()=>{
 const {request,adapter}=setup();request.mockResolvedValueOnce({id:"55555",owner:{id:account.accountSubject},permalink:"https://www.instagram.com/p/example/",access_token:"SECRET"});
 expect(JSON.stringify(await adapter.getPublishedMedia(account,"55555"))).not.toContain("SECRET");
 request.mockRejectedValueOnce(new Error("Bearer SECRET"));await expect(adapter.getContainerStatus(account,"44444")).rejects.toThrow("PUBLISH_OUTCOME_UNKNOWN");
});
