import { createHash, randomBytes } from "node:crypto";

export type MediaLeaseBinding = Readonly<{
  workspaceId: string;
  creatorId: string;
  intentId: string;
  assetId: string;
  connectionId: string;
  accountSubject: string;
  grantGeneration: number;
  fingerprint: string;
  imageSha256: string;
}>;

export type SyntheticLeaseAsset = Readonly<{
  workspaceId: string;
  creatorId: string;
  assetId: string;
  imageSha256: string;
  bytes: Uint8Array;
  mime: "image/jpeg";
  sourceKind: "synthetic-fixture";
  sampleOnly: true;
  validated: true;
}>;

export type MediaLeaseHandle = Readonly<{ handle: string; expiresAt: string; sampleOnly: true }>;
export type MediaLeaseBytes = Readonly<{ bytes: Uint8Array; mime: "image/jpeg"; sampleOnly: true }>;
export interface MediaLease {
  readonly mode: "mock" | "disabled";
  open(binding: MediaLeaseBinding, ttlMs: number): Promise<MediaLeaseHandle>;
  read(handle: string): Promise<MediaLeaseBytes | null>;
  close(owner: Pick<MediaLeaseBinding, "workspaceId" | "creatorId">, intentId: string): number;
}

export class MediaLeaseError extends Error {
  constructor(readonly code: "MEDIA_LEASE_INVALID" | "MEDIA_LEASE_DENIED" | "MEDIA_LEASE_DISABLED") {
    super(code);
    this.name = "MediaLeaseError";
  }
}

export class DisabledMediaLease implements MediaLease {
  readonly mode = "disabled" as const;
  async open(binding: MediaLeaseBinding, ttlMs: number): Promise<MediaLeaseHandle> {
    void binding; void ttlMs;
    throw new MediaLeaseError("MEDIA_LEASE_DISABLED");
  }
  async read(handle: string): Promise<null> { void handle; return null; }
  close(owner: Pick<MediaLeaseBinding, "workspaceId" | "creatorId">, intentId: string): number {
    void owner; void intentId; return 0;
  }
}

type LeaseRecord = Readonly<{ binding: MediaLeaseBinding; expiresAt: number }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function validBinding(binding: MediaLeaseBinding): boolean {
  return binding != null
    && [binding.workspaceId, binding.creatorId, binding.intentId, binding.assetId, binding.connectionId].every((id) => typeof id === "string" && uuid.test(id))
    && typeof binding.accountSubject === "string" && /^[1-9][0-9]{4,31}$/.test(binding.accountSubject)
    && Number.isSafeInteger(binding.grantGeneration) && binding.grantGeneration > 0
    && [binding.fingerprint, binding.imageSha256].every((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));
}

/**
 * In-memory test-only lease. There is no HTTP endpoint or public URL. Its opaque
 * handle may be passed only to the synthetic publisher. A live media transport
 * would need separately reviewed hosting, durable expiry/revocation and disclosure.
 */
export class MockMediaLease implements MediaLease {
  readonly mode = "mock" as const;
  private readonly entries = new Map<string, LeaseRecord>();
  constructor(private readonly deps: Readonly<{
    now: () => Date;
    // Trusted server resolver must check current owner/draft/intent/grant authority.
    authorize: (binding: MediaLeaseBinding) => Promise<boolean>;
    loadAsset: (binding: MediaLeaseBinding) => Promise<SyntheticLeaseAsset>;
  }>) {}

  private async current(record: LeaseRecord): Promise<boolean> {
    const now = this.deps.now().getTime();
    if (!Number.isFinite(now) || record.expiresAt <= now) return false;
    try { return await this.deps.authorize(record.binding) === true; } catch { return false; }
  }

  async open(binding: MediaLeaseBinding, ttlMs: number): Promise<MediaLeaseHandle> {
    const now = this.deps.now().getTime();
    if (!validBinding(binding) || !Number.isFinite(now) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 60_000) {
      throw new MediaLeaseError("MEDIA_LEASE_INVALID");
    }
    const record: LeaseRecord = { binding: Object.freeze({ ...binding }), expiresAt: now + ttlMs };
    if (!await this.current(record) || this.deps.now().getTime() >= record.expiresAt) {
      throw new MediaLeaseError("MEDIA_LEASE_DENIED");
    }
    const handle = `mock-lease:${randomBytes(32).toString("base64url")}`;
    this.close(record.binding, record.binding.intentId);
    this.entries.set(digest(handle), record);
    return { handle, expiresAt: new Date(record.expiresAt).toISOString(), sampleOnly: true };
  }

  async read(handle: string): Promise<MediaLeaseBytes | null> {
    if (typeof handle !== "string" || !/^mock-lease:[A-Za-z0-9_-]{43}$/.test(handle)) return null;
    const key = digest(handle);
    const record = this.entries.get(key);
    if (!record || !await this.current(record)) return null;
    try {
      const asset = await this.deps.loadAsset(record.binding);
      const binding = record.binding;
      if (asset == null || asset.workspaceId !== binding.workspaceId || asset.creatorId !== binding.creatorId
        || asset.assetId !== binding.assetId || asset.imageSha256 !== binding.imageSha256
        || asset.mime !== "image/jpeg" || asset.sourceKind !== "synthetic-fixture" || asset.sampleOnly !== true || asset.validated !== true
        || !(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength === 0 || asset.bytes.byteLength > 1_048_576) return null;
      const result = new Uint8Array(asset.bytes);
      if (digest(result) !== binding.imageSha256) return null;
      if (!await this.current(record) || this.entries.get(key) !== record) return null;
      // The resolver may await; check clock again immediately before releasing bytes.
      const now = this.deps.now().getTime();
      if (!Number.isFinite(now) || now >= record.expiresAt) return null;
      return { bytes: result, mime: "image/jpeg", sampleOnly: true };
    } catch {
      // An unavailable asset does not disclose a path, credential or provider error.
      return null;
    }
  }

  close(owner: Pick<MediaLeaseBinding, "workspaceId" | "creatorId">, intentId: string): number {
    let closed = 0;
    for (const [key, record] of this.entries) {
      if (record.binding.workspaceId === owner.workspaceId && record.binding.creatorId === owner.creatorId && record.binding.intentId === intentId) {
        this.entries.delete(key);
        closed++;
      }
    }
    return closed;
  }

  cleanup(): number {
    const now = this.deps.now().getTime();
    if (!Number.isFinite(now)) return 0;
    let removed = 0;
    for (const [key, record] of this.entries) {
      if (record.expiresAt <= now) { this.entries.delete(key); removed++; }
    }
    return removed;
  }
}
