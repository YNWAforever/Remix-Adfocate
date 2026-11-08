import { describe, expect, it, vi } from "vitest";

import type { EvidenceValue } from "../../../src/lib/integrations/types.js";
import type { ImageAnalysisResult } from "./imageAnalysis.js";
import {
  buildGrowthEvidence,
  type GrowthEvidenceReport,
} from "./report.js";
import {
  runGrowthSkill,
  type SkillWriter,
} from "./skillRunner.js";

const ASSET_ID = "asset-runner-sample";
const ASSET_SHA256 =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const RUN_AT = "2026-11-04T09:00:00.000Z";

function providerMetric(value: number): EvidenceValue {
  return {
    value,
    availability: "available",
    reason: null,
  };
}

function evidenceReport(
  overrides: {
    rights?: "allowed" | "unknown" | "denied";
    sampleOnly?: boolean;
    sourcePermission?: "allowed" | "unknown" | "denied";
  } = {},
): GrowthEvidenceReport {
  const sampleOnly = overrides.sampleOnly ?? true;
  const observation: ImageAnalysisResult = Object.freeze({
    observation: Object.freeze(
      sampleOnly
        ? {
            availability: "observed" as const,
            objects: Object.freeze(["product package"]),
            visibleText: Object.freeze([]),
            composition: Object.freeze([]),
            captionAlignment: "uncertain" as const,
            uncertainties: Object.freeze(["Audience coverage is unknown."]),
            sampleOnly: true,
          }
        : {
            availability: "manual" as const,
            reason: "manual_description_required" as const,
            objects: Object.freeze([]),
            visibleText: Object.freeze([]),
            composition: Object.freeze([]),
            captionAlignment: "unavailable" as const,
            uncertainties: Object.freeze(["manual_description_required"]),
            sampleOnly: false,
          },
    ),
    binding: Object.freeze(
      sampleOnly
        ? {
            assetId: ASSET_ID,
            sha256: ASSET_SHA256,
            sourceKind: "synthetic-fixture" as const,
            fixtureId: "fixture:runner-sample",
          }
        : {
            assetId: ASSET_ID,
            sha256: ASSET_SHA256,
            sourceKind: "creator-upload" as const,
          },
    ),
  });
  return buildGrowthEvidence({
    question: "幫我安排一個小型測試",
    officialSnapshots: [
      {
        sourceRef: "official-insights:post-runner",
        fetchedAt: "2026-11-04T08:50:00.000Z",
        period: {
          kind: "lifetime",
        },
        metrics: {
          reach: providerMetric(0),
          likes: providerMetric(4),
        },
      },
    ],
    publicImageMatch: sampleOnly
      ? {
          status: "matched",
          reason: "exact_media_reference",
          sourceRef: "mock-public:post-runner",
          fetchedAt: "2026-11-04T08:52:00.000Z",
          sampleOnly: true,
          rights: overrides.rights ?? "allowed",
          selectedAsset: {
            assetId: ASSET_ID,
            sha256: ASSET_SHA256,
          },
        }
      : null,
    sourcePermission: sampleOnly
      ? {
          publicImage: overrides.sourcePermission ?? "allowed",
        }
      : undefined,
    observation,
    runAt: RUN_AT,
  });
}

