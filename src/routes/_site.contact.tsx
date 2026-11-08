import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Info } from "lucide-react";
import { Sprout, useStudioText } from "@/components/studio/StudioPrimitives";

export const Route = createFileRoute("/_site/contact")({
  component: ContactPage,
});

function ContactPage() {
  const tx = useStudioText();
  return (
    <div className="s-public-main s-stack">
      <section className="s-stack">
        <span className="s-tag mint">✉️ {tx("聯絡 · CONTACT", "Contact")}</span>
        <h1>{tx("傾下你嘅下一步。", "Let's talk about your next step.")}</h1>
        <p>
          {tx(
            "我哋正在設定正式收件渠道。喺渠道開放前，呢個頁面不會收集或傳送任何資料。",
            "Formal contact channels are being set up. Until they are live, this page does not collect or send anything.",
          )}
        </p>
      </section>

      <section className="s-stack" aria-label={tx("查詢類型", "Enquiry types")}>
        <div className="s-card-grid-3">
          <article className="s-card s-stack">
            <span className="s-task-icon" aria-hidden>🏷️</span>
            <h2>{tx("品牌查詢", "Brand enquiries")}</h2>
            <p className="s-muted">{tx("活動策劃、配對與報價 — 先睇合作方案，再由品牌入口處理。", "Campaign planning, matching and quotes — review packages, then use the brand entry.")}</p>
            <div className="s-row">
              <Link to="/packages" className="s-btn s-primary">{tx("睇合作方案", "See packages")}<ArrowRight size={15}/></Link>
              <Link to="/brand" className="s-btn">{tx("品牌入口", "Brand entry")}</Link>
            </div>
          </article>

          <article className="s-card s-stack">
            <span className="s-task-icon" aria-hidden>🌱</span>
            <h2>{tx("創作者報名", "Creator sign-up")}</h2>
            <p className="s-muted">{tx("建立創作者檔案，開始接任務、累積成果與等級。", "Create a creator profile and start taking missions, building verified work and levels.")}</p>
            <div className="s-row">
              <Link to="/login" search={{ mode: "signup", next: "/home" }} className="s-btn s-primary">{tx("開始冒險", "Get started")}<ArrowRight size={15}/></Link>
              <Link to="/earn" className="s-btn">{tx("了解收入方式", "How earning works")}</Link>
            </div>
          </article>

          <article className="s-card s-stack">
            <span className="s-task-icon" aria-hidden>🤝</span>
            <h2>{tx("合作與媒體", "Partnerships & media")}</h2>
            <p className="s-muted">{tx("正式收件渠道仍在設定，暫未能接收訊息。開放後會在此公佈。", "Formal channels are still being set up, so messages cannot be received yet. They will be announced here.")}</p>
            <Link to="/playbooks" className="s-btn">{tx("瀏覽成長指南", "Browse playbooks")}</Link>
          </article>
        </div>
      </section>

      <section className="s-card s-between" aria-label={tx("關於訊息", "About messages")}>
        <div className="s-stack">
          <div className="s-row"><Info size={18} aria-hidden/><h2>{tx("此頁不設表格", "No form on this page")}</h2></div>
          <p className="s-muted">{tx("我哋移除了預覽表格，避免誤以為訊息已送出。正式渠道開放後，會提供可核實嘅收件方式。", "The preview form was removed so nothing looks sent. When formal channels open, a verifiable contact route will be listed.")}</p>
        </div>
        <Sprout/>
      </section>
    </div>
  );
}
