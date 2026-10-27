// @vitest-environment node
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('../../scripts/run-integration-tests.mjs',()=>({verifyIntegrationIdentity:()=>({runId:'01a16483-e55d-7332-9ddc-7e8a3f68eb11'})}));
const owned='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
let requests:{url:string;method:string}[];
beforeEach(()=>{
 vi.resetModules();requests=[];vi.stubEnv('SUPABASE_URL','http://127.0.0.1:56521');vi.stubEnv('SUPABASE_SERVICE_KEY','owned-service-fixture');vi.stubEnv('SUPABASE_ANON_KEY','owned-anon-fixture');vi.stubEnv('INTEGRATION_MUTATION_OWNERSHIP','1');
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),method=init?.method??'GET';requests.push({url,method});
  if(method==='POST')return new Response(JSON.stringify([{id:owned}]),{status:201,headers:{'Content-Type':'application/json'}});
  return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
 }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('D19 refuses a cleanup selector when no exact current-run IDs are owned',async()=>{
 const {serviceForTests}=await import('./helpers');const result=await serviceForTests().from('content_items').delete().like('slug','test-%');
 expect(result.error?.code).toBe('FIXTURE_NOT_OWNED');expect(requests).toHaveLength(0);
});
it('D19 constrains a broad cleanup selector to exact successful creation IDs',async()=>{
 const {serviceForTests}=await import('./helpers');const svc=serviceForTests();await svc.from('content_items').insert({id:owned,title_zh:'Owned fixture'}).select('id');
 const result=await svc.from('content_items').delete().like('slug','test-%');expect(result.error).toBeNull();
 const url=new URL(requests.find(r=>r.method==='DELETE')!.url);expect(url.searchParams.get('id')).toBe(`in.(${owned})`);expect(url.searchParams.get('slug')).toBe('like.test-%');
});
it('D19 refuses an explicitly foreign ID even when the same table has an owned ID',async()=>{
 const {serviceForTests}=await import('./helpers');const svc=serviceForTests();await svc.from('content_items').insert({id:owned,title_zh:'Owned fixture'}).select('id');
 const result=await svc.from('content_items').update({title_zh:'Must not overwrite'}).eq('id',foreign);expect(result.error?.code).toBe('FIXTURE_NOT_OWNED');expect(requests.filter(r=>r.method==='PATCH')).toHaveLength(0);
});
it('D19 allows a child cleanup only when its parent selector is an exact owned creator ID',async()=>{
 const {serviceForTests}=await import('./helpers');const svc=serviceForTests();await svc.from('creators').insert({id:owned}).select('id');
 expect((await svc.from('point_transactions').delete().eq('creator_id',owned)).error).toBeNull();
 expect((await svc.from('point_transactions').delete().eq('creator_id',foreign)).error?.code).toBe('FIXTURE_NOT_OWNED');expect(requests.filter(r=>r.method==='DELETE')).toHaveLength(1);
});
it('D19 passes an absolute string URL to the external-fetch deny preload across URL realms',async()=>{
 const {serviceForTests}=await import('./helpers');await serviceForTests().from('workspaces').select('id');
 expect(typeof vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('string');
});
it('D19 attests an RPC-created child through an exact owned workspace before deleting that child ID',async()=>{
 const {serviceForTests}=await import('./helpers');const svc=serviceForTests();await svc.from('workspaces').insert({id:owned}).select('id');
 vi.mocked(globalThis.fetch).mockImplementationOnce(async()=>new Response(JSON.stringify([{id:foreign,workspace_id:owned}]),{status:200}));
 const result=await svc.from('mission_publication_proof_assets').delete().eq('id',foreign);expect(result.error).toBeNull();
 expect(vi.mocked(globalThis.fetch).mock.calls.some(([,init])=>init?.method==='DELETE')).toBe(true);
});
it('D19 rejects a child belonging to a workspace outside the exact owned scope',async()=>{
 const {serviceForTests}=await import('./helpers');const svc=serviceForTests();await svc.from('workspaces').insert({id:owned}).select('id');
 vi.mocked(globalThis.fetch).mockImplementationOnce(async()=>new Response(JSON.stringify([{id:foreign,workspace_id:foreign}]),{status:200}));
 const result=await svc.from('mission_publication_proof_assets').delete().eq('id',foreign);expect(result.error?.code).toBe('FIXTURE_NOT_OWNED');
 expect(vi.mocked(globalThis.fetch).mock.calls.some(([,init])=>init?.method==='DELETE')).toBe(false);
});

it('D19 captures RPC-created work item IDs only after an owned-parent read',async()=>{
 const {serviceForTests}=await import('./helpers');const svc=serviceForTests();await svc.from('workspaces').insert({id:owned}).select('id');
 vi.mocked(globalThis.fetch).mockImplementationOnce(async()=>new Response(JSON.stringify([{id:foreign,workspace_id:owned}]),{status:200}));
 await svc.from('mission_work_items').select('id,workspace_id');
 const result=await svc.from('mission_publication_instructions').update({frozen_at:'fixture'}).eq('mission_work_item_id',foreign);
 expect(result.error).toBeNull();
});
it('D19 captures an owned workflow read before an exact fulfilment update',async()=>{
 const {serviceForTests}=await import('./helpers');const svc=serviceForTests();await svc.from('workspaces').insert({id:owned}).select('id');
 vi.mocked(globalThis.fetch).mockImplementationOnce(async()=>new Response(JSON.stringify([{id:foreign,workspace_id:owned}]),{status:200}));
 await svc.from('mission_workflows').select('id,workspace_id');
 const result=await svc.from('mission_fulfillments').update({status:'shipped'}).eq('mission_workflow_id',foreign);
 expect(result.error).toBeNull();
});

it.each([['mission_fulfillments','mission_workflow_id','mission_workflows'],['mission_publication_instructions','mission_work_item_id','mission_work_items']])('D19 attests an unread RPC parent before updating %s',async(table,field,parentTable)=>{
 const {serviceForTests}=await import('./helpers');const svc=serviceForTests();await svc.from('workspaces').insert({id:owned}).select('id');
 vi.mocked(globalThis.fetch).mockImplementationOnce(async(input)=>{expect(String(input)).toContain(`/rest/v1/${parentTable}?`);return new Response(JSON.stringify([{id:foreign,workspace_id:owned}]),{status:200});});
 expect((await svc.from(table).update({status:'fixture'}).eq(field,foreign)).error).toBeNull();
});
it('D19 refuses an unread RPC parent in a foreign workspace',async()=>{
 const {serviceForTests}=await import('./helpers');const svc=serviceForTests();await svc.from('workspaces').insert({id:owned}).select('id');
 vi.mocked(globalThis.fetch).mockImplementationOnce(async()=>new Response(JSON.stringify([{id:foreign,workspace_id:foreign}]),{status:200}));
 expect((await svc.from('mission_fulfillments').update({status:'shipped'}).eq('mission_workflow_id',foreign)).error?.code).toBe('FIXTURE_NOT_OWNED');
});
