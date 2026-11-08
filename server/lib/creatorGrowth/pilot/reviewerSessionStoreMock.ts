import {openSync,closeSync,writeSync,fsyncSync,renameSync,lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {acquireLocalPilotDirectory} from './localDirectoryLock.js';
import type {MockReviewer} from './reviewerPermissionsMock.js';
type Session={reviewerId:string;sessionId:string;issuedAt:number;expiresAt:number;revoked:boolean};
export type MockSessionCheckpoint={appId:string;checksum:string};
const id=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const valid=(s:Session)=>s&&id(s.reviewerId)&&id(s.sessionId)&&Number.isSafeInteger(s.issuedAt)&&s.issuedAt>=0&&Number.isSafeInteger(s.expiresAt)&&s.expiresAt>s.issuedAt&&typeof s.revoked==='boolean';
/** Local fixtures only: aliases are not authentication tokens. Keep this store private. */
export async function openMockReviewerSessions(deps:{provenance:'fixture';appId:string;directory:string;expectedCheckpoint?:MockSessionCheckpoint;now:()=>number;reviewer:(id:string)=>Omit<MockReviewer,'session'>|null}){
 if(deps?.provenance!=='fixture'||!/^[1-9][0-9]{0,63}$/.test(deps.appId)||typeof deps.now!=='function'||typeof deps.reviewer!=='function')throw Error('MOCK_SESSION_CONFIG');
 if(deps.expectedCheckpoint&&(deps.expectedCheckpoint.appId!==deps.appId||typeof deps.expectedCheckpoint.checksum!=='string'||!/^[a-f0-9]{64}$/.test(deps.expectedCheckpoint.checksum)))throw Error('MOCK_SESSION_CONFIG');
 const expected=deps.expectedCheckpoint?{...deps.expectedCheckpoint}:undefined;
 const owner=await acquireLocalPilotDirectory(deps.directory),appId=deps.appId;
 const file=join(owner.path,'sessions.json'),tail=join(owner.path,'sessions-tail.json');
 let closed=false,poisoned=false,committedChecksum='';let sessions=new Map<string,Session>();
 const available=()=>{if(closed||poisoned)throw Error('MOCK_SESSION_CLOSED');};
 const exists=(path:string)=>{try{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024)throw Error('MOCK_SESSION_INVALID');return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}};
 const write=(path:string,value:string)=>{
  const fd=openSync(path+'.pending','wx',0o600);try{const bytes=Buffer.from(value);let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(!n)throw Error('SHORT_WRITE');offset+=n;}fsyncSync(fd);}finally{closeSync(fd);}renameSync(path+'.pending',path);
 };
 const persist=(next:Map<string,Session>)=>{
  available();const payload=JSON.stringify({version:1,provenance:'fixture',appId,sessions:[...next.values()]});
  if(next.size>1000||Buffer.byteLength(payload)>1024*1024)throw Error('MOCK_SESSION_FULL');
  try{write(file,payload);write(tail,JSON.stringify({checksum:hash(payload)}));sessions=next;committedChecksum=hash(payload);}
  catch{poisoned=true;throw Error('MOCK_SESSION_WRITE_FAILED');}
 };
 try{
  if(exists(file+'.pending')||exists(tail+'.pending'))throw Error('MOCK_SESSION_INVALID');
  const hasFile=exists(file),hasTail=exists(tail);if(hasFile!==hasTail)throw Error('MOCK_SESSION_INVALID');
  if(expected&&!hasFile)throw Error('MOCK_SESSION_INVALID');
  if(hasFile){const payload=readFileSync(file,'utf8'),marker=JSON.parse(readFileSync(tail,'utf8')),data=JSON.parse(payload);
   if(marker.checksum!==hash(payload)||data.version!==1||data.provenance!=='fixture'||data.appId!==appId||!Array.isArray(data.sessions)||data.sessions.length>1000)throw Error('MOCK_SESSION_INVALID');
   if(expected&&expected.checksum!==hash(payload))throw Error('MOCK_SESSION_INVALID');
   for(const item of data.sessions){if(!valid(item)||sessions.has(item.sessionId))throw Error('MOCK_SESSION_INVALID');sessions.set(item.sessionId,{reviewerId:item.reviewerId,sessionId:item.sessionId,issuedAt:item.issuedAt,expiresAt:item.expiresAt,revoked:item.revoked});}
   committedChecksum=hash(payload);
  }else persist(new Map());
 }catch{await owner.release();throw Error('MOCK_SESSION_INVALID');}
 return {
  checkpoint():MockSessionCheckpoint{available();return {appId,checksum:committedChecksum};},
  issue(input:Omit<Session,'revoked'>){
   available();const record:Session={reviewerId:input?.reviewerId,sessionId:input?.sessionId,issuedAt:input?.issuedAt,expiresAt:input?.expiresAt,revoked:false},now=deps.now();
   if(!valid(record)||!Number.isSafeInteger(now)||record.issuedAt>now||record.expiresAt<=now)throw Error('MOCK_SESSION_INVALID');
   if(sessions.has(record.sessionId))throw Error('MOCK_SESSION_EXISTS');
   const next=new Map(sessions);next.set(record.sessionId,record);persist(next);
  },
  revoke(sessionId:string){available();const record=sessions.get(sessionId);if(!record)throw Error('MOCK_SESSION_INVALID');if(record.revoked)return;const next=new Map(sessions);next.set(sessionId,{...record,revoked:true});persist(next);},
  resolve(sessionId:string):MockReviewer|null{
   available();const record=sessions.get(sessionId);if(!record||record.revoked)return null;
   try{const now=deps.now();if(!Number.isSafeInteger(now)||now<record.issuedAt||now>=record.expiresAt)return null;const reviewer=deps.reviewer(record.reviewerId);
    available();const current=sessions.get(sessionId),checkedAt=deps.now();
    if(!current||current.revoked||!Number.isSafeInteger(checkedAt)||checkedAt<current.issuedAt||checkedAt>=current.expiresAt||!reviewer||reviewer.id!==current.reviewerId||reviewer.active!==true)return null;
    return structuredClone({id:reviewer.id,active:reviewer.active,grants:reviewer.grants,session:{id:current.sessionId,issuedAt:current.issuedAt,expiresAt:current.expiresAt,revoked:current.revoked}});
   }catch{return null;}
  },
  async close(){if(closed)return;closed=true;await owner.release();},
 };
}
