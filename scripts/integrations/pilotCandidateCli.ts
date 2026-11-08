import {lstat,mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCandidateCore,verifyCandidateCore,type CandidateCore} from './pilotCandidateCore.js';
import {buildEvidenceManifest,verifyEvidenceManifest,type EvidenceManifest,type EvidenceRun} from './pilotCandidateEvidence.js';
import {buildP5GateLedger,renderGateLedger,type OfflineVerification} from './pilotGateLedger.js';

const OUTPUT_DIR='docs/review/kocmax-controlled-pilot';
const CORE_FILE=`${OUTPUT_DIR}/p5-candidate-core.json`;
const EVIDENCE_FILE=`${OUTPUT_DIR}/p5-evidence-manifest.json`;
const GATE_JSON=`${OUTPUT_DIR}/p5-gate-ledger.json`;
const GATE_MD=`${OUTPUT_DIR}/p5-gate-ledger.md`;
type Dependencies={
 buildCore:typeof buildCandidateCore;
 verifyCore:typeof verifyCandidateCore;
 buildEvidence:typeof buildEvidenceManifest;
 verifyEvidence:typeof verifyEvidenceManifest;
};
const defaults:Dependencies={buildCore:buildCandidateCore,verifyCore:verifyCandidateCore,buildEvidence:buildEvidenceManifest,verifyEvidence:verifyEvidenceManifest};
const safeRelative=(path:string)=>typeof path==='string'&&path.length>0&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes(':')&&!path.split('/').some(part=>!part||part==='.'||part==='..');
const parseJson=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const parseOptional=async<T>(path:string):Promise<T|null>=>{
 try{return await parseJson(path) as T;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return null;}
};
const writeJson=async(path:string,value:unknown)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');};
const offlineState=(corePassed:boolean|null,evidencePassed:boolean|null):OfflineVerification=>
 corePassed===false||evidencePassed===false?'BLOCKED':corePassed&&evidencePassed?'VERIFIED':'NOT_RUN';

async function assertNoLink(root:string,path:string){
 let cursor=root;
 for(const component of path.split('/')){
  cursor=join(cursor,component);
  try{if((await lstat(cursor)).isSymbolicLink())throw Error('CANDIDATE_CLI_PATH');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return;}
 }
}

