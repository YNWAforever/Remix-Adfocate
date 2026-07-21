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
