import { beforeEach, expect, it } from "vitest";
import { loadStudioContext } from "../lib/studio/assistantContext";

let revoked: string|null=null;
let reads: Array<{table:string;select:string;filters:Record<string,unknown>}>=[];
let savedContext="";
let requirements="Include #合作";
function client() {
  return {from(table:string) {
    const read={table,select:"",filters:{} as Record<string,unknown>}; reads.push(read);
    const q={select(fields:string){read.select=fields;return q;},eq(key:string,value:unknown){read.filters[key]=value;return q;},order(){return q;},limit(){return q;},maybeSingle(){return q;},then(resolve:(result:unknown)=>unknown){
      const data=table==="studio_threads"?{id:"thread",title:"Tea",topic:"creation",mission_id:"mission"}:table==="studio_sources"?[{id:"source",title:"Note",content:"PRIVATE EVIDENCE",status:"unverified",revoked_at:revoked}]:table==="missions"?{id:"mission",title:"Tea mission",description:"Make a 30-second film",platforms:["instagram"],deliverables:["video"],deadline:null,requirements,dos:["Disclose"],donts:["No health claims"],key_messages:["Real experience"]}:read.filters.context_version===savedContext?[{message:"Give me options",result:{answer:"Option A: detail; Option B: story"}}]:[];
      return Promise.resolve({data,error:null}).then(resolve);
    }};return q;
  }} as unknown as Parameters<typeof loadStudioContext>[0];
}
beforeEach(()=>{revoked=null;reads=[];savedContext="";requirements="Include #合作";});
it("loads only the selected user-visible mission and retains same-context follow-ups",async()=>{
  const first=await loadStudioContext(client(),client(),"owner","workspace","conversation");
  savedContext=first!.contextVersion;
  const next=await loadStudioContext(client(),client(),"owner","workspace","conversation");
  expect(next!.context.mission).toMatchObject({title:"Tea mission",description:"Make a 30-second film"});
  expect(next!.history).toEqual([{role:"user",content:"Give me options"},{role:"assistant",content:"Option A: detail; Option B: story"}]);
  const missionRead=reads.find(r=>r.table==="missions")!;
  expect(missionRead.filters).toEqual({id:"mission",workspace_id:"workspace"});
  expect(missionRead.select).not.toMatch(/\*|cash|reward/);
  expect(savedContext.length).toBeLessThanOrEqual(80);
  expect(missionRead.select).toContain("requirements,dos,donts,key_messages");
});
it("includes required disclosures and prohibited claims in the history basis",async()=>{
  const first=await loadStudioContext(client(),client(),"owner","workspace","conversation");savedContext=first!.contextVersion;
  requirements="Include #廣告";
  const next=await loadStudioContext(client(),client(),"owner","workspace","conversation");
  expect(next!.context.mission).toMatchObject({requirements:"Include #廣告",donts:["No health claims"]});
  expect(next!.history).toEqual([]);expect(next!.contextVersion).not.toBe(savedContext);
});
it("revocation changes the history basis and excludes old derived replies, including late-arriving results",async()=>{
  const first=await loadStudioContext(client(),client(),"owner","workspace","conversation"); savedContext=first!.contextVersion;
  revoked="2026-10-31T01:00:00Z";
  const next=await loadStudioContext(client(),client(),"owner","workspace","conversation");
  expect(next!.context.sources).toEqual([]); expect(next!.history).toEqual([]);
  expect(next!.contextVersion).not.toBe(savedContext);
  expect(reads.filter(r=>r.table==="assistant_requests").at(-1)?.filters).toMatchObject({creator_id:"owner",workspace_id:"workspace",conversation_id:"conversation",state:"saved",context_version:next!.contextVersion});
});
