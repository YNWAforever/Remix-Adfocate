// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {SqlPilotReceiptStore} from './receiptStore.js';
import type {PublishIntent} from '../publishRepo.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('retains private receipt across restart, denies peers and cannot overwrite accepted evidence',async()=>{
 const db=new PGlite();try{
 await db.exec('create schema private; create role service_role; create role anon; create role authenticated; create table private.creator_publish_intents(id uuid,workspace_id uuid,creator_id uuid,primary key(id,workspace_id,creator_id));');
 const owner={workspaceId:id(1),creatorId:id(11)},caption='Approved #合作',hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const intent={id:id(91),owner,state:'published',retentionUntil:'2030-04-01T00:00:00Z',sampleOnly:false,stoppedAt:null,receipt:{observedAt:'2030-01-01T00:00:00Z',mediaId:'55555',status:'published',sampleOnly:false},binding:{draftId:id(41),draftRevision:1,imageSha256:'b'.repeat(64),captionSha256:hash(caption),accountSubject:'22222',fingerprint:'c'.repeat(64),missionBasis:{kind:'active_mission_provider',product:'facebook_login',submissionId:id(21),workItemId:id(31),approvedVersionId:id(41),instructionRevision:1}}} as PublishIntent;
 await db.query('insert into private.creator_publish_intents values($1,$2,$3)',[intent.id,owner.workspaceId,owner.creatorId]);await db.exec(await readFile('docs/review/kocmax-controlled-pilot/receipt-storage-changes.sql','utf8'));
 let active=true;
 const snapshot={draft:{id:id(41),revision:1,owner,caption,accountSubject:'22222',imageSha256:'b'.repeat(64),rightsConfirmed:true,asset:{mime:'image/jpeg',byteSize:4,width:1,height:1,validated:true},disclosure:{sponsored:true,platformLabelRequired:true,brandTagRequired:false,captionText:'#合作'},mission:{kind:'active' as const,submissionId:id(21),workItemId:id(31),approvedVersionId:id(41),instructionRevision:1}},instructionSnapshot:{publicationInstructions:'Original',requiredDisclosures:['#合作'],expectedAccount:'@example',proofEvidencePolicy:{},publishDueAt:'2030-02-01T00:00:00Z',frozenAt:'2030-01-01T00:00:00Z'}};
 const deps={sql:{query:async(t:string,a:readonly unknown[])=>(await db.query<Record<string,unknown>>(t,[...a])).rows},now:()=>new Date('2030-01-01T00:00:01Z'),authorize:async(o:typeof owner)=>active&&o.creatorId===owner.creatorId&&o.workspaceId===owner.workspaceId,repo:{getOwned:async()=>intent},snapshot:async()=>structuredClone(snapshot)};
 const create=()=>new SqlPilotReceiptStore(deps),receipt={mediaId:'55555',accountSubject:'22222',permalink:'https://www.instagram.com/p/example/',provenance:'provider' as const,sampleOnly:false};
 await create().record(owner,intent.id,receipt);await create().record(owner,intent.id,receipt);
 expect((await create().resolvePublished(owner,intent.id)).nativeReceipt?.kind).toBe('facebook_login');
 expect(await create().collection(owner,intent.id)).toMatchObject({visibility:'private',caption,approvedVersionId:id(41)});
 await expect(create().record(owner,intent.id,{...receipt,permalink:'https://www.instagram.com/p/changed/'})).rejects.toThrow('PILOT_RECEIPT_DENIED');
 await expect(create().resolvePublished({...owner,creatorId:id(12)},intent.id)).rejects.toThrow();active=false;await expect(create().collection(owner,intent.id)).rejects.toThrow();
 await db.query('delete from private.creator_publish_intents where id=$1',[intent.id]);
 expect((await db.query('select snapshot,intent_id from private.controlled_pilot_receipts')).rows[0]).toEqual({snapshot:null,intent_id:null});
 }finally{await db.close();}
},60000);



