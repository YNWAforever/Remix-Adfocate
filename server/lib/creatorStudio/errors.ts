export type CreatorStudioErrorCode =
  | "command_required"
  | "command_conflict"
  | "version_conflict"
  | "submission_not_found"
  | "work_item_not_found"
  | "invalid_transition"
  | "draft_invalid"
  | "file_not_allowed"
  | "file_too_large"
  | "asset_not_found"
  | "asset_not_uploaded"
  | "asset_finalized"
  | "proof_url_invalid"
  | "proof_platform_invalid"
  | "proof_attempt_immutable"
  | "proof_attempt_transition_invalid"
  | "proof_evidence_invalid"
  | "proof_metadata_refresh_failed"
  | "storage_error"
  | "db_error";

export class CreatorStudioError extends Error {
  readonly code: CreatorStudioErrorCode;
  readonly publicMessage: string;
  readonly correlationId?: string;

  constructor(code: CreatorStudioErrorCode, publicMessage: string, correlationId?: string) {
    super(publicMessage);
    this.name = "CreatorStudioError";
    this.code = code;
    this.publicMessage = publicMessage;
    this.correlationId = correlationId;
  }
}
