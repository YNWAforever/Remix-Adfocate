import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Send,
  Building2,
  User,
  Wallet,
  Store,
  Users,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/contact")({
  component: ContactPage,
});

type TabId = "brand" | "creator" | "adfoplace" | "capital" | "partner";

const tabs: { id: TabId; label: string; labelZh: string; icon: typeof Building2 }[] = [
  { id: "brand", label: "Brand Enquiry", labelZh: "品牌查詢", icon: Building2 },
  { id: "creator", label: "Creator Signup", labelZh: "創作者報名", icon: User },
  { id: "adfoplace", label: "Adfoplace Offer", labelZh: "Adfoplace 優惠", icon: Store },
  { id: "capital", label: "Capital Waitlist", labelZh: "資金候補", icon: Wallet },
  { id: "partner", label: "Partner Enquiry", labelZh: "合作查詢", icon: Users },
];

// Which audience path each tab belongs to — drives the two-path toggle context.
const creatorTabs: TabId[] = ["creator", "capital"];

const campaignInterests = [
  "KOL Awareness Campaign",
  "KOC Product Trial",
  "Affiliate Influencer Program",
  "Short-Form Video Sprint",
  "Live Commerce Campaign",
  "Event Creator Coverage",
  "Always-On Creator Program",
  "Adfoplace Offer Launch",
  "Creator Growth Pool Setup",
  "Not sure — need advice",
];

const budgetRanges = ["< HK$30k", "HK$30k–100k", "HK$100k–300k", "HK$300k–500k", "HK$500k+"];

const markets = [
  "Hong Kong",
  "Macau",
  "Taiwan",
  "Greater China",
  "Southeast Asia",
  "Other APAC",
  "Global",
];

const mainCategories = [
  "Beauty",
  "Food",
  "Travel",
  "Fashion",
  "Lifestyle",
  "Wellness",
  "Finance",
  "Parenting",
  "Tech",
  "Other",
];

const selfSelectLevels = [
  "Shopper (L0)",
  "KOC Starter (L1)",
  "Trusted KOC (L2)",
  "Nano Creator (L3)",
  "Micro-Influencer (L4)",
  "Influencer (L5)",
  "Creator Entrepreneur (L6)",
];

const incomeStreams = [
  "Campaign fees",
  "Affiliate commission",
  "UGC content jobs",
  "Live commerce",
  "Product drops",
  "Ambassador retainers",
  "Other",
];


function ContactPage() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  const [activeTab, setActiveTab] = useState<TabId>("brand");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.info(tx("Preview only. Nothing was sent or saved.", "僅供預覽，沒有發送或儲存任何資料。"));
  };

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
  };

  return (
    <div>
      <ContactLayout
        tx={tx}
        activeTab={activeTab}
        switchTab={switchTab}
        handleSubmit={handleSubmit}
      />
    </div>
  );
}

