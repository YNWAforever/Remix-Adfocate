import { MockNativeJourney } from "./mockNativeJourney";
import { inspectMissionPublish, type MissionPublishContext } from "./missionPublishContext";
import type { PreparedJpeg } from "./jpegPreparation";

/** Development-only binding, not an official approval or publish authority. */
export class MockMissionPublishSession {
  private readonly journey:MockNativeJourney;
  private readonly signature:string;
  private readonly approved:Extract<ReturnType<typeof inspectMissionPublish>,{eligible:true}>;
  private stopped=false;
  private preview:Awaited<ReturnType<MockNativeJourney["prepare"]>>|null=null;
  private receipt:Awaited<ReturnType<MockNativeJourney["publish"]>>|null=null;
  private attempted=false;
  constructor(private readonly readCurrent:()=>MissionPublishContext,prepareImage:()=>Promise<PreparedJpeg>,outcome:"published"|"timeout_after_accept") {
    const c=readCurrent(),a=inspectMissionPublish(c);
    if(!a.eligible||!["123456789","123456790"].includes(a.accountSubject)||c.rights.grantGeneration!==1)throw new Error("MISSION_MOCK_UNAVAILABLE");
    this.signature=a.signature;this.approved=a;
    this.journey=new MockNativeJourney(c.ownerKey,{validateContext:()=>{this.current();},account:a.accountSubject==="123456790"?"secondary":"primary",publishOutcome:outcome,prepareImage:async()=>{
      const image=await prepareImage();this.current();
      if(image.sha256!==a.imageSha256)throw new Error("MISSION_MOCK_ASSET_CHANGED");
      return image;
    }});
  }
  private current(){
    const c=this.readCurrent(),a=inspectMissionPublish(c);
    if(this.stopped||!a.eligible||a.signature!==this.signature){this.dispose();throw new Error("MISSION_MOCK_CHANGED");}
    return c;
  }
  async prepare(){
    this.current();if(this.preview)return structuredClone({...this.preview,approved:this.approved});
    const p=await this.journey.prepare(this.approved.caption);this.current();
    if(p.account.subject!==this.approved.accountSubject){this.dispose();throw new Error("MISSION_MOCK_ACCOUNT");}
    this.preview=p;return structuredClone({...p,approved:this.approved});
  }
  async confirm(c:{fingerprint:string;nonce:string}){
    const current=this.current();if(this.attempted)throw new Error("MISSION_MOCK_ALREADY_ATTEMPTED");
    if(!this.preview||c.fingerprint!==this.preview.fingerprint||c.nonce!==this.preview.nonce)throw new Error("MISSION_MOCK_CONFIRMATION");
    this.attempted=true;
    const receipt=await this.journey.publish(current.ownerKey,c);this.current();this.receipt=receipt;return {...receipt};
  }
  status(){this.current();return this.receipt?{...this.receipt}:null;}
  hasAttempted(){return this.attempted;}
  canRenew(){return !this.stopped&&!this.attempted&&this.preview!==null&&Date.now()>=Date.parse(this.preview.expiresAt);}
  counts(){return this.journey.counts();}
  dispose(){this.stopped=true;this.preview=null;this.receipt=null;this.journey.stop();}
}
export class MockMissionPublishRegistry {
  private readonly sessions=new Map<string,MockMissionPublishSession>();private stopped=false;
  getOrCreate(signature:string,factory:()=>MockMissionPublishSession){
    if(this.stopped)throw new Error("MISSION_MOCK_DISPOSED");
    let session=this.sessions.get(signature);
    // Only an unused expired preview may be replaced; attempted records are tombstones.
    if(session?.canRenew()){session.dispose();this.sessions.delete(signature);session=undefined;}
    if(!session){session=factory();this.sessions.set(signature,session);}return session;
  }
  dispose(){this.stopped=true;for(const session of this.sessions.values())session.dispose();this.sessions.clear();}
}
