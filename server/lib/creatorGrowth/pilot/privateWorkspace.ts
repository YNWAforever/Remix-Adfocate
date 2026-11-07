import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import type {PublishActor,PublishIntent} from '../publishRepo.js';
import {bindApprovedMission,type ApprovedMissionSnapshot} from './missionBinding.js';
import type {StudioBrief,StudioSource,StudioSection} from '../../../../src/lib/studio/types.js';
import {copySavedBrief} from '../../../../src/lib/studio/savedOutputs.js';
const scopes=['instagram_basic','instagram_content_publish','pages_read_engagement'];
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function deny():never{throw new Error('PILOT_PRIVATE_DENIED');}
type Draft={id:string;sections:StudioSection[];approval:null;publishAuthority:false};
type State={generation:number;active:boolean;grantExpires:number;revokedAt:string|null;challenge:null|{hash:string;session:string;expires:number;generation:number};threadId:string;briefs:StudioBrief[];sources:StudioSource[];receiptId:string|null;draft:Draft|null};
/** Local-only Facebook-product rehearsal. No URLs, provider tokens or transport are constructed.
 * This never widens the existing Instagram Login OAuthCoordinator contract. */
export class PilotPrivateWorkspace{
 private constructor(private db:PGlite,private snapshot:ApprovedMissionSnapshot,private published:()=>Promise<PublishIntent|null>,private now:()=>Date){}
 static async open(db:PGlite,snapshot:ApprovedMissionSnapshot,published:()=>Promise<PublishIntent|null>,now=()=>new Date()){
  await db.exec('create table if not exists private.controlled_pilot_mock_private(workspace_id uuid not null,creator_id uuid not null,value jsonb not null,primary key(workspace_id,creator_id));alter table private.controlled_pilot_mock_private enable row level security;revoke all on private.controlled_pilot_mock_private from public;');
  const initial:State={generation:0,active:false,grantExpires:0,revokedAt:null,challenge:null,threadId:randomUUID(),briefs:[],sources:[],receiptId:null,draft:null};
  await db.query('insert into private.controlled_pilot_mock_private values($1,$2,$3::jsonb) on conflict do nothing',[snapshot.owner.workspaceId,snapshot.owner.creatorId,JSON.stringify(initial)]);
  return new PilotPrivateWorkspace(db,snapshot,published,now);
 }
 private owned(a:PublishActor){if(!a||a.workspaceId!==this.snapshot.owner.workspaceId||a.creatorId!==this.snapshot.owner.creatorId||!/^[a-f0-9]{64}$/.test(a.sessionHash))deny();}
 private async transact<T>(a:PublishActor,fn:(s:State)=>T|Promise<T>):Promise<T>{this.owned(a);return this.db.transaction(async tx=>{const row=(await tx.query<{value:State}>('select value from private.controlled_pilot_mock_private where workspace_id=$1 and creator_id=$2 for update',[a.workspaceId,a.creatorId])).rows[0];if(!row)deny();const result=await fn(row.value);await tx.query('update private.controlled_pilot_mock_private set value=$3::jsonb where workspace_id=$1 and creator_id=$2',[a.workspaceId,a.creatorId,JSON.stringify(row.value)]);return structuredClone(result);});}
 async status(a:PublishActor){return this.transact(a,s=>({sampleOnly:true as const,product:'facebook_login' as const,accountLabel:'@kocmax_demo_only',status:s.active&&s.grantExpires>this.now().getTime()?'connected':s.revokedAt?'revoked':'not_connected',generation:s.generation,scopes:s.active?[...scopes]:[],providerRevocation:'unverified',liveReady:false}));}
 async begin(a:PublishActor){return this.transact(a,s=>{const state=randomBytes(32).toString('hex');s.challenge={hash:hash(state),session:a.sessionHash,expires:this.now().getTime()+600000,generation:s.generation};return {state,sampleOnly:true,product:'facebook_login',accountLabel:'@kocmax_demo_only',scopes:[...scopes],expiresAt:new Date(s.challenge.expires).toISOString()};});}
 async complete(a:PublishActor,state:string,confirmed:boolean,scenario:'ok'|'missing_scope'|'wrong_account'|'denied'='ok'){
  // Consume matching state even when a fixture provider refuses; rejected state is never replayed.
  const accepted=await this.transact(a,s=>{const c=s.challenge;if(!confirmed||typeof state!=='string'||!c||c.hash!==hash(state)||c.session!==a.sessionHash)deny();s.challenge=null;const grant={product:'facebook_login',appId:this.snapshot.account.appId,subject:scenario==='wrong_account'?'99999':this.snapshot.account.accountSubject,scopes:scenario==='missing_scope'?scopes.slice(0,1):scopes,provenance:'fixture'};if(c.expires<=this.now().getTime()||c.generation!==s.generation||scenario==='denied'||grant.product!=='facebook_login'||grant.provenance!=='fixture'||grant.appId!==this.snapshot.account.appId||grant.subject!==this.snapshot.account.accountSubject||scopes.some(p=>!grant.scopes.includes(p))||grant.scopes.some(p=>!scopes.includes(p)))return false;s.active=true;s.generation++;s.grantExpires=this.now().getTime()+3600000;return true;});
  if(!accepted)deny();return this.status(a);
 }
 async revoke(a:PublishActor){await this.transact(a,s=>{if(s.active||!s.revokedAt)s.generation++;s.active=false;s.challenge=null;s.revokedAt=this.now().toISOString();s.draft=null;for(const source of s.sources)source.revoked_at=s.revokedAt;});return this.status(a);}
 async requireGrant(a:PublishActor){return this.transact(a,s=>{if(!s.active||s.grantExpires<=this.now().getTime())deny();return {...this.snapshot.account,grantGeneration:s.generation};});}
 async collection(a:PublishActor){return this.transact(a,s=>({sampleOnly:true,threadId:s.threadId,briefs:s.briefs.slice(-20).map(b=>({...b,sections:b.sections.map(section=>({...section,text:section.sourceIds.some(id=>s.sources.some(source=>source.id===id&&source.revoked_at))?'來源已撤銷，內容已隱藏。':section.text}))})),sources:s.sources.map(source=>source.revoked_at?{...source,content:'來源已撤銷，內容已隱藏。'}:source),draft:s.draft,receiptId:s.receiptId,submissionId:this.snapshot.submissionId,approvedVersionId:this.snapshot.approvedVersionId}));}
 async saveReceipt(a:PublishActor,confirmed:boolean){this.owned(a);if(!confirmed)deny();const intent=await this.published(),snapshot=this.snapshot;
  if(!intent||intent.owner.workspaceId!==a.workspaceId||intent.owner.creatorId!==a.creatorId||intent.state!=='published'||intent.sampleOnly!==true||intent.receipt.sampleOnly!==true||!intent.receipt.mediaId||!intent.binding.missionBasis)deny();
  const expected=bindApprovedMission(a,{...snapshot,account:{...snapshot.account,grantGeneration:intent.binding.grantGeneration}});if(intent.binding.fingerprint!==expected.fingerprint)deny();
  return this.transact(a,s=>{if(s.receiptId===intent.id)return {saved:true,sampleOnly:true};if(!s.active||s.grantExpires<=this.now().getTime()||s.generation!==intent.binding.grantGeneration)deny();if(s.receiptId)deny();
   const sourceId=randomUUID(),created=this.now().toISOString();s.sources.push({id:sourceId,thread_id:s.threadId,title:'品牌任務模擬回執 · 未驗證',content:`任務 ${snapshot.submissionId}；核准版本 ${snapshot.approvedVersionId}；模擬 media ${intent.receipt.mediaId}。不是官方發佈證據。`,url:null,kind:'private',shareable:false,question:'這次核准作品的模擬結果是甚麼？',platform:'Instagram mock',region:'HK',language:'zh-Hant',observed_at:created,revoked_at:null,status:'unverified'});
   s.briefs.push({id:randomUUID(),thread_id:s.threadId,version:1,created_at:created,sections:[{id:randomUUID(),text:snapshot.caption,sourceIds:[sourceId]}]});s.receiptId=intent.id;return {saved:true,sampleOnly:true};});
 }
 async copy(a:PublishActor,briefId:string){return this.transact(a,s=>{const b=s.briefs.find(b=>b.id===briefId);if(!b)deny();s.draft={id:randomUUID(),sections:copySavedBrief(b,s.threadId,s.sources,randomUUID),approval:null,publishAuthority:false};return s.draft;});}
 async saveDraft(a:PublishActor,draftId:string,text:string){return this.transact(a,s=>{if(!s.draft||s.draft.id!==draftId||typeof text!=='string'||!text.trim()||text.length>3000)deny();const b:StudioBrief={id:randomUUID(),thread_id:s.threadId,version:s.briefs.length+1,sections:[{...s.draft.sections[0],text}],created_at:this.now().toISOString()};copySavedBrief(b,s.threadId,s.sources,randomUUID);s.briefs.push(b);s.draft=null;return {saved:true,sampleOnly:true};});}
}
