import { digest, type EncryptedEnvelope } from "./credentials.js";
import type { CredentialStore } from "./keyProvider.js";
import { IntegrationError, requiredScopes, validateReturnPath } from "./policy.js";
import type { Actor, IntegrationProvider, ProviderGrant, ProviderId } from "./types.js";

export type OAuthStateRecord = {
  actor:Actor; stateHash:string; sessionHash:string; provider:ProviderId; expiresAt:string;
  expectedGeneration:number; returnPath:string; secret:EncryptedEnvelope;
};
export interface OAuthStore {
  start(actor:Actor, record:Omit<OAuthStateRecord,"actor">):Promise<void>;
  callback(input:{stateHash:string;provider:ProviderId;ticketHash:string;code:EncryptedEnvelope;ticketExpiresAt:string}):Promise<void>;
  complete(actor:Actor,input:{ticketHash:string;provider:ProviderId;sessionHash:string;allowRelogin:boolean}):Promise<{stateHash:string;expectedGeneration:number;returnPath:string;secret:EncryptedEnvelope;code:unknown}>;
}
export type OAuthConfig = {clientId:string;redirectUri:string};
type OAuthSecret = {codeVerifier?:string;nonce?:string;redirectUri:string;stateHash:string};
type OAuthCode = {code?:string;error?:"AUTHORIZATION_DECLINED"|"OAUTH_PROVIDER_ERROR"};
type ConnectionReceipt = {id:string;generation:number};
const b64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const secretIdentity=(actor:Actor,provider:ProviderId,hash:string)=>`${actor.workspaceId}:${actor.creatorId}:${provider}:oauth:${hash}`;
const codeIdentity=(provider:ProviderId,stateHash:string,ticketHash:string)=>`${provider}:callback:${stateHash}:${ticketHash}`;
const invalid=():never=>{throw new IntegrationError("OAUTH_STATE_INVALID",403);};
function opaque(value:string) {if(typeof value!=="string"||! /^[a-zA-Z0-9_-]{43}$/.test(value))invalid();return value;}

