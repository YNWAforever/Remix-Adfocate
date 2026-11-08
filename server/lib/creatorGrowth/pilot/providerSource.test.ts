// @vitest-environment node
import {expect,it} from 'vitest';
import {resolveProviderMissionSource,type ProviderSourceDependencies} from './providerSource.js';
import {createMockMissionPilot} from './missionService.js';
const s=createMockMissionPilot().snapshot(),actor={...s.owner,sessionHash:'a'.repeat(64)};
function fixture(){
 const item={id:s.workItemId,platform:'instagram',state:s.state,approvedVersionId:s.approvedVersionId,currentSubmittedVersionId:s.approvedVersionId,versions:[{id:s.approvedVersionId,versionNumber:s.versionNumber,state:s.state,caption:s.caption,assets:[{id:s.asset.id,versionId:s.approvedVersionId,mimeType:'image/jpeg',checksum:s.asset.sha256,uploadState:'uploaded'}]}]};
 const identity={account:s.account,sponsorIds:s.sponsorIds,labelVerified:true,provenance:'provider' as const,expiresAt:'2026-11-07T00:00:00Z'};
 const rights={validated:true,shareable:true,sha256:s.asset.sha256,provenance:'provider' as const,expiresAt:'2026-11-06T01:00:00Z'};
 const deps:ProviderSourceDependencies={now:()=>new Date('2026-11-06T00:00:00Z'),repo:{getWorkspace:async()=>({workflow:{submissionId:s.submissionId},workItems:[item]}),getPublication:async()=>({workItemId:s.workItemId,platform:'instagram',state:s.state,approvedVersionId:s.approvedVersionId,revision:s.instructionRevision,instructions:{requiredDisclosures:s.requiredDisclosures}})},identity:async()=>identity,rights:async()=>rights};
 return {deps,item,identity,rights};
}
it('projects only the original approved version with independent provider attestations and shortest expiry',async()=>{
 const f=fixture(),out=await resolveProviderMissionSource(actor,s.submissionId,s.workItemId,f.deps);
 expect(out.sampleOnly).toBe(false);expect(out.provenance).toBe('provider');expect(out.expiresAt).toBe('2026-11-06T01:00:00.000Z');expect(out.asset.id).toBe(s.asset.id);expect(out).not.toHaveProperty('privateBrief');
});
it.each(['fixture','expired','private','version','hash','clock'])('denies %s without promoting fixture evidence',async mode=>{
 const f=fixture();if(mode==='fixture')f.identity.provenance='fixture' as never;if(mode==='expired')f.rights.expiresAt='2020-01-01';if(mode==='private')f.rights.shareable=false;if(mode==='version')f.item.currentSubmittedVersionId='other';if(mode==='hash')f.rights.sha256='0'.repeat(64);if(mode==='clock')f.deps.now=()=>new Date(NaN);
 await expect(resolveProviderMissionSource(actor,s.submissionId,s.workItemId,f.deps)).rejects.toThrow('PILOT_SOURCE_DENIED');
});
