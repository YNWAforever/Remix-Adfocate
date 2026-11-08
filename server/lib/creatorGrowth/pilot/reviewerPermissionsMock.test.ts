// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {rm} from 'node:fs/promises';
import {createMockReviewerService,mockEvidenceDigest,type MockReviewer,type MockReviewEvidence} from './reviewerPermissionsMock.js';
import {openDurableCallbackMockJournal} from './durableCallbackMock.js';
import type {MockCallbackReview,MockReviewCorrection,MockReviewHistory} from './durableCallbackMock.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const target={appId:'111',key:hash('event'),fingerprint:hash('notice'),consumerId:'pilot'};
function setup(){
 const evidence:MockReviewEvidence={...target,provenance:'fixture',decision:'effect_confirmed',body:'synthetic effect receipt',observedAt:100,expiresAt:200,revoked:false};
 const reviewer:MockReviewer={id:'reviewer-1',active:true,session:{id:'session-1',issuedAt:100,expiresAt:1000,revoked:false},grants:[{...target,actions:['read','review','correct']}]};
 const journal={appId:'111',reconcile:vi.fn((r:MockCallbackReview)=>r),correctReconciliation:vi.fn((r:MockReviewCorrection):MockReviewHistory=>({id:hash('receipt'),revision:1,previousId:r.expectedReviewId,reasonDigest:r.reasonDigest,review:r.review})),getReviewHistory:vi.fn(():MockReviewHistory[]=>[])};
 const dependencies={provenance:'fixture' as const,journal,now:()=>150,currentReviewer:()=>reviewer,evidence:()=>evidence};
 const service=createMockReviewerService(dependencies);
 const request={...target,decision:'effect_confirmed' as const,evidenceDigest:mockEvidenceDigest(evidence)};
 return {evidence,reviewer,journal,service,request,dependencies};
}
it('uses session identity, validates evidence and stores only its digest',()=>{
 const {service,request,journal}=setup();service.review({...request,reviewerId:'forged'} as never);
 expect(journal.reconcile).toHaveBeenCalledWith({...request,reviewerId:'reviewer-1',provenance:'fixture'});
 expect(JSON.stringify(journal.reconcile.mock.calls)).not.toContain('synthetic effect receipt');
});
it.each(['inactive','wrong-app','wrong-event','wrong-consumer','wrong-fingerprint','no-action'])('denies %s permissions before journal access',kind=>{
 const s=setup();if(kind==='inactive')s.reviewer.active=false;
 else if(kind==='no-action')s.reviewer.grants[0].actions=['read'];
 else{const field={'wrong-app':'appId','wrong-event':'key','wrong-consumer':'consumerId','wrong-fingerprint':'fingerprint'}[kind]!;Object.assign(s.reviewer.grants[0],{[field]:'wrong'});}
 expect(()=>s.service.review(s.request)).toThrow('MOCK_REVIEW_DENIED');expect(s.journal.reconcile).not.toHaveBeenCalled();
});
it.each(['tampered','expired','future','revoked','wrong-target','wrong-decision','oversized'])('rejects %s evidence without writing',kind=>{
 const s=setup();if(kind==='tampered')s.evidence.body='changed';if(kind==='expired')s.dependencies.now=()=>201;
 if(kind==='future')s.evidence.observedAt=160;if(kind==='revoked')s.evidence.revoked=true;
 if(kind==='wrong-target')s.evidence.consumerId='legacy';if(kind==='wrong-decision')s.evidence.decision='effect_absent';if(kind==='oversized')s.evidence.body='a'.repeat(8193);
 if(kind!=='tampered')s.request.evidenceDigest=mockEvidenceDigest(s.evidence);
 expect(()=>s.service.review(s.request)).toThrow('MOCK_EVIDENCE_INVALID');expect(s.journal.reconcile).not.toHaveBeenCalled();
});
it('rechecks permissions for history and corrections after revocation',()=>{
 const s=setup();s.service.history(s.request);s.reviewer.active=false;
 expect(()=>s.service.history(s.request)).toThrow('MOCK_REVIEW_DENIED');expect(s.journal.getReviewHistory).toHaveBeenCalledTimes(1);
 expect(()=>s.service.correct({...s.request,expectedReviewId:hash('parent'),reason:'synthetic correction'})).toThrow('MOCK_REVIEW_DENIED');expect(s.journal.correctReconciliation).not.toHaveBeenCalled();
});
it('requires a separate correction grant and a bounded reason',()=>{
 const s=setup();s.reviewer.grants[0].actions=['review'];const request={...s.request,expectedReviewId:hash('parent'),reason:'new evidence'};
 expect(()=>s.service.correct(request)).toThrow('MOCK_REVIEW_DENIED');s.reviewer.grants[0].actions=['correct'];
 expect(()=>s.service.correct({...request,reason:' '})).toThrow('MOCK_EVIDENCE_INVALID');s.service.correct(request);
 expect(s.journal.correctReconciliation.mock.calls[0][0].reasonDigest).toBe(hash('new evidence'));
});
it('fails closed when fixture session/evidence resolvers fail',()=>{
 const s=setup();s.dependencies.currentReviewer=()=>{throw Error('private details');};expect(()=>s.service.review(s.request)).toThrow('MOCK_REVIEW_DENIED');
 s.dependencies.currentReviewer=()=>s.reviewer;s.dependencies.evidence=()=>{throw Error('private details');};expect(()=>s.service.review(s.request)).toThrow('MOCK_EVIDENCE_INVALID');
});
it('does not expose history whose stored fingerprint differs from the authorized target',()=>{
 const s=setup();s.journal.getReviewHistory.mockReturnValue([{id:hash('record'),revision:0,previousId:null,reasonDigest:null,review:{...s.request,provenance:'fixture',reviewerId:'reviewer-1',fingerprint:hash('different')}}]);
 expect(()=>s.service.history(s.request)).toThrow('MOCK_REVIEW_DENIED');
});
it('rejects missing evidence and non-fixture service configuration',()=>{
 const s=setup();expect(()=>createMockReviewerService({...s.dependencies,provenance:'provider'} as never)).toThrow('MOCK_REVIEW_CONFIG');
 const service=createMockReviewerService({...s.dependencies,evidence:()=>null});expect(()=>service.review(s.request)).toThrow('MOCK_EVIDENCE_INVALID');
});
it('records authorized reviews and corrections in the durable journal without changing unknown',async()=>{
 const path=resolve('.superpowers',`permissions-test-${randomUUID()}`);let store=await openDurableCallbackMockJournal({directory:path,provenance:'fixture',appId:'111'});
 try{store.claim(target.key,target.fingerprint,['pilot']);store.settle(target.key,'pilot','unknown');const s=setup();const service=createMockReviewerService({...s.dependencies,journal:store});
 service.review(s.request);const parent=service.history(s.request)[0].id;service.correct({...s.request,expectedReviewId:parent,reason:'synthetic additional review'});
 s.reviewer.session.revoked=true;expect(()=>service.review(s.request)).toThrow('MOCK_REVIEW_DENIED');expect(()=>service.history(s.request)).toThrow('MOCK_REVIEW_DENIED');await store.close();
 store=await openDurableCallbackMockJournal({directory:path,provenance:'fixture',appId:'111'});expect(store.getReviewHistory(target.key,'pilot')).toHaveLength(2);expect(store.claim(target.key,target.fingerprint,['pilot'])?.outcomes.pilot).toBe('unknown');
 }finally{await store.close();await rm(path,{recursive:true,force:true});}
});
it.each(['expired','future','revoked','missing','invalid-time'])('denies %s mock sessions for every action',kind=>{
 const s=setup();if(kind==='expired')s.reviewer.session.expiresAt=150;if(kind==='future')s.reviewer.session.issuedAt=151;if(kind==='revoked')s.reviewer.session.revoked=true;
 if(kind==='missing')delete (s.reviewer as Partial<MockReviewer>).session;if(kind==='invalid-time')s.reviewer.session.expiresAt=NaN;
 for(const run of [()=>s.service.history(s.request),()=>s.service.review(s.request),()=>s.service.correct({...s.request,expectedReviewId:hash('parent'),reason:'reason'})])expect(run).toThrow('MOCK_REVIEW_DENIED');
 expect(s.journal.reconcile).not.toHaveBeenCalled();expect(s.journal.correctReconciliation).not.toHaveBeenCalled();expect(s.journal.getReviewHistory).not.toHaveBeenCalled();
});
it('denies signed-out sessions and repeated replay after session revocation',()=>{
 const s=setup();const signedOut=createMockReviewerService({...s.dependencies,currentReviewer:()=>null});expect(()=>signedOut.history(s.request)).toThrow('MOCK_REVIEW_DENIED');
 s.service.review(s.request);s.reviewer.session.revoked=true;
 for(let n=0;n<3;n++)expect(()=>s.service.review(s.request)).toThrow('MOCK_REVIEW_DENIED');expect(s.journal.reconcile).toHaveBeenCalledTimes(1);
});
it.each(['revoked','switched','grant-removed','expired'])('blocks write when session becomes %s during evidence lookup',kind=>{
 const s=setup();s.dependencies.evidence=()=>{if(kind==='revoked')s.reviewer.session.revoked=true;if(kind==='switched')s.reviewer.session.id='session-2';if(kind==='grant-removed')s.reviewer.grants=[];if(kind==='expired')s.reviewer.session.expiresAt=150;return s.evidence;};
 expect(()=>s.service.review(s.request)).toThrow('MOCK_REVIEW_DENIED');expect(s.journal.reconcile).not.toHaveBeenCalled();
});
it('does not release history when sign-out occurs during its read',()=>{
 const s=setup();s.journal.getReviewHistory.mockImplementation(()=>{s.reviewer.session.revoked=true;return [];});
 expect(()=>s.service.history(s.request)).toThrow('MOCK_REVIEW_DENIED');
});
it('a new session still needs current grants and cannot reuse removed permissions',()=>{
 const s=setup();s.reviewer.session={id:'session-2',issuedAt:140,expiresAt:1000,revoked:false};s.reviewer.grants=[];expect(()=>s.service.review(s.request)).toThrow('MOCK_REVIEW_DENIED');
 s.reviewer.grants=[{...target,actions:['read']}];expect(s.service.history(s.request)).toEqual([]);expect(()=>s.service.review(s.request)).toThrow('MOCK_REVIEW_DENIED');
});
it('blocks corrections when the session switches during evidence lookup',()=>{
 const s=setup();s.dependencies.evidence=()=>{s.reviewer.session.id='session-2';return s.evidence;};
 expect(()=>s.service.correct({...s.request,expectedReviewId:hash('parent'),reason:'correction'})).toThrow('MOCK_REVIEW_DENIED');expect(s.journal.correctReconciliation).not.toHaveBeenCalled();
});
it('does not release history after a reviewer switch even with the same session alias',()=>{
 const s=setup();s.journal.getReviewHistory.mockImplementation(()=>{s.reviewer.id='reviewer-2';return [];});expect(()=>s.service.history(s.request)).toThrow('MOCK_REVIEW_DENIED');
});
