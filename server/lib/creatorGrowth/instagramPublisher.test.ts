// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DisabledInstagramPublisher,
  MockInstagramPublisher,
  type PublisherTarget,
} from "./instagramPublisher.js";

const target: PublisherTarget = {
  connectionId: "00000000-0000-4000-8000-000000000051",
  accountSubject: "17840000000000001",
  grantGeneration: 3,
};
const request = {
  intentId: "00000000-0000-4000-8000-000000000061",
  target,
  imageSha256: "a".repeat(64),
  caption: "合成試拍，未曾發佈。",
  mediaHandle: "mock-lease:synthetic-1",
};

afterEach(() => vi.unstubAllGlobals());

describe("offline Instagram publishing adapter", () => {
  it("defaults to a blocked live adapter with no network calls", async () => {
    const fetch = vi.fn(() => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    const provider = new DisabledInstagramPublisher();
    await expect(provider.createImageContainer(request)).rejects.toMatchObject({ code: "PUBLISH_PROTOCOL_UNVERIFIED" });
    await expect(provider.getContainerStatus(target, "90001")).rejects.toMatchObject({ code: "PUBLISH_PROTOCOL_UNVERIFIED" });
    await expect(provider.publishContainer(target, "90001")).rejects.toMatchObject({ code: "PUBLISH_PROTOCOL_UNVERIFIED" });
    await expect(provider.getPublishedMedia(target, "90002")).rejects.toMatchObject({ code: "PUBLISH_PROTOCOL_UNVERIFIED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("runs an explicitly synthetic container-to-receipt flow without network", async () => {
    const fetch = vi.fn(() => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    const provider = new MockInstagramPublisher({ target });
    const container = await provider.createImageContainer(request);
    expect(container.sampleOnly).toBe(true);
    expect(await provider.getContainerStatus(target, container.containerId)).toEqual({ state: "ready", sampleOnly: true });
    const receipt = await provider.publishContainer(target, container.containerId);
    expect(await provider.getPublishedMedia(target, receipt.mediaId)).toEqual({
      mediaId: receipt.mediaId, accountSubject: target.accountSubject, permalink: null, sampleOnly: true,
    });
    expect(provider.callCounts()).toEqual({ create: 1, status: 1, publish: 1, lookup: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...target, connectionId: "00000000-0000-4000-8000-000000000052" },
    { ...target, accountSubject: "17840000000000002" },
    { ...target, grantGeneration: 4 },
  ])("denies every operation for another target or generation", async (wrong) => {
    const provider = new MockInstagramPublisher({ target });
    const { containerId } = await provider.createImageContainer(request);
    const { mediaId } = await provider.publishContainer(target, containerId);
    await expect(provider.createImageContainer({ ...request, target: wrong })).rejects.toMatchObject({ code: "PUBLISH_TARGET_MISMATCH" });
    await expect(provider.getContainerStatus(wrong, containerId)).rejects.toMatchObject({ code: "PUBLISH_TARGET_MISMATCH" });
    await expect(provider.publishContainer(wrong, containerId)).rejects.toMatchObject({ code: "PUBLISH_TARGET_MISMATCH" });
    await expect(provider.getPublishedMedia(wrong, mediaId)).rejects.toMatchObject({ code: "PUBLISH_TARGET_MISMATCH" });
    expect(provider.callCounts()).toEqual({ create: 1, status: 0, publish: 1, lookup: 0 });
  });

  it.each(["processing", "failed", "unknown"] as const)("does not publish a %s container", async (containerState) => {
    const provider = new MockInstagramPublisher({ target, containerState });
    const { containerId } = await provider.createImageContainer(request);
    expect((await provider.getContainerStatus(target, containerId)).state).toBe(containerState);
    await expect(provider.publishContainer(target, containerId)).rejects.toMatchObject({ code: "PUBLISH_CONTAINER_NOT_READY" });
    expect(provider.callCounts().publish).toBe(0);
  });

  it("does not hide a duplicate create request behind invented provider idempotency", async () => {
    const provider = new MockInstagramPublisher({ target });
    const first = await provider.createImageContainer(request);
    const second = await provider.createImageContainer(request);
    expect(second.containerId).not.toBe(first.containerId);
    expect(provider.callCounts().create).toBe(2);
  });

  it.each(["timeout_before_accept", "timeout_after_accept"] as const)("keeps %s ambiguous and forbids a second publish", async (publishOutcome) => {
    const provider = new MockInstagramPublisher({ target, publishOutcome });
    const { containerId } = await provider.createImageContainer(request);
    await expect(provider.publishContainer(target, containerId)).rejects.toMatchObject({ code: "PUBLISH_OUTCOME_UNKNOWN", outcome: "unknown" });
    expect(await provider.getContainerStatus(target, containerId)).toEqual({ state: "unknown", sampleOnly: true });
    await expect(provider.publishContainer(target, containerId)).rejects.toMatchObject({ code: "PUBLISH_ALREADY_REQUESTED" });
    expect(provider.callCounts().publish).toBe(1);
  });

  it("treats create timeout as unknown without guessing a container ID", async () => {
    const provider = new MockInstagramPublisher({ target, createOutcome: "timeout" });
    await expect(provider.createImageContainer(request)).rejects.toMatchObject({ code: "PUBLISH_OUTCOME_UNKNOWN", outcome: "unknown" });
    expect(provider.callCounts()).toEqual({ create: 1, status: 0, publish: 0, lookup: 0 });
  });

  it("returns a safe definitive provider rejection and still never republishes it", async () => {
    const provider = new MockInstagramPublisher({ target, publishOutcome: "rejected" });
    const { containerId } = await provider.createImageContainer(request);
    await expect(provider.publishContainer(target, containerId)).rejects.toMatchObject({ code: "PUBLISH_PROVIDER_REJECTED", outcome: "failed" });
    await expect(provider.publishContainer(target, containerId)).rejects.toMatchObject({ code: "PUBLISH_ALREADY_REQUESTED" });
  });

  it("does not fabricate a receipt for an unknown media or container ID", async () => {
    const provider = new MockInstagramPublisher({ target });
    await expect(provider.getContainerStatus(target, "99999")).rejects.toMatchObject({ code: "PUBLISH_NOT_FOUND" });
    await expect(provider.getPublishedMedia(target, "99999")).rejects.toMatchObject({ code: "PUBLISH_NOT_FOUND" });
  });

  it.each(["https://example.invalid/private.jpg", "data:image/jpeg;base64,AA", "../private", ""])("rejects non-mock media handle %s", async (mediaHandle) => {
    const provider = new MockInstagramPublisher({ target });
    await expect(provider.createImageContainer({ ...request, mediaHandle })).rejects.toMatchObject({ code: "PUBLISH_INVALID_INPUT" });
    expect(provider.callCounts().create).toBe(0);
  });

  it("copies its target so a caller cannot switch accounts through later mutation", async () => {
    const configured = { ...target };
    const provider = new MockInstagramPublisher({ target: configured });
    configured.accountSubject = "17840000000000002";
    await expect(provider.createImageContainer({ ...request, target: configured })).rejects.toMatchObject({ code: "PUBLISH_TARGET_MISMATCH" });
    const { containerId } = await provider.createImageContainer(request);
    await expect(provider.publishContainer(target, containerId)).resolves.toMatchObject({ sampleOnly: true });
  });

  it("never returns a caption, handle, bytes or token in its receipt", async () => {
    const provider = new MockInstagramPublisher({ target });
    const created = await provider.createImageContainer(request);
    const receipt = await provider.publishContainer(target, created.containerId);
    const result = JSON.stringify({ created, receipt, media: await provider.getPublishedMedia(target, receipt.mediaId), counts: provider.callCounts() });
    expect(result).not.toContain(request.caption);
    expect(result).not.toContain(request.mediaHandle);
    expect(result).not.toMatch(/token|bytes|storage|https?:/i);
  });
});
