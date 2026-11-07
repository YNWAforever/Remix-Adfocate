/** MISSION_PUBLISH_ENTRY_MOCK_ONLY — imported only in opt-in DEV. */
import type {ActiveMissionWorkspace, MissionWorkItemView, MissionPublicationView} from "../lib/activeMission";
import type {MissionPublishContext} from "../lib/creatorGrowth/missionPublishContext";
import {prepareSyntheticJpeg} from "../lib/creatorGrowth/jpegPreparation";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const missionPublishIds={owner:id(11),submission:id(931),item:id(941),version:id(951)};
let prepared:ReturnType<typeof prepareSyntheticJpeg>|null=null;
export function missionMockImage(){return prepared??=prepareSyntheticJpeg();}
export async function missionPublishFixture(base:ActiveMissionWorkspace){
 const image=await missionMockImage(),workspace=structuredClone(base),now="2026-11-06T00:00:00Z";
 const caption="一杯茶的真實體驗，今天分享日常的小片刻。 #合作（合成示例）";
 const item:MissionWorkItemView={id:missionPublishIds.item,title:"核准單圖作品（發佈演練）",platform:"instagram",requirements:[],required:true,position:1,deadline:"2026-12-15T08:00:00Z",state:"approved_to_publish",draft:null,currentSubmittedVersionId:missionPublishIds.version,approvedVersionId:missionPublishIds.version,reviewStartedAt:null,reviewDueAt:null,versions:[{id:missionPublishIds.version,versionNumber:3,caption,externalUrl:null,checklist:{},contentChecksum:image.sha256,submittedAt:now,state:"approved_to_publish",decisionAt:now,assets:[{id:id(961),versionId:missionPublishIds.version,originalFilename:"MISSION_PUBLISH_ENTRY_MOCK_ONLY.jpg",mimeType:"image/jpeg",sizeBytes:image.byteSize,checksum:image.sha256,uploadState:"ready",signedUrl:null}]}]};
 workspace.workflow={...workspace.workflow,id:missionPublishIds.submission,submissionId:missionPublishIds.submission,state:"approved_to_publish",revision:1};
 workspace.mission={...workspace.mission,id:id(921),title:"茶日和 · 核准作品發佈練習"};workspace.workItems=[item];workspace.events=[];workspace.pendingReward=null;
 workspace.completionEligibility={eligible:false,blockers:["required_proof_incomplete"],requiredItemCount:1,verifiedRequiredItemCount:0};
 workspace.nextAction={kind:"publish",workItemId:item.id,deadline:item.deadline,blockedReason:null};
 const publication:MissionPublicationView={workItemId:item.id,platform:"instagram",state:"approved_to_publish",revision:1,approvedVersionId:missionPublishIds.version,instructions:{publicationInstructions:"使用核准圖片與文案。此頁只演練，不會發佈真實作品。",requiredDisclosures:["#合作"],expectedAccount:"@kocmax_demo_only",proofEvidencePolicy:{},publishDueAt:item.deadline!,frozenAt:now},attempts:[],currentAttempt:null,acceptedAttempt:null};
 return {workspace,publication};
}
export function readMissionMockContext(ownerKey:string,submissionId:string,item:MissionWorkItemView|null,publication:MissionPublicationView|null):MissionPublishContext|null {
 if(ownerKey!==missionPublishIds.owner||submissionId!==missionPublishIds.submission||item?.id!==missionPublishIds.item||publication?.workItemId!==missionPublishIds.item)return null;
 return {ownerKey,submissionId,item,publication,rights:{sampleOnly:true,ownerKey,accountSubject:"123456789",username:"kocmax_demo_only",grantGeneration:1,grant:"valid",sources:"shareable",platformLabel:"supported",brandTag:"not_required"}};
}
