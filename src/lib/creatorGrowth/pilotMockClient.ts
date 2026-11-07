import type {PilotTaskApi} from "../../components/active-mission/pilot/PilotTaskPublish";
import type {PilotMockPreview,PilotMockStatus} from "../../../server/lib/creatorGrowth/pilot/missionService";
const base="/api/controlled-pilot-mock";
const id=(v:unknown)=>typeof v==="string"&&/^[0-9a-f-]{36}$/.test(v);
const hash=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const fail=():never=>{throw new Error("PILOT_RESPONSE_INVALID");};
export function createPilotMockClient():PilotTaskApi{
 let imageHash:string|null=null;
 async function call(path:string,body?:unknown){const r=await fetch(base+path,{credentials:"same-origin",cache:"no-store",...(body!==undefined?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});if(!r.ok)throw new Error("PILOT_RECHECK_REQUIRED");return r.json() as Promise<unknown>;}
 function status(v:unknown):PilotMockStatus|null{
  if(v===null)return null;
  if(!object(v)||v.sampleOnly!==true||v.canSubmitRealProof!==false||v.providerRevocation!=="unverified"||!id(v.id)||!id(v.approvedVersionId)||typeof v.accountLabel!=="string"||v.accountLabel.length>120||!Number.isSafeInteger(v.version)||!Number.isSafeInteger(v.instructionRevision)||!["creator_approved","container_preparing","provider_processing","publish_requested","published","failed","outcome_unknown","cancelled","invalidated"].includes(String(v.state)))return fail();
  return {id:v.id as string,state:v.state as PilotMockStatus["state"],version:v.version as number,sampleOnly:true,accountLabel:v.accountLabel,approvedVersionId:v.approvedVersionId as string,instructionRevision:v.instructionRevision as number,canSubmitRealProof:false,providerRevocation:"unverified"};
 }
 return {current:async()=>status(await call("/current")),reconcile:async()=>status(await call("/reconcile",{})),approve:async c=>status(await call("/approve",c))??fail(),preview:async()=>{
  const v=await call("/preview",{});if(!object(v)||v.sampleOnly!==true||!id(v.approvedVersionId)||typeof v.caption!=="string"||v.caption.length>4400||typeof v.accountLabel!=="string"||v.accountLabel.length>120||!hash(v.imageSha256)||v.imagePath!==base+"/image"||!Number.isSafeInteger(v.instructionRevision)||!Array.isArray(v.disclosures)||v.disclosures.some(x=>typeof x!=="string")||!Array.isArray(v.sponsorIds)||v.sponsorIds.some(x=>typeof x!=="string"||!/^[1-9][0-9]{0,63}$/.test(x))||typeof v.expiresAt!=="string"||!Number.isFinite(Date.parse(v.expiresAt))||!object(v.confirmation))return fail();
  const c=v.confirmation;if(!id(c.approvalId)||!id(c.requestId)||!hash(c.fingerprint)||typeof c.nonce!=="string"||!/^[A-Za-z0-9_-]{43,128}$/.test(c.nonce))return fail();imageHash=v.imageSha256 as string;
  return {sampleOnly:true,caption:v.caption,imageSha256:imageHash,imagePath:base+"/image",accountLabel:v.accountLabel,approvedVersionId:v.approvedVersionId as string,instructionRevision:v.instructionRevision as number,disclosures:v.disclosures as string[],sponsorIds:v.sponsorIds as string[],expiresAt:v.expiresAt,confirmation:{approvalId:c.approvalId as string,requestId:c.requestId as string,fingerprint:c.fingerprint as string,nonce:c.nonce}} satisfies PilotMockPreview;
 },image:async()=>{const expected=imageHash,r=await fetch(base+"/image",{cache:"no-store"});if(!expected||!r.ok||r.headers.get("Content-Type")!=="image/jpeg")return fail();const bytes=await r.arrayBuffer();if(bytes.byteLength>5*1024*1024)return fail();const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");if(digest!==expected)return fail();return URL.createObjectURL(new Blob([bytes],{type:"image/jpeg"}));}};
}
