/** Deterministic 5-angle content-hook baseline for the Creator Copilot Hook Generator.
 *  Pure, no I/O. The AI layer (llm.ts enhanceHooks) optionally rewrites these. */

export type HookAngle = "問題式" | "好奇式" | "優惠式" | "體驗式" | "對比式";
export type Hook = { angle: HookAngle; text: string };

export type BuildHooksInput = {
  title: string;
  description: string | null; // carried for the AI layer; unused in the baseline
  category: string | null;
  creatorNiche: string | null;
};

const FALLBACK_CAT = "呢個範疇";
const FALLBACK_PAIN = "揀唔啱嘢";

/** Always returns exactly 5 hooks (one per angle, fixed order). */
export function buildHooks(input: BuildHooksInput): Hook[] {
  const topic = input.title;
  const cat = input.category ?? input.creatorNiche ?? FALLBACK_CAT;
  const catPain = input.category ? `${input.category}揀唔啱` : FALLBACK_PAIN;
  return [
    { angle: "問題式", text: `仲喺度為${catPain}煩緊？「${topic}」可能幫到你` },
    { angle: "好奇式", text: `原來「${topic}」可以咁樣玩，睇到最後你會驚喜` },
    { angle: "優惠式", text: `${cat}控注意⚠️ 今次「${topic}」唔講你蝕底` },
    { angle: "體驗式", text: `我親身試咗「${topic}」，真心話一次過話你知` },
    { angle: "對比式", text: `試完先知，「${topic}」同你平時用嘅差幾遠？` },
  ];
}
