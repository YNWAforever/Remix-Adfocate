import { NOTE_CATEGORIES, REVIEW_STATUSES, RISK_LEVELS } from "../operatorCrm/types";
import type { CreatorCaseRepository } from "./repository";
import { CreatorCaseError } from "./errors";
import type {
  AppendCreatorNoteCommand,
  ApplyCreatorReviewCommand,
  CreatorAuditEvent,
  CreatorCaseCommandContext,
  CreatorCaseReadContext,
  CreatorCaseReadModel,
  CreatorReviewNote,
} from "./types";

export type InMemoryFailurePoint = "after_review" | "after_note" | "after_audit";

type CompletedCommand = {
  payload: unknown;
  result: CreatorCaseReadModel;
};

export type InMemoryCreatorCaseRepositoryOptions = {
  cases: CreatorCaseReadModel[];
  failurePoint?: InMemoryFailurePoint;
};

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryCreatorCaseRepository implements CreatorCaseRepository {
  private readonly cases = new Map<string, CreatorCaseReadModel>();
  private readonly completedCommands = new Map<string, CompletedCommand>();
  private readonly failurePoint?: InMemoryFailurePoint;

  constructor(options: InMemoryCreatorCaseRepositoryOptions) {
    this.failurePoint = options.failurePoint;
    for (const creatorCase of options.cases) {
      this.cases.set(this.caseKey(creatorCase.creator.workspaceId, creatorCase.creator.id), clone(creatorCase));
    }
  }

  async listReviewQueue(
    context: CreatorCaseReadContext,
    filters: {
      status?: CreatorCaseReadModel["review"]["status"];
      riskLevel?: CreatorCaseReadModel["review"]["riskLevel"];
      missionId?: string;
      q?: string;
      page: number;
      pageSize: number;
      sort: "last_activity" | "trust_score" | "level" | "social_freshness";
    },
  ) {
    this.validateContext(context);
    const matches = [...this.cases.values()].filter((creatorCase) => {
      if (creatorCase.creator.workspaceId !== context.workspaceId) return false;
      if (filters.status && creatorCase.review.status !== filters.status) return false;
      if (filters.riskLevel && creatorCase.review.riskLevel !== filters.riskLevel) return false;
      if (filters.q && !creatorCase.creator.displayName?.toLowerCase().includes(filters.q.toLowerCase())) return false;
      return true;
    });
    const start = (filters.page - 1) * filters.pageSize;
    return {
      creators: matches.slice(start, start + filters.pageSize).map((creatorCase) => ({
        id: creatorCase.creator.id,
        displayName: creatorCase.creator.displayName ?? "",
        avatarUrl: creatorCase.creator.avatarUrl,
        level: creatorCase.creator.level ?? "",
        categories: clone(creatorCase.creator.categories),
        scores: clone(creatorCase.creator.scores),
        social: creatorCase.social.status === "available"
          ? creatorCase.social.value.summary
          : {
              platforms: [], syncStatus: null, followerCount: null, engagementRate: null,
              apiSyncedAt: null, label: "Not synced" as const, ownershipLabel: "Ownership not verified" as const,
            },
        profileMedia: {
          avatarUrl: creatorCase.creator.avatarUrl,
          portfolioCount: 0,
          publicHighlightCount: 0,
          completenessScore: creatorCase.profile.status === "available" ? creatorCase.profile.value.completeness.score : 0,
        },
        review: clone(creatorCase.review),
        shortlist: null,
        lastActivityAt: creatorCase.review.updatedAt,
      })),
      page: filters.page,
      pageSize: filters.pageSize,
      total: matches.length,
    };
  }

  async getCase(context: CreatorCaseReadContext, creatorId: string): Promise<CreatorCaseReadModel> {
    return clone(this.findCase(context, creatorId));
  }

  async applyReview(context: CreatorCaseCommandContext, command: ApplyCreatorReviewCommand): Promise<CreatorCaseReadModel> {
    this.validateContext(context);
    const payload = { context, command };
    const replay = this.replay(context.commandId, payload);
    if (replay) return replay;

    const current = this.findCase(context, command.creatorId);
    this.validateReview(command);
    const working = clone(current);
    const timestamp = new Date().toISOString();
    working.review = {
      status: command.status,
      riskLevel: command.riskLevel,
      summary: command.summary,
      reviewedBy: context.actorId,
      lastReviewedAt: timestamp,
      updatedAt: timestamp,
    };
    this.failIf("after_review");

    if (command.note) {
      working.notes.push(this.makeNote(context, command.creatorId, command.note, `${context.commandId}:note`, timestamp));
      this.failIf("after_note");
    }

    working.audit.push(this.makeAudit(context, command.creatorId, "creator_review.updated", `${context.commandId}:review`, timestamp, {
      status: command.status,
      riskLevel: command.riskLevel,
      summary: command.summary,
    }));
    if (command.note) {
      working.audit.push(this.makeAudit(context, command.creatorId, "creator_note.created", `${context.commandId}:note`, timestamp, {
        category: command.note.category,
      }));
    }
    this.failIf("after_audit");

    return this.commit(context.commandId, payload, context.workspaceId, command.creatorId, working);
  }

  async appendNote(context: CreatorCaseCommandContext, command: AppendCreatorNoteCommand): Promise<CreatorCaseReadModel> {
    this.validateContext(context);
    const payload = { context, command };
    const replay = this.replay(context.commandId, payload);
    if (replay) return replay;

    const current = this.findCase(context, command.creatorId);
    this.validateNote(command.category, command.body);
    const working = clone(current);
    const timestamp = new Date().toISOString();
    working.notes.push(this.makeNote(context, command.creatorId, command, `${context.commandId}:note`, timestamp));
    working.audit.push(this.makeAudit(context, command.creatorId, "creator_note.created", `${context.commandId}:note`, timestamp, {
      category: command.category,
    }));
    return this.commit(context.commandId, payload, context.workspaceId, command.creatorId, working);
  }

  private caseKey(workspaceId: string, creatorId: string): string {
    return `${workspaceId}:${creatorId}`;
  }

  private validateContext(context: CreatorCaseReadContext & Partial<Pick<CreatorCaseCommandContext, "commandId">>): void {
    if (!context.workspaceId) throw new CreatorCaseError("workspace_required", "workspaceId is required");
    if ("commandId" in context && !context.commandId) throw new CreatorCaseError("db_error", "commandId is required");
  }

  private findCase(context: CreatorCaseReadContext, creatorId: string): CreatorCaseReadModel {
    const found = this.cases.get(this.caseKey(context.workspaceId, creatorId));
    if (found) return found;
    if ([...this.cases.values()].some((creatorCase) => creatorCase.creator.id === creatorId)) {
      throw new CreatorCaseError("workspace_mismatch", "Creator belongs to another workspace");
    }
    throw new CreatorCaseError("creator_not_found", "Creator was not found");
  }

  private validateReview(command: ApplyCreatorReviewCommand): void {
    if (!(REVIEW_STATUSES as readonly string[]).includes(command.status)) throw new CreatorCaseError("bad_review_status", "Invalid review status");
    if (!(RISK_LEVELS as readonly string[]).includes(command.riskLevel)) throw new CreatorCaseError("bad_risk_level", "Invalid risk level");
    if (command.note) this.validateNote(command.note.category, command.note.body);
    if (command.status === "flagged" && !command.note) throw new CreatorCaseError("flagged_review_note_required", "Flagged reviews require a note");
  }

  private validateNote(category: string, body: string): void {
    if (!(NOTE_CATEGORIES as readonly string[]).includes(category)) throw new CreatorCaseError("bad_note_category", "Invalid note category");
    if (!body.trim()) throw new CreatorCaseError("bad_note_body", "Note body is required");
  }

  private makeNote(
    context: CreatorCaseCommandContext,
    creatorId: string,
    note: { category: CreatorReviewNote["category"]; body: string },
    id: string,
    createdAt: string,
  ): CreatorReviewNote {
    return { id, creatorId, workspaceId: context.workspaceId, operatorId: context.actorId, category: note.category, body: note.body, createdAt };
  }

  private makeAudit(
    context: CreatorCaseCommandContext,
    creatorId: string,
    eventType: string,
    id: string,
    createdAt: string,
    metadata: Record<string, unknown>,
  ): CreatorAuditEvent {
    return { id, workspaceId: context.workspaceId, operatorId: context.actorId, actorLabel: context.actorLabel, eventType, targetType: "creator", targetId: creatorId, creatorId, missionId: null, metadata, createdAt };
  }

  private failIf(point: InMemoryFailurePoint): void {
    if (this.failurePoint === point) throw new Error("in-memory failure");
  }

  private replay(commandId: string, payload: unknown): CreatorCaseReadModel | undefined {
    const completed = this.completedCommands.get(commandId);
    if (!completed) return undefined;
    if (JSON.stringify(completed.payload) !== JSON.stringify(payload)) throw new CreatorCaseError("command_conflict", "Command id was already used with a different payload");
    return clone(completed.result);
  }

  private commit(commandId: string, payload: unknown, workspaceId: string, creatorId: string, result: CreatorCaseReadModel): CreatorCaseReadModel {
    const stored = clone(result);
    this.cases.set(this.caseKey(workspaceId, creatorId), stored);
    this.completedCommands.set(commandId, { payload: clone(payload), result: clone(stored) });
    return clone(stored);
  }
}
