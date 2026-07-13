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
