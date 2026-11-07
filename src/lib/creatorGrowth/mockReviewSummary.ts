/** Development-only local inspection artifact. Never accepts provider authority. */
export function createMockReviewSummary(evidence:unknown,decision:unknown):string {
  if(!evidence||typeof evidence!=="object"||(decision!=="verified"&&decision!=="needs_information"))throw new Error("DEMO_SUMMARY_INVALID");
  const e=evidence as Record<string,unknown>;
  if(e.sampleOnly!==true||typeof e.caption!=="string"||!e.caption.trim()||e.caption.length>2200
    ||typeof e.imageSha256!=="string"||! /^[a-f0-9]{64}$/.test(e.imageSha256)
    ||typeof e.mediaId!=="string"||! /^[1-9][0-9]{0,63}$/.test(e.mediaId))throw new Error("DEMO_SUMMARY_INVALID");
  return JSON.stringify({schema:"kocmax.mock-review.v1",sampleOnly:true,awarded:false,
    warning:"SYNTHETIC EXAMPLE ONLY — not official evidence or authorization",decision,
    caption:e.caption,imageSha256:e.imageSha256,mediaId:e.mediaId},null,2)+"\n";
}
