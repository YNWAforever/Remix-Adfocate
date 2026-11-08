import { MockNativeInstagramAdapter } from "../../../server/lib/creatorGrowth/instagramNativeAdapter";
import type { PublisherTarget } from "../../../server/lib/creatorGrowth/instagramPublisher";
import { browserDigest, prepareSyntheticJpeg, type PreparedJpeg } from "./jpegPreparation";
export type DemoAccountKey="primary"|"secondary";
type Confirmation={fingerprint:string;nonce:string};
type Preview=Confirmation & {image:PreparedJpeg;caption:string;expiresAt:string;intentId:string;account:{username:string;subject:string;grantGeneration:number}};
type DemoReceipt={state:"published"|"outcome_unknown";sampleOnly:true;permalink:null;mediaId:string|null};
type DemoProof=Confirmation & {imageSha256:string;mediaId:string;sampleOnly:true;expiresAt:string};
export type DemoReviewDecision="verified"|"needs_information";
export type DemoRevocation={priorOutcome:"not_requested"|"published"|"outcome_unknown";sampleOnly:true};
/** Development-only orchestration. No native evidence, original mission API,
 * persistence or reward capability. The real MissionProofHandoff still rejects it.
 */
export class MockNativeJourney {
  private state="idle";
  private preview:Preview|null=null;
  private receipt:DemoReceipt|null=null;
  private proposal:DemoProof|null=null;
  private submissions=0;
  private reviewDecision:DemoReviewDecision|null=null;
  private revocation:DemoRevocation|null=null;
  private readonly adapter:MockNativeInstagramAdapter;
  private readonly now:()=>number;
  private readonly target:PublisherTarget;
  private readonly accountLabel:string;
  constructor(private readonly ownerKey:string,private readonly options:{validateContext?:()=>void;prepareImage?:()=>Promise<PreparedJpeg>;publishOutcome?:"published"|"timeout_after_accept";now?:()=>number;simulateImageFailure?:boolean;simulateExpiredPreview?:boolean;account?:DemoAccountKey}={}) {
    if(options.account!==undefined&&options.account!=="primary"&&options.account!=="secondary")throw new Error("DEMO_TARGET_INVALID");
    const secondary=options.account==="secondary";
    this.target=Object.freeze({connectionId:secondary?"00000000-0000-4000-8000-000000000042":"00000000-0000-4000-8000-000000000041",accountSubject:secondary?"123456790":"123456789",grantGeneration:1});
    this.accountLabel=secondary?"kocmax_demo_other":"kocmax_demo_only";
    this.now=options.now??Date.now;this.adapter=new MockNativeInstagramAdapter({target:this.target,enabled:true,publishOutcome:options.publishOutcome});
  }
  counts(){return this.adapter.callCounts();}
  proofCount(){return this.submissions;}
  stop(){this.state="cancelled";this.preview=null;this.proposal=null;this.receipt=null;this.reviewDecision=null;}
  revoke(owner:string):DemoRevocation{
    if(owner!==this.ownerKey||this.state==="cancelled")throw new Error("DEMO_REVOKE_INVALID");
    this.revocation??={priorOutcome:this.receipt?.state??(this.state==="publishing"?"outcome_unknown":"not_requested"),sampleOnly:true};
    this.state="revoked";this.preview=null;this.proposal=null;this.receipt=null;this.reviewDecision=null;
    return {...this.revocation};
  }
  private active(){this.options.validateContext?.();if(this.state==="cancelled"||this.state==="revoked")throw new Error("DEMO_CANCELLED");}
  async prepare(caption:string):Promise<Preview>{
    if(this.state!=="idle"||!caption.trim()||caption.length>2200)throw new Error("DEMO_INVALID");
    this.state="converting";
    try{
      if(this.options.simulateImageFailure)throw new Error("DEMO_IMAGE_FAILED");
      const image=await(this.options.prepareImage??prepareSyntheticJpeg)();this.active();
      const intentId=crypto.randomUUID();
      const bytes=await browserDigest(new TextEncoder().encode(JSON.stringify([this.ownerKey,intentId,image.sha256,caption,this.target])));this.active();
      const fingerprint=Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
      this.preview={image:{...image,bytes:image.bytes.slice()},caption,intentId,fingerprint,nonce:crypto.randomUUID(),expiresAt:new Date(this.now()+(this.options.simulateExpiredPreview?-1:300000)).toISOString(),account:{username:this.accountLabel,subject:this.target.accountSubject,grantGeneration:this.target.grantGeneration}};
      this.state="prepared";return structuredClone(this.preview);
    }catch(error){if(this.state!=="cancelled"&&this.state!=="revoked")this.state="failed";throw new Error(error instanceof Error&&error.message==="DEMO_CANCELLED"?"DEMO_CANCELLED":"DEMO_IMAGE_FAILED");}
  }
  async publish(owner:string,confirmation:Confirmation):Promise<DemoReceipt>{
    const p=this.preview;
    if(owner!==this.ownerKey||this.state!=="prepared"||!p||confirmation.fingerprint!==p.fingerprint||confirmation.nonce!==p.nonce||this.now()>=Date.parse(p.expiresAt))throw new Error("DEMO_CONFIRMATION_INVALID");
    this.state="publishing";
    const target=this.target;
    try{
      const c=await this.adapter.createImageContainer({intentId:p.intentId,target,imageSha256:p.image.sha256,caption:p.caption,mediaHandle:`mock-lease:${p.intentId}`});this.active();
      const status=await this.adapter.getContainerStatus(target,c.containerId);this.active();
      if(status.state!=="ready")throw new Error();
      const published=await this.adapter.publishContainer(target,c.containerId);this.active();
      const media=await this.adapter.getPublishedMedia(target,published.mediaId);this.active();
      if(media.accountSubject!==target.accountSubject||!media.sampleOnly)throw new Error();
      this.receipt={state:"published",mediaId:media.mediaId,sampleOnly:true,permalink:null};this.state="published";
    }catch{
      this.active();this.state="outcome_unknown";this.receipt={state:"outcome_unknown",mediaId:null,sampleOnly:true,permalink:null};
    }
    return {...this.receipt};
  }
  proposeProof(owner:string):DemoProof{
    if(owner!==this.ownerKey||this.state!=="published"||!this.preview||!this.receipt?.mediaId)throw new Error("DEMO_PROOF_UNAVAILABLE");
    this.proposal??={fingerprint:this.preview.fingerprint,nonce:crypto.randomUUID(),imageSha256:this.preview.image.sha256,mediaId:this.receipt.mediaId,sampleOnly:true,expiresAt:new Date(this.now()+300000).toISOString()};
    return {...this.proposal};
  }
  confirmProof(owner:string,c:Confirmation){
    const p=this.proposal;
    if(owner!==this.ownerKey||!p||!["published","demo_pending_review"].includes(this.state)||c.fingerprint!==p.fingerprint||c.nonce!==p.nonce||this.now()>=Date.parse(p.expiresAt))throw new Error("DEMO_CONFIRMATION_INVALID");
    this.submissions=1;this.state="demo_pending_review";
    return {state:"demo_pending_review" as const,sampleOnly:true as const,awarded:false as const};
  }
  reviewEvidence(owner:string){
    if(owner!==this.ownerKey||!["demo_pending_review","demo_reviewed"].includes(this.state)||!this.preview||!this.proposal||!this.receipt?.mediaId)throw new Error("DEMO_REVIEW_INVALID");
    return {caption:this.preview.caption,imageSha256:this.preview.image.sha256,mediaId:this.receipt.mediaId,fingerprint:this.preview.fingerprint,accountLabel:this.accountLabel,sampleOnly:true as const};
  }
  /** Developer fixture only. This is not a reviewer permission or native decision. */
  simulateReview(owner:string,c:Confirmation,decision:DemoReviewDecision){
    this.reviewEvidence(owner);
    if(!["verified","needs_information"].includes(decision)||c.fingerprint!==this.proposal!.fingerprint||c.nonce!==this.proposal!.nonce
      ||(this.reviewDecision!==null&&this.reviewDecision!==decision))throw new Error("DEMO_REVIEW_INVALID");
    this.reviewDecision=decision;this.state="demo_reviewed";
    return {decision,sampleOnly:true as const,awarded:false as const};
  }
}
