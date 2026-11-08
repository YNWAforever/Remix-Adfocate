import {createHash} from "node:crypto";
import type {PublishActor,PublishBinding,PublishOwner} from "../publishRepo.js";
import {assertPilotAccount,providerId,type PilotAccount} from "./protocol.js";
export type ApprovedMissionSnapshot=Readonly<{
 owner:PublishOwner;submissionId:string;workItemId:string;approvedVersionId:string;versionNumber:number;instructionRevision:number;
 state:string;caption:string;asset:{id:string;versionId:string;sha256:string;mime:string;validated:boolean;rights:string};
 requiredDisclosures:readonly string[];sponsorIds:readonly string[];labelVerified:boolean;account:PilotAccount;sampleOnly:true;
}>;
const uuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
/** Trusted original-mission projection, never accepted as a browser command.
 * The explicit discriminator means draftId denotes the immutable approved version,
 * not a private growth draft. No legacy source is silently promoted. */
export function bindApprovedMission(actor:PublishActor,s:ApprovedMissionSnapshot):PublishBinding {
 return bindMission(actor,s,"active_mission_fixture");
}
export function bindProviderMission(actor:PublishActor,s:Omit<ApprovedMissionSnapshot,"sampleOnly">&{sampleOnly:false;provenance:"provider"}):PublishBinding {
 if(s.provenance!=="provider")throw new Error("PILOT_MISSION_DENIED");
 return bindMission(actor,s,"active_mission_provider");
}
function bindMission(actor:PublishActor,s:Omit<ApprovedMissionSnapshot,"sampleOnly">&{sampleOnly:boolean},kind:NonNullable<PublishBinding["missionBasis"]>["kind"]):PublishBinding {
 assertPilotAccount(s.account);
 if(!/^[a-f0-9]{64}$/.test(actor.sessionHash)||s.sampleOnly!==(kind==="active_mission_fixture")||s.owner.workspaceId!==actor.workspaceId||s.owner.creatorId!==actor.creatorId
  ||![actor.workspaceId,actor.creatorId,s.submissionId,s.workItemId,s.approvedVersionId,s.asset.id].every(uuid)
  ||s.state!=="approved_to_publish"||!Number.isSafeInteger(s.versionNumber)||s.versionNumber<1||!Number.isSafeInteger(s.instructionRevision)||s.instructionRevision<0
  ||s.asset.versionId!==s.approvedVersionId||s.asset.mime!=="image/jpeg"||!s.asset.validated||s.asset.rights!=="shareable"||!/^[a-f0-9]{64}$/.test(s.asset.sha256)
  ||!s.caption.trim()||[...s.caption].length>2200||!s.labelVerified||!s.requiredDisclosures.length||s.requiredDisclosures.some(d=>!d.trim()||!s.caption.includes(d))
  ||!s.sponsorIds.length||s.sponsorIds.length>2||new Set(s.sponsorIds).size!==s.sponsorIds.length||s.sponsorIds.some(id=>!providerId(id)||id===s.account.accountSubject))throw new Error("PILOT_MISSION_DENIED");
 const missionBasis={kind,product:s.account.product,appId:s.account.appId,submissionId:s.submissionId,workItemId:s.workItemId,approvedVersionId:s.approvedVersionId,instructionRevision:s.instructionRevision,disclosureSha256:sha(JSON.stringify([s.requiredDisclosures,s.sponsorIds]))};
 const body={draftId:s.approvedVersionId,draftRevision:s.versionNumber,assetId:s.asset.id,imageSha256:s.asset.sha256,captionSha256:sha(s.caption),connectionId:s.account.connectionId,accountSubject:s.account.accountSubject,grantGeneration:s.account.grantGeneration,missionBasis};
 return {...body,fingerprint:sha(JSON.stringify([{workspaceId:s.owner.workspaceId,creatorId:s.owner.creatorId},body]))};
}