function ContactLayout({
  tx,
  activeTab,
  switchTab,
  handleSubmit,
}: {
  tx: (en: string, zh: string) => string;
  activeTab: TabId;
  switchTab: (tab: TabId) => void;
  handleSubmit: (e: React.FormEvent) => void;
}) {
  const isCreatorPath = creatorTabs.includes(activeTab);

  return (
    <section className="relative overflow-hidden dot-pattern">
      {/* soft ambient glows, decorative */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute -top-20 right-[-6rem] w-[460px] h-[460px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(206,26,92,0.10) 0%, transparent 65%)",
          }}
        />
        <div
          className="absolute bottom-[-8rem] -left-32 w-[420px] h-[420px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(0,229,255,0.12) 0%, transparent 65%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-10 pb-16 sm:pt-20 sm:pb-24">
        {/* ── HERO: off-grid editorial (text lower-left, artifact upper-right) ── */}
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-8 items-end mb-12 sm:mb-16">
          {/* artifact comes FIRST on desktop's right column via order, text anchors bottom-left */}
          <div className="lg:col-span-7 lg:pb-2 order-2 lg:order-1">
            <span className="sticker">{tx("Say hi", "傾偈")}</span>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[4.25rem] leading-[1.02] mt-5 mb-5 max-w-2xl">
              {tx("Let's talk about", "傾下你嘅")}
              <br />
              {tx("your next move", "下一步")}
              <span className="text-[var(--color-magenta)]">.</span>
            </h1>
            <p className="font-body text-[var(--color-soft-ink)] text-base sm:text-lg max-w-xl leading-relaxed">
              {tx(
                "Preview the enquiry fields below. This form does not send or save information; a receiving destination has not been enabled.",
                "以下查詢欄位僅供預覽，不會發送或儲存資料；收件渠道尚未啟用。",
              )}
            </p>


          </div>

          {/* artifact: a small "routing card" mock built from primitives */}
          <div className="lg:col-span-5 order-1 lg:order-2">
            <RoutingArtifact tx={tx} isCreatorPath={isCreatorPath} />
          </div>
        </div>

        {/* ── Two-path framing line + tab toggle ── */}
        <div className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-soft-ink)] font-bold mb-3">
            {tx("Choose your path", "揀返條路")}
          </p>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={tx("Enquiry type", "查詢類型")}>
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => switchTab(tab.id)}
                  className={cn(
                    "filter-pill gap-1.5",
                    active && "filter-pill-active",
                  )}
                >
                  <TabIcon className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                  {tx(tab.label, tab.labelZh)}
                </button>
              );
            })}
          </div>

          {/* recipient/context line that adjusts per path */}
          <p className="mt-3 font-body text-sm text-[var(--color-soft-ink)] max-w-xl">
            {isCreatorPath
              ? tx(
                  "Creator enquiry preview — no message is sent.",
                  "創作者查詢預覽 —— 不會發送訊息。",
                )
              : tx(
                  "Brand and partner enquiry preview — no message is sent.",
                  "品牌及合作查詢預覽 —— 不會發送訊息。",
                )}
          </p>
        </div>

        {/* ── Form / Success card ── */}
        <div className="pastel-card p-6 sm:p-8 lg:p-10 bg-[var(--color-card)]">
          <div hidden={activeTab !== "brand"}><BrandForm tx={tx} onSubmit={handleSubmit} /></div>
          <div hidden={activeTab !== "creator"}><CreatorForm tx={tx} onSubmit={handleSubmit} /></div>
          <div hidden={activeTab !== "adfoplace"}><AdfoplaceForm tx={tx} onSubmit={handleSubmit} /></div>
          <div hidden={activeTab !== "capital"}><CapitalForm tx={tx} onSubmit={handleSubmit} /></div>
          <div hidden={activeTab !== "partner"}><PartnerForm tx={tx} onSubmit={handleSubmit} /></div>
        </div>
      </div>
    </section>
  );
}

/* ── Hero artifact: a routing card mock (pastel-card + tag-mono + level-pill) ── */
function RoutingArtifact({
  tx,
  isCreatorPath,
}: {
  tx: (en: string, zh: string) => string;
  isCreatorPath: boolean;
}) {
  return (
    <div className="pastel-card p-5 sm:p-6 bg-[var(--color-card)] animate-float">
      <div className="flex items-center justify-between mb-4">
        <span className="tag-mono">{tx("Routing", "分流")}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
          {tx("Preview only", "僅供預覽")}
        </span>
      </div>

      <p className="font-display text-2xl leading-tight mb-1">
        {isCreatorPath
          ? tx("Creator desk", "創作者組")
          : tx("Campaign desk", "活動策劃組")}
      </p>
      <p className="font-body text-sm text-[var(--color-soft-ink)] mb-5">
        {isCreatorPath
          ? tx("Onboarding · earnings · levels", "報名 · 收入 · 升級")
          : tx("Planning · creators · reporting", "策劃 · 配對 · 數據")}
      </p>

      {/* level ladder cue, decorative */}
      <div className="flex items-center gap-1.5 mb-5" aria-hidden="true">
        <span className="level-pill level-pill-l0">L0</span>
        <span className="level-pill level-pill-l2">L2</span>
        <span className="level-pill level-pill-l4">L4</span>
        <span className="level-pill level-pill-l6">L6</span>
      </div>

      <div className="flex items-center gap-3 border-t-2 border-dashed border-[var(--color-ink)]/15 pt-4">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-acid)] border-2 border-[var(--color-ink)]">
          <Sparkles className="h-4 w-4 text-[var(--color-ink)]" aria-hidden="true" />
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink)] font-bold leading-tight">
          {tx("No message is routed", "不會轉交訊息")}
        </p>
      </div>
    </div>
  );
}


function FormHeader({
  icon: Icon,
  accent,
  title,
  sub,
}: {
  icon: typeof Building2;
  accent: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2.5">
        <div
          className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)]"
          style={{ background: accent }}
        >
          <Icon className="h-4 w-4 text-[var(--color-ink)]" aria-hidden="true" />
        </div>
        <h2 className="font-display text-xl sm:text-2xl text-[var(--color-ink)]">{title}</h2>
      </div>
      <p className="mt-2 font-body text-sm text-[var(--color-soft-ink)]">{sub}</p>
    </div>
  );
}

