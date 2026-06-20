import type { ReactNode } from "react";

// ─── MISSIONS ───
export type MissionCategory = "Beauty" | "Food" | "Travel" | "Retail" | "Wellness" | "Finance" | "Events";
export type MissionLevel = "KOC Starter" | "Trusted KOC" | "Nano Creator" | "Micro-Influencer" | "Influencer";

export type Mission = {
  id: string;
  title: string;
  brand: string;
  category: MissionCategory;
  reward: string;
  xp: number;
  spotsFilled: number;
  spotsTotal: number | null;
  deadline: string;
  platforms: string[];
  tasks: string[];
  status: "Live" | "Closing soon" | "Open";
  requiredLevel: MissionLevel;
  unlockBadge: string;
  beginnerFriendly?: boolean;
  levelUp?: boolean;
};

export const missionCards: Mission[] = [
  {
    id: "m1", title: "Skincare Glow Trial", brand: "GlowLab", category: "Beauty",
    reward: "800 pts + product sample", xp: 120, spotsFilled: 42, spotsTotal: 100,
    deadline: "May 30", platforms: ["Instagram", "Xiaohongshu"],
    tasks: ["Try product", "Submit story draft", "Post before/after review"],
    status: "Live", requiredLevel: "KOC Starter", unlockBadge: "Beauty Tester",
  },
  {
    id: "m2", title: "Hidden Menu Food Challenge", brand: "TasteHK", category: "Food",
    reward: "HK$100 coupon + 500 pts", xp: 90, spotsFilled: 18, spotsTotal: 30,
    deadline: "May 22", platforms: ["Reels", "Stories"],
    tasks: ["Visit store", "Upload reel", "Share coupon code"],
    status: "Closing soon", requiredLevel: "KOC Starter", unlockBadge: "Food Explorer",
  },
  {
    id: "m3", title: "Macau One-Day Travel Mission", brand: "MacauGo", category: "Travel",
    reward: "Ticket reward + 1,200 pts", xp: 180, spotsFilled: 10, spotsTotal: 20,
    deadline: "Jun 12", platforms: ["Instagram", "TikTok"],
    tasks: ["Follow itinerary", "Create route guide", "Submit photos"],
    status: "Live", requiredLevel: "Trusted KOC", unlockBadge: "Travel Sharer",
  },
  {
    id: "m4", title: "Affiliate Coupon Race", brand: "ShopMore", category: "Retail",
    reward: "Commission + bonus", xp: 150, spotsFilled: 312, spotsTotal: null,
    deadline: "Rolling", platforms: ["Any social"],
    tasks: ["Create product post", "Use coupon code", "Track conversions"],
    status: "Open", requiredLevel: "Nano Creator", unlockBadge: "Affiliate Starter",
  },
  {
    id: "m5", title: "Live Shopping Host Trial", brand: "LiveStyle", category: "Retail",
    reward: "Host fee + sales bonus", xp: 250, spotsFilled: 3, spotsTotal: 8,
    deadline: "Jun 20", platforms: ["Live social commerce"],
    tasks: ["Host 30-min live", "Showcase 5 products", "Engage Q&A"],
    status: "Live", requiredLevel: "Micro-Influencer", unlockBadge: "Live Host track",
  },
  {
    id: "m6", title: "Wellness Supplement Trial", brand: "VitaPlus", category: "Wellness",
    reward: "Product sample + 900 pts", xp: 100, spotsFilled: 65, spotsTotal: 80,
    deadline: "Jun 02", platforms: ["Instagram"],
    tasks: ["Daily check-in", "Review submission", "Compliant caption"],
    status: "Closing soon", requiredLevel: "KOC Starter", unlockBadge: "Wellness Advocate",
    beginnerFriendly: true,
  },
  {
    id: "m7", title: "Finance Literacy Reels", brand: "MoneyWise", category: "Finance",
    reward: "HK$600 fee + 400 pts", xp: 140, spotsFilled: 4, spotsTotal: 12,
    deadline: "Jun 25", platforms: ["Reels", "Shorts"],
    tasks: ["Pick topic", "Script approval", "Publish 30s reel"],
    status: "Live", requiredLevel: "Nano Creator", unlockBadge: "Finance Creator",
  },
  {
    id: "m8", title: "Brand Pop-up Event Coverage", brand: "CityMall", category: "Events",
    reward: "Event access + 600 pts", xp: 110, spotsFilled: 9, spotsTotal: 15,
    deadline: "Jun 08", platforms: ["Stories", "TikTok"],
    tasks: ["Attend event", "Live stories", "Recap reel"],
    status: "Live", requiredLevel: "Trusted KOC", unlockBadge: "Event Reporter",
  },
  {
    id: "m9", title: "Under HK$100 Food Hunt", brand: "EatSmart", category: "Food",
    reward: "Coupon reward + 400 pts", xp: 80, spotsFilled: 8, spotsTotal: 30,
    deadline: "Jun 18", platforms: ["Reels"],
    tasks: ["Visit hidden gem", "Capture meal", "Tag location"],
    status: "Live", requiredLevel: "KOC Starter", unlockBadge: "Budget Foodie",
    beginnerFriendly: true, levelUp: true,
  },
  {
    id: "m10", title: "Beauty Bundle Affiliate Sprint", brand: "GlamCo", category: "Beauty",
    reward: "12% commission + 600 pts", xp: 160, spotsFilled: 24, spotsTotal: 50,
    deadline: "Jun 30", platforms: ["Instagram", "TikTok"],
    tasks: ["Share affiliate link", "Create demo reel", "Track sales"],
    status: "Live", requiredLevel: "Trusted KOC", unlockBadge: "Beauty Affiliate",
  },
];

