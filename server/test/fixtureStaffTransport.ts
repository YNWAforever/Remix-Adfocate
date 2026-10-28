// Compatibility for business integration fixtures that formerly used a shared secret.
// The application still receives and verifies a real human JWT + active membership.
// Auth-gate tests use createApp directly, so rejection/auto-enrol assertions are not bypassed.
import { randomUUID } from "node:crypto";
import { createApp } from "../app.js";
import { DEMO_WS, FIXTURE_WORKSPACE_SLUG, makeStaff, serviceForTests, grantStaffFixture } from "./helpers.js";
import { captureFixtureRows } from "./ownedFixtureTransport.js";

export function createFixtureStaffApp() {
  const result=createApp(),original=result.app.request.bind(result.app);
  type Actor=Awaited<ReturnType<typeof makeStaff>>;
  const actors=new Map<string,Actor>(),creating=new Map<string,Promise<Actor>>();
  async function fixtureOperator(key="default"):Promise<Actor>{
    const actor=actors.get(key);
    if(actor){const check=await serviceForTests().auth.getUser(actor.jwt);if(!check.error&&check.data.user)return actor;actors.delete(key);}
    let pending=creating.get(key);
    if(!pending){
      pending=makeStaff(`business-fixture-${randomUUID()}@test.local`,DEMO_WS)
        .then(async(next)=>{
          await grantStaffFixture(next.userId,DEMO_WS,"workspace_admin");
          await grantStaffFixture(next.userId,null,"content_editor");
          actors.set(key,next);return next;
        });
      creating.set(key,pending);
    }
    try{return await pending;}finally{creating.delete(key);}
  }
  result.app.request=(async(input,init,env,ctx)=>{
    const headers=new Headers(init?.headers ?? (input instanceof Request?input.headers:undefined));
    const secret=headers.get("x-admin-secret");
    if(secret && secret===(process.env.ADMIN_SECRET||"test-admin-secret") && !headers.has("Authorization")){
      const staff=await fixtureOperator();headers.delete("x-admin-secret");headers.set("Authorization",`Bearer ${staff.jwt}`);
      headers.set("X-Workspace-Slug",FIXTURE_WORKSPACE_SLUG);
      const response=await original(input,{...init,headers},env,ctx);
      if(process.env.INTEGRATION_MUTATION_OWNERSHIP==="1"&&response.ok&&["POST","PATCH"].includes(init?.method??"GET")){
        const path=new URL(input instanceof Request?input.url:String(input),"http://fixture.invalid").pathname;
        const table=path.startsWith("/api/admin/academy")?"academy_content":path.startsWith("/api/admin/content")?"content_items":null;
        if(table){const value=await response.clone().json().catch(()=>null);if(value?.item)captureFixtureRows(table,value.item);}
      }
      return response;
    }
    return original(input,init,env,ctx);
  }) as typeof result.app.request;
  return {...result,fixtureOperator};
}
