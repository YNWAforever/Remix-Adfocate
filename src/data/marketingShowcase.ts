import type { LocalizedText } from "./legacyAdfocateContent";

// ─── PLAYBOOKS ───
export type Playbook = {
  industry: LocalizedText;
  emoji: string;
  color: string;
  levels: LocalizedText[];
  ideas: string[];
  creatorAngle: LocalizedText;
  measurementFocus: string;
};

// Reusable level-name labels for playbook chips (kept bilingual + DRY).
const LVL = {
  kocStarter: { en: "KOC Starter", zh: "KOC新手" },
  trustedKoc: { en: "Trusted KOC", zh: "受信任KOC" },
  nano: { en: "Nano Creator", zh: "奈米創作者" },
  micro: { en: "Micro-KOL", zh: "微型KOL" },
  small: { en: "Small KOL", zh: "小型KOL" },
} satisfies Record<string, LocalizedText>;

export const playbooks: Playbook[] = [
  {
    industry: { en: "Beauty & Skincare", zh: "美妝護膚" }, emoji: "💄", color: "pink",
    levels: [LVL.kocStarter, LVL.nano, LVL.micro, LVL.small],
    ideas: [
      "KOC護膚試用配前後對比故事",
      "奈米創作者教學系列（5天5個造型）",
      "微型KOL聯盟優惠（12%佣金）",
      "直播購物套裝推廣",
      "創作者產品上市先行試用",
      "成熟美妝KOC推廣活動",
    ],
    creatorAngle: { en: "From product tester to beauty affiliate creator.", zh: "由產品試用者成為美妝聯盟創作者。" },
    measurementFocus: "收藏數、評論情感分析、優惠券轉換率、創作者重複合作需求",
  },
  {
    industry: { en: "Food & Dining", zh: "餐飲食肆" }, emoji: "🍜", color: "yellow",
    levels: [LVL.kocStarter, LVL.trustedKoc, LVL.nano],
    ideas: [
      "餐廳開幕創作者報道",
      "隱藏菜單挑戰",
      "百元以下飲食系列",
      "週末咖啡廳優惠任務",
      "地區美食路線配地圖內容",
      "家庭飲食KOC評測",
    ],
    creatorAngle: { en: "From foodie to trusted local dining guide.", zh: "由美食愛好者成為受信任的本地飲食指南。" },
    measurementFocus: "到店人次、優惠券兌換、限時動態互動、粉絲增長",
  },
  {
    industry: { en: "Travel & Hotels", zh: "旅遊及酒店" }, emoji: "✈️", color: "blue",
    levels: [LVL.trustedKoc, LVL.nano, LVL.micro],
    ideas: [
      "酒店KOC住宿評測",
      "澳門一日遊任務",
      "景點門票創作者指南",
      "eSIM旅遊創作者活動",
      "旅遊保險教育內容",
      "飲食文化行程挑戰",
    ],
    creatorAngle: { en: "From travel sharer to travel content creator.", zh: "由旅遊分享者成為旅遊內容創作者。" },
    measurementFocus: "訂房查詢、行程收藏、UGC質量、目的地認知度",
  },
  {
    industry: { en: "Retail & E-commerce", zh: "零售及電商" }, emoji: "🛍️", color: "mint",
    levels: [LVL.kocStarter, LVL.trustedKoc, LVL.nano, LVL.micro],
    ideas: [
      "產品開箱浪潮",
      "短影片衝刺（10位創作者 × 3支Reels）",
      "聯盟優惠券計劃",
      "直播購物活動",
      "節日禮品指南配創作者精選",
      "產品對比系列",
    ],
    creatorAngle: { en: "From shopper to shopping-content creator and affiliate.", zh: "由購物者成為購物內容創作者及聯盟推廣員。" },
    measurementFocus: "點擊率、優惠券使用量、聯盟轉換率、內容庫規模",
  },
  {
    industry: { en: "Health & Wellness", zh: "健康及保健" }, emoji: "🌿", color: "mint",
    levels: [LVL.kocStarter, LVL.trustedKoc, LVL.nano],
    ideas: [
      "保健品KOC試用配打卡內容",
      "健身挑戰（21天創作者旅程）",
      "健康檢查教育系列",
      "心理健康故事分享",
      "營養教育短片",
      "健康講座報道",
    ],
    creatorAngle: { en: "From wellness enthusiast to trusted health creator.", zh: "由健康愛好者成為受信任的健康內容創作者。" },
    measurementFocus: "打卡完成率、收藏數、信任訊號、教育觸及率",
  },
  {
    industry: { en: "Finance & Insurance", zh: "金融及保險" }, emoji: "💳", color: "lilac",
    levels: [LVL.nano, LVL.micro, LVL.small],
    ideas: [
      "防騙教育活動",
      "保險普及短片",
      "信用卡生活方式活動",
      "旅遊保險清單內容",
      "理財健康挑戰",
      "淺白金融FAQ系列",
    ],
    creatorAngle: { en: "From everyday consumer to financial-literacy creator.", zh: "由日常消費者成為金融知識創作者。" },
    measurementFocus: "教育完成率、信任度提升、查詢量、內容收藏數",
  },
];

