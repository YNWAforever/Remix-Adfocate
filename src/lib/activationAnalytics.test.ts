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

    expect(sink).toHaveBeenCalledTimes(10);
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
