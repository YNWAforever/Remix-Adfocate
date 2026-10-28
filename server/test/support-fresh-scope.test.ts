// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({createClient:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:h.createClient}));
const id='11111111-1111-4111-8111-111111111111',namespace='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
function fresh(patch:Record<string,unknown>={}){
 vi.stubEnv('INTEGRATION_MUTATION_OWNERSHIP','1');vi.stubEnv('INTEGRATION_FIXTURE_NAMESPACE',namespace);
 vi.stubEnv('INTEGRATION_TARGET_IDENTITY_JSON',JSON.stringify({runId}));
 vi.stubEnv('INTEGRATION_FIXTURE_SCOPE_JSON',JSON.stringify({runId,workspaceIds:[id]}));
 vi.stubEnv('INTEGRATION_FRESH_WORKSPACE_JSON',JSON.stringify({workspaceId:id,slug:`d19-support-${namespace}`,namespace,createdThisRun:true,...patch}));
}
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();vi.stubEnv('INTEGRATION_FRESH_WORKSPACE_JSON','');});
afterEach(()=>vi.unstubAllEnvs());
it('retains the existing default workspace when fresh support scope is absent',async()=>{
 const helpers=await import('./helpers');expect(helpers.DEMO_WS).toBe('00000000-0000-0000-0000-0000000000aa');expect(h.createClient).not.toHaveBeenCalled();
});
it('uses the exact newly-created support workspace and slug before any client setup',async()=>{
 fresh();const helpers=await import('./helpers')as Record<string,unknown>;
 expect(helpers.DEMO_WS).toBe(id);expect(helpers.FIXTURE_WORKSPACE_SLUG).toBe(`d19-support-${namespace}`);expect(h.createClient).not.toHaveBeenCalled();
});
it.each([{workspaceId:'invalid'},{createdThisRun:false},{namespace:runId},{slug:'demo'}])('rejects malformed or historical fresh scope before creating a client: %j',async patch=>{
 fresh(patch);await expect(import('./helpers')).rejects.toThrow(/fresh.*scope/i);expect(h.createClient).not.toHaveBeenCalled();
});
it('rejects a workspace outside the exact attested current scope',async()=>{
 fresh();vi.stubEnv('INTEGRATION_FIXTURE_SCOPE_JSON',JSON.stringify({runId,workspaceIds:[namespace]}));await expect(import('./helpers')).rejects.toThrow(/fresh.*scope/i);expect(h.createClient).not.toHaveBeenCalled();
});
it('rejects a fresh workspace without mutation ownership enabled',async()=>{
 fresh();vi.stubEnv('INTEGRATION_MUTATION_OWNERSHIP','0');await expect(import('./helpers')).rejects.toThrow(/fresh.*scope/i);expect(h.createClient).not.toHaveBeenCalled();
});
it('rejects stale target attestation or malformed JSON before any client setup',async()=>{
 fresh();vi.stubEnv('INTEGRATION_TARGET_IDENTITY_JSON',JSON.stringify({runId:namespace}));await expect(import('./helpers')).rejects.toThrow(/fresh.*scope/i);expect(h.createClient).not.toHaveBeenCalled();
});
