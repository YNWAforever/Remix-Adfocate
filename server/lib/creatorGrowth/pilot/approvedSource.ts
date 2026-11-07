import type {ActiveMissionOwner,ActiveMissionRepository} from "../../activeMission/repo.js";
import type {PublishActor} from "../publishRepo.js";
import {bindApprovedMission,type ApprovedMissionSnapshot} from "./missionBinding.js";
import type {PilotAccount} from "./protocol.js";
type SourceWorkspace={workflow:{submissionId:string};workItems:readonly {id:string;platform:string;state:string;approvedVersionId:string|null;currentSubmittedVersionId:string|null;versions:readonly {id:string;versionNumber:number;state:string;caption:string;assets:readonly {id:string;versionId:string|null;mimeType:string;checksum:string|null;uploadState:string}[]}[]}[]};
type SourcePublication={workItemId:string;platform:string;state:string;approvedVersionId:string|null;revision:number;instructions:{requiredDisclosures:readonly string[]}};
export interface ApprovedSourceDependencies{
 // A structural subset of the original repository, not a parallel mission store.
 repo:{getWorkspace(owner:ActiveMissionOwner):Promise<SourceWorkspace>;getPublication(owner:ActiveMissionOwner,itemId:string):Promise<SourcePublication>};
 identity(owner:ActiveMissionOwner,itemId:string):Promise<{account:PilotAccount;sponsorIds:readonly string[];labelVerified:true;provenance:"fixture"}>;
 rights(owner:ActiveMissionOwner,assetId:string,versionId:string):Promise<{validated:true;shareable:true;sha256:string;provenance:"fixture"}>;
}
// Compile-time proof that the existing repository satisfies the projection port.
export const originalMissionSourceRepository=(repo:Pick<ActiveMissionRepository,"getWorkspace"|"getPublication">):ApprovedSourceDependencies["repo"]=>repo;
/** Offline adapter: all rights/identity inputs are injected trusted server reads.
 * Signed URLs, mutable drafts and private briefs are never copied into the result. */
export async function resolveApprovedPilotSource(actor:PublishActor,submissionId:string,workItemId:string,deps:ApprovedSourceDependencies):Promise<ApprovedMissionSnapshot>{
 try{
  const owner={workspaceId:actor.workspaceId,creatorId:actor.creatorId,submissionId};
  const workspace=await deps.repo.getWorkspace(owner),publication=await deps.repo.getPublication(owner,workItemId);
  const item=workspace.workItems.find(i=>i.id===workItemId),version=item?.versions.find(v=>v.id===item.approvedVersionId);
  if(workspace.workflow.submissionId!==submissionId||!item||item.platform!=="instagram"||item.state!=="approved_to_publish"||!version||version.state!=="approved_to_publish"||item.currentSubmittedVersionId!==version.id||publication.workItemId!==workItemId||publication.platform!=="instagram"||publication.state!==item.state||publication.approvedVersionId!==version.id||version.assets.length!==1)throw new Error("DENIED");
  const asset=version.assets[0];if(asset.versionId!==version.id||asset.mimeType!=="image/jpeg"||asset.uploadState!=="uploaded"||!asset.checksum)throw new Error("DENIED");
  const identity=await deps.identity(owner,workItemId),rights=await deps.rights(owner,asset.id,version.id);
  if(identity.provenance!=="fixture"||identity.labelVerified!==true||rights.provenance!=="fixture"||rights.validated!==true||rights.shareable!==true||rights.sha256!==asset.checksum)throw new Error("DENIED");
  const result:ApprovedMissionSnapshot={owner:{workspaceId:actor.workspaceId,creatorId:actor.creatorId},submissionId,workItemId,approvedVersionId:version.id,versionNumber:version.versionNumber,instructionRevision:publication.revision,state:item.state,caption:version.caption,asset:{id:asset.id,versionId:version.id,sha256:asset.checksum,mime:asset.mimeType,validated:true,rights:"shareable"},requiredDisclosures:[...publication.instructions.requiredDisclosures],sponsorIds:[...identity.sponsorIds],labelVerified:true,account:{...identity.account},sampleOnly:true};
  bindApprovedMission(actor,result);return result;
 }catch{throw new Error("PILOT_MISSION_DENIED");}
}
