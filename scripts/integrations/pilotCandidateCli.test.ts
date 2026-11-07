// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {runPilotCandidateCli} from './pilotCandidateCli.js';
import type {CandidateCore} from './pilotCandidateCore.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const core:CandidateCore={version:1,candidateId:'a'.repeat(64),generatedAt:'2026-11-07T00:00:00.000Z',branch:'main',head:'b'.repeat(40),dirtyWorktree:true,files:[],configContract:[],executionAllowed:false};
async function root(){const path=resolve('.superpowers',`pilot-cli-${randomUUID()}`);roots.push(path);await mkdir(path,{recursive:true});return path;}
it('writes and verifies the frozen candidate without shell execution',async()=>{
 const path=await root();const buildCore=vi.fn(async()=>core),verifyCore=vi.fn(async()=>({verified:true,blockers:[],executionAllowed:false as const}));
 await expect(runPilotCandidateCli(['write'],path,{buildCore,verifyCore})).resolves.toMatchObject({command:'write',candidateId:core.candidateId});
 const saved=JSON.parse(await readFile(join(path,'docs/review/kocmax-controlled-pilot/p5-candidate-core.json'),'utf8'));
 expect(saved.candidateId).toBe(core.candidateId);
 await expect(runPilotCandidateCli(['check'],path,{buildCore,verifyCore})).resolves.toMatchObject({command:'check',verified:true});
 expect(verifyCore).toHaveBeenCalledTimes(1);
});
it('refuses to overwrite a different frozen candidate',async()=>{
 const path=await root();await runPilotCandidateCli(['write'],path,{buildCore:async()=>core});
 await expect(runPilotCandidateCli(['write'],path,{buildCore:async()=>({...core,candidateId:'c'.repeat(64)})})).rejects.toThrow('CANDIDATE_ALREADY_FROZEN');
});
it('refuses an invalid existing core even when its identifier matches',async()=>{
 const path=await root(),buildCore=async()=>core;
 await runPilotCandidateCli(['write'],path,{buildCore});
 const verifyCore=async()=>({verified:false,blockers:['candidate_file_changed'],executionAllowed:false as const});
 await expect(runPilotCandidateCli(['write'],path,{buildCore,verifyCore})).rejects.toThrow('CANDIDATE_FROZEN_RECORD_INVALID');
});
it('binds evidence to the verified core and writes append-only manifests',async()=>{
 const path=await root();await runPilotCandidateCli(['write'],path,{buildCore:async()=>core});
 const input={runs:[{candidateId:core.candidateId,completedCandidateId:core.candidateId,kind:'test',command:'offline',environment:'offline',startedAt:'2026-11-07T00:00:00Z',completedAt:'2026-11-07T00:00:01Z',exitCode:0,logPath:'logs/test.log',logSha256:hash('pass\n')}]};
 await mkdir(join(path,'logs'));await writeFile(join(path,'logs/test.log'),'pass\n');
 const evidence={version:1,runId:hash('evidence'),candidateId:core.candidateId,completedAt:'2026-11-07T00:00:02Z',runs:input.runs,executionAllowed:false};
 const buildEvidence=vi.fn(async()=>evidence as never);
 await writeFile(join(path,'evidence.json'),JSON.stringify(input));
 await expect(runPilotCandidateCli(['evidence','--input','evidence.json'],path,{
  buildCore:async()=>core,verifyCore:async()=>({verified:true,blockers:[],executionAllowed:false as const}),buildEvidence,
 })).resolves.toMatchObject({command:'evidence',candidateId:core.candidateId});
 await expect(runPilotCandidateCli(['evidence','--input','evidence.json'],path,{buildCore:async()=>core,verifyCore:async()=>({verified:true,blockers:[],executionAllowed:false as const}),buildEvidence})).resolves.toMatchObject({evidenceId:evidence.runId});
 const changed=vi.fn(async()=>({...evidence,runId:hash('changed')} as never));
 await expect(runPilotCandidateCli(['evidence','--input','evidence.json'],path,{buildCore:async()=>core,verifyCore:async()=>({verified:true,blockers:[],executionAllowed:false as const}),buildEvidence:changed})).rejects.toThrow('EVIDENCE_ALREADY_RECORDED');
 const output=join(path,'docs/review/kocmax-controlled-pilot/p5-evidence-manifest.json');
 await writeFile(output,JSON.stringify({...evidence,verified:false}));
 await expect(runPilotCandidateCli(['evidence','--input','evidence.json'],path,{buildCore:async()=>core,verifyCore:async()=>({verified:true,blockers:[],executionAllowed:false as const}),buildEvidence})).rejects.toThrow('EVIDENCE_FROZEN_RECORD_INVALID');
});
it('renders gates and rejects unknown arguments or unsafe evidence paths',async()=>{
 const path=await root();await runPilotCandidateCli(['gates'],path);
 const markdown=await readFile(join(path,'docs/review/kocmax-controlled-pilot/p5-gate-ledger.md'),'utf8');
 expect(markdown).toContain('HOLD_WITH_BLOCKERS');expect(markdown).toContain('Execution allowed: **false**');
 expect(markdown).toContain('Offline verification: **NOT_RUN**');
 await expect(runPilotCandidateCli(['unknown'],path)).rejects.toThrow('CANDIDATE_CLI_ARGUMENT');
 await expect(runPilotCandidateCli(['evidence','--input','../escape.json'],path)).rejects.toThrow('CANDIDATE_CLI_PATH');
});
it('detects a tampered or internally inconsistent gate ledger',async()=>{
 const path=await root(),verifyCore=async()=>({verified:true,blockers:[],executionAllowed:false as const});
 await runPilotCandidateCli(['write'],path,{buildCore:async()=>core});await runPilotCandidateCli(['gates'],path,{verifyCore});
 await expect(runPilotCandidateCli(['check'],path,{verifyCore})).resolves.toMatchObject({verified:true,offlineVerification:'NOT_RUN'});
 const gatePath=join(path,'docs/review/kocmax-controlled-pilot/p5-gate-ledger.json'),gate=JSON.parse(await readFile(gatePath,'utf8'));
 gate.gates[0].state='OFFLINE_PROVEN';gate.gates[0].liveRequired=false;
 await writeFile(gatePath,JSON.stringify(gate));
 const result=await runPilotCandidateCli(['check'],path,{verifyCore});
 expect(result.verified).toBe(false);expect(result.blockers).toContain('gate_ledger_mismatch');
});
it('derives the offline status from verified logs without clearing live holds',async()=>{
 const path=await root();
 const verifyCore=async()=>({verified:true,blockers:[],executionAllowed:false as const});
 await runPilotCandidateCli(['write'],path,{buildCore:async()=>core});
 await writeFile(join(path,'docs/review/kocmax-controlled-pilot/p5-evidence-manifest.json'),JSON.stringify({
  candidateId:core.candidateId,runId:'c'.repeat(64),verified:true,
 }));
 const verifyEvidence=vi.fn().mockResolvedValueOnce({verified:false,blockers:['evidence_log_hash:browser'],executionAllowed:false})
  .mockResolvedValueOnce({verified:true,blockers:[],executionAllowed:false});
 const blocked=await runPilotCandidateCli(['gates'],path,{verifyCore,verifyEvidence});
 expect(blocked).toMatchObject({status:'HOLD_WITH_BLOCKERS',offlineVerification:'BLOCKED',executionAllowed:false});
 const verified=await runPilotCandidateCli(['gates'],path,{verifyCore,verifyEvidence});
 expect(verified).toMatchObject({status:'HOLD_WITH_BLOCKERS',offlineVerification:'VERIFIED',executionAllowed:false});
 expect(verified.blockers).toContain('gate:B6:not_run');
});
