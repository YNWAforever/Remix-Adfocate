import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import type { AdminEnv } from "../lib/staffAuth";
const h=vi.hoisted(()=>({fail:false,tables:[] as string[]}));
vi.mock("../lib/supabase",()=>({serviceClient:()=>({from:(table:string)=>{
  h.tables.push(table);let start=0,end=999;
  const rows=table==="creators"?Array.from({length:1201},(_,i)=>({id:String(i),level:"L0"})):table==="point_transactions"?[{id:"p",type:"earn",delta:17,created_at:"2026-10-20T00:00:00Z"}]:[];
  const q={select:()=>q,eq:()=>q,or:()=>q,gte:()=>q,lt:()=>q,order:()=>q,range:(a:number,b:number)=>{start=a;end=b;return q;},then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:h.fail?null:rows.slice(start,end+1),error:h.fail?{message:"sensitive-provider-detail"}:null}).then(resolve)};
  return q;
}})}));
import { adminInsightsRoutes } from "../routes/adminInsights";
beforeEach(()=>{h.fail=false;h.tables=[];vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));});
const app=new Hono<AdminEnv>().use("*",async(c,next)=>{c.set("authorizedWorkspace",{workspaceId:"owned"} as never);await next();}).route("/admin",adminInsightsRoutes);
it("D17 Insights pages past the Data API cap and derives credits from the ledger",async()=>{
 const response=await app.request("/admin/insights?window=7&workspace=owned");expect(response.status).toBe(200);const {insights}=await response.json();
 expect(insights.levels[0].count).toBe(1201);expect(insights.kpis.pointsIssued.value).toBe(17);expect(h.tables).toContain("point_transactions");vi.useRealTimers();
});
it("D17 an unavailable metrics read is recoverable and does not expose provider internals",async()=>{
 h.fail=true;const response=await app.request("/admin/insights?window=7&workspace=owned");expect(response.status).toBe(503);expect(await response.text()).not.toContain("sensitive-provider-detail");vi.useRealTimers();
});
