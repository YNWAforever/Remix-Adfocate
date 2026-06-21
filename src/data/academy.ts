// ─── PLAYBOOKS ───
export type Playbook = {
  industry: string;
  emoji: string;
  color: string;
  levels: string[];
  ideas: string[];
  creatorAngle: string;
  measurementFocus: string;
};

export const playbooks: Playbook[] = [
  {
    industry: "美妝護膚", emoji: "💄", color: "pink",
    levels: ["KOC新手", "奈米創作者", "微型KOL", "小型KOL"],
    ideas: [
      "KOC護膚試用配前後對比故事",
      "奈米創作者教學系列（5天5個造型）",
      "微型KOL聯盟優惠（12%佣金）",
      "直播購物套裝推廣",
      "創作者產品上市先行試用",
      "成熟美妝KOC推廣活動",
    ],
    creatorAngle: "由產品試用者成為美妝聯盟創作者。",
    measurementFocus: "收藏數、評論情感分析、優惠券轉換率、創作者重複合作需求",
  },
  {
    industry: "餐飲食肆", emoji: "🍜", color: "yellow",
    levels: ["KOC新手", "受信任KOC", "奈米創作者"],
    ideas: [
      "餐廳開幕創作者報道",
      "隱藏菜單挑戰",
      "百元以下飲食系列",
      "週末咖啡廳優惠任務",
      "地區美食路線配地圖內容",
      "家庭飲食KOC評測",
    ],
    creatorAngle: "由美食愛好者成為受信任的本地飲食指南。",
    measurementFocus: "到店人次、優惠券兌換、限時動態互動、粉絲增長",
  },
  {
    industry: "旅遊及酒店", emoji: "✈️", color: "blue",
    levels: ["受信任KOC", "奈米創作者", "微型KOL"],
    ideas: [
      "酒店KOC住宿評測",
      "澳門一日遊任務",
      "景點門票創作者指南",
      "eSIM旅遊創作者活動",
      "旅遊保險教育內容",
      "飲食文化行程挑戰",
    ],
    creatorAngle: "由旅遊分享者成為旅遊內容創作者。",
    measurementFocus: "訂房查詢、行程收藏、UGC質量、目的地認知度",
  },
  {
    industry: "零售及電商", emoji: "🛍️", color: "mint",
    levels: ["KOC新手", "受信任KOC", "奈米創作者", "微型KOL"],
    ideas: [
      "產品開箱浪潮",
      "短影片衝刺（10位創作者 × 3支Reels）",
      "聯盟優惠券計劃",
      "直播購物活動",
      "節日禮品指南配創作者精選",
      "產品對比系列",
    ],
    creatorAngle: "由購物者成為購物內容創作者及聯盟推廣員。",
    measurementFocus: "點擊率、優惠券使用量、聯盟轉換率、內容庫規模",
  },
  {
    industry: "健康及保健", emoji: "🌿", color: "mint",
    levels: ["KOC新手", "受信任KOC", "奈米創作者"],
    ideas: [
      "保健品KOC試用配打卡內容",
      "健身挑戰（21天創作者旅程）",
      "健康檢查教育系列",
      "心理健康故事分享",
      "營養教育短片",
      "健康講座報道",
    ],
    creatorAngle: "由健康愛好者成為受信任的健康內容創作者。",
    measurementFocus: "打卡完成率、收藏數、信任訊號、教育觸及率",
  },
  {
    industry: "金融及保險", emoji: "💳", color: "lilac",
    levels: ["奈米創作者", "微型KOL", "小型KOL"],
    ideas: [
      "防騙教育活動",
      "保險普及短片",
      "信用卡生活方式活動",
      "旅遊保險清單內容",
      "理財健康挑戰",
      "淺白金融FAQ系列",
    ],
    creatorAngle: "由日常消費者成為金融知識創作者。",
    measurementFocus: "教育完成率、信任度提升、查詢量、內容收藏數",
  },
];

// ─── ACADEMY TRACKS ───
export type AcademyTrack = {
  id: string;
  title: string;
  /** Display label shown on the card, e.g. "L2+". Keep for UI. */
  level: string;
  /** Canonical LEVELS id gate, e.g. "L2". Used for unlock checks. */
  requiredLevel: string;
  duration: string;
  color: string;
  emoji: string;
  /** Short zh-HK description shown on the card and detail view. */
  description: string;
  /** i18n key for the locked-state teaser copy. */
  teaserKey: string;
};

