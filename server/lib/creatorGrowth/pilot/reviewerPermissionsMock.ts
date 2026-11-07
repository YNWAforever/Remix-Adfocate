import {createHash} from 'node:crypto';
import type {MockCallbackReview,MockReviewCorrection,MockReviewHistory} from './durableCallbackMock.js';
type Target=Pick<MockCallbackReview,'appId'|'key'|'fingerprint'|'consumerId'>;
type Action='read'|'review'|'correct';
export type MockReviewer={id:string;active:boolean;session:{id:string;issuedAt:number;expiresAt:number;revoked:boolean};grants:(Target&{actions:Action[]})[]};
export type MockReviewEvidence=Target&{provenance:'fixture';decision:MockCallbackReview['decision'];body:string;observedAt:number;expiresAt:number;revoked:boolean};
type Request=Target&Pick<MockCallbackReview,'decision'|'evidenceDigest'>;
type Journal={appId:string;reconcile(review:MockCallbackReview):MockCallbackReview;correctReconciliation(input:MockReviewCorrection):MockReviewHistory;getReviewHistory(key:string,consumerId:string):MockReviewHistory[]};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const digest=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const id=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
const matches=(a:Target,b:Target)=>a.appId===b.appId&&a.key===b.key&&a.fingerprint===b.fingerprint&&a.consumerId===b.consumerId;
/** Canonical synthetic evidence hash, NOT a signature or proof of provider truth. */
export function mockEvidenceDigest(e:MockReviewEvidence){return hash(JSON.stringify([e.provenance,e.appId,e.key,e.fingerprint,e.consumerId,e.decision,e.body,e.observedAt,e.expiresAt,e.revoked]));}

/** Unmounted offline service. Keep the raw journal private to its composition.
 * Session/grants/evidence resolvers are trusted injected mocks, not real Auth. */
export function createMockReviewerService(deps:{provenance:'fixture';journal:Journal;now:()=>number;currentReviewer:()=>MockReviewer|null;evidence:(digest:string)=>MockReviewEvidence|null}){
 if(deps.provenance!=='fixture'||!deps.journal||!/^[1-9][0-9]{0,63}$/.test(deps.journal.appId))throw Error('MOCK_REVIEW_CONFIG');
 const authorize=(target:Target,action:Action):{reviewerId:string;sessionId:string}=>{
  try{
   if(!target||target.appId!==deps.journal.appId||!digest(target.key)||!digest(target.fingerprint)||!id(target.consumerId))throw Error();
   const reviewer=deps.currentReviewer();
   if(!reviewer||reviewer.active!==true||!id(reviewer.id)||!Array.isArray(reviewer.grants)||!reviewer.grants.some(g=>g&&matches(g,target)&&Array.isArray(g.actions)&&g.actions.includes(action)))throw Error();
   const session=reviewer.session,now=deps.now();
   if(!session||!id(session.id)||session.revoked!==false||!Number.isSafeInteger(now)||!Number.isSafeInteger(session.issuedAt)||!Number.isSafeInteger(session.expiresAt)||session.issuedAt<0||session.issuedAt>now||session.expiresAt<=now||session.expiresAt<=session.issuedAt)throw Error();
   return {reviewerId:reviewer.id,sessionId:session.id};
  }catch{throw Error('MOCK_REVIEW_DENIED');}
 };
 const reauthorize=(target:Target,action:Action,initial:{reviewerId:string;sessionId:string})=>{
  const current=authorize(target,action);
  if(current.reviewerId!==initial.reviewerId||current.sessionId!==initial.sessionId)throw Error('MOCK_REVIEW_DENIED');
 };
 const validate=(request:Request,reviewerId:string):MockCallbackReview=>{
  try{
   if(!digest(request.evidenceDigest)||!['effect_confirmed','effect_absent','inconclusive'].includes(request.decision))throw Error();
   const evidence=deps.evidence(request.evidenceDigest),now=deps.now();
   if(!evidence||evidence.provenance!=='fixture'||evidence.revoked!==false||!matches(evidence,request)||evidence.decision!==request.decision||typeof evidence.body!=='string'||!evidence.body.trim()||Buffer.byteLength(evidence.body)>8192||!Number.isSafeInteger(now)||!Number.isSafeInteger(evidence.observedAt)||!Number.isSafeInteger(evidence.expiresAt)||evidence.observedAt<0||evidence.observedAt>now||evidence.expiresAt<=now||evidence.expiresAt<=evidence.observedAt||mockEvidenceDigest(evidence)!==request.evidenceDigest)throw Error();
   return {provenance:'fixture',appId:request.appId,key:request.key,fingerprint:request.fingerprint,consumerId:request.consumerId,reviewerId,evidenceDigest:request.evidenceDigest,decision:request.decision};
  }catch{throw Error('MOCK_EVIDENCE_INVALID');}
 };
 return {
  review(request:Request){const session=authorize(request,'review'),review=validate(request,session.reviewerId);reauthorize(request,'review',session);return deps.journal.reconcile(review);},
  correct(request:Request&{expectedReviewId:string;reason:string}){
   const session=authorize(request,'correct'),review=validate(request,session.reviewerId);
   if(!digest(request.expectedReviewId)||typeof request.reason!=='string'||!request.reason.trim()||Buffer.byteLength(request.reason)>2048)throw Error('MOCK_EVIDENCE_INVALID');
   const input={review,expectedReviewId:request.expectedReviewId,reasonDigest:hash(request.reason)};
   reauthorize(request,'correct',session);return deps.journal.correctReconciliation(input);
  },
  history(target:Target){
   const session=authorize(target,'read'),records=deps.journal.getReviewHistory(target.key,target.consumerId);
   if(records.some(r=>!r.review||r.review.provenance!=='fixture'||!matches(r.review,target)))throw Error('MOCK_REVIEW_DENIED');
   reauthorize(target,'read',session);return structuredClone(records);
  },
 };
}
