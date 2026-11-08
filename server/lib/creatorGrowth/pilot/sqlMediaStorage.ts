import type {PublishOwner} from '../publishRepo.js';
import type {NativeLeaseStorage} from './nativeMediaLease.js';
import type {JobSql} from './jobStore.js';
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const pathPattern=new RegExp(`^pilot/(${uuid})/(${uuid})/(${uuid})/(${uuid})\\.jpg$`);
const denied=():never=>{throw new Error('PILOT_MEDIA_DENIED');};
const activeIntent="exists(select 1 from private.creator_publish_intents i join public.creators c on c.id=i.creator_id and c.workspace_id=i.workspace_id where i.id=m.intent_id and i.workspace_id=m.workspace_id and i.creator_id=m.creator_id and i.stopped_at is null and i.state in ('creator_approved','container_preparing','provider_processing','publish_requested') and i.sample_only=false and c.status='active')";
/** Database-backed final-JPEG origin, not an object-storage proxy. Atomic row updates
 * fence put against close across processes. No database client or HTTP listener is
 * constructed here. Public fetch routing must use no-store and must not use a CDN. */
export class SqlNativeMediaStorage implements NativeLeaseStorage {
 readonly provenance='provider' as const;
 constructor(private readonly sql:JobSql,readonly publicOrigin:string,private readonly now:()=>Date){
  const u=new URL(publicOrigin);if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)denied();
 }
 private time(){const n=this.now();if(!Number.isFinite(+n))denied();return n;}
 private async query(t:string,a:readonly unknown[]){try{return await this.sql.query(t,a);}catch{return denied();}}
 async reserveIntent(o:PublishOwner,id:string,path:string,expires:string){
  const p=pathPattern.exec(path),now=this.time();if(!p||p[1]!==o.workspaceId||p[2]!==o.creatorId||p[3]!==id||!Number.isFinite(Date.parse(expires))||Date.parse(expires)<=+now||Date.parse(expires)>+now+900000)denied();
  return (await this.query("insert into private.controlled_pilot_media(reservation_id,intent_id,workspace_id,creator_id,path,expires_at) select $1,$1,$2,$3,$4,$5 from private.creator_publish_intents i join public.creators c on c.id=i.creator_id and c.workspace_id=i.workspace_id where i.id=$1 and i.workspace_id=$2 and i.creator_id=$3 and i.stopped_at is null and i.state in ('creator_approved','container_preparing','provider_processing','publish_requested') and i.sample_only=false and c.status='active' on conflict(reservation_id) do nothing returning intent_id",[id,o.workspaceId,o.creatorId,path,expires])).length===1;
 }
 async put(path:string,bytes:Uint8Array,expires:string){
  if(!pathPattern.test(path)||!(bytes instanceof Uint8Array)||bytes.length<4||bytes.length>20971520||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)denied();
  const rows=await this.query("update private.controlled_pilot_media m set jpeg=decode($2,'hex') where path=$1 and not closed and jpeg is null and expires_at=$3::timestamptz and expires_at>$4::timestamptz and "+activeIntent+" returning intent_id",[path,Buffer.from(bytes).toString('hex'),expires,this.time().toISOString()]);if(rows.length!==1)denied();
 }
 async read(path:string):Promise<Uint8Array|null>{
  if(!pathPattern.test(path))return null;
  const rows=await this.query("select encode(jpeg,'hex') as bytes,expires_at from private.controlled_pilot_media m where path=$1 and not closed and expires_at>$2::timestamptz and jpeg is not null and "+activeIntent,[path,this.time().toISOString()]);
  return typeof rows[0]?.bytes==='string'&&new Date(rows[0].expires_at as string).getTime()>+this.time()?new Uint8Array(Buffer.from(rows[0].bytes,'hex')):null;
 }
 async purgeIntent(o:PublishOwner,id:string){
  if(![o.workspaceId,o.creatorId,id].every(v=>new RegExp(`^${uuid}$`).test(v)))denied();
  const rows=await this.query('insert into private.controlled_pilot_media(reservation_id,intent_id,workspace_id,creator_id,closed) values($1,$1,$2,$3,true) on conflict(reservation_id) do update set closed=true,jpeg=null where controlled_pilot_media.workspace_id=$2 and controlled_pilot_media.creator_id=$3 returning intent_id',[id,o.workspaceId,o.creatorId]);return rows.length===1;
 }
 async purge(path:string){const p=pathPattern.exec(path);if(!p)denied();if(!await this.purgeIntent({workspaceId:p![1],creatorId:p![2]},p![3]))denied();}
 async verifyAbsent(path:string){if(!pathPattern.test(path))denied();const rows=await this.query('select intent_id from private.controlled_pilot_media where path=$1 and jpeg is not null',[path]);return rows.length===0;}
 /** Deletes bytes only; lifetime fences remain. Invoke explicitly, never on startup. */
 async sweepExpired(){return (await this.query('update private.controlled_pilot_media set closed=true,jpeg=null where not closed and expires_at<=$1::timestamptz returning intent_id',[this.time().toISOString()])).length;}
}


