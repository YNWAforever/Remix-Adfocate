import {expect,it,vi} from "vitest";
import {context} from "./missionPublishTestData";
vi.mock("../lib/creatorGrowth/jpegPreparation",()=>({prepareSyntheticJpeg:vi.fn(async()=>({bytes:new Uint8Array([1]),mime:"image/jpeg",width:480,height:600,byteSize:1,sha256:"a".repeat(64)}))}));
import {missionPublishIds, missionPublishFixture, readMissionMockContext} from "./missionPublishPreview";
import type {ActiveMissionWorkspace} from "../lib/activeMission";
it("owns a separate immutable seed and denies peer context",async()=>{
 const base={workflow:{id:"old",revision:0},mission:{title:"Original"},workItems:[],events:[],pendingReward:null} as unknown as ActiveMissionWorkspace;
 const before=JSON.stringify(base),f=await missionPublishFixture(base);
 expect(f.workspace.workflow.id).toBe(missionPublishIds.submission);expect(JSON.stringify(base)).toBe(before);
 expect(f.workspace.workItems[0].versions![0].assets[0].checksum).toBe("a".repeat(64));
 expect(readMissionMockContext("peer",missionPublishIds.submission,f.workspace.workItems[0],f.publication)).toBeNull();
 expect(readMissionMockContext(missionPublishIds.owner,missionPublishIds.submission,f.workspace.workItems[0],f.publication)?.rights.sampleOnly).toBe(true);
 expect(readMissionMockContext(missionPublishIds.owner,"wrong",context().item,f.publication)).toBeNull();
});
