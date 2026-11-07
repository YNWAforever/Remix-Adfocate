// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openMockCheckpointStore} from './checkpointStoreMock.js';
import {createMockQuorumAnchor} from './quorumAnchorMock.js';

const roots:string[]=[];
const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{
 for(const close of closers.splice(0))await close();
 for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});
});
const hashValue=(value:string)=>createHash('sha256').update(value).digest('hex');
const first={appId:'111',checksum:hashValue('first')};
const second={appId:'111',checksum:hashValue('second')};
const nodeIds=['node-a','node-b','node-c','node-d','node-e'];
function paths(){
 const ledgerDirectory=resolve('.superpowers',`quorum-ledger-test-${randomUUID()}`);
 const sessionDirectory=resolve('.superpowers',`quorum-session-test-${randomUUID()}`);
 roots.push(ledgerDirectory,sessionDirectory);
 return {ledgerDirectory,sessionDirectory};
}
async function openLedger(paths:{ledgerDirectory:string;sessionDirectory:string},anchor:Awaited<ReturnType<typeof createMockQuorumAnchor>>,mode:'create'|'open'){
 const store=await openMockCheckpointStore({provenance:'fixture',appId:'111',streamId:'sessions-1',directory:paths.ledgerDirectory,sessionDirectory:paths.sessionDirectory,mode,anchor});
 closers.push(store.close);
 return store;
}
it('requires a majority and elects a deterministic leader',async()=>{
 const anchor=createMockQuorumAnchor(nodeIds),ledger=await openLedger(paths(),anchor,'create');
 const receipt=ledger.record(first,null);
 expect(receipt.sequence).toBe(1);
 expect(anchor.status()).toMatchObject({term:1,leaderId:'node-a',quorumSize:3});
 expect(anchor.audit()).toHaveLength(2);
 expect(anchor.audit()[1].committers).toEqual(nodeIds);
});
it('blocks reads and writes when fewer than three of five nodes are online',async()=>{
 const p=paths(),anchor=createMockQuorumAnchor(nodeIds),ledger=await openLedger(p,anchor,'create');
 ledger.record(first,null);await ledger.close();
 for(const nodeId of ['node-c','node-d','node-e'])anchor.setAvailable(nodeId,false);
 expect(anchor.status().leaderId).toBeNull();
 await expect(openLedger(p,anchor,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
 anchor.setAvailable('node-c',true);
 const recovered=await openLedger(p,anchor,'open');
 expect(recovered.history()).toHaveLength(1);
});
it('elects a new leader after the current leader is fenced',async()=>{
 const p=paths(),anchor=createMockQuorumAnchor(nodeIds),ledger=await openLedger(p,anchor,'create');
 const receipt=ledger.record(first,null);await ledger.close();
 anchor.setAvailable('node-a',false);
 anchor.setAvailable('node-e',false);
 const failoverLedger=await openLedger(p,anchor,'open');
 const secondReceipt=failoverLedger.record(second,receipt.id);
 expect(secondReceipt.sequence).toBe(2);
 expect(anchor.status()).toMatchObject({term:2,leaderId:'node-b'});
 expect(anchor.audit().map(event=>event.term)).toEqual([1,1,2]);
});
it('does not let a stale replica rejoin as authoritative state',async()=>{
 const p=paths(),anchor=createMockQuorumAnchor(nodeIds),ledger=await openLedger(p,anchor,'create');
 const receipt=ledger.record(first,null);await ledger.close();
 anchor.setAvailable('node-e',false);
 const majorityLedger=await openLedger(p,anchor,'open');
 const secondReceipt=majorityLedger.record(second,receipt.id);
 anchor.setAvailable('node-e',true);
 expect(anchor.status().leaderId).toBe('node-a');
 expect(anchor.audit().at(-1)?.committers).not.toContain('node-e');
 expect(majorityLedger.verify(second,secondReceipt.id)).toEqual(second);
});
it('rejects malformed quorum configuration and invalid node changes',()=>{
 expect(()=>createMockQuorumAnchor(['a','b','c','c','e'])).toThrow('MOCK_QUORUM_CONFIG');
 expect(()=>createMockQuorumAnchor(['a','b','c','d'])).toThrow('MOCK_QUORUM_CONFIG');
 const anchor=createMockQuorumAnchor(nodeIds);
 expect(()=>anchor.setAvailable('unknown',false)).toThrow('MOCK_ANCHOR_INVALID');
});
