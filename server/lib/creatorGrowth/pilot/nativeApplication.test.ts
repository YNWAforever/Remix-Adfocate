// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createNativePilotApplication,createNativePilotRuntime} from './nativeApplication.js';
const actor={workspaceId:'00000000-0000-4000-8000-000000000001',creatorId:'00000000-0000-4000-8000-000000000011',sessionHash:'a'.repeat(64)};
it('binds request services to authenticated owner/session and denies changed sessions before collection reads',async()=>{
 let current={...actor};const collection=vi.fn(async()=>({visibility:'private'}));
 const runtime=createNativePilotApplication({live:{resolveActor:async()=>current,authorize:async()=>true},receipts:{collection},proof:{}} as never);
 const service=runtime.routes.create(actor,'verified');await service.collection!('verified','intent');expect(collection).toHaveBeenCalledWith(actor,'intent');
 current={...actor,sessionHash:'b'.repeat(64)};await expect(service.collection!('verified','intent')).rejects.toThrow('PILOT_LIVE_DENIED');expect(collection).toHaveBeenCalledTimes(1);
});
it('assembles durable runtime without opening a client, scheduling or contacting providers',async()=>{
 const query=vi.fn(async()=>[]),publish=vi.fn();
 const runtime=createNativePilotRuntime({sql:{query},repo:{},live:{now:()=>new Date('2030-01-01T00:00:00Z')},authorizeOwner:async()=>true,snapshot:async()=>{throw new Error('not called');},proof:{},worker:{publisher:{publishContainer:publish}},media:{publicOrigin:'https://media.example.invalid'}} as never);
 expect(query).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled();expect(await runtime.runOne({workerId:'offline'})).toBe('idle');expect(query).toHaveBeenCalledTimes(1);expect(publish).not.toHaveBeenCalled();
});
