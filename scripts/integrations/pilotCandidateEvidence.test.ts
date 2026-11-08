// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildEvidenceManifest,verifyEvidenceManifest,type EvidenceRun} from './pilotCandidateEvidence.js';
import type {CandidateCore} from './pilotCandidateCore.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const core:CandidateCore={version:1,candidateId:'a'.repeat(64),generatedAt:'2026-11-07T00:00:00.000Z',branch:'main',head:'b'.repeat(40),dirtyWorktree:true,files:[],configContract:[],executionAllowed:false};
async function workspace(){
 const root=resolve('.superpowers',`pilot-evidence-${randomUUID()}`);roots.push(root);await mkdir(join(root,'logs'),{recursive:true});
 const kinds=[['test','tests.log'],['build','build.log'],['lint','lint.log'],['typecheck','types.log'],['browser','browser.log'],['inventory','inventory.log']] as const;
 const runs:EvidenceRun[]=[];
 for(const [index,[kind,name]] of kinds.entries()){
  const content=`${kind} pass\n`;await writeFile(join(root,'logs',name),content);
  runs.push({candidateId:core.candidateId,completedCandidateId:core.candidateId,kind,command:`offline ${kind}`,environment:kind==='browser'?'local-browser':'offline',startedAt:`2026-11-07T00:0${index}:00.000Z`,completedAt:`2026-11-07T00:0${index}:30.000Z`,exitCode:0,logPath:`logs/${name}`,logSha256:hash(content)});
 }
 return {root,runs};
}
it('binds ordered offline evidence to the exact candidate',async()=>{
 const {root,runs}=await workspace();const first=await buildEvidenceManifest(root,core,runs),second=await buildEvidenceManifest(root,core,runs);
 expect(first.runId).toBe(second.runId);expect(first.candidateId).toBe(core.candidateId);expect(first.executionAllowed).toBe(false);
 expect(await verifyEvidenceManifest(root,core,first)).toMatchObject({verified:true,blockers:[],executionAllowed:false});
});
it('rejects missing run kinds, candidate mismatch and failed commands',async()=>{
 const {root,runs}=await workspace();const manifest=await buildEvidenceManifest(root,core,runs);
 expect((await verifyEvidenceManifest(root,{...core,candidateId:'c'.repeat(64)},manifest)).verified).toBe(false);
 expect((await verifyEvidenceManifest(root,core,{...manifest,runs:manifest.runs.filter(run=>run.kind!=='browser')})).blockers).toContain('evidence_required_browser');
 const failed=manifest.runs.map(run=>run.kind==='test'?{...run,exitCode:1}:run);
 expect((await verifyEvidenceManifest(root,core,{...manifest,runs:failed})).blockers).toContain('evidence_exit:test');
});
it('rejects changed, symlinked and escaped evidence logs',async()=>{
 const {root,runs}=await workspace();const manifest=await buildEvidenceManifest(root,core,runs);
 await writeFile(join(root,'logs/tests.log'),'tampered\n');
 expect((await verifyEvidenceManifest(root,core,manifest)).blockers).toContain('evidence_log_hash:test');
 await rm(join(root,'logs/build.log'));
 try{await symlink('tests.log',join(root,'logs/build.log'));expect((await verifyEvidenceManifest(root,core,manifest)).blockers).toContain('evidence_log_path:build');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EPERM')throw error;}
 expect((await verifyEvidenceManifest(root,core,{...manifest,runs:manifest.runs.map(run=>run.kind==='test'?{...run,logPath:'../escape'}:run)})).blockers).toContain('evidence_log_path:test');
});
it('refuses to rebind old logs or accept a change during verification',async()=>{
 const {root,runs}=await workspace();
 const changed='c'.repeat(64);
 await expect(buildEvidenceManifest(root,{...core,candidateId:changed},runs)).rejects.toThrow('evidence_run_candidate');
 await expect(buildEvidenceManifest(root,core,runs.map((run,index)=>index===1?{...run,completedCandidateId:changed}:run))).rejects.toThrow('evidence_run_candidate');
 await expect(buildEvidenceManifest(root,{...core,generatedAt:'2026-11-07T00:10:00.000Z'},runs)).rejects.toThrow('evidence_run_before_freeze');
});
it('rejects online environments, reversed timestamps and malformed run IDs',async()=>{
 const {root,runs}=await workspace();const manifest=await buildEvidenceManifest(root,core,runs);
 const online=manifest.runs.map((run,index)=>index===0?{...run,environment:'online' as never}:run);
 const reversed=manifest.runs.map((run,index)=>index===1?{...run,startedAt:run.completedAt,completedAt:run.startedAt}:run);
 expect((await verifyEvidenceManifest(root,core,{...manifest,runs:online})).verified).toBe(false);
 expect((await verifyEvidenceManifest(root,core,{...manifest,runs:reversed})).verified).toBe(false);
 expect((await verifyEvidenceManifest(root,core,{...manifest,runId:'invalid'})).blockers).toContain('evidence_run_id');
});
it('records failed evidence with stable blockers instead of losing the attempt',async()=>{
 const {root,runs}=await workspace();const failedRuns=runs.map((run,index)=>index===0?{...run,exitCode:1}:run);
 const manifest=await buildEvidenceManifest(root,core,failedRuns);
 expect(manifest).toMatchObject({verified:false,blockers:['evidence_exit:test']});
 expect(await verifyEvidenceManifest(root,core,manifest)).toEqual({verified:false,blockers:['evidence_exit:test'],executionAllowed:false});
});
