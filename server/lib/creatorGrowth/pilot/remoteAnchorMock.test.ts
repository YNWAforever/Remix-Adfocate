// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openMockCheckpointStore} from './checkpointStoreMock.js';
import {createMockRemoteCheckpointAnchor,createMockRemoteCheckpointAuthority,createMockRemoteCheckpointStore,forkMockRemoteCheckpointStore,type MockRemoteAnchor} from './remoteAnchorMock.js';

const roots:string[]=[];
const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{
 for(const close of closers.splice(0))await close();
 for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});
});
const hashValue=(value:string)=>createHash('sha256').update(value).digest('hex');
const first={appId:'111',checksum:hashValue('first')};
const second={appId:'111',checksum:hashValue('second')};
function paths(){
 const ledgerDirectory=resolve('.superpowers',`remote-ledger-test-${randomUUID()}`);
 const sessionDirectory=resolve('.superpowers',`remote-session-test-${randomUUID()}`);
 roots.push(ledgerDirectory,sessionDirectory);
 return {ledgerDirectory,sessionDirectory};
}
async function openLedger(paths:{ledgerDirectory:string;sessionDirectory:string},remote:MockRemoteAnchor,mode:'create'|'open'){
 const store=await openMockCheckpointStore({provenance:'fixture',appId:'111',streamId:'sessions-1',directory:paths.ledgerDirectory,sessionDirectory:paths.sessionDirectory,mode,anchor:remote});
 closers.push(store.close);
 return store;
}
it('detects a complete ledger rollback against the surviving simulated remote anchor',async()=>{
 const p=paths();
 const remote=createMockRemoteCheckpointAnchor();
 const ledger=await openLedger(p,remote,'create');
 const firstReceipt=ledger.record(first,null);
 const oldHead=await readFile(join(p.ledgerDirectory,'head.json'),'utf8');
 ledger.record(second,firstReceipt.id);
 await ledger.close();

 await rm(join(p.ledgerDirectory,'checkpoint-2.json'));
 await writeFile(join(p.ledgerDirectory,'head.json'),oldHead);
 await expect(openLedger(p,remote,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
 expect(remote.audit()).toHaveLength(3);
});
it('keeps the remote state across local restart and rejects a rolled-back local authority',async()=>{
 const p=paths();
 const remote=createMockRemoteCheckpointAnchor();
 const firstLedger=await openLedger(p,remote,'create');
 const firstReceipt=firstLedger.record(first,null);
 await firstLedger.close();

 const restartedLedger=await openLedger(p,remote,'open');
 const secondReceipt=restartedLedger.record(second,firstReceipt.id);
 expect(secondReceipt.sequence).toBe(2);
 const firstAudit=remote.audit();
 firstAudit[0].sequence=99;
 expect(remote.audit()[0].sequence).toBe(0);
 expect(()=>remote.advance({binding:firstAudit[0].binding,sequence:firstReceipt.sequence,id:firstReceipt.id},{binding:firstAudit[0].binding,sequence:1,id:hashValue('other')})).toThrow('MOCK_ANCHOR_STALE');
});
it('blocks ledger access while the simulated remote authority is unavailable',async()=>{
 const p=paths();
 const remote=createMockRemoteCheckpointAnchor();
 const ledger=await openLedger(p,remote,'create');
 ledger.record(first,null);
 await ledger.close();
 remote.setAvailable(false);
 await expect(openLedger(p,remote,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
 remote.setAvailable(true);
 const recovered=await openLedger(p,remote,'open');
 expect(recovered.history()).toHaveLength(1);
});
it('records ordered remote audit events and rejects invalid transitions',async()=>{
 const remote=createMockRemoteCheckpointAnchor();
 const binding=hashValue('binding');
 remote.advance(null,{binding,sequence:0,id:null});
 expect(()=>remote.advance(null,{binding,sequence:0,id:null})).toThrow('MOCK_ANCHOR_STALE');
 remote.advance({binding,sequence:0,id:null},{binding,sequence:1,id:hashValue('one')});
 expect(remote.audit()).toEqual([
  {binding,sequence:0,previousId:null,checkoutId:null,writerEpoch:0},
  {binding,sequence:1,previousId:null,checkoutId:hashValue('one'),writerEpoch:0},
 ]);
 expect(()=>remote.advance({binding,sequence:0,id:null},{binding,sequence:2,id:hashValue('two')})).toThrow('MOCK_ANCHOR_STALE');
 expect(()=>remote.read('invalid')).toThrow('MOCK_ANCHOR_INVALID');
});
it('survives a simulated remote client restart through the shared authority',async()=>{
 const p=paths();
 const authority=createMockRemoteCheckpointAuthority();
 const firstClient=authority.client();
 const firstLedger=await openLedger(p,firstClient,'create');
 const firstReceipt=firstLedger.record(first,null);
 firstClient.setAvailable(false);
 await firstLedger.close();

 const secondClient=authority.client();
 const secondLedger=await openLedger(p,secondClient,'open');
 const secondReceipt=secondLedger.record(second,firstReceipt.id);
 expect(secondReceipt.sequence).toBe(2);
 expect(authority.audit().map(entry=>entry.sequence)).toEqual([0,1,2]);
});
it('blocks restart when a remote commit fails before applying state',async()=>{
 const p=paths();
 const authority=createMockRemoteCheckpointAuthority();
 const firstClient=authority.client();
 const ledger=await openLedger(p,firstClient,'create');
 firstClient.setNextFault('commit_before_apply');
 expect(()=>ledger.record(first,null)).toThrow('MOCK_CHECKPOINT_WRITE_FAILED');
 await ledger.close();

 const restartedClient=authority.client();
 await expect(openLedger(p,restartedClient,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
 expect(authority.audit().map(entry=>entry.sequence)).toEqual([0]);
});
it('reconciles a remote commit whose acknowledgment was lost without duplicating it',async()=>{
 const p=paths();
 const authority=createMockRemoteCheckpointAuthority();
 const firstClient=authority.client();
 const ledger=await openLedger(p,firstClient,'create');
 firstClient.setNextFault('commit_after_apply');
 expect(()=>ledger.record(first,null)).toThrow('MOCK_CHECKPOINT_WRITE_FAILED');
 await ledger.close();

 const restartedClient=authority.client();
 const recovered=await openLedger(p,restartedClient,'open');
 expect(recovered.history()).toHaveLength(1);
 expect(recovered.latest().checkpoint).toEqual(first);
 expect(authority.audit().map(entry=>entry.sequence)).toEqual([0,1]);
});
it('persists state and ordered audit history across remote-authority failover',async()=>{
 const p=paths();
 const store=createMockRemoteCheckpointStore();
 const primaryAuthority=createMockRemoteCheckpointAuthority(store);
 const primaryClient=primaryAuthority.client();
 const primaryLedger=await openLedger(p,primaryClient,'create');
 const receipt=primaryLedger.record(first,null);
 primaryClient.setAvailable(false);
 await primaryLedger.close();

 const failoverAuthority=createMockRemoteCheckpointAuthority(store);
 const failoverClient=failoverAuthority.client();
 const failoverLedger=await openLedger(p,failoverClient,'open');
 expect(failoverLedger.verify(first,receipt.id)).toEqual(first);
 expect(failoverAuthority.audit()).toEqual(primaryAuthority.audit());
 expect(failoverAuthority.audit().map(entry=>entry.sequence)).toEqual([0,1]);
});
it('reconciles a lost acknowledgment after authority failover without duplicate audit',async()=>{
 const p=paths();
 const store=createMockRemoteCheckpointStore();
 const primaryAuthority=createMockRemoteCheckpointAuthority(store);
 const primaryClient=primaryAuthority.client();
 const primaryLedger=await openLedger(p,primaryClient,'create');
 primaryClient.setNextFault('commit_after_apply');
 expect(()=>primaryLedger.record(first,null)).toThrow('MOCK_CHECKPOINT_WRITE_FAILED');
 await primaryLedger.close();

 const failoverAuthority=createMockRemoteCheckpointAuthority(store);
 const failoverLedger=await openLedger(p,failoverAuthority.client(),'open');
 expect(failoverLedger.history()).toHaveLength(1);
 expect(failoverAuthority.audit().map(entry=>entry.sequence)).toEqual([0,1]);
});
it('isolates independent remote stores and rejects an invalid failover store',async()=>{
 const firstStore=createMockRemoteCheckpointStore(),secondStore=createMockRemoteCheckpointStore();
 const firstAuthority=createMockRemoteCheckpointAuthority(firstStore),secondAuthority=createMockRemoteCheckpointAuthority(secondStore);
 const binding=hashValue('binding');
 firstAuthority.client().advance(null,{binding,sequence:0,id:null});
 expect(firstAuthority.audit()).toHaveLength(1);
 expect(secondAuthority.audit()).toHaveLength(0);
 expect(()=>createMockRemoteCheckpointAuthority({id:'unknown'} as never)).toThrow('MOCK_REMOTE_STORE_INVALID');
});
it('fences stale writers after a writer epoch promotion',async()=>{
 const authority=createMockRemoteCheckpointAuthority();
 const staleClient=authority.client();
 const binding=hashValue('binding');
 staleClient.advance(null,{binding,sequence:0,id:null});
 expect(authority.promoteWriter()).toBe(1);
 const activeClient=authority.client();
 expect(()=>staleClient.read(binding)).toThrow('MOCK_REMOTE_FENCED');
 expect(()=>staleClient.advance({binding,sequence:0,id:null},{binding,sequence:1,id:hashValue('one')})).toThrow('MOCK_REMOTE_FENCED');
 activeClient.advance({binding,sequence:0,id:null},{binding,sequence:1,id:hashValue('one')});
 expect(authority.audit().at(-1)?.writerEpoch).toBe(1);
 expect(authority.writerEpoch()).toBe(1);
});
it('detects stale-replica split brain instead of accepting an older remote fork',async()=>{
 const p=paths();
 const store=createMockRemoteCheckpointStore();
 const authority=createMockRemoteCheckpointAuthority(store);
 const client=authority.client();
 const ledger=await openLedger(p,client,'create');
 const firstReceipt=ledger.record(first,null);
 const staleReplica=forkMockRemoteCheckpointStore(store);
 ledger.record(second,firstReceipt.id);
 await ledger.close();

 const staleAuthority=createMockRemoteCheckpointAuthority(staleReplica);
 await expect(openLedger(p,staleAuthority.client(),'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
 expect(staleAuthority.audit().map(entry=>entry.sequence)).toEqual([0,1]);
});
it('lets a promoted authority reopen the ledger while fencing the old writer',async()=>{
 const p=paths();
 const store=createMockRemoteCheckpointStore();
 const primaryAuthority=createMockRemoteCheckpointAuthority(store);
 const staleClient=primaryAuthority.client();
 const firstLedger=await openLedger(p,staleClient,'create');
 const firstReceipt=firstLedger.record(first,null);
 await firstLedger.close();

 const failoverAuthority=createMockRemoteCheckpointAuthority(store);
 failoverAuthority.promoteWriter();
 const activeClient=failoverAuthority.client();
 const activeLedger=await openLedger(p,activeClient,'open');
 const secondReceipt=activeLedger.record(second,firstReceipt.id);
 expect(secondReceipt.sequence).toBe(2);
 await activeLedger.close();
 await expect(openLedger(p,staleClient,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
});
