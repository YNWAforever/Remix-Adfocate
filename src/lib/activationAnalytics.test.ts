import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDeviceCategory,
  setActivationAnalyticsSink,
  trackActivationEvent,
} from "./activationAnalytics";

describe("activation analytics", () => {
  afterEach(() => {
    setActivationAnalyticsSink(null);
  });

  it("is safe when no analytics sink is configured", () => {
    expect(() =>
      trackActivationEvent("landing_page_viewed", {
        locale: "en",
        deviceCategory: "desktop",
      }),
    ).not.toThrow();
  });

  it("delivers typed activation events to the configured sink", () => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);

    trackActivationEvent("signup_started", {
      locale: "zh",
      deviceCategory: "mobile",
      source: "creators_hero",
    });

    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith({
      name: "signup_started",
      properties: {
        locale: "zh",
        deviceCategory: "mobile",
        source: "creators_hero",
      },
    });
  });

  it("stops delivery after the sink is reset", () => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);
    setActivationAnalyticsSink(null);

    trackActivationEvent("auth_link_requested", {
      locale: "en",
      method: "email_magic_link",
    });

    expect(sink).not.toHaveBeenCalled();
  });

  it("delivers the ten Phase 2 events with privacy-limited payloads", () => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);

    trackActivationEvent("active_mission_workspace_viewed", { locale: "zh-HK", missionType: "ugc", state: "drafting" });
    trackActivationEvent("active_mission_action_clicked", { locale: "zh-HK", missionType: "ugc", state: "drafting", action: "submit_draft" });
    trackActivationEvent("mission_product_received_confirmed", { locale: "zh-HK", missionType: "ugc" });
    trackActivationEvent("mission_draft_started", { locale: "zh-HK", missionType: "ugc", timingBucket: "within_24h" });
    trackActivationEvent("mission_draft_version_submitted", { locale: "zh-HK", missionType: "ugc", assetCount: 2, versionNumber: 1 });
    trackActivationEvent("mission_review_started", { locale: "zh-HK", missionType: "ugc", timingBucket: "within_sla", versionNumber: 1, roundNumber: 1 });
    trackActivationEvent("mission_draft_revision_requested", { locale: "zh-HK", missionType: "ugc", timingBucket: "within_sla", roundNumber: 1 });
    trackActivationEvent("mission_draft_approved_to_publish", { locale: "zh-HK", missionType: "ugc", timingBucket: "within_sla", versionNumber: 2, roundNumber: 2 });
    trackActivationEvent("active_mission_approved_to_publish", { locale: "zh-HK", missionType: "ugc", timingBucket: "on_time", requiredItemCount: 2, revisionRoundCount: 2 });
    trackActivationEvent("active_mission_recovery_used", { locale: "zh-HK", missionType: "ugc", state: "drafting", action: "retry_upload", errorCategory: "network" });

    expect(sink.mock.calls.map(([event]) => event)).toEqual([
      { name: "active_mission_workspace_viewed", properties: {
        locale: "zh-HK", missionType: "ugc", state: "drafting",
      } },
      { name: "active_mission_action_clicked", properties: {
        locale: "zh-HK", missionType: "ugc", state: "drafting", action: "submit_draft",
      } },
      { name: "mission_product_received_confirmed", properties: {
        locale: "zh-HK", missionType: "ugc",
      } },
      { name: "mission_draft_started", properties: {
        locale: "zh-HK", missionType: "ugc", timingBucket: "within_24h",
      } },
      { name: "mission_draft_version_submitted", properties: {
        locale: "zh-HK", missionType: "ugc", assetCount: 2, versionNumber: 1,
      } },
      { name: "mission_review_started", properties: {
        locale: "zh-HK", missionType: "ugc", timingBucket: "within_sla",
        versionNumber: 1, roundNumber: 1,
      } },
      { name: "mission_draft_revision_requested", properties: {
        locale: "zh-HK", missionType: "ugc", timingBucket: "within_sla", roundNumber: 1,
      } },
      { name: "mission_draft_approved_to_publish", properties: {
        locale: "zh-HK", missionType: "ugc", timingBucket: "within_sla",
        versionNumber: 2, roundNumber: 2,
      } },
      { name: "active_mission_approved_to_publish", properties: {
        locale: "zh-HK", missionType: "ugc", timingBucket: "on_time",
        requiredItemCount: 2, revisionRoundCount: 2,
      } },
      { name: "active_mission_recovery_used", properties: {
        locale: "zh-HK", missionType: "ugc", state: "drafting",
        action: "retry_upload", errorCategory: "network",
      } },
    ]);
  });

  it("strips creator-authored content and direct identifiers at runtime", () => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);

    trackActivationEvent("mission_draft_version_submitted", {
      locale: "en",
      missionType: "ugc",
      assetCount: 1,
      versionNumber: 3,
      creatorId: "creator-1",
      submissionId: "submission-1",
      caption: "creator-authored text",
    } as never);

    expect(sink).toHaveBeenCalledWith({
      name: "mission_draft_version_submitted",
      properties: {
        locale: "en",
        missionType: "ugc",
        assetCount: 1,
        versionNumber: 3,
      },
    });
  });

  it("delivers the nine publication proof events with event-specific allowlisted properties", () => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);

    trackActivationEvent("publication_instructions_viewed", {
      locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "approved_to_publish",
    });
    trackActivationEvent("publication_proof_form_started", {
      locale: "zh-HK", missionType: "ugc", platform: "instagram",
      state: "approved_to_publish", timingBucket: "within_24h", attemptNumber: 1,
    });
    trackActivationEvent("publication_proof_submitted", {
      locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "proof_submitted",
      timingBucket: "on_time", attemptNumber: 1, urlCount: 1, evidenceCount: 2,
      lateness: "on_time", metadataStatus: "available",
    });
    trackActivationEvent("publication_proof_metadata_unavailable", {
      locale: "zh-HK", missionType: "ugc", platform: "instagram",
      state: "proof_submitted", attemptNumber: 1, metadataStatus: "unavailable",
    });
    trackActivationEvent("publication_proof_review_started", {
      locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "proof_under_review",
      timingBucket: "within_sla", attemptNumber: 1, reviewNumber: 1,
      metadataStatus: "available",
    });
    trackActivationEvent("publication_proof_correction_requested", {
      locale: "zh-HK", missionType: "ugc", platform: "instagram",
      state: "proof_correction_requested", timingBucket: "within_sla",
      attemptNumber: 1, reviewNumber: 1,
      checklistFailureCategories: ["content", "disclosure"],
    });
    trackActivationEvent("publication_proof_resubmitted", {
      locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "proof_submitted",
      timingBucket: "late", attemptNumber: 2, urlCount: 1, evidenceCount: 1,
      lateness: "late", metadataStatus: "available",
    });
    trackActivationEvent("publication_proof_verified", {
      locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "proof_verified",
      timingBucket: "within_sla", attemptNumber: 2, reviewNumber: 2,
      metadataStatus: "available",
    });
    trackActivationEvent("publication_proof_recovery_used", {
      locale: "zh-HK", missionType: "ugc", platform: "instagram",
      state: "proof_correction_requested", attemptNumber: 2, recoveryCategory: "stale_conflict",
    });

    expect(sink.mock.calls.map(([event]) => event)).toEqual([
      { name: "publication_instructions_viewed", properties: {
        locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "approved_to_publish",
      } },
      { name: "publication_proof_form_started", properties: {
        locale: "zh-HK", missionType: "ugc", platform: "instagram",
        state: "approved_to_publish", timingBucket: "within_24h", attemptNumber: 1,
      } },
      { name: "publication_proof_submitted", properties: {
        locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "proof_submitted",
        timingBucket: "on_time", attemptNumber: 1, urlCount: 1, evidenceCount: 2,
        lateness: "on_time", metadataStatus: "available",
      } },
      { name: "publication_proof_metadata_unavailable", properties: {
        locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "proof_submitted",
        attemptNumber: 1, metadataStatus: "unavailable",
      } },
      { name: "publication_proof_review_started", properties: {
        locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "proof_under_review",
        timingBucket: "within_sla", attemptNumber: 1, reviewNumber: 1,
        metadataStatus: "available",
      } },
      { name: "publication_proof_correction_requested", properties: {
        locale: "zh-HK", missionType: "ugc", platform: "instagram",
        state: "proof_correction_requested", timingBucket: "within_sla",
        attemptNumber: 1, reviewNumber: 1,
        checklistFailureCategories: ["content", "disclosure"],
      } },
      { name: "publication_proof_resubmitted", properties: {
        locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "proof_submitted",
        timingBucket: "late", attemptNumber: 2, urlCount: 1, evidenceCount: 1,
        lateness: "late", metadataStatus: "available",
      } },
      { name: "publication_proof_verified", properties: {
        locale: "zh-HK", missionType: "ugc", platform: "instagram", state: "proof_verified",
        timingBucket: "within_sla", attemptNumber: 2, reviewNumber: 2,
        metadataStatus: "available",
      } },
      { name: "publication_proof_recovery_used", properties: {
        locale: "zh-HK", missionType: "ugc", platform: "instagram",
        state: "proof_correction_requested", attemptNumber: 2, recoveryCategory: "stale_conflict",
      } },
    ]);
  });

  it.each([
    "publication_instructions_viewed",
    "publication_proof_form_started",
    "publication_proof_submitted",
    "publication_proof_metadata_unavailable",
    "publication_proof_review_started",
    "publication_proof_correction_requested",
    "publication_proof_resubmitted",
    "publication_proof_verified",
    "publication_proof_recovery_used",
  ] as const)("drops authored content and identifiers from %s", (name) => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);

    trackActivationEvent(name, {
      locale: "en", missionType: "ugc", platform: "instagram", state: "proof_submitted",
      timingBucket: "on_time", attemptNumber: 1, reviewNumber: 1, urlCount: 1,
      evidenceCount: 1, lateness: "on_time", metadataStatus: "available",
      checklistFailureCategories: ["content"], recoveryCategory: "stale_conflict",
      creatorId: "creator-sensitive", userId: "user-sensitive",
      primaryUrl: "https://creator.example/private-post", caption: "creator-authored caption",
      expectedAccount: "@creator-handle", evidenceContents: "private evidence",
      notes: "operator-authored notes",
    } as never);

    const delivered = sink.mock.calls[0]?.[0];
    expect(delivered?.name).toBe(name);
    expect(JSON.stringify(delivered)).not.toContain("sensitive");
    expect(JSON.stringify(delivered)).not.toContain("private-post");
    expect(JSON.stringify(delivered)).not.toContain("creator-authored");
    expect(JSON.stringify(delivered)).not.toContain("@creator-handle");
    expect(JSON.stringify(delivered)).not.toContain("private evidence");
    expect(JSON.stringify(delivered)).not.toContain("operator-authored");
  });
});

describe("getDeviceCategory", () => {
  it.each([
    [0, "mobile"],
    [767, "mobile"],
    [768, "tablet"],
    [1023, "tablet"],
    [1024, "desktop"],
    [1440, "desktop"],
  ] as const)("classifies width %i as %s", (width, category) => {
    expect(getDeviceCategory(width)).toBe(category);
  });
});
