import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { useState } from "react";
import { legacyPlaybookTopics, localized } from "@/data/legacyAdfocateContent";
import { playbooks } from "@/data/mockData";
import { useI18n } from "@/lib/i18n";
import { Sprout, useStudioText } from "@/components/studio/StudioPrimitives";

export const Route = createFileRoute("/_site/playbooks")({
  component: PlaybooksPage,
});

const INITIAL_PLAYS = 2;
const INITIAL_TOPICS = 3;

function PlaybooksPage() {
  const tx = useStudioText(), { lang } = useI18n();
  const [showAllPlays, setShowAllPlays] = useState(false);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const visiblePlays = showAllPlays ? playbooks : playbooks.slice(0, INITIAL_PLAYS);
  const visibleTopics = showAllTopics ? legacyPlaybookTopics : legacyPlaybookTopics.slice(0, INITIAL_TOPICS);
  return (
    <div className="s-public-main s-stack">
      <section className="s-stack">
        <span className="s-tag mint">📘 {tx("創作指南 · PLAYBOOKS", "Playbooks")}</span>
        <h1>{tx("行業打法，整理成 Playbook。", "Industry plays, filed as playbooks.")}</h1>
        <p>
          {tx(
            "按行業分類的活動格式與創作者啟動點子，來自 Adfocate 過往的實戰內容。",
            "Campaign formats and creator activation ideas filed by industry, drawn from Adfocate's working material.",
          )}
        </p>
        <div className="s-row">
          <Link to="/packages" className="s-btn s-primary">{tx("睇合作方案", "See packages")}<ArrowRight size={17}/></Link>
          <Link to="/contact" className="s-btn">{tx("聯絡我們", "Contact us")}</Link>
        </div>
        <small>{tx("內容為方法整理，並非成效承諾。", "Guidance, not a performance promise.")}</small>
      </section>

      <section className="s-stack" aria-label={tx("行業 Playbook", "Industry plays")}>
        <div className="s-between">
          <h2>{tx("揀返一份啱你行業嘅打法", "Pick the play for your sector")}</h2>
          <span className="s-tag ghost">{playbooks.length} {tx("份行業", "industries")}</span>
        </div>
        <div className="s-grid">
          {visiblePlays.map((play) => (
            <article className="s-card s-stack" key={play.industry.en}>
              <div className="s-between">
                <h3>{play.emoji} {localized(play.industry, lang)}</h3>
                <span className="s-tag ghost">{play.levels.map((level) => localized(level, lang)).join(" · ")}</span>
              </div>
              <div className="s-stack" style={{ gap: 8 }}>
                <span className="s-eyebrow">{tx("活動點子", "Campaign ideas")}</span>
                <ul className="s-list-check">
                  {play.ideas.map((idea) => <li key={idea}><Check size={14} aria-hidden/><span>{idea}</span></li>)}
                </ul>
              </div>
              <p className="s-muted">{tx("創作者切入：", "Creator angle: ")}{localized(play.creatorAngle, lang)}</p>
              <p className="s-muted">{tx("量度重點：", "Measurement: ")}{play.measurementFocus}</p>
            </article>
          ))}
        </div>
        {playbooks.length > INITIAL_PLAYS && (
          <button type="button" className="s-btn" onClick={() => setShowAllPlays((value) => !value)}>
            {showAllPlays ? tx("收起行業", "Show fewer") : tx(`顯示其餘 ${playbooks.length - INITIAL_PLAYS} 個行業`, `Show ${playbooks.length - INITIAL_PLAYS} more industries`)}
          </button>
        )}
      </section>

      <section className="s-stack" aria-label={tx("主題指南", "Topic guides")}>
        <div className="s-between">
          <h2>{tx("把實戰洞察，整理成可執行指南", "Agency insights, rebuilt as guides")}</h2>
          <span className="s-tag ghost">{legacyPlaybookTopics.length} {tx("個主題", "topics")}</span>
        </div>
        <div className="s-card-grid-3">
          {visibleTopics.map((topic) => (
            <article className="s-card s-stack" key={topic.id}>
              <div className="s-between">
                <span className="s-tag ghost">{localized(topic.industry, lang)}</span>
                <span className="s-tag">{tx("指南", "Playbook")}</span>
              </div>
              <h3>{localized(topic.title, lang)}</h3>
              <p className="s-muted">{localized(topic.summary, lang)}</p>
              <ul className="s-list-check">
                {topic.takeaways.map((takeaway) => <li key={takeaway.en}><Check size={14} aria-hidden/><span>{localized(takeaway, lang)}</span></li>)}
              </ul>
              <a className="s-btn" href={topic.sourceUrl} target="_blank" rel="noreferrer">
                {tx("參考來源", "Source")}<ArrowUpRight size={15}/>
              </a>
            </article>
          ))}
        </div>
        {legacyPlaybookTopics.length > INITIAL_TOPICS && (
          <button type="button" className="s-btn" onClick={() => setShowAllTopics((value) => !value)}>
            {showAllTopics ? tx("收起主題", "Show fewer") : tx(`顯示其餘 ${legacyPlaybookTopics.length - INITIAL_TOPICS} 個主題`, `Show ${legacyPlaybookTopics.length - INITIAL_TOPICS} more topics`)}
          </button>
        )}
      </section>

      <section className="s-card lilac s-between">
        <div className="s-stack">
          <h2>{tx("想要為品牌度身訂造嘅 Playbook？", "Want a custom playbook for your brand?")}</h2>
          <p>{tx("按你的行業、目標與預算，設計一份專屬的創作者啟動方案。", "We can design a tailored creator activation plan for your industry, goals and budget.")}</p>
          <div className="s-row">
            <Link to="/contact" className="s-btn s-primary">{tx("索取 Playbook", "Request a playbook")}<ArrowRight size={16}/></Link>
            <Link to="/packages" className="s-btn">{tx("查看方案", "View packages")}</Link>
          </div>
        </div>
        <Sprout/>
      </section>
    </div>
  );
}
