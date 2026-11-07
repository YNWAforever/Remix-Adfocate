// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {openOriginalWorkflowFixture} from './helpers/controlled-pilot-original-workflow.js';
import {seedOriginalPilotJourney} from '../lib/creatorGrowth/pilot/originalJourney.js';
import {createMockMissionPilot} from '../lib/creatorGrowth/pilot/missionService.js';
it('uploads, finalizes and submits through original commands while keeping approved bytes immutable',async()=>{
 const db=await openOriginalWorkflowFixture();
 try{
  await db.exec(await readFile('docs/review/kocmax-controlled-pilot/asset-attachment-changes.sql','utf8'));
  const s=await seedOriginalPilotJourney(db,createMockMissionPilot().snapshot(),{fromUpload:true});
  expect(s.versionNumber).toBe(1);
  const a=(await db.query<{mission_draft_version_id:string;checksum:string}>('select mission_draft_version_id,checksum from public.mission_draft_assets where id=$1',[s.asset.id])).rows[0];
  expect(a.mission_draft_version_id).toBe(s.approvedVersionId);expect(a.checksum).toBe(s.asset.sha256);
  await expect(db.query("update public.mission_draft_assets set checksum=$2 where id=$1",[s.asset.id,'c'.repeat(64)])).rejects.toThrow('immutable_record');
  await expect(db.query('update public.mission_draft_assets set mission_draft_version_id=null where id=$1',[s.asset.id])).rejects.toThrow('immutable_record');
 }finally{await db.close();}
},60000);
