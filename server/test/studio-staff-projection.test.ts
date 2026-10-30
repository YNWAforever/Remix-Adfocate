import { expect, it } from "vitest";
import { projectReviewDetail } from "../lib/studio/staffProjection";
it("keeps reviewer evidence while removing all reward contracts, amounts and financial event payloads", () => {
  const detail = { workflow:{ id:"w",state:"proof_verified" }, submission:{ id:"s",points_awarded:999,cash_awarded:888,creators:{id:"c",display_name:"Amy"},missions:{id:"m",title:"Tea",cash_reward:888,points_reward:999} },workItems:[{id:"i"}],versions:[{id:"v",caption_snapshot:"Public work"}],reviews:[],assets:[],events:[{event_type:"reward.settled",metadata:{cash:888}}],rewardContract:{cashAmount:888},pendingReward:{reward:{cashAmount:888}},completionEligibility:{eligible:true} };
  const result = projectReviewDetail(detail,false);
  expect(JSON.stringify(result)).not.toMatch(/888|999|cash|points_awarded|rewardContract/);
  expect(result.versions).toEqual([{id:"v",caption_snapshot:"Public work"}]);
  expect(projectReviewDetail(detail,true)).toEqual(detail);
});
