import {openSync,closeSync,readFileSync,lstatSync,writeSync,fsyncSync,fstatSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {acquireLocalPilotDirectory} from './localDirectoryLock.js';
import type {CallbackJournal,Outcome} from './sharedCallbackMock.js';

type Entry={fingerprint:string;outcomes:Record<string,Outcome>};
export type MockCallbackReview={
 provenance:'fixture';appId:string;key:string;fingerprint:string;consumerId:string;
 reviewerId:string;evidenceDigest:string;decision:'effect_confirmed'|'effect_absent'|'inconclusive';
};
type ReconciliationJournal={
 correctReconciliation(input:MockReviewCorrection):MockReviewHistory;
 getReviewHistory(key:string,consumerId:string):MockReviewHistory[];
 reconcile(review:MockCallbackReview):MockCallbackReview;
 getReconciliations(key:string):MockCallbackReview[];
};
export type MockReviewCorrection={review:MockCallbackReview;expectedReviewId:string;reasonDigest:string};
export type MockReviewHistory={id:string;revision:number;previousId:string|null;reasonDigest:string|null;review:MockCallbackReview};
const historyRecord=(review:MockCallbackReview,revision:number,previousId:string|null,reasonDigest:string|null):MockReviewHistory=>{
 const body={revision,previousId,reasonDigest,review};return {id:hash(JSON.stringify(body)),...body};
};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const digest=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const validId=(s:string)=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
const MAX_BYTES=8*1024*1024;

/** Offline fixture journal. Hash chaining detects accidental corruption, not a
 * malicious local writer. Stale owner locks require preserved-copy recovery.
 * No handler retries or provider completion assertions are made here. */
export async function openDurableCallbackMockJournal(options:{directory:string;provenance:'fixture';appId:string}):Promise<CallbackJournal&ReconciliationJournal&{close():Promise<void>}>{
 if(options.provenance!=='fixture'||!/^[1-9][0-9]{0,63}$/.test(options.appId))throw Error('CALLBACK_MOCK_CONFIG');
 const owner=await acquireLocalPilotDirectory(options.directory);
 let fd:number|undefined;let closed=false,poisoned=false,previous='',size=0;
 const entries=new Map<string,Entry>();
 const reviews=new Map<string,MockCallbackReview>();
 const histories=new Map<string,MockReviewHistory[]>();
 const reviewKey=(r:MockCallbackReview)=>JSON.stringify([r.key,r.consumerId]);
 // Trusted offline fixture input only, not reviewer authentication or evidence verification.
 const normalizeReview=(r:MockCallbackReview):MockCallbackReview=>{
  if(!r||r.provenance!=='fixture'||r.appId!==options.appId||!digest(r.key)||!digest(r.fingerprint)||!digest(r.evidenceDigest)||!validId(r.consumerId)||!validId(r.reviewerId)||!['effect_confirmed','effect_absent','inconclusive'].includes(r.decision))throw Error('CALLBACK_RECONCILIATION_INVALID');
  const entry=entries.get(r.key);
  if(!entry||entry.fingerprint!==r.fingerprint||entry.outcomes[r.consumerId]!=='unknown')throw Error('CALLBACK_RECONCILIATION_INVALID');
  return {provenance:'fixture',appId:options.appId,key:r.key,fingerprint:r.fingerprint,consumerId:r.consumerId,reviewerId:r.reviewerId,evidenceDigest:r.evidenceDigest,decision:r.decision};
 };
 const prepareCorrection=(input:MockReviewCorrection)=>{
  if(!input||!digest(input.expectedReviewId)||!digest(input.reasonDigest))throw Error('CALLBACK_RECONCILIATION_INVALID');
  const review=normalizeReview(input.review),id=reviewKey(review),history=histories.get(id);
  if(!history?.length)throw Error('CALLBACK_RECONCILIATION_INVALID');
  const parent=history.find(r=>r.id===input.expectedReviewId);
  if(!parent)throw Error('CALLBACK_RECONCILIATION_STALE');
  const record=historyRecord(review,parent.revision+1,parent.id,input.reasonDigest);
  const duplicate=history.find(r=>r.id===record.id);
  if(!duplicate&&history[history.length-1].id!==parent.id)throw Error('CALLBACK_RECONCILIATION_STALE');
  return {id,history,record,duplicate};
 };
 const tailPath=join(owner.path,'committed-tail.json');
 const invalid=():never=>{throw Error('CALLBACK_JOURNAL_INVALID');};
 const append=(data:unknown)=>{
  if(closed||poisoned||fd===undefined)throw Error('CALLBACK_JOURNAL_CLOSED');
  const payload=JSON.stringify(data),checksum=hash(previous+payload);
  const bytes=Buffer.from(JSON.stringify({payload,checksum})+'\n');
  if(size+bytes.length>MAX_BYTES){poisoned=true;throw Error('CALLBACK_JOURNAL_FULL');}
  try{let offset=0;while(offset<bytes.length){const written=writeSync(fd,bytes,offset,bytes.length-offset);if(!written)throw Error('SHORT_WRITE');offset+=written;}fsyncSync(fd);
   const marker=Buffer.from(JSON.stringify({checksum,size:size+bytes.length})),temporary=tailPath+'.'+randomUUID();
   const markerFd=openSync(temporary,'wx',0o600);
   try{let offset=0;while(offset<marker.length){const written=writeSync(markerFd,marker,offset,marker.length-offset);if(!written)throw Error('SHORT_WRITE');offset+=written;}fsyncSync(markerFd);}finally{closeSync(markerFd);}
   renameSync(temporary,tailPath);size+=bytes.length;previous=checksum;}
  catch{poisoned=true;throw Error('CALLBACK_JOURNAL_WRITE_FAILED');}
 };
 try{
  const file=join(owner.path,'callbacks.jsonl');let exists=true;
  try{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)invalid();}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')exists=false;else throw error;}
  let tail:{checksum:string;size:number}|undefined;
  try{const stat=lstatSync(tailPath);if(!exists||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024)invalid();tail=JSON.parse(readFileSync(tailPath,'utf8'));}
  catch(error){if(exists||(error as NodeJS.ErrnoException).code!=='ENOENT')invalid();}
  fd=openSync(file,exists?'a+':'wx+',0o600);
  if(!fstatSync(fd).isFile())invalid();
  if(exists){
   const raw=readFileSync(fd,'utf8');size=Buffer.byteLength(raw);if(!raw.endsWith('\n')||size>MAX_BYTES)invalid();
   const lines=raw.slice(0,-1).split('\n');
   for(let index=0;index<lines.length;index++){
    const row=JSON.parse(lines[index]);if(typeof row.payload!=='string'||row.checksum!==hash(previous+row.payload))invalid();previous=row.checksum;
    const data=JSON.parse(row.payload);
    if(index===0){if(data.version!==1||data.provenance!=='fixture'||data.appId!==options.appId||data.type!=='header')invalid();continue;}
    if(data.type==='reconciliation'){
     const review=normalizeReview(data.review),id=reviewKey(review);
     if(reviews.has(id))invalid();reviews.set(id,review);histories.set(id,[historyRecord(review,0,null,null)]);continue;
    }
    if(data.type==='reconciliation_correction'){
     const record=data.record;
     const prepared=prepareCorrection({review:record?.review,expectedReviewId:record?.previousId,reasonDigest:record?.reasonDigest});
     if(prepared.duplicate||JSON.stringify(prepared.record)!==JSON.stringify(record))invalid();
     prepared.history.push(prepared.record);continue;
    }
    if(data.type!=='entry'||!digest(data.key)||!digest(data.fingerprint)||!data.outcomes||Array.isArray(data.outcomes)||typeof data.outcomes!=='object')invalid();
    const pairs=Object.entries(data.outcomes);if(!pairs.length||pairs.some(([id,value])=>!validId(id)||!['pending','recorded','unknown'].includes(value as string)))invalid();
    const prior=entries.get(data.key);
    if(prior&&(prior.fingerprint!==data.fingerprint||JSON.stringify(Object.keys(prior.outcomes).sort())!==JSON.stringify(Object.keys(data.outcomes).sort())||Object.entries(prior.outcomes).some(([id,value])=>value!=='pending'&&value!==data.outcomes[id])))invalid();
    entries.set(data.key,{fingerprint:data.fingerprint,outcomes:data.outcomes});
   }
   if(!tail||tail.checksum!==previous||tail.size!==size)invalid();
  }else append({type:'header',version:1,provenance:'fixture',appId:options.appId});
  for(const [key,entry] of entries){
   if(Object.values(entry.outcomes).includes('pending')){
    const recovered={...entry,outcomes:Object.fromEntries(Object.entries(entry.outcomes).map(([id,value])=>[id,value==='pending'?'unknown':value])) as Record<string,Outcome>};
    append({type:'entry',key,...recovered});entries.set(key,recovered);
   }
  }
 }catch(error){if(fd!==undefined)closeSync(fd);await owner.release();if((error as Error).message.startsWith('CALLBACK_JOURNAL_'))throw error;throw Error('CALLBACK_JOURNAL_INVALID');}
 return {
  appId:options.appId,
  correctReconciliation(input){
   if(closed||poisoned)throw Error('CALLBACK_JOURNAL_CLOSED');
   const {history,record,duplicate}=prepareCorrection(input);
   if(duplicate)return structuredClone(duplicate);
   append({type:'reconciliation_correction',record});history.push(record);return structuredClone(record);
  },
  getReviewHistory(key,consumerId){
   if(closed||poisoned)throw Error('CALLBACK_JOURNAL_CLOSED');
   if(!digest(key)||!validId(consumerId))throw Error('CALLBACK_RECONCILIATION_INVALID');
   return structuredClone(histories.get(JSON.stringify([key,consumerId]))??[]);
  },
  reconcile(input){
   if(closed||poisoned)throw Error('CALLBACK_JOURNAL_CLOSED');
   const review=normalizeReview(input),id=reviewKey(review),prior=reviews.get(id);
   if(prior){if(JSON.stringify(prior)!==JSON.stringify(review))throw Error('CALLBACK_RECONCILIATION_CONFLICT');return structuredClone(prior);}
   append({type:'reconciliation',review});reviews.set(id,review);histories.set(id,[historyRecord(review,0,null,null)]);return structuredClone(review);
  },
  getReconciliations(key){
   if(closed||poisoned)throw Error('CALLBACK_JOURNAL_CLOSED');
   if(!digest(key))throw Error('CALLBACK_RECONCILIATION_INVALID');
   return [...reviews.values()].filter(r=>r.key===key).map(r=>structuredClone(r));
  },
  claim(key,fingerprint,ids){
   if(closed||poisoned)throw Error('CALLBACK_JOURNAL_CLOSED');
   if(!digest(key)||!digest(fingerprint)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!validId(id)))invalid();
   const prior=entries.get(key);if(prior)return prior.fingerprint===fingerprint?{fresh:false,outcomes:{...prior.outcomes}}:null;
   const entry:Entry={fingerprint,outcomes:Object.fromEntries(ids.map(id=>[id,'pending']))};
   append({type:'entry',key,...entry});entries.set(key,entry);return {fresh:true,outcomes:{...entry.outcomes}};
  },
  settle(key,id,outcome){
   const prior=entries.get(key);if(!prior||prior.outcomes[id]!=='pending'||!['recorded','unknown'].includes(outcome))throw Error('CALLBACK_JOURNAL_INVALID');
   const next:Entry={...prior,outcomes:{...prior.outcomes,[id]:outcome}};append({type:'entry',key,...next});entries.set(key,next);
  },
  async close(){if(closed)return;closed=true;if(fd!==undefined)closeSync(fd);await owner.release();},
 };
}
