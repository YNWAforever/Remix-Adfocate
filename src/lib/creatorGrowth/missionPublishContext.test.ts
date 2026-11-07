import { context } from "../../test/missionPublishTestData";
import { expect, it } from "vitest";
import { inspectMissionPublish } from "./missionPublishContext";


it("projects only approved content and exact asset without private evidence",()=>{
  const c=context();c.item.draft={id:"draft",caption:"PRIVATE_DRAFT",externalUrl:null,checklist:{},revision:99,lastSavedAt:"now"};
  expect(inspectMissionPublish(c)).toMatchObject({eligible:true,caption:"Tea #合作",imageSha256:"a".repeat(64)});
  expect(JSON.stringify(inspectMissionPublish(c))).not.toContain("PRIVATE_DRAFT");
});
it.each(["approval","duplicate","item","platform","checksum","multiple","video","upload","private","revoked","missing","label","account","owner"])("fails closed for %s",kind=>{
  const c=context(),v=c.item.versions![0],a=v.assets[0];
  if(kind==="approval")c.item.approvedVersionId="missing";
  if(kind==="duplicate")c.item.versions!.push(v);
  if(kind==="item")c.publication={...c.publication,workItemId:"other"};
  if(kind==="platform")c.item.platform="tiktok";
  if(kind==="checksum")a.checksum=null;
  if(kind==="multiple")v.assets.push(a);
  if(kind==="video")a.mimeType="video/mp4";
  if(kind==="upload")a.uploadState="pending";
  if(kind==="private")c.rights.sources="private";
  if(kind==="revoked")c.rights.grant="revoked";
  if(kind==="missing")c.rights.grant="missing";
  if(kind==="label")c.rights.platformLabel="unverified";
  if(kind==="account")c.publication={...c.publication,instructions:{...c.publication.instructions,expectedAccount:"@other"}};
  if(kind==="owner")c.rights.ownerKey="other";
  expect(inspectMissionPublish(c).eligible).toBe(false);
});
it.each(["caption","checksum","instruction","revision","grant"])("binds changes to %s even with the same approved version id",kind=>{
  const c=context(),before=inspectMissionPublish(c);const v=c.item.versions![0];
  if(kind==="caption")v.caption+=" edited";
  if(kind==="checksum")v.assets[0].checksum="c".repeat(64);
  if(kind==="instruction")c.publication={...c.publication,instructions:{...c.publication.instructions,publicationInstructions:"changed"}};
  if(kind==="revision")c.publication={...c.publication,revision:c.publication.revision+1};
  if(kind==="grant")c.rights.grantGeneration++;
  expect(inspectMissionPublish(c)).not.toEqual(before);
});