function BrandForm({
  tx,
  onSubmit,
}: {
  tx: (en: string, zh: string) => string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    campaignInterest: campaignInterests[0],
    budget: budgetRanges[0],
    market: markets[0],
    message: "",
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <FormHeader
        icon={Building2}
        accent="var(--color-magenta-pop)"
        title={tx("Brand Enquiry", "品牌查詢")}
        sub={tx("Tell us about the campaign you have in mind.", "話我哋知你諗緊嘅活動。")}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tx("Name", "姓名")}>
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder={tx("Your name", "你嘅名")}
          />
        </Field>
        <Field label={tx("Company", "公司")}>
          <Input
            name="company"
            value={form.company}
            onChange={(v) => setForm({ ...form, company: v })}
            required
            placeholder={tx("Your company", "你嘅公司")}
          />
        </Field>
        <Field label={tx("Email", "電郵")}>
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@company.com"
          />
        </Field>
        <Field label={tx("Phone / WhatsApp", "電話 / WhatsApp")}>
          <Input
            name="phone"
            type="tel"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
            placeholder="+852 xxxx xxxx"
          />
        </Field>
        <Field label={tx("Campaign Interest", "活動類型")}>
          <Select
            name="campaignInterest"
            value={form.campaignInterest}
            options={campaignInterests}
            onChange={(v) => setForm({ ...form, campaignInterest: v })}
          />
        </Field>
        <Field label={tx("Budget Range", "預算範圍")}>
          <Select
            name="budget"
            value={form.budget}
            options={budgetRanges}
            onChange={(v) => setForm({ ...form, budget: v })}
          />
        </Field>
        <Field label={tx("Market", "市場")}>
          <Select
            name="market"
            value={form.market}
            options={markets}
            onChange={(v) => setForm({ ...form, market: v })}
          />
        </Field>
      </div>

      <Field label={tx("Message", "訊息")}>
        <Textarea
          name="message"
          value={form.message}
          onChange={(v) => setForm({ ...form, message: v })}
          rows={4}
          placeholder={tx(
            "Tell us about your campaign goals, timeline, and target audience...",
            "講下你嘅活動目標、時間表同目標受眾……",
          )}
        />
      </Field>

      <SubmitButton icon={Send} label={tx("Preview form", "預覽表格")} />
      <PreviewNote tx={tx} />
    </form>
  );
}

function CreatorForm({
  tx,
  onSubmit,
}: {
  tx: (en: string, zh: string) => string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    socialHandle: "",
    mainCategory: mainCategories[0],
    currentLevel: selfSelectLevels[0],
    interests: {
      missions: false,
      offers: false,
      academy: false,
      capitalWaitlist: false,
    },
  });

  const toggleInterest = (key: keyof typeof form.interests) => {
    setForm({ ...form, interests: { ...form.interests, [key]: !form.interests[key] } });
  };

  const interestLabels: {
    key: keyof typeof form.interests;
    label: string;
    labelZh: string;
    emoji: string;
  }[] = [
    { key: "missions", label: "Missions", labelZh: "任務", emoji: "🎯" },
    { key: "offers", label: "Adfoplace Offers", labelZh: "Adfoplace 優惠", emoji: "🛍️" },
    { key: "academy", label: "Academy & Resources", labelZh: "學院同資源", emoji: "📚" },
    { key: "capitalWaitlist", label: "Capital Waitlist", labelZh: "資金候補", emoji: "🏦" },
  ];

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <FormHeader
        icon={User}
        accent="var(--color-acid)"
        title={tx("Creator Signup", "創作者報名")}
        sub={tx("Start earning — tell us who you are.", "開始賺錢 —— 介紹下你自己。")}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tx("Name", "姓名")}>
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder={tx("Your name", "你嘅名")}
          />
        </Field>
        <Field label={tx("Email", "電郵")}>
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@email.com"
          />
        </Field>
        <Field label={tx("Phone / WhatsApp", "電話 / WhatsApp")}>
          <Input
            name="phone"
            type="tel"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
            placeholder="+852 xxxx xxxx"
          />
        </Field>
        <Field label={tx("Social Handle", "社交帳號")}>
          <Input
            name="socialHandle"
            value={form.socialHandle}
            onChange={(v) => setForm({ ...form, socialHandle: v })}
            placeholder="@yourhandle"
          />
        </Field>
        <Field label={tx("Main Category", "主要範疇")}>
          <Select
            name="mainCategory"
            value={form.mainCategory}
            options={mainCategories}
            onChange={(v) => setForm({ ...form, mainCategory: v })}
          />
        </Field>
        <Field label={tx("Current Level (Self-Select)", "現時等級（自選）")}>
          <Select
            name="currentLevel"
            value={form.currentLevel}
            options={selfSelectLevels}
            onChange={(v) => setForm({ ...form, currentLevel: v })}
          />
        </Field>
      </div>

      <Field label={tx("I'm interested in", "我有興趣")}>
        <div className="flex flex-wrap gap-2">
          {interestLabels.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={form.interests[item.key]}
              onClick={() => toggleInterest(item.key)}
              className={cn(
                "filter-pill gap-1.5",
                form.interests[item.key] && "filter-pill-active",
              )}
            >
              {item.emoji} {tx(item.label, item.labelZh)}
            </button>
          ))}
        </div>
      </Field>

      <SubmitButton icon={Sparkles} label={tx("Preview form", "預覽表格")} />
      <PreviewNote tx={tx} />
    </form>
  );
}

