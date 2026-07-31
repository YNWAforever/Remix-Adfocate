import { describe, expect, it } from "vitest";

import {
  calculateOnTimeApprovalMetric,
  calculatePublicationProofOperationalMetrics,
  calculateRewardHandoffOperationalMetrics,
  type PublicationProofMetricRow,
  type RewardHandoffMetricRow,
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

  it("excludes malformed attempt counts from the verified-attempt average", () => {
    const metrics = calculatePublicationProofOperationalMetrics([
      metricRow({ attemptCount: Number.NaN }),
      metricRow({ attemptCount: Number.POSITIVE_INFINITY }),
      metricRow({ attemptCount: -1 }),
      metricRow({ attemptCount: 0 }),
      metricRow({ attemptCount: 1.5 }),
      metricRow({ attemptCount: 2 }),
    ]);

    expect(metrics.averageAttemptsPerVerifiedItem).toBe(2);
  });
});

const rewardHandoffRow = (
  overrides: Partial<RewardHandoffMetricRow> = {},
): RewardHandoffMetricRow => ({
  status: "pending",
  targetAt: "2026-07-31T15:00:00Z",
  proofVerifiedAt: "2026-07-31T10:00:00Z",
  rewardPendingAt: "2026-07-31T11:00:00Z",
  completionApprovedAt: "2026-07-31T11:00:00Z",
  cancelledAt: null,
  rewardContractId: "11111111-1111-4111-8111-111111111111",
  ...overrides,
});

describe("calculateRewardHandoffOperationalMetrics", () => {
  it("counts pending, overdue, cancelled, latency, and missing-contract operations", () => {
    const now = new Date("2026-07-31T14:00:00Z");
    const rows: RewardHandoffMetricRow[] = [
      rewardHandoffRow({ targetAt: "2026-07-31T13:00:00Z", rewardContractId: null }),
      rewardHandoffRow({
        targetAt: "2026-07-31T15:00:00Z",
        proofVerifiedAt: "2026-07-31T10:00:00Z",
        rewardPendingAt: "2026-07-31T12:00:00Z",
        completionApprovedAt: "2026-07-31T12:00:00Z",
        rewardContractId: null,
      }),
      rewardHandoffRow({
        status: "cancelled",
        proofVerifiedAt: null,
        rewardPendingAt: null,
        completionApprovedAt: "2026-07-31T09:00:00Z",
        cancelledAt: "2026-07-31T13:30:00Z",
        rewardContractId: null,
      }),
    ];

    expect(calculateRewardHandoffOperationalMetrics(rows, now)).toEqual({
      pendingCount: 2,
      overdueCount: 1,
      cancellationRate: 0.25,
      medianProofVerifiedToPendingMinutes: 90,
      missingContractCount: 3,
    });
  });

  it("defines empty and invalid cohorts without contaminating metric denominators", () => {
    expect(calculateRewardHandoffOperationalMetrics([], new Date("2026-07-31T14:00:00Z")))
      .toEqual({
        pendingCount: 0,
        overdueCount: 0,
        cancellationRate: 0,
        medianProofVerifiedToPendingMinutes: null,
        missingContractCount: 0,
      });

    const valid = rewardHandoffRow({
      status: "cancelled",
      completionApprovedAt: "2026-07-31T11:00:00Z",
      cancelledAt: "2026-07-31T12:00:00Z",
      proofVerifiedAt: "2026-07-31T10:00:00Z",
      rewardPendingAt: "2026-07-31T11:00:00Z",
    });
    const invalid = rewardHandoffRow({
      targetAt: Number.POSITIVE_INFINITY as never,
      proofVerifiedAt: "not-a-date",
      rewardPendingAt: Number.NaN as never,
      completionApprovedAt: "not-a-date",
      cancelledAt: Number.POSITIVE_INFINITY as never,
    });

    expect(calculateRewardHandoffOperationalMetrics(
      [valid, invalid],
      new Date("2026-07-31T14:00:00Z"),
    )).toEqual({
      pendingCount: 1,
      overdueCount: 0,
      cancellationRate: 0.5,
      medianProofVerifiedToPendingMinutes: 60,
      missingContractCount: 0,
    });
    expect(calculateRewardHandoffOperationalMetrics(
      [rewardHandoffRow({ targetAt: "2026-07-31T13:00:00Z" })],
      new Date(Number.NaN),
    ).overdueCount).toBe(0);
  });

  it("excludes negative proof-to-pending durations from the median", () => {
    const metrics = calculateRewardHandoffOperationalMetrics([
      rewardHandoffRow({
        proofVerifiedAt: "2026-07-31T12:00:00Z",
        rewardPendingAt: "2026-07-31T11:00:00Z",
      }),
    ], new Date("2026-07-31T14:00:00Z"));

    expect(metrics.medianProofVerifiedToPendingMinutes).toBeNull();
  });
});
