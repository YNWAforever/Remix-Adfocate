import { describe, expect, it } from "vitest";

import { ActiveMissionError, statusFor } from "./errors";
import {
  assertTransition,
  compareQueueItems,
  deriveWorkflowState,
  normalizeProofInput,
  validateProofChecklist,
  validateDraftPatch,
} from "./state";

describe("active mission domain state", () => {
  it("keeps the workflow behind the fulfillment gate until receipt", () => {
    expect(
      deriveWorkflowState({
        fulfillment: "shipped",
        items: [{ state: "drafting", required: true }],
      }),
    ).toBe("fulfillment_pending");
  });

  it("derives drafting while any required item still needs a draft", () => {
    expect(
      deriveWorkflowState({
        fulfillment: null,
        items: [
          { state: "approved_to_publish", required: true },
          { state: "drafting", required: true },
        ],
      }),
    ).toBe("drafting");
  });

  it("derives approved only when every required item is approved", () => {
    expect(
      deriveWorkflowState({
        fulfillment: null,
        items: [{ state: "approved_to_publish", required: true }],
      }),
    ).toBe("approved_to_publish");
  });

  it("derives revision requested from an optional item", () => {
    expect(
      deriveWorkflowState({
        fulfillment: null,
        items: [
          { state: "drafting", required: true },
          { state: "revision_requested", required: false },
        ],
      }),
    ).toBe("revision_requested");
  });

  it("derives approved when required items are approved despite optional drafts", () => {
    expect(
      deriveWorkflowState({
        fulfillment: null,
        items: [
          { state: "approved_to_publish", required: true },
          { state: "drafting", required: false },
        ],
      }),
    ).toBe("approved_to_publish");
  });

  it("uses revision and review precedence from the database derivation", () => {
    expect(
      deriveWorkflowState({
        fulfillment: "received",
        items: [
          { state: "under_review", required: true },
          { state: "revision_requested", required: true },
        ],
      }),
    ).toBe("revision_requested");
    expect(
      deriveWorkflowState({
        fulfillment: null,
        items: [
          { state: "submitted", required: true },
          { state: "drafting", required: true },
        ],
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

  it("allows the publication proof transition chain and correction resubmission", () => {
    expect(() =>
      assertTransition("approved_to_publish", "proof_submitted"),
    ).not.toThrow();
    expect(() =>
      assertTransition("proof_submitted", "proof_under_review"),
    ).not.toThrow();
    expect(() =>
      assertTransition("proof_under_review", "proof_correction_requested"),
    ).not.toThrow();
    expect(() =>
      assertTransition("proof_correction_requested", "proof_submitted"),
    ).not.toThrow();
    expect(() =>
      assertTransition("proof_under_review", "proof_verified"),
    ).not.toThrow();
  });

  it("derives proof verified only after every required item is verified", () => {
    expect(
      deriveWorkflowState({
        fulfillment: null,
        items: [
          { required: true, state: "proof_verified" },
          { required: true, state: "proof_verified" },
          { required: false, state: "proof_under_review" },
        ],
      }),
    ).toBe("proof_verified");

    expect(
      deriveWorkflowState({
        fulfillment: null,
        items: [
          { required: true, state: "proof_verified" },
          { required: true, state: "proof_under_review" },
        ],
      }),
    ).toBe("publication_in_progress");
  });

  it("derives publication in progress for required publication-stage items only", () => {
    expect(
      deriveWorkflowState({
        fulfillment: null,
        items: [
          { required: true, state: "proof_correction_requested" },
          { required: false, state: "proof_verified" },
        ],
      }),
    ).toBe("publication_in_progress");

    expect(
      deriveWorkflowState({
        fulfillment: null,
        items: [
          { required: true, state: "drafting" },
          { required: false, state: "proof_under_review" },
        ],
      }),
    ).toBe("drafting");
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
  it("puts late submissions ahead of every on-time queue item", () => {
    expect(
      compareQueueItems(
        {
          submittedLate: true,
          deadline: "2026-07-18T00:00:00Z",
        },
        {
          submittedLate: false,
          deadline: "2026-07-16T00:00:00Z",
        },
      ),
    ).toBeLessThan(0);
  });
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

describe("active mission publication proof validation", () => {
  const checklist = {
    publicly_accessible: true,
    platform_matches: true,
    account_matches: true,
    content_matches_approved_version: true,
    timing_acceptable: true,
    disclosures_present: true,
  };

  it("requires exactly the six operator checklist keys with boolean values", () => {
    expect(() => validateProofChecklist(checklist)).not.toThrow();
    expect(() =>
      validateProofChecklist({ publicly_accessible: true }),
    ).toThrow("VALIDATION_FAILED");
    expect(() =>
      validateProofChecklist({ ...checklist, extra: true }),
    ).toThrow("VALIDATION_FAILED");
    expect(() =>
      validateProofChecklist({ ...checklist, disclosures_present: "yes" }),
    ).toThrow("VALIDATION_FAILED");
  });

  it("normalizes structurally valid proof input without applying URL safety checks", () => {
    expect(
      normalizeProofInput({
        primaryUrl: " proof-url ",
        additionalUrls: [" first ", "second"],
        evidenceAssetIds: ["asset-1", "asset-2"],
      }),
    ).toEqual({
      primaryUrl: "proof-url",
      additionalUrls: ["first", "second"],
      evidenceAssetIds: ["asset-1", "asset-2"],
    });
  });

  it("enforces proof URL and evidence structural bounds", () => {
    expect(() =>
      normalizeProofInput({
        primaryUrl: "primary",
        additionalUrls: ["one", "two", "three", "four", "five"],
      }),
    ).toThrow("VALIDATION_FAILED");
    expect(() =>
      normalizeProofInput({
        primaryUrl: "primary",
        additionalUrls: ["primary"],
      }),
    ).toThrow("VALIDATION_FAILED");
    expect(() =>
      normalizeProofInput({
        primaryUrl: "primary",
        evidenceAssetIds: ["asset-1", "asset-1"],
      }),
    ).toThrow("VALIDATION_FAILED");
  });
});

describe("active mission errors", () => {
  it("retains the workflow code and maps it to HTTP status", () => {
    const error = new ActiveMissionError("WRONG_STATE", "cannot move backwards");

    expect(error.message).toBe("cannot move backwards");
    expect(error.code).toBe("WRONG_STATE");
    expect(statusFor(error.code)).toBe(409);
  });

  it("maps proof-specific errors to their HTTP status", () => {
    expect(statusFor("UNSAFE_PROOF_URL")).toBe(422);
    expect(statusFor("PUBLICATION_SETUP_REQUIRED")).toBe(409);
  });
});
