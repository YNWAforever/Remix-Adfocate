import { describe, expect, it } from "vitest";

import type { EvidenceValue } from "../../../src/lib/integrations/types.js";
import type { ImageAnalysisResult } from "./imageAnalysis.js";
import {
  buildGrowthEvidence,
  type PublicImageEvidenceMatch,
} from "./report.js";

const ASSET_ID = "asset-growth-sample";
const ASSET_SHA256 =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RUN_AT = "2026-11-04T08:30:00.000Z";

function providerMetric(
  value: number | null,
  availability: EvidenceValue["availability"] = "available",
): EvidenceValue {
  return {
    value,
    availability,
    reason:
      availability === "available"
        ? null
        : `${availability}_fixture`,
  };
}

function malformedMetric(value: unknown): EvidenceValue {
  return {
    value,
    availability: "available",
    reason: null,
  } as EvidenceValue;
}

const OBSERVATION = Object.freeze({
  observation: Object.freeze({
    availability: "observed" as const,
    objects: Object.freeze(["ceramic cup"]),
    visibleText: Object.freeze([]),
    composition: Object.freeze(["centered product"]),
    captionAlignment: "uncertain" as const,
    uncertainties: Object.freeze(["Audience location is unknown."]),
    sampleOnly: true,
  }),
  binding: Object.freeze({
    assetId: ASSET_ID,
    sha256: ASSET_SHA256,
    sourceKind: "synthetic-fixture" as const,
    fixtureId: "fixture:growth-sample",
  }),
}) satisfies ImageAnalysisResult;

const MANUAL_SYNTHETIC_OBSERVATION = Object.freeze({
  observation: Object.freeze({
    availability: "manual" as const,
    reason: "processing_not_approved" as const,
    objects: Object.freeze([]),
    visibleText: Object.freeze([]),
    composition: Object.freeze([]),
    captionAlignment: "unavailable" as const,
    uncertainties: Object.freeze(["processing_not_approved"]),
    sampleOnly: false,
  }),
  binding: Object.freeze({
    assetId: ASSET_ID,
    sha256: ASSET_SHA256,
    sourceKind: "synthetic-fixture" as const,
    fixtureId: "fixture:growth-sample",
  }),
}) satisfies ImageAnalysisResult;

const PUBLIC_IMAGE_MATCH: PublicImageEvidenceMatch = Object.freeze({
  status: "matched",
  reason: "exact_media_reference",
  sourceRef: "mock-public:post-123",
  fetchedAt: "2026-11-04T08:20:00.000Z",
  sampleOnly: true,
  rights: "allowed",
  selectedAsset: Object.freeze({
    assetId: ASSET_ID,
    sha256: ASSET_SHA256,
  }),
});

