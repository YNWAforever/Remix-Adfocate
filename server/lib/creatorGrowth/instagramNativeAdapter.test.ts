import { describe, expect, it, vi } from "vitest";
import { MockNativeInstagramAdapter } from "./instagramNativeAdapter.js";
const target = { connectionId: "00000000-0000-4000-8000-000000000041", accountSubject: "123456789", grantGeneration: 1 };
const input = { intentId: "00000000-0000-4000-8000-000000000051", target, imageSha256: "a".repeat(64), caption: "Synthetic", mediaHandle: "mock-lease:example" };
describe("native-shaped mock adapter", () => {
  it("is disabled by default", async () => {
    await expect(new MockNativeInstagramAdapter({ target }).createImageContainer(input)).rejects.toMatchObject({ code: "PUBLISH_PROTOCOL_UNVERIFIED" });
  });
  it("uses only in-memory operations and preserves synthetic provenance", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const adapter = new MockNativeInstagramAdapter({ target, enabled: true });
      const container = await adapter.createImageContainer(input);
      expect(await adapter.getContainerStatus(target, container.containerId)).toEqual({ state: "ready", sampleOnly: true });
      const receipt = await adapter.publishContainer(target, container.containerId);
      expect(await adapter.getPublishedMedia(target, receipt.mediaId)).toEqual({ ...receipt, accountSubject: target.accountSubject, permalink: null });
      await expect(adapter.publishContainer(target, container.containerId)).rejects.toMatchObject({ code: "PUBLISH_ALREADY_REQUESTED" });
      expect(adapter.callCounts()).toEqual({ create: 1, status: 1, publish: 1, lookup: 1 });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it.each([{ accountSubject: "987654321" }, { grantGeneration: 2 }, { connectionId: "00000000-0000-4000-8000-000000000042" }])("denies a different target %j", async patch => {
    const adapter = new MockNativeInstagramAdapter({ target, enabled: true });
    await expect(adapter.createImageContainer({ ...input, target: { ...target, ...patch } })).rejects.toMatchObject({ code: "PUBLISH_TARGET_MISMATCH" });
    expect(adapter.callCounts().create).toBe(0);
  });
  it.each(["timeout_before_accept", "timeout_after_accept"] as const)("does not retry ambiguous %s", async publishOutcome => {
    const adapter = new MockNativeInstagramAdapter({ target, enabled: true, publishOutcome });
    const container = await adapter.createImageContainer(input);
    await expect(adapter.publishContainer(target, container.containerId)).rejects.toMatchObject({ code: "PUBLISH_OUTCOME_UNKNOWN", outcome: "unknown" });
    await expect(adapter.publishContainer(target, container.containerId)).rejects.toMatchObject({ code: "PUBLISH_ALREADY_REQUESTED" });
    expect(adapter.callCounts().publish).toBe(1);
  });
  it("keeps a processing container unpublishable", async () => {
    const adapter = new MockNativeInstagramAdapter({ target, enabled: true, containerState: "processing" });
    const c = await adapter.createImageContainer(input);
    await expect(adapter.publishContainer(target, c.containerId)).rejects.toMatchObject({ code: "PUBLISH_CONTAINER_NOT_READY" });
  });
});
