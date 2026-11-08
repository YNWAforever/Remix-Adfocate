// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validatePublishDraft, type InstagramLoginContract, type MissionPublishBasis, type PublishDraft, type PublishGrant } from "./publishPolicy.js";

// Synthetic capability limits exercise boundaries; these are not Meta limits.
const now = new Date("2026-11-04T12:00:00.000Z");
const owner = { workspaceId: "workspace-a", creatorId: "creator-a" };
function contract(): InstagramLoginContract {
  return {
    evidence: "synthetic", appId: "987", apiVersion: "v26.0", login: "instagram_login",
    authorizeHost: "www.instagram.com", graphHost: "graph.instagram.com",
    tokenSubjectKind: "instagram_user", profileSubjectKind: "professional_account",
    publishScope: "instagram_business_content_publish", supportsPaidPartnershipLabel: false, supportsBrandTag: false,
    revoke: { method: "DELETE", path: "/fixture/revoke", tokenKind: "instagram_user", successRule: "fixture_success" },
    noticeIdentityRule: "synthetic-app-and-subject-binding", sourceUrls: ["https://example.invalid/synthetic-contract"],
    checkedAt: now.toISOString(), limits: { version: "fixture-v1", apiVersion: "v26.0", mime: "image/jpeg", maxBytes: 1024,
      minWidth: 100, maxWidth: 1000, minHeight: 100, maxHeight: 1000, minAspectRatio: 0.5, maxAspectRatio: 2, maxCaptionCodePoints: 100 },
  };
}
function draft(): PublishDraft {
  return { id: "draft-a", revision: 1, owner, accountSubject: "123", imageSha256: "a".repeat(64), rightsConfirmed: true,
    asset: { mime: "image/jpeg", byteSize: 500, width: 400, height: 400, validated: true }, caption: "A real observation.",
    disclosure: { sponsored: false, captionText: "", platformLabelRequired: false, brandTagRequired: false } };
}
function grant(): PublishGrant {
  return { subject: "123", appId: "987", generation: 1, scopes: ["instagram_business_basic", "instagram_business_content_publish"], status: "active", expiresAt: "2026-11-04T13:00:00.000Z" };
}
function mission(): { draft: PublishDraft; basis: MissionPublishBasis } {
  const value = draft();
  value.mission = { kind: "active", submissionId: "submission-a", workItemId: "work-a", approvedVersionId: "version-a", instructionRevision: 2 };
  return { draft: value, basis: { owner, submissionId: "submission-a", workItemId: "work-a", state: "approved_to_publish", approvedVersionId: "version-a",
    approvedCaption: value.caption, approvedAssetHashes: [value.imageSha256], expectedAccount: "123", requiredDisclosures: [],
    disclosureRequirements: { sponsored: false, platformLabelRequired: false, brandTagRequired: false }, instructionRevision: 2 } };
}
const check = (d = draft(), g = grant(), b: MissionPublishBasis | null = null, c: InstagramLoginContract | null = contract()) => validatePublishDraft(d, g, b, c, now);

