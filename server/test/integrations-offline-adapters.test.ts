// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actor, ws, other, otherWs, pilotFixture, studio } from "./integrations-pilot-fixture.js";
import { integrationServiceFixture } from "./helpers/integrations-service-fixture.js";
import { createOfflineAdapters } from "../lib/integrations/offlineAdapters.js";
import { ProviderHttp } from "../lib/integrations/providerHttp.js";
import { RotatingCredentialVault, keySourceFromSecret } from "../lib/integrations/keyProvider.js";
import { OAuthCoordinator } from "../lib/integrations/oauth.js";
import { RepositoryOAuthStore } from "../lib/integrations/oauthStore.js";
import { PickerTokenChannel } from "../lib/integrations/pickerToken.js";
const owner={creatorId:actor,workspaceId:ws},clock=()=>new Date();
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");
const config={google:{clientId:"offline-client",clientSecret:"offline-secret",grantProject:"offline-google"},instagram:{clientId:"offline-ig",clientSecret:"offline-ig-secret"}};
let db:PGlite;
describe("D0 actual adapters + encrypted OAuth + local SQL composition",()=>{
 beforeAll(async()=>{db=(await pilotFixture()).db;},30000);
 afterAll(async()=>{await db?.close();});
 it("performs signed Google exchange, bounded selected read, private import, cross-worker refresh and revoke",async()=>{
  const {repo}=integrationServiceFixture(db);
  const keyJson=JSON.stringify({activeKeyId:"offline-key",keys:{"offline-key":Buffer.alloc(32,7).toString("base64")}});
  const vault=new RotatingCredentialVault(keySourceFromSecret(keyJson));
  const pair=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]) as CryptoKeyPair;
  const key={...await crypto.subtle.exportKey("jwk",pair.publicKey),kid:"fixture-key",alg:"RS256",use:"sig"};
  let nonce="",refreshes=0,releases:(()=>void)|undefined,holdRefresh=false;
  let refreshStarted!:()=>void;const started=new Promise<void>(resolve=>{refreshStarted=resolve;});
  const content="香港繁中創作者的私人筆記。";
  const transport=async(input:string,init?:RequestInit)=>{
   const url=new URL(input),body=new URLSearchParams(String(init?.body??""));
   if(url.pathname==="/token"){
    if(body.get("grant_type")==="refresh_token"){
     refreshes++;if(holdRefresh)await new Promise<void>(resolve=>{releases=resolve;refreshStarted();});
     return Response.json({token_type:"Bearer",access_token:"fixture-refreshed",expires_in:3600,scope:"openid https://www.googleapis.com/auth/drive.file"});
    }
    const seconds=Math.floor(Date.now()/1000),unsigned=`${encode({alg:"RS256",kid:"fixture-key"})}.${encode({iss:"https://accounts.google.com",aud:config.google.clientId,sub:"fixture-subject",nonce,iat:seconds,exp:seconds+3600})}`;
    const signature=Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",pair.privateKey,new TextEncoder().encode(unsigned))).toString("base64url");
    return Response.json({token_type:"Bearer",access_token:"fixture-access",refresh_token:"fixture-refresh",expires_in:3600,id_token:`${unsigned}.${signature}`,scope:"openid https://www.googleapis.com/auth/drive.file"});
   }
   if(url.pathname==="/oauth2/v3/certs")return Response.json({keys:[key]});
   if(url.pathname==="/revoke")return new Response(null,{status:200});
   if(url.pathname==="/drive/v3/files/selected-file"){
    if(url.searchParams.get("alt")==="media")return new Response(content);
    return Response.json({id:"selected-file",name:"私人筆記",mimeType:"text/plain",version:"1",size:String(new TextEncoder().encode(content).length),trashed:false,capabilities:{canDownload:true},ownedByMe:true});
   }
   throw new Error("Unexpected offline fixture URL");
  };
  const http=new ProviderHttp(transport,{transportKind:"fixture"}),one=createOfflineAdapters({repo,vault,http,...config,clock});
  const rpcClient={rpc:async(name:string,args:Record<string,unknown>)=>{
   if(name!=="integration_oauth_callback")throw new Error("Unexpected fixture RPC");
   try{return {data:(await db.query<{result:unknown}>("select public.integration_oauth_callback($1,$2,$3,$4::jsonb,$5::timestamptz) result",[args.p_state_hash,args.p_provider,args.p_ticket_hash,JSON.stringify(args.p_code),args.p_expires_at])).rows[0].result,error:null};}
   catch(error){return {data:null,error:{message:(error as Error).message}};}
  }} as unknown as Pick<SupabaseClient,"rpc">;
  const oauth=new OAuthCoordinator(new RepositoryOAuthStore(repo,rpcClient),vault,one.providers,{google_drive:{clientId:config.google.clientId,redirectUri:"https://pilot.invalid/api/integration-oauth/google_drive/callback"},instagram:{clientId:config.instagram.clientId,redirectUri:"https://pilot.invalid/api/integration-oauth/instagram/callback"}},(...args)=>one.service.acceptAuthorizedGrant(...args),clock);
  const begun=await oauth.begin(owner,"google_drive","session","/studio",0),url=new URL(begun.authorizationUrl);nonce=url.searchParams.get("nonce")!;
  const receipt=await oauth.callback("google_drive",new URL(`https://pilot.invalid/api/integration-oauth/google_drive/callback?code=fixture-code&state=${url.searchParams.get("state")}`));
  await expect(oauth.complete({creatorId:other,workspaceId:otherWs},"google_drive","other",receipt.ticket,true)).rejects.toThrow();
  const linked=await oauth.complete(owner,"google_drive","session",receipt.ticket,false),id=linked.connection.id;
  expect(linked.sampleOnly).toBe(true);
  const token=new PickerTokenChannel({origin:"https://pilot.invalid",projectNumber:"123"},(...args)=>one.service.pickerAccessGrant(...args));
  expect(await token.issue(owner,id,1)).toMatchObject({accessToken:"fixture-access",generation:1});
  const selected=await one.service.registerSelectedFiles(owner,id,["selected-file"],crypto.randomUUID());
  expect(selected.resources[0]).toMatchObject({sampleOnly:true,rights:"unknown",excerpt:content,evidence:{apiVersion:"v3"}});
  const thread=await studio(db,"create_thread",{title:"Offline adapter brief",topic:"creation"});
  const imported=await one.service.importSources(owner,id,{requestId:crypto.randomUUID(),threadId:thread.id,revision:0,resourceIds:[selected.resources[0].id],question:"根據私人筆記整理 brief",modelConsent:false,processingRights:true,shareRights:false});
  expect(JSON.stringify(imported)).toContain("私人筆記");expect(JSON.stringify(imported)).not.toContain("fixture-access");
  await expect(one.service.authorizeSources(owner,(imported.sources as {id:string}[]).map(s=>s.id),"share")).rejects.toThrow("SOURCE_PRIVATE");
  const stored=await repo.command(owner,crypto.randomUUID(),"credentials",{id,generation:1});
  const identity=`${ws}:${actor}:google_drive:${id}:1`;
  const grant=await vault.open<Record<string,unknown>>(stored.credential as Parameters<typeof vault.open>[0],identity);
  const expiresAt=new Date(Date.now()+1000).toISOString();
  await repo.command(owner,crypto.randomUUID(),"update_credentials",{id,generation:1,expiresAt,credential:await vault.seal({...grant,expiresAt},identity)});
  const restarted=createOfflineAdapters({repo,vault:new RotatingCredentialVault(keySourceFromSecret(keyJson)),http,...config,clock});
  holdRefresh=true;const first=one.service.pickerAccessGrant(owner,id,1);
  await Promise.race([started,first.then(()=>{throw new Error("Refresh did not pause");})]);
  await expect(restarted.service.pickerAccessGrant(owner,id,1)).rejects.toThrow("REFRESH_BUSY");releases!();
  expect((await first).accessToken).toBe("fixture-refreshed");expect((await restarted.service.pickerAccessGrant(owner,id,1)).accessToken).toBe("fixture-refreshed");expect(refreshes).toBe(1);
  expect(await one.service.revokeConnection(owner,id,crypto.randomUUID())).toEqual({local:"revoked",provider:"revoked"});
  await expect(token.issue(owner,id,1)).rejects.toThrow("STALE_CONNECTION");
  expect(JSON.stringify(await repo.command(owner,crypto.randomUUID(),"export",{}))).not.toMatch(/fixture-access|fixture-refresh|ciphertext/);
 },20000);
});
