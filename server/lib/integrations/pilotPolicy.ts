/** D0 ships protocol implementations, never an authorization to use real accounts. */
export const pilotReadiness = () => ({stage:"D0" as const,externalAccess:false as const,reason:"PILOT_APPROVAL_REQUIRED" as const});
export type PilotTarget = {environmentId:string;projectRef:string;origin:string;sourceSha:string;schemaDigest:string};

/** Receipt comparison is offline preparation, not proof of remote target identity. */
export function inspectPilotTarget(expected: PilotTarget, observed: PilotTarget, productionProjects: string[]) {
  let valid = false;
  try {
    const origin = new URL(expected.origin);
    valid = !!expected.environmentId && !!expected.projectRef && !productionProjects.includes(expected.projectRef)
      && origin.protocol === "https:" && origin.origin === expected.origin && !origin.username && !origin.password
      && /^[0-9a-f]{40}$/.test(expected.sourceSha) && /^[0-9a-f]{64}$/.test(expected.schemaDigest)
      && (Object.keys(expected) as Array<keyof PilotTarget>).every(key => expected[key] === observed[key]);
  } catch { valid = false; }
  return {matches:valid,externalAccess:false as const,reason:"PILOT_APPROVAL_REQUIRED" as const};
}
