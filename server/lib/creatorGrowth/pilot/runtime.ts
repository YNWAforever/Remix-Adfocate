export type PilotRuntimePolicy = Readonly<{
  enabled: boolean;
  runId: string;
  allowedCreators: readonly string[];
  allowedMissionIds: readonly string[];
  stopRequested: boolean;
}>;

/** Server-owned policy only; no environment defaults or browser flags. */
export function mayRunPilotWrite(policy: PilotRuntimePolicy | undefined, creatorId: string, missionId: string): boolean {
  return policy?.enabled === true && policy.stopRequested === false
    && /^[a-zA-Z0-9_-]{1,128}$/.test(policy.runId)
    && Array.isArray(policy.allowedCreators) && policy.allowedCreators.includes(creatorId)
    && Array.isArray(policy.allowedMissionIds) && policy.allowedMissionIds.includes(missionId);
}
