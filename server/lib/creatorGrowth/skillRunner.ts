import {
  GROWTH_SKILLS,
  type GrowthSkillId,
} from "../../../src/lib/creatorGrowth/skillManifest.js";
import type { GrowthEvidenceReport } from "./report.js";

export type SkillWriterInput = Readonly<{
  skillId: GrowthSkillId;
  question: string;
  platform: "instagram";
  creatorGoal: string;
  voice: string | null;
  report: GrowthEvidenceReport;
}>;

export type SkillWriter = Readonly<{
  kind: "mock" | "external";
  write: (input: SkillWriterInput) => Promise<string>;
}>;

export type SkillRunnerDependencies = Readonly<{
  writer?: SkillWriter;
  processingApproved?: boolean;
}>;

export type GrowthSkillResult = Readonly<{
  proposal: string;
  sourceRefs: readonly string[];
  limitations: readonly string[];
  sampleOnly: boolean;
}>;

export type RunGrowthSkillInput = Readonly<{
  skillId: GrowthSkillId;
  report: GrowthEvidenceReport;
  creatorGoal: string;
  voice?: string;
}>;

const MAX_GOAL_LENGTH = 300;
const MAX_VOICE_LENGTH = 120;
const MAX_PROPOSAL_LENGTH = 6000;
const URL_PATTERN = /(?:https?|data|blob):\/\/\S+/gi;
const JWT_PATTERN =
  /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]*/g;
const SENSITIVE_ASSIGNMENT =
  /\b(?:access_token|token|secret|password|authorization)\s*=\s*[^\s]+/gi;
function withoutControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (
          (codePoint >= 0 && codePoint <= 8) ||
          codePoint === 11 ||
          codePoint === 12 ||
          (codePoint >= 14 && codePoint <= 31) ||
          codePoint === 127
        )
      ) === false;
    })
    .join("");
}

function boundedText(value: unknown, limit: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return Array.from(
    withoutControlCharacters(value).trim(),
  ).slice(0, limit).join("");
}

function sanitizeProposal(value: string): string {
  return boundedText(value, MAX_PROPOSAL_LENGTH)
    .replace(URL_PATTERN, "[網址已移除]")
    .replace(JWT_PATTERN, "[憑證已移除]")
    .replace(SENSITIVE_ASSIGNMENT, "[敏感值已移除]");
}

function safeOptionalText(
  value: string,
  limit = MAX_PROPOSAL_LENGTH,
): string {
  return boundedText(value, limit)
    .replace(URL_PATTERN, "[網址已移除]")
    .replace(JWT_PATTERN, "[憑證已移除]")
    .replace(SENSITIVE_ASSIGNMENT, "[敏感值已移除]");
}

function metricSummary(report: GrowthEvidenceReport): string {
  return report.metrics
    .map((metric) =>
      metric.status === "available"
        ? `${metric.metric}：${metric.value}（${metric.periodKind}）`
        : `${metric.metric}：資料不足（${metric.reason ?? "unknown"}）`,
    )
    .join("；");
}

function observationSummary(report: GrowthEvidenceReport): string {
  const observation = report.observation;
  if (observation.availability === "manual") {
    return `圖片暫時只能以手動資料整理（${observation.reason ?? "manual"}）。`;
  }
  const facts = [
    ...observation.objects,
    ...observation.visibleText,
    ...observation.composition,
  ];
  return facts.length === 0
    ? "圖片觀察未提供可核對細節。"
    : `只採用已觀察細節：${facts.join("、")}。`;
}

function localMockProposal(input: SkillWriterInput): string {
  const creatorGoal = input.creatorGoal.length > 0
    ? safeOptionalText(input.creatorGoal, MAX_GOAL_LENGTH)
    : "[由你填寫創作目標]";
  const voice =
    input.voice === null
      ? "[由你選擇語氣]"
      : safeOptionalText(input.voice, MAX_VOICE_LENGTH);
  const metricFacts = metricSummary(input.report);
  const selection = input.report.period.selection;

  if (input.skillId === "image_diagnosis") {
    return [
      "圖片檢視建議（只供整理）",
      observationSummary(input.report),
      `創作目標：${creatorGoal}`,
      "下一步：選一項可核對的構圖或文字問題，修改後再自行比較；未提供的畫面資料請由你補充。",
      "地區及語言受眾：未驗證；未取得可靠覆蓋資料前，不作地域推論。",
    ].join("\n");
  }

  if (input.skillId === "post_review") {
    return [
      "貼文檢視建議（proposal only）",
      `官方／手動指標：${metricFacts}`,
      `選文範圍只是最近 ${selection.windowDays} 日、最多 ${selection.mediaLimit} 篇；每項指標仍只按其回應所示 period 解讀。`,
      `創作目標：${creatorGoal}`,
      "小型測試：選一項假設，只記錄下一次可核對的表現，再與原 period 對照；不推論未提供的長期趨勢。",
      "地區及語言受眾：未驗證。",
    ].join("\n");
  }

  if (input.skillId === "next_caption") {
    return [
      "文案選項（只供編輯，發布前由你核對）",
      `1. [開場：${creatorGoal}] + [由你補充的畫面或產品事實]`,
      "2. [你親自確認的具體細節] + [受眾可理解的情境]",
      "3. [你確認過的實際體驗／結果；如無請刪除] + [可核對的行動邀請]",
      `建議語氣：${voice}`,
      "未有證據支持的個人經歷、成效或承諾一律不要加入。",
      metricFacts.length > 0
        ? `可用但不可外推的來源摘要：${metricFacts}`
        : "目前沒有可用的表現資料。",
    ].join("\n");
  }

  return [
    "成長下一步（小型、可測試）",
    `創作目標：${creatorGoal}`,
    `目前可用來源：${metricFacts}`,
    "1. 選一篇已完成核對的貼文，只提出一個可觀察假設。",
    "2. 下一次只改動一個元素，例如開場、構圖或資訊次序。",
    "3. 記錄同一項官方指標及其原有 period；缺值保持 unknown。",
    `4. 選文時只使用最近 ${selection.windowDays} 日、最多 ${selection.mediaLimit} 篇範圍，並把選文限制與指標 period 分開判斷。`,
    "5. 小樣本檢視後，保留有效、無效或資料不足的結論；不保證演算法結果。",
  ].join("\n");
}

