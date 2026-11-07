// @vitest-environment node
import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import {PilotMediaLeaseStore,type ApprovedPilotAsset} from "./mediaLease.js";
const owner={workspaceId:"00000000-0000-4000-8000-000000000001",creatorId:"00000000-0000-4000-8000-000000000011"};
const bytes=new Uint8Array([255,216,255,217]),sha256=createHash('sha256').update(bytes).digest('hex');
const input={owner,intentId:"00000000-0000-4000-8000-000000000091",approvedAssetId:"00000000-0000-4000-8000-000000000071",sha256,ttlSeconds:900 as const};
const asset:ApprovedPilotAsset={owner,id:input.approvedAssetId,bytes,sha256,mime:"image/jpeg",width:640,height:640,validated:true,rights:"shareable",sampleOnly:true};
function setup(){let now=new Date('2030-01-01T00:00:00Z');const authorize=vi.fn(async()=>true),load=vi.fn(async()=>asset),put=vi.fn(async()=>{}),purge=vi.fn(async()=>{});
 const store=new PilotMediaLeaseStore({now:()=>now,authorize,load,storage:{provenance:"fixture",put,purge}});return {store,authorize,load,put,purge,advance:()=>{now=new Date(+now+900000);}};}
it("leases only final approved bytes and expires at the boundary",async()=>{
 const s=setup(),lease=await s.store.open(input);expect(lease.provenance).toBe('fixture');expect(JSON.stringify(lease)).not.toMatch(/https?:|bytes|token/);
 expect(await s.store.isUsable(owner,input.intentId)).toBe(true);s.advance();expect(await s.store.isUsable(owner,input.intentId)).toBe(false);
 await s.store.close(owner,input.intentId);await s.store.close(owner,input.intentId);expect(s.purge).toHaveBeenCalledTimes(1);
});
it.each([{width:0},{rights:"private"},{mime:"image/png"},{sha256:"a".repeat(64)},{owner:{...owner,creatorId:"other"}},{sampleOnly:false}])("denies invalid approved asset %j",async patch=>{
 const s=setup();s.load.mockResolvedValueOnce({...asset,...patch} as ApprovedPilotAsset);await expect(s.store.open(input)).rejects.toThrow();expect(s.put).not.toHaveBeenCalled();
});
it("invalidates and purges if rights are revoked while storage awaits",async()=>{
 const s=setup();s.put.mockImplementationOnce(async()=>{s.authorize.mockResolvedValue(false);});await expect(s.store.open(input)).rejects.toThrow();expect(s.purge).toHaveBeenCalledTimes(1);expect(await s.store.isUsable(owner,input.intentId)).toBe(false);
});
it("never accepts arbitrary asset URLs or exposes a failed purge as complete",async()=>{
 const s=setup();await expect(s.store.open({...input,approvedAssetId:"http://127.0.0.1/private"})).rejects.toThrow();expect(s.load).not.toHaveBeenCalled();
 await s.store.open(input);s.purge.mockRejectedValueOnce(new Error('private signed URL'));await expect(s.store.close(owner,input.intentId)).rejects.toThrow('PILOT_MEDIA_PURGE_PENDING');expect(await s.store.isUsable(owner,input.intentId)).toBe(false);
 await s.store.close(owner,input.intentId);expect(s.purge).toHaveBeenCalledTimes(2);
});
it("does not resurrect a lease closed during storage creation",async()=>{
 const s=setup();s.put.mockImplementationOnce(async()=>{await s.store.close(owner,input.intentId);});
 await expect(s.store.open(input)).rejects.toThrow();expect(await s.store.isUsable(owner,input.intentId)).toBe(false);expect(s.purge).toHaveBeenCalledTimes(2);
});
it("does not resurrect a lease closed during final authorization",async()=>{
 const s=setup();s.authorize.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockImplementationOnce(async()=>{await s.store.close(owner,input.intentId);return true;});
 await expect(s.store.open(input)).rejects.toThrow("PILOT_MEDIA_DENIED");
});
it("rechecks closure after an in-flight usability authorization",async()=>{
 const s=setup();await s.store.open(input);
 s.authorize.mockImplementationOnce(async()=>{await s.store.close(owner,input.intentId);return true;});
 expect(await s.store.isUsable(owner,input.intentId)).toBe(false);
});
it("sanitizes source resolver failures",async()=>{
 const s=setup();s.load.mockRejectedValueOnce(new Error("private token SECRET"));
 await expect(s.store.open(input)).rejects.toThrow("PILOT_MEDIA_DENIED");
});

it("does not write storage after revocation during source loading",async()=>{const s=setup();s.load.mockImplementationOnce(async()=>{s.authorize.mockResolvedValue(false);return asset;});await expect(s.store.open(input)).rejects.toThrow();expect(s.put).not.toHaveBeenCalled();});
