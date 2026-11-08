// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {readFile,writeFile,rm} from 'node:fs/promises';
import * as fs from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openDurableCallbackMockJournal} from './durableCallbackMock.js';
import {createSharedCallbackMock} from './sharedCallbackMock.js';
vi.mock('node:fs',async original=>({...await original<typeof import('node:fs')>()}));
const roots:string[]=[];const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of closers.splice(0))await close();for(const path of roots.splice(0))await rm(path,{recursive:true,force:true});});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const key=hash('event'),fingerprint=hash('notice');
const review={provenance:'fixture' as const,appId:'111',key,fingerprint,consumerId:'pilot',reviewerId:'mock-reviewer',evidenceDigest:hash('synthetic evidence'),decision:'effect_confirmed' as const};
async function open(directory?:string){const path=directory??resolve('.superpowers',`reconciliation-test-${randomUUID()}`);if(!directory)roots.push(path);const store=await openDurableCallbackMockJournal({directory:path,provenance:'fixture',appId:'111'});closers.push(store.close);return {store,path};}
it('persists an immutable evidence decision without rewriting unknown or the sibling outcome',async()=>{
 const {store,path}=await open();store.claim(key,fingerprint,['pilot','legacy']);store.settle(key,'pilot','unknown');store.settle(key,'legacy','recorded');
 expect(store.reconcile(review).decision).toBe('effect_confirmed');await store.close();const next=(await open(path)).store;
 expect(next.getReconciliations(key)).toEqual([review]);expect(next.claim(key,fingerprint,['pilot','legacy'])?.outcomes).toEqual({pilot:'unknown',legacy:'recorded'});
 const copy=next.getReconciliations(key);copy[0].reviewerId='mutated';expect(next.getReconciliations(key)[0].reviewerId).toBe('mock-reviewer');
 const before=await readFile(join(path,'callbacks.jsonl'),'utf8');next.reconcile(review);expect(await readFile(join(path,'callbacks.jsonl'),'utf8')).toBe(before);
 expect(()=>next.reconcile({...review,decision:'effect_absent'})).toThrow('CALLBACK_RECONCILIATION_CONFLICT');
});
it.each(['pending','recorded','missing'])('rejects %s delivery reconciliation',async state=>{
 const {store}=await open();if(state!=='missing'){store.claim(key,fingerprint,['pilot']);if(state==='recorded')store.settle(key,'pilot','recorded');}
 expect(()=>store.reconcile(review)).toThrow('CALLBACK_RECONCILIATION_INVALID');expect(store.getReconciliations(key)).toEqual([]);
});
it.each([{appId:'999'},{provenance:'provider'},{fingerprint:hash('other')},{consumerId:'legacy'},{evidenceDigest:''},{reviewerId:''},{decision:'retry'}])('rejects unbound or malformed review %j',async change=>{
 const {store}=await open();store.claim(key,fingerprint,['pilot']);store.settle(key,'pilot','unknown');
 expect(()=>store.reconcile({...review,...change} as never)).toThrow('CALLBACK_RECONCILIATION_INVALID');expect(store.getReconciliations(key)).toEqual([]);
});
it('never resends a callback after an effect-absent review and restart',async()=>{
 const {store,path}=await open();const notice={provenance:'fixture' as const,product:'facebook_login' as const,appId:'111',subject:'222',eventId:'event',kind:'deauthorization' as const,issuedAt:1};
 const handler=vi.fn(async()=>{throw Error('uncertain');});const deps={provenance:'fixture' as const,appId:'111',now:()=>1,maxAgeMs:100,verify:async()=>notice,consumers:[{id:'pilot',handle:handler}],mappings:[{subject:'222',complete:true,consumerIds:['pilot']}]};
 await createSharedCallbackMock({...deps,journal:store}).receive('synthetic');
 const bound={...review,key:hash(JSON.stringify(['111','event'])),fingerprint:hash(JSON.stringify([notice,['pilot']])),decision:'effect_absent' as const};
 store.reconcile(bound);store.correctReconciliation({review:{...bound,decision:'inconclusive'},expectedReviewId:store.getReviewHistory(bound.key,'pilot')[0].id,reasonDigest:hash('correction')});await store.close();
 const next=(await open(path)).store;expect((await createSharedCallbackMock({...deps,journal:next}).receive('synthetic')).status).toBe('unknown');expect(handler).toHaveBeenCalledTimes(1);
});
it('does not expose an uncommitted reconciliation after write failure',async()=>{
 const {store,path}=await open();store.claim(key,fingerprint,['pilot']);store.settle(key,'pilot','unknown');
 const fault=vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw Error('disk');});expect(()=>store.reconcile(review)).toThrow('CALLBACK_JOURNAL_WRITE_FAILED');fault.mockRestore();
 expect(()=>store.getReconciliations(key)).toThrow('CALLBACK_JOURNAL_CLOSED');await store.close();await expect(open(path)).rejects.toThrow('CALLBACK_JOURNAL_INVALID');
});
it('rejects reconciliation after close',async()=>{const {store}=await open();store.claim(key,fingerprint,['pilot']);store.settle(key,'pilot','unknown');await store.close();expect(()=>store.reconcile(review)).toThrow('CALLBACK_JOURNAL_CLOSED');});
it('keeps inconclusive reviews separate per consumer and strips extra payload fields',async()=>{
 const {store,path}=await open();store.claim(key,fingerprint,['pilot','legacy']);store.settle(key,'pilot','unknown');store.settle(key,'legacy','unknown');
 store.reconcile({...review,decision:'inconclusive',rawEvidence:'private-payload',token:'secret-value'} as never);
 store.reconcile({...review,consumerId:'legacy',decision:'effect_absent'});await store.close();const next=(await open(path)).store;
 expect(next.getReconciliations(key).map(r=>r.decision)).toEqual(['inconclusive','effect_absent']);
 const disk=await readFile(join(path,'callbacks.jsonl'),'utf8');expect(disk).not.toContain('private-payload');expect(disk).not.toContain('secret-value');
});
it('appends corrections with ordered immutable history and survives reopening',async()=>{
 const {store,path}=await open();store.claim(key,fingerprint,['pilot']);store.settle(key,'pilot','unknown');store.reconcile(review);
 const initial=store.getReviewHistory(key,'pilot')[0];
 const correction={review:{...review,decision:'inconclusive' as const},expectedReviewId:initial.id,reasonDigest:hash('new evidence')};
 const second=store.correctReconciliation(correction);
 const third=store.correctReconciliation({review:{...review,decision:'effect_absent'},expectedReviewId:second.id,reasonDigest:hash('follow-up')});
 expect(second.previousId).toBe(initial.id);expect(third.revision).toBe(2);
 const before=await readFile(join(path,'callbacks.jsonl'),'utf8');expect(store.correctReconciliation(correction)).toEqual(second);expect(await readFile(join(path,'callbacks.jsonl'),'utf8')).toBe(before);
 await store.close();const next=(await open(path)).store;expect(next.getReviewHistory(key,'pilot')).toEqual([initial,second,third]);expect(next.getReconciliations(key)).toEqual([review]);
 expect(next.claim(key,fingerprint,['pilot'])?.outcomes.pilot).toBe('unknown');
 const copy=next.getReviewHistory(key,'pilot');copy[0].review.reviewerId='changed';expect(next.getReviewHistory(key,'pilot')[0]).toEqual(initial);
 expect(()=>next.correctReconciliation({...correction,reasonDigest:hash('stale competing change')})).toThrow('CALLBACK_RECONCILIATION_STALE');
});
it.each(['missing','wrong-consumer','wrong-app','bad-reason','bad-parent'])('rejects %s correction without appending',async kind=>{
 const {store,path}=await open();store.claim(key,fingerprint,['pilot','legacy']);store.settle(key,'pilot','unknown');store.settle(key,'legacy','unknown');
 if(kind!=='missing')store.reconcile(review);
 const parent=store.getReviewHistory(key,'pilot')[0]?.id??hash('missing');
 const input={review:{...review,appId:kind==='wrong-app'?'999':'111',consumerId:kind==='wrong-consumer'?'legacy':'pilot'},expectedReviewId:kind==='bad-parent'?'bad':parent,reasonDigest:kind==='bad-reason'?'':hash('reason')};
 const before=await readFile(join(path,'callbacks.jsonl'),'utf8');expect(()=>store.correctReconciliation(input)).toThrow();expect(await readFile(join(path,'callbacks.jsonl'),'utf8')).toBe(before);
});
it('fails closed on correction flush failure and after close',async()=>{
 const {store,path}=await open();store.claim(key,fingerprint,['pilot']);store.settle(key,'pilot','unknown');store.reconcile(review);
 const input={review,expectedReviewId:store.getReviewHistory(key,'pilot')[0].id,reasonDigest:hash('reason')};
 const fault=vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw Error('disk');});expect(()=>store.correctReconciliation(input)).toThrow('CALLBACK_JOURNAL_WRITE_FAILED');fault.mockRestore();
 expect(()=>store.getReviewHistory(key,'pilot')).toThrow('CALLBACK_JOURNAL_CLOSED');await store.close();expect(()=>store.correctReconciliation(input)).toThrow('CALLBACK_JOURNAL_CLOSED');await expect(open(path)).rejects.toThrow('CALLBACK_JOURNAL_INVALID');
});
it('rejects a broken correction predecessor even with recalculated journal checksums',async()=>{
 const {store,path}=await open();store.claim(key,fingerprint,['pilot']);store.settle(key,'pilot','unknown');store.reconcile(review);
 store.correctReconciliation({review,expectedReviewId:store.getReviewHistory(key,'pilot')[0].id,reasonDigest:hash('reason')});await store.close();
 const file=join(path,'callbacks.jsonl');const rows=(await readFile(file,'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line));let previous='';
 for(const row of rows){const data=JSON.parse(row.payload);if(data.type==='reconciliation_correction')data.record.previousId=hash('wrong-parent');row.payload=JSON.stringify(data);row.checksum=hash(previous+row.payload);previous=row.checksum;}
 const damaged=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';await writeFile(file,damaged);await writeFile(join(path,'committed-tail.json'),JSON.stringify({checksum:previous,size:Buffer.byteLength(damaged)}));
 await expect(open(path)).rejects.toThrow('CALLBACK_JOURNAL_INVALID');expect(await readFile(file,'utf8')).toBe(damaged);
});
