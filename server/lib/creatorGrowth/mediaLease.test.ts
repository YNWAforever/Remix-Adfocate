// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DisabledMediaLease, MockMediaLease, type MediaLeaseBinding, type SyntheticLeaseAsset } from "./mediaLease.js";

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const binding: MediaLeaseBinding = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  creatorId: "00000000-0000-4000-8000-000000000011",
  intentId: "00000000-0000-4000-8000-000000000021",
  assetId: "00000000-0000-4000-8000-000000000031",
  connectionId: "00000000-0000-4000-8000-000000000041",
  accountSubject: "17840000000000001",
  grantGeneration: 3,
  fingerprint: "a".repeat(64),
  imageSha256: createHash("sha256").update(bytes).digest("hex"),
};

function fixture() {
  let time = Date.parse("2026-11-04T00:00:00Z");
  let authorized = true;
  const source: SyntheticLeaseAsset = {
    ...binding, bytes: new Uint8Array(bytes), mime: "image/jpeg",
    sampleOnly: true, sourceKind: "synthetic-fixture", validated: true,
  };
  const loadAsset = vi.fn(async (): Promise<SyntheticLeaseAsset> => ({ ...source, bytes: new Uint8Array(source.bytes) }));
  const authorize = vi.fn(async () => authorized);
  const lease = new MockMediaLease({ now: () => new Date(time), authorize, loadAsset });
  return { lease, source, loadAsset, authorize, advance: (delta: number) => { time += delta; }, revoke: () => { authorized = false; } };
}

