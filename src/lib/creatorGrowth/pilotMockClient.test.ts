// @vitest-environment node
import {afterEach,expect,it,vi} from "vitest";
import {createHash,webcrypto} from "node:crypto";
import {createPilotMockClient} from "./pilotMockClient";
import {createMockMissionPilot} from "../../../server/lib/creatorGrowth/pilot/missionService";
const actor={workspaceId:"00000000-0000-4000-8000-000000000001",creatorId:"00000000-0000-4000-8000-000000000011",sessionHash:"a".repeat(64)};
afterEach(()=>vi.unstubAllGlobals());
it("projects only safe mock preview fields and validates exact JPEG bytes",async()=>{
 const service=createMockMissionPilot(),p=await service.preview(actor),bytes=service.image();
 vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.endsWith("/image")?new Response(bytes,{headers:{"Content-Type":"image/jpeg"}}):Response.json({...p,privateToken:"never returned"})));
 const client=createPilotMockClient();expect(await client.preview()).not.toHaveProperty("privateToken");const url=await client.image();expect(url.startsWith("blob:")).toBe(true);URL.revokeObjectURL(url);
});
it.each(["sampleOnly","imagePath","nonce"])("rejects forged %s preview",async field=>{
 const p=await createMockMissionPilot().preview(actor);const bad=field==="nonce"?{...p,confirmation:{...p.confirmation,nonce:"bad"}}:{...p,[field]:field==="sampleOnly"?false:"https://external.invalid/image"};
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(bad)));await expect(createPilotMockClient().preview()).rejects.toThrow("PILOT_RESPONSE_INVALID");
});
it("rejects substituted image bytes",async()=>{
 const p=await createMockMissionPilot().preview(actor);vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.endsWith("/image")?new Response(new Uint8Array([1,2,3]),{headers:{"Content-Type":"image/jpeg"}}):Response.json(p)));
 const client=createPilotMockClient();await client.preview();await expect(client.image()).rejects.toThrow("PILOT_RESPONSE_INVALID");expect(p.imageSha256).not.toBe(createHash("sha256").update(new Uint8Array([1,2,3])).digest("hex"));
});
it("rejects live-proof claims and session loss",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({sampleOnly:true,canSubmitRealProof:true})));await expect(createPilotMockClient().current()).rejects.toThrow("PILOT_RESPONSE_INVALID");
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(null,{status:401})));await expect(createPilotMockClient().current()).rejects.toThrow("PILOT_RECHECK_REQUIRED");
});
