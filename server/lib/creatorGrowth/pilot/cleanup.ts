export type PilotCleanupRecord={id:string;runId:string;workspaceId:string;creatorId:string;sampleOnly:boolean;kind:"diagnostic"|"test"|"intent"|"mission"|"ledger"|"proof";state:string;createdAt:string};
/** Dry run only. No repository, client, SQL, filesystem deletion or provider effect. */
export function planPilotCleanup(input:{runId:string;now:string;retentionApproved:boolean;records:readonly PilotCleanupRecord[]}):{deleteIds:string[];holdIds:string[];reasons:string[];executionAllowed:false}{
 const deleteIds:string[]=[],holdIds:string[]=[],reasons:string[]=[],now=Date.parse(input.now),seen=new Set<string>();
 const valid=/^[a-zA-Z0-9_-]{1,128}$/.test(input.runId)&&Number.isFinite(now)&&input.retentionApproved===true;
 for(const r of input.records){
  if(r.runId!==input.runId)continue;
  const age=now-Date.parse(r.createdAt),eligible=valid&&r.id&&r.workspaceId&&r.creatorId&&!seen.has(r.id)&&r.sampleOnly===true
   &&["diagnostic","test"].includes(r.kind)&&r.state==="closed"&&Number.isFinite(age)&&age>=7*86400000;
  if(eligible)deleteIds.push(r.id);else{holdIds.push(r.id);reasons.push(`${r.id}:retention_or_authority_hold`);}seen.add(r.id);
 }
 // Conflicting duplicate IDs can never become deletion authority.
 return {deleteIds:deleteIds.filter(id=>!holdIds.includes(id)),holdIds:[...new Set(holdIds)],reasons,executionAllowed:false};
}
