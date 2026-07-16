import { describe, expect, it } from "vitest";

import { ActiveMissionError, statusFor } from "./errors";
import {
  assertTransition,
  compareQueueItems,
  deriveWorkflowState,
  validateDraftPatch,
} from "./state";

describe("active mission domain state", () => {
  it("keeps the workflow behind the fulfillment gate until receipt", () => {
    expect(
      deriveWorkflowState({ fulfillment: "shipped", requiredStates: ["drafting"] }),
    ).toBe("fulfillment_pending");
  });

  it("derives drafting while any required item still needs a draft", () => {
    expect(
      deriveWorkflowState({
        fulfillment: null,
        requiredStates: ["approved_to_publish", "drafting"],
      }),
    ).toBe("drafting");
  });

  it("derives approved only when every required item is approved", () => {
    expect(
      deriveWorkflowState({
        fulfillment: null,
        requiredStates: ["approved_to_publish"],
      }),
    ).toBe("approved_to_publish");
  });

  it("uses revision and review precedence from the database derivation", () => {
    expect(
      deriveWorkflowState({
        fulfillment: "received",
        requiredStates: ["under_review", "revision_requested"],
      }),
    ).toBe("revision_requested");
    expect(
      deriveWorkflowState({
        fulfillment: null,
        requiredStates: ["submitted", "drafting"],
      }),
    ).toBe("in_review");
  });

  it("allows only the approved work-item transitions", () => {
    expect(() => assertTransition("drafting", "submitted")).not.toThrow();
    expect(() => assertTransition("revision_requested", "submitted")).not.toThrow();
    expect(() => assertTransition("approved_to_publish", "cancelled")).not.toThrow();
    expect(() => assertTransition("approved_to_publish", "drafting")).toThrowError(
      /WRONG_STATE/,
    );
    expect(() => assertTransition("cancelled", "drafting")).toThrowError(
      /WRONG_STATE/,
    );
  });
});

describe("active mission draft validation", () => {
  const knownRequirementIds = new Set(["format", "disclosure"]);

  it("accepts a bounded caption, HTTP(S) URL, and known boolean checklist", () => {
    expect(() =>
      validateDraftPatch(
        {
          caption: "a".repeat(10_000),
          externalUrl: "https://example.com/draft",
          checklist: { format: true, disclosure: false },
        },
        knownRequirementIds,
      ),
    ).not.toThrow();
  });

  it.each([
    [{ caption: "a".repeat(10_001) }, "caption"],
    [{ externalUrl: "ftp://example.com/draft" }, "externalUrl"],
    [{ checklist: { unknown: true } }, "unknown"],
    [{ checklist: { format: "yes" } }, "boolean"],
  ])("rejects invalid draft patch %j", (patch, message) => {
    expect(() =>
      validateDraftPatch(patch, knownRequirementIds),
    ).toThrowError(message);
  });
});

describe("active mission queue ordering", () => {
  it("sorts by creator deadline first", () => {
    expect(
      compareQueueItems(
        { deadline: "2026-07-16T00:00:00Z", reviewDueAt: null },
        { deadline: "2026-07-17T00:00:00Z", reviewDueAt: null },
      ),
    ).toBeLessThan(0);
  });

  it("then sorts by review SLA and submission time, with missing times last", () => {
    expect(
      compareQueueItems(
        {
          deadline: "2026-07-16T00:00:00Z",
          reviewDueAt: "2026-07-16T02:00:00Z",
          submittedAt: "2026-07-16T01:00:00Z",
        },
        {
          deadline: "2026-07-16T00:00:00Z",
          reviewDueAt: "2026-07-16T03:00:00Z",
          submittedAt: "2026-07-16T00:00:00Z",
        },
      ),
    ).toBeLessThan(0);
    expect(
      compareQueueItems(
        {
          deadline: "2026-07-16T00:00:00Z",
          reviewDueAt: null,
          submittedAt: "2026-07-16T01:00:00Z",
        },
        {
          deadline: "2026-07-16T00:00:00Z",
          reviewDueAt: null,
          submittedAt: "2026-07-16T02:00:00Z",
        },
      ),
    ).toBeLessThan(0);
    expect(
      compareQueueItems(
        { deadline: null, reviewDueAt: null },
        { deadline: "2026-07-16T00:00:00Z", reviewDueAt: null },
      ),
    ).toBeGreaterThan(0);
  });
});

describe("active mission errors", () => {
  it("retains the workflow code and maps it to HTTP status", () => {
    const error = new ActiveMissionError("WRONG_STATE", "cannot move backwards");

    expect(error.message).toBe("cannot move backwards");
    expect(error.code).toBe("WRONG_STATE");
    expect(statusFor(error.code)).toBe(409);
  });
});