export const academyTracks: AcademyTrack[] = [
  {
    id: "a1",
    title: "KOC新手訓練營",
    level: "L0–L1",
    requiredLevel: "L0",
    duration: "4堂課",
    color: "pink",
    emoji: "🌱",
    description: "由零開始了解KOC任務流程、賺取積分及建立個人品牌的基礎課程。",
    teaserKey: "app.guide.teaser.a1",
  },
  {
    id: "a2",
    title: "產品評測基礎",
    level: "L1+",
    requiredLevel: "L1",
    duration: "3堂課",
    color: "yellow",
    emoji: "⭐",
    description: "學習撰寫真實有說服力的產品評測，提升品牌信任及任務評分。",
    teaserKey: "app.guide.teaser.a2",
  },
  {
    id: "a3",
    title: "Instagram Reels 增長術",
    level: "L2+",
    requiredLevel: "L2",
    duration: "5堂課",
    color: "mint",
    emoji: "📱",
    description: "掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。",
    teaserKey: "app.guide.teaser.a3",
  },
  {
    id: "a4",
    title: "TikTok短片Hook技巧",
    level: "L2+",
    requiredLevel: "L2",
    duration: "4堂課",
    color: "blue",
    emoji: "🎬",
    description: "設計令人停止滑動的開場Hook，打造高留存率的短影片內容。",
    teaserKey: "app.guide.teaser.a4",
  },
  {
    id: "a5",
    title: "小紅書式內容創作",
    level: "L2+",
    requiredLevel: "L2",
    duration: "3堂課",
    color: "pink",
    emoji: "📕",
    description: "學習小紅書的圖文排版、種草文案及標籤策略，打入內地及港人市場。",
    teaserKey: "app.guide.teaser.a5",
  },
  {
    id: "a6",
    title: "聯盟推廣賺錢術",
    level: "L3+",
    requiredLevel: "L3",
    duration: "4堂課",
    color: "lilac",
    emoji: "💰",
    description: "建立聯盟推廣策略，選對產品、設計轉換內容，實現穩定被動收入。",
    teaserKey: "app.guide.teaser.a6",
  },
  {
    id: "a7",
    title: "直播電商培訓",
    level: "L4+",
    requiredLevel: "L4",
    duration: "5堂課",
    color: "mint",
    emoji: "🎙️",
    description: "直播選品、話術設計及互動技巧全攻略，助你成為直播帶貨達人。",
    teaserKey: "app.guide.teaser.a7",
  },
  {
    id: "a8",
    title: "品牌簡報及合規守則",
    level: "L3+",
    requiredLevel: "L3",
    duration: "2堂課",
    color: "yellow",
    emoji: "📋",
    description: "解讀品牌Brief、了解廣告披露要求，確保內容專業合規。",
    teaserKey: "app.guide.teaser.a8",
  },
  {
    id: "a9",
    title: "創作者財務入門",
    level: "L3+",
    requiredLevel: "L3",
    duration: "3堂課",
    color: "blue",
    emoji: "🏦",
    description: "管理自由工作者收入、稅務基礎及如何與品牌談判合理報酬。",
    teaserKey: "app.guide.teaser.a9",
  },
];

// ─── RESOURCES ───
export type Resource = {
  id: string;
  title: string;
  type: string;
  emoji: string;
};

export const resources: Resource[] = [
  { id: "r1", title: "Caption Templates", type: "Template pack", emoji: "📝" },
  { id: "r2", title: "Hook Formulas", type: "Playbook", emoji: "🎣" },
  { id: "r3", title: "Shot Lists", type: "Checklist", emoji: "📸" },
  { id: "r4", title: "Media Kit Template", type: "Template", emoji: "📁" },
  { id: "r5", title: "Rate Card Guide", type: "Guide", emoji: "💵" },
  { id: "r6", title: "Disclosure Checklist", type: "Checklist", emoji: "✅" },
  { id: "r7", title: "Affiliate Content Playbook", type: "Playbook", emoji: "📈" },
  { id: "r8", title: "Live Shopping Rundown Template", type: "Template", emoji: "🎙️" },
];
