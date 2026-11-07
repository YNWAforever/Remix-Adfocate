import {PublishProviderError} from "../instagramPublisher.js";
export type PilotAccount=Readonly<{product:"facebook_login";appId:string;accountSubject:string;connectionId:string;grantGeneration:number}>;
export type ProtocolEvidence=Readonly<{version:string;host:string;scopes:readonly string[];identityEvidence:string;labelEvidence:string;revokeEvidence:string;status:"verified"|"unverified";provenance:"fixture"|"provider"}>;
export interface PilotTransport{
 readonly provenance:"fixture";
 request(input:{operation:"create"|"status"|"publish"|"media";account:PilotAccount;payload:Readonly<Record<string,unknown>>}):Promise<unknown>;
}
export const providerId=(v:unknown):v is string=>typeof v==="string"&&/^[1-9][0-9]{0,63}$/.test(v);
export function assertPilotAccount(a:PilotAccount):void{
 if(!a||a.product!=="facebook_login"||!providerId(a.appId)||!providerId(a.accountSubject)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a.connectionId)||!Number.isSafeInteger(a.grantGeneration)||a.grantGeneration<1)throw new PublishProviderError("PUBLISH_TARGET_MISMATCH");
}
export function assertSamePilotAccount(a:PilotAccount,b:PilotAccount):void{
 assertPilotAccount(a);assertPilotAccount(b);
 if((["product","appId","accountSubject","connectionId","grantGeneration"] as const).some(k=>a[k]!==b[k]))throw new PublishProviderError("PUBLISH_TARGET_MISMATCH");
}
/** Verified fixture contract != verified Meta contract. Live construction is deliberately unavailable. */
export function assertPilotProtocol(e:ProtocolEvidence):void{
 if(!e||e.status!=="verified"||e.provenance!=="fixture"||e.host!=="graph.facebook.com"||!/^v[1-9][0-9]*\.0$/.test(e.version)
  ||!Array.isArray(e.scopes)||!["instagram_basic","instagram_content_publish","pages_read_engagement"].every(s=>e.scopes.includes(s))
  ||![e.identityEvidence,e.labelEvidence,e.revokeEvidence].every(v=>typeof v==="string"&&/^fixture:[a-z0-9_-]+$/.test(v)))throw new PublishProviderError("PUBLISH_PROTOCOL_UNVERIFIED");
}
