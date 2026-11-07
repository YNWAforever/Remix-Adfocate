// @vitest-environment node
import {expect,it} from "vitest";
import {canStartPilot,validatePilotRoster} from "./roster.js";
import {PILOT_GATE_IDS} from "./readiness.js";
const entry={runId:"pilot-local",creatorId:"creator1",missionId:"mission1",wave:"first" as const,status:"ready" as const};
const gates=PILOT_GATE_IDS.map(id=>({id,status:"PASS" as const,evidenceRef:"review/test.md",verifiedAt:"2030-01-01T00:00:00.000Z"}));
it("requires unique bounded roster and retains wave gate",()=>{
 expect(validatePilotRoster([entry])).toBe(true);expect(validatePilotRoster([entry,entry])).toBe(false);
 expect(validatePilotRoster(Array.from({length:6},(_,n)=>({...entry,creatorId:`c${n}`})))).toBe(false);
 expect(canStartPilot(entry,gates,false)).toBe(true);expect(canStartPilot({...entry,wave:"later"},gates,false)).toBe(false);
 expect(canStartPilot({...entry,wave:"later"},gates,true)).toBe(true);expect(canStartPilot(entry,[],true)).toBe(false);
});
