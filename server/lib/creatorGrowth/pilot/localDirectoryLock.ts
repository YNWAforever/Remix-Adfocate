import {mkdir,realpath,lstat,writeFile,readFile,unlink,rmdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Fail closed on stale locks too: recovery requires an explicit offline copy. */
export async function acquireLocalPilotDirectory(directory:string){
 const root=await realpath(resolve('.superpowers'));
 const lexical=resolve(directory),rel=relative(root,lexical);
 if(!rel||rel.startsWith('..')||isAbsolute(rel)||directory.includes('://'))throw Error('LOCAL_PILOT_PATH_REQUIRED');
 // Resolve every existing component before creating a descendant. Reject junctions,
 // even inward ones, so a rejected traversal cannot create an outside directory.
 let parent=root;
 for(const component of rel.split(sep)){
  if(await realpath(parent)!==parent)throw Error('LOCAL_PILOT_PATH_REQUIRED');
  const next=join(parent,component);
  try{const stat=await lstat(next);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('LOCAL_PILOT_PATH_REQUIRED');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await mkdir(next);}
  if(await realpath(next)!==next)throw Error('LOCAL_PILOT_PATH_REQUIRED');
  parent=next;
 }
 const path=await realpath(lexical),realRel=relative(root,path);
 if(!realRel||realRel.startsWith('..')||isAbsolute(realRel))throw Error('LOCAL_PILOT_PATH_REQUIRED');
 const lock=path+'.owner-lock',token=randomUUID(),owner=join(lock,'owner.json');
 try{await mkdir(lock);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('LOCAL_PILOT_IN_USE');throw e;}
 await writeFile(owner,JSON.stringify({pid:process.pid,token}),{flag:'wx'});
 let released=false;
 return {path,async release(){if(released)return;const record=JSON.parse(await readFile(owner,'utf8'));if(record.token!==token)throw Error('LOCAL_PILOT_LOCK_CHANGED');await unlink(owner);await rmdir(lock);released=true;}};
}