// ─── CREATOR LEVELS ───
export type CreatorLevelData = {
  level: string;
  label: string;
  goal: string;
  unlocks: string[];
  xpRequired: number;
  color: string;
  emoji: string;
  incomeExample: string;
};

export const creatorLevels: CreatorLevelData[] = [
  { level: "L0", label: "Shopper", goal: "Discover missions and rewards", unlocks: ["Product trials", "Points", "Coupons"], xpRequired: 0, color: "cream", emoji: "🛒", incomeExample: "Points & coupons" },
  { level: "L1", label: "KOC Starter", goal: "Complete first missions", unlocks: ["Review tasks", "Simple submissions", "Starter badge"], xpRequired: 100, color: "pink", emoji: "🌱", incomeExample: "Points, product samples" },
  { level: "L2", label: "Trusted KOC", goal: "Prove reliability", unlocks: ["Repeat missions", "Better rewards", "Badges"], xpRequired: 500, color: "yellow", emoji: "💬", incomeExample: "HK$200–800 per mission" },
  { level: "L3", label: "Nano Creator", goal: "Build niche and consistency", unlocks: ["Profile insights", "Growth resources", "Affiliate eligibility"], xpRequired: 1200, color: "mint", emoji: "📱", incomeExample: "HK$800–2,500 per campaign" },
  { level: "L4", label: "Micro-Influencer", goal: "Earn from campaigns", unlocks: ["Paid briefs", "Affiliate offers", "Content jobs"], xpRequired: 3000, color: "blue", emoji: "⭐", incomeExample: "HK$2,500–8,000 per campaign" },
  { level: "L5", label: "Influencer", goal: "Build recurring income", unlocks: ["Retainers", "Live commerce", "Brand deals"], xpRequired: 8000, color: "lilac", emoji: "🌟", incomeExample: "HK$8,000–25,000/month" },
  { level: "L6", label: "Creator Entrepreneur", goal: "Build a creator business", unlocks: ["Product drops", "Capital readiness", "Premium support"], xpRequired: 20000, color: "gold", emoji: "🚀", incomeExample: "HK$25,000+/month" },
];

// ─── CREATOR PASSPORT ───
export type CreatorPassport = {
  name: string;
  level: string;
  levelLabel: string;
  xp: number;
  xpNext: number;
  avatar: string;
  categories: string[];
  bio: string;
  socialHandles: { platform: string; handle: string }[];
  completedMissions: number;
  brandFeedback: number;
  badges: string[];
  incomeHistory: string;
  strengths: string[];
  nextActions: string[];
  scores: CreatorScores;
};

export type CreatorScores = {
  influence: number;
  content: number;
  reliability: number;
  brandSafety: number;
  monetization: number;
  growthPotential: number;
  financeReadiness: number;
};

export const mockCreatorPassport: CreatorPassport = {
  name: "Chloe Chan",
  level: "L3",
  levelLabel: "Nano Creator",
  xp: 3840,
  xpNext: 5000,
  avatar: "CC",
  categories: ["Beauty", "Lifestyle", "Food"],
  bio: "Beauty and lifestyle content creator based in Hong Kong. Love sharing honest reviews and daily finds.",
  socialHandles: [
    { platform: "Instagram", handle: "@chloebeautyhk" },
    { platform: "Xiaohongshu", handle: "@chloetan" },
    { platform: "TikTok", handle: "@chloetanhk" },
  ],
  completedMissions: 18,
  brandFeedback: 94,
  badges: ["Beauty Tester", "Food Explorer", "Quick Responder", "30-Day Streak"],
  incomeHistory: "HK$28,450 lifetime",
  strengths: ["Skincare reviews", "Before/after content", "Food storytelling"],
  nextActions: ["Complete 3 more missions", "Get 1 affiliate conversion", "Join Live Shopping prep"],
  scores: {
    influence: 72,
    content: 85,
    reliability: 91,
    brandSafety: 88,
    monetization: 65,
    growthPotential: 78,
    financeReadiness: 68,
  },
};

// ─── SCORE DEFINITIONS ───
export type ScoreDefinition = {
  id: string;
  label: string;
  description: string;
  color: string;
};

export const scoreDefinitions: ScoreDefinition[] = [
  { id: "influence", label: "Influence Score", description: "Reach, engagement, and audience quality across platforms.", color: "brand-pink" },
  { id: "content", label: "Content Score", description: "Quality, creativity, and consistency of your content.", color: "brand-mint" },
  { id: "reliability", label: "Reliability Score", description: "On-time delivery, brief compliance, and brand satisfaction.", color: "brand-blue" },
  { id: "brandSafety", label: "Brand Safety Score", description: "Content appropriateness and risk profile.", color: "brand-lilac" },
  { id: "monetization", label: "Monetization Score", description: "Your income diversity and earning trajectory.", color: "brand-yellow" },
  { id: "growthPotential", label: "Growth Potential", description: "Momentum, niche strength, and audience growth rate.", color: "brand-mint" },
  { id: "financeReadiness", label: "Finance Readiness", description: "Verified earnings, stability, and capital eligibility preview.", color: "brand-pink" },
];

