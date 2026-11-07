// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {SqlNativeMediaStorage} from './sqlMediaStorage.js';
const owner={workspaceId:'00000000-0000-4000-8000-000000000001',creatorId:'00000000-0000-4000-8000-000000000011'},intent='00000000-0000-4000-8000-000000000091';
const path=`pilot/${owner.workspaceId}/${owner.creatorId}/${intent}/00000000-0000-4000-8000-000000000081.jpg`;
it('persists lease bytes, expires reads, and fences late puts across reconstructed stores',async()=>{
 const db=new PGlite();try{
 await db.exec('create schema private; create role service_role; create role anon; create role authenticated; create table private.creator_publish_intents(id uuid,workspace_id uuid,creator_id uuid,stopped_at timestamptz,sample_only boolean default false,state text default $$creator_approved$$,primary key(id,workspace_id,creator_id)); create table public.creators(id uuid,workspace_id uuid,status text);');
 await db.query('insert into private.creator_publish_intents(id,workspace_id,creator_id) values($1,$2,$3)',[intent,owner.workspaceId,owner.creatorId]);
 await db.query('insert into public.creators values($1,$2,$3)',[owner.creatorId,owner.workspaceId,'active']);
 await db.exec(await readFile('docs/review/kocmax-controlled-pilot/media-storage-changes.sql','utf8'));
 let now=new Date('2030-01-01T00:00:00Z');const sql={query:async(t:string,a:readonly unknown[]) => (await db.query<Record<string,unknown>>(t,[...a])).rows};
 const create=()=>new SqlNativeMediaStorage(sql,'https://media.example.invalid',()=>now);
 const s=create(),expiry='2030-01-01T00:15:00Z';expect(await s.reserveIntent(owner,intent,path,expiry)).toBe(true);
 await s.put(path,new Uint8Array([255,216,255,217]),expiry);expect(await create().read(path)).toEqual(new Uint8Array([255,216,255,217]));
 await db.query('update private.creator_publish_intents set state=$1',['published']);expect(await create().read(path)).toBeNull();await db.query('update private.creator_publish_intents set state=$1',['creator_approved']);
 await db.query('update private.creator_publish_intents set stopped_at=now()');expect(await create().read(path)).toBeNull();await db.query('update private.creator_publish_intents set stopped_at=null');
 now=new Date(expiry);expect(await create().read(path)).toBeNull();now=new Date('2030-01-01T00:01:00Z');
 expect(await create().purgeIntent(owner,intent)).toBe(true);expect(await create().verifyAbsent(path)).toBe(true);
 await expect(s.put(path,new Uint8Array([255,216,255,217]),expiry)).rejects.toThrow('PILOT_MEDIA_DENIED');
 expect(await create().reserveIntent(owner,intent,path,expiry)).toBe(false);
 expect(await create().read(path)).toBeNull();
 await db.query('delete from private.creator_publish_intents where id=$1',[intent]);
 expect((await db.query('select closed,jpeg,intent_id from private.controlled_pilot_media')).rows[0]).toEqual({closed:true,jpeg:null,intent_id:null});
 expect((await db.query("select has_table_privilege('authenticated','private.controlled_pilot_media','SELECT') as allowed")).rows[0]).toEqual({allowed:false});
 }finally{await db.close();}
},60000);



