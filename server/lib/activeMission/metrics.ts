export type OnTimeApprovalRow = {
  required: boolean;
  deadline: string | null;
  approvedAt: string | null;
};

export type OnTimeApprovalMetric = {
  numerator: number;
  denominator: number;
  rate: number;
};

export function calculateOnTimeApprovalMetric(
  rows: readonly OnTimeApprovalRow[],
): OnTimeApprovalMetric {
  const eligible = rows.filter(
    (row): row is OnTimeApprovalRow & { deadline: string } =>
      row.required && row.deadline !== null,
  );
  const numerator = eligible.filter((row) => {
    if (row.approvedAt === null) {
      return false;
    }
    const deadline = Date.parse(row.deadline);
    const approvedAt = Date.parse(row.approvedAt);
    return Number.isFinite(deadline)
      && Number.isFinite(approvedAt)
      && approvedAt <= deadline;
  }).length;
  const denominator = eligible.length;

  return { numerator, denominator, rate: denominator === 0 ? 0 : numerator / denominator };
}

export type PublicationProofMetricRow = {
  required: boolean;
  approvedToPublishAt: string | null;
  publicationDueAt: string | null;
  firstSubmittedAt: string | null;
  verifiedAt: string | null;
  attemptCount: number;
  correctionCount: number;
  reviewStartedAt: string | null;
  reviewCompletedAt: string | null;
  metadataStatus: "available" | "unavailable" | null;
  staleRecoveryCount: number;
};

export type RateMetric = { numerator: number; denominator: number; rate: number };

export type PublicationProofOperationalMetrics = {
  submissionConversion: RateMetric;
  onTimePublication: RateMetric;
  firstAttemptVerification: RateMetric;
  correctionRequest: RateMetric;
  averageAttemptsPerVerifiedItem: number;
  medianReviewTimeMs: number | null;
  metadataFailure: RateMetric;
  staleRecovery: RateMetric;
};

function rateMetric(numerator: number, denominator: number): RateMetric {
  return { numerator, denominator, rate: denominator === 0 ? 0 : numerator / denominator };
}

function validTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function calculatePublicationProofOperationalMetrics(
  rows: readonly PublicationProofMetricRow[],
): PublicationProofOperationalMetrics {
  const requiredRows = rows.filter((row) => row.required);
  const approvedRows = requiredRows.filter(
    (row) => validTimestamp(row.approvedToPublishAt) !== null,
  );
  const submittedRows = requiredRows.filter(
    (row) => validTimestamp(row.firstSubmittedAt) !== null,
  );
  const dueRows = approvedRows.filter(
    (row) => validTimestamp(row.publicationDueAt) !== null,
  );
  const verifiedRows = submittedRows.filter(
    (row) => validTimestamp(row.verifiedAt) !== null,
  );
  const metadataRows = submittedRows.filter((row) => row.metadataStatus !== null);

  const submissionConversion = rateMetric(
    approvedRows.filter((row) => validTimestamp(row.firstSubmittedAt) !== null).length,
    approvedRows.length,
  );
  const onTimePublication = rateMetric(
    dueRows.filter((row) => {
      const submittedAt = validTimestamp(row.firstSubmittedAt);
      const dueAt = validTimestamp(row.publicationDueAt);
      return submittedAt !== null && dueAt !== null && submittedAt <= dueAt;
    }).length,
    dueRows.length,
  );
  const firstAttemptVerification = rateMetric(
    submittedRows.filter((row) =>
      validTimestamp(row.verifiedAt) !== null && row.attemptCount === 1).length,
    submittedRows.length,
  );
  const correctionRequest = rateMetric(
    submittedRows.filter((row) => Number.isFinite(row.correctionCount) && row.correctionCount > 0).length,
    submittedRows.length,
  );
  const verifiedRowsWithValidAttemptCount = verifiedRows.filter(
    (row) => Number.isInteger(row.attemptCount) && row.attemptCount >= 1,
  );
  const attemptTotal = verifiedRowsWithValidAttemptCount.reduce(
    (total, row) => total + row.attemptCount,
    0,
  );
  const reviewDurations = requiredRows.flatMap((row) => {
    const startedAt = validTimestamp(row.reviewStartedAt);
    const completedAt = validTimestamp(row.reviewCompletedAt);
    if (startedAt === null || completedAt === null) return [];
    const duration = completedAt - startedAt;
    return Number.isFinite(duration) && duration >= 0 ? [duration] : [];
  });

  return {
    submissionConversion,
    onTimePublication,
    firstAttemptVerification,
    correctionRequest,
    averageAttemptsPerVerifiedItem: verifiedRowsWithValidAttemptCount.length === 0
      ? 0
      : attemptTotal / verifiedRowsWithValidAttemptCount.length,
    medianReviewTimeMs: median(reviewDurations),
    metadataFailure: rateMetric(
      metadataRows.filter((row) => row.metadataStatus === "unavailable").length,
      metadataRows.length,
    ),
    staleRecovery: rateMetric(
      submittedRows.filter((row) =>
        Number.isFinite(row.staleRecoveryCount) && row.staleRecoveryCount > 0).length,
      submittedRows.length,
    ),
  };
}

export type RewardHandoffMetricRow = {
  status: "pending" | "cancelled";
  targetAt: string | null;
  proofVerifiedAt: string | null;
  rewardPendingAt: string | null;
  completionApprovedAt: string | null;
  cancelledAt: string | null;
  rewardContractId: string | null;
};

export type RewardHandoffOperationalMetrics = {
  pendingCount: number;
  overdueCount: number;
  cancellationRate: number;
  medianProofVerifiedToPendingMinutes: number | null;
  missingContractCount: number;
};

export function calculateRewardHandoffOperationalMetrics(
  rows: readonly RewardHandoffMetricRow[],
  now: Date,
): RewardHandoffOperationalMetrics {
  const nowTimestamp = now.getTime();
  const pendingRows = rows.filter((row) => row.status === "pending");
  const approvalDecisionCount = rows.filter(
    (row) => validTimestamp(row.completionApprovedAt) !== null,
  ).length;
  const cancellationDecisionCount = rows.filter(
    (row) => validTimestamp(row.cancelledAt) !== null,
  ).length;
  const decisionCount = approvalDecisionCount + cancellationDecisionCount;
  const durationsMinutes = rows.flatMap((row) => {
    const proofVerifiedAt = validTimestamp(row.proofVerifiedAt);
    const rewardPendingAt = validTimestamp(row.rewardPendingAt);
    if (proofVerifiedAt === null || rewardPendingAt === null) return [];
    const minutes = (rewardPendingAt - proofVerifiedAt) / (60 * 1000);
    return Number.isFinite(minutes) && minutes >= 0 ? [minutes] : [];
  });

  return {
    pendingCount: pendingRows.length,
    overdueCount: Number.isFinite(nowTimestamp)
      ? pendingRows.filter((row) => {
        const targetAt = validTimestamp(row.targetAt);
        return targetAt !== null && targetAt < nowTimestamp;
      }).length
      : 0,
    cancellationRate: decisionCount === 0
      ? 0
      : cancellationDecisionCount / decisionCount,
    medianProofVerifiedToPendingMinutes: median(durationsMinutes),
    missingContractCount: rows.filter((row) => row.rewardContractId === null).length,
  };
}
