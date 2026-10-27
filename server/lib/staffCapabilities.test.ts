import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { requireCapability, readPlatformCapabilities, STAFF_CAPABILITIES, staffRouteRequirement, type StaffWorkspaceRole } from "./staffCapabilities";
import { adminRoutes } from "../routes/admin";
const scope={userId:"actor",workspaceId:"owned",workspaceSlug:"owned"};
function client(role:string|null,active=true,error?:unknown) {
 const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:role?{user_id:"actor",workspace_id:"owned",role,active,revision:1}:null,error})};
 return {from:()=>q} as unknown as SupabaseClient;
}
const expected:Record<StaffWorkspaceRole,string[]>={workspace_admin:[...STAFF_CAPABILITIES],operator:["creator.read","creator.review","application.review","submission.review","proof.review","completion.approve","reward.read"],reviewer:["creator.read","submission.review","proof.review"],finance_viewer:["reward.read"]};
for(const [role,allowed] of Object.entries(expected))for(const capability of STAFF_CAPABILITIES)it(`D18 ${role} ${allowed.includes(capability)?"can":"cannot"} ${capability}`,async()=>{
 const work=requireCapability(client(role),scope,capability);
 if(allowed.includes(capability))expect((await work).role).toBe(role);else await expect(work).rejects.toMatchObject({code:"STAFF_CAPABILITY_REQUIRED",status:403});
});
it.each([null,"owner","member","unknown"])("D18 missing or brand-only role %s is never promoted",async role=>{
 await expect(requireCapability(client(role),scope,"creator.read")).rejects.toMatchObject({status:403});
});
it("D18 role lookup errors cannot become empty grants or login errors",async()=>{
 await expect(requireCapability(client(null,true,{code:"42P01"}),scope,"reward.read")).rejects.toMatchObject({code:"STAFF_CAPABILITY_SCHEMA_REQUIRED",status:503});
 await expect(requireCapability(client(null,true,{code:"08006"}),scope,"reward.read")).rejects.toMatchObject({code:"STAFF_CAPABILITY_UNAVAILABLE",status:503});
});
it("D18 a platform grant requires its own active role and active human staff identity",async()=>{
 expect(await readPlatformCapabilities(client("workspace_admin"),{userId:"actor",email:"",active:true})).toEqual([]);
 expect(await readPlatformCapabilities(client("content_editor"),{userId:"actor",email:"",active:true})).toEqual(["content.manage"]);
 expect(await readPlatformCapabilities(client("content_editor"),{userId:"actor",email:"",active:false})).toEqual([]);
 expect(await readPlatformCapabilities(client("content_editor",false),{userId:"actor",email:"",active:true})).toEqual([]);
});
it("D18 all mounted business routes have a capability requirement",()=>{
 const routes=adminRoutes.routes.filter(r=>r.method!=="ALL");expect(routes.length).toBeGreaterThan(80);
 for(const r of routes)expect(staffRouteRequirement(r.method,r.path).kind,`${r.method} ${r.path}`).not.toBe("deny");
});
it("D18 unrecognized methods and paths fail closed, including inside known scopes",()=>{
 for(const [method,path] of [["POST","me"],["GET","me/private"],["POST","academy/unmapped-action"],["POST","reward-handoffs/unmapped-action"],["POST","unmapped"]])expect(staffRouteRequirement(method,path)).toEqual({kind:"deny"});
});
