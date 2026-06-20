export type ContentLang = "en" | "zh";

export type LocalizedText = {
  en: string;
  zh: string;
};

export type ActivationService = {
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  outcomes: LocalizedText[];
  legacySource: string;
  sourceUrl: string;
  modernHome: "Brands" | "Creators" | "Earn" | "Playbooks";
};

export type LegacyStoryCard = {
  id: string;
  client: string;
  industry: LocalizedText;
  activation: LocalizedText;
  proof: LocalizedText;
  product: LocalizedText;
  year?: string;
  service?: LocalizedText;
  sourceUrl: string;
  color: "pink" | "yellow" | "mint" | "blue" | "lilac";
};

export type LegacyPlaybookTopic = {
  id: string;
  title: LocalizedText;
  industry: LocalizedText;
  summary: LocalizedText;
  takeaways: LocalizedText[];
  format: "Playbook";
  sourceUrl: string;
};

export type LegacyAffiliateStep = {
  id: string;
  step: LocalizedText;
  title: LocalizedText;
  description: LocalizedText;
};

export const legacyContact = {
  email: "business@adfocate.com",
} as const;

export function localized(text: LocalizedText, lang: ContentLang): string {
  return text[lang] || text.en;
}

export const legacyActivationServices: ActivationService[] = [
  {
    id: "kol-influencer",
    title: {
      en: "KOL and influencer campaigns",
      zh: "KOL 及創作者活動",
    },
    summary: {
      en: "Build awareness, launch, and conversion campaigns with matched KOLs, micro-influencers, nano creators, and category voices.",
      zh: "為品牌配對 KOL、微型 Influencer、Nano Creator 及垂直領域創作者，支援品牌曝光、新品上市及轉化活動。",
    },
    outcomes: [
      { en: "Creator shortlist and matching", zh: "創作者篩選及配對" },
      { en: "Sponsored content briefs", zh: "贊助內容 Brief 及活動指引" },
      { en: "Campaign reporting and next-step learning", zh: "活動報告及下一步優化建議" },
    ],
    legacySource: "Adfocate service: Influencer and KOL marketing",
    sourceUrl: "https://www.adfocate.com/our-digital-marketing-service/",
    modernHome: "Brands",
  },
  {
    id: "reels-content",
    title: {
      en: "Reels and content creation",
      zh: "Reels 及內容製作",
    },
    summary: {
      en: "Turn brand messages into short videos, social-first photo assets, captions, and creator-ready content directions.",
      zh: "將品牌訊息轉化為短片、社交平台相片素材、帖文文案及創作者可執行的內容方向。",
    },
    outcomes: [
      { en: "Short-form video concepts", zh: "短片內容概念" },
      { en: "Creator photo and video content", zh: "創作者相片及影片內容" },
      { en: "Usage-ready content library", zh: "可重用內容素材庫" },
    ],
    legacySource: "Adfocate service: Reels and content creation",
    sourceUrl: "https://www.adfocate.com/",
    modernHome: "Brands",
  },
  {
    id: "affiliate",
    title: {
      en: "Affiliate creator programs",
      zh: "Affiliate 創作者計劃",
    },
    summary: {
      en: "Connect creator recommendations to trackable links, coupon codes, marketplace offers, and performance learning.",
      zh: "將創作者推薦連接至可追蹤連結、優惠碼、市集 Offer 及成效學習。",
    },
    outcomes: [
      { en: "Affiliate setup and creator onboarding", zh: "Affiliate 設定及創作者導入" },
      { en: "Link, code, and offer tracking", zh: "連結、優惠碼及 Offer 追蹤" },
      { en: "Performance optimization through analytics", zh: "透過數據優化成效" },
    ],
    legacySource: "Adfocate service: Affiliate marketing and creator programs",
    sourceUrl: "https://www.adfocate.com/influencer/",
    modernHome: "Earn",
  },
  {
    id: "instagram-social",
    title: {
      en: "Instagram and social channel management",
      zh: "Instagram 及社交平台管理",
    },
    summary: {
      en: "Plan always-on content, account maintenance, engagement, and creator collaboration across social channels.",
      zh: "規劃 Instagram 長期內容、帳戶營運、互動管理及創作者協作。",
    },
    outcomes: [
      { en: "Account maintenance", zh: "帳戶日常營運" },
      { en: "Social photo and video content", zh: "社交相片及影片內容" },
      { en: "Creator content calendar", zh: "創作者內容排程" },
    ],
    legacySource: "Adfocate service: Instagram marketing",
    sourceUrl: "https://www.adfocate.com/our-digital-marketing-service/",
    modernHome: "Brands",
  },
  {
    id: "koc-strategy",
    title: {
      en: "KOC marketing strategy",
      zh: "KOC 口碑策略",
    },
    summary: {
      en: "Activate real customers and everyday advocates for product trials, review missions, feedback, and structured brand learning.",
      zh: "啟動真實顧客及日常倡導者，進行產品試用、評測任務、回饋收集及品牌學習。",
    },
    outcomes: [
      { en: "Product trial missions", zh: "產品試用任務" },
      { en: "Authentic customer reviews", zh: "真實用戶評價" },
      { en: "Brand ambassador training", zh: "品牌大使培訓" },
    ],
    legacySource: "Adfocate service: KOC marketing and brand influencer training",
    sourceUrl: "https://www.adfocate.com/",
    modernHome: "Creators",
  },
  {
    id: "live-shopping",
    title: {
      en: "Live shopping campaigns",
      zh: "直播購物活動",
    },
    summary: {
      en: "Prepare creator hosts, scripts, product demos, offer flow, and live Q&A for social commerce campaigns.",
      zh: "為社交商務活動規劃創作者主持、腳本、產品示範、Offer 流程及直播問答。",
    },
    outcomes: [
      { en: "Host selection and rehearsal", zh: "主持配對及綵排" },
      { en: "Live rundown and product sequence", zh: "直播流程及產品排序" },
      { en: "Sales and viewership insights", zh: "銷售及觀看數據洞察" },
    ],
    legacySource: "Adfocate service: Live shopping",
    sourceUrl: "https://www.adfocate.com/",
    modernHome: "Earn",
  },
  {
    id: "event-coverage",
    title: {
      en: "Creator-led event coverage",
      zh: "活動創作者報導",
    },
    summary: {
      en: "Invite creators to launches, pop-ups, seminars, and travel experiences, then turn attendance into social coverage.",
      zh: "邀請創作者參與發布會、Pop-up、講座及旅遊體驗，將現場參與轉化為社交內容。",
    },
    outcomes: [
      { en: "Creator invitations", zh: "創作者邀請" },
      { en: "Live stories and recap videos", zh: "即時 Stories 及活動回顧短片" },
      { en: "Event reach amplification", zh: "活動聲量擴散" },
    ],
    legacySource: "Adfocate event and content coverage",
    sourceUrl: "https://www.adfocate.com/fimmick_taiwan/",
    modernHome: "Brands",
  },
  {
    id: "always-on-pool",
    title: {
      en: "Always-on creator communities",
      zh: "長期創作者社群",
    },
    summary: {
      en: "Build recurring creator relationships that learn from each campaign, improve matching, and support future launches.",
      zh: "建立可持續合作的創作者關係，讓每次活動數據改善配對，支援未來上市及推廣。",
    },
    outcomes: [
      { en: "Creator relationship management", zh: "創作者關係管理" },
      { en: "Retain proven creators", zh: "保留高表現創作者" },
      { en: "Learning loop for brand teams", zh: "品牌團隊學習循環" },
    ],
    legacySource: "Adfocate positioning: connecting influencers, products, and people",
    sourceUrl: "https://www.adfocate.com/",
    modernHome: "Brands",
  },
];

