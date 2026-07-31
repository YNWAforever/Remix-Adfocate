import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVATION_ANALYTICS_EVENT,
  getDeviceCategory,
  initializeActivationAnalytics,
  setActivationAnalyticsSink,
  trackActivationEvent,
} from "./activationAnalytics";

describe("activation analytics", () => {
  afterEach(() => {
    setActivationAnalyticsSink(null);
  });

  it("is safe when no analytics sink is configured", () => {
    expect(
      trackActivationEvent("landing_page_viewed", {
        locale: "en",
        deviceCategory: "desktop",
      }),
    ).toBe(false);
  });

  it("delivers typed activation events to the configured sink", () => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);

    expect(trackActivationEvent("signup_started", {
      locale: "zh",
      deviceCategory: "mobile",
      source: "creators_hero",
    })).toBe(true);

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

  it("initializes a documented browser CustomEvent transport with sanitized detail", () => {
    const listener = vi.fn((event: Event) => event.preventDefault());
    window.addEventListener(ACTIVATION_ANALYTICS_EVENT, listener);
    initializeActivationAnalytics();

    expect(trackActivationEvent("signup_started", {
      locale: "en",
      deviceCategory: "desktop",
      source: "creators_hero",
      creatorId: "creator-private",
    } as never)).toBe(true);

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      name: "signup_started",
      properties: { locale: "en", deviceCategory: "desktop", source: "creators_hero" },
    });
    window.removeEventListener(ACTIVATION_ANALYTICS_EVENT, listener);
  });
  it("reports browser delivery as unaccepted when no consumer acknowledges it", () => {
    initializeActivationAnalytics();
    expect(trackActivationEvent("auth_link_requested", {
      locale: "en",
      method: "email_magic_link",
    })).toBe(false);
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
      locale: "zh", missionType: "ugc", platform: "instagram", state: "approved_to_publish",
    });
    trackActivationEvent("publication_proof_form_started", {
      locale: "zh", missionType: "ugc", platform: "instagram",
      state: "approved_to_publish", timingBucket: "within_24h", attemptNumber: 1,
    });
    trackActivationEvent("publication_proof_submitted", {
      locale: "zh", missionType: "ugc", platform: "instagram", state: "proof_submitted",
      timingBucket: "on_time", attemptNumber: 1, urlCount: 1, evidenceCount: 2,
      lateness: "on_time", metadataStatus: "available",
    });
    trackActivationEvent("publication_proof_metadata_unavailable", {
      locale: "zh", missionType: "ugc", platform: "instagram",
      state: "proof_submitted", attemptNumber: 1, metadataStatus: "unavailable",
    });
    trackActivationEvent("publication_proof_review_started", {
      locale: "zh", missionType: "ugc", platform: "instagram", state: "proof_under_review",
      timingBucket: "within_sla", attemptNumber: 1, reviewNumber: 1,
      metadataStatus: "available",
    });
    trackActivationEvent("publication_proof_correction_requested", {
      locale: "zh", missionType: "ugc", platform: "instagram",
      state: "proof_correction_requested", timingBucket: "within_sla",
      attemptNumber: 1, reviewNumber: 1,
      checklistFailureCategories: ["content", "disclosure"],
    });
    trackActivationEvent("publication_proof_resubmitted", {
      locale: "zh", missionType: "ugc", platform: "instagram", state: "proof_submitted",
      timingBucket: "late", attemptNumber: 2, urlCount: 1, evidenceCount: 1,
      lateness: "late", metadataStatus: "available",
    });
    trackActivationEvent("publication_proof_verified", {
      locale: "zh", missionType: "ugc", platform: "instagram", state: "proof_verified",
      timingBucket: "within_sla", attemptNumber: 2, reviewNumber: 2,
      metadataStatus: "available",
    });
    trackActivationEvent("publication_proof_recovery_used", {
      locale: "zh", missionType: "ugc", platform: "instagram",
      state: "proof_correction_requested", attemptNumber: 2, recoveryCategory: "stale_conflict",
    });

    expect(sink.mock.calls.map(([event]) => event)).toEqual([
      { name: "publication_instructions_viewed", properties: {
        locale: "zh", missionType: "ugc", platform: "instagram", state: "approved_to_publish",
      } },
      { name: "publication_proof_form_started", properties: {
        locale: "zh", missionType: "ugc", platform: "instagram",
        state: "approved_to_publish", timingBucket: "within_24h", attemptNumber: 1,
      } },
      { name: "publication_proof_submitted", properties: {
        locale: "zh", missionType: "ugc", platform: "instagram", state: "proof_submitted",
        timingBucket: "on_time", attemptNumber: 1, urlCount: 1, evidenceCount: 2,
        lateness: "on_time", metadataStatus: "available",
      } },
      { name: "publication_proof_metadata_unavailable", properties: {
        locale: "zh", missionType: "ugc", platform: "instagram", state: "proof_submitted",
        attemptNumber: 1, metadataStatus: "unavailable",
      } },
      { name: "publication_proof_review_started", properties: {
        locale: "zh", missionType: "ugc", platform: "instagram", state: "proof_under_review",
        timingBucket: "within_sla", attemptNumber: 1, reviewNumber: 1,
        metadataStatus: "available",
      } },
      { name: "publication_proof_correction_requested", properties: {
        locale: "zh", missionType: "ugc", platform: "instagram",
        state: "proof_correction_requested", timingBucket: "within_sla",
        attemptNumber: 1, reviewNumber: 1,
        checklistFailureCategories: ["content", "disclosure"],
      } },
      { name: "publication_proof_resubmitted", properties: {
        locale: "zh", missionType: "ugc", platform: "instagram", state: "proof_submitted",
        timingBucket: "late", attemptNumber: 2, urlCount: 1, evidenceCount: 1,
        lateness: "late", metadataStatus: "available",
      } },
      { name: "publication_proof_verified", properties: {
        locale: "zh", missionType: "ugc", platform: "instagram", state: "proof_verified",
        timingBucket: "within_sla", attemptNumber: 2, reviewNumber: 2,
        metadataStatus: "available",
      } },
      { name: "publication_proof_recovery_used", properties: {
        locale: "zh", missionType: "ugc", platform: "instagram",
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

  it("drops unsafe values even when they use allowlisted property names", () => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);

    trackActivationEvent("publication_instructions_viewed", {
      locale: "en", missionType: "ugc", platform: "instagram",
      state: "https://creator.example/private",
    } as never);
    trackActivationEvent("publication_instructions_viewed", {
      locale: "zh", missionType: "ugc", platform: "@creator_handle",
      state: "approved_to_publish",
    } as never);
    trackActivationEvent("publication_proof_form_started", {
      locale: "en", missionType: "ugc", platform: "instagram",
      state: "approved_to_publish", timingBucket: "creator wrote this prose", attemptNumber: 1,
    } as never);
    trackActivationEvent("publication_proof_correction_requested", {
      locale: "en", missionType: "ugc", platform: "instagram",
      state: "proof_correction_requested", timingBucket: "within_sla",
      attemptNumber: 1, reviewNumber: 1,
      checklistFailureCategories: ["content", "550e8400-e29b-41d4-a716-446655440000"],
    } as never);
    trackActivationEvent("publication_proof_recovery_used", {
      locale: "en", missionType: "ugc", platform: "instagram",
      state: "proof_correction_requested", attemptNumber: 2,
      recoveryCategory: "C:\\Users\\creator\\proof.txt",
    } as never);

    expect(sink.mock.calls.map(([event]) => event.properties)).toEqual([
      { locale: "en", missionType: "ugc", platform: "instagram" },
      { locale: "zh", missionType: "ugc", state: "approved_to_publish" },
      {
        locale: "en", missionType: "ugc", platform: "instagram",
        state: "approved_to_publish", attemptNumber: 1,
      },
      {
        locale: "en", missionType: "ugc", platform: "instagram",
        state: "proof_correction_requested", timingBucket: "within_sla",
        attemptNumber: 1, reviewNumber: 1,
      },
      {
        locale: "en", missionType: "ugc", platform: "instagram",
        state: "proof_correction_requested", attemptNumber: 2,
      },
    ]);
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

const rewardHandoffEvents = [
  "mission_completion_review_viewed",
  "mission_completion_approved",
  "mission_reward_pending_viewed",
  "mission_reward_pending_cancelled",
  "mission_reward_support_selected",
  "reward_handoff_queue_viewed",
  "reward_handoff_queue_filtered",
] as const;

describe("reward handoff analytics privacy contract", () => {
  afterEach(() => {
    setActivationAnalyticsSink(null);
  });

  it("delivers all seven typed events with only bounded safe dimensions", () => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);
    const properties = {
      missionId: "11111111-1111-4111-8111-111111111111",
      locale: "zh" as const,
      deviceCategory: "mobile" as const,
      workflowState: "reward_pending" as const,
      contractSource: "operator_backfill" as const,
      errorCategory: "wrong_state" as const,
      hasPoints: true,
      hasCash: false,
      hasXp: true,
    };

    for (const name of rewardHandoffEvents) trackActivationEvent(name, properties);

    expect(sink.mock.calls.map(([event]) => event)).toEqual(
      rewardHandoffEvents.map((name) => ({ name, properties })),
    );
  });

  it.each(rewardHandoffEvents)("drops sensitive keys from %s", (name) => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);

    trackActivationEvent(name, {
      missionId: "11111111-1111-4111-8111-111111111111",
      locale: "en",
      deviceCategory: "desktop",
      workflowState: "proof_verified",
      contractSource: "join",
      errorCategory: "other",
      hasPoints: true,
      hasCash: true,
      hasXp: false,
      pointsAmount: 1000,
      cashAmount: 500,
      xpAmount: 100,
      note: "operator authored note",
      proofUrl: "https://creator.example/private",
      handle: "@creator_handle",
      email: "creator@example.com",
      evidencePath: "C:\\Users\\creator\\proof.txt",
      rawError: new Error("private database failure"),
    } as never);

    expect(sink).toHaveBeenCalledWith({
      name,
      properties: {
        missionId: "11111111-1111-4111-8111-111111111111",
        locale: "en",
        deviceCategory: "desktop",
        workflowState: "proof_verified",
        contractSource: "join",
        errorCategory: "other",
        hasPoints: true,
        hasCash: true,
        hasXp: false,
      },
    });
  });

  it("rejects sensitive values even when placed under allowlisted keys", () => {
    const sink = vi.fn();
    setActivationAnalyticsSink(sink);

    trackActivationEvent("mission_completion_review_viewed", {
      missionId: "https://creator.example/private",
      locale: "creator@example.com",
      deviceCategory: "@creator_handle",
      workflowState: "C:\\Users\\creator\\proof.txt",
      contractSource: "operator authored note",
      errorCategory: "raw database error: creator@example.com",
      hasPoints: 1000,
      hasCash: Number.POSITIVE_INFINITY,
      hasXp: "true",
    } as never);

    expect(sink).toHaveBeenCalledWith({
      name: "mission_completion_review_viewed",
      properties: {},
    });
  });
});