// ─── ADFOPLACE OFFERS ───
export type OfferType = "Affiliate" | "Product Trial" | "Coupon" | "UGC Job" | "Live Shopping" | "Ambassador" | "Product Drop" | "Capital Waitlist";

export type Offer = {
  id: string;
  name: string;
  brand: string;
  category: string;
  type: OfferType;
  reward: string;
  platforms: string[];
  deadline: string;
  requiredLevel: MissionLevel;
  effort: string;
  xp: number;
};

export const offerCards: Offer[] = [
  {
    id: "o1", name: "Beauty Bundle Affiliate Drop", brand: "GlamCo", category: "Beauty",
    type: "Affiliate", reward: "12% commission", platforms: ["Instagram", "TikTok"],
    deadline: "Jun 30", requiredLevel: "Nano Creator", effort: "Medium", xp: 150,
  },
  {
    id: "o2", name: "Weekend Café Coupon Mission", brand: "CaféSpot", category: "Food",
    type: "Coupon", reward: "HK$80 coupon + 300 pts", platforms: ["Reels", "Stories"],
    deadline: "Jun 10", requiredLevel: "KOC Starter", effort: "Low", xp: 80,
  },
  {
    id: "o3", name: "UGC Product Demo Job", brand: "TechStyle", category: "Retail",
    type: "UGC Job", reward: "HK$500 content fee", platforms: ["Instagram", "TikTok"],
    deadline: "Jun 25", requiredLevel: "Trusted KOC", effort: "Medium", xp: 130,
  },
  {
    id: "o4", name: "Live Shopping Host Call", brand: "ShopLive", category: "Retail",
    type: "Live Shopping", reward: "Host fee + sales bonus", platforms: ["Live social commerce"],
    deadline: "Jun 20", requiredLevel: "Micro-Influencer", effort: "High", xp: 250,
  },
  {
    id: "o5", name: "Creator Product Drop Pilot", brand: "CreatorLab", category: "Lifestyle",
    type: "Product Drop", reward: "Revenue share", platforms: ["Instagram", "Adfoplace"],
    deadline: "Jul 15", requiredLevel: "Influencer", effort: "High", xp: 300,
  },
  {
    id: "o6", name: "Travel Essentials Creator Offer", brand: "TravelPro", category: "Travel",
    type: "Product Trial", reward: "Product seeding + affiliate link", platforms: ["Instagram", "Blog"],
    deadline: "Jul 05", requiredLevel: "Nano Creator", effort: "Low", xp: 100,
  },
  {
    id: "o7", name: "Beauty Ambassador (3-Month)", brand: "LuxeBeauty", category: "Beauty",
    type: "Ambassador", reward: "HK$3,500/month + products", platforms: ["Instagram", "Xiaohongshu"],
    deadline: "Jun 28", requiredLevel: "Micro-Influencer", effort: "High", xp: 280,
  },
  {
    id: "o8", name: "Wellness Starter Kit Trial", brand: "PureLife", category: "Wellness",
    type: "Product Trial", reward: "Free sample + 700 pts", platforms: ["Review content"],
    deadline: "Jun 25", requiredLevel: "KOC Starter", effort: "Low", xp: 90,
  },
  {
    id: "o9", name: "Creator Capital Waitlist", brand: "Adfocate Capital", category: "Finance",
    type: "Capital Waitlist", reward: "Eligibility preview", platforms: ["Platform"],
    deadline: "Ongoing", requiredLevel: "Nano Creator", effort: "Low", xp: 0,
  },
];

// ─── WALLET DATA ───
export type WalletData = {
  availableBalance: number;
  pendingPayout: number;
  pendingAffiliate: number;
  pointsBalance: number;
  monthlyIncome: number;
  incomeBreakdown: { label: string; pct: number; color: string }[];
  transactions: { id: string; type: string; amount: number; date: string; status: "Completed" | "Pending" | "Processing" }[];
};

export const mockWallet: WalletData = {
  availableBalance: 3280,
  pendingPayout: 8450,
  pendingAffiliate: 1230,
  pointsBalance: 6200,
  monthlyIncome: 12960,
  incomeBreakdown: [
    { label: "Campaign fees", pct: 52, color: "#FF2EA6" },
    { label: "Affiliate commission", pct: 18, color: "#4D8DFF" },
    { label: "UGC jobs", pct: 14, color: "#7EE6C4" },
    { label: "Live shopping", pct: 10, color: "#B79CFF" },
    { label: "Rewards / points", pct: 6, color: "#FFD84D" },
  ],
  transactions: [
    { id: "t1", type: "Campaign Payout - Skincare Glow", amount: 2800, date: "May 10", status: "Completed" },
    { id: "t2", type: "Affiliate Commission", amount: 480, date: "May 08", status: "Completed" },
    { id: "t3", type: "UGC Content Fee", amount: 500, date: "May 05", status: "Completed" },
    { id: "t4", type: "Campaign Payout - Food Challenge", amount: 8450, date: "May 15", status: "Pending" },
    { id: "t5", type: "Affiliate - Beauty Bundle", amount: 750, date: "May 14", status: "Pending" },
    { id: "t6", type: "Bonus - Quick Responder", amount: 200, date: "May 12", status: "Processing" },
  ],
};

// ─── CAPITAL DATA ───
export type CapitalFactor = {
  label: string;
  status: "Good" | "Strong" | "Developing" | "Early" | "Not assessed";
  color: string;
};

