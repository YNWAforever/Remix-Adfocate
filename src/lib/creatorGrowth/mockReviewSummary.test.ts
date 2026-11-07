// @vitest-environment node
import {describe,expect,it} from "vitest";
import {createMockReviewSummary} from "./mockReviewSummary";
const input={caption:"My sample caption",imageSha256:"a".repeat(64),mediaId:"91000000000000001",sampleOnly:true as const};
describe("local synthetic review summary",()=>{
  it.each(["verified","needs_information"] as const)("exports only explicit fields for %s",decision=>{
    const output=JSON.parse(createMockReviewSummary({...input,ownerKey:"private",nonce:"secret",fingerprint:"secret",url:"https://private.invalid"},decision));
    expect(output).toEqual({schema:"kocmax.mock-review.v1",sampleOnly:true,awarded:false,warning:"SYNTHETIC EXAMPLE ONLY — not official evidence or authorization",decision,caption:input.caption,imageSha256:input.imageSha256,mediaId:input.mediaId});
  });
  it.each([{sampleOnly:false},{imageSha256:"bad"},{mediaId:"https://example.invalid"},{caption:"x".repeat(2201)}])("rejects invalid evidence %j",change=>{
    expect(()=>createMockReviewSummary({...input,...change},"verified")).toThrow("DEMO_SUMMARY_INVALID");
  });
  it("rejects pending and unknown decisions",()=>{for(const decision of ["pending","outcome_unknown",null])expect(()=>createMockReviewSummary(input,decision)).toThrow("DEMO_SUMMARY_INVALID");});
});
