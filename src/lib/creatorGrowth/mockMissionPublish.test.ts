// @vitest-environment node
import { expect, it, vi } from "vitest";
import { context } from "../../test/missionPublishTestData";
import { MockMissionPublishSession, MockMissionPublishRegistry } from "./mockMissionPublish";
import {MockNativeInstagramAdapter} from "../../../server/lib/creatorGrowth/instagramNativeAdapter";
const image={bytes:new Uint8Array([255,216,255,217]),mime:"image/jpeg" as const,width:480,height:600,byteSize:4,sha256:"a".repeat(64)};
it("revalidates a grant after container readiness before invoking publish",async()=>{
 const c=context(),s=new MockMissionPublishSession(()=>c,async()=>image,"published"),p=await s.prepare();
 let release!:()=>void;let ready!:()=>void;const reached=new Promise<void>(r=>{ready=r;}),gate=new Promise<void>(r=>{release=r;});
 const original=MockNativeInstagramAdapter.prototype.getContainerStatus;
 const spy=vi.spyOn(MockNativeInstagramAdapter.prototype,"getContainerStatus").mockImplementationOnce(async function(this:MockNativeInstagramAdapter,...args:Parameters<typeof original>){const result=await original.apply(this,args);ready();await gate;return result;});
 try{const pending=s.confirm(p);await reached;c.rights.grant="revoked";release();await expect(pending).rejects.toThrow();expect(s.counts().publish).toBe(0);}finally{spy.mockRestore();}
});
it("publishes approved caption once and retains same unknown request",async()=>{
  const c=context(),s=new MockMissionPublishSession(()=>c,async()=>image,"timeout_after_accept");
  const p=await s.prepare();expect(p.caption).toBe("Tea #合作");
  const receipt=await s.confirm(p);expect(receipt).toMatchObject({state:"outcome_unknown",sampleOnly:true,permalink:null});
  await expect(s.confirm(p)).rejects.toThrow();expect(s.status()).toEqual(receipt);
  expect(s.counts().publish).toBe(1);
});
it("blocks different prepared asset and stops stale async preparation",async()=>{
  const c=context();await expect(new MockMissionPublishSession(()=>c,async()=>({...image,sha256:"c".repeat(64)}),"published").prepare()).rejects.toThrow();
  let release!:(v:typeof image)=>void;const s=new MockMissionPublishSession(()=>c,()=>new Promise(r=>{release=r;}),"published");
  const pending=s.prepare();c.rights.sources="revoked";release(image);await expect(pending).rejects.toThrow();expect(s.counts().publish).toBe(0);
});
it.each(["caption","grant","owner"])("blocks changed %s at final confirmation",async kind=>{
  const c=context(),s=new MockMissionPublishSession(()=>c,async()=>image,"published"),p=await s.prepare();
  if(kind==="caption")c.item.versions![0].caption+=" changed";
  if(kind==="grant")c.rights.grant="revoked";
  if(kind==="owner")c.ownerKey="other";
  await expect(s.confirm(p)).rejects.toThrow();expect(s.counts().publish).toBe(0);
});
it("keeps attempted session on reopening and disposes owner scope",async()=>{
  const c=context(),r=new MockMissionPublishRegistry(),factory=vi.fn(()=>new MockMissionPublishSession(()=>c,async()=>image,"published"));
  const s=r.getOrCreate("a",factory),p=await s.prepare();await s.confirm(p);
  expect(r.getOrCreate("a",factory)).toBe(s);expect(factory).toHaveBeenCalledTimes(1);
  r.dispose();await expect(s.confirm(p)).rejects.toThrow();expect(()=>r.getOrCreate("a",factory)).toThrow();
});

it("renews only an expired unattempted preview and invalidates its old confirmation",async()=>{
 let now=Date.now();const clock=vi.spyOn(Date,"now").mockImplementation(()=>now);
 try{
  const c=context(),r=new MockMissionPublishRegistry(),factory=vi.fn(()=>new MockMissionPublishSession(()=>c,async()=>image,"published"));
  const first=r.getOrCreate("a",factory),old=await first.prepare();
  expect(r.getOrCreate("a",factory)).toBe(first);
  now+=300000;
  const next=r.getOrCreate("a",factory),fresh=await next.prepare();
  expect(next).not.toBe(first);expect(fresh.nonce).not.toBe(old.nonce);expect(Date.parse(fresh.expiresAt)).toBeGreaterThan(now);
  await expect(first.confirm(old)).rejects.toThrow();await expect(next.confirm(old)).rejects.toThrow();
  expect(first.counts().publish).toBe(0);await next.confirm(fresh);expect(next.counts().publish).toBe(1);
 }finally{clock.mockRestore();}
});
it.each(["published","timeout_after_accept"] as const)("never renews an attempted %s session after expiry",async outcome=>{
 let now=Date.now();const clock=vi.spyOn(Date,"now").mockImplementation(()=>now);
 try{
  const c=context(),r=new MockMissionPublishRegistry(),factory=vi.fn(()=>new MockMissionPublishSession(()=>c,async()=>image,outcome));
  const s=r.getOrCreate("a",factory),p=await s.prepare();await s.confirm(p);now+=300001;
  expect(r.getOrCreate("a",factory)).toBe(s);expect(factory).toHaveBeenCalledTimes(1);
  await expect(s.confirm(p)).rejects.toThrow();expect(s.counts().publish).toBe(1);
 }finally{clock.mockRestore();}
});