export type CapitalOption = {
  id: string;
  title: string;
  description: string;
  eligibility: string;
  status: "Join waitlist" | "L5+ only" | "Preview";
};

export const capitalFactors: CapitalFactor[] = [
  { label: "Verified earnings history", status: "Good", color: "mint" },
  { label: "Mission completion", status: "Strong", color: "mint" },
  { label: "Brand safety", status: "Strong", color: "mint" },
  { label: "Income stability", status: "Developing", color: "yellow" },
  { label: "Affiliate performance", status: "Early", color: "blue" },
  { label: "Repayment suitability", status: "Not assessed", color: "slate" },
];

export const capitalOptions: CapitalOption[] = [
  {
    id: "c1", title: "Payout Advance Preview",
    description: "Based on approved pending campaign payouts. Get early access to a portion of confirmed earnings.",
    eligibility: "Trusted KOC+ with 3+ approved campaigns",
    status: "Join waitlist",
  },
  {
    id: "c2", title: "Equipment Funding Interest",
    description: "For phone, light, mic, camera, and live gear to improve your content quality.",
    eligibility: "Nano Creator+ with active missions",
    status: "Join waitlist",
  },
  {
    id: "c3", title: "Creator Business Funding",
    description: "For product drops, studio rental, and content production at scale.",
    eligibility: "Influencer+ with 12-month verified history",
    status: "L5+ only",
  },
];

// ─── COPILOT TOOLS ───
export type CopilotTool = {
  id: string;
  title: string;
  description: string;
  icon: string;
  promptLabel: string;
  mockResponse: string;
};

export const copilotTools: CopilotTool[] = [
  {
    id: "profile-coach", title: "Profile Coach", icon: "👤",
    description: "Improve your bio, niche, and creator positioning.",
    promptLabel: "How can I improve my creator profile?",
    mockResponse: "Your beauty and lifestyle niche is strong. Try adding a clear 3-word positioning in your bio (e.g., 'Honest Beauty Reviews | HK Lifestyle | Skincare First'). Pin your best-performing Reel to the top of your grid. Add a Linktree with your Adfoplace offers. Creators with clear bios see 2.3x more brand inquiries.",
  },
  {
    id: "hook-gen", title: "Hook Generator", icon: "🎣",
    description: "Turn a product brief into 5 short-form video hooks.",
    promptLabel: "Generate hooks for a skincare product",
    mockResponse: "1. 'I tested this serum for 30 days — here's what happened'  \n2. 'The skincare product HK girls are gatekeeping'  \n3. 'My mom vs me trying this viral moisturizer'  \n4. 'Dermatologist explains why this ingredient works'  \n5. 'From dull to glass skin in 2 weeks (real results)'",
  },
  {
    id: "script-helper", title: "Script & Caption Helper", icon: "📝",
    description: "Draft captions, reels scripts, shot lists, and CTA lines.",
    promptLabel: "Write a caption for a food review",
    mockResponse: "📍 Hidden gem in Mong Kok!  \nThis unassuming café serves the creamiest hojicha latte I've had in HK. The katsu sando? Crispy, juicy, perfect.  \n💰 HK$88 set lunch  \n⭐ 8.5/10 would return  \nSave this for your next café hop — your friends will thank you.  \n#HKFoodie #CafeHoppingHK #MongKokEats",
  },
  {
    id: "brief-explainer", title: "Brief Explainer", icon: "📋",
    description: "Translate brand briefs into creator-friendly tasks.",
    promptLabel: "Explain this brief: Skincare campaign, 3 deliverables, before/after",
    mockResponse: "Here's your simplified brief:  \n1. Show your skin BEFORE starting (Day 1 selfie, natural light)  \n2. Document your routine for 14 days (at least 3 check-ins)  \n3. Final AFTER reveal with honest thoughts  \nMust mention: brand name, key ingredient, #AdfocatePartner  \nAvoid: medical claims, comparison with other brands",
  },
  {
    id: "mission-match", title: "Mission Match", icon: "🎯",
    description: "Recommend missions based on your level and category.",
    promptLabel: "Which missions should I apply for?",
    mockResponse: "Based on your L3 Nano Creator profile (Beauty, Lifestyle):  \n🎯 Top pick: Beauty Bundle Affiliate (12% commission, 150 XP)  \n💄 Good fit: Skincare Glow Trial (800 pts, Beauty Tester badge)  \n📈 Stretch goal: Live Shopping Host Trial (prep in Academy first)  \nYour beauty reels have 2.4x higher saves — lean into that!",
  },
  {
    id: "content-check", title: "Content Pre-Check", icon: "✅",
    description: "Check mandatories, disclosure, hashtags, claims, and tone.",
    promptLabel: "Check my post for compliance",
    mockResponse: "Content Pre-Check Results:  \n✅ #AdfocatePartner included  \n✅ Product name mentioned correctly  \n⚠️ Add: #Sponsored or paid partnership tag  \n⚠️ Review: 'guarantees clear skin' → use 'helps visibly improve skin texture'  \n✅ No competitor mentions  \n✅ Image quality meets brand guidelines",
  },
  {
    id: "pricing-coach", title: "Pricing Coach", icon: "💵",
    description: "Suggest rate ranges based on level and deliverables.",
    promptLabel: "What should I charge for a Reel + 3 Stories?",
    mockResponse: "For L3 Nano Creator (Beauty niche):  \nReel + 3 Stories package: HK$1,200–2,000  \nFactors: your 85% content quality score, 94% brand satisfaction, 2.4x save rate  \nTip: Package deals (3 posts + 1 Reel) can command HK$2,500–3,500  \nAs you unlock L4 Micro-Influencer, rates increase ~60%",
  },
  {
    id: "affiliate-advisor", title: "Affiliate Growth Advisor", icon: "📈",
    description: "Improve coupon, link, and conversion content.",
    promptLabel: "How do I increase affiliate conversions?",
    mockResponse: "Your affiliate click rate is good but conversion is early-stage.  \nTry:  \n1. Add 'link in bio/story' callout in first 2 seconds  \n2. Use demo-style content (not just product shots)  \n3. Post on weekends — your food content converts better Sat–Sun  \n4. Create urgency: 'limited-time code expires Friday'  \n5. Include the coupon code in your caption AND on-screen text",
  },
  {
    id: "live-prep", title: "Live Shopping Prep", icon: "🎙️",
    description: "Create rundown, offer flow, Q&A, and product sequence.",
    promptLabel: "Prepare me for a 30-min live shopping session",
    mockResponse: "30-Min Live Shopping Rundown:  \n0:00–2:00 — Intro & hook (your personal story with the product)  \n2:00–8:00 — Product demo 1 (show, don't just tell)  \n8:00–10:00 — Offer reveal (coupon code on screen)  \n10:00–18:00 — Product demo 2 + Q&A from comments  \n18:00–22:00 — Bundle deal (both products)  \n22:00–28:00 — Audience Q&A, share your real results  \n28:00–30:00 — Final offer reminder + next live teaser",
  },
  {
    id: "finance-guide", title: "Finance Readiness Guide", icon: "🏦",
    description: "Explain what improves your readiness score.",
    promptLabel: "How do I improve my finance readiness?",
    mockResponse: "Your Finance Readiness Score: 68/100 — Almost Eligible  \nTo improve:  \n1. ✅ Strong: Mission completion & brand safety are solid  \n2. 🔄 Build: Complete 3+ more campaigns for earnings history  \n3. 🔄 Grow: Get your first affiliate conversion  \n4. 📅 Next: Maintain consistent income across 3 months  \n5. 🎯 Target: Score 75+ to access payout advance preview  \nThis is a preview score — not a guarantee of capital access.",
  },
];

