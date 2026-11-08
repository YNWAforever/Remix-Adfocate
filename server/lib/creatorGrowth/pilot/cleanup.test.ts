// @vitest-environment node
import {expect,it} from "vitest";
import {planPilotCleanup} from "./cleanup.js";
it("only lists explicit expired fixture records; holds unknowns and financial/mission data",()=>{
 const base={id:"test1",runId:"run1",workspaceId:"ws1",creatorId:"c1",sampleOnly:true,kind:"diagnostic" as const,state:"closed",createdAt:"2030-01-01T00:00:00.000Z"};
 const result=planPilotCleanup({runId:"run1",now:"2030-01-09T00:00:00.000Z",retentionApproved:true,records:[base,{...base,id:"unknown",kind:"intent",state:"outcome_unknown"},{...base,id:"real",sampleOnly:false},{...base,id:"ledger",kind:"ledger"},{...base,id:"other",runId:"other"}]});
 expect(result.deleteIds).toEqual(["test1"]);expect(result.holdIds).toEqual(["unknown","real","ledger"]);expect(result.executionAllowed).toBe(false);
 expect(planPilotCleanup({runId:"run1",now:"invalid",retentionApproved:true,records:[base]}).deleteIds).toEqual([]);
 expect(planPilotCleanup({runId:"run1",now:"2030-01-09Z",retentionApproved:false,records:[base]}).deleteIds).toEqual([]);
});
