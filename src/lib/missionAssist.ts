/** IDs are selectors only. The server resolves the actor and reauthorizes every parent. */
export type AssistContext = {
  workspaceId?: string;
  missionId: string;
  workflowId?: string;
  workItemId?: string;
  versionId?: string;
  mode: "explain_brief" | "summarize_changes";
};
export type AssistBasisVersion = {
  missionId: string;
  missionUpdatedAt: string | null;
  workflowId: string | null;
  workflowRevision: number | null;
  workItemId: string | null;
  versionId: string | null;
  versionNumber: number | null;
  previousVersionId: string | null;
  previousVersionApproved?: boolean;
  versionApproved?: boolean;
  currentVersionId: string | null;
  stale: boolean;
  sourceHash: string;
};
export type MissionAssistReply = {
  answer: string;
  citations: Array<{ title: string; sourceType: string; sourceRef: string }>;
  basisVersion: AssistBasisVersion;
  limitations: string[];
  request_id: string;
  persistence: "not_saved";
  generation: "completed";
  provider: "mock";
};
