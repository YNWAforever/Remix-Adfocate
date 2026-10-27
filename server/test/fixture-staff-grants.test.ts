// @vitest-environment node
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({id:'11111111-1111-4111-8111-111111111111',owned:true,sql:vi.fn(()=>''),identity:{projectId:'adfocate-r1-shaped-20261023'},request:vi.fn(async()=>new Response('{}'))}));
vi.mock('../app.js',()=>({createApp:()=>({app:{request:h.request}})}));
vi.mock('./ownedFixtureTransport.js',()=>({ownsFixtureId:()=>h.owned,createOwnedFixtureFetch:vi.fn(),fixtureOwnership:()=>({}),captureFixtureRows:vi.fn()}));
vi.mock('../../scripts/audit/local-targets.mjs',()=>({verifiedTarget:()=>({identity:h.identity,sql:h.sql})}));
vi.mock('./helpers.js',async original=>({...await original<object>(),makeStaff:async()=>({userId:h.id,email:'owned@test.local',jwt:'fixture-session'}),serviceForTests:()=>({auth:{getUser:async()=>({data:{user:{id:h.id}},error:null})}})}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();h.owned=true;vi.stubEnv('INTEGRATION_CAPABILITY_FIXTURES','1');vi.stubEnv('INTEGRATION_TARGET_IDENTITY_JSON',JSON.stringify(h.identity));});
afterEach(()=>vi.unstubAllEnvs());
it('D19 compatibility operator explicitly receives workspace and platform grants before business requests',async()=>{
 const {createFixtureStaffApp}=await import('./fixtureStaffTransport');await createFixtureStaffApp().fixtureOperator();
 expect(h.sql.mock.calls.flat().filter(x=>String(x).includes('bootstrap_staff_access')).join('\n')).toContain('workspace_admin');
 expect(h.sql.mock.calls.flat().filter(x=>String(x).includes('bootstrap_staff_access')).join('\n')).toContain('content_editor');
});
it('D19 compatibility fixture cannot grant a pre-existing unowned staff subject',async()=>{
 h.owned=false;const {createFixtureStaffApp}=await import('./fixtureStaffTransport');await expect(createFixtureStaffApp().fixtureOperator()).rejects.toThrow(/owned/);expect(h.sql).not.toHaveBeenCalled();
});
