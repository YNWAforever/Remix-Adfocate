import {createHash} from 'node:crypto';
import {lstat,open,realpath} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve} from 'node:path';
export type PilotArtifact = {name:string;path:string;sha256:string};
/** Read-only byte verification, not proof that a referenced claim is true or approved. */
export async function inspectPilotArtifacts(root:string,entries:readonly PilotArtifact[]) {
 const blockers:string[]=[],artifacts:{name:string;sha256:string}[]=[];
 const result=()=>({verified:blockers.length===0,executionAllowed:false as const,artifacts,blockers});
 if(!Array.isArray(entries)||!entries.length||entries.length>100)return {...result(),verified:false,blockers:['artifact_inventory']};
 let base:string;try{base=await realpath(root);}catch{return {...result(),verified:false,blockers:['artifact_root']};}
 const names=new Set<string>();
 for(const entry of entries){
  const name=entry?.name;
  if(typeof name!=='string'||!/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(name)||names.has(name)){blockers.push('artifact_name');continue;}names.add(name);
  try{
   if(typeof entry.path!=='string'||isAbsolute(entry.path)||entry.path.includes('\\')||entry.path.includes(':')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error();
   let cursor=base;for(const part of entry.path.split('/')){cursor=join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw new Error();}
   const path=await realpath(cursor),rel=relative(base,path);if(!rel||rel.startsWith('..')||isAbsolute(rel)||resolve(base,entry.path)!==path)throw new Error();
   const file=await open(path,'r');let sha:string;
   try{const before=await file.stat();if(!before.isFile()||before.size>16*1024*1024)throw new Error();const bytes=await file.readFile();const after=await file.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==before.size)throw new Error();sha=createHash('sha256').update(bytes).digest('hex');}finally{await file.close();}
   if(sha!==entry.sha256)throw new Error();artifacts.push({name,sha256:sha});
  }catch{blockers.push(`artifact:${name}`);}
 }
 return result();
}
