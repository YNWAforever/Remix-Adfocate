import type { GrowthSkillId } from "../../../src/lib/creatorGrowth/skillManifest.js";

const PUBLISH_OR_SCHEDULE =
  /發佈|发布|發到|上傳到|上載至|排程|排期|自動發|排隊|隊列|佇列|待發|publish(?:ing)?|post\s+to\s+instagram|schedule|\b(?:en)?queu(?:e|ed|eing|ing|es)\b|upload\s+to/i;
const MIXED_VISUAL_REQUEST =
  /(?:圖片|照片|相片|圖像|image|photo|picture).{0,8}(?:同|和|與|及|跟|and|plus).{0,8}(?:貼文|文案|caption|post)|(?:貼文|文案|caption|post).{0,8}(?:同|和|與|及|跟|and|plus).{0,8}(?:圖片|照片|相片|圖像|image|photo|picture)/i;
const IMAGE_TOPIC = /圖片|照片|相片|圖像|image|photo|picture/i;
const IMAGE_INTENT =
  /診斷|分析|睇下|看看|檢視|review|analyse|analyze|評分|構圖|光線|ocr|文字辨識|visual/i;
const POST_TOPIC = /貼文|舊文|動態|貼|post|reel|carousel/i;
const POST_INTENT =
  /檢討|回顧|分析|audit|review|表現|數據|insights?|指標|成效|觸及|讚好|like|留言|分享|收藏/i;
const CAPTION_TOPIC = /caption|文案|標題|開頭|hook|引言|貼文/i;
const CAPTION_INTENT =
  /寫|草擬|改|優化|新|下一篇|write|draft|rewrite|improve|hook|suggest|ideas?/i;
const GROWTH_TOPIC =
  /成長|增長|增粉|互動|觸及|演算法|粉絲|流量|growth|grow|audience|engagement|reach|followers?/i;
const GROWTH_INTENT =
  /下一步|實驗|策略|建議|安排|改善|提升|點樣|如何|\bnext\b|\btest\b|\bstrategy\b|\bplan\b|\bideas?\b/i;

export function routeGrowthQuestion(text: string): GrowthSkillId | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized || PUBLISH_OR_SCHEDULE.test(normalized) || MIXED_VISUAL_REQUEST.test(normalized)) {
    return null;
  }

  const matchesImage = IMAGE_TOPIC.test(normalized) && IMAGE_INTENT.test(normalized);
  const matchesPost = POST_TOPIC.test(normalized) && POST_INTENT.test(normalized);
  const matchesCaption = CAPTION_TOPIC.test(normalized) && CAPTION_INTENT.test(normalized);
  const matchesGrowth = GROWTH_TOPIC.test(normalized) && GROWTH_INTENT.test(normalized);
  const matchCount = [matchesImage, matchesPost, matchesCaption, matchesGrowth].filter(Boolean).length;

  if (matchCount !== 1) {
    return null;
  }
  if (matchesImage) {
    return "image_diagnosis";
  }
  if (matchesPost) {
    return "post_review";
  }
  if (matchesCaption) {
    return "next_caption";
  }
  return matchesGrowth ? "next_growth_step" : null;
}