// ─── PACKAGES ───
export type PackageCard = {
  id: string;
  title: string;
  bestFor: string;
  deliverables: string[];
  color: string;
};

export const packages: PackageCard[] = [
  { id: "p1", title: "KOL Awareness Campaign", bestFor: "Product launch, brand building, festival campaign", deliverables: ["Creator shortlist", "Brief", "Sponsored posts", "Report"], color: "pink" },
  { id: "p2", title: "Micro-Influencer Campaign", bestFor: "Niche category engagement", deliverables: ["10–50 creators", "Content directions", "Review", "Tracking"], color: "mint" },
  { id: "p3", title: "KOC Product Trial", bestFor: "Authentic user proof and testimonials", deliverables: ["KOC recruitment", "Product seeding", "Feedback", "Testimonial bank"], color: "yellow" },
  { id: "p4", title: "Affiliate Influencer Program", bestFor: "Sales and conversion", deliverables: ["Affiliate setup", "Creator onboarding", "Tracking links", "Payout report"], color: "blue" },
  { id: "p5", title: "Short-Form Video Sprint", bestFor: "TikTok, Reels, Shorts content", deliverables: ["Creator videos", "Hooks", "Captions", "Usage rights"], color: "lilac" },
  { id: "p6", title: "Live Commerce Campaign", bestFor: "Product education and selling", deliverables: ["Host selection", "Script", "Live rundown", "Offer plan"], color: "pink" },
  { id: "p7", title: "Event Creator Coverage", bestFor: "Offline event amplification", deliverables: ["Creator invite", "Event posts", "Recap videos", "Content report"], color: "mint" },
  { id: "p8", title: "Travel Creator Mission", bestFor: "Tourism, hotel, attraction", deliverables: ["Itinerary", "Creator content", "Travel report"], color: "blue" },
  { id: "p9", title: "Always-On Creator Program", bestFor: "Long-term advocacy", deliverables: ["Monthly creators", "Campaign calendar", "Content library", "Dashboard"], color: "lilac" },
  { id: "p10", title: "Creator Intelligence Report", bestFor: "Brands needing learning", deliverables: ["Creator performance", "Audience response", "Trend insights"], color: "yellow" },
  { id: "p11", title: "Creator Growth Pool Setup", bestFor: "Building creator bench", deliverables: ["KOC to micro-influencer pool", "Level-up tracking", "Retention support"], color: "mint" },
  { id: "p12", title: "Adfoplace Offer Launch", bestFor: "Marketplace activation", deliverables: ["Offer setup", "Creator matching", "Performance tracking"], color: "pink" },
];

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
    industry: "Beauty & Personal Care", emoji: "💄", color: "pink",
    levels: ["KOC Starter", "Nano Creator", "Micro-Influencer", "Influencer"],
    ideas: [
      "KOC skincare trial with before-after storytelling",
      "Nano creator tutorial series (5 looks in 5 days)",
      "Micro-influencer affiliate offer (12% commission)",
      "Live shopping bundle promotion",
      "Creator product drop pilot",
      "Mature beauty KOC campaign",
    ],
    creatorAngle: "From product tester to beauty affiliate creator.",
    measurementFocus: "Saves, review sentiment, coupon conversion, repeat creator demand",
  },
  {
    industry: "F&B & Restaurants", emoji: "🍜", color: "yellow",
    levels: ["KOC Starter", "Trusted KOC", "Nano Creator"],
    ideas: [
      "Restaurant opening creator coverage",
      "Hidden menu challenge",
      "Under HK$100 dining series",
      "Weekend café coupon mission",
      "District food trail with map content",
      "Family dining KOC review",
    ],
    creatorAngle: "From food lover to trusted local food guide.",
    measurementFocus: "Store visits, coupon redemption, story engagement, follower growth",
  },
  {
    industry: "Travel & Hospitality", emoji: "✈️", color: "blue",
    levels: ["Trusted KOC", "Nano Creator", "Micro-Influencer"],
    ideas: [
      "Hotel KOC stay review",
      "Macau one-day travel mission",
      "Attraction ticket creator guide",
      "eSIM travel creator campaign",
      "Travel insurance education",
      "Food and culture itinerary challenge",
    ],
    creatorAngle: "From trip sharer to travel content creator.",
    measurementFocus: "Booking inquiries, itinerary saves, UGC quality, destination awareness",
  },
  {
    industry: "Retail & eCommerce", emoji: "🛍️", color: "mint",
    levels: ["KOC Starter", "Trusted KOC", "Nano Creator", "Micro-Influencer"],
    ideas: [
      "Product unboxing wave",
      "Short-form video sprint (10 creators × 3 reels)",
      "Affiliate coupon program",
      "Live shopping campaign",
      "Seasonal gift guide with creator picks",
      "Product comparison series",
    ],
    creatorAngle: "From shopper to shopping content creator and affiliate seller.",
    measurementFocus: "Click-through, coupon usage, affiliate conversion, content library size",
  },
  {
    industry: "Healthcare & Wellness", emoji: "🌿", color: "mint",
    levels: ["KOC Starter", "Trusted KOC", "Nano Creator"],
    ideas: [
      "Supplement KOC trial with check-in content",
      "Fitness challenge (21-day creator journey)",
      "Health check education series",
      "Mental wellness storytelling",
      "Nutrition education reels",
      "Wellness seminar coverage",
    ],
    creatorAngle: "From wellness enthusiast to trusted health content creator.",
    measurementFocus: "Check-in completion, saves, trust signals, education reach",
  },
  {
    industry: "Finance & Insurance", emoji: "💳", color: "lilac",
    levels: ["Nano Creator", "Micro-Influencer", "Influencer"],
    ideas: [
      "Anti-scam education campaign",
      "Insurance literacy short videos",
      "Credit card lifestyle campaign",
      "Travel insurance checklist content",
      "Financial wellness challenge",
      "Plain-language finance FAQ series",
    ],
    creatorAngle: "From everyday consumer to finance literacy creator.",
    measurementFocus: "Education completion, trust uplift, enquiry volume, content saves",
  },
];

