// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectPilotArtifacts} from './controlled-pilot-artifacts.js';
it('computes bytes independently and refuses missing, changed and escaped evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pilot-artifacts-'));
 try{
  await mkdir(join(root,'review'));await writeFile(join(root,'review/sql.sql'),'select 1;');
  const sha=createHash('sha256').update('select 1;').digest('hex');
  expect(await inspectPilotArtifacts(root,[{name:'sql',path:'review/sql.sql',sha256:sha}])).toEqual({verified:true,executionAllowed:false,artifacts:[{name:'sql',sha256:sha}],blockers:[]});
  for(const patch of [{path:'../secret'},{path:join(root,'review/sql.sql')},{sha256:'b'.repeat(64)},{path:'review/missing.sql'}]){
   const r=await inspectPilotArtifacts(root,[{name:'sql',path:'review/sql.sql',sha256:sha,...patch}]);expect(r.verified).toBe(false);expect(r.executionAllowed).toBe(false);expect(JSON.stringify(r)).not.toContain(root);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
it('does not treat empty inventories or repeated names as approval',async()=>{
 expect((await inspectPilotArtifacts('.',[])).verified).toBe(false);
 expect((await inspectPilotArtifacts('.',[{name:'sql',path:'a',sha256:'a'.repeat(64)},{name:'sql',path:'b',sha256:'a'.repeat(64)}])).verified).toBe(false);
});
