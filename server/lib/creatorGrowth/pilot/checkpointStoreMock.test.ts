// @vitest-environment node
import {afterEach,it,expect,vi} from 'vitest';
import {resolve,join} from 'node:path';
import {rm,writeFile,readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import * as fs from 'node:fs';
import {openMockCheckpointStore,createMockCheckpointAnchor} from './checkpointStoreMock.js';
import {openMockReviewerSessions} from './reviewerSessionStoreMock.js';
vi.mock('node:fs',async original=>({...await original<typeof import('node:fs')>()}));
const roots:string[]=[];const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of closers.splice(0))await close();for(const path of roots.splice(0))await rm(path,{recursive:true,force:true});});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const first={appId:'111',checksum:hash('first')},second={appId:'111',checksum:hash('second')};
function config(){const directory=resolve('.superpowers',`checkpoint-test-${randomUUID()}`),sessionDirectory=resolve('.superpowers',`checkpoint-test-${randomUUID()}`);roots.push(directory,sessionDirectory);return {provenance:'fixture' as const,appId:'111',streamId:'sessions-1',directory,sessionDirectory};}
async function open(c= config(),mode:'create'|'open'='create'){const store=await openMockCheckpointStore({...c,mode});closers.push(store.close);return {store,c};}
it('persists ordered receipts and verifies only the latest checkpoint after restart',async()=>{
 const {store,c}=await open();expect(()=>store.latest()).toThrow('MOCK_CHECKPOINT_MISSING');const a=store.record(first,null),b=store.record(second,a.id);expect(b.sequence).toBe(2);await store.close();const next=(await open(c,'open')).store;
 expect(next.verify(second,b.id)).toEqual(second);expect(()=>next.verify(first,a.id)).toThrow('MOCK_CHECKPOINT_STALE');expect(next.history()).toHaveLength(2);const copy=next.history();copy[0].checkpoint.checksum='mutated';expect(next.history()[0]).toEqual(a);
 expect(()=>next.record(first,b.id)).toThrow('MOCK_CHECKPOINT_ROLLBACK');expect(()=>next.record({...second,checksum:hash('third')},a.id)).toThrow('MOCK_CHECKPOINT_STALE');expect(next.record(second,b.id)).toEqual(b);
});
it('requires existing storage in open mode and disjoint source/storage directories',async()=>{
 const c=config();await expect(open(c,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');await expect(open({...c,directory:c.sessionDirectory})).rejects.toThrow('MOCK_CHECKPOINT_CONFIG');
 await expect(open({...c,directory:join(c.sessionDirectory,'nested')})).rejects.toThrow('MOCK_CHECKPOINT_CONFIG');
});
it('rejects wrong stream/App and missing or altered receipt bytes without repair',async()=>{
 const {store,c}=await open();store.record(first,null);await store.close();await expect(open({...c,streamId:'other'},'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');await expect(open({...c,appId:'999'},'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
 const file=join(c.directory,'checkpoint-1.json');await writeFile(file,'broken');await expect(open(c,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');expect(await readFile(file,'utf8')).toBe('broken');
});
it('blocks concurrent owners and restart after an interrupted write',async()=>{
 const {store,c}=await open();await expect(open(c,'open')).rejects.toThrow('LOCAL_PILOT_IN_USE');const fault=vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw Error('disk');});expect(()=>store.record(first,null)).toThrow('MOCK_CHECKPOINT_WRITE_FAILED');fault.mockRestore();expect(()=>store.latest()).toThrow('MOCK_CHECKPOINT_CLOSED');await store.close();await expect(open(c,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
});
it('supplies a stored checkpoint to session recovery and retains revoked state',async()=>{
 const c=config();const sessions=await openMockReviewerSessions({provenance:'fixture',appId:'111',directory:c.sessionDirectory,now:()=>150,reviewer:()=>null});closers.push(sessions.close);sessions.issue({reviewerId:'reviewer-1',sessionId:'session-1',issuedAt:100,expiresAt:200});sessions.revoke('session-1');
 const {store}=await open(c);const receipt=store.record(sessions.checkpoint(),null);await store.close();await sessions.close();const ledger=(await open(c,'open')).store;const checkpoint=ledger.verify(ledger.latest().checkpoint,receipt.id);
 const recovered=await openMockReviewerSessions({provenance:'fixture',appId:'111',directory:c.sessionDirectory,expectedCheckpoint:checkpoint,now:()=>150,reviewer:()=>null});closers.push(recovered.close);expect(recovered.resolve('session-1')).toBeNull();expect(()=>recovered.issue({reviewerId:'reviewer-1',sessionId:'session-1',issuedAt:100,expiresAt:200})).toThrow('MOCK_SESSION_EXISTS');
});
it('rejects rolled-back heads and missing receipts without removing remaining evidence',async()=>{
 const {store,c}=await open();store.record(first,null);const oldHead=await readFile(join(c.directory,'head.json'),'utf8');store.record(second,store.latest().id);await store.close();await writeFile(join(c.directory,'head.json'),oldHead);
 await expect(open(c,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');expect(await readFile(join(c.directory,'checkpoint-2.json'),'utf8')).toContain(second.checksum);
 await rm(join(c.directory,'checkpoint-1.json'));await expect(open(c,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
});
it('blocks restart after head-marker flush failure',async()=>{
 const {store,c}=await open();const original=fs.fsyncSync;let calls=0;const fault=vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(++calls===2)throw Error('head');original(fd);});
 expect(()=>store.record(first,null)).toThrow('MOCK_CHECKPOINT_WRITE_FAILED');fault.mockRestore();await store.close();await expect(open(c,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
});
it('denies wrong App writes, source rebinding, closed access and recreation of an existing ledger',async()=>{
 const {store,c}=await open();expect(()=>store.record({...first,appId:'999'},null)).toThrow('MOCK_CHECKPOINT_INVALID');await store.close();expect(()=>store.latest()).toThrow('MOCK_CHECKPOINT_CLOSED');await expect(open(c,'create')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
 await expect(open({...c,sessionDirectory:resolve('.superpowers','different-source')},'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
});
it('rejects source paths outside the local mock root',async()=>{const c=config();await expect(open({...c,sessionDirectory:resolve('outside-mock-root')})).rejects.toThrow('MOCK_CHECKPOINT_CONFIG');});
it('rejects complete ledger rollback against a separately retained mock anchor',async()=>{
 const c=config(),anchor=createMockCheckpointAnchor();const store=await openMockCheckpointStore({...c,mode:'create',anchor});closers.push(store.close);const a=store.record(first,null),oldHead=await readFile(join(c.directory,'head.json'),'utf8');store.record(second,a.id);await store.close();
 await rm(join(c.directory,'checkpoint-2.json'));await writeFile(join(c.directory,'head.json'),oldHead);
 await expect(openMockCheckpointStore({...c,mode:'open',anchor})).rejects.toThrow('MOCK_CHECKPOINT_INVALID');expect(await readFile(join(c.directory,'head.json'),'utf8')).toBe(oldHead);
});
it('reopens with the same anchor but refuses missing or reset anchors',async()=>{
 const c=config(),anchor=createMockCheckpointAnchor();const store=await openMockCheckpointStore({...c,mode:'create',anchor});closers.push(store.close);const receipt=store.record(first,null);await store.close();
 await expect(openMockCheckpointStore({...c,mode:'open'})).rejects.toThrow('MOCK_CHECKPOINT_INVALID');await expect(openMockCheckpointStore({...c,mode:'open',anchor:createMockCheckpointAnchor()})).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
 const next=await openMockCheckpointStore({...c,mode:'open',anchor});closers.push(next.close);expect(next.verify(first,receipt.id)).toEqual(first);
});
it('fails closed when anchor advancement fails after local commit',async()=>{
 const c=config(),anchor=createMockCheckpointAnchor();const store=await openMockCheckpointStore({...c,mode:'create',anchor});closers.push(store.close);const fault=vi.spyOn(anchor,'advance').mockImplementation(()=>{throw Error('unavailable');});
 expect(()=>store.record(first,null)).toThrow('MOCK_CHECKPOINT_WRITE_FAILED');expect(()=>store.latest()).toThrow('MOCK_CHECKPOINT_CLOSED');fault.mockRestore();await store.close();await expect(openMockCheckpointStore({...c,mode:'open',anchor})).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
});
it('checks anchor availability on read rather than silently using cached state',async()=>{
 const c=config(),anchor=createMockCheckpointAnchor();const store=await openMockCheckpointStore({...c,mode:'create',anchor});closers.push(store.close);store.record(first,null);vi.spyOn(anchor,'read').mockImplementation(()=>{throw Error('unavailable');});expect(()=>store.history()).toThrow('MOCK_CHECKPOINT_CLOSED');
});
it('prevents anchor regression and isolates returned anchor state',()=>{
 const anchor=createMockCheckpointAnchor(),binding=hash('stream'),initial={binding,sequence:0,id:null};anchor.advance(null,initial);const next={binding,sequence:1,id:hash('receipt')};anchor.advance(initial,next);
 const copy=anchor.read(binding)!;copy.sequence=0;expect(anchor.read(binding)).toEqual(next);expect(()=>anchor.advance(next,initial)).toThrow('MOCK_ANCHOR_STALE');expect(()=>anchor.advance(initial,{...next,sequence:2})).toThrow('MOCK_ANCHOR_STALE');
});
it('reconciles an ambiguous anchor acknowledgment by readback without repeating the commit',async()=>{
 const c=config(),anchor=createMockCheckpointAnchor();const store=await openMockCheckpointStore({...c,mode:'create',anchor});closers.push(store.close);const advance=anchor.advance;
 const fault=vi.spyOn(anchor,'advance').mockImplementation((expected,next)=>{advance(expected,next);throw Error('ack lost');});expect(()=>store.record(first,null)).toThrow('MOCK_CHECKPOINT_WRITE_FAILED');fault.mockRestore();await store.close();
 const reopened=await openMockCheckpointStore({...c,mode:'open',anchor});closers.push(reopened.close);expect(reopened.history()).toHaveLength(1);expect(reopened.latest().checkpoint).toEqual(first);
});
