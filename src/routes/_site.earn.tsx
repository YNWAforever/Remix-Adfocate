import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { Sprout, useStudioText } from "@/components/studio/StudioPrimitives";

export const Route = createFileRoute("/_site/earn")({
  component: EarnPage,
});

const ENTRY_PRODUCTS = [
  { icon: "🧭", zh: "Adfoplace", en: "Adfoplace", detailZh: "瀏覽公開 Offer、優惠碼、產品試用與直播機會，一鍵申請。", detailEn: "Browse open offers, coupon codes, product drops and live-commerce slots, then apply in one click.", to: "/explore" },
  { icon: "📦", zh: "Packages", en: "Packages", detailZh: "發佈自己的創作方案與價錢，讓品牌直接選購。", detailEn: "Publish your own creator packages and prices so brands can buy directly.", to: "/packages" },
  { icon: "🎬", zh: "Stories", en: "Stories", detailZh: "看看其他創作者如何把內容變成可追蹤的成果。", detailEn: "See how other creators turn content into trackable outcomes.", to: "/stories" },
];

const FLOW = [
  ["01", "申請", "Apply", "提交個人檔案、社交帳號與想接的 Offer。", "Submit your profile, social accounts and the offers you want."],
  ["02", "配對", "Match", "按受眾、內容類別與平台表現配對合適品牌。", "Get matched to brands by audience, category and platform performance."],
  ["03", "創作", "Create", "按 Brief 製作原創內容，加入可追蹤連結或任務證明。", "Create original work from the brief with trackable links or mission proof."],
  ["04", "核實收益", "Earn after verification", "經驗證的成果累積積分、佣金與等級進度。", "Verified outcomes build points, commissions and level progress."],
];

const LAYERS = [
  ["第 1 層", "Layer 1", "積分商店", "Points store", "完成任務累積積分與優惠獎勵，在積分商店兌換。", "Earn points and offers from missions, redeem them in the points store."],
  ["第 2 層", "Layer 2", "Affiliate 佣金", "Affiliate commissions", "可購物連結與優惠碼，把點擊與購買變成可追蹤佣金。", "Shopping links and codes turn clicks and purchases into trackable commissions."],
  ["第 3 層", "Layer 3", "現金獎賞", "Cash rewards", "經驗證的活動、Retainer 與 Product Drop 經結算後入帳。", "Verified campaigns, retainers and product drops settle into your balance."],
];

const SOURCES = ["Campaign fees", "Affiliate commissions", "Coupon rewards", "Live commerce", "UGC licensing", "Ambassador retainers", "Product drops", "Capital readiness"];

function EarnPage() {
  const tx = useStudioText();
  return (
    <div className="s-public-main s-stack">
      <section className="s-stack">
        <span className="s-tag mint">💸 {tx("收入方式 · EARN", "Earn")}</span>
        <h1>{tx("你嘅創作，變收入。", "Turn your content into income.")}</h1>
        <p>
          {tx(
            "三條收入線，集中喺一個平台：積分與獎賞、Affiliate 佣金，以及結算後的現金獎賞。",
            "Three income lines on one platform: points and rewards, affiliate commissions, and cash rewards after settlement.",
          )}
        </p>
        <div className="s-row">
          <Link to="/login" search={{ mode: "signup", next: "/home" }} className="s-btn s-primary">{tx("開始創作", "Start creating")}<ArrowRight size={17}/></Link>
          <Link to="/packages" className="s-btn">{tx("睇合作方案", "See packages")}</Link>
        </div>
        <small>{tx("以上為收入結構說明，並非收益承諾；實際金額以核實及結算記錄為準。", "This explains the income structure, not an earnings promise. Amounts follow verification and settlement records.")}</small>
      </section>

      <section className="s-stack" aria-label={tx("三個入口", "Three entry points")}>
        <h2>{tx("一個平台，三個入口", "One platform, three entry points")}</h2>
        <div className="s-card-grid-3">
          {ENTRY_PRODUCTS.map((product) => (
            <article className="s-card s-stack" key={product.en}>
              <span className="s-task-icon" aria-hidden>{product.icon}</span>
              <h3>{product.zh}</h3>
              <p className="s-muted">{tx(product.detailZh, product.detailEn)}</p>
              <Link to={product.to} className="s-btn">{tx("開啟", "Open")}<ArrowRight size={15}/></Link>
            </article>
          ))}
        </div>
      </section>

      <section className="s-stack" aria-label={tx("Affiliate 流程", "Affiliate flow")}>
        <h2>{tx("由申請到收款，四步完成", "Four steps from application to earnings")}</h2>
        <div className="s-card-grid-3">
          {FLOW.map(([number, zh, en, detailZh, detailEn]) => (
            <article className="s-card s-stack" key={number}>
              <span className="s-step-number">{tx("STEP", "STEP")} {number}</span>
              <h3>{tx(zh, en)}</h3>
              <p className="s-muted">{tx(detailZh, detailEn)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="s-stack" aria-label={tx("收入層", "Income layers")}>
        <h2>{tx("收入點樣疊上去", "How the layers stack")}</h2>
        <div className="s-card-grid-3">
          {LAYERS.map(([zhLayer, enLayer, zhTitle, enTitle, detailZh, detailEn]) => (
            <article className="s-card s-stack" key={enTitle}>
              <span className="s-tag ghost">{tx(zhLayer, enLayer)}</span>
              <h3>{tx(zhTitle, enTitle)}</h3>
              <p className="s-muted">{tx(detailZh, detailEn)}</p>
            </article>
          ))}
        </div>
        <div className="s-row">
          {SOURCES.map((source) => <span className="s-tag ghost" key={source}><Check size={13} aria-hidden/> {source}</span>)}
        </div>
      </section>

      <section className="s-card lilac s-between">
        <div className="s-stack">
          <h2>{tx("喺 Adfoplace 開始賺錢。", "Start earning on Adfoplace.")}</h2>
          <p>{tx("瀏覽公開 Offer、配對品牌 — 你嘅第一條收入線，撳一下就開始。", "Browse open offers, match with brands — your first income line starts here.")}</p>
          <div className="s-row">
            <Link to="/login" search={{ mode: "signup", next: "/home" }} className="s-btn s-primary">{tx("免費加入", "Join free")}<ArrowRight size={16}/></Link>
            <Link to="/explore" className="s-btn">{tx("瀏覽 Offer", "Browse offers")}</Link>
          </div>
          <small>{tx("免費加入 · 無合約 · 香港", "Free to join · no contract · Hong Kong")}</small>
        </div>
        <Sprout/>
      </section>
    </div>
  );
}
