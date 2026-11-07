// @vitest-environment node
import {expect,it} from "vitest";
import {assertPilotProtocol,assertSamePilotAccount,type PilotAccount,type ProtocolEvidence} from "./protocol.js";
it("rejects nonhex connection identifiers even when identical",()=>{
 const bad={...account,connectionId:"zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz"};
 expect(()=>assertSamePilotAccount(bad,bad)).toThrow();
});
export const account: PilotAccount={product:"facebook_login",appId:"11111",accountSubject:"22222",connectionId:"00000000-0000-4000-8000-000000000001",grantGeneration:1};
export const evidence:ProtocolEvidence={version:"v99.0",host:"graph.facebook.com",scopes:["instagram_basic","instagram_content_publish","pages_read_engagement"],identityEvidence:"fixture:identity",labelEvidence:"fixture:label",revokeEvidence:"fixture:revoke",status:"verified",provenance:"fixture"};
it("binds product app subject connection and generation",()=>{
 expect(()=>assertSamePilotAccount(account,{...account})).not.toThrow();
 for(const key of Object.keys(account))expect(()=>assertSamePilotAccount(account,{...account,[key]:key==="grantGeneration"?2:"other"} as PilotAccount)).toThrow();
});
it("requires pinned protocol and permissions without accepting Instagram Login",()=>{
 expect(()=>assertPilotProtocol(evidence)).not.toThrow();
 for(const patch of [{status:"unverified"},{host:"graph.instagram.com"},{version:"latest"},{scopes:["instagram_business_content_publish"]},{revokeEvidence:""},{labelEvidence:""},{provenance:"provider"}])expect(()=>assertPilotProtocol({...evidence,...patch} as ProtocolEvidence)).toThrow();
});
