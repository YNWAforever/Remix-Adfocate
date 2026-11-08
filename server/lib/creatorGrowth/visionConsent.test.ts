import { describe, expect, it } from "vitest";

import {
  authorizeVisionProcessing,
  type VisionActor,
  type VisionConsentAsset,
  type VisionConnectionState,
  type VisionProcessingGrant,
  type VisionProcessorConfig,
} from "./visionConsent.js";

// Invented consent/configuration for offline tests, never a processor approval.
const NOW = new Date("2026-11-04T12:00:00.000Z");
const BEFORE = "2026-11-04T11:00:00.000Z";
const AFTER = "2026-11-04T13:00:00.000Z";
const ACTOR: VisionActor = { ownerId: "creator-a", workspaceId: "workspace-a" };
const ASSET: VisionConsentAsset = {
  ...ACTOR, assetId: "asset-a", sourceHash: "a".repeat(64),
  expiresAt: AFTER, revokedAt: null, connection: null,
};
const CONFIG: VisionProcessorConfig = {
  processorId: "synthetic-test-processor", processorVersion: "test-v1", configVersion: "review-v1",
  purpose: "image_diagnosis", consentVersion: "consent-v1",
  enabled: true, approved: true, approvedAt: BEFORE, expiresAt: AFTER, revokedAt: null,
};
const GRANT: VisionProcessingGrant = {
  ...ACTOR, grantId: "consent-a", assetId: ASSET.assetId, sourceHash: ASSET.sourceHash,
  purpose: "image_diagnosis", consentVersion: "consent-v1",
  processorId: CONFIG.processorId, processorVersion: CONFIG.processorVersion, configVersion: CONFIG.configVersion,
  grantedAt: BEFORE, expiresAt: AFTER, revokedAt: null, connection: null,
};
const CONNECTION: VisionConnectionState = {
  ...ACTOR, connectionId: "connection-a", generation: 3, status: "active", expiresAt: AFTER,
};

function check(overrides: {
  grant?: VisionProcessingGrant | null;
  actor?: VisionActor | null;
  asset?: VisionConsentAsset | null;
  config?: VisionProcessorConfig | null;
  connection?: VisionConnectionState | null;
  now?: Date;
} = {}) {
  return authorizeVisionProcessing(
    "grant" in overrides ? overrides.grant! : GRANT,
    "actor" in overrides ? overrides.actor! : ACTOR,
    "asset" in overrides ? overrides.asset! : ASSET,
    "config" in overrides ? overrides.config! : CONFIG,
    { now: overrides.now ?? NOW, connection: overrides.connection ?? null },
  );
}