export async function runPilotCandidateCli(argv:readonly string[],rootInput=process.cwd(),overrides:Partial<Dependencies>={}){
 const deps={...defaults,...overrides},root=resolve(rootInput),command=argv[0];
 const output=(path:string)=>join(root,path);
 await Promise.all([CORE_FILE,EVIDENCE_FILE,GATE_JSON,GATE_MD].map(path=>assertNoLink(root,path)));
 if(command==='write'){
  if(argv.length!==1)throw Error('CANDIDATE_CLI_ARGUMENT');
  const core=await deps.buildCore(root),file=output(CORE_FILE);
  try{
   const current=await parseJson(file) as CandidateCore;
   if(current.candidateId!==core.candidateId)throw Error('CANDIDATE_ALREADY_FROZEN');
   if(!(await deps.verifyCore(root,current)).verified)throw Error('CANDIDATE_FROZEN_RECORD_INVALID');
  }
  catch(error){if((error as Error).message==='CANDIDATE_ALREADY_FROZEN')throw error;if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await writeJson(file,core);}
  return {command,status:'written' as const,candidateId:core.candidateId,executionAllowed:false as const};
 }
 if(command==='check'){
  if(argv.length!==1)throw Error('CANDIDATE_CLI_ARGUMENT');
  const core=await parseJson(output(CORE_FILE)) as CandidateCore,coreResult=await deps.verifyCore(root,core);
  const blockers=[...coreResult.blockers];
  const evidence=await parseOptional<EvidenceManifest>(output(EVIDENCE_FILE));
  const evidenceResult=evidence?await deps.verifyEvidence(root,core,evidence):null;
  if(evidenceResult)blockers.push(...evidenceResult.blockers);
  const offlineVerification=offlineState(coreResult.verified,evidenceResult?.verified??null);
  const recorded=await parseOptional<unknown>(output(GATE_JSON));
  if(evidence&&!recorded)blockers.push('gate_ledger_missing');
  if(recorded){
   const {ledger}=buildP5GateLedger(core.candidateId,evidence?.runId??null,offlineVerification);
   if(JSON.stringify(recorded)!==JSON.stringify(ledger))blockers.push('gate_ledger_mismatch');
   try{
    if(await readFile(output(GATE_MD),'utf8')!==renderGateLedger(ledger))blockers.push('gate_markdown_mismatch');
   }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;blockers.push('gate_markdown_missing');}
  }
  return {command,status:blockers.length?'blocked' as const:'verified' as const,verified:blockers.length===0,candidateId:core.candidateId,offlineVerification,blockers,executionAllowed:false as const};
 }
 if(command==='evidence'){
  if(argv.length!==3||argv[1]!=='--input')throw Error('CANDIDATE_CLI_ARGUMENT');
  if(!safeRelative(argv[2]))throw Error('CANDIDATE_CLI_PATH');
  const inputPath=resolve(root,argv[2]),rel=relative(root,inputPath);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('CANDIDATE_CLI_PATH');
  await assertNoLink(root,argv[2]);
  const input=await parseJson(inputPath) as {runs?:EvidenceRun[]};
  if(!Array.isArray(input.runs))throw Error('CANDIDATE_CLI_EVIDENCE_INPUT');
  const core=await parseJson(output(CORE_FILE)) as CandidateCore,coreResult=await deps.verifyCore(root,core);
  if(!coreResult.verified)throw Error(`CANDIDATE_NOT_VERIFIED:${coreResult.blockers[0]??'unknown'}`);
  const evidence=await deps.buildEvidence(root,core,input.runs),file=output(EVIDENCE_FILE);
  try{
   const current=await parseJson(file) as EvidenceManifest;
   if(current.runId!==evidence.runId)throw Error('EVIDENCE_ALREADY_RECORDED');
   if(!Number.isFinite(Date.parse(current.completedAt))
      ||JSON.stringify({...current,completedAt:evidence.completedAt})!==JSON.stringify(evidence))throw Error('EVIDENCE_FROZEN_RECORD_INVALID');
  }
  catch(error){if((error as Error).message==='EVIDENCE_ALREADY_RECORDED')throw error;if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await writeJson(file,evidence);}
  return {command,status:'written' as const,candidateId:evidence.candidateId,evidenceId:evidence.runId,executionAllowed:false as const};
 }
 if(command==='gates'){
  if(argv.length!==1)throw Error('CANDIDATE_CLI_ARGUMENT');
  const core=await parseOptional<CandidateCore>(output(CORE_FILE)),evidence=await parseOptional<EvidenceManifest>(output(EVIDENCE_FILE));
  if(evidence&&evidence.candidateId!==core?.candidateId)throw Error('EVIDENCE_CANDIDATE_MISMATCH');
  const coreResult=core?await deps.verifyCore(root,core):null;
  const evidenceResult=core&&coreResult?.verified&&evidence?await deps.verifyEvidence(root,core,evidence):null;
  const offlineVerification=offlineState(coreResult?.verified??null,evidenceResult?.verified??null);
  const {ledger,blockers}=buildP5GateLedger(core?.candidateId??null,evidence?.runId??null,offlineVerification);
  await writeJson(output(GATE_JSON),ledger);await writeFile(output(GATE_MD),renderGateLedger(ledger));
  return {command,status:ledger.status,candidateId:ledger.candidateId,evidenceId:ledger.evidenceId,offlineVerification,blockers,executionAllowed:false as const};
 }
 throw Error('CANDIDATE_CLI_ARGUMENT');
}

const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)runPilotCandidateCli(process.argv.slice(2)).then(result=>{
 console.log(JSON.stringify(result));
 if(result.command==='check'&&!result.verified)process.exitCode=1;
}).catch(error=>{console.error((error as Error).message);process.exitCode=1;});
