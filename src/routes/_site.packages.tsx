import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { packages } from "@/data/mockData";
import { Sprout, useStudioText } from "@/components/studio/StudioPrimitives";

export const Route = createFileRoute("/_site/packages")({
  component: PackagesPage,
});

const INITIAL_PACKAGES = 6;

function PackagesPage() {
  const tx = useStudioText();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? packages : packages.slice(0, INITIAL_PACKAGES);
  return (
    <div className="s-public-main s-stack">
      <section className="s-stack">
        <span className="s-tag mint">📦 {tx("合作方案 · PACKAGES", "Packages")}</span>
        <h1>{tx("揀啱你嘅方案。", "Pick the plan that fits.")}</h1>
        <p>
          {tx(
            "12 種產品化創作者活動格式。揀一個現成方案，或者同我們組合出配合品牌目標的活動。",
            "12 productized creator campaign formats. Start from a ready package or mix one for your brand goals.",
          )}
        </p>
        <div className="s-row">
          <Link to="/contact" className="s-btn s-primary">{tx("規劃活動", "Plan a campaign")}<ArrowRight size={17}/></Link>
          <Link to="/playbooks" className="s-btn">{tx("瀏覽成長指南", "Browse playbooks")}</Link>
        </div>
        <small>{tx("香港市場 · 自由組合 · 每個方案均附 Brief、交付物及報告。", "Hong Kong market · mix & match · each package includes a brief, deliverables and a report.")}</small>
      </section>

      <section className="s-stack" aria-label={tx("活動格式", "Campaign formats")}>
        <div className="s-between">
          <h2>{tx("每個格式，準備即用", "Ready-to-launch formats")}</h2>
          <span className="s-tag ghost">{packages.length} {tx("個方案", "formats")}</span>
        </div>
        <div className="s-card-grid-3">
          {visible.map((pkg) => (
            <article className="s-card s-stack" key={pkg.id}>
              <div className="s-between">
                <span className="s-tag">{tx("方案", "Package")}</span>
                {pkg.id === "p4" && <span className="s-tag mint">{tx("推薦", "Recommended")}</span>}
              </div>
              <h3>{pkg.title}</h3>
              <p className="s-muted">{tx("最適合：", "Best for: ")}{pkg.bestFor}</p>
              <ul className="s-list-check">
                {pkg.deliverables.map((deliverable) => <li key={deliverable}><Check size={15} aria-hidden/><span>{deliverable}</span></li>)}
              </ul>
              <Link to="/contact" className="s-btn">{tx("聯絡我們", "Talk to us")}<ArrowRight size={15}/></Link>
            </article>
          ))}
        </div>
        {packages.length > INITIAL_PACKAGES && (
          <button type="button" className="s-btn" onClick={() => setShowAll((value) => !value)}>
            {showAll ? tx("收起方案", "Show fewer") : tx(`顯示其餘 ${packages.length - INITIAL_PACKAGES} 個方案`, `Show ${packages.length - INITIAL_PACKAGES} more formats`)}
          </button>
        )}
      </section>

      <section className="s-card lilac s-between">
        <div className="s-stack">
          <h2>{tx("需要客製方案？", "Need a custom package?")}</h2>
          <p>{tx("告訴我們目標、預算與時間表，我們會為品牌、品類與受眾設計方案。", "Tell us your goal, budget and timeline. We will design a package for your brand, category and audience.")}</p>
          <div className="s-row">
            <Link to="/contact" className="s-btn s-primary">{tx("申請客製方案", "Request custom package")}<ArrowRight size={16}/></Link>
            <Link to="/playbooks" className="s-btn">{tx("瀏覽成長指南", "Browse playbooks")}</Link>
          </div>
          <small>{tx("免綁約起步 · 一個工作天內回覆。", "No retainer to start · reply within one business day.")}</small>
        </div>
        <Sprout/>
      </section>
    </div>
  );
}
