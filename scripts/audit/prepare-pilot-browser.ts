import {readFileSync,writeFileSync} from 'node:fs';
import {createStaffCapabilityFixture} from '../../server/test/staffCapabilityFixture.js';
// @ts-expect-error Native local verifier; runs before any fixture/client.
import {verifiedTarget} from './local-targets.mjs';
const selected=verifiedTarget(),context=selected.context;
if(context&&context.phase!=='browser')throw new Error('B2 browser setup phase mismatch');
// Read and attest the role dependency before creating any browser fixture rows.
const roleFixture=context?context.readPrivate('staff-fixture.private.json','role'):JSON.parse(readFileSync('.codex-tmp/D19-role-fixture.private.json','utf8'));
if(JSON.stringify(roleFixture.target)!==JSON.stringify(selected.identity)||!roleFixture.resource?.id||!roleFixture.roles?.content_editor?.id)throw new Error('B2 editor/resource dependency mismatch');
const owned=await createStaffCapabilityFixture('D19'),base=owned.base;
const legacyMission=await base.mission('legacy'),mission=await base.mission('active_workspace');
const value={...(context?{lineage:context.lineage}:{}),runId:base.runId,target:base.target.identity,workspaceId:base.workspaceId,otherWorkspaceId:base.otherWorkspaceId,slug:base.slug,mission,legacyMission,
 creators:base.creators,creator:base.creators[0],operator:owned.roles.operator,operatorSession:owned.roles.operator.session,reviewerSession:owned.roles.reviewer.session,
 roles:{...owned.roles,content_editor:roleFixture.roles.content_editor},resource:roleFixture.resource,authIds:JSON.parse(readFileSync(context?.privatePath('staff-fixture.private.json')??'.codex-tmp/D19-fixture.private.json','utf8')).authIds,
 initialSnapshots:await Promise.all(base.creators.map(c=>base.neutrality(c.id))),platformEditorFixtureRunId:roleFixture.runId};
writeFileSync(context?.privatePath('browser-fixture.private.json')??'.codex-tmp/D19-browser-fixture.private.json',JSON.stringify(value,(key,v)=>key==='client'?undefined:v));
writeFileSync(context?.publicPath('browser-fixture.json')??'docs/verification/D19-browser-fixture.json',JSON.stringify({...(context?{lineage:context.lineage}:{}),runId:base.runId,target:base.target.identity,workspaceIds:[base.workspaceId,base.otherWorkspaceId],missionIds:[legacyMission.id,mission.id],authIds:value.authIds,initialSnapshots:value.initialSnapshots,platformEditorFixtureRunId:roleFixture.runId,cleanup:'none; exact owned IDs retained'},null,2)+'\n');
console.log('D19 browser fixture ready after target verification; private sessions retained locally.');
