import { createHash } from "node:crypto";

/** Server-resolved facts only. A browser/model must never supply this contract. */
export type InstagramLoginContract = {
  evidence: "synthetic" | "verified";
  appId: string;
  apiVersion: string;
  login: "instagram_login";
  authorizeHost: string;
  graphHost: string;
  tokenSubjectKind: string;
  profileSubjectKind: string;
  publishScope: "instagram_business_content_publish";
  supportsPaidPartnershipLabel: boolean | null;
  supportsBrandTag: boolean | null;
  revoke: { method: string; path: string; tokenKind: string; successRule: string } | null;
  noticeIdentityRule: string | null;
  sourceUrls: string[];
  checkedAt: string;
  limits: {
    version: string; apiVersion: string; mime: "image/jpeg"; maxBytes: number;
    minWidth: number; maxWidth: number; minHeight: number; maxHeight: number;
    minAspectRatio: number; maxAspectRatio: number; maxCaptionCodePoints: number;
  } | null;
};

/** No reviewed App/identity/revoke contract exists. This is intentionally unusable live. */
export const liveInstagramLoginContract: InstagramLoginContract | null = null;

type Owner = { workspaceId: string; creatorId: string };
type DisclosureRequirements = { sponsored: boolean; platformLabelRequired: boolean; brandTagRequired: boolean };
export type PublishDraft = {
  id: string;
  revision: number;
  owner: Owner;
  accountSubject: string;
  imageSha256: string;
  rightsConfirmed: boolean;
  /** Metadata describes the final decoded/validated JPEG, before approval. */
  asset: { mime: string; byteSize: number; width: number; height: number; validated: boolean };
  caption: string;
  disclosure: DisclosureRequirements & { captionText: string };
  mission?: { kind: "active" | "legacy"; submissionId: string; workItemId: string; approvedVersionId: string; instructionRevision: number };
};
export type PublishGrant = {
  subject: string; appId: string; generation: number; scopes: string[];
  status: "active" | "revoked" | "reauth_required"; expiresAt: string;
};
/** Load through the existing owned mission projection; never trust a client copy. */
export type MissionPublishBasis = {
  owner: Owner; submissionId: string; workItemId: string;
  state: string; approvedVersionId: string | null; approvedCaption: string;
  approvedAssetHashes: string[]; expectedAccount: string | null;
  requiredDisclosures: string[]; disclosureRequirements: DisclosureRequirements;
  instructionRevision: number;
};
export type PublishPolicyResult = {
  fingerprint: string | null; allowed: boolean; sampleOnly: boolean;
  reason?: string; fallback?: "manual_proof";
};

