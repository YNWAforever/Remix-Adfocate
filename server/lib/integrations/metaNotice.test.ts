// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { verifyMetaNotice, handleMetaNotice } from "./metaNotice.js";
const now=new Date("2026-10-31T00:00:00Z"),secret="offline-fixture-app-secret";
async function signed(changes:Record<string,unknown>={}){
 const payload=Buffer.from(JSON.stringify({algorithm:"HMAC-SHA256",user_id:"123456",issued_at:now.getTime()/1000,...changes})).toString("base64url");
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return `${Buffer.from(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload))).toString("base64url")}.${payload}`;
}
describe("offline Meta signed notice",()=>{
 it("verifies HMAC without treating app-scoped user_id as a verified Instagram subject",async()=>{
  expect(await verifyMetaNotice(await signed(),secret,now)).toMatchObject({appScopedUserId:"123456"});
  const apply=vi.fn();
  await expect(handleMetaNotice(await signed(),"deletion",{appSecret:secret,resolveBinding:async()=>null,apply},now)).rejects.toThrow("PROVIDER_IDENTITY_MAPPING_REQUIRED");
  expect(apply).not.toHaveBeenCalled();
 });
 it("rejects forged, old, future or wrong algorithm notices",async()=>{
  for(const value of [await signed({algorithm:"none"}),await signed({issued_at:now.getTime()/1000-86401}),await signed({issued_at:now.getTime()/1000+61}),(await signed()).slice(1),await signed({user_id:""})])await expect(verifyMetaNotice(value,secret,now)).rejects.toThrow("PROVIDER_NOTICE_INVALID");
 });
 it("uses one opaque digest and idempotent repository operation instead of a process replay cache",async()=>{
  const apply=vi.fn(async()=>({confirmationCode:"receipt123",status:"completed" as const}));
  const deps={appSecret:secret,resolveBinding:async()=>({providerProjectId:"isolated-app",subjectHash:"a".repeat(64)}),apply};
  const notice=await signed();await handleMetaNotice(notice,"deauthorization",deps,now);await handleMetaNotice(notice,"deauthorization",deps,now);
  expect(apply.mock.calls[0]).toEqual(apply.mock.calls[1]);expect(JSON.stringify(apply.mock.calls)).not.toContain("123456");
 });
});