describe("buildGrowthEvidence", () => {
  it("keeps the actual question, platform, run time, and source times in the report", () => {
    const report = buildGrowthEvidence({
      question: "點樣改善呢張相嘅構圖？",
      officialSnapshots: [
        {
          sourceRef: "official-insights:post-123",
          fetchedAt: "2026-11-04T08:15:00.000Z",
          period: {
            kind: "lifetime",
          },
          metrics: {
            reach: providerMetric(42),
          },
        },
      ],
      publicImageMatch: PUBLIC_IMAGE_MATCH,
      sourcePermission: {
        publicImage: "allowed",
      },
      observation: OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.question).toBe("點樣改善呢張相嘅構圖？");
    expect(report.platform).toBe("instagram");
    expect(report.runAt).toBe(RUN_AT);
    expect(report.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "official_metrics",
          sourceRef: "official-insights:post-123",
          observedAt: "2026-11-04T08:15:00.000Z",
        }),
        expect.objectContaining({
          sourceKind: "public_image_mock",
          sourceRef: "mock-public:post-123",
          observedAt: "2026-11-04T08:20:00.000Z",
        }),
      ]),
    );
  });

  it("maps the provider-shaped reach, views, likes, and saves envelopes honestly", () => {
    const report = buildGrowthEvidence({
      question: "Review these provider metrics",
      officialSnapshots: [
        {
          sourceRef: "official-insights:post-provider",
          fetchedAt: "2026-11-04T08:15:00.000Z",
          period: null,
          measurementPeriod: "lifetime",
          metrics: {
            reach: providerMetric(0),
            views: providerMetric(null, "unsupported"),
            likes: providerMetric(null, "missing"),
            saves: providerMetric(3),
          },
        },
      ],
      publicImageMatch: null,
      observation: OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "reach",
          value: 0,
          status: "available",
          reason: null,
        }),
        expect.objectContaining({
          metric: "views",
          value: null,
          status: "unavailable",
          reason: "metric_unsupported",
        }),
        expect.objectContaining({
          metric: "likes",
          value: null,
          status: "unavailable",
          reason: "metric_missing",
        }),
        expect.objectContaining({
          metric: "saves",
          value: 3,
          status: "available",
          reason: null,
        }),
        expect.objectContaining({
          metric: "comments",
          value: null,
          reason: "metric_missing",
        }),
      ]),
    );
    expect(report.metrics.map((metric) => metric.metric)).not.toContain(
      "saved",
    );
    expect(report.availability.officialMetrics).toBe("partial");
    expect(report.period.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "views", kind: "lifetime" }),
        expect.objectContaining({ metric: "saves", kind: "lifetime" }),
      ]),
    );
  });

  it("keeps empty and invalid enveloped values null with explicit reasons", () => {
    const report = buildGrowthEvidence({
      question: "Review malformed metric enveloped values",
      officialSnapshots: [
        {
          sourceRef: "official-insights:post-invalid",
          fetchedAt: "2026-11-04T08:15:00.000Z",
          period: {
            kind: "lifetime",
          },
          metrics: {
            likes: malformedMetric(""),
            comments: malformedMetric(-1),
          },
        },
      ],
      publicImageMatch: null,
      observation: OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "likes",
          value: null,
          reason: "metric_empty",
        }),
        expect.objectContaining({
          metric: "comments",
          value: null,
          reason: "metric_invalid",
        }),
      ]),
    );
  });

  it("returns partial official availability when valid and unavailable metrics coexist", () => {
    const report = buildGrowthEvidence({
      question: "Review partial metrics",
      officialSnapshots: [
        {
          sourceRef: "official-insights:post-partial",
          fetchedAt: "2026-11-04T08:15:00.000Z",
          period: {
            kind: "lifetime",
          },
          metrics: {
            reach: providerMetric(2),
            views: providerMetric(null, "unsupported"),
          },
        },
      ],
      publicImageMatch: null,
      observation: OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.availability.officialMetrics).toBe("partial");
    expect(report.partial).toBe(true);
    expect(report.partialReasons).toEqual(
      expect.arrayContaining(["metric:views:metric_unsupported"]),
    );
  });

  it("separates the 30-day and 50-media selection limit from each metric period", () => {
    const report = buildGrowthEvidence({
      question: "Which small test should I run next?",
      officialSnapshots: [
        {
          sourceRef: "official-insights:post-789",
          fetchedAt: "2026-11-04T08:15:00.000Z",
          period: {
            kind: "lifetime",
          },
          metrics: {
            views: providerMetric(120),
          },
        },
      ],
      publicImageMatch: null,
      observation: OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.period.selection).toEqual({
      windowDays: 30,
      mediaLimit: 50,
      appliesTo: "selection_only",
    });
    expect(report.period.metrics).toEqual([
      expect.objectContaining({
        metric: "views",
        kind: "lifetime",
        sourceRef: "official-insights:post-789",
      }),
    ]);
    expect(JSON.stringify(report)).not.toMatch(/90[- ]?day|九十日|\btrend\b/i);
  });

  it("marks HK and Traditional Chinese audience coverage as unverified without inference", () => {
    const report = buildGrowthEvidence({
      question: "How should I test my next post?",
      officialSnapshots: [],
      publicImageMatch: null,
      observation: OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.region).toEqual({
      requested: "Hong Kong",
      verified: false,
      value: null,
      label: "未驗證",
      reason: "official_region_coverage_missing",
    });
    expect(report.language).toEqual({
      requested: "zh-Hant",
      verified: false,
      value: null,
      label: "未驗證",
      reason: "official_language_coverage_missing",
    });
    expect(report.partial).toBe(true);
  });

  it("accepts a structurally valid mutable canonical record and freezes only the output", () => {
    const report = buildGrowthEvidence({
      question: "Review this image",
      officialSnapshots: [],
      publicImageMatch: PUBLIC_IMAGE_MATCH,
      sourcePermission: {
        publicImage: "allowed",
      },
      observation: {
        observation: {
          ...OBSERVATION.observation,
        },
        binding: {
          ...OBSERVATION.binding,
        },
      },
      runAt: RUN_AT,
    });

    expect(Object.isFrozen(report)).toBe(true);
    expect(report.provenance.publicImageMock).not.toBeNull();
    expect(Reflect.set(report, "partial", true)).toBe(false);
  });

  it("rejects a public image whose selected asset id or digest differs from Task 3", () => {
    expect(() =>
      buildGrowthEvidence({
        question: "Review this image",
        officialSnapshots: [],
        publicImageMatch: {
          ...PUBLIC_IMAGE_MATCH,
          selectedAsset: {
            assetId: ASSET_ID,
            sha256:
              "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
        },
        sourcePermission: {
          publicImage: "allowed",
        },
        observation: OBSERVATION,
        runAt: RUN_AT,
      }),
    ).toThrow(
      expect.objectContaining({
        name: "GrowthEvidenceError",
        code: "ASSET_BINDING_MISMATCH",
      }),
    );
  });

  it("default-denies public-image permission when no explicit permission is supplied", () => {
    const report = buildGrowthEvidence({
      question: "Review this image",
      officialSnapshots: [],
      publicImageMatch: {
        ...PUBLIC_IMAGE_MATCH,
        rights: "allowed",
      },
      observation: OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.sourcePermission).toEqual({
      publicImage: "denied",
      basis: "default_denied",
    });
    expect(report.availability.publicImageMock).toBe("unavailable");
    expect(report.provenance.publicImageMock).toBeNull();
  });

  it("keeps candidate rights separate from explicit source permission", () => {
    const report = buildGrowthEvidence({
      question: "Review this image",
      officialSnapshots: [],
      publicImageMatch: {
        ...PUBLIC_IMAGE_MATCH,
        rights: "unknown",
      },
      sourcePermission: {
        publicImage: "allowed",
      },
      observation: OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.sourcePermission).toEqual({
      publicImage: "allowed",
      basis: "explicit",
    });
    expect(report.availability.publicImageMock).toBe("unavailable");
    expect(report.provenance.publicImageMock).toBeNull();
  });

  it("keeps manual observation mode separate from synthetic source kind", () => {
    const report = buildGrowthEvidence({
      question: "Review this synthetic fixture manually",
      officialSnapshots: [],
      publicImageMatch: null,
      observation: MANUAL_SYNTHETIC_OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.observation).toEqual(
      expect.objectContaining({
        availability: "manual",
        reason: "processing_not_approved",
        sourceKind: "synthetic-fixture",
      }),
    );
    expect(report.availability.selfUploadManual).toBe("manual");
    expect(report.provenance.selfUploadManual).toEqual(
      expect.objectContaining({
        sourceKind: "synthetic-fixture",
        manualMode: "manual_observation",
      }),
    );
  });

  it("keeps source kinds and sample status independent", () => {
    const report = buildGrowthEvidence({
      question: "Review this post",
      officialSnapshots: [
        {
          sourceRef: "official-insights:post-999",
          fetchedAt: "2026-11-04T08:15:00.000Z",
          period: {
            kind: "lifetime",
          },
          metrics: {
            likes: providerMetric(0),
          },
        },
      ],
      publicImageMatch: PUBLIC_IMAGE_MATCH,
      sourcePermission: {
        publicImage: "allowed",
      },
      observation: OBSERVATION,
      runAt: RUN_AT,
    });

    expect(report.availability.officialMetrics).toBe("partial");
    expect(report.availability.publicImageMock).toBe("mock");
    expect(report.availability.selfUploadManual).toBe("not_applicable");
    expect(report.provenance.officialMetrics).toEqual([
      expect.objectContaining({
        sourceKind: "official_metrics",
        sampleOnly: false,
      }),
    ]);
    expect(report.provenance.publicImageMock).toEqual(
      expect.objectContaining({
        sourceKind: "public_image_mock",
        sampleOnly: true,
      }),
    );
    expect(report.sampleOnly).toBe(true);
  });

  it("redacts unsafe question and source values from a bounded report", () => {
    const report = buildGrowthEvidence({
      question:
        "Review https://temporary.example/photo?token=sensitive-test-value",
      officialSnapshots: [
        {
          sourceRef: "https://temporary.example/insights?access_token=secret",
          fetchedAt: "2026-11-04T08:15:00.000Z",
          period: {
            kind: "lifetime",
          },
          metrics: {
            reach: providerMetric(12),
          },
        },
      ],
      publicImageMatch: null,
      observation: OBSERVATION,
      runAt: RUN_AT,
    });
    const serialized = JSON.stringify(report);

    expect(serialized).not.toMatch(
      /temporary\.example|access_token|sensitive-test-value/,
    );
    expect(Array.from(report.question).length).toBeLessThanOrEqual(1000);
    expect(Array.from(serialized).length).toBeLessThan(20_000);
  });
});
