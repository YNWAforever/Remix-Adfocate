import { describe, expect, it, vi } from "vitest";
import {
  createCreatorGrowthClient,
  type CreatorGrowthTransport,
} from "./queries";

const idempotencyKey = "00000000-0000-4000-8000-000000000101";
const threadId = "00000000-0000-4000-8000-000000000041";
const assetId = "00000000-0000-4000-8000-000000000071";
const analysisId = "00000000-0000-4000-8000-000000000081";
const skillInvocationId = "00000000-0000-4000-8000-000000000091";
const connectionId = "00000000-0000-4000-8000-000000000051";
const resourceId = "00000000-0000-4000-8000-000000000061";

function jsonBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("creator growth client", () => {
  it("keeps idempotency keys out of JSON request bodies", async () => {
    const requests: Array<readonly [string, RequestInit]> = [];
    const request = vi.fn(async <Result>(
      path: string,
      init: RequestInit,
    ) => {
      requests.push([path, init]);
      return {} as Result;
    });
    const client = createCreatorGrowthClient({
      request,
    } as CreatorGrowthTransport);

    await client.analyse({
      threadId,
      assetId,
      sourceSelection: [],
      processorConsentVersion: "consent-v1",
      idempotencyKey,
    });
    await client.requestSkill({
      threadId,
      analysisId,
      mediaSourceIds: [],
      skillId: "next_caption",
      question: "Improve this post",
      idempotencyKey,
    });
    await client.saveDraft({
      threadId,
      assetId,
      analysisId,
      skillInvocationId,
      skillId: "next_caption",
      expectedRevision: 0,
      caption: "Draft",
      manualDescription: "",
      evidenceReportId: null,
      idempotencyKey,
    });
    await client.selectMedia({
      threadId,
      officialMediaRef: { connectionId, resourceId },
      candidateRef: "mock-image-ref:test",
      idempotencyKey,
    });

    expect(jsonBody(requests[1][1])).toEqual({ threadId, analysisId, mediaSourceIds: [], skillId: "next_caption", question: "Improve this post" });
    for (const [path, init] of requests) {
      expect(path).toContain("/creator-growth/");
      expect(new Headers(init.headers).get("Idempotency-Key")).toBe(
        idempotencyKey,
      );
      expect(jsonBody(init)).not.toHaveProperty("idempotencyKey");
    }
  });

  it("uploads through multipart with the key only in the request header", async () => {
    const requests: Array<readonly [string, RequestInit]> = [];
    const request = vi.fn(async <Result>(
      path: string,
      init: RequestInit,
    ) => {
      requests.push([path, init]);
      return {} as Result;
    });
    const client = createCreatorGrowthClient({
      request,
    } as CreatorGrowthTransport);

    await client.uploadAsset({
      threadId,
      rightsConfirmed: true,
      file: new Blob(["image"], { type: "image/png" }),
      idempotencyKey,
    });

    const [path, init] = requests[0];
    expect(path).toBe("/creator-growth/assets");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(
      idempotencyKey,
    );
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).has("idempotencyKey")).toBe(false);
  });
});
