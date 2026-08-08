import { NOTE_CATEGORIES, REVIEW_STATUSES, RISK_LEVELS } from "../operatorCrm/types";
import { readOptional } from "./enrichment";
import type {
  CreatorReviewQueue,
  CreatorReviewQueueFilters,
  MissionHistoryProjection,
  ProfileProjection,
  SocialProjection,
} from "./types";
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

export type InMemoryFailurePoint = "before_get_case" | "after_review" | "after_note" | "after_audit";

export type InMemoryEnrichmentReaders = Partial<{
  social: (creatorCase: CreatorCaseReadModel) => Promise<SocialProjection>;
  profile: (creatorCase: CreatorCaseReadModel) => Promise<ProfileProjection>;
  missionHistory: (creatorCase: CreatorCaseReadModel) => Promise<MissionHistoryProjection>;
}>;

type CompletedCommand = {
  payload: unknown;
  result: CreatorCaseReadModel;
};

export type InMemoryCreatorCaseRepositoryOptions = {
  cases: CreatorCaseReadModel[];
  failurePoint?: InMemoryFailurePoint;
  knownMissionIds?: string[];
  enrichmentReaders?: InMemoryEnrichmentReaders;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const clone = <T>(value: T): T => structuredClone(value);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

const fingerprint = (value: unknown): string => JSON.stringify(canonicalize(value));

export class InMemoryCreatorCaseRepository implements CreatorCaseRepository {
  private readonly cases = new Map<string, CreatorCaseReadModel>();
  private readonly completedCommands = new Map<string, CompletedCommand>();
  private readonly failurePoint?: InMemoryFailurePoint;
  private readonly knownMissionIds?: ReadonlySet<string>;
  private readonly enrichmentReaders: InMemoryEnrichmentReaders;

  constructor(options: InMemoryCreatorCaseRepositoryOptions) {
    this.failurePoint = options.failurePoint;
    this.knownMissionIds = options.knownMissionIds ? new Set(options.knownMissionIds) : undefined;
    this.enrichmentReaders = options.enrichmentReaders ?? {};
    for (const creatorCase of options.cases) {
      this.cases.set(this.caseKey(creatorCase.creator.workspaceId, creatorCase.creator.id), clone(creatorCase));
    }
  }

  async listReviewQueue(
    context: CreatorCaseReadContext,
    filters: CreatorReviewQueueFilters,
  ): Promise<CreatorReviewQueue> {
    this.validateContext(context);
    if (filters.missionId && this.knownMissionIds && !this.knownMissionIds.has(filters.missionId)) {
      throw new CreatorCaseError("mission_not_found", "Mission was not found");
    }

    const rows = [...this.cases.values()]
      .filter((creatorCase) => creatorCase.creator.workspaceId === context.workspaceId)
      .map((creatorCase) => this.toQueueRow(creatorCase))
      .filter((row) => {
        if (filters.status && row.review.status !== filters.status) return false;
        if (filters.riskLevel && row.review.riskLevel !== filters.riskLevel) return false;
        if (filters.q && !row.displayName.toLowerCase().includes(filters.q.toLowerCase())) return false;
        if (filters.missionId && !filters.status && row.review.status === "flagged") return false;
        return true;
      });

    rows.sort((left, right) => {
      if (filters.missionId) {
        const missionPriority = (left.review.status === "approved" ? 0 : 1) - (right.review.status === "approved" ? 0 : 1);
        if (missionPriority !== 0) return missionPriority;
      }
      switch (filters.sort) {
        case "trust_score": return this.compareNullableDesc(this.trustScore(left.scores), this.trustScore(right.scores));
        case "level": return this.compareNullableDesc(this.levelRank(left.level), this.levelRank(right.level));
        case "social_freshness": return this.compareNullableDesc(left.social.apiSyncedAt, right.social.apiSyncedAt);
        case "last_activity":
        default: return this.compareNullableDesc(left.lastActivityAt, right.lastActivityAt);
      }
    });

    const page = Math.max(filters.page || 1, 1);
    const pageSize = Math.min(Math.max(filters.pageSize || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const start = (page - 1) * pageSize;
    return {
      creators: rows.slice(start, start + pageSize),
      page,
      pageSize,
      total: rows.length,
    };
  }

  async getCase(context: CreatorCaseReadContext, creatorId: string): Promise<CreatorCaseReadModel> {
    this.validateContext(context);
    this.failIf("before_get_case");
    const creatorCase = clone(this.findCase(context, creatorId));
    return {
      ...creatorCase,
      social: await this.readEnrichment("social", creatorCase),
      profile: await this.readEnrichment("profile", creatorCase),
      missionHistory: await this.readEnrichment("missionHistory", creatorCase),
    };
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

  private toQueueRow(creatorCase: CreatorCaseReadModel): CreatorReviewQueue["creators"][number] {
    const social = creatorCase.social.status === "available"
      ? creatorCase.social.value.summary
      : {
          platforms: [], syncStatus: null, followerCount: null, engagementRate: null,
          apiSyncedAt: null, label: "Not synced" as const, ownershipLabel: "Ownership not verified" as const,
        };
    const lastActivityAt = [creatorCase.creator.createdAt, creatorCase.review.updatedAt, social.apiSyncedAt]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
    return {
      id: creatorCase.creator.id,
      displayName: creatorCase.creator.displayName ?? creatorCase.creator.id,
      avatarUrl: creatorCase.creator.avatarUrl,
      level: creatorCase.creator.level ?? "L0",
      categories: clone(creatorCase.creator.categories),
      scores: clone(creatorCase.creator.scores),
      social,
      profileMedia: {
        avatarUrl: creatorCase.creator.avatarUrl,
        portfolioCount: 0,
        publicHighlightCount: 0,
        completenessScore: creatorCase.profile.status === "available" ? creatorCase.profile.value.completeness.score : 0,
      },
      review: clone(creatorCase.review),
      shortlist: null,
      lastActivityAt,
    };
  }

  private trustScore(scores: Record<string, number | null>): number {
    const values = Object.values(scores).filter((value): value is number => typeof value === "number");
    return values.length === 0 ? -1 : values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private levelRank(level: string): number {
    const numeric = Number(level.replace(/^L/i, ""));
    return Number.isFinite(numeric) ? numeric : -1;
  }

  private compareNullableDesc(left: string | number | null, right: string | number | null): number {
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    if (left > right) return -1;
    if (left < right) return 1;
    return 0;
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

  private async readEnrichment<K extends keyof InMemoryEnrichmentReaders>(
    key: K,
    creatorCase: CreatorCaseReadModel,
  ): Promise<CreatorCaseReadModel[K]> {
    const reader = this.enrichmentReaders[key];
    if (!reader) return creatorCase[key];
    return readOptional(() => reader(creatorCase)) as CreatorCaseReadModel[K];
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
    if (this.failurePoint === point) throw new CreatorCaseError("db_error", "in-memory failure");
  }

  private replay(commandId: string, payload: unknown): CreatorCaseReadModel | undefined {
    const completed = this.completedCommands.get(commandId);
    if (!completed) return undefined;
    if (fingerprint(completed.payload) !== fingerprint(payload)) throw new CreatorCaseError("command_conflict", "Command id was already used with a different payload");
    return clone(completed.result);
  }

  private commit(commandId: string, payload: unknown, workspaceId: string, creatorId: string, result: CreatorCaseReadModel): CreatorCaseReadModel {
    const stored = clone(result);
    this.cases.set(this.caseKey(workspaceId, creatorId), stored);
    this.completedCommands.set(commandId, { payload: clone(payload), result: clone(stored) });
    return clone(stored);
  }
}
