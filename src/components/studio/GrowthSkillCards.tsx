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

const CARD_DETAILS: Record<
  GrowthSkillId,
  Readonly<{ icon: string; promptZh: string; promptEn: string }>
> = {
  image_diagnosis: {
    icon: "🖼️",
    promptZh: "幫我看這張圖，指出構圖、文字和可改善的地方。",
    promptEn: "Review this image for composition, visible text and improvements.",
  },
  post_review: {
    icon: "📈",
    promptZh: "幫我檢討這篇貼文；缺少的數字要清楚標示。",
    promptEn: "Review this post and clearly mark unavailable metrics.",
  },
  next_caption: {
    icon: "✍️",
    promptZh: "根據這張圖，替我整理一篇真實、不誇大的下一篇文案。",
    promptEn: "Draft a truthful next-post caption from this image.",
  },
  next_growth_step: {
    icon: "🧭",
    promptZh: "根據已確認的檢討，安排下一步可以實行的成長行動。",
    promptEn: "Turn confirmed findings into one practical next growth step.",
  },
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
          const details = CARD_DETAILS[card.id];
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
                  {details.icon}
                </span>
                <span className="s-growth-card-copy">
                  <strong>{card.titleZh}</strong>
                  <span>{tx(details.promptZh, details.promptEn)}</span>
                </span>
                <span className="s-growth-card-meta">
                  <span className="s-tag">{card.difficulty}</span>
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