describe("local synthetic media lease", () => {
  it("keeps the disabled transport unusable even with a well-formed binding", async () => {
    const lease = new DisabledMediaLease();
    await expect(lease.open(binding, 1_000)).rejects.toMatchObject({ code: "MEDIA_LEASE_DISABLED" });
    expect(await lease.read("mock-lease:" + "x".repeat(43))).toBeNull();
    expect(lease.close(binding, binding.intentId)).toBe(0);
  });

  it("returns an opaque local handle and only the approved synthetic bytes", async () => {
    const f = fixture();
    const opened = await f.lease.open(binding, 30_000);
    expect(opened.handle).toMatch(/^mock-lease:[A-Za-z0-9_-]{43}$/);
    expect(opened.sampleOnly).toBe(true);
    for (const value of [binding.assetId, binding.creatorId, binding.connectionId, binding.imageSha256, "https", "storage"]) {
      expect(opened.handle).not.toContain(value);
    }
    const result = await f.lease.read(opened.handle);
    expect(result?.bytes).toEqual(bytes);
    expect(result?.mime).toBe("image/jpeg");
    expect(result?.sampleOnly).toBe(true);
  });

  it("denies expired, revoked, closed and unknown handles before loading bytes", async () => {
    const f = fixture();
    const expired = await f.lease.open(binding, 1_000);
    f.advance(1_000);
    expect(await f.lease.read(expired.handle)).toBeNull();
    const revoked = await f.lease.open(binding, 1_000);
    f.revoke();
    expect(await f.lease.read(revoked.handle)).toBeNull();
    expect(await f.lease.read("mock-lease:" + "x".repeat(43))).toBeNull();
    expect(f.loadAsset).not.toHaveBeenCalled();
    const next = fixture();
    const opened = await next.lease.open(binding, 1_000);
    expect(next.lease.close(binding, binding.intentId)).toBe(1);
    expect(await next.lease.read(opened.handle)).toBeNull();
    expect(next.loadAsset).not.toHaveBeenCalled();
  });

  it("rechecks lifecycle after loading to stop a revoke that happened in flight", async () => {
    const f = fixture();
    const opened = await f.lease.open(binding, 30_000);
    f.loadAsset.mockImplementationOnce(async () => { f.revoke(); return f.source; });
    expect(await f.lease.read(opened.handle)).toBeNull();
  });

  it("rechecks expiry after loading without releasing stale bytes", async () => {
    const f = fixture();
    const opened = await f.lease.open(binding, 1_000);
    f.loadAsset.mockImplementationOnce(async () => { f.advance(1_000); return f.source; });
    expect(await f.lease.read(opened.handle)).toBeNull();
  });

  it.each(["creatorId", "workspaceId", "assetId", "imageSha256"] as const)("rejects a loader returning another %s", async (field) => {
    const f = fixture();
    const opened = await f.lease.open(binding, 30_000);
    f.loadAsset.mockResolvedValueOnce({ ...f.source, [field]: field === "imageSha256" ? "b".repeat(64) : "00000000-0000-4000-8000-000000000099" });
    expect(await f.lease.read(opened.handle)).toBeNull();
  });

  it("detects changed bytes even when stored metadata repeats the original hash", async () => {
    const f = fixture();
    const opened = await f.lease.open(binding, 30_000);
    f.loadAsset.mockResolvedValueOnce({ ...f.source, bytes: new Uint8Array([1, 2, 3, 4]) });
    expect(await f.lease.read(opened.handle)).toBeNull();
  });

  it.each([
    { sampleOnly: false }, { sourceKind: "creator-upload" },
    { validated: false }, { mime: "image/png" },
  ])("never serves a real or unvalidated asset through a mock lease (%j)", async (patch) => {
    const f = fixture();
    const opened = await f.lease.open(binding, 30_000);
    f.loadAsset.mockResolvedValueOnce({ ...f.source, ...patch } as SyntheticLeaseAsset);
    expect(await f.lease.read(opened.handle)).toBeNull();
  });

  it("does not let a colleague or another workspace close an owner's lease", async () => {
    const f = fixture();
    const opened = await f.lease.open(binding, 30_000);
    expect(f.lease.close({ ...binding, creatorId: "00000000-0000-4000-8000-000000000012" }, binding.intentId)).toBe(0);
    expect(f.lease.close({ ...binding, workspaceId: "00000000-0000-4000-8000-000000000002" }, binding.intentId)).toBe(0);
    expect(await f.lease.read(opened.handle)).not.toBeNull();
  });

  it("invalidates an older lease for the same intent when a new handle is issued", async () => {
    const f = fixture();
    const older = await f.lease.open(binding, 30_000);
    const newer = await f.lease.open(binding, 30_000);
    expect(newer.handle).not.toBe(older.handle);
    expect(await f.lease.read(older.handle)).toBeNull();
    expect(await f.lease.read(newer.handle)).not.toBeNull();
  });

  it("keeps the original owner binding when a caller mutates its object during authorization", async () => {
    const f = fixture();
    const older = await f.lease.open(binding, 30_000);
    const mutable = { ...binding };
    f.authorize.mockImplementationOnce(async () => {
      mutable.creatorId = "00000000-0000-4000-8000-000000000012";
      return true;
    });
    const newer = await f.lease.open(mutable, 30_000);
    expect(await f.lease.read(older.handle)).toBeNull();
    expect(await f.lease.read(newer.handle)).not.toBeNull();
  });

  it.each([0, -1, 60_001, Infinity, NaN])( "rejects invalid or excessive local TTL %s", async (ttl) => {
    await expect(fixture().lease.open(binding, ttl)).rejects.toMatchObject({ code: "MEDIA_LEASE_INVALID" });
  });

  it("cannot create a lease after authorization is withdrawn", async () => {
    const f = fixture();
    f.revoke();
    await expect(f.lease.open(binding, 1_000)).rejects.toMatchObject({ code: "MEDIA_LEASE_DENIED" });
    expect(f.loadAsset).not.toHaveBeenCalled();
  });

  it("returns no bytes and no diagnostic details when the loader or authorization fails", async () => {
    const f = fixture();
    const opened = await f.lease.open(binding, 30_000);
    f.loadAsset.mockRejectedValueOnce(new Error("storage/private-path?token=secret"));
    expect(await f.lease.read(opened.handle)).toBeNull();
    f.authorize.mockRejectedValueOnce(new Error("private grant"));
    expect(await f.lease.read(opened.handle)).toBeNull();
  });

  it("removes only expired handles during local cleanup", async () => {
    const f = fixture();
    const first = await f.lease.open(binding, 1_000);
    const second = await f.lease.open({ ...binding, intentId: "00000000-0000-4000-8000-000000000022" }, 2_000);
    f.advance(1_000);
    expect(f.lease.cleanup()).toBe(1);
    expect(await f.lease.read(first.handle)).toBeNull();
    expect(await f.lease.read(second.handle)).not.toBeNull();
  });
});
