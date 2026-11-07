// @vitest-environment node
import {describe,expect,it} from "vitest";
import {evaluatePilotReadiness,PILOT_GATE_IDS,type PilotGate} from "./readiness.js";
const rows=():PilotGate[]=>PILOT_GATE_IDS.map(id=>({id,status:"PASS",evidenceRef:`review/${id}.md`,verifiedAt:"2026-11-06T00:00:00.000Z"}));
describe("pilot readiness metadata",()=>{
 it("requires complete unique gates",()=>{
  expect(evaluatePilotReadiness(rows().filter(r=>r.id!=="protocol"))).toMatchObject({liveReady:false,blockers:["protocol"]});
  expect(evaluatePilotReadiness([...rows(),rows()[0]])).toMatchObject({offlineReady:false,liveReady:false});
 });
 it.each([null,"", " ","javascript:alert(1)"])("rejects unusable evidence %s",evidenceRef=>{
  const r=rows();r[0]={...r[0],evidenceRef};expect(evaluatePilotReadiness(r).liveReady).toBe(false);
 });
 it.each([null,"not-a-date","2026-02-30T00:00:00.000Z"])("rejects invalid review timestamp %s",verifiedAt=>{
  const r=rows();r[0]={...r[0],verifiedAt};expect(evaluatePilotReadiness(r).liveReady).toBe(false);
 });
 it("separates offline acceptance from live metadata",()=>{
  const r=rows().map(row=>({...row,status:(["persistence","privacy","journeys"].includes(row.id)?"PASS":"NOT_RUN") as PilotGate["status"]}));
  expect(evaluatePilotReadiness(r)).toMatchObject({offlineReady:true,liveReady:false});
  expect(evaluatePilotReadiness(rows())).toEqual({offlineReady:true,liveReady:true,blockers:[],executionAllowed:false});
 });
 it("fails closed on malformed input",()=>{
  for(const value of [null,{},[{id:"extra",status:"PASS"}], [{...rows()[0],status:"READY"}]])expect(evaluatePilotReadiness(value as never)).toMatchObject({offlineReady:false,liveReady:false});
 });
});