const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const subject = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,63}$/.test(value);
const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
  && [...value].every(character => {
    const code = character.codePointAt(0)!;
    return (code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13;
  });
const sameOwner = (a: Owner, b: Owner) => a.workspaceId === b.workspaceId && a.creatorId === b.creatorId;
const disclosureKeys = ["sponsored", "platformLabelRequired", "brandTagRequired"] as const;

function usableContract(value: InstagramLoginContract | null): value is InstagramLoginContract & { limits: NonNullable<InstagramLoginContract["limits"]> } {
  if (!value || !["synthetic", "verified"].includes(value.evidence) || !subject(value.appId)
    || value.login !== "instagram_login" || value.graphHost !== "graph.instagram.com"
    || value.authorizeHost !== "www.instagram.com" || value.tokenSubjectKind !== "instagram_user"
    || value.profileSubjectKind !== "professional_account" || value.publishScope !== "instagram_business_content_publish"
    || !/^v\d+\.\d+$/.test(value.apiVersion) || !text(value.noticeIdentityRule)
    || !Number.isFinite(Date.parse(value.checkedAt)) || !value.sourceUrls.length
    || !value.revoke || !Object.values(value.revoke).every(text)) return false;
  const limits = value.limits;
  return !!limits && text(limits.version) && limits.apiVersion === value.apiVersion && limits.mime === "image/jpeg"
    && [limits.maxBytes, limits.minWidth, limits.maxWidth, limits.minHeight, limits.maxHeight, limits.maxCaptionCodePoints].every(positiveInteger)
    && limits.minWidth <= limits.maxWidth && limits.minHeight <= limits.maxHeight
    && Number.isFinite(limits.minAspectRatio) && Number.isFinite(limits.maxAspectRatio)
    && limits.minAspectRatio > 0 && limits.maxAspectRatio >= limits.minAspectRatio;
}

/** Pure eligibility/fingerprint calculation, not a publish command or approval. */
export function validatePublishDraft(
  draft: PublishDraft, grant: PublishGrant, basis: MissionPublishBasis | null,
  capabilities: InstagramLoginContract | null, now: Date,
): PublishPolicyResult {
  const sampleOnly = capabilities?.evidence !== "verified";
  // A routing hint keeps the original review/proof workflow reachable; it grants
  // no mission access, approval, or publishing authority of its own.
  const manualFallback = !!draft.mission || draft.disclosure.sponsored;
  const deny = (reason: string, manual = manualFallback): PublishPolicyResult => ({
    allowed: false, fingerprint: null, sampleOnly, reason, ...(manual ? { fallback: "manual_proof" as const } : {}),
  });
  if (!usableContract(capabilities)) return deny("PUBLISH_PROTOCOL_UNVERIFIED");
  if (!Number.isFinite(now.getTime()) || grant.status !== "active" || !positiveInteger(grant.generation)
    || !subject(grant.subject) || grant.subject !== draft.accountSubject || grant.appId !== capabilities.appId
    || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now.getTime()
    || !["instagram_business_basic", capabilities.publishScope].every(scope => grant.scopes.includes(scope))) return deny("PUBLISH_GRANT_INVALID");
  if (!id(draft.id) || !id(draft.owner.workspaceId) || !id(draft.owner.creatorId) || !positiveInteger(draft.revision)
    || draft.rightsConfirmed !== true || !/^[a-f0-9]{64}$/.test(draft.imageSha256)
    || !text(draft.caption) || [...draft.caption].length > capabilities.limits.maxCaptionCodePoints
    || !disclosureKeys.every(key => typeof draft.disclosure[key] === "boolean")
    || typeof draft.disclosure.captionText !== "string") return deny("PUBLISH_DRAFT_INVALID");
  const asset = draft.asset; const limits = capabilities.limits;
  if (asset.validated !== true || asset.mime !== limits.mime || !positiveInteger(asset.byteSize) || asset.byteSize > limits.maxBytes
    || !positiveInteger(asset.width) || !positiveInteger(asset.height)
    || asset.width < limits.minWidth || asset.width > limits.maxWidth || asset.height < limits.minHeight || asset.height > limits.maxHeight
    || asset.width / asset.height < limits.minAspectRatio || asset.width / asset.height > limits.maxAspectRatio) return deny("PUBLISH_ASSET_INVALID");

  if (draft.mission?.kind === "legacy") return deny("LEGACY_MANUAL_PROOF", true);
  if (draft.mission) {
    const mission = draft.mission;
    if (mission.kind !== "active" || !basis || !sameOwner(draft.owner, basis.owner)
      || basis.submissionId !== mission.submissionId || basis.workItemId !== mission.workItemId
      || !id(mission.submissionId) || !id(mission.workItemId) || !id(mission.approvedVersionId)
      || !positiveInteger(mission.instructionRevision) || basis.state !== "approved_to_publish"
      || basis.approvedVersionId !== mission.approvedVersionId || basis.instructionRevision !== mission.instructionRevision
      || basis.approvedCaption !== draft.caption || basis.approvedAssetHashes.length !== 1
      || basis.approvedAssetHashes[0] !== draft.imageSha256 || basis.expectedAccount !== draft.accountSubject) return deny("MISSION_APPROVAL_MISMATCH", true);
    if (!basis.disclosureRequirements || !disclosureKeys.every(key => typeof basis.disclosureRequirements[key] === "boolean"
      && basis.disclosureRequirements[key] === draft.disclosure[key])
      || !basis.requiredDisclosures.every(required => text(required) && draft.caption.includes(required))) return deny("MISSION_DISCLOSURE_MISMATCH", true);
  } else {
    if (basis) return deny("MISSION_APPROVAL_MISMATCH");
    // The existing mission approval is the only reviewed sponsorship-policy authority.
    // Personal sponsorship has no authoritative policy projection in this phase.
    if (draft.disclosure.sponsored) return deny("SPONSORED_POLICY_REQUIRED", true);
  }
  if (draft.disclosure.captionText && !draft.caption.includes(draft.disclosure.captionText)) return deny("PUBLISH_DISCLOSURE_MISSING", true);
  if ((draft.disclosure.platformLabelRequired && capabilities.supportsPaidPartnershipLabel !== true)
    || (draft.disclosure.brandTagRequired && capabilities.supportsBrandTag !== true)) return deny("PUBLISH_DISCLOSURE_UNSUPPORTED", true);
  if (!draft.disclosure.sponsored && (draft.disclosure.platformLabelRequired || draft.disclosure.brandTagRequired)) return deny("PUBLISH_DISCLOSURE_INVALID", true);

  const fingerprint = createHash("sha256").update(JSON.stringify({
    draft: [draft.id, draft.revision, draft.owner.workspaceId, draft.owner.creatorId, draft.accountSubject,
      draft.imageSha256, asset.mime, asset.byteSize, asset.width, asset.height, draft.rightsConfirmed, draft.caption],
    grant: [grant.appId, grant.subject, grant.generation, [...new Set(grant.scopes)].sort()],
    disclosure: [draft.disclosure.sponsored, draft.disclosure.captionText, draft.disclosure.platformLabelRequired, draft.disclosure.brandTagRequired],
    mission: draft.mission && basis ? [draft.mission.submissionId, draft.mission.workItemId, basis.approvedVersionId,
      basis.instructionRevision, basis.requiredDisclosures] : null,
    protocol: [capabilities.evidence, capabilities.appId, capabilities.apiVersion, capabilities.publishScope,
      capabilities.supportsPaidPartnershipLabel, capabilities.supportsBrandTag, capabilities.noticeIdentityRule,
      capabilities.revoke, limits],
  })).digest("hex");
  return { allowed: true, fingerprint, sampleOnly };
}