// ─── STORIES ───
export type StoryCard = {
  name: string;
  industry: string;
  activation: string;
  color: string;
};

export const storyCards: StoryCard[] = [
  { name: "ETUDE", industry: "Beauty", activation: "Creator beauty looks, KOC product trials, and seasonal launch posts.", color: "pink" },
  { name: "Dairy Farm", industry: "Retail", activation: "Multi-brand retail creator content with category-driven storytelling.", color: "mint" },
  { name: "CLAP for Youth@JC", industry: "Community / Youth", activation: "Youth creator advocacy and community awareness mission.", color: "blue" },
  { name: "KAO", industry: "Personal Care", activation: "KOC product trial and review content for everyday personal care.", color: "yellow" },
  { name: "Covermark", industry: "Beauty", activation: "Premium beauty creator storytelling with editorial-style content.", color: "lilac" },
  { name: "Japan Airlines", industry: "Travel", activation: "Travel creator mission with itinerary content, KOC travel stories, and destination inspiration.", color: "blue" },
  { name: "Acuvue", industry: "Beauty / Personal Care", activation: "Lifestyle creator content blending beauty, fashion, and daily wear stories.", color: "mint" },
  { name: "Moo Beef Café", industry: "F&B", activation: "Food creator tasting mission with menu features and visit reels.", color: "yellow" },
];

// ─── ACADEMY TRACKS ───
export type AcademyTrack = {
  id: string;
  title: string;
  level: string;
  duration: string;
  color: string;
  emoji: string;
};

