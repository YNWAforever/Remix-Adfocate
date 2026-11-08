import type { CredentialStore } from "./keyProvider.js";
import type { IntegrationRepository, IntegrationProvider, ProviderId } from "./types.js";
import type { ProviderHttpPort } from "./providerHttp.js";
import { GoogleDriveLiveProvider, createGoogleSigningKeyResolver } from "./providers/googleDriveLive.js";
import { InstagramLiveProvider, INSTAGRAM_API_VERSION } from "./providers/instagramLive.js";
import { verifyGoogleIdentityToken } from "./googleIdentity.js";
import { IntegrationError } from "./policy.js";
import { IntegrationService } from "./service.js";

/** Offline composition root only. Never called by runtime.ts and cannot create its own HTTP client. */
export function createOfflineAdapters(input:{
 repo:IntegrationRepository;vault:CredentialStore;http:ProviderHttpPort;clock?:()=>Date;
 google:{clientId:string;clientSecret:string;grantProject:string};instagram:{clientId:string;clientSecret:string};
}){
 if(input.http.transportKind!=="fixture")throw new IntegrationError("LIVE_PROVIDER_DISABLED",503);
 const clock=input.clock??(()=>new Date()),resolve=createGoogleSigningKeyResolver(input.http);
 const providers:Record<ProviderId,IntegrationProvider>={
  instagram:new InstagramLiveProvider({...input.instagram,http:input.http,apiVersion:INSTAGRAM_API_VERSION}),
  google_drive:new GoogleDriveLiveProvider({...input.google,http:input.http,
   verifyIdentity:(idToken,nonce)=>verifyGoogleIdentityToken(idToken,{clientId:input.google.clientId,nonce},resolve,clock()),
   isSelected:async(connection,externalId)=>{
    const current=await input.repo.connection(connection,connection.id);
    if(!current||current.creatorId!==connection.creatorId||current.workspaceId!==connection.workspaceId||current.generation!==connection.generation||current.status==="revoked"||current.status==="reauth_required")return false;
    return (await input.repo.resources(connection,connection.id)).some(resource=>resource.externalId===externalId&&resource.generation===connection.generation&&resource.selected&&resource.availability!=="revoked");
   }
  })
 };
 return {providers,service:new IntegrationService(input.repo,providers,input.vault,clock,{offlineAdapters:true})};
}