describe("authorizeVisionProcessing (pure server-owned consent)", () => {
  it("allows this exact self-upload consent without an Instagram connection", () => {
    expect(check()).toBe(true);
  });

  it.each(["grant", "actor", "asset", "config"] as const)("denies a missing %s", (key) => {
    expect(check({ [key]: null })).toBe(false);
  });

  it.each([
    ["another owner", { ownerId: "creator-b" }],
    ["another workspace", { workspaceId: "workspace-b" }],
    ["blank owner", { ownerId: "" }],
  ])("denies an actor with %s", (_label, patch) => {
    expect(check({ actor: { ...ACTOR, ...patch } })).toBe(false);
  });

  it.each([
    ["wrong owner", { ownerId: "creator-b" }],
    ["wrong workspace", { workspaceId: "workspace-b" }],
    ["wrong asset", { assetId: "asset-b" }],
    ["wrong hash", { sourceHash: "b".repeat(64) }],
    ["wrong purpose", { purpose: "publish" }],
    ["wrong consent version", { consentVersion: "consent-v2" }],
    ["wrong processor", { processorId: "unreviewed" }],
    ["wrong processor version", { processorVersion: "test-v2" }],
    ["wrong config version", { configVersion: "review-v2" }],
    ["missing grant identity", { grantId: "" }],
    ["expired", { expiresAt: NOW.toISOString() }],
    ["malformed expiry", { expiresAt: "tomorrow" }],
    ["not yet granted", { grantedAt: AFTER }],
    ["malformed grant time", { grantedAt: "invalid" }],
    ["revoked", { revokedAt: BEFORE }],
    ["missing revocation state", { revokedAt: undefined }],
  ])("denies %s consent", (_label, patch) => {
    expect(check({ grant: { ...GRANT, ...patch } as VisionProcessingGrant })).toBe(false);
  });

  it.each([
    ["wrong owner", { ownerId: "creator-b" }],
    ["wrong workspace", { workspaceId: "workspace-b" }],
    ["changed hash", { sourceHash: "c".repeat(64) }],
    ["malformed hash", { sourceHash: "not-a-sha256" }],
    ["revoked", { revokedAt: BEFORE }],
    ["expired", { expiresAt: NOW.toISOString() }],
    ["missing connection binding", { connection: undefined }],
  ])("denies a %s asset", (_label, patch) => {
    expect(check({ asset: { ...ASSET, ...patch } as VisionConsentAsset })).toBe(false);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["unapproved", { approved: false }],
    ["truthy approval", { approved: "true" }],
    ["wrong purpose", { purpose: "ad_targeting" }],
    ["changed terms", { consentVersion: "consent-v2" }],
    ["changed processor", { processorId: "another-processor" }],
    ["changed model", { processorVersion: "test-v2" }],
    ["changed reviewed config", { configVersion: "review-v2" }],
    ["expired", { expiresAt: NOW.toISOString() }],
    ["future approval", { approvedAt: AFTER }],
    ["revoked", { revokedAt: BEFORE }],
    ["missing revocation state", { revokedAt: undefined }],
  ])("denies %s configuration", (_label, patch) => {
    expect(check({ config: { ...CONFIG, ...patch } as VisionProcessorConfig })).toBe(false);
  });

  it("requires an explicit valid clock, independent of wall time", () => {
    expect(check({ now: new Date("invalid") })).toBe(false);
    expect(check({ now: new Date("2026-11-04T10:00:00.000Z") })).toBe(false);
    expect(check({ now: new Date(AFTER) })).toBe(false);
    expect(check({ now: new Date(BEFORE) })).toBe(true);
  });

  it("rejects malformed hashes even when the consent and asset agree", () => {
    expect(check({ grant: { ...GRANT, sourceHash: "x" }, asset: { ...ASSET, sourceHash: "x" } })).toBe(false);
  });

  const bound = { connectionId: CONNECTION.connectionId, generation: CONNECTION.generation };
  const boundGrant = { ...GRANT, connection: bound };
  const boundAsset = { ...ASSET, connection: bound };

  it("allows a bound source only for its current active owner and generation", () => {
    expect(check({ grant: boundGrant, asset: boundAsset, connection: CONNECTION })).toBe(true);
  });

  it.each([
    ["revoked", { status: "revoked" }],
    ["reauth required", { status: "reauth_required" }],
    ["reconnected", { generation: 4 }],
    ["another connection", { connectionId: "connection-b" }],
    ["another owner", { ownerId: "creator-b" }],
    ["another workspace", { workspaceId: "workspace-b" }],
    ["expired", { expiresAt: NOW.toISOString() }],
    ["fractional generation", { generation: 3.5 }],
  ])("denies a %s connection", (_label, patch) => {
    expect(check({
      grant: boundGrant, asset: boundAsset,
      connection: { ...CONNECTION, ...patch } as VisionConnectionState,
    })).toBe(false);
  });

  it("does not let either side drop or change the connection binding", () => {
    expect(check({ grant: boundGrant, asset: boundAsset })).toBe(false);
    expect(check({ grant: boundGrant, connection: CONNECTION })).toBe(false);
    expect(check({ asset: boundAsset, connection: CONNECTION })).toBe(false);
    expect(check({ grant: boundGrant, asset: { ...boundAsset, connection: { ...bound, generation: 2 } }, connection: CONNECTION })).toBe(false);
  });
});
