import {randomUUID} from "node:crypto";
import type {IntegrationRepository,ConnectionRecord} from "../../integrations/types.js";
import type {PublishActor} from "../publishRepo.js";
import {PublishProviderError} from "../instagramPublisher.js";
import {assertPilotAccount,type PilotAccount} from "./protocol.js";
export type PilotGrantStatus=Readonly<{account:PilotAccount;local:"active"|"stopped";providerRevocation:"not_requested"|"pending"|"confirmed"|"unverified";grantedScopes:readonly string[];lastVerifiedAt:string|null}>;
type ResolveAccount=(actor:PublishActor,connectionId:string)=>Promise<PilotAccount|null>;
/** Existing integration repository remains the grant authority. No provider call here. */
export class PilotGrantLifecycle{
 constructor(private readonly repo:IntegrationRepository,private readonly resolveAccount:ResolveAccount){}
 private async owned(actor:PublishActor,id:string){
  if(!actor?.creatorId||!actor.workspaceId||!/^[a-f0-9]{64}$/.test(actor.sessionHash))throw new PublishProviderError("PUBLISH_TARGET_MISMATCH");
  const row=await this.repo.connection(actor,id);
  if(!row||row.creatorId!==actor.creatorId||row.workspaceId!==actor.workspaceId||row.provider!=="instagram")throw new PublishProviderError("PUBLISH_TARGET_MISMATCH");
  return row;
 }
 private status(row:ConnectionRecord,account:PilotAccount):PilotGrantStatus{
  return {account:{...account,grantGeneration:row.generation},local:row.status==="revoked"?"stopped":"active",
   providerRevocation:row.providerRevocation==="pending"?"pending":row.providerRevocation==="not_requested"?"not_requested":"unverified",
   grantedScopes:[...row.scopes],lastVerifiedAt:null};
 }
 async stopPilotGrant(actor:PublishActor,connectionId:string):Promise<PilotGrantStatus>{
  const row=await this.owned(actor,connectionId),account=await this.resolveAccount(actor,connectionId);
  if(!account)throw new PublishProviderError("PUBLISH_PROTOCOL_UNVERIFIED");assertPilotAccount(account);
  if(account.connectionId!==row.id||account.accountSubject!==row.subject||(row.status!=="revoked"&&account.grantGeneration!==row.generation))throw new PublishProviderError("PUBLISH_TARGET_MISMATCH");
  if(row.status!=="revoked")await this.repo.command(actor,randomUUID(),"revoke",{id:connectionId,generation:row.generation});
  return this.status(await this.owned(actor,connectionId),account);
 }
}
