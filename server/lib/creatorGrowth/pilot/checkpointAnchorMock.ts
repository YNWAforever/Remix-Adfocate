import {closeSync,fsyncSync,lstatSync,openSync,readFileSync,renameSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {acquireLocalPilotDirectory} from './localDirectoryLock.js';
import type {MockCheckpointAnchor} from './checkpointStoreMock.js';

type AnchorState={binding:string;sequence:number;id:string|null};
type Snapshot={version:1;provenance:'fixture';states:AnchorState[]};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validState=(state:AnchorState)=>state&&digest(state.binding)&&Number.isSafeInteger(state.sequence)&&state.sequence>=0&&state.sequence<=1000&&(state.sequence===0?state.id===null:digest(state.id));

/**
 * Persistent local fixture authority. This is a mock trust boundary only: it
 * survives a process restart, but it is not an authenticated or remote service.
 */
export async function openMockCheckpointAnchor(input:{
 provenance:'fixture';
 directory:string;
 mode:'create'|'open';
}):Promise<MockCheckpointAnchor&{close():Promise<void>}>{
 if(input?.provenance!=='fixture'||typeof input.directory!=='string'||!['create','open'].includes(input.mode))throw Error('MOCK_ANCHOR_CONFIG');
 const owner=await acquireLocalPilotDirectory(input.directory);
 const snapshotPath=join(owner.path,'anchor.json');
 const markerPath=join(owner.path,'anchor-tail.json');
 let closed=false;
 let poisoned=false;
 let states=new Map<string,AnchorState>();
 const available=()=>{if(closed||poisoned)throw Error('MOCK_ANCHOR_CLOSED');};
 const exists=(path:string)=>{try{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>128*1024)throw Error('MOCK_ANCHOR_INVALID');return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}};
 const writeAtomic=(path:string,value:string)=>{
  const temporary=`${path}.pending`;
  const fd=openSync(temporary,'wx',0o600);
  try{
   const bytes=Buffer.from(value);
   let offset=0;
   while(offset<bytes.length){
    const written=writeSync(fd,bytes,offset,bytes.length-offset);
    if(!written)throw Error('MOCK_ANCHOR_WRITE_FAILED');
    offset+=written;
   }
   fsyncSync(fd);
  }finally{closeSync(fd);}
  renameSync(temporary,path);
 };
 const persist=(next:Map<string,AnchorState>)=>{
  const snapshot:Snapshot={version:1,provenance:'fixture',states:[...next.values()]};
  const payload=JSON.stringify(snapshot);
  const marker=JSON.stringify({checksum:hash(payload)});
  try{writeAtomic(snapshotPath,payload);writeAtomic(markerPath,marker);states=next;}
  catch{poisoned=true;throw Error('MOCK_ANCHOR_WRITE_FAILED');}
 };
 try{
  const hasSnapshot=exists(snapshotPath),hasMarker=exists(markerPath);
  if(exists(`${snapshotPath}.pending`)||exists(`${markerPath}.pending`))throw Error('MOCK_ANCHOR_INVALID');
  if(hasSnapshot!==hasMarker)throw Error('MOCK_ANCHOR_INVALID');
  if(input.mode==='open'&&!hasSnapshot)throw Error('MOCK_ANCHOR_INVALID');
  if(input.mode==='create'&&hasSnapshot)throw Error('MOCK_ANCHOR_INVALID');
  if(hasSnapshot){
   const payload=readFileSync(snapshotPath,'utf8');
   const data=JSON.parse(payload) as Snapshot;
   const marker=JSON.parse(readFileSync(markerPath,'utf8'));
   if(marker.checksum!==hash(payload)||data.version!==1||data.provenance!=='fixture'||!Array.isArray(data.states)||data.states.length>1000)throw Error('MOCK_ANCHOR_INVALID');
   for(const state of data.states){
    if(!validState(state)||states.has(state.binding))throw Error('MOCK_ANCHOR_INVALID');
    states.set(state.binding,{binding:state.binding,sequence:state.sequence,id:state.id});
   }
  }else persist(new Map());
 }catch(error){
  await owner.release();
  if((error as Error).message==='MOCK_ANCHOR_CONFIG')throw error;
  throw Error('MOCK_ANCHOR_INVALID');
 }
 return {
  read(binding:string){
   available();if(!digest(binding))throw Error('MOCK_ANCHOR_INVALID');
   return structuredClone(states.get(binding)??null);
  },
  advance(expected:AnchorState|null,next:AnchorState){
   available();
   if(!validState(next)||expected?.binding!==undefined&&expected.binding!==next.binding)throw Error('MOCK_ANCHOR_INVALID');
   const current=states.get(next.binding)??null;
   if(JSON.stringify(current)!==JSON.stringify(expected)||(current?next.sequence!==current.sequence+1:next.sequence!==0))throw Error('MOCK_ANCHOR_STALE');
   const updated=new Map(states);updated.set(next.binding,{binding:next.binding,sequence:next.sequence,id:next.id});
   persist(updated);
  },
  async close(){if(closed)return;closed=true;await owner.release();},
 };
}