// ─── ACADEMY TRACKS ───
export type AcademyTrack = {
  id: string;
  title: LocalizedText;
  /** Display label shown on the card, e.g. "L2+". Language-neutral; keep for UI. */
  level: string;
  /** Canonical LEVELS id gate, e.g. "L2". Used for unlock checks. */
  requiredLevel: string;
  duration: LocalizedText;
  color: string;
  emoji: string;
  /** Short description shown on the card and detail view. */
  description: LocalizedText;
  /** i18n key for the locked-state teaser copy. */
  teaserKey: string;
};

export const academyTracks: AcademyTrack[] = [
  {
    id: "a1",
    title: { en: "KOC Starter Bootcamp", zh: "KOC新手訓練營" },
    level: "L0–L1",
    requiredLevel: "L0",
    duration: { en: "4 lessons", zh: "4堂課" },
    color: "pink",
    emoji: "🌱",
    description: { en: "Start from zero: learn the KOC mission flow, earn points, and build your personal brand.", zh: "由零開始了解KOC任務流程、賺取積分及建立個人品牌的基礎課程。" },
    teaserKey: "app.guide.teaser.a1",
  },
  {
    id: "a2",
    title: { en: "Product Review Basics", zh: "產品評測基礎" },
    level: "L1+",
    requiredLevel: "L1",
    duration: { en: "3 lessons", zh: "3堂課" },
    color: "yellow",
    emoji: "⭐",
    description: { en: "Write authentic, persuasive product reviews that build brand trust and lift your mission ratings.", zh: "學習撰寫真實有說服力的產品評測，提升品牌信任及任務評分。" },
    teaserKey: "app.guide.teaser.a2",
  },
  {
    id: "a3",
    title: { en: "Instagram Reels Growth", zh: "Instagram Reels 增長術" },
    level: "L2+",
    requiredLevel: "L2",
    duration: { en: "5 lessons", zh: "5堂課" },
    color: "mint",
    emoji: "📱",
    description: { en: "Master Reels editing, music selection, and the algorithm to grow your reach fast.", zh: "掌握Reels剪接技巧、音樂選配及演算法攻略，快速擴大曝光率。" },
    teaserKey: "app.guide.teaser.a3",
  },
  {
    id: "a4",
    title: { en: "TikTok Hook Techniques", zh: "TikTok短片Hook技巧" },
    level: "L2+",
    requiredLevel: "L2",
    duration: { en: "4 lessons", zh: "4堂課" },
    color: "blue",
    emoji: "🎬",
    description: { en: "Design scroll-stopping opening hooks and craft short videos with high retention.", zh: "設計令人停止滑動的開場Hook，打造高留存率的短影片內容。" },
    teaserKey: "app.guide.teaser.a4",
  },
  {
    id: "a5",
    title: { en: "RED (Xiaohongshu) Content", zh: "小紅書式內容創作" },
    level: "L2+",
    requiredLevel: "L2",
    duration: { en: "3 lessons", zh: "3堂課" },
    color: "pink",
    emoji: "📕",
    description: { en: "Learn RED's photo-text layout, recommendation copy, and tag strategy to reach mainland and HK audiences.", zh: "學習小紅書的圖文排版、種草文案及標籤策略，打入內地及港人市場。" },
    teaserKey: "app.guide.teaser.a5",
  },
  {
    id: "a6",
    title: { en: "Affiliate Monetization", zh: "聯盟推廣賺錢術" },
    level: "L3+",
    requiredLevel: "L3",
    duration: { en: "4 lessons", zh: "4堂課" },
    color: "lilac",
    emoji: "💰",
    description: { en: "Build an affiliate strategy: pick the right products, design converting content, and earn steady passive income.", zh: "建立聯盟推廣策略，選對產品、設計轉換內容，實現穩定被動收入。" },
    teaserKey: "app.guide.teaser.a6",
  },
  {
    id: "a7",
    title: { en: "Live Commerce Training", zh: "直播電商培訓" },
    level: "L4+",
    requiredLevel: "L4",
    duration: { en: "5 lessons", zh: "5堂課" },
    color: "mint",
    emoji: "🎙️",
    description: { en: "A full guide to live-selling: product picks, scripts, and audience interaction to become a live-commerce pro.", zh: "直播選品、話術設計及互動技巧全攻略，助你成為直播帶貨達人。" },
    teaserKey: "app.guide.teaser.a7",
  },
  {
    id: "a8",
    title: { en: "Brand Briefs & Compliance", zh: "品牌簡報及合規守則" },
    level: "L3+",
    requiredLevel: "L3",
    duration: { en: "2 lessons", zh: "2堂課" },
    color: "yellow",
    emoji: "📋",
    description: { en: "Read brand briefs and understand ad-disclosure rules to keep your content professional and compliant.", zh: "解讀品牌Brief、了解廣告披露要求，確保內容專業合規。" },
    teaserKey: "app.guide.teaser.a8",
  },
  {
    id: "a9",
    title: { en: "Creator Finance 101", zh: "創作者財務入門" },
    level: "L3+",
    requiredLevel: "L3",
    duration: { en: "3 lessons", zh: "3堂課" },
    color: "blue",
    emoji: "🏦",
    description: { en: "Manage freelance income, learn tax basics, and negotiate fair rates with brands.", zh: "管理自由工作者收入、稅務基礎及如何與品牌談判合理報酬。" },
    teaserKey: "app.guide.teaser.a9",
  },
];