/** All protocol work is injectable. D0 accepts fixture transports only, including callbacks. */
export class OAuthCoordinator {
  constructor(private store:OAuthStore,private vault:CredentialStore,private providers:Record<ProviderId,IntegrationProvider>,
    private configs:Record<ProviderId,OAuthConfig>,private persist:(actor:Actor,provider:ProviderId,grant:ProviderGrant,expectedGeneration:number)=>Promise<ConnectionReceipt>,private clock:()=>Date=()=>new Date()) {
    for(const provider of Object.values(providers)) if(provider.mode!=="mock"&&(provider.mode!=="live_pilot"||provider.sampleOnly!==true))throw new IntegrationError("LIVE_PROVIDER_DISABLED",503);
    for(const [id,config] of Object.entries(configs)) {
      let url:URL;try{url=new URL(config.redirectUri);}catch{throw new IntegrationError("OAUTH_CONFIG_INVALID",503);}
      if(!config.clientId||config.clientId.length>256||url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!==`/api/integration-oauth/${id}/callback`)throw new IntegrationError("OAUTH_CONFIG_INVALID",503);
    }
  }
  async begin(actor:Actor,provider:ProviderId,session:string,returnPath:string,expectedGeneration:number) {
    if(this.providers[provider].mode!=="live_pilot"||!session||!actor.creatorId||!actor.workspaceId||!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0)throw new IntegrationError("OAUTH_CONFIG_INVALID",503);
    const config=this.configs[provider],state=random(),stateHash=await digest(state),nonce=random(),codeVerifier=random();
    const expiresAt=new Date(this.clock().getTime()+10*60*1000).toISOString();
    const secret:OAuthSecret={redirectUri:config.redirectUri,stateHash,...(provider==="google_drive"?{nonce,codeVerifier}:{})};
    await this.store.start(actor,{stateHash,sessionHash:await digest(session),provider,expiresAt,expectedGeneration,returnPath:validateReturnPath(returnPath),secret:await this.vault.seal(secret,secretIdentity(actor,provider,stateHash))});
    const url=new URL(provider==="google_drive"?"https://accounts.google.com/o/oauth2/v2/auth":"https://api.instagram.com/oauth/authorize");
    const scopes=requiredScopes(provider,"live_pilot");
    for(const [key,value] of Object.entries({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:"code",scope:scopes.join(provider==="instagram"?",":" "),state}))url.searchParams.set(key,value);
    if(provider==="google_drive") {
      url.searchParams.set("code_challenge",b64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(codeVerifier)))));
      url.searchParams.set("code_challenge_method","S256");url.searchParams.set("nonce",nonce);
      url.searchParams.set("access_type","offline");url.searchParams.set("prompt","consent select_account");url.searchParams.set("include_granted_scopes","false");
    }
    return {authorizationUrl:url.href,expiresAt,provider,scopes,sampleOnly:true as const};
  }
  async callback(provider:ProviderId,url:URL) {
    const config=this.configs[provider],registered=new URL(config.redirectUri);
    if(url.href.length>8192||url.origin!==registered.origin||url.pathname!==registered.pathname||url.username||url.password)invalid();
    for(const name of ["state","code","error","iss"])if(url.searchParams.getAll(name).length>1)invalid();
    if(url.searchParams.has("code")===url.searchParams.has("error"))invalid();
    const issuer=url.searchParams.get("iss");if(issuer&&!(provider==="google_drive"&&issuer==="https://accounts.google.com"))invalid();
    const stateHash=await digest(opaque(url.searchParams.get("state")??"")),ticket=random(),ticketHash=await digest(ticket);
    const code=url.searchParams.get("code"),error=url.searchParams.get("error");
    if(code!==null&&(!code||code.length>4096||/[\r\n]/.test(code)||code.includes("\0")))invalid();
    const payload:OAuthCode=code!==null?{code}:{error:error==="access_denied"?"AUTHORIZATION_DECLINED":"OAUTH_PROVIDER_ERROR"};
    await this.store.callback({stateHash,provider,ticketHash,code:await this.vault.seal(payload,codeIdentity(provider,stateHash,ticketHash)),ticketExpiresAt:new Date(this.clock().getTime()+5*60*1000).toISOString()});
    // A fragment avoids putting the opaque receipt in access logs or Referer headers.
    return {ticket,returnTo:`/connections#integration=${provider}&ticket=${ticket}`};
  }
  async complete(actor:Actor,provider:ProviderId,session:string,ticket:string,confirmAccount:boolean) {
    if(!session||!actor.creatorId||!actor.workspaceId)invalid();
    const ticketHash=await digest(opaque(ticket));
    const claim=await this.store.complete(actor,{ticketHash,provider,sessionHash:await digest(session),allowRelogin:confirmAccount===true});
    if(!/^[a-f0-9]{64}$/.test(claim.stateHash)||!Number.isSafeInteger(claim.expectedGeneration)||claim.expectedGeneration<0)invalid();
    const secret=await this.vault.open<OAuthSecret>(claim.secret,secretIdentity(actor,provider,claim.stateHash));
    const code=await this.vault.open<OAuthCode>(claim.code as EncryptedEnvelope,codeIdentity(provider,claim.stateHash,ticketHash));
    if(secret.stateHash!==claim.stateHash||secret.redirectUri!==this.configs[provider].redirectUri)invalid();
    if(code.error)throw new IntegrationError(code.error,403);
    if(!code.code)return invalid();
    let grant:ProviderGrant;
    try {grant=await this.providers[provider].authorize(code.code,actor,this.clock(),{redirectUri:secret.redirectUri,codeVerifier:secret.codeVerifier,nonce:secret.nonce});}
    catch(error){if(error instanceof IntegrationError)throw error;throw new IntegrationError("OAUTH_EXCHANGE_FAILED",503);}
    const allowed=requiredScopes(provider,"live_pilot");
    if(!grant.subject||!Array.isArray(grant.scopes)||grant.scopes.some(scope=>!allowed.includes(scope))||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=this.clock().getTime())throw new IntegrationError("OAUTH_IDENTITY_INVALID",403);
    const connection=await this.persist(actor,provider,grant,claim.expectedGeneration);
    return {connection:{id:connection.id,generation:connection.generation},returnPath:validateReturnPath(claim.returnPath),sampleOnly:true as const};
  }
}
