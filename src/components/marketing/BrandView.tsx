import { Link } from "@tanstack/react-router";
import {
  Megaphone,
  TrendingUp,
  ShieldCheck,
  Camera,
  Repeat,
  ArrowRight,
  Check,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* Small helper: bilingual pick. */
function useTx() {
  const { lang } = useI18n();
  return (en: string, zh: string) => (lang === "en" ? en : zh);
}

/* ───────── Brand hero artifact — CASE RESULT card (fictional brand) ─────────
 * Uses an invented brand name ("AURA") with clearly-illustrative figures so we
 * never imply a real campaign ran for a real trademark. */
export function BrandHeroCard() {
  const tx = useTx();
  const metrics = [
    { label: tx("Views", "觀看數"), value: "1.2M", accent: "+" },
    { label: tx("Engagement", "互動率"), value: "6.4", accent: "%" },
    { label: tx("Conversion", "成交率"), value: "3.1", accent: "%" },
  ];
  return (
    <div className="relative lg:justify-self-end">
      <span
        className="absolute -top-4 left-6 z-10 tag-mono rotate-[-4deg] bg-[var(--color-paper)]"
        aria-hidden="true"
      >
        Case Result
      </span>
      <div className="pastel-card w-full max-w-sm p-7">
        <div className="font-display text-4xl italic font-bold tracking-tight text-[var(--color-ink)]">
          AURA
        </div>
        <div className="mt-8 grid grid-cols-3 gap-5">
          {metrics.map((m) => (
            <div key={m.label}>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-soft-ink)]">
                {m.label}
              </p>
              <p className="mt-2 font-display text-2xl font-bold tracking-tight text-[var(--color-ink)] sm:text-3xl">
                {m.value}
                <span className="text-[var(--color-magenta)]">{m.accent}</span>
              </p>
            </div>
          ))}
        </div>
        <span className="mt-7 inline-flex items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-card)] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink)]">
          {tx("Product unboxing × 42 creators", "產品開箱 × 42 位創作者")}
        </span>
      </div>
      <p className="mt-3 text-right font-mono text-[10px] uppercase tracking-wider text-[var(--color-soft-ink)]">
        {tx("Sample case · figures illustrative", "示範案例・數據僅供說明")}
      </p>
    </div>
  );
}