describe("runGrowthSkill", () => {
  it("uses the local mock writer by default and returns only a proposal", async () => {
    const result = await runGrowthSkill({
      skillId: "post_review",
      report: evidenceReport(),
      creatorGoal: "了解哪類內容值得再測試",
    });

    expect(result.proposal).toContain("小型測試");
    expect(result.proposal).not.toMatch(
      /90[- ]?day|九十日|一定|保證|guarantee|publish|發佈|points?|XP/i,
    );
    expect(result.sampleOnly).toBe(true);
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "proposal_only",
        "sample_data_only",
        "no_publish_or_points_authority",
      ]),
    );
    expect(result).not.toHaveProperty("publish");
    expect(result).not.toHaveProperty("points");
  });

  it("keeps mock post review to the original metric periods rather than inventing trends", async () => {
    const result = await runGrowthSkill({
      skillId: "post_review",
      report: evidenceReport(),
      creatorGoal: "安排下一個可量度測試",
    });

    expect(result.proposal).toContain("lifetime");
    expect(result.proposal).toContain("30 日");
    expect(result.proposal).toContain("50");
    expect(result.proposal).not.toMatch(/90[- ]?day|九十日|\btrend\b|成長趨勢/i);
  });

  it("uses editable caption placeholders without inventing personal experience or results", async () => {
    const result = await runGrowthSkill({
      skillId: "next_caption",
      report: evidenceReport(),
      creatorGoal: "分享包裝設計",
      voice: "簡潔、親切",
    });

    expect(result.proposal).toContain("文案選項");
    expect(result.proposal).toContain("[");
    expect(result.proposal).toContain("分享包裝設計");
    expect(result.proposal).toContain("簡潔、親切");
    expect(result.proposal).not.toMatch(
      /我用過|親身試過|保證|一定有效|guarantee|guaranteed|結果一定/i,
    );
  });

  it("suggests small testable steps without claiming an algorithm outcome", async () => {
    const result = await runGrowthSkill({
      skillId: "next_growth_step",
      report: evidenceReport(),
      creatorGoal: "比較兩種開場方式",
    });

    expect(result.proposal).toMatch(/測試|test/i);
    expect(result.proposal).toMatch(/記錄|record/i);
    expect(result.proposal).not.toMatch(
      /演算法保證|保證增加|guaranteed reach|viral guarantee/i,
    );
  });

  it("preserves Task 1 native and curated provenance as inert source references", async () => {
    const nativeReport = evidenceReport();
    const nativeResult = await runGrowthSkill({
      skillId: "image_diagnosis",
      report: nativeReport,
      creatorGoal: "改善構圖",
    });
    const curatedResult = await runGrowthSkill({
      skillId: "post_review",
      report: nativeReport,
      creatorGoal: "改善表現檢討",
    });

    expect(nativeResult.sourceRefs).toContain(
      "native:kocmax-image-diagnosis-v1",
    );
    expect(curatedResult.sourceRefs).toEqual(
      expect.arrayContaining([
        "curated:social-media-skills/skills@f28cef2b7067ec64e79c9d85421c022c06659e03#content-audit",
        "curated:social-media-skills/skills@f28cef2b7067ec64e79c9d85421c022c06659e03#analytics-and-reporting",
      ]),
    );
  });

  it("does not call an injected external writer without processing approval", async () => {
    const write = vi.fn(async () => "external proposal");
    const writer: SkillWriter = {
      kind: "external",
      write,
    };

    const result = await runGrowthSkill(
      {
        skillId: "post_review",
        report: evidenceReport(),
        creatorGoal: "改善表現檢討",
      },
      {
        writer,
        processingApproved: false,
      },
    );

    expect(write).not.toHaveBeenCalled();
    expect(result.sampleOnly).toBe(true);
    expect(result.limitations).toContain("external_model_not_approved");
  });

  it("default-denies external writing for a creator-upload observation without public-image permission", async () => {
    const write = vi.fn(async () => "external proposal");
    const writer: SkillWriter = {
      kind: "external",
      write,
    };
    const report = evidenceReport({
      sampleOnly: false,
    });

    const result = await runGrowthSkill(
      {
        skillId: "post_review",
        report,
        creatorGoal: "改善表現檢討",
      },
      {
        writer,
        processingApproved: true,
      },
    );

    expect(report.sourcePermission).toEqual({
      publicImage: "denied",
      basis: "default_denied",
    });
    expect(report.availability.selfUploadManual).toBe("manual");
    expect(write).not.toHaveBeenCalled();
    expect(result.limitations).toContain("external_writer_unavailable");
    expect(result.limitations).toContain("source_permission_not_approved");
  });

  it("keeps external writers unavailable even with processing and source approval", async () => {
    const write = vi.fn(async () => "我試過這個方法，保證有效");
    const writer: SkillWriter = {
      kind: "external",
      write,
    };

    const result = await runGrowthSkill(
      {
        skillId: "post_review",
        report: evidenceReport({
          sourcePermission: "denied",
        }),
        creatorGoal: "改善表現檢討",
      },
      {
        writer,
        processingApproved: true,
      },
    );

    expect(write).not.toHaveBeenCalled();
    expect(result.limitations).toContain("source_permission_not_approved");
    expect(result.limitations).toContain("external_writer_unavailable");
  });

  it("never trusts an approved external writer's unsourced personal-result claim", async () => {
    const write = vi.fn(async () => "我試過這個方法，保證有效");
    const writer: SkillWriter = {
      kind: "external",
      write,
    };

    const result = await runGrowthSkill(
      {
        skillId: "next_growth_step",
        report: evidenceReport(),
        creatorGoal: "比較兩種開場方式",
      },
      {
        writer,
        processingApproved: true,
      },
    );

    expect(write).not.toHaveBeenCalled();
    expect(result.proposal).toContain("lifetime");
    expect(result.proposal).not.toContain("我試過這個方法，保證有效");
    expect(result.limitations).toContain("external_writer_unavailable");
    expect(result.limitations).toContain("local_mock_writer");
  });
});