export const academyTracks: AcademyTrack[] = [
  { id: "a1", title: "KOC Starter Bootcamp", level: "L0–L1", duration: "4 modules", color: "pink", emoji: "🌱" },
  { id: "a2", title: "Product Review Basics", level: "L1+", duration: "3 modules", color: "yellow", emoji: "⭐" },
  { id: "a3", title: "Instagram Reels Growth", level: "L2+", duration: "5 modules", color: "mint", emoji: "📱" },
  { id: "a4", title: "TikTok / Short-Form Hooks", level: "L2+", duration: "4 modules", color: "blue", emoji: "🎬" },
  { id: "a5", title: "Xiaohongshu-Style Content", level: "L2+", duration: "3 modules", color: "pink", emoji: "📕" },
  { id: "a6", title: "Affiliate Monetization", level: "L3+", duration: "4 modules", color: "lilac", emoji: "💰" },
  { id: "a7", title: "Live Commerce Training", level: "L4+", duration: "5 modules", color: "mint", emoji: "🎙️" },
  { id: "a8", title: "Brand Brief & Compliance", level: "L3+", duration: "2 modules", color: "yellow", emoji: "📋" },
  { id: "a9", title: "Creator Finance Basics", level: "L3+", duration: "3 modules", color: "blue", emoji: "🏦" },
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

// ─── BRAND CAMPAIGN BUILDER ───
export const builderGoals = ["Awareness", "Trust & Reviews", "Traffic", "Sales", "Content Library", "Event Buzz"];
export const builderCreatorLevels = ["KOC Starter", "Trusted KOC", "Nano Creator", "Micro-Influencer", "Influencer", "Expert Creator"];
export const builderFormats = ["Product Trial", "Sponsored Content", "Affiliate Offer", "Short-Form Sprint", "Live Shopping", "Event Coverage", "Ambassador Program"];

export type BuilderOutput = {
  creatorMix: string;
  packageName: string;
  deliverables: string[];
  measurement: string;
};

export const builderOutputs: Record<string, Record<string, Record<string, BuilderOutput>>> = {
  Awareness: {
    "KOC Starter": {
      "Product Trial": { creatorMix: "20–50 KOC Starters", packageName: "KOC Product Trial", deliverables: ["Product seeding", "Review posts", "Testimonial bank"], measurement: "Reach, post volume, sentiment" },
      "Sponsored Content": { creatorMix: "10–30 Trusted KOCs", packageName: "KOL Awareness Campaign", deliverables: ["Sponsored posts", "Branded content", "Usage rights"], measurement: "Impressions, engagement rate, brand lift" },
      "Short-Form Sprint": { creatorMix: "5–10 Nano Creators", packageName: "Short-Form Video Sprint", deliverables: ["15–30 short videos", "Trend hooks", "Cross-platform"], measurement: "Views, shares, trend participation" },
    },
    "Micro-Influencer": {
      "Sponsored Content": { creatorMix: "3–5 Micro-Influencers", packageName: "Micro-Influencer Campaign", deliverables: ["Sponsored content", "Niche audience reach", "Quality content"], measurement: "Engagement, audience quality, content saves" },
      "Event Coverage": { creatorMix: "2–5 creators", packageName: "Event Creator Coverage", deliverables: ["Live coverage", "Recap content", "Event amplification"], measurement: "Event mentions, story views, press value" },
    },
  },
  "Trust & Reviews": {
    "KOC Starter": {
      "Product Trial": { creatorMix: "30–100 KOC Starters", packageName: "KOC Product Trial", deliverables: ["Trial kits", "Review content", "UGC library"], measurement: "Review volume, star rating, authentic content" },
    },
    "Trusted KOC": {
      "Product Trial": { creatorMix: "10–30 Trusted KOCs", packageName: "KOC Product Trial", deliverables: ["Seeding", "Detailed reviews", "Before/after"], measurement: "Review depth, trust signals, repeat rate" },
    },
  },
  Sales: {
    "Nano Creator": {
      "Affiliate Offer": { creatorMix: "10–25 Nano Creators", packageName: "Affiliate Influencer Program", deliverables: ["Affiliate links", "Coupon codes", "Conversion content"], measurement: "Click-through, conversion rate, revenue" },
    },
    "Micro-Influencer": {
      "Live Shopping": { creatorMix: "1–3 hosts", packageName: "Live Commerce Campaign", deliverables: ["Live session", "Product demo", "Real-time Q&A"], measurement: "Viewership, sales volume, engagement" },
    },
    "Influencer": {
      "Ambassador Program": { creatorMix: "1–3 Influencers", packageName: "Always-On Creator Program", deliverables: ["Monthly content", "Ambassador assets", "Community building"], measurement: "Sustained traffic, loyalty, brand affinity" },
    },
  },
};

export function getBuilderOutput(goal: string, level: string, format: string): BuilderOutput | null {
  const g = builderOutputs[goal];
  if (!g) return null;
  const l = g[level] || g["KOC Starter"];
  if (!l) return null;
  return l[format] || Object.values(l)[0] || null;
}

// ─── WORKFLOW STEPS ───
export const workflowStepsKOCmax = [
  { step: 1, label: "Apply" },
  { step: 2, label: "Screen" },
  { step: 3, label: "Brief" },
  { step: 4, label: "Receive product" },
  { step: 5, label: "Create content" },
  { step: 6, label: "Submit draft" },
  { step: 7, label: "Validate" },
  { step: 8, label: "Post" },
  { step: 9, label: "Track" },
  { step: 10, label: "Earn + Level Up" },
];

// ─── METRICS ───
export const metrics = [
  "Reach", "Engagement", "Audience Fit", "Content Quality",
  "Workflow Efficiency", "Traffic", "Conversion", "Trust / Sentiment",
  "Creator Performance", "Affiliate Performance", "Brand Safety", "Learning",
];

// ─── PROBLEM / SOLUTION ───
export const problemSolutions: { problem: string; solution: string }[] = [
  { problem: "We choose creators by follower count.", solution: "Match creators by fit, content quality, reliability, category, and objective." },
  { problem: "We cannot manage many KOCs manually.", solution: "Use KOCmax missions for recruitment, briefing, submission, validation, and reporting." },
  { problem: "We cannot prove impact.", solution: "Track links, coupon codes, affiliate results, engagement, and content quality." },
  { problem: "Content approval is messy.", solution: "Use structured validation and mandatory checks." },
  { problem: "We need repeatable creator performance.", solution: "Build always-on creator pools and retain top performers." },
];

// ─── BRAND CREATOR TYPES ───
export type BrandCreatorType = {
  name: string;
  emoji: string;
  desc: string;
};

export const brandCreatorTypes: BrandCreatorType[] = [
  { name: "Celebrity / Macro KOL", emoji: "🌟", desc: "Mass reach and brand prestige." },
  { name: "Mid-Tier Influencer", emoji: "⭐", desc: "Balanced reach and engagement." },
  { name: "Micro-Influencer", emoji: "📱", desc: "Niche audience and strong engagement." },
  { name: "Nano Creator", emoji: "🌱", desc: "Authentic, everyday influence." },
  { name: "KOC", emoji: "💬", desc: "Real customer, real opinions." },
  { name: "Affiliate Creator", emoji: "🏷️", desc: "Drives sales through links and codes." },
  { name: "Short-Form Creator", emoji: "🎬", desc: "Reels and TikTok specialist." },
  { name: "Live Commerce Host", emoji: "🎙️", desc: "Performs live shopping and Q&A." },
  { name: "Expert Creator", emoji: "🎓", desc: "Credentialed category authority." },
  { name: "Community Advocate", emoji: "🤝", desc: "Long-term brand voice in community." },
];

// ─── BRAND DASHBOARD MOCK ───
export const brandDashboardMetrics: { label: string; value: string; change: string; up: boolean }[] = [
  { label: "Reach", value: "284K", change: "+18%", up: true },
  { label: "Engagement", value: "4.8%", change: "+0.6%", up: true },
  { label: "Audience Fit", value: "92%", change: "+3%", up: true },
  { label: "Content Quality", value: "8.4/10", change: "+0.5", up: true },
  { label: "Traffic", value: "12.4K", change: "+22%", up: true },
  { label: "Conversion", value: "3.2%", change: "+0.8%", up: true },
  { label: "Brand Safety", value: "98%", change: "+1%", up: true },
  { label: "Learning", value: "4 insights", change: "+2", up: true },
];

// ─── WORKSPACE INSIGHTS ───
export const workspaceInsights: string[] = [
  "Your skincare reels have 2.4x higher saves than your average post.",
  "Food coupon stories convert better on weekends.",
  "Your revision rate improved from 22% to 8% this month.",
  "Try more product demo hooks to increase affiliate clicks.",
];

// ─── WORKSPACE DASHBOARD ───
export const workspaceDashboardMetrics: { label: string; value: string; color: string }[] = [
  { label: "Active missions", value: "3", color: "pink" },
  { label: "Pending submissions", value: "2", color: "yellow" },
  { label: "Pending earnings", value: "HK$8,450", color: "mint" },
  { label: "Available points", value: "6,200", color: "blue" },
  { label: "Creator Value Index", value: "742", color: "lilac" },
  { label: "Finance readiness", value: "68/100", color: "pink" },
];

// ─── COPILOT SUGGESTED PROMPTS ───
export const copilotPrompts: string[] = [
  "How do I unlock Micro-Influencer?",
  "Improve my caption",
  "Which mission should I apply for?",
  "Am I finance-ready?",
];

// ─── COPILOT DRAWER RESPONSES ───
export const copilotDrawerResponses: Record<string, string> = {
  "How do I unlock Micro-Influencer?": "You're at L3 Nano Creator with 3,840/5,000 XP. Complete 3 more approved missions and get 1 affiliate conversion to unlock L4 Micro-Influencer. Your skincare content is especially strong — focus there!",
  "Improve my caption": "Try this formula: Hook (first line) → Value (what they'll learn) → Personal take → CTA (save/share/comment). Example: 'The HK serum I wish I found sooner — my 30-day results and honest thoughts. Save this if you're skincare-curious.'",
  "Which mission should I apply for?": "Based on your profile: #1 Beauty Bundle Affiliate (150 XP, high commission), #2 Wellness Supplement Trial (100 XP, beginner-friendly), #3 Finance Literacy Reels (140 XP, stretch goal). Your beauty content converts best, so start there.",
  "Am I finance-ready?": "Finance Readiness: 68/100 (Almost Eligible). Your mission completion and brand safety are strong. Build more verified earnings history and complete your first affiliate conversion to reach 75+ and access payout advance preview.",
};

// ─── LEGACY COMPAT EXPORTS ───
export const serviceCards: { title: string; emoji: string; points: string[] }[] = [];
export const personaDoors: { title: string; text: string; cta: string; href: string; emoji: string; color: string }[] = [];
export const featuredCategories = ["Beauty", "Food", "Travel", "Retail", "Wellness", "Finance", "Events"];
export const workflowStepsHome = ["Strategy", "Creator Matching", "Briefing", "Recruitment", "Content Submission", "Validation", "Tracking", "Reporting & Learning"];
export const rewards: { title: string; emoji: string; color: string }[] = [];
export const rewardVault: { title: string; emoji: string }[] = [];
export const creatorTypes: { name: string; emoji: string; desc: string; color: string }[] = [];
export type Step = { label: string; node?: ReactNode };
