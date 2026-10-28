import {readFileSync,writeFileSync} from 'node:fs';
import {createStaffCapabilityFixture} from '../../server/test/staffCapabilityFixture.js';
const owned=await createStaffCapabilityFixture('D19'),base=owned.base;
const legacyMission=await base.mission('legacy'),mission=await base.mission('active_workspace');
const roleFixture=JSON.parse(readFileSync('.codex-tmp/D19-role-fixture.private.json','utf8'));
const value={runId:base.runId,target:base.target.identity,workspaceId:base.workspaceId,otherWorkspaceId:base.otherWorkspaceId,slug:base.slug,mission,legacyMission,
 creators:base.creators,creator:base.creators[0],operator:owned.roles.operator,operatorSession:owned.roles.operator.session,reviewerSession:owned.roles.reviewer.session,
 roles:{...owned.roles,content_editor:roleFixture.roles.content_editor},resource:roleFixture.resource,authIds:JSON.parse(readFileSync('.codex-tmp/D19-fixture.private.json','utf8')).authIds,
 initialSnapshots:await Promise.all(base.creators.map(c=>base.neutrality(c.id))),platformEditorFixtureRunId:roleFixture.runId};
writeFileSync('.codex-tmp/D19-browser-fixture.private.json',JSON.stringify(value,(key,v)=>key==='client'?undefined:v));
writeFileSync('docs/verification/D19-browser-fixture.json',JSON.stringify({runId:base.runId,target:base.target.identity,workspaceIds:[base.workspaceId,base.otherWorkspaceId],missionIds:[legacyMission.id,mission.id],authIds:value.authIds,initialSnapshots:value.initialSnapshots,platformEditorFixtureRunId:roleFixture.runId,cleanup:'none; exact owned IDs retained'},null,2)+'\n');
console.log('D19 browser fixture ready after target verification; private sessions retained locally.');
