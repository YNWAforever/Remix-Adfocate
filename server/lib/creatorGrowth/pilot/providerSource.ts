import type {ApprovedSourceDependencies} from './approvedSource.js';
import type {PublishActor} from '../publishRepo.js';
import type {ActiveMissionOwner} from '../../activeMission/repo.js';
import type {PilotAccount} from './protocol.js';
import type {LivePilotSource} from './liveComposition.js';
import {bindProviderMission} from './missionBinding.js';
export interface ProviderSourceDependencies{
 repo:ApprovedSourceDependencies['repo'];now:()=>Date;
 identity(owner:ActiveMissionOwner,itemId:string):Promise<{account:PilotAccount;sponsorIds:readonly string[];labelVerified:boolean;provenance:'provider';expiresAt:string}>;
 rights(owner:ActiveMissionOwner,assetId:string,versionId:string):Promise<{validated:boolean;shareable:boolean;sha256:string;provenance:'provider';expiresAt:string}>;
}
/** Original repository projection; provider attestation is a separate server port.
 * No fixture coercion, browser identity, signed URL or private brief enters this result. */
export async function resolveProviderMissionSource(actor:PublishActor,submissionId:string,workItemId:string,deps:ProviderSourceDependencies):Promise<LivePilotSource>{
 try{
  const owner={workspaceId:actor.workspaceId,creatorId:actor.creatorId,submissionId};
  const workspace=await deps.repo.getWorkspace(owner),publication=await deps.repo.getPublication(owner,workItemId);
  const item=workspace.workItems.find(i=>i.id===workItemId),version=item?.versions.find(v=>v.id===item.approvedVersionId);
  if(workspace.workflow.submissionId!==submissionId||!item||item.platform!=='instagram'||item.state!=='approved_to_publish'||!version||version.state!==item.state||item.currentSubmittedVersionId!==version.id||publication.workItemId!==workItemId||publication.platform!=='instagram'||publication.state!==item.state||publication.approvedVersionId!==version.id||version.assets.length!==1)throw new Error();
  const asset=version.assets[0];if(asset.versionId!==version.id||asset.mimeType!=='image/jpeg'||asset.uploadState!=='uploaded'||!asset.checksum)throw new Error();
  const identity=await deps.identity(owner,workItemId),rights=await deps.rights(owner,asset.id,version.id);
  const expires=Math.min(Date.parse(identity.expiresAt),Date.parse(rights.expiresAt)),now=deps.now().getTime();
  if(!Number.isFinite(expires)||!Number.isFinite(now)||expires<=now||identity.provenance!=='provider'||!identity.labelVerified||rights.provenance!=='provider'||!rights.validated||!rights.shareable||rights.sha256!==asset.checksum)throw new Error();
  const result:LivePilotSource={owner:{workspaceId:actor.workspaceId,creatorId:actor.creatorId},submissionId,workItemId,approvedVersionId:version.id,versionNumber:version.versionNumber,instructionRevision:publication.revision,state:item.state,caption:version.caption,asset:{id:asset.id,versionId:version.id,sha256:asset.checksum,mime:asset.mimeType,validated:true,rights:'shareable'},requiredDisclosures:[...publication.instructions.requiredDisclosures],sponsorIds:[...identity.sponsorIds],labelVerified:true,account:{...identity.account},sampleOnly:false,provenance:'provider',expiresAt:new Date(expires).toISOString()};
  bindProviderMission(actor,result);return result;
 }catch{throw new Error('PILOT_SOURCE_DENIED');}
}