export const localMockSkillWriter: SkillWriter = Object.freeze({
  kind: "mock",
  write: async (input: SkillWriterInput) =>
    localMockProposal(input),
});

function skillSourceRefs(skillId: GrowthSkillId): readonly string[] {
  const skill = GROWTH_SKILLS.find((card) => card.id === skillId);
  if (skill === undefined) {
    return Object.freeze([]);
  }
  const provenance = skill.provenance;
  if (provenance.kind === "native") {
    return Object.freeze([
      `native:${provenance.implementationVersion}`,
    ]);
  }
  return Object.freeze(
    provenance.sourceSkills.map(
      (sourceSkill) =>
        `curated:social-media-skills/skills@${provenance.revision}#${sourceSkill}`,
    ),
  );
}

function sourcePermissionApproved(
  report: GrowthEvidenceReport,
): boolean {
  return report.sourcePermission.publicImage === "allowed";
}

function resultLimitations(
  input: RunGrowthSkillInput,
  reasons: readonly string[] = [],
): readonly string[] {
  return Object.freeze([
    "proposal_only",
    "no_publish_or_points_authority",
    "no_algorithm_guarantee",
    ...(input.report.sampleOnly ? ["sample_data_only"] : []),
    ...(input.report.partial ? ["partial_evidence"] : []),
    ...(input.report.region.verified ? [] : ["region_unverified"]),
    ...(input.report.language.verified ? [] : ["language_unverified"]),
    ...reasons,
  ]);
}

function writerInput(input: RunGrowthSkillInput): SkillWriterInput {
  return Object.freeze({
    skillId: input.skillId,
    question: input.report.question,
    platform: input.report.platform,
    creatorGoal: safeOptionalText(
      input.creatorGoal,
      MAX_GOAL_LENGTH,
    ),
    voice:
      input.voice === undefined
        ? null
        : safeOptionalText(input.voice, MAX_VOICE_LENGTH),
    report: input.report,
  });
}

async function runWriter(
  input: RunGrowthSkillInput,
  deps: SkillRunnerDependencies,
): Promise<Readonly<{
  proposal: string;
  sampleOnly: boolean;
  reasons: readonly string[];
}>> {
  const writer = deps.writer ?? localMockSkillWriter;
  if (writer.kind === "external") {
    const reasons = [
      "external_writer_unavailable",
      "local_mock_writer",
      ...(deps.processingApproved === true
        ? []
        : ["external_model_not_approved"]),
      ...(sourcePermissionApproved(input.report)
        ? []
        : ["source_permission_not_approved"]),
    ];
    return {
      proposal: await localMockSkillWriter.write(writerInput(input)),
      sampleOnly: input.report.sampleOnly,
      reasons: Object.freeze(reasons),
    };
  }

  const proposal = sanitizeProposal(
    await writer.write(writerInput(input)),
  );
  if (proposal.length === 0) {
    return {
      proposal: await localMockSkillWriter.write(writerInput(input)),
      sampleOnly: input.report.sampleOnly,
      reasons: Object.freeze([
        "writer_output_rejected",
        "local_mock_writer",
      ]),
    };
  }
  return {
    proposal,
    sampleOnly: input.report.sampleOnly,
    reasons: Object.freeze([]),
  };
}

export async function runGrowthSkill(
  input: RunGrowthSkillInput,
  deps: SkillRunnerDependencies = {},
): Promise<GrowthSkillResult> {
  const writerResult = await runWriter(input, deps);
  const citationRefs = input.report.citations.map(
    (citation) => citation.sourceRef,
  );
  const sourceRefs = Object.freeze(
    [...new Set([
      ...citationRefs,
      ...skillSourceRefs(input.skillId),
    ])],
  );
  return Object.freeze({
    proposal: writerResult.proposal,
    sourceRefs,
    limitations: resultLimitations(input, writerResult.reasons),
    sampleOnly: writerResult.sampleOnly,
  });
}
