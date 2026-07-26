import { describe, expect, it } from "vitest";

import {
  calculateOnTimeApprovalMetric,
  calculatePublicationProofOperationalMetrics,
  type PublicationProofMetricRow,
} from "./metrics";

describe("calculateOnTimeApprovalMetric", () => {
  it("counts a required item approved by its deadline", () => {
    expect(calculateOnTimeApprovalMetric([
      { required: true, deadline: "2026-07-17T00:00:00Z", approvedAt: "2026-07-16T23:00:00Z" },
    ])).toEqual({ numerator: 1, denominator: 1, rate: 1 });
  });

  it("excludes optional and no-deadline items from the denominator", () => {
    expect(calculateOnTimeApprovalMetric([
      { required: false, deadline: "2026-07-17T00:00:00Z", approvedAt: "2026-07-16T23:00:00Z" },
      { required: true, deadline: null, approvedAt: "2026-07-16T23:00:00Z" },
      { required: true, deadline: "2026-07-17T00:00:00Z", approvedAt: "2026-07-17T01:00:00Z" },
    ])).toEqual({ numerator: 0, denominator: 1, rate: 0 });
  });

  it("returns a zero rate when no rows qualify", () => {
    expect(calculateOnTimeApprovalMetric([])).toEqual({
      numerator: 0,
      denominator: 0,
      rate: 0,
    });
  });
});

const metricRow = (
  overrides: Partial<PublicationProofMetricRow> = {},
): PublicationProofMetricRow => ({
  required: true,
  approvedToPublishAt: "2026-07-01T00:00:00Z",
  publicationDueAt: "2026-07-03T00:00:00Z",
  firstSubmittedAt: "2026-07-02T00:00:00Z",
  verifiedAt: "2026-07-04T00:00:00Z",
  attemptCount: 1,
  correctionCount: 0,
  reviewStartedAt: "2026-07-02T00:00:00Z",
  reviewCompletedAt: "2026-07-02T01:00:00Z",
  metadataStatus: "available",
  staleRecoveryCount: 0,
  ...overrides,
});

describe("calculatePublicationProofOperationalMetrics", () => {
  it("returns explicit zero denominators and no median for an empty cohort", () => {
    expect(calculatePublicationProofOperationalMetrics([])).toEqual({
      submissionConversion: { numerator: 0, denominator: 0, rate: 0 },
      onTimePublication: { numerator: 0, denominator: 0, rate: 0 },
      firstAttemptVerification: { numerator: 0, denominator: 0, rate: 0 },
      correctionRequest: { numerator: 0, denominator: 0, rate: 0 },
      averageAttemptsPerVerifiedItem: 0,
      medianReviewTimeMs: null,
      metadataFailure: { numerator: 0, denominator: 0, rate: 0 },
      staleRecovery: { numerator: 0, denominator: 0, rate: 0 },
    });
  });

  it("calculates all eight metrics with required-item denominators and an even median", () => {
    const metrics = calculatePublicationProofOperationalMetrics([
      metricRow(),
      metricRow({
        firstSubmittedAt: "2026-07-04T00:00:00Z",
        verifiedAt: "2026-07-06T00:00:00Z",
        attemptCount: 2,
        correctionCount: 1,
        reviewStartedAt: "2026-07-04T00:00:00Z",
        reviewCompletedAt: "2026-07-04T03:00:00Z",
        metadataStatus: "unavailable",
        staleRecoveryCount: 2,
      }),
      metricRow({
        firstSubmittedAt: null,
        verifiedAt: null,
        attemptCount: 0,
        reviewStartedAt: null,
        reviewCompletedAt: null,
        metadataStatus: null,
      }),
      metricRow({ required: false }),
    ]);

    expect(metrics).toEqual({
      submissionConversion: { numerator: 2, denominator: 3, rate: 2 / 3 },
      onTimePublication: { numerator: 1, denominator: 3, rate: 1 / 3 },
      firstAttemptVerification: { numerator: 1, denominator: 2, rate: 1 / 2 },
      correctionRequest: { numerator: 1, denominator: 2, rate: 1 / 2 },
      averageAttemptsPerVerifiedItem: 1.5,
      medianReviewTimeMs: 2 * 60 * 60 * 1000,
      metadataFailure: { numerator: 1, denominator: 2, rate: 1 / 2 },
      staleRecovery: { numerator: 1, denominator: 2, rate: 1 / 2 },
    });
  });

  it("excludes invalid dates and negative review durations and calculates an odd median", () => {
    const metrics = calculatePublicationProofOperationalMetrics([
      metricRow({
        reviewStartedAt: "2026-07-02T00:00:00Z",
        reviewCompletedAt: "2026-07-02T03:00:00Z",
      }),
      metricRow({
        reviewStartedAt: "2026-07-02T00:00:00Z",
        reviewCompletedAt: "2026-07-02T01:00:00Z",
      }),
      metricRow({
        reviewStartedAt: "2026-07-02T00:00:00Z",
        reviewCompletedAt: "2026-07-02T09:00:00Z",
      }),
      metricRow({
        approvedToPublishAt: "invalid",
        publicationDueAt: "invalid",
        firstSubmittedAt: "invalid",
        verifiedAt: "invalid",
        reviewStartedAt: "invalid",
        reviewCompletedAt: "invalid",
        metadataStatus: null,
      }),
      metricRow({
        reviewStartedAt: "2026-07-02T04:00:00Z",
        reviewCompletedAt: "2026-07-02T03:00:00Z",
      }),
    ]);

    expect(metrics.submissionConversion).toEqual({ numerator: 4, denominator: 4, rate: 1 });
    expect(metrics.onTimePublication).toEqual({ numerator: 4, denominator: 4, rate: 1 });
    expect(metrics.medianReviewTimeMs).toBe(3 * 60 * 60 * 1000);
    expect(metrics.metadataFailure.denominator).toBe(4);
  });

  it("is reward-neutral and exposes exactly the eight operational outputs", () => {
    const row = { ...metricRow(), rewardIssued: true, rewardPoints: 1_000 };
    const withRewardFields = calculatePublicationProofOperationalMetrics([row]);
    const withoutRewardFields = calculatePublicationProofOperationalMetrics([metricRow()]);

    expect(withRewardFields).toEqual(withoutRewardFields);
    expect(Object.keys(withRewardFields)).toEqual([
      "submissionConversion",
      "onTimePublication",
      "firstAttemptVerification",
      "correctionRequest",
      "averageAttemptsPerVerifiedItem",
      "medianReviewTimeMs",
      "metadataFailure",
      "staleRecovery",
    ]);
  });
});
