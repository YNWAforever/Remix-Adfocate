// @vitest-environment node
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {openOriginalWorkflowFixture} from './helpers/controlled-pilot-original-workflow.js';
it('applies and rolls back the entire empty review bundle without replacing original workflows',async()=>{
 const db=await openOriginalWorkflowFixture();try{
 await db.exec(await readFile('docs/review/kocmax-controlled-pilot/native-offline-bundle.sql','utf8'));
 for(const role of ['anon','authenticated'])for(const table of ['controlled_pilot_media','controlled_pilot_receipts','controlled_pilot_jobs','controlled_pilot_provider_sources']){
  expect((await db.query<{allowed:boolean}>('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') allowed',[role,'private.'+table])).rows[0].allowed).toBe(false);
 }
 const duplicates=await db.query("select indrelid,indkey,indclass,indoption,coalesce(indexprs::text,''),coalesce(indpred::text,''),count(*) from pg_index where indrelid in ('private.controlled_pilot_media'::regclass,'private.controlled_pilot_receipts'::regclass,'private.controlled_pilot_jobs'::regclass) group by 1,2,3,4,5,6 having count(*)>1");expect(duplicates.rows).toEqual([]);
 await db.exec(await readFile('docs/review/kocmax-controlled-pilot/native-offline-rollback.sql','utf8'));
 expect((await db.query("select to_regclass('private.controlled_pilot_media') media,to_regclass('private.controlled_pilot_receipts') receipt,to_regclass('private.controlled_pilot_jobs') jobs")).rows[0]).toEqual({media:null,receipt:null,jobs:null});
 expect((await db.query("select to_regprocedure('public.creator_publish_command(uuid,uuid,text,jsonb,timestamptz)') is not null ok")).rows[0]).toEqual({ok:true});
 }finally{await db.close();}
},60000);
