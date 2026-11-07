import {openSync,closeSync,writeSync,fsyncSync,renameSync,lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {resolve,relative,join,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {acquireLocalPilotDirectory} from './localDirectoryLock.js';
import type {MockSessionCheckpoint} from './reviewerSessionStoreMock.js';
type Receipt={id:string;sequence:number;previousId:string|null;checkpoint:MockSessionCheckpoint};
type AnchorState={binding:string;sequence:number;id:string|null};
export type MockCheckpointAnchor={read(binding:string):AnchorState|null;advance(expected:AnchorState|null,next:AnchorState):void};
/** In-memory independent authority for tests. It must survive the ledger rollback;
 * it is NOT persistent across process loss and is NOT a production trust anchor. */
export function createMockCheckpointAnchor():MockCheckpointAnchor{
 const states=new Map<string,AnchorState>();
 return {read(binding){return structuredClone(states.get(binding)??null);},advance(expected,next){
  if(!digest(next?.binding)||!Number.isSafeInteger(next.sequence)||next.sequence<0||next.sequence>1000||(next.sequence===0?next.id!==null:!digest(next.id)))throw Error('MOCK_ANCHOR_INVALID');
  const current=states.get(next.binding)??null;
  if(JSON.stringify(current)!==JSON.stringify(expected)||(current?next.sequence!==current.sequence+1:next.sequence!==0))throw Error('MOCK_ANCHOR_STALE');
  states.set(next.binding,{binding:next.binding,sequence:next.sequence,id:next.id});
 }};
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const digest=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const contains=(a:string,b:string)=>{const r=relative(a,b);return !r||(!r.startsWith('..')&&!isAbsolute(r));};
/** Separate local fixture ledger, not an independent trusted service or real Auth. */
export async function openMockCheckpointStore(input:{provenance:'fixture';appId:string;streamId:string;directory:string;sessionDirectory:string;mode:'create'|'open';anchor?:MockCheckpointAnchor}){
 if(input?.provenance!=='fixture'||!/^[1-9][0-9]{0,63}$/.test(input.appId)||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.streamId)||!['create','open'].includes(input.mode)||typeof input.directory!=='string'||typeof input.sessionDirectory!=='string')throw Error('MOCK_CHECKPOINT_CONFIG');
 const {appId,streamId,mode,anchor}=input,source=resolve(input.sessionDirectory),directory=resolve(input.directory);
 if(anchor&&(typeof anchor.read!=='function'||typeof anchor.advance!=='function'))throw Error('MOCK_CHECKPOINT_CONFIG');
 if(contains(source,directory)||contains(directory,source))throw Error('MOCK_CHECKPOINT_CONFIG');
 const root=realpathSync(resolve('.superpowers'));
 if(source===root||!contains(root,source))throw Error('MOCK_CHECKPOINT_CONFIG');
 let cursor=root;
 for(const component of relative(root,source).split(sep)){
  cursor=join(cursor,component);
  try{const stat=lstatSync(cursor);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('MOCK_CHECKPOINT_CONFIG');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')break;throw error;}
 }
 const owner=await acquireLocalPilotDirectory(directory);let closed=false,poisoned=false;const receipts:Receipt[]=[];
 const bound={version:1,provenance:'fixture',appId,streamId,source,...(anchor?{anchored:true}:{})};
 const binding=hash(JSON.stringify(bound));
 const state=():AnchorState=>({binding,sequence:receipts.length,id:receipts.at(-1)?.id??null});
 const checkAnchor=(expected=state())=>{if(anchor&&JSON.stringify(anchor.read(binding))!==JSON.stringify(expected))throw Error('MOCK_ANCHOR_STALE');};
 const available=()=>{if(closed||poisoned)throw Error('MOCK_CHECKPOINT_CLOSED');try{checkAnchor();}catch{poisoned=true;throw Error('MOCK_CHECKPOINT_CLOSED');}};
 const make=(checkpoint:MockSessionCheckpoint,sequence:number,previousId:string|null):Receipt=>{const body={sequence,previousId,checkpoint:{appId:checkpoint.appId,checksum:checkpoint.checksum}};return {id:hash(JSON.stringify([bound,body])),...body};};
 const read=(name:string)=>{const file=join(owner.path,name),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>8192)throw Error('MOCK_CHECKPOINT_INVALID');return JSON.parse(readFileSync(file,'utf8'));};
 const write=(name:string,value:unknown,replace=false)=>{const file=join(owner.path,name),path=replace?file+'.pending':file;const fd=openSync(path,'wx',0o600);try{const bytes=Buffer.from(JSON.stringify(value));let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(!n)throw Error('SHORT_WRITE');offset+=n;}fsyncSync(fd);}finally{closeSync(fd);}if(replace)renameSync(path,file);};
 try{
  const files=readdirSync(owner.path);
  if(mode==='create'){
   if(anchor&&anchor.read(binding)!==null)throw Error('MOCK_CHECKPOINT_INVALID');
   if(files.length)throw Error('MOCK_CHECKPOINT_INVALID');write('head.json',{...bound,sequence:0,id:null});
   anchor?.advance(null,state());
  }else{
   const head=read('head.json');
   if((head.anchored===true)!==Boolean(anchor)||Object.entries(bound).some(([k,v])=>head[k]!==v)||!Number.isSafeInteger(head.sequence)||head.sequence<0||head.sequence>1000||files.length!==head.sequence+1)throw Error('MOCK_CHECKPOINT_INVALID');
   for(let sequence=1;sequence<=head.sequence;sequence++){
    const record=read(`checkpoint-${sequence}.json`);
    if(record.checkpoint?.appId!==appId||!digest(record.checkpoint?.checksum))throw Error('MOCK_CHECKPOINT_INVALID');
    const expected=make(record.checkpoint,sequence,receipts.at(-1)?.id??null);
    if(JSON.stringify(expected)!==JSON.stringify(record)||receipts.some(r=>r.checkpoint.checksum===record.checkpoint.checksum))throw Error('MOCK_CHECKPOINT_INVALID');receipts.push(expected);
   }
   if(head.id!==(receipts.at(-1)?.id??null))throw Error('MOCK_CHECKPOINT_INVALID');
  }
  checkAnchor();
 }catch{await owner.release();throw Error('MOCK_CHECKPOINT_INVALID');}
 return {
  record(checkpoint:MockSessionCheckpoint,expectedHead:string|null):Receipt{
   available();if(checkpoint?.appId!==appId||!digest(checkpoint?.checksum))throw Error('MOCK_CHECKPOINT_INVALID');
   const current=receipts.at(-1);if(expectedHead!==(current?.id??null))throw Error('MOCK_CHECKPOINT_STALE');
   if(current?.checkpoint.checksum===checkpoint.checksum)return structuredClone(current);
   if(receipts.some(r=>r.checkpoint.checksum===checkpoint.checksum))throw Error('MOCK_CHECKPOINT_ROLLBACK');
   if(receipts.length>=1000)throw Error('MOCK_CHECKPOINT_FULL');const receipt=make(checkpoint,receipts.length+1,current?.id??null);
   try{write(`checkpoint-${receipt.sequence}.json`,receipt);write('head.json',{...bound,sequence:receipt.sequence,id:receipt.id},true);
    const next={binding,sequence:receipt.sequence,id:receipt.id};anchor?.advance(state(),next);checkAnchor(next);receipts.push(receipt);
   }catch{poisoned=true;throw Error('MOCK_CHECKPOINT_WRITE_FAILED');}
   return structuredClone(receipt);
  },
  latest(){available();const current=receipts.at(-1);if(!current)throw Error('MOCK_CHECKPOINT_MISSING');return structuredClone(current);},
  history(){available();return structuredClone(receipts);},
  verify(checkpoint:MockSessionCheckpoint,receiptId:string):MockSessionCheckpoint{
   available();const current=receipts.at(-1);if(!current)throw Error('MOCK_CHECKPOINT_MISSING');
   if(!checkpoint||checkpoint.appId!==appId||checkpoint.checksum!==current.checkpoint.checksum||receiptId!==current.id)throw Error('MOCK_CHECKPOINT_STALE');return structuredClone(current.checkpoint);
  },
  async close(){if(closed)return;closed=true;await owner.release();},
 };
}
