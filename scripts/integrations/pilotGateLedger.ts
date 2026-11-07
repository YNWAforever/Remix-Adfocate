export type GateState='OFFLINE_PROVEN'|'LIVE_TEST_REQUIRED_AFTER_APPROVAL'|'OWNER_INPUT_REQUIRED'|'BLOCKED'|'NOT_RUN'|'NOT_APPLICABLE';
export type CandidateReadiness='HOLD_WITH_BLOCKERS'|'READY_FOR_OWNER_INPUT'|'READY_FOR_USER_APPROVAL';
export type OfflineVerification='VERIFIED'|'BLOCKED'|'NOT_RUN';
export type GateId='B1'|'B2'|'B3'|'B4'|'B5'|'B6'|'B7'|'B8'|'B9'|'B10';
export type GateRecord={
 id:GateId;
 title:string;
 owner:string;
 state:GateState;
 liveRequired:boolean;
 evidenceRefs:string[];
 requiredInputs:string[];
 actionScope:'A'|'B'|'C'|'D'|'none';
 invalidation:string;
 reason:string|null;
 expiresAt:string|null;
};
export type P5GateLedger={
 version:1;
 candidateId:string|null;
 evidenceId:string|null;
 offlineVerification:OfflineVerification;
 status:CandidateReadiness;
 gates:GateRecord[];
 executionAllowed:false;
};

const STATES=new Set<GateState>(['OFFLINE_PROVEN','LIVE_TEST_REQUIRED_AFTER_APPROVAL','OWNER_INPUT_REQUIRED','BLOCKED','NOT_RUN','NOT_APPLICABLE']);
const IDS:GateId[]=['B1','B2','B3','B4','B5','B6','B7','B8','B9','B10'];

export function defaultP5Gates():GateRecord[]{
 return [
  {id:'B1',title:'App, product, version and eligibility',owner:'Meta owner',state:'OWNER_INPUT_REQUIRED',liveRequired:true,evidenceRefs:['docs/review/kocmax-controlled-pilot/p5-0-configuration-change-review.md'],requiredInputs:['exact App/product/version','actual user eligibility'],actionScope:'C',invalidation:'App, product, version, scope or eligibility change',reason:'Owner evidence is incomplete.',expiresAt:null},
  {id:'B2',title:'Partnership label',owner:'Brand and reviewer',state:'NOT_APPLICABLE',liveRequired:false,evidenceRefs:['docs/superpowers/plans/2026-11-07-kocmax-p5-controlled-pilot-launch.md'],requiredInputs:[],actionScope:'D',invalidation:'Any P5.4 technical-post approval',reason:'Zero-post P5 does not publish; P5.4 remains a separate optional appendix with its own approval.',expiresAt:null},
  {id:'B3',title:'Identity, OAuth and revoke contract',owner:'Security owner',state:'LIVE_TEST_REQUIRED_AFTER_APPROVAL',liveRequired:true,evidenceRefs:['docs/review/kocmax-controlled-pilot/p5-0-configuration-change-review.md','server/lib/creatorGrowth/pilot/revoke.ts'],requiredInputs:[],actionScope:'C',invalidation:'App/product/callback/revoke contract change',reason:'Offline boundaries exist; real protocol checks are not run.',expiresAt:null},
  {id:'B4',title:'Runtime composition',owner:'Engineer',state:'LIVE_TEST_REQUIRED_AFTER_APPROVAL',liveRequired:true,evidenceRefs:['docs/review/kocmax-controlled-pilot/native-offline-wiring.md','server/pilotApp.ts'],requiredInputs:[],actionScope:'B',invalidation:'candidate or environment composition change',reason:'Hosted runtime acceptance is not run.',expiresAt:null},
  {id:'B5',title:'Schema and cleanup',owner:'Database reviewer',state:'LIVE_TEST_REQUIRED_AFTER_APPROVAL',liveRequired:true,evidenceRefs:['docs/review/kocmax-controlled-pilot/native-offline-bundle.sql','docs/review/kocmax-controlled-pilot/native-offline-rollback.sql'],requiredInputs:[],actionScope:'A',invalidation:'SQL, schema prerequisite or target change',reason:'Remote application/readback is not run.',expiresAt:null},
  {id:'B6',title:'Recovery',owner:'Database operator',state:'NOT_RUN',liveRequired:true,evidenceRefs:['docs/review/kocmax-controlled-pilot/rollback-runbook.md'],requiredInputs:[],actionScope:'A',invalidation:'target, backup or restore destination change',reason:'No current target-bound restore exists.',expiresAt:null},
  {id:'B7',title:'Real authentication and authorization',owner:'QA and security',state:'LIVE_TEST_REQUIRED_AFTER_APPROVAL',liveRequired:true,evidenceRefs:['docs/review/kocmax-controlled-pilot/persistent-acceptance.md'],requiredInputs:[],actionScope:'B',invalidation:'role policy, identity or workspace change',reason:'Real nine-role/RLS checks have not run.',expiresAt:null},
  {id:'B8',title:'Media host',owner:'Engineer and privacy owner',state:'LIVE_TEST_REQUIRED_AFTER_APPROVAL',liveRequired:true,evidenceRefs:['docs/review/kocmax-controlled-pilot/native-offline-wiring.md'],requiredInputs:[],actionScope:'C',invalidation:'media backend/origin/retention change',reason:'Actual origin and provider fetch behavior are not run.',expiresAt:null},
  {id:'B9',title:'Operations',owner:'Pilot owner',state:'OWNER_INPUT_REQUIRED',liveRequired:true,evidenceRefs:['docs/review/kocmax-controlled-pilot/p5-0-owner-intake.md'],requiredInputs:['named operators','dated window','cost ceiling','retention and cleanup owner'],actionScope:'none',invalidation:'owner roster, date, cost or retention change',reason:'Operational inputs are incomplete.',expiresAt:null},
  {id:'B10',title:'Live authorization',owner:'User',state:'OWNER_INPUT_REQUIRED',liveRequired:true,evidenceRefs:['docs/review/kocmax-controlled-pilot/real-launch-approval-package.md'],requiredInputs:['explicit action approval for A/B/C'],actionScope:'none',invalidation:'candidate, resource, scope or approval expiry change',reason:'Live action approval has not been granted.',expiresAt:null},
 ];
}

