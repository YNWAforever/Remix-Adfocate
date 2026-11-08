import {evaluatePilotReadiness,type PilotGate} from "./readiness.js";
export type PilotRosterEntry={runId:string;creatorId:string;missionId:string;wave:"first"|"later";status:"invited"|"ready"|"active"|"completed"|"withdrawn"|"blocked"};
const name=(v:unknown)=>typeof v==="string"&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function validatePilotRoster(entries:readonly PilotRosterEntry[]):boolean{
 return Array.isArray(entries)&&entries.length>0&&entries.length<=5&&entries.filter(e=>e.wave==="first").length===1
  &&new Set(entries.map(e=>e.creatorId)).size===entries.length&&new Set(entries.map(e=>e.runId)).size===1
  &&entries.every(e=>[e.runId,e.creatorId,e.missionId].every(name)&&["first","later"].includes(e.wave)&&["invited","ready","active","completed","withdrawn","blocked"].includes(e.status));
}
/** Admission metadata; never an execution capability or a general feature lock. */
export function canStartPilot(entry:PilotRosterEntry,gates:readonly PilotGate[],firstCreatorVerified:boolean):boolean{
 return [entry.runId,entry.creatorId,entry.missionId].every(name)&&entry.status==="ready"&&["first","later"].includes(entry.wave)
  &&(entry.wave==="first"||firstCreatorVerified===true)&&evaluatePilotReadiness(gates).liveReady;
}
