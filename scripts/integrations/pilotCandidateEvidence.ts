import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve} from 'node:path';
import type {CandidateCore} from './pilotCandidateCore.js';

export type EvidenceKind='test'|'build'|'lint'|'typecheck'|'browser'|'inventory';
export type EvidenceEnvironment='offline'|'local-browser'|'pglite';
export type EvidenceRun={
 candidateId:string;
 completedCandidateId:string;
 kind:EvidenceKind;
 command:string;
 environment:EvidenceEnvironment;
 startedAt:string;
 completedAt:string;
 exitCode:number;
 logPath:string;
 logSha256:string;
};
export type EvidenceManifest={
 version:1;
 runId:string;
 candidateId:string;
 completedAt:string;
 runs:EvidenceRun[];
  verified:boolean;
  blockers:string[];
 executionAllowed:false;
};

const KINDS=new Set<EvidenceKind>(['test','build','lint','typecheck','browser','inventory']);
const ENVIRONMENTS=new Set<EvidenceEnvironment>(['offline','local-browser','pglite']);
const REQUIRED:EvidenceKind[]=['test','build','lint','typecheck','browser','inventory'];
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const safePath=(path:string)=>typeof path==='string'&&path.length>0&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes(':')&&!path.split('/').some(part=>!part||part==='.'||part==='..');
const sortable=(run:unknown):run is EvidenceRun=>Boolean(run&&typeof run==='object'
 && ['kind','completedAt','logPath'].every(key=>typeof (run as Record<string,unknown>)[key]==='string'));
const sortedRuns=(runs:readonly EvidenceRun[])=>[...runs].sort((first,second)=>first.kind.localeCompare(second.kind)||first.completedAt.localeCompare(second.completedAt)||first.logPath.localeCompare(second.logPath));
const runId=(candidateId:string,runs:readonly EvidenceRun[])=>digest(JSON.stringify([candidateId,sortedRuns(runs)]));

async function validateLog(root:string,core:CandidateCore,run:EvidenceRun,index:number):Promise<string[]>{
 const blockers:string[]=[];
 if(!sortable(run))return [`evidence_run:${index}`];
 if(run.candidateId!==core.candidateId||run.completedCandidateId!==core.candidateId)blockers.push(`evidence_run_candidate:${index}`);
 if(!KINDS.has(run.kind))blockers.push(`evidence_kind:${index}`);
 if(typeof run.command!=='string'||!run.command.trim()||run.command.length>1000)blockers.push(`evidence_command:${index}`);
 if(!ENVIRONMENTS.has(run.environment))blockers.push(`evidence_environment:${index}`);
 if(!Number.isSafeInteger(run.exitCode)||run.exitCode!==0)blockers.push(`evidence_exit:${run.kind||index}`);
 const started=typeof run.startedAt==='string'?Date.parse(run.startedAt):NaN,completed=Date.parse(run.completedAt);
 if(!Number.isFinite(started)||!Number.isFinite(completed)||started>completed)blockers.push(`evidence_time:${run.kind||index}`);
 if(started<Date.parse(core.generatedAt))blockers.push(`evidence_run_before_freeze:${index}`);
 if(!safePath(run.logPath)||!/^[a-f0-9]{64}$/.test(run.logSha256)){blockers.push(`evidence_log_path:${run.kind||index}`);return blockers;}
 try{
  const absolute=resolve(root,run.logPath),rel=relative(root,absolute);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||rel.replaceAll('\\','/')!==run.logPath)throw Error();
  let cursor=root;
  for(const component of run.logPath.split('/')){
   cursor=resolve(cursor,component);
   if((await lstat(cursor)).isSymbolicLink())throw Error();
  }
  const stat=await lstat(absolute);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw Error();
  const bytes=await readFile(absolute);
  if(createHash('sha256').update(bytes).digest('hex')!==run.logSha256)blockers.push(`evidence_log_hash:${run.kind||index}`);
 }catch{blockers.push(`evidence_log_path:${run.kind||index}`);}
 return blockers;
}

export async function buildEvidenceManifest(rootInput:string,core:CandidateCore,runs:readonly EvidenceRun[]):Promise<EvidenceManifest>{
 const root=await realpath(rootInput);
 if(!core||core.executionAllowed!==false||!Array.isArray(core.files)||!/^[a-f0-9]{64}$/.test(core.candidateId)||!/^[a-f0-9]{40}$/.test(core.head)||!Number.isFinite(Date.parse(core.generatedAt)))throw Error('EVIDENCE_CORE_INVALID');
 const blockers=(await Promise.all(runs.map((run,index)=>validateLog(root,core,run,index)))).flat();
 const unsafe=blockers.find(blocker=>/^evidence_(?:log_path:|run:|run_candidate:|run_before_freeze:)/.test(blocker));
 if(unsafe)throw Error(`EVIDENCE_INPUT_INVALID:${unsafe}`);
 const kinds=new Set(runs.map(run=>run.kind));
 for(const kind of REQUIRED)if(!kinds.has(kind))blockers.push(`evidence_required_${kind}`);
 const canonical=sortedRuns(runs);
 return {version:1,runId:runId(core.candidateId,canonical),candidateId:core.candidateId,completedAt:new Date().toISOString(),runs:structuredClone(canonical),verified:blockers.length===0,blockers:[...new Set(blockers)].sort(),executionAllowed:false};
}

export async function verifyEvidenceManifest(rootInput:string,core:CandidateCore,manifest:unknown):Promise<{verified:boolean;blockers:string[];executionAllowed:false}>{
 const blockers:string[]=[];
 const record=manifest&&typeof manifest==='object'&&!Array.isArray(manifest)?manifest as Partial<EvidenceManifest>:null;
 if(!record||record.version!==1||record.executionAllowed!==false||typeof record.verified!=='boolean'||!Array.isArray(record.blockers)||!Array.isArray(record.runs))return {verified:false,blockers:['evidence_contract'],executionAllowed:false};
 if(record.candidateId!==core.candidateId)blockers.push('evidence_candidate_mismatch');
 const root=await realpath(rootInput);
 blockers.push(...(await Promise.all(record.runs.map((run,index)=>validateLog(root,core,run,index)))).flat());
 const kinds=new Set(record.runs.map(run=>run?.kind));
 for(const kind of REQUIRED)if(!kinds.has(kind))blockers.push(`evidence_required_${kind}`);
 if(!record.runs.every(sortable)||record.runId!==runId(core.candidateId,record.runs))blockers.push('evidence_run_id');
 if(record.verified!==(blockers.length===0))blockers.push('evidence_status');
 const expectedBlockers=[...new Set(blockers)].sort();
 if(JSON.stringify(record.blockers)!==JSON.stringify(expectedBlockers))blockers.push('evidence_blockers');
 return {verified:blockers.length===0,blockers:[...new Set(blockers)].sort(),executionAllowed:false};
}
