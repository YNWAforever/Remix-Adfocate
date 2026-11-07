// @vitest-environment node
import {afterEach,it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import * as fs from 'node:fs';
import {openMockReviewerSessions} from './reviewerSessionStoreMock.js';
import {createMockReviewerService,mockEvidenceDigest,type MockReviewEvidence} from './reviewerPermissionsMock.js';
vi.mock('node:fs',async original=>({...await original<typeof import('node:fs')>()}));
const roots:string[]=[];const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of closers.splice(0))await close();for(const path of roots.splice(0))await rm(path,{recursive:true,force:true});});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const target={appId:'111',key:hash('event'),fingerprint:hash('notice'),consumerId:'pilot'};
const issued={reviewerId:'reviewer-1',sessionId:'session-1',issuedAt:100,expiresAt:200};
async function open(path?:string){const directory=path??resolve('.superpowers',`session-store-test-${randomUUID()}`);if(!path)roots.push(directory);const context={time:150,active:true};
 const store=await openMockReviewerSessions({provenance:'fixture',appId:'111',directory,now:()=>context.time,reviewer:id=>({id,active:context.active,grants:[{...target,actions:['read']}]})});closers.push(store.close);return {store,directory,context};}
it('persists sessions and irreversible revocation across repeated reopen',async()=>{
 const {store,directory}=await open();store.issue(issued);await store.close();const second=(await open(directory)).store;expect(second.resolve('session-1')?.id).toBe('reviewer-1');second.revoke('session-1');await second.close();
 const third=(await open(directory)).store;expect(third.resolve('session-1')).toBeNull();expect(()=>third.issue(issued)).toThrow('MOCK_SESSION_EXISTS');third.revoke('session-1');await third.close();expect((await open(directory)).store.resolve('session-1')).toBeNull();
});
it('uses current expiry and current reviewer status after reopen, without persisting grants',async()=>{
 const {store,directory}=await open();store.issue(issued);await store.close();const next=await open(directory);next.context.active=false;expect(next.store.resolve('session-1')).toBeNull();next.context.active=true;next.context.time=200;expect(next.store.resolve('session-1')).toBeNull();
 expect(await readFile(join(directory,'sessions.json'),'utf8')).not.toContain('grants');
});
it('prevents revoked replay through the reviewer service after restart',async()=>{
 const {store,directory}=await open();store.issue(issued);store.revoke('session-1');await store.close();const next=(await open(directory)).store;const history=vi.fn(()=>[]);
 const service=createMockReviewerService({provenance:'fixture',journal:{appId:'111',getReviewHistory:history,reconcile:vi.fn(),correctReconciliation:vi.fn()},now:()=>150,currentReviewer:()=>next.resolve('session-1'),evidence:()=>null});
 expect(()=>service.history(target)).toThrow('MOCK_REVIEW_DENIED');expect(history).not.toHaveBeenCalled();
});
it('rejects concurrent owners and preserves closed-store fencing',async()=>{const {store,directory}=await open();await expect(open(directory)).rejects.toThrow('LOCAL_PILOT_IN_USE');await store.close();expect(()=>store.resolve('session-1')).toThrow('MOCK_SESSION_CLOSED');});
it.each(['truncated','missing-marker'])('rejects %s persistence without repair',async kind=>{
 const {store,directory}=await open();store.issue(issued);await store.close();const file=join(directory,'sessions.json');if(kind==='truncated')await writeFile(file,'{');else await rm(join(directory,'sessions-tail.json'));const before=await readFile(file,'utf8');await expect(open(directory)).rejects.toThrow('MOCK_SESSION_INVALID');expect(await readFile(file,'utf8')).toBe(before);
});
it('fails closed on revocation flush failure',async()=>{
 const {store,directory}=await open();store.issue(issued);const fault=vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw Error('disk');});expect(()=>store.revoke('session-1')).toThrow('MOCK_SESSION_WRITE_FAILED');fault.mockRestore();expect(()=>store.resolve('session-1')).toThrow('MOCK_SESSION_CLOSED');await store.close();
 // Preserve the interrupted write; never silently reopen the older active state.
 await expect(open(directory)).rejects.toThrow('MOCK_SESSION_INVALID');
});
it('rejects invalid issuance and real provenance',async()=>{const {store}=await open();expect(()=>store.issue({...issued,expiresAt:150})).toThrow('MOCK_SESSION_INVALID');await expect(openMockReviewerSessions({provenance:'provider'} as never)).rejects.toThrow('MOCK_SESSION_CONFIG');});
it('rejects wrong App binding and snapshot-only rollback after revocation',async()=>{
 const {store,directory}=await open();store.issue(issued);const old=await readFile(join(directory,'sessions.json'),'utf8');store.revoke('session-1');await store.close();
 await expect(openMockReviewerSessions({provenance:'fixture',appId:'999',directory,now:()=>150,reviewer:()=>null})).rejects.toThrow('MOCK_SESSION_INVALID');
 await writeFile(join(directory,'sessions.json'),old);await expect(open(directory)).rejects.toThrow('MOCK_SESSION_INVALID');
});
it('blocks restart after the revocation snapshot writes but marker flush fails',async()=>{
 const {store,directory}=await open();store.issue(issued);const original=fs.fsyncSync;let calls=0;
 const fault=vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(++calls===2)throw Error('marker flush');original(fd);});expect(()=>store.revoke('session-1')).toThrow('MOCK_SESSION_WRITE_FAILED');fault.mockRestore();await store.close();await expect(open(directory)).rejects.toThrow('MOCK_SESSION_INVALID');
});
it('resolves current grants afresh and returns isolated copies after restart',async()=>{
 const {store,directory}=await open();store.issue(issued);await store.close();let grant=true;
 const next=await openMockReviewerSessions({provenance:'fixture',appId:'111',directory,now:()=>150,reviewer:id=>({id,active:true,grants:grant?[{...target,actions:['read']}]:[]})});closers.push(next.close);
 const first=next.resolve('session-1')!;first.session.revoked=true;expect(next.resolve('session-1')?.session.revoked).toBe(false);grant=false;expect(next.resolve('session-1')?.grants).toEqual([]);
});
it('denies a write when revocation occurs inside final reviewer resolution',async()=>{
 const directory=resolve('.superpowers',`session-store-test-${randomUUID()}`);roots.push(directory);let reads=0;
 const store=await openMockReviewerSessions({provenance:'fixture',appId:'111',directory,now:()=>150,reviewer:id=>{if(++reads===2)store.revoke('session-1');return {id,active:true,grants:[{...target,actions:['review']}]};}});closers.push(store.close);store.issue(issued);
 const evidence:MockReviewEvidence={...target,provenance:'fixture',decision:'effect_confirmed',body:'synthetic receipt',observedAt:100,expiresAt:200,revoked:false};const reconcile=vi.fn(r=>r);
 const service=createMockReviewerService({provenance:'fixture',now:()=>150,currentReviewer:()=>store.resolve('session-1'),evidence:()=>evidence,journal:{appId:'111',reconcile,correctReconciliation:vi.fn(),getReviewHistory:()=>[]}});
 expect(()=>service.review({...target,decision:'effect_confirmed',evidenceDigest:mockEvidenceDigest(evidence)})).toThrow('MOCK_REVIEW_DENIED');expect(reconcile).not.toHaveBeenCalled();
});
it('rejects coordinated snapshot and marker rollback against a retained checkpoint',async()=>{
 const {store,directory}=await open();store.issue(issued);const old=await readFile(join(directory,'sessions.json'),'utf8'),oldTail=await readFile(join(directory,'sessions-tail.json'),'utf8');store.revoke('session-1');const checkpoint=store.checkpoint();await store.close();
 await writeFile(join(directory,'sessions.json'),old);await writeFile(join(directory,'sessions-tail.json'),oldTail);
 await expect(openMockReviewerSessions({provenance:'fixture',appId:'111',directory,expectedCheckpoint:checkpoint,now:()=>150,reviewer:()=>null})).rejects.toThrow('MOCK_SESSION_INVALID');expect(await readFile(join(directory,'sessions.json'),'utf8')).toBe(old);
});
it('recovers only a checkpoint-matching copy, preserving damaged originals and revoked state',async()=>{
 const {store,directory}=await open();store.issue(issued);store.revoke('session-1');const checkpoint=store.checkpoint();const snapshot=await readFile(join(directory,'sessions.json'),'utf8'),marker=await readFile(join(directory,'sessions-tail.json'),'utf8');await store.close();await writeFile(join(directory,'sessions.json'),'damaged-original');
 const copy=resolve('.superpowers',`session-store-test-${randomUUID()}`);roots.push(copy);await mkdir(copy);await writeFile(join(copy,'sessions.json'),snapshot);await writeFile(join(copy,'sessions-tail.json'),marker);
 const recovered=await openMockReviewerSessions({provenance:'fixture',appId:'111',directory:copy,expectedCheckpoint:checkpoint,now:()=>150,reviewer:id=>({id,active:true,grants:[]})});closers.push(recovered.close);
 expect(recovered.resolve('session-1')).toBeNull();expect(()=>recovered.issue(issued)).toThrow('MOCK_SESSION_EXISTS');expect(recovered.checkpoint()).toEqual(checkpoint);expect(await readFile(join(directory,'sessions.json'),'utf8')).toBe('damaged-original');
});
it('does not initialize empty recovery targets or accept a wrong-App checkpoint',async()=>{
 const {store,directory}=await open();const checkpoint=store.checkpoint();await store.close();const copy=resolve('.superpowers',`session-store-test-${randomUUID()}`);roots.push(copy);
 await expect(openMockReviewerSessions({provenance:'fixture',appId:'111',directory:copy,expectedCheckpoint:checkpoint,now:()=>150,reviewer:()=>null})).rejects.toThrow('MOCK_SESSION_INVALID');
 await expect(readFile(join(copy,'sessions.json'))).rejects.toMatchObject({code:'ENOENT'});
 await expect(openMockReviewerSessions({provenance:'fixture',appId:'111',directory,expectedCheckpoint:{...checkpoint,appId:'999'},now:()=>150,reviewer:()=>null})).rejects.toThrow('MOCK_SESSION_CONFIG');
});
it('does not issue a checkpoint after a failed write',async()=>{
 const {store}=await open();const fault=vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw Error('disk');});expect(()=>store.issue(issued)).toThrow('MOCK_SESSION_WRITE_FAILED');fault.mockRestore();expect(()=>store.checkpoint()).toThrow('MOCK_SESSION_CLOSED');
});
