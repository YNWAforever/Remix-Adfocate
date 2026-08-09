export const CREATOR_STUDIO_EVENT_NAMES = [
  "workspace_opened",
  "draft_saved",
  "asset_finalized",
  "work_item_submitted",
  "changes_viewed",
  "work_item_resubmitted",
  "work_item_approved",
] as const;

export type CreatorStudioEventName = (typeof CREATOR_STUDIO_EVENT_NAMES)[number];

export type CreatorStudioMetricEvent = Readonly<{
  name: CreatorStudioEventName;
  workspaceId: string;
  submissionId: string;
  workItemId?: string;
  commandId?: string;
  createdAt: string;
}>;

export type CreatorStudioMetricsSink = (event: CreatorStudioMetricEvent) => void | Promise<void>;

const allowedNames = new Set<string>(CREATOR_STUDIO_EVENT_NAMES);
const noop: CreatorStudioMetricsSink = () => undefined;

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function recordCreatorStudioEvent(event: CreatorStudioMetricEvent, sink: CreatorStudioMetricsSink = noop): void {
  if (!allowedNames.has(event.name) || !nonEmpty(event.workspaceId) || !nonEmpty(event.submissionId)) return;
  const timestamp = new Date(event.createdAt);
  if (Number.isNaN(timestamp.getTime())) return;

  const safeEvent: CreatorStudioMetricEvent = {
    name: event.name,
    workspaceId: event.workspaceId,
    submissionId: event.submissionId,
    ...(nonEmpty(event.workItemId) ? { workItemId: event.workItemId } : {}),
    ...(nonEmpty(event.commandId) ? { commandId: event.commandId } : {}),
    createdAt: timestamp.toISOString(),
  };
  try {
    const result = sink(safeEvent);
    if (result && typeof (result as Promise<void>).then === "function") void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Metrics are intentionally non-blocking.
  }
}
