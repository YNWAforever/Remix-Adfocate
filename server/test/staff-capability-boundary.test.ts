import { beforeEach, expect, it, vi } from "vitest";
const WS="123e4567-e89b-42d3-a456-426614174000", USER="123e4567-e89b-42d3-a456-426614174001";
const h=vi.hoisted(()=>({role:"finance_viewer",platform:false,roleActive:true,staffActive:true,memberActive:true,missing:false,writes:[] as string[]}));
vi.mock("../lib/supabase",()=>({
 makeUserClient:()=>({auth:{getUser:async()=>({data:{user:{id:USER,email:"owned@example.invalid"}},error:null})}}),
 serviceClient:()=>({from:(table:string)=>{
  const filters=new Map<string,unknown>();
  const row=table==="staff_users"?{user_id:USER,email:"owned@example.invalid",active:h.staffActive}:table==="brand_users"?{user_id:USER,workspace_id:WS,active:h.memberActive,workspaces:{id:WS,slug:"owned"}}:table==="staff_workspace_roles"?{user_id:USER,workspace_id:WS,role:h.role,active:h.roleActive,revision:0}:table==="staff_platform_roles"?(h.platform?{user_id:USER,role:"content_editor",active:true}:null):{id:WS,workspace_id:WS,slug:"owned",reward_processing_days:7};
  const result=()=>({data:row&&[...filters].every(([key,value])=>!(key in row)||row[key as keyof typeof row]===value)?row:null,error:h.missing&&table.startsWith("staff_")&&table.endsWith("roles")?{code:"42P01",message:"relation missing"}:null});
  const q={select:()=>q,eq:(key:string,value:unknown)=>{filters.set(key,value);return q;},order:()=>q,maybeSingle:async()=>result(),single:async()=>result(),then:(done:(v:unknown)=>unknown)=>Promise.resolve({...result(),data:[]}).then(done)};return q;
 },rpc:async(name:string)=>{h.writes.push(name);return {data:{reward_processing_days:7},error:null};}}),
}));
import { createApp } from "../app";
const request=(path:string,method="GET",body?:unknown)=>createApp().app.request("/api/admin"+path,{method,headers:{Authorization:"Bearer explicit-fake-transport","X-Workspace-Slug":"owned","Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{Object.assign(h,{role:"finance_viewer",platform:false,roleActive:true,staffActive:true,memberActive:true,missing:false});h.writes=[];});
it("D18 finance cannot change the reward processing window or reach the settings write",async()=>{
 const r=await request("/reward-handoffs/settings","PUT",{days:7});expect(r.status).toBe(403);expect(h.writes).toEqual([]);
});
it("D18 a reviewer cannot create missions, including through a direct API URL",async()=>{
 h.role="reviewer";const r=await request("/missions","POST",{workspace_id:WS,slug:"owned-mission",title:"Owned mission",mission_type:"ugc"});expect(r.status).toBe(403);expect(h.writes).toEqual([]);
});
it("D18 a workspace admin does not inherit access to global Academy drafts",async()=>{
 h.role="workspace_admin";const r=await request("/academy");expect(r.status).toBe(403);
});
it("D18 inactive role remains denied even with an active staff identity and membership",async()=>{
 h.role="workspace_admin";h.roleActive=false;const r=await request("/applications");expect(r.status).toBe(403);
});
it("D18 missing grant schema is a recoverable schema failure, separate from missing membership",async()=>{
 h.missing=true;const r=await request("/applications");expect(r.status).toBe(503);expect((await r.json()).code).toBe("STAFF_CAPABILITY_SCHEMA_REQUIRED");
});
it("D18 access discovery reports independent workspace and platform capabilities",async()=>{
 const r=await request("/access");expect(r.status).toBe(200);expect((await r.json()).access).toMatchObject({workspace:{role:"finance_viewer",capabilities:["reward.read"]},platformCapabilities:[]});
});
it("D18 a permitted grant endpoint attributes the command to the authenticated actor",async()=>{
 h.role="workspace_admin";const r=await request("/staff-access/123e4567-e89b-42d3-a456-426614174002","PUT",{role:"reviewer",active:true,expectedRevision:0,requestId:"123e4567-e89b-42d3-a456-426614174009",reason:"Owned fixture grant",actorId:"spoofed"});
 expect(r.status).toBe(200);expect(h.writes).toEqual(["set_staff_workspace_role"]);
});
