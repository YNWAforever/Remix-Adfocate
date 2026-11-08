import { describe, expect, it } from "vitest";
import { exportIntegrationData } from "./lifecycle.js";

describe("account integration export",()=>{
  it("paginates every owner-scoped table and excludes credential fields even from malformed metadata",async()=>{
    const reads:Array<{table:string;filters:Record<string,unknown>;from:number;to:number;order?:string}>=[];
    const rows=Array.from({length:2001},(_,i)=>({id:String(i),data:{title:"owned example",accessToken:"secret",nested:{refreshToken:"secret",ciphertext:"secret",codeVerifier:"secret",nonce:"secret",ticketHash:"secret",secret:{keyId:"secret"},subjectHash:"secret",providerProjectId:"secret"}}}));
    const client={from(table:string){const entry={table,filters:{} as Record<string,unknown>,from:0,to:0,order:""};const q={select:()=>q,eq:(key:string,value:unknown)=>{entry.filters[key]=value;return q;},order:(column:string)=>{entry.order=column;return q;},range:(from:number,to:number)=>{reads.push({...entry,from,to});return Promise.resolve(table==="integration_sync_runs"&&entry.order!=="request_id"?{data:null,error:{code:"42703"}}:{data:table==="integration_connections"?rows.slice(from,to+1):[],error:null});}};return q;}} as unknown as Parameters<typeof exportIntegrationData>[0];
    const result=await exportIntegrationData(client,{creatorId:"creator",workspaceId:"workspace"},false);
    expect(result.integration_connections).toHaveLength(2001);expect(reads.every(read=>read.filters.creator_id==="creator"&&read.filters.workspace_id==="workspace")).toBe(true);
    expect(reads.some(read=>/credentials|oauth_states/.test(read.table))).toBe(false);expect(JSON.stringify(result)).not.toContain("secret");
  });
});
