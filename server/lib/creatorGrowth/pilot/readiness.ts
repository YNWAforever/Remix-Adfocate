/** Review metadata, never execution authorization. */
export const PILOT_GATE_IDS = Object.freeze(["protocol","identity","disclosure","revoke","persistence","privacy","journeys","environment","launch_approval"] as const);
export type PilotGateId = typeof PILOT_GATE_IDS[number];
export type PilotGate = {id:PilotGateId;status:"PASS"|"BLOCKED"|"NOT_RUN";evidenceRef:string|null;verifiedAt:string|null};
const offline:readonly PilotGateId[]=["persistence","privacy","journeys"];
function evidence(row:PilotGate):boolean{
 if(typeof row.evidenceRef!=="string"||!/^review\/[a-zA-Z0-9_./-]+\.md$/.test(row.evidenceRef)||row.evidenceRef.includes(".."))return false;
 if(typeof row.verifiedAt!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.verifiedAt))return false;
 const ms=Date.parse(row.verifiedAt);
 return Number.isFinite(ms)&&new Date(ms).toISOString()===row.verifiedAt;
}
export function evaluatePilotReadiness(rows:readonly PilotGate[]):{offlineReady:boolean;liveReady:boolean;blockers:PilotGateId[];executionAllowed:false}{
 const closed=()=>({offlineReady:false,liveReady:false,blockers:[...PILOT_GATE_IDS],executionAllowed:false as const});
 if(!Array.isArray(rows)||rows.length>PILOT_GATE_IDS.length)return closed();
 const found=new Map<PilotGateId,PilotGate>();
 for(const row of rows){
  if(!row||typeof row!=="object"||!PILOT_GATE_IDS.includes(row.id)||found.has(row.id)||!["PASS","BLOCKED","NOT_RUN"].includes(row.status))return closed();
  found.set(row.id,row);
 }
 const blockers=PILOT_GATE_IDS.filter(id=>{const r=found.get(id);return !r||r.status!=="PASS"||!evidence(r);});
 return {offlineReady:offline.every(id=>!blockers.includes(id)),liveReady:blockers.length===0,blockers,executionAllowed:false};
}
