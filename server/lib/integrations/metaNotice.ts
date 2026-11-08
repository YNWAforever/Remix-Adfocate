import { digest } from "./credentials.js";
import { IntegrationError } from "./policy.js";
const invalid=():never=>{throw new IntegrationError("PROVIDER_NOTICE_INVALID",403);};
const decode=(value:string)=>{
 if(!/^[A-Za-z0-9_-]+$/.test(value))return invalid();
 return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=")),char=>char.charCodeAt(0));
};
/** Meta signed_request is app-scoped; it is NOT automatically an Instagram account ID. */
export async function verifyMetaNotice(signedRequest:string,appSecret:string,now=new Date()){
 try{
  if(!appSecret||typeof signedRequest!=="string"||signedRequest.length>8192)return invalid();
  const parts=signedRequest.split(".");if(parts.length!==2)return invalid();
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(appSecret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  if(!await crypto.subtle.verify("HMAC",key,decode(parts[0]),new TextEncoder().encode(parts[1])))return invalid();
  const data:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decode(parts[1])));
  if(!data||typeof data!=="object"||Array.isArray(data))return invalid();
  const value=data as Record<string,unknown>,seconds=now.getTime()/1000;
  if(value.algorithm!=="HMAC-SHA256"||typeof value.user_id!=="string"||!/^\d{1,255}$/.test(value.user_id)
    ||typeof value.issued_at!=="number"||!Number.isSafeInteger(value.issued_at)||value.issued_at>seconds+60||value.issued_at<seconds-86400
    ||(value.expires!==undefined&&(typeof value.expires!=="number"||!Number.isFinite(value.expires)||(value.expires!==0&&value.expires<=seconds))))return invalid();
  return {appScopedUserId:value.user_id,issuedAt:value.issued_at};
 }catch{return invalid();}
}
export type MetaNoticeDependencies={
 appSecret:string;
 /** Explicit verified mapping for the exact configured Meta app/login product; no guessed ID equality. */
 resolveBinding(appScopedUserId:string):Promise<{providerProjectId:string;subjectHash:string}|null>;
 /** Repository transaction must atomically claim receiptHash and repeat the same result on replay. */
 apply(input:{providerProjectId:string;subjectHash:string;receiptHash:string;kind:"deauthorization"|"deletion"}):Promise<{confirmationCode:string;status:"pending"|"completed"}>;
};
export async function handleMetaNotice(signedRequest:string,kind:"deauthorization"|"deletion",deps:MetaNoticeDependencies,now=new Date()){
 const notice=await verifyMetaNotice(signedRequest,deps.appSecret,now),binding=await deps.resolveBinding(notice.appScopedUserId);
 if(!binding||!binding.providerProjectId||!/^[a-f0-9]{64}$/.test(binding.subjectHash))throw new IntegrationError("PROVIDER_IDENTITY_MAPPING_REQUIRED",503);
 const receiptHash=await digest(JSON.stringify([binding.providerProjectId,binding.subjectHash,kind,notice.issuedAt]));
 return deps.apply({...binding,kind,receiptHash});
}
