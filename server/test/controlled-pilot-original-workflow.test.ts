import {bindApprovedMission} from "../lib/creatorGrowth/pilot/missionBinding.js";
// @vitest-environment node
import {seedOriginalPilotJourney,OriginalPilotJourney} from "../lib/creatorGrowth/pilot/originalJourney.js";
import {createMockMissionPilot} from "../lib/creatorGrowth/pilot/missionService.js";
import {expect,it} from "vitest";
import {openOriginalWorkflowFixture} from "./helpers/controlled-pilot-original-workflow.js";
it("loads the original workflow and settlement authorities in isolated PostgreSQL",async()=>{const db=await openOriginalWorkflowFixture();try{const rows=await db.query("select proname from pg_proc where proname='settle_mission_reward_handoff'");expect(rows.rows).toHaveLength(1);}finally{await db.close();}},30000);

it("starts from a submitted fixture and approves through original reviewer commands",async()=>{const db=await openOriginalWorkflowFixture();try{const s=await seedOriginalPilotJourney(db,createMockMissionPilot().snapshot());expect(s.approvedVersionId).toBeTruthy();const row=(await db.query("select state from public.mission_work_items where id=$1",[s.workItemId])).rows[0];expect(row).toEqual({state:"approved_to_publish"});}finally{await db.close();}},30000);

it("uses original proof, review, completion and exactly-once settlement for the same task",async()=>{
 const db=await openOriginalWorkflowFixture();try{const pilot=createMockMissionPilot(),s=await seedOriginalPilotJourney(db,pilot.snapshot());const actor={...s.owner,sessionHash:"a".repeat(64)};
 const intent={id:"00000000-0000-4000-8000-000000009999",state:"published",sampleOnly:true,receipt:{mediaId:"55555",sampleOnly:true},owner:s.owner,binding:bindApprovedMission(actor,s)} as unknown as import("../lib/creatorGrowth/publishRepo.js").PublishIntent;
 const journey=new OriginalPilotJourney(db,s,async()=>intent);
 await expect(journey.act("brand_member","review",true)).rejects.toThrow();await expect(journey.act("creator","proof",false)).rejects.toThrow();
 const submitted=await journey.act("creator","proof",true);expect(submitted.item.state).toBe("proof_submitted");expect(submitted.ledger.points).toBe(0);
 await journey.act("creator","proof",true);await journey.act("reviewer","review",true);const pending=await journey.act("operator","completion",true);expect(pending.pending?.status).toBe("pending");expect(pending.ledger.points).toBe(0);
 await expect(journey.act("operator","settlement",true)).rejects.toThrow();await journey.act("workspace_admin","settlement",true);const final=await journey.act("workspace_admin","settlement",true);expect(final.pending?.status).toBe("settled");expect(final.ledger).toEqual({count:1,points:400});expect(final.submissionId).toBe(s.submissionId);expect(actor.creatorId).toBe(s.owner.creatorId);
 }finally{await db.close();}
},30000);
