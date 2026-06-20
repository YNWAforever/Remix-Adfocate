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
  },
};
