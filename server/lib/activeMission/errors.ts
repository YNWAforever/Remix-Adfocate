export type WorkflowErrorCode =
  | "WORKFLOW_NOT_FOUND"
  | "WORKFLOW_MODE_MISMATCH"
  | "WORKFLOW_STALE"
  | "WRONG_STATE"
  | "REVISION_LIMIT_REACHED"
  | "DEADLINE_PASSED"
  | "VALIDATION_FAILED"
  | "ASSET_UPLOAD_FAILED"
  | "NOT_AUTHORIZED"
  | "RATE_LIMITED"
  | "UNKNOWN";

export class ActiveMissionError extends Error {
  constructor(
    public code: WorkflowErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ActiveMissionError";
  }
}

const STATUS_BY_CODE: Record<WorkflowErrorCode, number> = {
  WORKFLOW_NOT_FOUND: 404,
  WORKFLOW_MODE_MISMATCH: 409,
  WORKFLOW_STALE: 409,
  WRONG_STATE: 409,
  REVISION_LIMIT_REACHED: 409,
  DEADLINE_PASSED: 409,
  VALIDATION_FAILED: 400,
  ASSET_UPLOAD_FAILED: 422,
  NOT_AUTHORIZED: 403,
  RATE_LIMITED: 429,
  UNKNOWN: 500,
};

export const statusFor = (code: WorkflowErrorCode) => STATUS_BY_CODE[code];