export const legacyAffiliateSteps: LegacyAffiliateStep[] = [
  {
    id: "apply",
    step: { en: "Step 1", zh: "第 1 步" },
    title: { en: "Apply", zh: "申請" },
    description: {
      en: "Creators share their profile, social handles, content categories, and the offers they want to unlock.",
      zh: "創作者先提交個人檔案、社交帳號、內容類別及希望解鎖的 Offer。",
    },
  },
  {
    id: "approve",
    step: { en: "Step 2", zh: "第 2 步" },
    title: { en: "Get approved", zh: "通過審批" },
    description: {
      en: "Adfocate reviews audience fit, engagement quality, reliability, and platform readiness before matching creators with offers.",
      zh: "Adfocate 會按受眾匹配、互動質素、可靠度及平台準備度審核，再配對合適 Offer。",
    },
  },
  {
    id: "create",
    step: { en: "Step 3", zh: "第 3 步" },
    title: { en: "Create", zh: "創作" },
    description: {
      en: "Creators follow the brief, create original content with shoppable links or mission proof, and submit it for validation.",
      zh: "創作者按 Brief 製作原創內容，加入可購物連結或任務證明，並提交審核。",
    },
  },
  {
    id: "earn",
    step: { en: "Step 4", zh: "第 4 步" },
    title: { en: "Earn", zh: "賺取收益" },
    description: {
      en: "Validated posts, clicks, purchases, and campaign outcomes feed rewards, commissions, and creator level progress.",
      zh: "經驗證的帖文、點擊、購買及活動成果，會累積獎勵、佣金及創作者等級進度。",
    },
  },
];

