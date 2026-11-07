// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import * as fs from 'node:fs';
vi.mock('node:fs',async original=>({...await original<typeof import('node:fs')>()}));
import {openMockCheckpointAnchor} from './checkpointAnchorMock.js';
import {openMockCheckpointStore} from './checkpointStoreMock.js';

const roots:string[]=[];
const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{
 for(const close of closers.splice(0))await close();
 for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});
});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const first={appId:'111',checksum:hash('first')};
const second={appId:'111',checksum:hash('second')};
function paths(){
 const anchorDirectory=resolve('.superpowers',`anchor-test-${randomUUID()}`);
 const ledgerDirectory=resolve('.superpowers',`ledger-test-${randomUUID()}`);
 const sessionDirectory=resolve('.superpowers',`sessions-test-${randomUUID()}`);
 roots.push(anchorDirectory,ledgerDirectory,sessionDirectory);
 return {anchorDirectory,ledgerDirectory,sessionDirectory};
}
async function anchor(path:string,mode:'create'|'open'){
 const store=await openMockCheckpointAnchor({provenance:'fixture',directory:path,mode});
 closers.push(store.close);
 return store;
}
async function ledger(p:ReturnType<typeof paths>,anchorStore?:Awaited<ReturnType<typeof anchor>>,mode:'create'|'open'='create'){
 const store=await openMockCheckpointStore({provenance:'fixture',appId:'111',streamId:'sessions-1',directory:p.ledgerDirectory,sessionDirectory:p.sessionDirectory,mode,anchor:anchorStore});
 closers.push(store.close);
 return store;
}
it('persists anchor state and verifies a ledger after both stores restart',async()=>{
 const p=paths();
 const savedAnchor=await anchor(p.anchorDirectory,'create');
 const savedLedger=await ledger(p,savedAnchor);
 const receipt=savedLedger.record(first,null);
 await savedLedger.close();
 await savedAnchor.close();

 const reopenedAnchor=await anchor(p.anchorDirectory,'open');
 const reopenedLedger=await ledger(p,reopenedAnchor,'open');
 expect(reopenedLedger.verify(first,receipt.id)).toEqual(first);
 expect(reopenedLedger.history()).toHaveLength(1);
});
it('continues monotonic checkpoint updates after repeated anchor restarts',async()=>{
 const p=paths();
 const savedAnchor=await anchor(p.anchorDirectory,'create');
 const savedLedger=await ledger(p,savedAnchor);
 const firstReceipt=savedLedger.record(first,null);
 await savedLedger.close();
 await savedAnchor.close();

 const secondAnchorHandle=await anchor(p.anchorDirectory,'open');
 const secondLedgerHandle=await ledger(p,secondAnchorHandle,'open');
 const secondReceipt=secondLedgerHandle.record(second,firstReceipt.id);
 await secondLedgerHandle.close();
 await secondAnchorHandle.close();

 const thirdAnchorHandle=await anchor(p.anchorDirectory,'open');
 const thirdLedgerHandle=await ledger(p,thirdAnchorHandle,'open');
 expect(thirdLedgerHandle.verify(second,secondReceipt.id)).toEqual(second);
 expect(()=>thirdLedgerHandle.record(first,secondReceipt.id)).toThrow('MOCK_CHECKPOINT_ROLLBACK');
});
it('detects a complete ledger rollback against the restarted persistent anchor',async()=>{
 const p=paths();
 const savedAnchor=await anchor(p.anchorDirectory,'create');
 const savedLedger=await ledger(p,savedAnchor);
 const firstReceipt=savedLedger.record(first,null);
 const oldHead=await readFile(join(p.ledgerDirectory,'head.json'),'utf8');
 const secondReceipt=savedLedger.record(second,firstReceipt.id);
 await savedLedger.close();
 await savedAnchor.close();

 await rm(join(p.ledgerDirectory,'checkpoint-2.json'));
 await writeFile(join(p.ledgerDirectory,'head.json'),oldHead);
 const restartedAnchor=await anchor(p.anchorDirectory,'open');
 await expect(ledger(p,restartedAnchor,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
 expect(await readFile(join(p.ledgerDirectory,'head.json'),'utf8')).toBe(oldHead);
 expect(secondReceipt.sequence).toBe(2);
});
it('rejects a rolled-back anchor against the latest ledger',async()=>{
 const p=paths();
 const savedAnchor=await anchor(p.anchorDirectory,'create');
 const savedLedger=await ledger(p,savedAnchor);
 const firstReceipt=savedLedger.record(first,null);
 const oldAnchor=await readFile(join(p.anchorDirectory,'anchor.json'),'utf8');
 const oldMarker=await readFile(join(p.anchorDirectory,'anchor-tail.json'),'utf8');
 savedLedger.record(second,firstReceipt.id);
 await savedLedger.close();
 await savedAnchor.close();

 await writeFile(join(p.anchorDirectory,'anchor.json'),oldAnchor);
 await writeFile(join(p.anchorDirectory,'anchor-tail.json'),oldMarker);
 const rolledBackAnchor=await anchor(p.anchorDirectory,'open');
 await expect(ledger(p,rolledBackAnchor,'open')).rejects.toThrow('MOCK_CHECKPOINT_INVALID');
});
it('fails closed on missing or corrupted anchor evidence without repair',async()=>{
 const p=paths();
 const saved=await anchor(p.anchorDirectory,'create');
 await saved.close();
 const original=await readFile(join(p.anchorDirectory,'anchor.json'),'utf8');
 await writeFile(join(p.anchorDirectory,'anchor.json'),'broken');
 await expect(anchor(p.anchorDirectory,'open')).rejects.toThrow('MOCK_ANCHOR_INVALID');
 expect(await readFile(join(p.anchorDirectory,'anchor.json'),'utf8')).toBe('broken');

 await writeFile(join(p.anchorDirectory,'anchor.json'),original);
 await rm(join(p.anchorDirectory,'anchor-tail.json'));
 await expect(anchor(p.anchorDirectory,'open')).rejects.toThrow('MOCK_ANCHOR_INVALID');
 const pendingPath=resolve('.superpowers',`anchor-test-${randomUUID()}`);
 roots.push(pendingPath);
 await import('node:fs/promises').then(({mkdir})=>mkdir(pendingPath));
 await import('node:fs/promises').then(({writeFile})=>writeFile(join(pendingPath,'anchor.json.pending'),'pending'));
 await expect(anchor(pendingPath,'open')).rejects.toThrow('MOCK_ANCHOR_INVALID');
});
it('rejects concurrent owners, closed access, and accidental recreation',async()=>{
 const p=paths();
 const saved=await anchor(p.anchorDirectory,'create');
 await expect(anchor(p.anchorDirectory,'open')).rejects.toThrow('LOCAL_PILOT_IN_USE');
 await saved.close();
 await expect(openMockCheckpointAnchor({provenance:'fixture',directory:p.anchorDirectory,mode:'create'})).rejects.toThrow('MOCK_ANCHOR_INVALID');
 expect(()=>saved.read(hash('binding'))).toThrow('MOCK_ANCHOR_CLOSED');
});
it('rejects malformed anchor operations and preserves immutable state copies',async()=>{
 const p=paths();
 const saved=await anchor(p.anchorDirectory,'create');
 expect(()=>saved.advance(null,{binding:hash('binding'),sequence:0,id:null})).not.toThrow();
 const state=saved.read(hash('binding'))!;
 state.sequence=7;
 expect(saved.read(hash('binding'))?.sequence).toBe(0);
 expect(()=>saved.advance(state,{binding:hash('binding'),sequence:1,id:hash('receipt')})).toThrow('MOCK_ANCHOR_STALE');
});
it('rejects a non-fixture anchor configuration',async()=>{
 const p=paths();
 await expect(openMockCheckpointAnchor({provenance:'provider',directory:p.anchorDirectory,mode:'create'} as never)).rejects.toThrow('MOCK_ANCHOR_CONFIG');
});
it('does not leave a usable anchor after a failed atomic write',async()=>{
 const p=paths();
 const saved=await anchor(p.anchorDirectory,'create');
 const fault=vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw Error('disk');});
 expect(()=>saved.advance(null,{binding:hash('binding'),sequence:0,id:null})).toThrow('MOCK_ANCHOR_WRITE_FAILED');
 fault.mockRestore();
 expect(()=>saved.read(hash('binding'))).toThrow('MOCK_ANCHOR_CLOSED');
 await saved.close();
 await expect(anchor(p.anchorDirectory,'open')).rejects.toThrow('MOCK_ANCHOR_INVALID');
});
