import {createLivePilotComposition,type LivePilotDependencies} from './liveComposition.js';
import {MissionProofHandoff,type MissionProofHandoffDependencies} from '../missionProofHandoff.js';
import {SqlPilotReceiptStore} from './receiptStore.js';
import {SqlNativeMediaStorage} from './sqlMediaStorage.js';
import {NativeMediaLeaseStore} from './nativeMediaLease.js';
import {SqlPilotJobStore,type JobSql} from './jobStore.js';
import {createNativePilotWorker} from './nativePipeline.js';
import {createPilotMediaRoutes} from '../../../routes/creatorPilot.js';
import type {PublishRepository} from '../publishRepo.js';
import type {CreatorPilotRouteDependencies} from '../../../routes/creatorPilot.js';
/** Native application wiring. All effects are supplied by the server; existing
 * entrypoints construct none. Same factories are exercised with mocks locally.
 * Proof uses the original authoritative gateway, never a new reward path. */
export function createNativePilotApplication(deps:{live:LivePilotDependencies;receipts:Pick<SqlPilotReceiptStore,'collection'|'resolvePublished'>;proof:Pick<MissionProofHandoffDependencies,'resolveMission'|'submitProof'>}){
 const handoff=new MissionProofHandoff({enabled:true,now:deps.live.now,resolvePublished:(o,id)=>deps.receipts.resolvePublished(o,id),...deps.proof});
 const routes:CreatorPilotRouteDependencies={create:(verifiedActor,verifiedJwt)=>{
  const resolve=async(session:string)=>{
   if(session!==verifiedJwt)throw new Error('PILOT_LIVE_DENIED');
   const a=await deps.live.resolveActor(session);
   if(a.workspaceId!==verifiedActor.workspaceId||a.creatorId!==verifiedActor.creatorId||a.sessionHash!==verifiedActor.sessionHash||!await deps.live.authorize(a))throw new Error('PILOT_LIVE_DENIED');return a;
  };
  return {...createLivePilotComposition({...deps.live,resolveActor:resolve}),
   collection:async(session,id)=>{const a=await resolve(session),result=await deps.receipts.collection(a,id);await resolve(session);return result;},
   prepareProof:async(session,id)=>{const a=await resolve(session),result=await handoff.prepare(a,id);await resolve(session);return result;},
   confirmProof:async(session,input)=>handoff.confirm(await resolve(session),input),
  };
 }};return {routes};
}

type ReceiptDeps=ConstructorParameters<typeof SqlPilotReceiptStore>[0];
type LeaseDeps=ConstructorParameters<typeof NativeMediaLeaseStore>[0];
type WorkerDeps=Parameters<typeof createNativePilotWorker>[0];
/** Complete explicit native composition with injected effects. Instantiation is
 * inert: no SQL, credentials, network, worker loop or public origin is started. */
export function createNativePilotRuntime(deps:{
 sql:JobSql;repo:PublishRepository;live:Omit<LivePilotDependencies,'repo'|'enqueue'>;
 authorizeOwner:ReceiptDeps['authorize'];snapshot:ReceiptDeps['snapshot'];
 proof:Pick<MissionProofHandoffDependencies,'resolveMission'|'submitProof'>;
 worker:Pick<WorkerDeps,'resolve'|'policy'|'publisher'>;
 media:Pick<LeaseDeps,'authorize'|'load'>&{publicOrigin:string};
}){
 const now=deps.live.now,receipts=new SqlPilotReceiptStore({sql:deps.sql,repo:deps.repo,now,authorize:deps.authorizeOwner,snapshot:deps.snapshot});
 const media=new SqlNativeMediaStorage(deps.sql,deps.media.publicOrigin,now);
 const lease=new NativeMediaLeaseStore({now,storage:media,authorize:deps.media.authorize,load:deps.media.load});
 const jobs=new SqlPilotJobStore(deps.sql,deps.repo,now,'provider');
 const worker=createNativePilotWorker({...deps.worker,repo:deps.repo,jobs,lease,now,persistReceipt:(i,r)=>receipts.record(i.owner,i.id,r)});
 const app=createNativePilotApplication({live:{...deps.live,repo:deps.repo,enqueue:(a,id)=>jobs.enqueue(a,id)},receipts,proof:deps.proof});
 return {routes:app.routes,mediaRoutes:createPilotMediaRoutes(media),runOne:worker.runOne,
  cleanupExpired:async()=>({media:await media.sweepExpired(),receipts:await receipts.redactExpired()})};
}
