/** D0 ships protocol implementations, never an authorization to use real accounts. */
export const pilotReadiness = () => ({stage:"D0" as const,externalAccess:false as const,reason:"PILOT_APPROVAL_REQUIRED" as const});
export type PilotTarget = {environmentId:string;projectRef:string;origin:string;sourceSha:string;schemaDigest:string};
export const PRODUCT_SUPABASE_PROJECT_REF = "mhkoayftiuojxlrkollf";
export const PRODUCT_HOSTING_PROJECT_IDS: readonly string[] = Object.freeze([
  "kocmax", "kocmax2", "prj_1kjq3IJGCYVzlGnxRlzUpypJeMg5", "prj_7zxcc1I7x6lAOHIEVCCCAX0nh6hO",
  "adfocate-2", "adfocate-site", "prj_tBHX5vuMvZ4dEbQJpzhkM3VRJd0g", "prj_xHgVQRoZheStpNLVAUMZvq2p9R11",
]);
export const PRODUCT_HOSTNAMES: readonly string[] = Object.freeze([
  "kocmax.vercel.app", "kocmax2.vercel.app", "adfocate-2.vercel.app", "adfocate-site.vercel.app", `${PRODUCT_SUPABASE_PROJECT_REF}.supabase.co`,
]);
const targetKeys: (keyof PilotTarget)[] = ["environmentId", "projectRef", "origin", "sourceSha", "schemaDigest"];
function isTarget(value: unknown): value is PilotTarget {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === targetKeys.length
    && targetKeys.every(key => Object.hasOwn(value, key) && typeof (value as PilotTarget)[key] === "string"
      && (value as PilotTarget)[key].length > 0 && (value as PilotTarget)[key].length <= 600);
}

/** Receipt comparison is offline preparation, not proof of remote target identity. */
export function inspectPilotTarget(expected: unknown, observed: unknown, productionProjects: unknown) {
  let valid = false;
  try {
    if (!isTarget(expected) || !isTarget(observed) || !Array.isArray(productionProjects) || productionProjects.some(value => typeof value !== "string")) throw new Error("INVALID_RECEIPT");
    const origin = new URL(expected.origin);
    valid = !!expected.environmentId && !!expected.projectRef && expected.projectRef.toLowerCase() !== PRODUCT_SUPABASE_PROJECT_REF && !productionProjects.includes(expected.projectRef)
      && !PRODUCT_HOSTING_PROJECT_IDS.some(id => id.toLowerCase() === expected.environmentId.toLowerCase())
      && !PRODUCT_HOSTNAMES.includes(origin.hostname)
      && origin.protocol === "https:" && origin.origin === expected.origin && !origin.username && !origin.password
      && /^[0-9a-f]{40}$/.test(expected.sourceSha) && /^[0-9a-f]{64}$/.test(expected.schemaDigest)
      && targetKeys.every(key => expected[key] === observed[key]);
  } catch { valid = false; }
  return {matches:valid,externalAccess:false as const,reason:"PILOT_APPROVAL_REQUIRED" as const};
}