export const legacyStoryCards: LegacyStoryCard[] = [
  {
    id: "etude",
    client: "ETUDE",
    industry: { en: "Beauty", zh: "美妝" },
    activation: {
      en: "Featured in Adfocate's portfolio as an ETUDE beauty case.",
      zh: "Adfocate 過往作品集中列為 ETUDE 美妝案例。",
    },
    proof: {
      en: "Portfolio listing: Beauty.",
      zh: "作品集類別：Beauty。",
    },
    product: { en: "Portfolio category: Beauty", zh: "作品集類別：Beauty" },
    sourceUrl: "https://www.adfocate.com/",
    color: "pink",
  },
  {
    id: "dairy-farm",
    client: "Dairy Farm",
    industry: { en: "Others", zh: "其他" },
    activation: {
      en: "Featured in Adfocate's portfolio as a Dairy Farm case.",
      zh: "Adfocate 過往作品集中列為 Dairy Farm 案例。",
    },
    proof: {
      en: "Portfolio listing: Others.",
      zh: "作品集類別：Others。",
    },
    product: { en: "Portfolio category: Others", zh: "作品集類別：Others" },
    sourceUrl: "https://www.adfocate.com/",
    color: "mint",
  },
  {
    id: "clap-for-youth-jc",
    client: "CLAP for Youth@JC",
    industry: { en: "Others", zh: "其他" },
    activation: {
      en: "Featured in Adfocate's portfolio as a CLAP for Youth@JC case.",
      zh: "Adfocate 過往作品集中列為 CLAP for Youth@JC 案例。",
    },
    proof: {
      en: "Portfolio listing: Others.",
      zh: "作品集類別：Others。",
    },
    product: { en: "Portfolio category: Others", zh: "作品集類別：Others" },
    sourceUrl: "https://www.adfocate.com/",
    color: "blue",
  },
  {
    id: "kao",
    client: "KAO",
    industry: { en: "Personal Care", zh: "個人護理" },
    activation: {
      en: "Featured in Adfocate's portfolio as a KAO personal-care case.",
      zh: "Adfocate 過往作品集中列為 KAO 個人護理案例。",
    },
    proof: {
      en: "Portfolio listing: Personal Care.",
      zh: "作品集類別：Personal Care。",
    },
    product: { en: "Portfolio category: Personal Care", zh: "作品集類別：Personal Care" },
    sourceUrl: "https://www.adfocate.com/",
    color: "yellow",
  },
  {
    id: "covermark",
    client: "Covermark",
    industry: { en: "Beauty / Fashion", zh: "美妝 / 時尚" },
    activation: {
      en: "Featured in Adfocate's portfolio as a Covermark beauty and fashion case.",
      zh: "Adfocate 過往作品集中列為 Covermark 美妝及時尚案例。",
    },
    proof: {
      en: "Portfolio listing: Beauty and Fashion.",
      zh: "作品集類別：Beauty 及 Fashion。",
    },
    product: {
      en: "Portfolio categories: Beauty and Fashion",
      zh: "作品集類別：Beauty 及 Fashion",
    },
    sourceUrl: "https://www.adfocate.com/",
    color: "lilac",
  },
  {
    id: "japan-airlines",
    client: "Japan Airlines",
    industry: { en: "Airline / Travel", zh: "航空 / 旅遊" },
    activation: {
      en: "KOLs shared brand video and dramatic Japan travel images to build destination awareness.",
      zh: "KOL 分享品牌影片及具感染力的日本旅遊相片，以提升目的地及品牌認知。",
    },
    proof: {
      en: "Case study notes that KOLs engaged Japan lovers through brand video sharing and travel images.",
      zh: "案例內容提及 KOL 透過品牌影片及日本旅遊相片吸引日本愛好者。",
    },
    product: { en: "Airlines", zh: "航空" },
    year: "2019",
    service: { en: "Drive Sales and Conversions", zh: "帶動銷售及轉化" },
    sourceUrl: "https://www.adfocate.com/portfolio-item/japan-airlines/",
    color: "blue",
  },
  {
    id: "acuvue",
    client: "Acuvue",
    industry: { en: "Beauty / Fashion / Personal Care", zh: "美妝 / 時尚 / 個人護理" },
    activation: {
      en: "Featured in Adfocate's portfolio as an Acuvue beauty, fashion, and personal-care case.",
      zh: "Adfocate 過往作品集中列為 Acuvue 美妝、時尚及個人護理案例。",
    },
    proof: {
      en: "Portfolio listing: Beauty, Fashion, and Personal Care.",
      zh: "作品集類別：Beauty、Fashion 及 Personal Care。",
    },
    product: {
      en: "Portfolio categories: Beauty, Fashion, and Personal Care",
      zh: "作品集類別：Beauty、Fashion 及 Personal Care",
    },
    sourceUrl: "https://www.adfocate.com/",
    color: "mint",
  },
  {
    id: "moo-beef-cafe",
    client: "Moo Beef Cafe",
    industry: { en: "Food & Beverage", zh: "餐飲" },
    activation: {
      en: "Featured in Adfocate's portfolio as a Moo Beef Cafe food and beverage case.",
      zh: "Adfocate 過往作品集中列為 Moo Beef Cafe 餐飲案例。",
    },
    proof: {
      en: "Portfolio listing: Food & Beverage.",
      zh: "作品集類別：Food & Beverage。",
    },
    product: { en: "Portfolio category: Food & Beverage", zh: "作品集類別：Food & Beverage" },
    sourceUrl: "https://www.adfocate.com/",
    color: "yellow",
  },
];

