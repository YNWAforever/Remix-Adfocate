// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { MockNativeJourney } from "./mockNativeJourney";
import { MockNativeInstagramAdapter } from "../../../server/lib/creatorGrowth/instagramNativeAdapter";
const image={bytes:new Uint8Array([255,216,255,217]),mime:"image/jpeg" as const,width:480,height:600,byteSize:4,sha256:"a".repeat(64)};
const make=(outcome:"published"|"timeout_after_accept"="published")=>new MockNativeJourney("owner-a",{prepareImage:async()=>image,publishOutcome:outcome});
describe("isolated mock conversion publication and proof journey",()=>{
  it("binds a secondary synthetic target and rejects a primary confirmation",async()=>{
    const a=make();const pa=await a.prepare("Mock");a.stop();
    const b=new MockNativeJourney("owner-a",{prepareImage:async()=>image,account:"secondary"});const pb=await b.prepare("Mock");
    expect(pa.account.subject).toBe("123456789");expect(pb.account).toMatchObject({subject:"123456790",username:"kocmax_demo_other"});
    await expect(a.publish("owner-a",pa)).rejects.toThrow();await expect(b.publish("owner-a",pa)).rejects.toThrow();
    expect(b.counts().create).toBe(0);
    const spy=vi.spyOn(MockNativeInstagramAdapter.prototype,"createImageContainer");
    try{await b.publish("owner-a",pb);expect(spy).toHaveBeenCalledWith(expect.objectContaining({target:expect.objectContaining({accountSubject:"123456790",connectionId:"00000000-0000-4000-8000-000000000042"})}));}finally{spy.mockRestore();}
    const proof=b.proposeProof("owner-a");b.confirmProof("owner-a",proof);expect(b.reviewEvidence("owner-a").accountLabel).toBe("kocmax_demo_other");
  });
  it("simulates a conversion failure before decoding or publishing",async()=>{
    const prepareImage=vi.fn(async()=>image);
    const j=new MockNativeJourney("owner-a",{prepareImage,simulateImageFailure:true});
    await expect(j.prepare("Mock")).rejects.toThrow("DEMO_IMAGE_FAILED");expect(prepareImage).not.toHaveBeenCalled();
    expect(j.counts()).toEqual({create:0,status:0,publish:0,lookup:0});
  });
  it("rejects the expired fixture confirmation even without the UI gate",async()=>{
    const j=new MockNativeJourney("owner-a",{prepareImage:async()=>image,simulateExpiredPreview:true,now:()=>1000});
    const p=await j.prepare("Mock");expect(Date.parse(p.expiresAt)).toBeLessThan(1000);
    await expect(j.publish("owner-a",p)).rejects.toThrow("DEMO_CONFIRMATION_INVALID");expect(j.counts().create).toBe(0);
    expect(()=>j.proposeProof("owner-a")).toThrow();
  });
  it("does not revive a receipt that arrives after revoke following mock acceptance",async()=>{
    let accepted!:()=>void,release!:()=>void;
    const received=new Promise<void>(r=>{accepted=r;}),delayed=new Promise<void>(r=>{release=r;});
    const original=MockNativeInstagramAdapter.prototype.publishContainer;
    const spy=vi.spyOn(MockNativeInstagramAdapter.prototype,"publishContainer").mockImplementationOnce(async function(this:MockNativeInstagramAdapter,target,id){
      const receipt=await original.call(this,target,id);accepted();await delayed;return receipt;
    });
    try{
      const j=make();const p=await j.prepare("Mock");const pending=j.publish("owner-a",p);await received;
      expect(j.counts().publish).toBe(1);expect(j.revoke("owner-a").priorOutcome).toBe("outcome_unknown");release();
      await expect(pending).rejects.toThrow("DEMO_CANCELLED");expect(()=>j.proposeProof("owner-a")).toThrow();
      expect(j.revoke("owner-a").priorOutcome).toBe("outcome_unknown");expect(j.counts().publish).toBe(1);
    }finally{release();spy.mockRestore();}
  });
  it("revokes before confirmation without publishing and rejects a different owner",async()=>{
    const j=make();const p=await j.prepare("Mock");
    expect(()=>j.revoke("owner-b")).toThrow("DEMO_REVOKE_INVALID");
    expect(j.revoke("owner-a")).toEqual({priorOutcome:"not_requested",sampleOnly:true});
    await expect(j.publish("owner-a",p)).rejects.toThrow();expect(j.counts().publish).toBe(0);
    await expect(j.prepare("Again")).rejects.toThrow();
  });
  it.each(["published","timeout_after_accept"] as const)("revokes %s without claiming deletion",async outcome=>{
    const j=make(outcome);const p=await j.prepare("Mock");await j.publish("owner-a",p);
    const expected={priorOutcome:outcome==="published"?"published":"outcome_unknown",sampleOnly:true};
    expect(j.revoke("owner-a")).toEqual(expected);expect(j.revoke("owner-a")).toEqual(expected);
    expect(()=>j.proposeProof("owner-a")).toThrow();expect(()=>j.reviewEvidence("owner-a")).toThrow();expect(j.counts().publish).toBe(1);
  });
  it("prevents a late conversion from reviving revoked state",async()=>{
    let resolve!:(value:typeof image)=>void;const j=new MockNativeJourney("owner-a",{prepareImage:()=>new Promise(r=>{resolve=r;})});
    const pending=j.prepare("Mock");j.revoke("owner-a");resolve(image);
    await expect(pending).rejects.toThrow("DEMO_CANCELLED");expect(j.revoke("owner-a").priorOutcome).toBe("not_requested");
  });
  it("stops an in-flight operation before provider publish and leaves it conservatively unknown",async()=>{
    const j=make();const p=await j.prepare("Mock");const pending=j.publish("owner-a",p);
    expect(j.revoke("owner-a").priorOutcome).toBe("outcome_unknown");
    await expect(pending).rejects.toThrow("DEMO_CANCELLED");expect(j.counts().publish).toBe(0);
  });
  it.each(["verified", "needs_information"] as const)("simulates %s only after bound proof handoff without awarding",async decision=>{
    const j=make();const p=await j.prepare("Exact caption");await j.publish("owner-a",p);
    const proof=j.proposeProof("owner-a");
    expect(()=>j.simulateReview("owner-a",proof,decision)).toThrow("DEMO_REVIEW_INVALID");
    j.confirmProof("owner-a",proof);
    const result=j.simulateReview("owner-a",proof,decision);
    expect(result).toEqual({decision,sampleOnly:true,awarded:false});
    expect(j.simulateReview("owner-a",proof,decision)).toEqual(result);
    expect(()=>j.simulateReview("owner-a",proof,decision==="verified"?"needs_information":"verified")).toThrow("DEMO_REVIEW_INVALID");
    expect(j.counts().publish).toBe(1);expect(j.proofCount()).toBe(1);
  });
  it("returns immutable exact review evidence only to its owner after handoff",async()=>{
    const j=make();const p=await j.prepare("Exact caption");await j.publish("owner-a",p);const proof=j.proposeProof("owner-a");
    expect(()=>j.reviewEvidence("owner-a")).toThrow("DEMO_REVIEW_INVALID");j.confirmProof("owner-a",proof);
    const evidence=j.reviewEvidence("owner-a");expect(evidence).toMatchObject({caption:"Exact caption",imageSha256:p.image.sha256,mediaId:proof.mediaId,sampleOnly:true});
    evidence.caption="tampered";expect(j.reviewEvidence("owner-a").caption).toBe("Exact caption");
    expect(()=>j.reviewEvidence("owner-b")).toThrow("DEMO_REVIEW_INVALID");
    expect(()=>j.simulateReview("owner-b",proof,"verified")).toThrow("DEMO_REVIEW_INVALID");
    expect(()=>j.simulateReview("owner-a",{...proof,nonce:"bad"},"verified")).toThrow("DEMO_REVIEW_INVALID");
    j.stop();expect(()=>j.reviewEvidence("owner-a")).toThrow("DEMO_REVIEW_INVALID");expect(()=>j.simulateReview("owner-a",proof,"verified")).toThrow("DEMO_REVIEW_INVALID");
  });
  it("keeps unknown outcomes outside review",async()=>{
    const j=make("timeout_after_accept");const p=await j.prepare("Mock");await j.publish("owner-a",p);
    expect(()=>j.reviewEvidence("owner-a")).toThrow("DEMO_REVIEW_INVALID");
    expect(()=>j.simulateReview("owner-a",p,"verified")).toThrow("DEMO_REVIEW_INVALID");
  });
  it("requires exact confirmation and carries the image/content binding into a sample proof",async()=>{
    const j=make();const p=await j.prepare("Mock caption");
    await expect(j.publish("owner-b",p)).rejects.toThrow("DEMO_CONFIRMATION_INVALID");
    expect(j.counts().create).toBe(0);
    const receipt=await j.publish("owner-a",p);
    expect(receipt).toMatchObject({state:"published",sampleOnly:true,permalink:null});
    const proof=j.proposeProof("owner-a");
    expect(proof).toMatchObject({imageSha256:p.image.sha256,fingerprint:p.fingerprint,sampleOnly:true});
    expect(j.confirmProof("owner-a",proof)).toEqual({state:"demo_pending_review",sampleOnly:true,awarded:false});
    expect(j.confirmProof("owner-a",proof)).toEqual({state:"demo_pending_review",sampleOnly:true,awarded:false});
    expect(j.proofCount()).toBe(1);
  });
  it("never repeats a publish on double confirmation",async()=>{
    const j=make();const p=await j.prepare("Mock");const first=j.publish("owner-a",p);
    await expect(j.publish("owner-a",p)).rejects.toThrow("DEMO_CONFIRMATION_INVALID");await first;expect(j.counts().publish).toBe(1);
  });
  it("keeps unknown outcomes away from proof and never retries",async()=>{
    const j=make("timeout_after_accept");const p=await j.prepare("Mock");
    expect(await j.publish("owner-a",p)).toMatchObject({state:"outcome_unknown"});
    expect(()=>j.proposeProof("owner-a")).toThrow("DEMO_PROOF_UNAVAILABLE");
    await expect(j.publish("owner-a",p)).rejects.toThrow();expect(j.counts().publish).toBe(1);
  });
  it("invalidates old confirmation when cancelled",async()=>{
    const j=make();const p=await j.prepare("Mock");j.stop();await expect(j.publish("owner-a",p)).rejects.toThrow();expect(j.counts().create).toBe(0);
  });
  it("rejects stale or modified confirmations and cross-owner proof",async()=>{
    let time=100;const j=new MockNativeJourney("owner-a",{prepareImage:async()=>image,now:()=>time});const p=await j.prepare("Mock");
    await expect(j.publish("owner-a",{...p,fingerprint:"changed"})).rejects.toThrow();
    time+=300001;await expect(j.publish("owner-a",p)).rejects.toThrow();
    const other=make();const q=await other.prepare("Mock");await other.publish("owner-a",q);
    expect(()=>other.proposeProof("owner-b")).toThrow();const proof=other.proposeProof("owner-a");
    expect(()=>other.confirmProof("owner-a",{...proof,nonce:"wrong"})).toThrow();expect(other.proofCount()).toBe(0);
  });
  it("suppresses conversion that resolves after leaving",async()=>{
    let resolve!:(value:typeof image)=>void;
    const j=new MockNativeJourney("owner-a",{prepareImage:()=>new Promise(r=>{resolve=r;})});const pending=j.prepare("Mock");j.stop();resolve(image);
    await expect(pending).rejects.toThrow("DEMO_CANCELLED");expect(j.counts().create).toBe(0);
  });
});