// ─── RESOURCES ───
export type Resource = {
  id: string;
  title: LocalizedText;
  type: LocalizedText;
  emoji: string;
};

export const resources: Resource[] = [
  { id: "r1", title: { en: "Caption Templates", zh: "文案範本" }, type: { en: "Template pack", zh: "範本包" }, emoji: "📝" },
  { id: "r2", title: { en: "Hook Formulas", zh: "Hook 公式" }, type: { en: "Playbook", zh: "攻略" }, emoji: "🎣" },
  { id: "r3", title: { en: "Shot Lists", zh: "分鏡清單" }, type: { en: "Checklist", zh: "清單" }, emoji: "📸" },
  { id: "r4", title: { en: "Media Kit Template", zh: "媒體資料包範本" }, type: { en: "Template", zh: "範本" }, emoji: "📁" },
  { id: "r5", title: { en: "Rate Card Guide", zh: "報價表指南" }, type: { en: "Guide", zh: "指南" }, emoji: "💵" },
  { id: "r6", title: { en: "Disclosure Checklist", zh: "披露清單" }, type: { en: "Checklist", zh: "清單" }, emoji: "✅" },
  { id: "r7", title: { en: "Affiliate Content Playbook", zh: "聯盟內容攻略" }, type: { en: "Playbook", zh: "攻略" }, emoji: "📈" },
  { id: "r8", title: { en: "Live Shopping Rundown Template", zh: "直播購物流程範本" }, type: { en: "Template", zh: "範本" }, emoji: "🎙️" },
];
