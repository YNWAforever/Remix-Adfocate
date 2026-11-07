// @vitest-environment node
import {expect,it} from "vitest";
import {createMockMissionPilot} from "./missionService.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor={workspaceId:id(1),creatorId:id(11),sessionHash:"a".repeat(64)};
it("requires exact confirmation, preserves one intent across previews, and reload reads status only",async()=>{
 const s=createMockMissionPilot(),p=await s.preview(actor),q=await s.preview(actor);
 await expect(s.approve(actor,{...p.confirmation,confirmed:false})).rejects.toThrow();
 const a=await s.approve(actor,{...p.confirmation,confirmed:true}),b=await s.approve(actor,{...q.confirmation,confirmed:true});
 expect(a.id).toBe(b.id);expect(a.state).toBe("published");expect(a.sampleOnly).toBe(true);
 expect((await s.current(actor))?.id).toBe(a.id);expect(s.counts().publish).toBe(1);
});
it("denies peers, stale instruction confirmation, and changed session",async()=>{
 const s=createMockMissionPilot(),p=await s.preview(actor);
 await expect(s.current({...actor,creatorId:id(12)})).rejects.toThrow();
 await expect(s.approve({...actor,sessionHash:"b".repeat(64)},{...p.confirmation,confirmed:true})).rejects.toThrow();
 s.changeScenario("changed");await expect(s.approve(actor,{...p.confirmation,confirmed:true})).rejects.toThrow();expect(s.counts().publish).toBe(0);
});
it("holds unknown without reposting, and bounded reads cannot create proof or rewards",async()=>{
 const s=createMockMissionPilot({outcome:"unknown"}),p=await s.preview(actor),a=await s.approve(actor,{...p.confirmation,confirmed:true});
 expect(a.state).toBe("outcome_unknown");for(let n=0;n<10;n++)await s.reconcile(actor);
 expect(s.counts()).toMatchObject({publish:1,proof:0,reward:0});expect((await s.current(actor))?.state).toBe("outcome_unknown");
});
it("blocks missing consent, label and private sources; local stop keeps provider unverified",async()=>{
 for(const scenario of ["label","private","revoked"] as const){const s=createMockMissionPilot();s.changeScenario(scenario);await expect(s.preview(actor)).rejects.toThrow();expect(s.counts().publish).toBe(0);}
 const s=createMockMissionPilot();s.stop();await expect(s.preview(actor)).rejects.toThrow();expect(s.readiness()).toMatchObject({stopped:true,providerRevocation:"unverified",liveReady:false});
});
