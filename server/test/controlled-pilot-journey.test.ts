// @vitest-environment node
import {expect,it} from "vitest";
import {createControlledPilotMockApp} from "../lib/creatorGrowth/pilot/mockApp.js";
const headers={"Content-Type":"application/json","X-Pilot-Fixture-Role":"creator","X-Pilot-Fixture-Session":"a".repeat(64)};
const request=(app:ReturnType<typeof createControlledPilotMockApp>,path:string,body?:unknown,role="creator")=>app.request(`http://127.0.0.1/api/controlled-pilot-mock${path}`,{method:body?"POST":"GET",headers:{...headers,"X-Pilot-Fixture-Role":role},...(body?{body:JSON.stringify(body)}:{})});
it("composes owned preview, explicit consent, publication and reload status without proof/reward writes",async()=>{
 const app=createControlledPilotMockApp();const p=await (await request(app,"/preview",{})).json();
 expect(p.sampleOnly).toBe(true);const response=await request(app,"/approve",{...p.confirmation,confirmed:true});expect(response.status).toBe(200);const result=await response.json();expect(result.state).toBe("published");
 expect((await (await request(app,"/current")).json()).id).toBe(result.id);
 expect((await (await request(app,"/operator",undefined,"operator")).json()).counts).toMatchObject({publish:1,proof:0,reward:0});
 expect((await request(app,"/proof",{})).status).toBe(404);
});
it.each(["visitor","same_workspace_creator","other_workspace_creator","brand_member","operator"])("denies private publication to %s",async role=>{
 const app=createControlledPilotMockApp();expect((await request(app,"/preview",{},role)).status).toBe(403);expect((await request(app,"/current",undefined,role)).status).toBe(403);
});
it("denies cross origin requests and unexpected fields",async()=>{
 const app=createControlledPilotMockApp();expect((await app.request("http://127.0.0.1/api/controlled-pilot-mock/preview",{method:"POST",headers:{...headers,Origin:"https://attacker.invalid"},body:"{}"})).status).toBe(403);
 expect((await request(app,"/preview",{sampleOnly:false})).status).toBe(400);
});
it("operator can stop but cannot confer publish or provider-revoke authority",async()=>{
 const app=createControlledPilotMockApp();expect((await request(app,"/stop",{},"creator")).status).toBe(403);
 expect((await request(app,"/stop",{},"operator")).status).toBe(200);
 expect((await request(app,"/preview",{})).status).toBe(409);
 expect((await (await request(app,"/operator",undefined,"operator")).json()).readiness).toMatchObject({liveReady:false,stopped:true,providerRevocation:"unverified"});
});
