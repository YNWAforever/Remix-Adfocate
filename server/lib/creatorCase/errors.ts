export type CreatorCaseErrorCode =
  | "workspace_required"
  | "actor_required"
  | "actor_label_required"
  | "command_required"
  | "creator_not_found"
  | "mission_not_found"
  | "workspace_mismatch"
  | "bad_review_status"
  | "bad_risk_level"
  | "bad_note_category"
  | "bad_note_body"
  | "flagged_review_note_required"
  | "proof_decision_invalid"
  | "proof_message_required"
  | "proof_attempt_not_found"
  | "proof_lineage_mismatch"
  | "proof_attempt_not_submitted"
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
