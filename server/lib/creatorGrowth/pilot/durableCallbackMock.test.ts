// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs';
vi.mock('node:fs',async importOriginal=>({...await importOriginal<typeof import('node:fs')>()}));
import {openDurableCallbackMockJournal} from './durableCallbackMock.js';
import {createSharedCallbackMock,type FixtureNotice} from './sharedCallbackMock.js';
const roots:string[]=[];const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of closers.splice(0))await close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function open(path?:string){const directory=path??resolve('.superpowers',`callback-test-${randomUUID()}`);if(!path){roots.push(directory);await mkdir(directory,{recursive:true});}const store=await openDurableCallbackMockJournal({directory,provenance:'fixture',appId:'111'});closers.push(store.close);return {store,directory};}
const notice:FixtureNotice={provenance:'fixture',product:'facebook_login',appId:'111',subject:'222',eventId:'event-1',kind:'deauthorization',issuedAt:1000};
function service(journal:Awaited<ReturnType<typeof openDurableCallbackMockJournal>>,handle=vi.fn(async()=>undefined),ids=['legacy','pilot']){
 return {handle,dispatch:createSharedCallbackMock({provenance:'fixture',appId:'111',now:()=>1000,maxAgeMs:5000,verify:async()=>notice,journal,consumers:ids.map(id=>({id,handle})),mappings:[{subject:'222',complete:true,consumerIds:ids}]})};
}
it('persists receipt outcomes across reopen and never invokes handlers again',async()=>{
 const {store,directory}=await open();const first=service(store);expect((await first.dispatch.receive('fixture')).status).toBe('recorded');await store.close();
 const second=service((await open(directory)).store);expect((await second.dispatch.receive('fixture')).status).toBe('recorded');expect(second.handle).not.toHaveBeenCalled();
 const disk=await readFile(join(directory,'callbacks.jsonl'),'utf8');expect(disk).not.toContain('fixture-body-secret');expect(disk).not.toContain('222');
});
it('records a durable claim before effects and recovers an interrupted handler as unknown',async()=>{
 const {store,directory}=await open();let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
 const handle=vi.fn(async()=>{entered();await new Promise<void>(r=>release=r);});const first=service(store,handle,['pilot']);const delivery=first.dispatch.receive('fixture-body-secret');await started;
 expect(await readFile(join(directory,'callbacks.jsonl'),'utf8')).toContain('pending');await store.close();release();expect((await delivery).status).toBe('unknown');
 const second=service((await open(directory)).store,undefined,['pilot']);expect((await second.dispatch.receive('fixture')).status).toBe('unknown');expect(second.handle).not.toHaveBeenCalled();
});
it('holds a changed consumer inventory after restart',async()=>{
 const {store,directory}=await open();await service(store).dispatch.receive('fixture');await store.close();
 const next=service((await open(directory)).store,undefined,['pilot']);expect((await next.dispatch.receive('fixture')).status).toBe('held');expect(next.handle).not.toHaveBeenCalled();
});
it('rejects concurrent owners and wrong App binding without wiping evidence',async()=>{
 const {store,directory}=await open();await expect(open(directory)).rejects.toThrow('LOCAL_PILOT_IN_USE');await service(store).dispatch.receive('fixture');await store.close();
 const before=await readFile(join(directory,'callbacks.jsonl'),'utf8');await expect(openDurableCallbackMockJournal({directory,provenance:'fixture',appId:'999'})).rejects.toThrow('CALLBACK_JOURNAL_INVALID');expect(await readFile(join(directory,'callbacks.jsonl'),'utf8')).toBe(before);
});
it.each(['truncated','tampered','complete-line-truncation'])('fails closed on %s journal, preserving original bytes',async fault=>{
 const {store,directory}=await open();await service(store).dispatch.receive('fixture');await store.close();const file=join(directory,'callbacks.jsonl');const original=await readFile(file,'utf8');const damaged=fault==='truncated'?original.slice(0,-4):fault==='complete-line-truncation'?original.split('\n')[0]+'\n':original.replace('recorded','unknown');await writeFile(file,damaged);
 await expect(open(directory)).rejects.toThrow('CALLBACK_JOURNAL_INVALID');expect(await readFile(file,'utf8')).toBe(damaged);
});
it('preserves per-consumer unknown outcomes on repeated delivery and reopen',async()=>{
 const {store,directory}=await open();const handle=vi.fn(async()=>{throw Error('sensitive-error');});const first=service(store,handle);expect((await first.dispatch.receive('fixture')).status).toBe('unknown');await store.close();
 const second=service((await open(directory)).store);expect((await second.dispatch.receive('fixture')).outcomes).toEqual({legacy:'unknown',pilot:'unknown'});expect(second.handle).not.toHaveBeenCalled();expect(await readFile(join(directory,'callbacks.jsonl'),'utf8')).not.toContain('sensitive-error');
});
it('rejects real provenance before creating a directory',async()=>{
 await expect(openDurableCallbackMockJournal({directory:'https://example.invalid',provenance:'provider',appId:'111'} as never)).rejects.toThrow('CALLBACK_MOCK_CONFIG');
});
it('blocks missing committed-tail metadata without resending',async()=>{
 const {store,directory}=await open();await service(store).dispatch.receive('fixture');await store.close();await rm(join(directory,'committed-tail.json'));
 await expect(open(directory)).rejects.toThrow('CALLBACK_JOURNAL_INVALID');
});
it('does not invoke consumers when flushing a claim fails and poisons further claims',async()=>{
 const {store,directory}=await open();const instance=service(store);const failure=vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw Error('disk failure');});
 expect((await instance.dispatch.receive('fixture')).status).toBe('held');expect(instance.handle).not.toHaveBeenCalled();failure.mockRestore();
 expect((await instance.dispatch.receive('fixture')).status).toBe('held');expect(instance.handle).not.toHaveBeenCalled();await store.close();
 await expect(open(directory)).rejects.toThrow('CALLBACK_JOURNAL_INVALID');
});