describe("creator-controlled single-image publish policy", () => {
  it("permits an exact unsponsored personal preview in synthetic mode without rewards or mutation", () => {
    const d = draft(); const before = structuredClone(d);
    expect(check(d)).toMatchObject({ allowed: true, sampleOnly: true });
    expect(check(d).fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(d).toEqual(before);
  });
  it.each([null, { ...contract(), revoke: null }, { ...contract(), noticeIdentityRule: null }, { ...contract(), limits: null }])("fails closed for missing protocol facts", c => {
    expect(check(draft(), grant(), null, c)).toMatchObject({ allowed: false, reason: "PUBLISH_PROTOCOL_UNVERIFIED", fingerprint: null });
  });
  it.each([{ graphHost: "graph.facebook.com" }, { login: "facebook_login" }, { tokenSubjectKind: "facebook_page" }, { limits: { ...contract().limits!, apiVersion: "v25.0" } }])("rejects mixed login/version contracts", patch => {
    expect(check(draft(), grant(), null, { ...contract(), ...patch } as InstagramLoginContract).allowed).toBe(false);
  });
  it.each([{ status: "revoked" }, { status: "reauth_required" }, { generation: 0 }, { subject: "999" }, { appId: "888" }, { scopes: ["instagram_business_basic"] }, { expiresAt: now.toISOString() }, { expiresAt: "invalid" }])("rejects a stale or mismatched grant before preview", patch => {
    expect(check(draft(), { ...grant(), ...patch } as PublishGrant).allowed).toBe(false);
  });
  it("does not turn a matching username or BioCode into a publishing subject", () => {
    expect(check({ ...draft(), accountSubject: "@creator" }, { ...grant(), subject: "@creator" }).allowed).toBe(false);
  });
  it.each([{ rightsConfirmed: false }, { imageSha256: "not-a-hash" }, { revision: 0 }, { caption: "  " }, { caption: "x".repeat(101) }])("rejects an invalid draft", patch => {
    expect(check({ ...draft(), ...patch }).allowed).toBe(false);
  });
  it.each([{ mime: "image/png" }, { validated: false }, { byteSize: 1025 }, { byteSize: 0 }, { byteSize: Number.NaN }, { width: 99 }, { height: 1001 }, { width: 300, height: 100 }, { width: 400.5 }])("requires validated final JPEG bytes and dimensions within versioned limits", patch => {
    const d = draft(); d.asset = { ...d.asset, ...patch };
    expect(check(d).allowed).toBe(false);
  });
  it("counts caption code points and preserves exact approved whitespace", () => {
    expect(check({ ...draft(), caption: "🌱".repeat(100) }).allowed).toBe(true);
    expect(check({ ...draft(), caption: "🌱".repeat(101) }).allowed).toBe(false);
    const m = mission(); m.draft.caption += " ";
    expect(check(m.draft, grant(), m.basis)).toMatchObject({ allowed: false, reason: "MISSION_APPROVAL_MISMATCH" });
  });
  it("allows only the exact server-owned Active approved version", () => {
    const m = mission();
    expect(check(m.draft, grant(), m.basis).allowed).toBe(true);
  });
  it.each([{ state: "in_review" }, { approvedVersionId: "old-version" }, { instructionRevision: 3 }, { expectedAccount: "999" }, { expectedAccount: null },
    { approvedAssetHashes: ["b".repeat(64)] }, { approvedCaption: "Changed" }, { submissionId: "other" }, { workItemId: "other" }, { owner: { ...owner, creatorId: "other" } }])("rejects substituted or stale mission basis", patch => {
    const m = mission();
    expect(check(m.draft, grant(), { ...m.basis, ...patch }).allowed).toBe(false);
  });
  it("requires a basis for Active work and keeps legacy on the original manual-proof path", () => {
    const m = mission();
    expect(check(m.draft).allowed).toBe(false);
    m.draft.mission!.kind = "legacy";
    expect(check(m.draft, grant(), m.basis)).toMatchObject({ allowed: false, fallback: "manual_proof" });
    expect(check(draft(), grant(), m.basis).allowed).toBe(false);
  });
  it.each(["no_contract", "missing_scope", "revoked", "expired"])("retains legacy manual proof when native publishing is unavailable: %s", scenario => {
    const m = mission(); m.draft.mission!.kind = "legacy";
    const g = grant();
    if (scenario === "missing_scope") g.scopes = ["instagram_business_basic"];
    if (scenario === "revoked") g.status = "revoked";
    if (scenario === "expired") g.expiresAt = now.toISOString();
    expect(check(m.draft, g, m.basis, scenario === "no_contract" ? null : contract())).toMatchObject({ allowed: false, fingerprint: null, fallback: "manual_proof" });
  });
  it("retains the manual route for sponsored and Active work under the disabled live contract", () => {
    const d = draft(); d.disclosure.sponsored = true;
    expect(check(d, grant(), null, null)).toMatchObject({ allowed: false, fingerprint: null, fallback: "manual_proof" });
    const m = mission();
    expect(check(m.draft, grant(), m.basis, null)).toMatchObject({ allowed: false, fingerprint: null, fallback: "manual_proof" });
  });
  it("blocks personal sponsorship without an authoritative reviewed policy", () => {
    const d = draft(); d.disclosure.sponsored = true;
    expect(check(d)).toMatchObject({ allowed: false, reason: "SPONSORED_POLICY_REQUIRED", fallback: "manual_proof" });
  });
  it("uses mission requirements so an omitted client disclosure cannot bypass labels", () => {
    const m = mission(); m.basis.disclosureRequirements = { sponsored: true, platformLabelRequired: true, brandTagRequired: true };
    expect(check(m.draft, grant(), m.basis)).toMatchObject({ allowed: false, fallback: "manual_proof" });
  });
  it.each([false, null])("keeps a required unsupported/unknown platform label on manual proof", supported => {
    const m = mission(); m.draft.disclosure = { sponsored: true, captionText: "#ad", platformLabelRequired: true, brandTagRequired: false };
    m.draft.caption += " #ad"; m.basis.approvedCaption = m.draft.caption;
    m.basis.requiredDisclosures = ["#ad"]; m.basis.disclosureRequirements = { sponsored: true, platformLabelRequired: true, brandTagRequired: false };
    expect(check(m.draft, grant(), m.basis, { ...contract(), supportsPaidPartnershipLabel: supported })).toMatchObject({ allowed: false, fallback: "manual_proof" });
  });
  it("checks every required caption disclosure even with supported synthetic label capabilities", () => {
    const m = mission(); m.basis.requiredDisclosures = ["#ad"];
    expect(check(m.draft, grant(), m.basis).allowed).toBe(false);
  });
  it("binds fingerprints to owner/content/account/grant/app/approval/limits and canonicalizes scope order", () => {
    const initial = check().fingerprint;
    expect(check(draft(), { ...grant(), scopes: [...grant().scopes].reverse() }).fingerprint).toBe(initial);
    for (const d of [{ ...draft(), revision: 2 }, { ...draft(), caption: "New caption" }, { ...draft(), imageSha256: "b".repeat(64) }, { ...draft(), owner: { ...owner, creatorId: "other" } }]) {
      expect(check(d).fingerprint).not.toBe(initial);
    }
    expect(check(draft(), { ...grant(), generation: 2 }).fingerprint).not.toBe(initial);
    expect(check(draft(), grant(), null, { ...contract(), limits: { ...contract().limits!, version: "fixture-v2" } }).fingerprint).not.toBe(initial);
    const m = mission(); const before = check(m.draft, grant(), m.basis).fingerprint;
    m.draft.mission!.instructionRevision = 3; m.basis.instructionRevision = 3;
    expect(check(m.draft, grant(), m.basis).fingerprint).not.toBe(before);
  });
});
