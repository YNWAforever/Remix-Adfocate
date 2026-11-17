import { ArrowUpRight } from "lucide-react";
import {
  GROWTH_SKILLS,
  type GrowthSkillCard,
  type GrowthSkillId,
} from "@/lib/creatorGrowth/skillManifest";
import { useStudioText } from "./StudioPrimitives";

type GrowthSkillCardsProps = {
  onChooseSkill: (id: GrowthSkillId) => void;
  selectedSkillId?: GrowthSkillId | null;
  disabled?: boolean;
};

const CARD_ICONS: Record<GrowthSkillId, string> = {
  image_diagnosis: "🖼️",
  post_review: "📈",
  next_caption: "✍️",
  next_growth_step: "🧭",
};

const SOURCE_SKILL_LABELS: Record<string, string> = {
  "content-audit": "內容檢視",
  "analytics-and-reporting": "成效分析",
  "caption-writer": "文案撰寫",
  "hook-writer": "開場寫作",
  "instagram-growth": "Instagram 成長",
};

function provenanceLabel(card: GrowthSkillCard): string {
  return card.provenance.kind === "native"
    ? "KOCmax 原創"
    : "公開技能啟發 · MIT";
}

function SkillSource({ card }: { card: GrowthSkillCard }) {
  const tx = useStudioText();
  return (
    <details className="s-growth-card-source">
      <summary>{tx("來源說明", "Source details")}</summary>
      {card.provenance.kind === "native" ? (
        <div className="s-growth-source-detail">
          <p>{tx(
            "由 KOCmax 團隊原創，不使用第三方技能內容。",
            "Created by the KOCmax team without third-party skill content.",
          )}</p>
          <small>
            {tx("原生版本", "Native version")}: {card.provenance.implementationVersion}
          </small>
        </div>
      ) : (
        <div className="s-growth-source-detail">
          <p>
            {tx("改編自公開技能", "Adapted from public skills")}
            {card.provenance.sourceSkills.map((sourceSkill) => (
              <span key={sourceSkill}>
                {SOURCE_SKILL_LABELS[sourceSkill] ?? tx("公開技能", "Public skill")}
                <small>{sourceSkill}</small>
              </span>
            ))}
          </p>
          <small>
            {card.provenance.attribution} · MIT
          </small>
          <small>{tx("來源檔案", "Source file")}: {card.provenance.repository}</small>
          <small>{tx("版本", "Revision")}: {card.provenance.revision}</small>
        </div>
      )}
    </details>
  );
}

export function GrowthSkillCards({
  onChooseSkill,
  selectedSkillId,
  disabled = false,
}: GrowthSkillCardsProps) {
  const tx = useStudioText();

  return (
    <section className="s-growth-skills" aria-labelledby="growth-skills-title">
      <div className="s-between s-growth-heading">
        <div>
          <span className="s-eyebrow">SKILL DECK</span>
          <h2 id="growth-skills-title">{tx("挑一個成長技能", "Pick a growth skill")}</h2>
        </div>
        <span className="s-tag ghost">4 {tx("張卡", "cards")}</span>
      </div>
      <div className="s-growth-card-grid">
        {GROWTH_SKILLS.map((card, index) => {
          const icon = CARD_ICONS[card.id];
          const selected = selectedSkillId === card.id;
          return (
            <article
              key={card.id}
              className="s-growth-card"
              data-selected={selected ? "true" : "false"}
            >
              <button
                type="button"
                className="s-growth-card-main"
                data-skill={card.id}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onChooseSkill(card.id)}
              >
                <span className="s-growth-card-index" aria-hidden>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="s-growth-card-icon" aria-hidden>
                  {icon}
                </span>
                <span className="s-growth-card-copy">
                  <strong>{tx(card.titleZh, card.titleEn)}</strong>
                  <span>{tx(card.summaryZh, card.summaryEn)}</span>
                </span>
                <span className="s-growth-card-meta">
                  <span className="s-tag">{tx(card.difficulty, card.difficultyEn)}</span>
                  <span className="s-tag ghost">{card.estimatedMinutes} {tx("分鐘", "min")}</span>
                  <span
                    className={`s-source-badge ${card.provenance.kind === "native" ? "native" : "curated"}`}
                  >
                    {provenanceLabel(card)}
                  </span>
                </span>
                <span className="s-growth-card-action" aria-hidden>
                  <ArrowUpRight size={17} />
                </span>
              </button>
              <SkillSource card={card}/>
            </article>
          );
        })}
      </div>
    </section>
  );
}
