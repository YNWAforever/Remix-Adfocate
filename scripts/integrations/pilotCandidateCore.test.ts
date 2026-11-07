// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod,mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildCandidateCore,verifyCandidateCore} from './pilotCandidateCore.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function repository(){
 const root=resolve('.superpowers',`pilot-candidate-${randomUUID()}`);roots.push(root);await mkdir(root);
 await Promise.all(['src','server','api','scripts/integrations','supabase/migrations','public','.github/workflows','node_modules','dist','.superpowers','docs/review/kocmax-controlled-pilot'].map(path=>mkdir(join(root,path),{recursive:true})));
 const files:Record<string,string>={
  'package.json':'{"name":"candidate-fixture"}',
  'package-lock.json':'{"lockfileVersion":3}',
  'tsconfig.json':'{"compilerOptions":{}}',
  'vite.config.ts':'export default {};',
  'vite.p5-candidate.config.ts':'export default {};',
  'playwright.p5-candidate.config.ts':'export default {};',
  '.gitignore':'*.local\n',
  '.env.example':'VITE_SUPABASE_URL=\nINSTAGRAM_CONNECTIONS_ENABLED=false\n',
  'src/app.ts':'export const app=1;\n',
  'server/main.ts':'export const server=1;\n',
  'api/index.ts':'export const api=1;\n',
  'scripts/integrations/check.ts':'export const check=1;\n',
  'supabase/migrations/001_test.sql':'select 1;\n',
  'public/asset.txt':'asset\n',
  '.github/workflows/ci.yml':'name: ci\n',
  'node_modules/ignored.ts':'ignored\n',
  'dist/ignored.js':'ignored\n',
  '.superpowers/ignored.log':'ignored\n',
  'docs/ignored.md':'ignored\n',
  'docs/review/kocmax-controlled-pilot/native-offline-bundle.sql':'select 1;\n',
  'docs/review/kocmax-controlled-pilot/native-offline-rollback.sql':'select 2;\n',
  'docs/review/kocmax-controlled-pilot/p5-candidate-core.json':'{}\n',
 };
 for(const [path,content] of Object.entries(files))await writeFile(join(root,path),content);
 execFileSync('git',['init','-b','main'],{cwd:root,stdio:'ignore'});
 execFileSync('git',['config','core.autocrlf','false'],{cwd:root});
 execFileSync('git',['config','user.email','fixture@example.invalid'],{cwd:root});
 execFileSync('git',['config','user.name','Fixture'],{cwd:root});
 execFileSync('git',['add','.'],{cwd:root});
 execFileSync('git',['commit','-m','fixture'],{cwd:root,stdio:'ignore'});
 await writeFile(join(root,'server/untracked.ts'),'export const untracked=1;\n');
 return root;
}
it('hashes deterministic tracked and untracked candidate inputs without secrets or exclusions',async()=>{
 const root=await repository();const first=await buildCandidateCore(root),second=await buildCandidateCore(root);
 expect(first.candidateId).toBe(second.candidateId);
 expect(first.files.map(file=>file.path)).toEqual([...first.files.map(file=>file.path)].sort());
 expect(first.files.some(file=>file.path==='server/untracked.ts')).toBe(true);
 expect(first.files.some(file=>file.path.startsWith('src/'))).toBe(true);
 expect(first.files.map(file=>file.path)).toEqual(expect.arrayContaining([
  '.gitignore','vite.p5-candidate.config.ts','playwright.p5-candidate.config.ts',
  'docs/review/kocmax-controlled-pilot/native-offline-bundle.sql',
  'docs/review/kocmax-controlled-pilot/native-offline-rollback.sql',
 ]));
 expect(first.files.some(file=>/^(?:node_modules|dist|\.superpowers)\//.test(file.path)||/^(?:docs\/ignored\.md|docs\/.*\/p5-candidate-core\.json)$/.test(file.path))).toBe(false);
 expect(first.executionAllowed).toBe(false);
 expect(first.configContract).toContainEqual({name:'INSTAGRAM_CONNECTIONS_ENABLED',classification:'server-only',required:true,present:true});
 expect(JSON.stringify(first)).not.toContain('VITE_SUPABASE_URL=\n');
});
it('verifies the exact candidate and rejects byte or selection changes',async()=>{
 const root=await repository(),core=await buildCandidateCore(root);
 expect(await verifyCandidateCore(root,core)).toMatchObject({verified:true,blockers:[],executionAllowed:false});
 await writeFile(join(root,'src/app.ts'),'export const app=2;\n');
 expect((await verifyCandidateCore(root,core)).blockers).toContain('candidate_file_changed:src/app.ts');
 await writeFile(join(root,'src/app.ts'),'export const app=1;\n');
 await writeFile(join(root,'docs/review/kocmax-controlled-pilot/native-offline-rollback.sql'),'select 3;\n');
 expect((await verifyCandidateCore(root,core)).blockers).toContain('candidate_file_changed:docs/review/kocmax-controlled-pilot/native-offline-rollback.sql');
 await writeFile(join(root,'docs/review/kocmax-controlled-pilot/native-offline-rollback.sql'),'select 2;\n');
 await writeFile(join(root,'api/extra.ts'),'export const extra=1;\n');
 expect((await verifyCandidateCore(root,core)).blockers).toContain('candidate_selection_changed');
});
it('rejects malformed candidate records and path escapes',async()=>{
 const root=await repository(),core=await buildCandidateCore(root);
 for(const patch of [
  {candidateId:'bad'},
  {files:[{...core.files[0],path:'../escape'}]},
  {files:[{...core.files[0],sha256:'bad'}]},
  {files:[null]},
  {executionAllowed:true},
 ]){
  expect((await verifyCandidateCore(root,{...core,...patch} as never)).verified).toBe(false);
 }
});
it('fails closed if a selected path becomes a symlink',async()=>{
 const root=await repository();
 try{await symlink('app.ts',join(root,'src/link.ts'));}catch(error){if((error as NodeJS.ErrnoException).code==='EPERM')return;throw error;}
 await expect(buildCandidateCore(root)).rejects.toThrow('CANDIDATE_SYMLINK');
});
it('records executable mode and respects the file size bound',async()=>{
 const root=await repository();await chmod(join(root,'scripts/integrations/check.ts'),0o755);
 const core=await buildCandidateCore(root),entry=core.files.find(file=>file.path==='scripts/integrations/check.ts');
 expect(typeof entry?.executable).toBe('boolean');
 if(process.platform!=='win32')expect(entry?.executable).toBe(true);
 await writeFile(join(root,'api/large.ts'),'x'.repeat(16*1024*1024+1));
 await expect(buildCandidateCore(root)).rejects.toThrow('CANDIDATE_FILE_TOO_LARGE');
});
