import type {
  AppendCreatorNoteCommand,
  ApplyCreatorReviewCommand,
  CreatorCaseCommandContext,
  CreatorCaseReadContext,
  CreatorCaseReadModel,
  CreatorReviewQueue,
  CreatorReviewQueueFilters,
  ReviewPublicationProofCommand,
} from "./types.js";

export interface CreatorCaseRepository {
  listReviewQueue(
    context: CreatorCaseReadContext,
    filters: CreatorReviewQueueFilters,
  ): Promise<CreatorReviewQueue>;

  getCase(
    context: CreatorCaseReadContext,
    creatorId: string,
  ): Promise<CreatorCaseReadModel>;

  applyReview(
    context: CreatorCaseCommandContext,
    command: ApplyCreatorReviewCommand,
  ): Promise<CreatorCaseReadModel>;

  appendNote(
    context: CreatorCaseCommandContext,
    command: AppendCreatorNoteCommand,
  ): Promise<CreatorCaseReadModel>;

  reviewPublicationProof(
    context: CreatorCaseCommandContext,
    command: ReviewPublicationProofCommand,
  ): Promise<CreatorCaseReadModel>;
}
