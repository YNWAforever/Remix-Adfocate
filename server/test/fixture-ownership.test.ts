import { beforeEach, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({client:null as unknown,deleted:[] as string[],rows:{} as Record<string,Record<string,unknown>[]>}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>h.client}));
vi.mock("../../scripts/run-integration-tests.mjs",()=>({verifyIntegrationIdentity:()=>({runId:"synthetic"})}));
import { cleanup, makeCreator } from "./helpers";
beforeEach(()=>{
  h.deleted=[];h.rows={creators:[{id:"foreign",display_name:"other-run@test.local"}]};
  h.client={auth:{admin:{createUser:async()=>({data:{user:{id:"mine"}},error:null}),deleteUser:async(id:string)=>{h.deleted.push(id);return {error:null};}},
    signInWithPassword:async()=>({data:{session:{access_token:"synthetic-jwt"}},error:null})},
    storage:{from:()=>({list:async()=>({data:[]}),remove:async()=>({error:null})})},rpc:async()=>({data:null,error:null}),
    from(table:string){
      const filters:((row:Record<string,unknown>)=>boolean)[]=[];let mode="read",input:Record<string,unknown>[]=[];
      const q={select:()=>q,insert:(value:Record<string,unknown>|Record<string,unknown>[])=>{mode="insert";input=Array.isArray(value)?value:[value];return q;},
        update:()=>q,delete:()=>{mode="delete";return q;},eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q;},
        neq:(key:string,value:unknown)=>{filters.push(row=>row[key]!==value);return q;},in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return q;},
        like:(key:string,value:string)=>{const pattern=new RegExp("^"+value.split("%").map(part=>part.replaceAll("+","\\+").replaceAll(".","\\.")).join(".*")+"$");filters.push(row=>pattern.test(String(row[key]??"")));return q;},
        then(resolve:(result:unknown)=>unknown){
          const rows=h.rows[table]??[];const matches=rows.filter(row=>filters.every(filter=>filter(row)));
          if(mode==="insert")h.rows[table]=[...rows,...input];
          if(mode==="delete")h.rows[table]=rows.filter(row=>!matches.includes(row));
          return Promise.resolve({data:mode==="insert"?input:matches,error:null}).then(resolve);
        }};return q;
    }};
});
it("cleans only IDs created by this test process, preserving another run with the same naming convention",async()=>{
  await makeCreator("mine@test.local");await cleanup();
  expect(h.rows.creators.some(row=>row.id==="foreign")).toBe(true);
  expect(h.deleted).toContain("mine");expect(h.deleted).not.toContain("foreign");
});
