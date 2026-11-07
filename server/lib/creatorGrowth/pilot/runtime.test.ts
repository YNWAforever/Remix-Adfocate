// @vitest-environment node
import {expect,it} from "vitest";
import {mayRunPilotWrite} from "./runtime.js";
const policy={enabled:true,runId:"pilot-1",allowedCreators:["creator"],allowedMissionIds:["mission"],stopRequested:false};
it("requires explicit server allowlist and closed stop switch",()=>{
 expect(mayRunPilotWrite(policy,"creator","mission")).toBe(true);
 for(const p of [undefined,{...policy,enabled:false},{...policy,stopRequested:true},{...policy,allowedCreators:[]},{...policy,runId:""}])expect(mayRunPilotWrite(p,"creator","mission")).toBe(false);
 expect(mayRunPilotWrite(policy,"peer","mission")).toBe(false);expect(mayRunPilotWrite(policy,"creator","other")).toBe(false);
});
