import {PublishProviderError,type ImageContainerInput} from "../instagramPublisher.js";
import {assertSamePilotAccount,assertPilotAccount,providerId,type PilotAccount,type PilotTransport} from "./protocol.js";
type CreateInput=Omit<ImageContainerInput,"target">&{target:PilotAccount;sponsorIds:readonly string[];isPaidPartnership:true};
const sample={sampleOnly:false,provenance:"provider"} as const;
const unknown=()=>new PublishProviderError("PUBLISH_OUTCOME_UNKNOWN","unknown");
/** Native contract through an injected wire; never registered by default. Protocol verification is a trusted server gate, not browser data. Durable worker checkpoints fence retries across instances. */
export class NativePilotPublisher{
 readonly mode="pilot_native" as const;
 private readonly account:PilotAccount;

 private readonly requested=new Set<string>();
 private readonly ready=new Set<string>();
 constructor(account:PilotAccount,private readonly transport:Pick<PilotTransport,"request">,private readonly verifyProtocol:()=>Promise<boolean>){assertPilotAccount(account);this.account=Object.freeze({...account});}
 private async request(operation:Parameters<PilotTransport["request"]>[0]["operation"],target:PilotAccount,payload:Record<string,unknown>){
  assertSamePilotAccount(this.account,target);
  try{
   if(!await this.verifyProtocol())throw new Error("PUBLISH_PROTOCOL_UNVERIFIED");
   const result=await this.transport.request({operation,account:{...this.account},payload});
   if(!result||typeof result!=="object"||Array.isArray(result)||"error" in result)throw unknown();
   return result as Record<string,unknown>;
  }catch{throw unknown();}
 }
 async createImageContainer(input:CreateInput){
  assertSamePilotAccount(this.account,input.target);
  if(input.isPaidPartnership!==true||!Array.isArray(input.sponsorIds)||input.sponsorIds.length<1||input.sponsorIds.length>2
   ||new Set(input.sponsorIds).size!==input.sponsorIds.length||!input.sponsorIds.every(id=>providerId(id)&&id!==this.account.accountSubject)
   ||!/^https:\/\//.test(input.mediaHandle)||!input.caption?.trim()||[...input.caption].length>2200||!/^[a-f0-9]{64}$/.test(input.imageSha256))throw new PublishProviderError("PUBLISH_INVALID_INPUT");
  const r=await this.request("create",input.target,{caption:input.caption,image_url:input.mediaHandle,is_paid_partnership:true,branded_content_sponsor_ids:[...input.sponsorIds]});
  if(!providerId(r.id))throw unknown();return {containerId:r.id,...sample};
 }
 async getContainerStatus(target:PilotAccount,containerId:string){
  if(!providerId(containerId))throw new PublishProviderError("PUBLISH_INVALID_INPUT");
  const r=await this.request("status",target,{container_id:containerId});
  const state=r.status_code==="FINISHED"?"ready":r.status_code==="IN_PROGRESS"?"processing":["ERROR","EXPIRED"].includes(String(r.status_code))?"failed":"unknown";
  if(state==="ready")this.ready.add(containerId);else this.ready.delete(containerId);
  return {state,...sample};
 }
 async publishContainer(target:PilotAccount,containerId:string){
  assertSamePilotAccount(this.account,target);
  if(this.requested.has(containerId))throw new PublishProviderError("PUBLISH_ALREADY_REQUESTED");
  if(!this.ready.has(containerId))throw new PublishProviderError("PUBLISH_CONTAINER_NOT_READY");
  this.requested.add(containerId);
  const r=await this.request("publish",target,{creation_id:containerId});
  if(!providerId(r.id))throw unknown();return {mediaId:r.id,...sample};
 }
 async getPublishedMedia(target:PilotAccount,mediaId:string){
  if(!providerId(mediaId))throw new PublishProviderError("PUBLISH_INVALID_INPUT");
  const r=await this.request("media",target,{media_id:mediaId});
  const owner=r.owner as {id?:unknown}|null;
  if(r.id!==mediaId||owner?.id!==this.account.accountSubject||typeof r.permalink!=="string"||!/^https:\/\/www\.instagram\.com\/p\/[a-zA-Z0-9_-]+\/$/.test(r.permalink))throw unknown();
  return {mediaId,accountSubject:this.account.accountSubject,permalink:r.permalink,...sample};
 }
}
