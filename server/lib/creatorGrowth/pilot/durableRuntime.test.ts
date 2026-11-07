import {PGlite} from "@electric-sql/pglite";
import {SupabasePublishRepository} from "../publishRepo.js";
// @vitest-environment node
import {mkdtemp,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {expect,it,vi} from "vitest";
import {createControlledPilotMockApp} from "./mockApp.js";
import {openDurablePilot} from "./durableRuntime.js";
const actor={workspaceId:"00000000-0000-4000-8000-000000000001",creatorId:"00000000-0000-4000-8000-000000000011",sessionHash:"a".repeat(64)};
it("reopens the actual on-disk service with the same intent, one publish and persistent stop",async()=>{
 await mkdir(".superpowers/pilot-test",{recursive:true});const dir=await mkdtemp(resolve(".superpowers/pilot-test/run-"));
 let r=await openDurablePilot(dir);try{const p=await connectedPreview(r);const s=await r.pilot.approve(actor,{...p.confirmation,confirmed:true});expect(s.state).toBe("published");await r.close();r=await openDurablePilot(dir);expect((await r.pilot.current(actor))?.id).toBe(s.id);expect(r.pilot.counts().publish).toBe(1);await r.pilot.stop();await r.close();r=await openDurablePilot(dir);expect(r.pilot.readiness().stopped).toBe(true);await expect(r.pilot.preview(actor)).rejects.toThrow();}finally{await r.close();}
},30000);
it("retains unknown across service restart without retrying publish",async()=>{
 await mkdir(".superpowers/pilot-test",{recursive:true});const dir=await mkdtemp(resolve(".superpowers/pilot-test/run-"));let r=await openDurablePilot(dir);try{await r.pilot.changeScenario("unknown");const p=await connectedPreview(r);expect((await r.pilot.approve(actor,{...p.confirmation,confirmed:true})).state).toBe("outcome_unknown");await r.close();r=await openDurablePilot(dir);await r.pilot.reconcile(actor);expect((await r.pilot.current(actor))?.state).toBe("outcome_unknown");expect(r.pilot.counts().publish).toBe(1);}finally{await r.close();}
},30000);

it("composes one persistent task from publication to original settlement across reopen",async()=>{
 await mkdir(".superpowers/pilot-test",{recursive:true});const dir=await mkdtemp(resolve(".superpowers/pilot-test/run-"));let r=await openDurablePilot(dir);try{const p=await connectedPreview(r);const published=await r.pilot.approve(actor,{...p.confirmation,confirmed:true});await r.journey.act("creator","proof",true);await r.close();r=await openDurablePilot(dir);expect((await r.journey.read()).item.state).toBe("proof_submitted");await r.journey.act("reviewer","review",true);await r.journey.act("operator","completion",true);expect((await r.journey.read()).ledger.points).toBe(0);await r.journey.act("workspace_admin","settlement",true);await r.close();r=await openDurablePilot(dir);const result=await r.journey.act("workspace_admin","settlement",true);expect(result.ledger).toEqual({count:1,points:400});expect((await r.pilot.current(actor))?.id).toBe(published.id);expect(r.pilot.counts()).toMatchObject({publish:1,proof:0,reward:0});}finally{await r.close();}
},30000);

it("denies cross-account HTTP handoff and enforces role transitions",async()=>{
 await mkdir(".superpowers/pilot-test",{recursive:true});const dir=await mkdtemp(resolve(".superpowers/pilot-test/run-")),r=await openDurablePilot(dir);try{const app=createControlledPilotMockApp(r.pilot,r.journey);const call=(role:string,action?:string)=>app.request("http://127.0.0.1/api/controlled-pilot-mock/journey",{method:action?"POST":"GET",headers:{"X-Pilot-Fixture-Role":role,"X-Pilot-Fixture-Session":"a".repeat(64),"Content-Type":"application/json"},...(action?{body:JSON.stringify({action,confirmed:true})}:{})});for(const role of ["visitor","same_workspace_creator","other_workspace_creator","brand_member"])expect((await call(role)).status).toBe(403);expect((await call("operator","settlement")).status).toBe(409);expect((await call("creator","proof")).status).toBe(409);expect((await call("creator")).status).toBe(200);}finally{await r.close();}
},30000);

it("repairs a reserved job after restart but status never initiates publication",async()=>{
 await mkdir(".superpowers/pilot-test",{recursive:true});const dir=await mkdtemp(resolve(".superpowers/pilot-test/run-"));let r=await openDurablePilot(dir);
 try{const p=await connectedPreview(r),original=SupabasePublishRepository.prototype.reserve;const fault=vi.spyOn(SupabasePublishRepository.prototype,"reserve").mockImplementationOnce(async function(this:SupabasePublishRepository,...args){await original.apply(this,args);throw new Error("CRASH_AFTER_RESERVE");});
 await expect(r.pilot.approve(actor,{...p.confirmation,confirmed:true})).rejects.toThrow("CRASH_AFTER_RESERVE");fault.mockRestore();await r.close();r=await openDurablePilot(dir);expect((await r.pilot.reconcile(actor))?.state).toBe("creator_approved");expect(r.pilot.counts().publish).toBe(0);
 const again=await connectedPreview(r);expect((await r.pilot.approve(actor,{...again.confirmation,confirmed:true})).state).toBe("published");expect(r.pilot.counts().publish).toBe(1);
 }finally{vi.restoreAllMocks();await r.close();}
},30000);
it("recovers a durable known media receipt without another publish",async()=>{
 await mkdir(".superpowers/pilot-test",{recursive:true});const dir=await mkdtemp(resolve(".superpowers/pilot-test/run-"));let time=Date.now();const now=()=>new Date(time);let r=await openDurablePilot(dir,now);
 try{const p=await connectedPreview(r),original=SupabasePublishRepository.prototype.transition;let fail=true;const fault=vi.spyOn(SupabasePublishRepository.prototype,"transition").mockImplementation(async function(this:SupabasePublishRepository,...args){if(fail&&args[1].nextState==="published"){fail=false;throw new Error("CRASH_BEFORE_RECEIPT");}return original.apply(this,args);});
 expect((await r.pilot.approve(actor,{...p.confirmation,confirmed:true})).state).toBe("outcome_unknown");fault.mockRestore();await r.close();time+=61000;r=await openDurablePilot(dir,now);expect((await r.pilot.reconcile(actor))?.state).toBe("published");expect(r.pilot.counts().publish).toBe(1);
 }finally{vi.restoreAllMocks();await r.close();}
},30000);

it("rolls back interrupted initialization and can reopen cleanly",async()=>{
 await mkdir(".superpowers/pilot-test",{recursive:true});const dir=await mkdtemp(resolve(".superpowers/pilot-test/run-"));const original=PGlite.prototype.query;let fail=true;
 const fault=vi.spyOn(PGlite.prototype,"query").mockImplementation(function(this:PGlite,...args){if(fail&&String(args[0]).startsWith("insert into public.workspaces")){fail=false;return Promise.reject(new Error("INIT_INTERRUPTED"));}return original.apply(this,args);});
 try{await expect(openDurablePilot(dir)).rejects.toThrow("INIT_INTERRUPTED");}finally{fault.mockRestore();}
 const r=await openDurablePilot(dir);try{expect((await r.journey.read()).item.state).toBe("approved_to_publish");expect(r.pilot.counts().publish).toBe(0);}finally{await r.close();}
},30000);
async function connectedPreview(r:Awaited<ReturnType<typeof openDurablePilot>>){if((await r.privateWorkspace.status(actor)).status!=="connected"){const start=await r.privateWorkspace.begin(actor);await r.privateWorkspace.complete(actor,start.state,true);}return r.pilot.preview(actor);}
it("requires mock OAuth before preview and persists private receipt across restart",async()=>{
 await mkdir('.superpowers/pilot-test',{recursive:true});const dir=await mkdtemp(resolve('.superpowers/pilot-test/run-'));let r=await openDurablePilot(dir);
 try{const app=createControlledPilotMockApp(r.pilot,r.journey,r.privateWorkspace);for(const role of ['brand_member','reviewer','operator','workspace_admin','same_workspace_creator','other_workspace_creator']){const response=await app.request('http://127.0.0.1/api/controlled-pilot-mock/private',{headers:{'X-Pilot-Fixture-Session':actor.sessionHash,'X-Pilot-Fixture-Role':role}});expect(response.status).toBe(403);}await expect(r.pilot.preview(actor)).rejects.toThrow();const start=await r.privateWorkspace.begin(actor);await r.privateWorkspace.complete(actor,start.state,true);const p=await r.pilot.preview(actor);await r.pilot.approve(actor,{...p.confirmation,confirmed:true});await r.privateWorkspace.saveReceipt(actor,true);await r.close();r=await openDurablePilot(dir);expect((await r.privateWorkspace.collection(actor)).briefs).toHaveLength(1);await r.privateWorkspace.revoke(actor);await expect(r.pilot.preview(actor)).rejects.toThrow();expect(r.pilot.counts().publish).toBe(1);}finally{await r.close();}
},30000);
it('serves the composed mock OAuth and private collection HTTP commands',async()=>{
 await mkdir('.superpowers/pilot-test',{recursive:true});const dir=await mkdtemp(resolve('.superpowers/pilot-test/run-'));const r=await openDurablePilot(dir);try{const app=createControlledPilotMockApp(r.pilot,r.journey,r.privateWorkspace);const headers={'X-Pilot-Fixture-Session':actor.sessionHash,'X-Pilot-Fixture-Role':'creator','Content-Type':'application/json'};const call=(action:string,state='')=>app.request('http://127.0.0.1/api/controlled-pilot-mock/private',{method:'POST',headers,body:JSON.stringify({action,state,briefId:'',draftId:'',text:'',confirmed:true})});const start=await call('begin');expect(start.status).toBe(200);const payload=await start.json();expect((await call('complete',payload.state)).status).toBe(200);const read=await app.request('http://127.0.0.1/api/controlled-pilot-mock/private',{headers});expect((await read.json()).connection.status).toBe('connected');}finally{await r.close();}
},30000);

it('refuses a second runtime on the same directory without disturbing the first owner',async()=>{
 await mkdir('.superpowers/pilot-test',{recursive:true});const dir=await mkdtemp(resolve('.superpowers/pilot-test/owner-'));const first=await openDurablePilot(dir);let second:Awaited<ReturnType<typeof openDurablePilot>>|undefined;
 try{await expect(openDurablePilot(dir).then(r=>{second=r;return r;})).rejects.toThrow('LOCAL_PILOT_IN_USE');expect((await first.journey.read()).item.state).toBe('approved_to_publish');}finally{await second?.close();await first.close();}
 const reopened=await openDurablePilot(dir);await reopened.close();
},30000);
