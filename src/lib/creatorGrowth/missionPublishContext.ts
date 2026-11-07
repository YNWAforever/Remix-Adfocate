import type { MissionWorkItemView, MissionPublicationView } from "../activeMission";
export type MissionMockRights = {
  sampleOnly: true; ownerKey: string; accountSubject: string; username: string; grantGeneration: number;
  grant: "valid"|"missing"|"revoked"; sources: "shareable"|"private"|"revoked"|"unknown";
  platformLabel: "supported"|"unsupported"|"unverified"; brandTag: "supported"|"unsupported"|"unverified"|"not_required";
};
export type MissionPublishContext = {ownerKey:string;submissionId:string;item:MissionWorkItemView;publication:MissionPublicationView;rights:MissionMockRights};
export type MissionPublishEligibility = {eligible:false;reason:"approval"|"asset"|"account"|"rights"|"disclosure"} | {
  eligible:true;signature:string;approvedVersionId:string;caption:string;assetId:string;imageSha256:string;accountSubject:string;
};
export function inspectMissionPublish(c:MissionPublishContext):MissionPublishEligibility {
  const {item,publication:p,rights:r}=c;
  const versions=item.versions?.filter(v=>v.id===item.approvedVersionId)??[], v=versions[0];
  if(!c.ownerKey||!c.submissionId||item.state!=="approved_to_publish"||p.state!=="approved_to_publish"||item.platform!=="instagram"||p.platform!=="instagram"||p.workItemId!==item.id||!item.approvedVersionId||p.approvedVersionId!==item.approvedVersionId||versions.length!==1||v.state!=="approved_to_publish"||!v.contentChecksum||!v.caption.trim()||v.caption.length>2200)return {eligible:false,reason:"approval"};
  const a=v.assets[0];
  if(v.assets.length!==1||!a||a.versionId!==v.id||a.mimeType!=="image/jpeg"||a.uploadState!=="ready"||!a.checksum||!/^[a-f0-9]{64}$/.test(a.checksum)||a.sizeBytes<=0)return {eligible:false,reason:"asset"};
  if(r.sampleOnly!==true||r.ownerKey!==c.ownerKey||r.sources!=="shareable")return {eligible:false,reason:"rights"};
  if(r.grant!=="valid"||!r.accountSubject||!r.username||r.grantGeneration<1||p.instructions.expectedAccount?.replace(/^@/,"")!==r.username)return {eligible:false,reason:"account"};
  if(r.platformLabel!=="supported"||!["supported","not_required"].includes(r.brandTag)||!p.instructions.frozenAt||p.instructions.requiredDisclosures.some(d=>!d.trim()||!v.caption.includes(d)))return {eligible:false,reason:"disclosure"};
  const signature=JSON.stringify([c.ownerKey,c.submissionId,item.id,v.id,v.caption,v.contentChecksum,a.id,a.checksum,p.revision,p.instructions,r]);
  return {eligible:true,signature,approvedVersionId:v.id,caption:v.caption,assetId:a.id,imageSha256:a.checksum,accountSubject:r.accountSubject};
}

