import {createHash} from 'node:crypto';
export type FixtureNotice=Readonly<{
 provenance:'fixture';product:'facebook_login';appId:string;subject:string;
 eventId:string;kind:'deauthorization'|'data_deletion';issuedAt:number;
}>;
export type Outcome='pending'|'recorded'|'unknown';
export interface CallbackJournal {
 appId:string;
 claim(key:string,fingerprint:string,ids:readonly string[]):{fresh:boolean;outcomes:Record<string,Outcome>}|null;
 settle(key:string,id:string,outcome:'recorded'|'unknown'):void;
}
type Result={sampleOnly:true;status:'held'|'processing'|'recorded'|'unknown';outcomes:Record<string,Outcome>};
type Dependencies={
 journal?:CallbackJournal;
 provenance:'fixture';appId:string;now:()=>number;maxAgeMs:number;
 verify:(raw:string)=>Promise<FixtureNotice>;
 consumers:readonly {id:string;handle:(notice:FixtureNotice)=>Promise<void>}[];
 mappings:readonly {subject:string;complete:boolean;consumerIds:readonly string[]}[];
};
const numeric=(value:unknown):value is string=>typeof value==='string'&&/^[1-9][0-9]{0,63}$/.test(value);
const key=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const held=():Result=>({sampleOnly:true,status:'held',outcomes:{}});

/** Offline contract only. No Meta signature algorithm, HTTP endpoint, network,
 * OAuth exchange or runtime registration. Optional local mock journal only. Explicit complete mappings
 * model trusted server inventory; a real subject may belong to multiple consumers.
 * Recorded means handler returned, NOT provider revoked or personal data erased.
 * In-memory replay state cannot establish crash/restart durability for a live pilot.
 */
export function createSharedCallbackMock(deps:Dependencies){
 const invalid=()=>{throw new Error('CALLBACK_MOCK_CONFIG');};
 if(deps?.provenance!=='fixture'||!numeric(deps.appId)||!Number.isSafeInteger(deps.maxAgeMs)||deps.maxAgeMs<=0||deps.maxAgeMs>86_400_000||typeof deps.now!=='function'||typeof deps.verify!=='function')invalid();
 const appId=deps.appId,maxAge=deps.maxAgeMs,verify=deps.verify,now=deps.now;
 if(deps.journal&&deps.journal.appId!==appId)invalid();
 const consumers=new Map<string,Dependencies['consumers'][number]['handle']>();
 const mappings=new Map<string,{complete:boolean;consumerIds:string[]}>();
 for(const c of deps.consumers){if(!key(c.id)||consumers.has(c.id)||typeof c.handle!=='function')invalid();consumers.set(c.id,c.handle);}
 for(const m of deps.mappings){
  if(!numeric(m.subject)||mappings.has(m.subject)||typeof m.complete!=='boolean'||!Array.isArray(m.consumerIds)||!m.consumerIds.length||new Set(m.consumerIds).size!==m.consumerIds.length||m.consumerIds.some(id=>!consumers.has(id)))invalid();
  mappings.set(m.subject,{complete:m.complete,consumerIds:[...m.consumerIds]});
 }
 const journal=new Map<string,{fingerprint:string;result:Result}>();
 return {async receive(raw:string):Promise<Result>{
  if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw,'utf8')>8192)return held();
  let n:FixtureNotice;
  try{
   const v=await verify(raw),time=now();
   if(!v||v.provenance!=='fixture'||v.product!=='facebook_login'||v.appId!==appId||!numeric(v.subject)||!key(v.eventId)||!['deauthorization','data_deletion'].includes(v.kind)||!Number.isSafeInteger(v.issuedAt)||v.issuedAt<0||!Number.isSafeInteger(time)||time<v.issuedAt||time-v.issuedAt>maxAge)return held();
   // Do not forward raw payload, credentials or arbitrary verifier fields.
   n=Object.freeze({provenance:'fixture',product:'facebook_login',appId,subject:v.subject,eventId:v.eventId,kind:v.kind,issuedAt:v.issuedAt});
  }catch{return held();}
  const mapping=mappings.get(n.subject);if(!mapping?.complete)return held();
  const fingerprint=createHash('sha256').update(JSON.stringify([n,[...mapping.consumerIds].sort()])).digest('hex'),prior=journal.get(n.eventId);
  if(prior)return prior.fingerprint===fingerprint?structuredClone(prior.result):held();
  const eventKey=createHash('sha256').update(JSON.stringify([appId,n.eventId])).digest('hex');
  if(deps.journal){
   try{
    const claim=deps.journal.claim(eventKey,fingerprint,mapping.consumerIds);
    if(!claim)return held();
    if(!claim.fresh){const values=Object.values(claim.outcomes);return {sampleOnly:true,status:values.includes('pending')?'processing':values.includes('unknown')?'unknown':'recorded',outcomes:claim.outcomes};}
   }catch{return held();}
  }
  const result:Result={sampleOnly:true,status:'processing',outcomes:Object.fromEntries(mapping.consumerIds.map(id=>[id,'pending' as const]))};
  // Claim synchronously before any consumer awaits; duplicates cannot resend.
  journal.set(n.eventId,{fingerprint,result});
  await Promise.all(mapping.consumerIds.map(async id=>{
   try{await consumers.get(id)!(n);result.outcomes[id]='recorded';}
   catch{result.outcomes[id]='unknown';}
   try{deps.journal?.settle(eventKey,id,result.outcomes[id] as 'recorded'|'unknown');}catch{result.outcomes[id]='unknown';}
  }));
  result.status=Object.values(result.outcomes).includes('unknown')?'unknown':'recorded';
  return structuredClone(result);
 }};
}