export function evaluateP5Gates(gates:readonly GateRecord[],now=Date.now()):{status:CandidateReadiness;blockers:string[];executionAllowed:false}{
 const blockers:string[]=[],seen=new Set<string>();
 if(!Array.isArray(gates))return {status:'HOLD_WITH_BLOCKERS',blockers:['gates_invalid'],executionAllowed:false};
 for(const id of IDS)if(!gates.some(gate=>gate?.id===id))blockers.push(`gate:${id}:missing`);
 for(const gate of gates){
  const id=gate?.id;
  if(!ID_IS_VALID.has(id)){blockers.push(`gate:${String(id)}:id`);continue;}
  if(seen.has(id))blockers.push(`gate:${id}:duplicate`);seen.add(id);
  if(typeof gate.title!=='string'||!gate.title||typeof gate.owner!=='string'||!gate.owner||typeof gate.invalidation!=='string'||!gate.invalidation||!Array.isArray(gate.evidenceRefs)||!Array.isArray(gate.requiredInputs)||!['A','B','C','D','none'].includes(gate.actionScope)){blockers.push(`gate:${id}:contract`);continue;}
  if(!STATES.has(gate.state)){blockers.push(`gate:${id}:state`);continue;}
  if(gate.state==='OFFLINE_PROVEN'){
   if(!gate.evidenceRefs.length)blockers.push(`gate:${id}:offline_evidence`);
   if(gate.liveRequired)blockers.push(`gate:${id}:live_requires_live_state`);
  }
  if(gate.state==='LIVE_TEST_REQUIRED_AFTER_APPROVAL'&&!gate.liveRequired)blockers.push(`gate:${id}:live_required`);
  if(gate.state==='OWNER_INPUT_REQUIRED'&&!gate.requiredInputs.length)blockers.push(`gate:${id}:owner_inputs`);
  if(gate.state==='OWNER_INPUT_REQUIRED')blockers.push(`gate:${id}:owner_input`);
  if(gate.state==='BLOCKED')blockers.push(`gate:${id}:blocked`);
  if(gate.state==='NOT_RUN')blockers.push(`gate:${id}:not_run`);
  if(gate.state==='NOT_APPLICABLE'&&(!gate.reason||!gate.reason.trim()))blockers.push(`gate:${id}:not_applicable_reason`);
  if((gate.state==='BLOCKED'||gate.state==='NOT_RUN')&&(!gate.reason||!gate.reason.trim()))blockers.push(`gate:${id}:reason`);
  if(gate.expiresAt!==null){const expires=Date.parse(gate.expiresAt);if(!Number.isFinite(expires)||expires<=now)blockers.push(`gate:${id}:expired`);}
 }
 const hardBlocked=gates.some(gate=>gate?.state==='BLOCKED'||gate?.state==='NOT_RUN');
 const hardBlockers=blockers.filter(blocker=>!blocker.endsWith(':owner_input'));
 const ownerBlocked=gates.some(gate=>gate?.state==='OWNER_INPUT_REQUIRED');
 const status=hardBlockers.length||hardBlocked?'HOLD_WITH_BLOCKERS':ownerBlocked?'READY_FOR_OWNER_INPUT':'READY_FOR_USER_APPROVAL';
 return {status,blockers:[...new Set(blockers)],executionAllowed:false};
}

const ID_IS_VALID=new Set<string>(IDS);

export function buildP5GateLedger(candidateId:string|null,evidenceId:string|null,offlineVerification:OfflineVerification){
 const gates=defaultP5Gates(),readiness=evaluateP5Gates(gates);
 const ledger:P5GateLedger={
  version:1,candidateId,evidenceId,offlineVerification,
  status:offlineVerification==='VERIFIED'?readiness.status:'HOLD_WITH_BLOCKERS',
  gates,executionAllowed:false,
 };
 const blockers=offlineVerification==='VERIFIED'?readiness.blockers:[`offline_evidence:${offlineVerification.toLowerCase()}`,...readiness.blockers];
 return {ledger,blockers};
}

export function renderGateLedger(ledger:P5GateLedger):string{
 const rows=[...ledger.gates].sort((first,second)=>IDS.indexOf(first.id)-IDS.indexOf(second.id)).map(gate=>`| ${gate.id} | ${gate.title} | ${gate.state} | ${gate.owner} | ${gate.actionScope} | ${gate.reason??''} |`);
 return [
  '# P5 candidate gate ledger','',
  `Status: **${ledger.status}**`,'',
  `Candidate: ${ledger.candidateId??'NOT_FROZEN'}`,'',
  `Evidence: ${ledger.evidenceId??'NOT_RECORDED'}`,'',
  `Offline verification: **${ledger.offlineVerification}**`,'',
  `Execution allowed: **${ledger.executionAllowed}**`,'',
  '| Gate | Requirement | State | Owner | Approval | Blocker |','| --- | --- | --- | --- | --- | --- |',...rows,'',
 ].join('\n');
}