function AdfoplaceForm({
  tx,
  onSubmit,
}: {
  tx: (en: string, zh: string) => string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    offerType: "Affiliate",
    message: "",
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <FormHeader
        icon={Store}
        accent="var(--color-cyan)"
        title={tx("List an Adfoplace Offer", "上架 Adfoplace 優惠")}
        sub={tx("Put your offer in front of active creators.", "畀活躍創作者睇到你嘅優惠。")}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tx("Name", "姓名")}>
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder={tx("Your name", "你嘅名")}
          />
        </Field>
        <Field label={tx("Company", "公司")}>
          <Input
            name="company"
            value={form.company}
            onChange={(v) => setForm({ ...form, company: v })}
            required
            placeholder={tx("Brand / company name", "品牌 / 公司名稱")}
          />
        </Field>
        <Field label={tx("Email", "電郵")}>
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@company.com"
          />
        </Field>
        <Field label={tx("Offer Type", "優惠類型")}>
          <Select
            name="offerType"
            value={form.offerType}
            options={[
              "Affiliate",
              "Product Trial",
              "Coupon",
              "UGC Job",
              "Live Shopping",
              "Ambassador",
              "Product Drop",
            ]}
            onChange={(v) => setForm({ ...form, offerType: v })}
          />
        </Field>
      </div>

      <Field label={tx("Message", "訊息")}>
        <Textarea
          name="message"
          value={form.message}
          onChange={(v) => setForm({ ...form, message: v })}
          rows={4}
          placeholder={tx(
            "Describe the offer, reward structure, and creator requirements...",
            "描述優惠內容、獎勵結構同創作者要求……",
          )}
        />
      </Field>

      <SubmitButton icon={Store} label={tx("Preview form", "預覽表格")} />
      <PreviewNote tx={tx} />
    </form>
  );
}

function CapitalForm({
  tx,
  onSubmit,
}: {
  tx: (en: string, zh: string) => string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    creatorHandle: "",
    email: "",
    estimatedMonthlyIncome: "",
    mainIncomeStream: incomeStreams[0],
    reason: "",
    consent: false,
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <FormHeader
        icon={Wallet}
        accent="var(--color-acid)"
        title={tx("Capital Waitlist", "資金候補")}
        sub={tx("Register interest in future creator capital.", "登記對未來創作者資金嘅興趣。")}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tx("Name", "姓名")}>
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder={tx("Your name", "你嘅名")}
          />
        </Field>
        <Field label={tx("Creator Handle", "創作者帳號")}>
          <Input
            name="creatorHandle"
            value={form.creatorHandle}
            onChange={(v) => setForm({ ...form, creatorHandle: v })}
            required
            placeholder="@yourhandle"
          />
        </Field>
        <Field label={tx("Email", "電郵")}>
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@email.com"
          />
        </Field>
        <Field label={tx("Estimated Monthly Income", "估計每月收入")}>
          <Input
            name="estimatedMonthlyIncome"
            value={form.estimatedMonthlyIncome}
            onChange={(v) => setForm({ ...form, estimatedMonthlyIncome: v })}
            placeholder="e.g. HK$5,000"
          />
        </Field>
        <Field label={tx("Main Income Stream", "主要收入來源")}>
          <Select
            name="mainIncomeStream"
            value={form.mainIncomeStream}
            options={incomeStreams}
            onChange={(v) => setForm({ ...form, mainIncomeStream: v })}
          />
        </Field>
      </div>

      <Field
        label={tx(
          "Why are you interested in creator capital?",
          "點解你對創作者資金有興趣？",
        )}
      >
        <Textarea
          name="reason"
          value={form.reason}
          onChange={(v) => setForm({ ...form, reason: v })}
          rows={3}
          placeholder={tx(
            "e.g. Equipment funding, campaign float, business growth...",
            "例如：器材資金、活動周轉、業務增長……",
          )}
        />
      </Field>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={form.consent}
          onChange={(e) => setForm({ ...form, consent: e.target.checked })}
          required
          className="mt-1 h-4 w-4 rounded border-2 border-[var(--color-ink)]/30 text-[var(--color-acid)] focus:ring-[var(--color-acid)] shrink-0"
        />
        <span className="text-xs text-[var(--color-soft-ink)] leading-relaxed">
          {tx(
            "I understand this is a preview waitlist only. Adfocate does not provide financing in this prototype. Any capital or payout advance product would be subject to eligibility, risk assessment, approval, and applicable licensed partner or regulatory arrangements.",
            "我明白呢個只係預覽候補名單。Adfocate 喺呢個原型唔提供任何融資。任何資金或預支產品須視乎資格、風險評估、審批，以及適用嘅持牌夥伴或監管安排。",
          )}
        </span>
      </label>

      <SubmitButton icon={Wallet} label={tx("Preview form", "預覽表格")} />
      <PreviewNote tx={tx} />
    </form>
  );
}

