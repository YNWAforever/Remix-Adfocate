// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createSharedCallbackMock,type FixtureNotice} from './sharedCallbackMock.js';
const notice:FixtureNotice={provenance:'fixture',product:'facebook_login',appId:'111',subject:'222',eventId:'event-1',kind:'deauthorization',issuedAt:1000};
function setup(){
 const legacy=vi.fn(async()=>undefined),pilot=vi.fn(async()=>undefined);
 const verify=vi.fn(async():Promise<FixtureNotice>=>({...notice}));
 const service=createSharedCallbackMock({provenance:'fixture',appId:'111',now:()=>1000,maxAgeMs:5000,verify,
  consumers:[{id:'legacy',handle:legacy},{id:'pilot',handle:pilot}],
  mappings:[{subject:'222',complete:true,consumerIds:['legacy','pilot']}]});
 return {service,verify,legacy,pilot};
}
it('delivers to both explicitly mapped consumers and never claims provider deletion',async()=>{
 const {service,legacy,pilot}=setup();expect(await service.receive('signed-fixture')).toEqual({sampleOnly:true,status:'recorded',outcomes:{legacy:'recorded',pilot:'recorded'}});
 expect(legacy).toHaveBeenCalledOnce();expect(pilot).toHaveBeenCalledWith(notice);
});
it.each(['appId','subject','product','provenance','kind'] as const)('rejects wrong %s without effects',async field=>{
 const {service,verify,legacy,pilot}=setup();verify.mockResolvedValue({...notice,[field]:'wrong'} as FixtureNotice);
 expect((await service.receive('fixture')).status).toBe('held');expect(legacy).not.toHaveBeenCalled();expect(pilot).not.toHaveBeenCalled();
});
it('redacts verification errors and rejects oversized input before verification',async()=>{
 const {service,verify}=setup();verify.mockRejectedValue(new Error('secret-value'));
 expect(JSON.stringify(await service.receive('fixture'))).not.toContain('secret-value');
 verify.mockClear();expect((await service.receive('x'.repeat(8193))).status).toBe('held');expect(verify).not.toHaveBeenCalled();
});
it.each([NaN,Infinity,-1,1001,-5001])('rejects invalid or out-of-window issue time %s',async issuedAt=>{
 const {service,verify,pilot}=setup();verify.mockResolvedValue({...notice,issuedAt});
 expect((await service.receive('fixture')).status).toBe('held');expect(pilot).not.toHaveBeenCalled();
});
it('deduplicates concurrent delivery and returns copies of retained outcomes',async()=>{
 const {service,legacy,pilot}=setup();const results=await Promise.all([service.receive('a'),service.receive('a')]);
 expect(legacy).toHaveBeenCalledOnce();expect(pilot).toHaveBeenCalledOnce();
 const result=await service.receive('a');result.outcomes.pilot='unknown';expect((await service.receive('a')).outcomes.pilot).toBe('recorded');
 expect(results.some(r=>r.status==='recorded')).toBe(true);
});
it('holds event-ID collision instead of delivering changed intent',async()=>{
 const {service,verify,pilot}=setup();await service.receive('a');verify.mockResolvedValue({...notice,kind:'data_deletion'});
 expect((await service.receive('b')).status).toBe('held');expect(pilot).toHaveBeenCalledOnce();
});
it('preserves sibling delivery after failure and never blindly retries unknown effects',async()=>{
 const {service,legacy,pilot}=setup();legacy.mockRejectedValue(new Error('secret-failure'));
 expect(await service.receive('a')).toEqual({sampleOnly:true,status:'unknown',outcomes:{legacy:'unknown',pilot:'recorded'}});
 await service.receive('a');expect(legacy).toHaveBeenCalledOnce();expect(pilot).toHaveBeenCalledOnce();
});
it('supports a deletion notice without marking data erased',async()=>{
 const {service,verify}=setup();verify.mockResolvedValue({...notice,kind:'data_deletion'});
 expect((await service.receive('a')).status).toBe('recorded');
});
it.each([{consumerIds:[]},{consumerIds:['missing']},{consumerIds:['pilot','pilot']}])('rejects incomplete or ambiguous mapping $consumerIds',({consumerIds})=>{
 expect(()=>createSharedCallbackMock({provenance:'fixture',appId:'111',now:()=>1000,maxAgeMs:5000,verify:async()=>notice,consumers:[{id:'pilot',handle:async()=>undefined}],mappings:[{subject:'222',complete:true,consumerIds}]})).toThrow('CALLBACK_MOCK_CONFIG');
});
it('holds an explicitly incomplete inventory without falling back to pilot',async()=>{
 const handle=vi.fn();const service=createSharedCallbackMock({provenance:'fixture',appId:'111',now:()=>1000,maxAgeMs:5000,verify:async()=>notice,consumers:[{id:'pilot',handle}],mappings:[{subject:'222',complete:false,consumerIds:['pilot']}]});
 expect((await service.receive('a')).status).toBe('held');expect(handle).not.toHaveBeenCalled();
});
it('does not accept live dependencies or duplicate subjects',()=>{
 const deps={provenance:'fixture' as const,appId:'111',now:()=>1000,maxAgeMs:5000,verify:async()=>notice,consumers:[{id:'pilot',handle:async()=>undefined}],mappings:[{subject:'222',complete:true,consumerIds:['pilot']}]};
 expect(()=>createSharedCallbackMock({...deps,provenance:'provider'} as never)).toThrow();
 expect(()=>createSharedCallbackMock({...deps,mappings:[...deps.mappings,...deps.mappings]})).toThrow();
});
it('snapshots mapping inputs and strips extraneous fields before dispatch',async()=>{
 const handle=vi.fn();const mapping={subject:'222',complete:true,consumerIds:['pilot']};
 const service=createSharedCallbackMock({provenance:'fixture',appId:'111',now:()=>1000,maxAgeMs:5000,verify:async()=>({...notice,accessToken:'must-not-dispatch'}),consumers:[{id:'pilot',handle}],mappings:[mapping]});
 mapping.consumerIds.splice(0);await service.receive('a');expect(handle).toHaveBeenCalledWith(notice);
});