/* ───────────────────────── Brand · Goals ───────────────────────── */
function GoalsSection() {
  const tx = useTx();
  const goals = [
    {
      icon: Megaphone,
      title: tx("Awareness", "品牌曝光"),
      desc: tx("Get more people to know your brand and product.", "希望更多人認識你的品牌與產品。"),
      tags: tx("KOL,Social reach,Buzz", "KOL,社交曝光,話題").split(","),
    },
    {
      icon: TrendingUp,
      title: tx("Conversion", "銷售轉換"),
      desc: tx("Drive sales and conversion directly.", "想直接帶動銷售同轉換。"),
      tags: tx("Affiliate,Live selling,Promo codes", "聯盟,直播,優惠碼").split(","),
    },
    {
      icon: ShieldCheck,
      title: tx("Trust", "口碑信任"),
      desc: tx("Need authentic reviews to build trust.", "需要真實用戶評價建立信任。"),
      tags: tx("KOC,Reviews,UGC", "KOC,評測,UGC").split(","),
    },
    {
      icon: Camera,
      title: tx("Content", "內容素材"),
      desc: tx("Need a volume of reusable content assets.", "需要大量可再用嘅內容素材。"),
      tags: tx("Short video,Photos,Licensing", "短影音,圖片,授權").split(","),
    },
    {
      icon: Repeat,
      title: tx("Retention", "長期經營"),
      desc: tx("Want an ongoing partnership with creators.", "想長期同創作者夥伴合作。"),
      tags: tx("Always-on,Ambassadors,Community", "常態,大使,社群").split(","),
    },
  ];

  return (
    <section id="goals" className="mx-auto max-w-6xl scroll-mt-32 px-4 py-16 md:py-20">
      <div className="mb-10 max-w-xl">
        <span className="tag-mono">{tx("What do you want to achieve?", "你現在最想達成什麼？")}</span>
        <h2 className="mt-4 font-display text-[var(--color-ink)]">
          {tx("Pick the goal that matters most", "揀你依家最緊要嘅目標")}
        </h2>
        <p className="mt-3 text-[var(--color-soft-ink)]">
          {tx(
            "Different goals match to different creators and plans. Pick one and we suggest the right services below.",
            "唔同目標，配對唔同嘅創作者同方案。揀一個，落面就會建議合用嘅服務。",
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:gap-3">
        {goals.map((g, i) => (
          <div
            key={g.title}
            className={cn("pastel-card flex flex-col p-5", `stagger-${i + 1} animate-slide-up`)}
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-card)]">
              <g.icon className="h-5 w-5 text-[var(--color-ink)]" />
            </span>
            <h3 className="mt-4 font-heading text-lg font-bold text-[var(--color-ink)]">{g.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-soft-ink)]">{g.desc}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {g.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-[var(--color-violet)]/12 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--color-violet)]"
                >
                  {t}
                </span>
              ))}
            </div>
            <a
              href="#services"
              className="mt-4 inline-flex items-center gap-1 font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--color-ink)]"
            >
              {tx("See plans", "睇合用方案")} <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── Brand · Services ───────────────────────── */
function ServicesSection() {
  const tx = useTx();
  const groups = [
    {
      label: tx("Awareness", "曝光"),
      items: [
        {
          name: tx("KOL Awareness Campaign", "KOL 曝光活動"),
          desc: tx("Match multiple KOLs at once to build reach.", "一次媒合多位 KOL，集中衝聲量。"),
        },
        {
          name: tx("Seasonal Content Plan", "節慶主題企劃"),
          desc: tx("Themed content tied to a seasonal window.", "配合檔期做主題化內容企劃。"),
        },
      ],
    },
    {
      label: tx("Conversion", "轉換"),
      items: [
        {
          name: tx("Affiliate Program", "聯盟佣金計劃"),
          desc: tx("Creators earn a cut of every sale they drive.", "按成交分成，創作者同你一齊賺。"),
        },
        {
          name: tx("Live Commerce", "直播帶貨"),
          desc: tx("Pick the right host to sell live on stream.", "揀啱嘅主播做產品導購直播。"),
        },
      ],
    },
    {
      label: tx("Trust", "口碑"),
      items: [
        {
          name: tx("KOC Product Trial", "KOC 產品試用"),
          desc: tx("Authentic trials and reviews that build trust.", "真實用戶試用同評價，建立信任。"),
        },
        {
          name: tx("UGC Collection", "UGC 內容徵集"),
          desc: tx("A volume of real user content, reusable.", "大量真實用戶內容，可再利用。"),
        },
      ],
    },
    {
      label: tx("Retention", "經營"),
      items: [
        {
          name: tx("Brand Ambassador Program", "品牌大使計劃"),
          desc: tx("Long-term endorsement, steady visibility.", "長期代言合作，穩定曝光。"),
        },
        {
          name: tx("Always-On Creator Pool", "常態創作者池"),
          desc: tx("A fixed roster of creators for ongoing work.", "固定一班創作者，長期合作。"),
        },
      ],
    },
  ];

  return (
    <section id="services" className="mx-auto max-w-6xl scroll-mt-32 px-4 py-16 md:py-20">
      <div className="mb-10 max-w-xl">
        <span className="tag-mono">{tx("How can Adfocate help?", "ADFOCATE 可以怎麼幫你？")}</span>
        <h2 className="mt-4 font-display text-[var(--color-ink)]">{tx("8 Service Plans", "8 大服務方案")}</h2>
        <p className="mt-3 text-[var(--color-soft-ink)]">
          {tx(
            "Mapped to four goals, each with two ready-to-run service formats underneath.",
            "對應四大目標，每個目標底下有兩個可即用嘅服務格式。",
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((sg) => (
          <div key={sg.label}>
            <p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-violet)]">
              {sg.label}
            </p>
            <div className="flex flex-col gap-3">
              {sg.items.map((it) => (
                <div key={it.name} className="pastel-card p-4">
                  <p className="font-heading text-[15px] font-bold text-[var(--color-ink)]">{it.name}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-soft-ink)]">{it.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Link to="/contact" className="btn-ink mt-10">
        {tx("Talk about your campaign", "傾你嘅活動")} <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

/* ───────────────────────── Brand · How it works ───────────────────────── */
function BrandHowSection() {
  const tx = useTx();
  const steps = [
    {
      n: "01",
      t: tx("Tell us your brief", "話你知需求"),
      d: tx("Fill in your goal, budget and timeline in 5 minutes.", "填寫目標、預算與檔期，5 分鐘完成。"),
    },
    {
      n: "02",
      t: tx("Get a matched plan", "收到配對方案"),
      d: tx("Adfocate matches the right creators and plan to your goal.", "Adfocate 依你嘅目標配對合適嘅創作者同方案。"),
    },
    {
      n: "03",
      t: tx("Run & settle", "執行同結算"),
      d: tx("We help with delivery, reporting and settlement end to end.", "全程協助溝通交付，成效報告同結算一次搞定。"),
    },
  ];

  return (
    <section id="bhow" className="scroll-mt-32 bg-[var(--color-card)] py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-10 max-w-xl">
          <span className="tag-mono">{tx("Process", "流程")}</span>
          <h2 className="mt-4 font-display text-[var(--color-ink)]">
            {tx("From brief to campaign, in 3 steps.", "從需求到活動，只需要 3 步。")}
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {steps.map((st, i) => (
            <div
              key={st.n}
              className={cn("pastel-card p-6", `stagger-${i + 1} animate-slide-up`)}
            >
              <div className="text-outline-mint font-display text-5xl leading-none text-[var(--color-violet)]">
                {st.n}
              </div>
              <h3 className="mt-5 font-heading text-xl font-bold text-[var(--color-ink)]">{st.t}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-[var(--color-soft-ink)]">{st.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Brand · Comparison ───────────────────────── */
function CompareSection() {
  const tx = useTx();
  const trad = [
    {
      t: tx("Manual creator sourcing", "人手四圍搵創作者"),
      d: tx("Relying on contacts and search — slow and hard to filter.", "靠人脈同搜尋，耗時又難篩選。"),
    },
    {
      t: tx("Repeated negotiation", "議價同溝通反覆"),
      d: tx("Re-negotiating and chasing progress with every creator.", "每個創作者都要重新議價、追進度。"),
    },
    {
      t: tx("Hard to track results", "成效難追蹤"),
      d: tx("No unified data to tell which plan is working.", "冇統一數據，難以判斷邊個方案有效。"),
    },
    {
      t: tx("Messy settlement", "找數同結算繁瑣"),
      d: tx("Reconciling and invoicing each creator one by one.", "逐個創作者對數、開發票。"),
    },
    {
      t: tx("Brand-safety risk", "品牌安全風險"),
      d: tx("Hard to verify a creator's background and record.", "難以核實創作者背景同過往表現。"),
    },
  ];
  const adf = [
    {
      t: tx("Auto-matched creators", "自動配對合適創作者"),
      d: tx("Instant shortlist matched to your goal and budget.", "依目標、預算即時配對名單。"),
    },
    {
      t: tx("One-stop delivery", "一站式溝通同交付"),
      d: tx("Briefing, review and delivery all on the platform.", "任務簡報、審稿、交付都喺平台完成。"),
    },
    {
      t: tx("Live performance dashboard", "即時成效儀表板"),
      d: tx("Views, engagement and conversion at a glance.", "觀看、互動、轉換一目了然。"),
    },
    {
      t: tx("Automated settlement", "自動結算報告"),
      d: tx("Paid out on approval, reports generated automatically.", "任務通過即結算，報告自動生成。"),
    },
    {
      t: tx("Verified creator passports", "已驗證創作者履歷"),
      d: tx("Every creator carries a level and track record.", "每位創作者都有等級同過往表現紀錄。"),
    },
  ];

  return (
    <section id="compare" className="mx-auto max-w-6xl scroll-mt-32 px-4 py-16 md:py-20">
      <div className="mb-10 max-w-2xl">
        <span className="tag-mono">{tx("Comparison", "對比")}</span>
        <h2 className="mt-4 font-display text-[var(--color-ink)]">
          {tx("Traditional sourcing vs. Adfocate", "傳統找 Creator VS Adfocate")}
        </h2>
        <p className="mt-3 text-[var(--color-soft-ink)]">
          {tx("Same job, two ways of doing it.", "同一件事，兩種做法。睇下用 Adfocate 慢咗定快咗。")}
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Traditional */}
        <div className="rounded-[1.5rem] border-2 border-[var(--color-ink)] bg-[var(--color-card)] p-6 sm:p-7">
          <p className="mb-5 font-mono text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-soft-ink)]">
            {tx("Traditional way", "傳統做法")}
          </p>
          <div className="flex flex-col gap-4">
            {trad.map((row) => (
              <div key={row.t} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-soft-ink)] text-[var(--color-soft-ink)]">
                  <X className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-[15px] font-bold text-[var(--color-ink)]">{row.t}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--color-soft-ink)]">{row.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Adfocate */}
        <div className="rounded-[1.5rem] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-6 shadow-[6px_7px_0_0_var(--color-acid)] sm:p-7">
          <p className="mb-5 font-mono text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-ink)]">
            Adfocate
          </p>
          <div className="flex flex-col gap-4">
            {adf.map((row) => (
              <div key={row.t} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] text-[var(--color-ink)]">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-[15px] font-bold text-[var(--color-ink)]">{row.t}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--color-soft-ink)]">{row.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Brand · Dashboard mock ───────────────────────── */
function DashboardSection() {
  const tx = useTx();
  const metrics = [
    { label: tx("Views", "觀看數"), value: "1.2M+", delta: "+18%", color: "#00E5FF" },
    { label: tx("Engagement", "互動率"), value: "6.4%", delta: "+2.1%", color: "#FF3D7F" },
    { label: tx("Clicks", "點擊"), value: "38.4K", delta: "+9%", color: "#D4FF00" },
    { label: tx("Conversions", "轉換"), value: "1,240", delta: "+12%", color: "#7C5CFF" },
    { label: tx("Creators live", "上線創作者"), value: "42", delta: "+6", color: "#00E5FF" },
    { label: tx("Budget used", "已用預算"), value: "68%", delta: "+5%", color: "#FF3D7F" },
    { label: tx("Match score", "平均配對分數"), value: "92%", delta: "+3%", color: "#D4FF00" },
    { label: "ROAS", value: "4.1×", delta: "+0.6", color: "#7C5CFF" },
  ];
  const creators = [
    { lvl: "L4", handle: "@chloe.unbox", type: "KOC", reach: "82K", match: "96%" },
    { lvl: "L3", handle: "@foodie.hk", type: "Nano", reach: "45K", match: "91%" },
    { lvl: "L5", handle: "@beauty.mia", type: "Micro", reach: "210K", match: "88%" },
    { lvl: "L2", handle: "@dailyhk", type: "KOC", reach: "30K", match: "85%" },
  ];

  return (
    <section id="dashboard" className="mx-auto max-w-6xl scroll-mt-32 px-4 py-16 md:py-20">
      <div className="mb-10 max-w-2xl">
        <span className="tag-mono">{tx("Performance", "成效追蹤")}</span>
        <h2 className="mt-4 font-display text-[var(--color-ink)]">Campaign Dashboard</h2>
        <p className="mt-3 text-[var(--color-soft-ink)]">
          {tx(
            "Once a campaign goes live, every number rolls up into one view.",
            "活動上線之後，所有數據即時滙總喺一個畫面，唔使逐個平台搵。",
          )}
        </p>
      </div>

      <div className="overflow-hidden rounded-[1.25rem] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] shadow-[8px_10px_0_0_rgba(10,10,10,0.15)]">
        {/* window bar */}
        <div className="flex items-center justify-between border-b border-[var(--color-paper)]/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-magenta-pop)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#F5C24B]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-cyan)]" />
            <span className="ml-2 font-mono text-xs tracking-wider text-[var(--color-paper)]/70">
              campaign-dashboard — adfocate.app
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-[var(--color-acid)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-acid)]" /> LIVE
          </span>
        </div>

        {/* metrics grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="border-t-[3px] border-r border-[var(--color-paper)]/10 p-4 sm:p-5"
              style={{ borderTopColor: m.color }}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-paper)]/55">
                {m.label}
              </p>
              <p className="mt-2 font-display text-xl font-bold text-[var(--color-paper)] sm:text-2xl">
                {m.value}
              </p>
              <span className="mt-2 inline-block rounded-full bg-[#6EF1C8]/12 px-2 py-0.5 font-mono text-[11px] font-bold text-[#6EF1C8]">
                {m.delta}
              </span>
            </div>
          ))}
        </div>

        {/* creator table */}
        <div className="p-5 sm:p-6">
          <p className="mb-3.5 font-mono text-xs tracking-wider text-[var(--color-paper)]/70">
            {tx("Creators in this campaign", "參與創作者")}
          </p>
          <div className="flex flex-col gap-2">
            {creators.map((c) => (
              <div
                key={c.handle}
                className="flex items-center gap-3 rounded-xl border border-[var(--color-paper)]/10 bg-[var(--color-paper)]/[0.03] px-4 py-3 sm:gap-5"
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-violet)] font-mono text-[11px] font-bold text-[var(--color-paper)]">
                  {c.lvl}
                </span>
                <span className="flex-1 truncate text-sm font-semibold text-[var(--color-paper)]">
                  {c.handle}
                </span>
                <span className="hidden rounded-full border border-[var(--color-paper)]/20 px-2.5 py-0.5 font-mono text-[11px] text-[var(--color-paper)]/70 sm:inline">
                  {c.type}
                </span>
                <span className="hidden font-mono text-[13px] text-[var(--color-paper)]/70 sm:inline">
                  {c.reach}
                </span>
                <span className="font-mono text-xs font-bold text-[#6EF1C8]">{c.match}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Brand · Case studies ───────────────────────── */
function BrandCasesSection() {
  const tx = useTx();
  const cases = [
    {
      tag: tx("Beauty · Skincare", "美妝・保養"),
      name: tx("New-product launch", "新品上市檔期"),
      metric: "42",
      unit: tx("creators", "位創作者"),
      line: tx(
        "Multi-platform content in two weeks to lift new-product buzz.",
        "兩週內完成多平台內容鋪陳，集中拉抬新品聲量。",
      ),
    },
    {
      tag: tx("F&B · Retail", "餐飲・門市"),
      name: tx("Store-visit campaign", "分店探店企劃"),
      metric: "8",
      unit: tx("stores", "間分店"),
      line: tx("Local creators visit stores, driving bookings and footfall.", "在地創作者實地探店，帶動門市預約與到店。"),
    },
    {
      tag: tx("3C · E-commerce", "3C・電商"),
      name: tx("Unboxing & review series", "開箱評測系列"),
      metric: "120+",
      unit: tx("pieces", "則內容"),
      line: tx("Concentrated unboxing content, building reusable assets.", "集中產出開箱內容，累積可再利用的行銷素材。"),
    },
  ];

  return (
    <section id="cases" className="mx-auto max-w-6xl scroll-mt-32 px-4 py-16 md:py-20">
      <div className="mb-10 max-w-2xl">
        <span className="tag-mono">{tx("Case studies", "成功案例")}</span>
        <h2 className="mt-4 font-display text-[var(--color-ink)]">
          {tx("Past work, as it actually ran.", "過往合作，實際跑過的樣子。")}
        </h2>
        <p className="mt-3 text-[var(--color-soft-ink)]">
          {tx(
            "The scale of some past campaigns. Actual results vary by industry, budget and timing.",
            "以下為部分合作案例的執行規模。實際成效因產業、預算與檔期而異。",
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cases.map((c, i) => (
          <div
            key={c.name}
            className={cn("pastel-card flex flex-col gap-3.5 p-6", `stagger-${i + 1} animate-slide-up`)}
          >
            <span className="w-fit rounded-full bg-[var(--color-violet)]/12 px-3 py-1 font-mono text-[11px] font-semibold text-[var(--color-violet)]">
              {c.tag}
            </span>
            <p className="font-heading text-lg font-bold text-[var(--color-ink)]">{c.name}</p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold tracking-tight text-[var(--color-ink)]">
                {c.metric}
              </span>
              <span className="text-sm text-[var(--color-soft-ink)]">{c.unit}</span>
            </div>
            <p className="text-sm leading-relaxed text-[var(--color-soft-ink)]">{c.line}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** All brand-audience homepage sections, in order. */
export function BrandView() {
  return (
    <>
      <GoalsSection />
      <ServicesSection />
      <BrandHowSection />
      <CompareSection />
      <DashboardSection />
      <BrandCasesSection />
      <span id="contact" />
    </>
  );
}
