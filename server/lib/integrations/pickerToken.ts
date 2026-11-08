import type { Actor } from "./types.js";
import { IntegrationError, requiredScopes } from "./policy.js";
type TokenGrant={accessToken:string;expiresAt:string;scopes:string[]};
type Config={origin:string;projectNumber:string};
/** Dedicated server channel. Its provider grant reader must enforce actor/generation on every call. */
export class PickerTokenChannel {
 private config:Config;
 constructor(config:Config,private grant:(actor:Actor,id:string,generation:number)=>Promise<TokenGrant>){
  let valid=false;try{const url=new URL(config.origin);valid=url.protocol==="https:"&&url.origin===config.origin&&/^\d+$/.test(config.projectNumber);}catch{/* Invalid fixed origin. */}
  if(!valid)throw new IntegrationError("PICKER_CONFIG_INVALID",503);
  this.config={...config};
 }
 async issue(actor:Actor,connectionId:string,generation:number){
  if(!actor.creatorId||!actor.workspaceId||!connectionId||connectionId.length>128||!Number.isSafeInteger(generation)||generation<1)throw new IntegrationError("INVALID_INPUT");
  const grant=await this.grant(actor,connectionId,generation),allowed=requiredScopes("google_drive","live_pilot");
  if(!grant.accessToken||!(Date.parse(grant.expiresAt)>Date.now())||!allowed.every(scope=>grant.scopes.includes(scope))||grant.scopes.some(scope=>!allowed.includes(scope)))throw new IntegrationError("PICKER_TOKEN_INVALID",403);
  return {...this.config,connectionId,generation,accessToken:grant.accessToken,expiresAt:grant.expiresAt,scopes:[...grant.scopes]};
 }
}
