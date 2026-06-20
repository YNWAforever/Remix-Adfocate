export type Locale = "en" | "zh";

/**
 * One dictionary for both surfaces.
 *  - site.*  / nav.* / hero.* / cta.* / footer.* …  → marketing pages
 *  - common.*                                        → shared (loading, errors, back)
 *  - app.*                                           → the creator app (extracted in 1A-6+)
 * Keys are flat dotted strings. en and zh MUST have identical key sets
 * (enforced by src/lib/i18n.test.ts). Values support {placeholder} interpolation.
 */
export const dict: Record<Locale, Record<string, string>> = {
  en: {
    // ── common ──────────────────────────────────────────────
    "common.loading": "Loading…",
    "common.loadFailed": "Failed to load. Please try again.",
    "common.back": "Back",
    "common.retry": "Retry",
    "common.skipToMain": "Skip to main content",
    "common.mainNav": "Main navigation",
    "common.toggleLang": "Switch language",

    // ── app shell / nav ─────────────────────────────────────
    "app.nav.home": "Home",
    "app.nav.mission": "Missions",
    "app.nav.redemption": "Redeem",
    "app.nav.wallet": "Wallet",
    "app.nav.explore": "Explore",

    // ── 404 ─────────────────────────────────────────────────
    "app.notFound.kicker": "Adfocate",
    "app.notFound.title": "404 — Page not found",
    "app.notFound.body": "This link may have expired or been mistyped.",
    "app.notFound.home": "Back to home",

    // ── app: home ────────────────────────────────────────────
    "app.home.passportAriaLabel": "Creator Passport",
    "app.home.profileAriaLabel": "Profile",
    "app.home.heroTitle": "Earn Points\nRedeem Rewards",
    "app.home.heroBody": "Shop · Complete Missions · Redeem Rewards",
    "app.home.balanceError": "Failed to load points",
    "app.home.matchAriaLabel": "What to do today",
    "app.home.matchCta": "What to do today?",
    "app.home.quickMission": "Missions",
    "app.home.quickWalletHistory": "Points History",
    "app.home.quickExplore": "Explore Rewards",
    "app.home.featuredMissions": "Featured Missions",
    "app.home.missionsError": "Failed to load",

    // ── app: mission ──────────────────────────────────────────
    "app.mission.pageTitle": "Missions",
    "app.mission.loadFailed": "Failed to load",
    "app.mission.emptyCategory": "No missions in this category",
    "app.mission.loadError": "Could not load mission",
    "app.mission.backToList": "Back to list",
    "app.mission.processing": "Processing…",
    "app.mission.applyCta": "Apply for Mission",
    "app.mission.joinCta": "Join Mission",
    "app.mission.submitContent": "Submit Content",
    "app.mission.urlPlaceholder": "Paste your content URLs (one per line)",
    "app.mission.submitting": "Submitting…",
    "app.mission.statusLabel": "Status",
    "app.mission.pointsAwarded": "+{n} pts",
    "app.mission.hooksCta": "Generate Content Ideas",
    "app.mission.cardPoints": "{n} pts",
    "app.mission.statusApplied": "Under Review",
    "app.mission.statusJoined": "In Progress",
    "app.mission.statusApproved": "Approved",
    "app.mission.statusRejected": "Rejected",
    "app.mission.statusExpired": "Expired",
    "app.mission.statusDeclined": "Declined",
    "app.mission.factReward": "Reward",
    "app.mission.factQuota": "Quota",
    "app.mission.factDeadline": "Deadline",
    "app.mission.factEligibility": "Eligibility",
    "app.mission.factRewardValue": "{pts} pts",
    "app.mission.spotsLeft": "{n} spots left",
    "app.mission.spotsFull": "Full",
    "app.mission.noDeadline": "No deadline",
    "app.mission.briefAbout": "About Mission",
    "app.mission.briefDeliverables": "Deliverables",
    "app.mission.briefRequirements": "Requirements",
    "app.mission.briefPlatforms": "Platforms",
    "app.mission.briefEffort": "Estimated Effort",
    "app.mission.briefEmpty": "Details coming soon",
  },
  zh: {
    // ── common ──────────────────────────────────────────────
    "common.loading": "載入中…",
    "common.loadFailed": "載入失敗，請重試",
    "common.back": "返回",
    "common.retry": "重試",
    "common.skipToMain": "跳至主要內容",
    "common.mainNav": "主要導航",
    "common.toggleLang": "切換語言",

    // ── app shell / nav ─────────────────────────────────────
    "app.nav.home": "主頁",
    "app.nav.mission": "任務",
    "app.nav.redemption": "積分兌換",
    "app.nav.wallet": "錢包",
    "app.nav.explore": "探索",

    // ── 404 ─────────────────────────────────────────────────
    "app.notFound.kicker": "Adfocate",
    "app.notFound.title": "404 — 找不到頁面",
    "app.notFound.body": "這個連結可能已失效或輸入錯誤。",
    "app.notFound.home": "回首頁",

    // ── app: home ────────────────────────────────────────────
    "app.home.passportAriaLabel": "創作者護照",
    "app.home.profileAriaLabel": "個人檔案",
    "app.home.heroTitle": "賺取積分\n兌換心儀獎賞",
    "app.home.heroBody": "購物賺積分 · 完成任務 · 兌換獎賞",
    "app.home.balanceError": "積分載入失敗",
    "app.home.matchAriaLabel": "今日整乜好",
    "app.home.matchCta": "今日整乜好？",
    "app.home.quickMission": "限時任務",
    "app.home.quickWalletHistory": "積分記錄",
    "app.home.quickExplore": "探索獎賞",
    "app.home.featuredMissions": "精選任務",
    "app.home.missionsError": "載入失敗",

    // ── app: mission ──────────────────────────────────────────
    "app.mission.pageTitle": "限時任務",
    "app.mission.loadFailed": "載入失敗",
    "app.mission.emptyCategory": "此分類暫無任務",
    "app.mission.loadError": "無法載入任務",
    "app.mission.backToList": "返回列表",
    "app.mission.processing": "處理中…",
    "app.mission.applyCta": "申請任務",
    "app.mission.joinCta": "加入任務",
    "app.mission.submitContent": "提交內容",
    "app.mission.urlPlaceholder": "貼上你的內容連結（每行一條）",
    "app.mission.submitting": "提交中…",
    "app.mission.statusLabel": "狀態",
    "app.mission.pointsAwarded": "+{n} 積分",
    "app.mission.hooksCta": "生成內容靈感",
    "app.mission.cardPoints": "{n} 積分",
    "app.mission.statusApplied": "審批中",
    "app.mission.statusJoined": "進行中",
    "app.mission.statusApproved": "已通過",
    "app.mission.statusRejected": "未通過",
    "app.mission.statusExpired": "已過期",
    "app.mission.statusDeclined": "未獲接受",
    "app.mission.factReward": "獎勵",
    "app.mission.factQuota": "名額",
    "app.mission.factDeadline": "截止",
    "app.mission.factEligibility": "資格",
    "app.mission.factRewardValue": "{pts} 積分",
    "app.mission.spotsLeft": "尚餘 {n} 個",
    "app.mission.spotsFull": "額滿",
    "app.mission.noDeadline": "無截止日期",
    "app.mission.briefAbout": "關於任務",
    "app.mission.briefDeliverables": "交付內容",
    "app.mission.briefRequirements": "注意事項",
    "app.mission.briefPlatforms": "發佈平台",
    "app.mission.briefEffort": "預計投入",
    "app.mission.briefEmpty": "詳情陸續更新",
  },
};
