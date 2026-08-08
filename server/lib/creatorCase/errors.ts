export type CreatorCaseErrorCode =
  | "workspace_required"
  | "creator_not_found"
  | "mission_not_found"
  | "workspace_mismatch"
  | "bad_review_status"
  | "bad_risk_level"
  | "bad_note_category"
  | "bad_note_body"
  | "flagged_review_note_required"
  | "command_conflict"
  | "db_error"
  | "enrichment_unavailable";

export class CreatorCaseError extends Error {
  readonly code: CreatorCaseErrorCode;
  readonly publicMessage: string;
  readonly correlationId?: string;

  constructor(
    code: CreatorCaseErrorCode,
    publicMessage: string,
    correlationId?: string,
  ) {
    super(publicMessage);
    this.name = "CreatorCaseError";
    this.code = code;
    this.publicMessage = publicMessage;
    this.correlationId = correlationId;
  }
}
