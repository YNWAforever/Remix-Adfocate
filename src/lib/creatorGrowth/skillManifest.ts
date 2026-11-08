export type GrowthSkillId =
  | "image_diagnosis"
  | "post_review"
  | "next_caption"
  | "next_growth_step";

export type NativeGrowthSkillProvenance = Readonly<{
  kind: "native";
  implementationVersion: string;
}>;

export type CuratedExternalGrowthSkillProvenance = Readonly<{
  kind: "curated_external";
  repository: string;
  revision: string;
  license: "MIT";
  attribution: string;
  sourceSkills: readonly string[];
}>;

export type GrowthSkillProvenance =
  | NativeGrowthSkillProvenance
  | CuratedExternalGrowthSkillProvenance;

export type GrowthSkillCard = Readonly<{
  id: GrowthSkillId;
  titleZh: string;
  difficulty: string;
  estimatedMinutes: number;
  requiredSources: string[];
  reward: "mission_contract_only" | "none";
  provenance: GrowthSkillProvenance;
}>;

const SOURCE_REVISION = "f28cef2b7067ec64e79c9d85421c022c06659e03";

export const GROWTH_SKILL_SOURCE = Object.freeze({
  repository: "https://github.com/social-media-skills/skills",
  revision: SOURCE_REVISION,
  license: "MIT",
  attribution: "Frank Heijdenrijk 2026",
} as const);

const NATIVE_IMAGE_DIAGNOSIS_PROVENANCE: NativeGrowthSkillProvenance = Object.freeze({
  kind: "native",
  implementationVersion: "kocmax-image-diagnosis-v1",
});

function curatedProvenance(sourceSkills: readonly string[]): CuratedExternalGrowthSkillProvenance {
  return Object.freeze({
    kind: "curated_external",
    ...GROWTH_SKILL_SOURCE,
    sourceSkills: Object.freeze([...sourceSkills]),
  });
}

export const GROWTH_SKILLS: ReadonlyArray<GrowthSkillCard> = Object.freeze([
  Object.freeze({
    id: "image_diagnosis",
    titleZh: "看懂圖片問題",
    difficulty: "入門",
    estimatedMinutes: 8,
    requiredSources: ["本人有權使用的圖片", "可手動描述的畫面細節"],
    reward: "none",
    provenance: NATIVE_IMAGE_DIAGNOSIS_PROVENANCE,
  }),
  Object.freeze({
    id: "post_review",
    titleZh: "檢討貼文表現",
    difficulty: "中等",
    estimatedMinutes: 12,
    requiredSources: ["已選舊貼文", "可手動提供的表現資料"],
    reward: "none",
    provenance: curatedProvenance(["content-audit", "analytics-and-reporting"]),
  }),
  Object.freeze({
    id: "next_caption",
    titleZh: "寫下一篇文案",
    difficulty: "容易",
    estimatedMinutes: 10,
    requiredSources: ["新圖片或創作想法", "創作目標（可選）"],
    reward: "none",
    provenance: curatedProvenance(["caption-writer", "hook-writer"]),
  }),
  Object.freeze({
    id: "next_growth_step",
    titleZh: "安排成長下一步",
    difficulty: "中等",
    estimatedMinutes: 9,
    requiredSources: ["已確認的貼文檢討", "創作目標（可選）"],
    reward: "none",
    provenance: curatedProvenance(["instagram-growth"]),
  }),
]);
