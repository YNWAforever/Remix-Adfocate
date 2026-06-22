import type { Locale } from "@/lib/i18n.dict";

type Section = { heading: Record<Locale, string>; body: Record<Locale, string> };
type Doc = {
  title: Record<Locale, string>;
  intro: Record<Locale, string>;
  sections: Section[];
  /** Optional "last updated" stamp shown in the header meta row. */
  updated?: Record<Locale, string>;
  /** Optional contact card at the foot of the document. */
  contact?: { label: Record<Locale, string>; email: string };
  /** Optional highlighted callout rendered after the sections. */
  callout?: { heading: Record<Locale, string>; body: Record<Locale, string> };
};

export const terms: Doc = {
  title: { zh: "條款及細則", en: "Terms & Conditions" },
  intro: {
    zh: "歡迎使用 KOCmax 會員獎賞計劃。使用本計劃即表示您同意以下條款及細則。",
    en: "Welcome to the KOCmax membership rewards programme. By using it you agree to these terms.",
  },
  updated: { zh: "2026年6月", en: "June 2026" },
  contact: {
    label: { zh: "對條款有疑問？", en: "Questions about these terms?" },
    email: "legal@adfocate.hk",
  },
  callout: {
    heading: { zh: "公平使用", en: "Fair use" },
    body: {
      zh: "本計劃以誠信為本。任何濫用、欺詐或試圖操控積分系統的行為，我們保留取消帳戶及沒收積分的權利。",
      en: "This programme runs on good faith. We reserve the right to suspend accounts and void points for any abuse, fraud, or attempt to game the points system.",
    },
  },
  sections: [
    { heading: { zh: "1. 會員資格", en: "1. Membership" }, body: { zh: "會員資格免費，任何年滿18歲之人士均可申請。每人只限擁有一個會員帳戶。", en: "Membership is free for anyone aged 18+. One account per person." } },
    { heading: { zh: "2. 積分賺取", en: "2. Earning points" }, body: { zh: "積分可透過購物消費、完成任務、每日簽到及上傳收據等方式賺取。積分計算方式以系統記錄為準。", en: "Points are earned via purchases, missions, daily check-ins and receipt uploads. System records are final." } },
    { heading: { zh: "3. 積分有效期", en: "3. Point validity" }, body: { zh: "積分有效期為獲得後12個月，逾期積分將自動失效且不予補發。", en: "Points expire 12 months after they are earned and are not reissued." } },
    { heading: { zh: "4. 獎賞兌換", en: "4. Redemption" }, body: { zh: "獎賞一經兌換，恕不退款、退貨或更換。獎賞數量有限，換完即止。", en: "Redeemed rewards are non-refundable and non-exchangeable, while stocks last." } },
    { heading: { zh: "5. 一般條款", en: "5. General" }, body: { zh: "我們保留隨時修改本條款及細則的權利，修改後的條款將於發布後生效。", en: "We may amend these terms at any time; changes take effect on publication." } },
  ],
};

export const privacy: Doc = {
  title: { zh: "私隱政策", en: "Privacy Policy" },
  intro: { zh: "我們重視您的私隱。本政策說明我們如何收集、使用及保護您的個人資料。", en: "We value your privacy. This policy explains how we collect, use and protect your data." },
  updated: { zh: "2026年6月", en: "June 2026" },
  contact: {
    label: { zh: "想行使您的資料權利？", en: "Want to exercise your data rights?" },
    email: "privacy@adfocate.hk",
  },
  callout: {
    heading: { zh: "您的選擇權", en: "Your choices" },
    body: {
      zh: "您可隨時撤回市場推廣同意、要求查閱或刪除您的個人資料。我們會在合理時間內處理您的請求。",
      en: "You can withdraw marketing consent, or request access to or deletion of your data, at any time. We action requests within a reasonable timeframe.",
    },
  },
  sections: [
    { heading: { zh: "1. 資料收集", en: "1. Collection" }, body: { zh: "我們收集您提供的個人資料，包括姓名、聯絡方式及交易記錄，用於提供會員服務。", en: "We collect the data you provide — name, contact details, transactions — to run the programme." } },
    { heading: { zh: "2. 資料使用", en: "2. Use" }, body: { zh: "您的資料用於管理會員帳戶、處理積分及獎賞兌換、發送推廣資訊（經您同意）。", en: "Your data manages your account, points and redemptions, and (with consent) marketing." } },
    { heading: { zh: "3. 資料保護", en: "3. Protection" }, body: { zh: "我們採取合理的保安措施保護您的個人資料，防止未經授權的存取或使用。", en: "We apply reasonable safeguards against unauthorised access or use." } },
    { heading: { zh: "4. 查閱及更正", en: "4. Access & correction" }, body: { zh: "您有權查閱及更正您的個人資料。如有需要，請聯絡我們的客戶服務。", en: "You may access and correct your data — contact customer service if needed." } },
  ],
};

export type { Doc };