export const legacyPlaybookTopics: LegacyPlaybookTopic[] = [
  {
    id: "kol-selection",
    title: { en: "How to choose the right KOL for a brand", zh: "如何為品牌選擇合適 KOL" },
    industry: { en: "Influencer Strategy", zh: "Influencer 策略" },
    summary: {
      en: "Turn earlier KOL-selection guidance into a practical matching checklist for audience fit, niche relevance, engagement, and brand safety.",
      zh: "將過往 KOL 選擇文章整理成實用配對清單，涵蓋受眾匹配、垂直領域、互動及品牌安全。",
    },
    takeaways: [
      {
        en: "Check whether the creator audience matches the target customer.",
        zh: "確認創作者受眾是否符合目標顧客。",
      },
      {
        en: "Use follower count as one signal, not the decision rule.",
        zh: "粉絲數只是其中一個訊號，不應成為唯一決策依據。",
      },
      {
        en: "Review category credibility and content tone before briefing.",
        zh: "Briefing 前先審視類別可信度及內容語氣。",
      },
    ],
    format: "Playbook",
    sourceUrl:
      "https://www.adfocate.com/%E5%A6%82%E4%BD%95%E5%9C%A8%E8%8A%B8%E8%8A%B8kol%E4%B9%8B%E4%B8%AD%E6%8F%80%E9%81%B8%E6%9C%80%E5%90%88%E9%81%A9%E5%93%81%E7%89%8C%E7%9A%84%E4%BA%BA%EF%BC%9F/",
  },
  {
    id: "instagram-ranking",
    title: { en: "Instagram ranking signals for creator content", zh: "Instagram 內容排序訊號" },
    industry: { en: "Social Content", zh: "社交內容" },
    summary: {
      en: "Reframe Instagram algorithm articles as a creator checklist for relevance, interaction, freshness, and watchable formats.",
      zh: "將 Instagram 演算法文章整理成創作者清單，涵蓋相關性、互動、新鮮度及易觀看格式。",
    },
    takeaways: [
      {
        en: "Lead with the strongest hook before the feed truncates copy.",
        zh: "在帖文被截斷前放入最吸引的 Hook。",
      },
      {
        en: "Design posts for comments, saves, shares, and repeat viewing.",
        zh: "為留言、收藏、分享及重複觀看而設計內容。",
      },
      {
        en: "Match format to behavior: Reels for discovery, Stories for warm audiences.",
        zh: "按受眾行為選擇格式：Reels 負責觸及新受眾，Stories 面向熟悉受眾。",
      },
    ],
    format: "Playbook",
    sourceUrl:
      "https://www.adfocate.com/instagram-%E6%BC%94%E7%AE%97%E6%B3%95-%E4%B8%8B-6%E5%80%8B%E5%BD%B1%E9%9F%BFinstagram%E5%85%A7%E5%AE%B9%E6%8E%92%E5%BA%8F%E7%9A%84%E5%9B%A0%E7%B4%A0/",
  },
  {
    id: "like-count-shift",
    title: {
      en: "Content quality after public like counts matter less",
      zh: "當公開 Like 數不再主導時的內容質素",
    },
    industry: { en: "Creator Quality", zh: "創作者質素" },
    summary: {
      en: "Use hidden-like-count discussion as a modern reminder to judge creators by fit, content depth, and conversion behavior.",
      zh: "以隱藏 Like 數的討論提醒品牌，應以匹配度、內容深度及轉化行為評估創作者。",
    },
    takeaways: [
      {
        en: "Measure saves, comments, link clicks, and content usefulness.",
        zh: "衡量收藏、留言、連結點擊及內容實用性。",
      },
      {
        en: "Use qualitative review to catch weak but high-like content.",
        zh: "加入質性審視，避免只被高 Like 數牽引。",
      },
      {
        en: "Brief creators to make the first 125 characters count.",
        zh: "提醒創作者善用首 125 個字元吸引用戶。",
      },
    ],
    format: "Playbook",
    sourceUrl:
      "https://www.adfocate.com/instagram%E6%88%96%E6%9C%83%E6%8E%A8%E8%A1%8C%E9%9A%B1%E8%97%8F%E8%AE%9A%E5%A5%BD%E6%95%B8%E9%87%8F%EF%BC%8C%E5%B0%8Dinfluencer%E6%9C%89%E4%BD%95%E5%BD%B1%E9%9F%BF%EF%BC%9F/",
  },
  {
    id: "affiliate-content",
    title: { en: "Affiliate content that can earn", zh: "有機會帶來收入的 Affiliate 內容" },
    industry: { en: "Affiliate", zh: "Affiliate" },
    summary: {
      en: "Turn the affiliate programme into creator guidance for applying, creating original shoppable content, and learning from clicks and purchases.",
      zh: "將 Affiliate 計劃整理成創作者指南，說明申請、製作原創可購物內容，以及從點擊和購買中學習。",
    },
    takeaways: [
      {
        en: "Make the recommendation specific, useful, and easy to act on.",
        zh: "推薦要具體、有用，並讓受眾容易採取行動。",
      },
      {
        en: "Place link, code, and product context close together.",
        zh: "讓連結、優惠碼及產品脈絡出現在同一段受眾旅程中。",
      },
      {
        en: "Review clicks and purchases to improve the next post.",
        zh: "用點擊及購買數據改善下一篇內容。",
      },
    ],
    format: "Playbook",
    sourceUrl: "https://www.adfocate.com/influencer/",
  },
  {
    id: "live-shopping-flow",
    title: { en: "Live shopping campaign flow", zh: "直播購物活動流程" },
    industry: { en: "Live Commerce", zh: "直播商務" },
    summary: {
      en: "Turn live-shopping expertise into a simple planning framework for host fit, product sequence, offer moments, and Q&A.",
      zh: "將直播購物服務整理成簡潔規劃框架，涵蓋主持匹配、產品排序、Offer 節點及問答。",
    },
    takeaways: [
      {
        en: "Pick hosts who can explain products, not only attract views.",
        zh: "選擇能解釋產品的主持，而不只是吸引觀看。",
      },
      {
        en: "Plan product sequence before the live session starts.",
        zh: "直播前先安排好產品順序。",
      },
      {
        en: "Build Q&A and offer reminders into the rundown.",
        zh: "在流程中加入問答及 Offer 提醒。",
      },
    ],
    format: "Playbook",
    sourceUrl: "https://www.adfocate.com/",
  },
];