function PartnerForm({
  tx,
  onSubmit,
}: {
  tx: (en: string, zh: string) => string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    partnershipType: "Technology",
    message: "",
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <FormHeader
        icon={Users}
        accent="var(--color-violet)"
        title={tx("Partner Enquiry", "合作查詢")}
        sub={tx("Let's explore building something together.", "一齊傾下點樣合作。")}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tx("Name", "姓名")}>
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder={tx("Your name", "你嘅名")}
          />
        </Field>
        <Field label={tx("Company", "公司")}>
          <Input
            name="company"
            value={form.company}
            onChange={(v) => setForm({ ...form, company: v })}
            required
            placeholder={tx("Your company", "你嘅公司")}
          />
        </Field>
        <Field label={tx("Email", "電郵")}>
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@company.com"
          />
        </Field>
        <Field label={tx("Partnership Type", "合作類型")}>
          <Select
            name="partnershipType"
            value={form.partnershipType}
            options={["Technology", "Agency", "Platform", "Financial Services", "Media", "Other"]}
            onChange={(v) => setForm({ ...form, partnershipType: v })}
          />
        </Field>
      </div>

      <Field label={tx("Message", "訊息")}>
        <Textarea
          name="message"
          value={form.message}
          onChange={(v) => setForm({ ...form, message: v })}
          rows={4}
          placeholder={tx(
            "Tell us about the partnership opportunity...",
            "話我哋知呢個合作機會……",
          )}
        />
      </Field>

      <SubmitButton icon={Send} label={tx("Preview form", "預覽表格")} />
      <PreviewNote tx={tx} />
    </form>
  );
}

function SubmitButton({ icon: Icon, label }: { icon: typeof Send; label: string }) {
  return (
    <button type="submit" className="btn-primary w-full">
      <Icon className="h-4 w-4" aria-hidden="true" /> {label}
    </button>
  );
}

function PreviewNote({ tx }: { tx: (en: string, zh: string) => string }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-soft-ink)]/70 text-center">
      {tx(
        "Preview only. Nothing is sent or saved. Avoid entering sensitive information.",
        "僅供預覽，不會發送或儲存資料，請勿輸入敏感資料。",
      )}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-soft-ink)] font-bold">
        {label}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function Input({
  name,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      name={name}
      type={type}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-11 rounded-full bg-[var(--color-card)] border-2 border-[var(--color-ink)]/15 px-4 text-sm text-[var(--color-ink)] placeholder-[var(--color-soft-ink)]/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--color-magenta)]/30 focus-visible:border-[var(--color-magenta)] transition-[border-color,box-shadow] duration-150"
    />
  );
}

function Select({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-11 rounded-full bg-[var(--color-card)] border-2 border-[var(--color-ink)]/15 px-4 text-sm text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--color-magenta)]/30 focus-visible:border-[var(--color-magenta)] transition-[border-color,box-shadow] duration-150 appearance-none cursor-pointer"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Textarea({
  name,
  value,
  onChange,
  rows,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <textarea
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full rounded-2xl bg-[var(--color-card)] border-2 border-[var(--color-ink)]/15 px-4 py-3 text-sm text-[var(--color-ink)] placeholder-[var(--color-soft-ink)]/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--color-magenta)]/30 focus-visible:border-[var(--color-magenta)] transition-[border-color,box-shadow] duration-150 resize-none"
    />
  );
}
