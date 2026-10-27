// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
beforeEach(()=>{vi.resetModules();vi.stubEnv('SUPABASE_URL','http://127.0.0.1:56521');vi.stubEnv('INTEGRATION_OWNED_IDS_PATH','');vi.stubEnv('INTEGRATION_OWNED_JOURNAL','');});
afterEach(()=>vi.unstubAllEnvs());
it.each(['close_due_campaigns','snapshot_campaign_leaderboards'])('blocks the database-wide %s RPC before it can mutate prior fixtures',async name=>{
 const delegate=vi.fn(async()=>new Response('1',{status:200}));const {createOwnedFixtureFetch}=await import('./ownedFixtureTransport');
 const response=await createOwnedFixtureFetch(delegate)(`http://127.0.0.1:56521/rest/v1/rpc/${name}`,{method:'POST',body:'{}'});
 expect(response.status).toBe(403);expect((await response.json()).code).toBe('FIXTURE_UNSCOPED_RPC');expect(delegate).not.toHaveBeenCalled();
});
it('cannot make a global RPC safe merely by passing an owned campaign ID',async()=>{
 const delegate=vi.fn(async()=>new Response('1',{status:200}));const {createOwnedFixtureFetch,captureFixtureRows}=await import('./ownedFixtureTransport');
 captureFixtureRows('campaigns',{id:'11111111-1111-4111-8111-111111111111'});
 const response=await createOwnedFixtureFetch(delegate)('http://127.0.0.1:56521/rest/v1/rpc/close_due_campaigns',{method:'POST',body:JSON.stringify({p_campaign:'11111111-1111-4111-8111-111111111111'})});
 expect(response.status).toBe(403);expect(delegate).not.toHaveBeenCalled();
});
it('keeps the existing exact campaign RPC transport intact',async()=>{
 const delegate=vi.fn(async()=>new Response('{}',{status:200}));const {createOwnedFixtureFetch}=await import('./ownedFixtureTransport');
 const response=await createOwnedFixtureFetch(delegate)('http://127.0.0.1:56521/rest/v1/rpc/close_campaign',{method:'POST',body:'{}'});
 expect(response.status).toBe(200);expect(delegate).toHaveBeenCalledOnce();
});
it.each(['close_due_campaigns','snapshot_campaign_leaderboards'])('permits %s only after the pristine target guard accepts the exact current campaign IDs',async name=>{
 const delegate=vi.fn(async()=>new Response('1',{status:200})),authorize=vi.fn();
 const {createOwnedFixtureFetch,captureFixtureRows}=await import('./ownedFixtureTransport');
 const id='11111111-1111-4111-8111-111111111111';captureFixtureRows('campaigns',{id});
 const response=await createOwnedFixtureFetch(delegate,authorize)(`http://127.0.0.1:56521/rest/v1/rpc/${name}`,{method:'POST',body:'{}'});
 expect(response.status).toBe(200);expect(authorize).toHaveBeenCalledWith([id]);expect(delegate).toHaveBeenCalledOnce();
 expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(delegate.mock.invocationCallOrder[0]);
});
it('fails closed before delegation when the pristine target or campaign inventory drifts',async()=>{
 const delegate=vi.fn(async()=>new Response('1',{status:200}));
 const {createOwnedFixtureFetch}=await import('./ownedFixtureTransport');
 const response=await createOwnedFixtureFetch(delegate,()=>{throw new Error('pristine target drift');})('http://127.0.0.1:56521/rest/v1/rpc/close_due_campaigns',{method:'POST',body:'{}'});
 expect(response.status).toBe(403);expect(delegate).not.toHaveBeenCalled();
});
