import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { storyCards } from "@/data/mockData";
import { Sprout, useStudioText } from "@/components/studio/StudioPrimitives";

export const Route = createFileRoute("/_site/stories")({
  component: StoriesPage,
});

const INITIAL_STORIES = 4;

const INDUSTRY_ZH: Record<string, string> = {
  Beauty: "美妝",
  Retail: "零售",
  "Community / Youth": "社群 / 青年",
  "Personal Care": "個人護理",
  Travel: "旅遊",
  "Beauty / Personal Care": "美妝 / 個人護理",
  "F&B": "餐飲",
};

function StoriesPage() {
  const tx = useStudioText();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? storyCards : storyCards.slice(0, INITIAL_STORIES);
  return (
    <div className="s-public-main s-stack">
      <section className="s-stack">
        <span className="s-tag mint">🎬 {tx("創作故事 · STORIES", "Stories")}</span>
        <h1>{tx("成績說話。", "The work speaks.")}</h1>
        <p>
          {tx(
            "橫跨美妝、旅遊、零售、社群及餐飲的品牌案例，全部來自 Adfocate 過往作品集。",
            "Brand work across beauty, travel, retail, community and food — taken from Adfocate's own portfolio.",
          )}
        </p>
        <div className="s-row">
          <Link to="/contact" className="s-btn s-primary">{tx("開始你嘅故事", "Start your story")}<ArrowRight size={17}/></Link>
          <Link to="/packages" className="s-btn">{tx("睇合作方案", "See packages")}</Link>
        </div>
        <small>{tx("案例只展示合作類型，未在此頁展示成效數字。", "Cases show collaboration types; no performance figures are claimed on this page.")}</small>
      </section>

      <section className="s-stack" aria-label={tx("品牌案例", "Brand cases")}>
        <div className="s-between">
          <h2>{tx("過往案例", "Selected work")}</h2>
          <span className="s-tag ghost">{tx("8 個品牌 · 5 大行業", "8 brands · 5 industries")}</span>
        </div>
        <div className="s-card-grid-3">
          {visible.map((story) => (
            <article className="s-card s-stack" key={story.name}>
              <div className="s-between">
                <h3>{story.name}</h3>
                <span className="s-tag ghost">{tx(INDUSTRY_ZH[story.industry] ?? "其他", story.industry)}</span>
              </div>
              <p className="s-muted">{tx("過往案例", "Previous work")}</p>
              <p>{story.activation}</p>
              <a className="s-btn" href="https://www.adfocate.com/" target="_blank" rel="noreferrer">
                {tx("參考來源", "Source")}<ArrowUpRight size={15}/>
              </a>
            </article>
          ))}
        </div>
        {storyCards.length > INITIAL_STORIES && (
          <button type="button" className="s-btn" onClick={() => setShowAll((value) => !value)}>
            {showAll ? tx("收起案例", "Show fewer") : tx(`顯示其餘 ${storyCards.length - INITIAL_STORIES} 個案例`, `Show ${storyCards.length - INITIAL_STORIES} more cases`)}
          </button>
        )}
      </section>

      <section className="s-card lilac s-between">
        <div className="s-stack">
          <h2>{tx("想成為下一個案例？", "Want to be the next case?")}</h2>
          <p>{tx("加入 KOCmax，逐級升級，將你嘅內容變成有紀錄、有收入嘅成果。", "Join KOCmax, level up, and turn your content into recorded, rewarded work.")}</p>
          <div className="s-row">
            <Link to="/login" search={{ mode: "signup", next: "/home" }} className="s-btn s-primary">{tx("以創作者身份加入", "Join as a creator")}<ArrowRight size={16}/></Link>
            <Link to="/contact" className="s-btn">{tx("品牌合作", "Work with us")}</Link>
          </div>
        </div>
        <Sprout/>
      </section>
    </div>
  );
}
