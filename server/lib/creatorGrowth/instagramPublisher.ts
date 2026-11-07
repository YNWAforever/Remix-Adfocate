/** Offline contracts only. Nothing in this module opens a network connection. */
export type PublisherTarget = Readonly<{
  connectionId: string;
  accountSubject: string;
  grantGeneration: number;
}>;

export type ImageContainerInput = Readonly<{
  intentId: string;
  target: PublisherTarget;
  imageSha256: string;
  caption: string;
  mediaHandle: string;
}>;

export type ContainerState = "ready" | "processing" | "failed" | "unknown";
export type ContainerReceipt = Readonly<{ containerId: string; sampleOnly: boolean }>;
export type PublishReceipt = Readonly<{ mediaId: string; sampleOnly: boolean }>;
export type PublishedMedia = Readonly<{
  mediaId: string;
  accountSubject: string;
  permalink: string | null;
  sampleOnly: boolean;
}>;

export interface InstagramPublisher {
  readonly mode: "disabled" | "mock";
  createImageContainer(input: ImageContainerInput): Promise<ContainerReceipt>;
  getContainerStatus(target: PublisherTarget, containerId: string): Promise<Readonly<{ state: ContainerState; sampleOnly: boolean }>>;
  publishContainer(target: PublisherTarget, containerId: string): Promise<PublishReceipt>;
  getPublishedMedia(target: PublisherTarget, mediaId: string): Promise<PublishedMedia>;
}

export type PublishProviderErrorCode =
  | "PUBLISH_PROTOCOL_UNVERIFIED"
  | "PUBLISH_TARGET_MISMATCH"
  | "PUBLISH_INVALID_INPUT"
  | "PUBLISH_NOT_FOUND"
  | "PUBLISH_CONTAINER_NOT_READY"
  | "PUBLISH_ALREADY_REQUESTED"
  | "PUBLISH_PROVIDER_REJECTED"
  | "PUBLISH_OUTCOME_UNKNOWN";

export class PublishProviderError extends Error {
  constructor(
    readonly code: PublishProviderErrorCode,
    readonly outcome: "failed" | "unknown" = "failed",
  ) {
    // No raw provider exception, caption, media handle or credential enters errors.
    super(code);
    this.name = "PublishProviderError";
  }
}

export class DisabledInstagramPublisher implements InstagramPublisher {
  readonly mode = "disabled" as const;
  private blocked(): never { throw new PublishProviderError("PUBLISH_PROTOCOL_UNVERIFIED"); }
  async createImageContainer(input: ImageContainerInput): Promise<ContainerReceipt> { void input; return this.blocked(); }
  async getContainerStatus(target: PublisherTarget, containerId: string): Promise<{ state: ContainerState; sampleOnly: boolean }> { void target; void containerId; return this.blocked(); }
  async publishContainer(target: PublisherTarget, containerId: string): Promise<PublishReceipt> { void target; void containerId; return this.blocked(); }
  async getPublishedMedia(target: PublisherTarget, mediaId: string): Promise<PublishedMedia> { void target; void mediaId; return this.blocked(); }
}

type MockContainer = {
  state: ContainerState;
  publishRequested: boolean;
};

export type MockPublisherOptions = Readonly<{
  target: PublisherTarget;
  containerState?: ContainerState;
  createOutcome?: "ready" | "timeout";
  publishOutcome?: "published" | "rejected" | "timeout_before_accept" | "timeout_after_accept";
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const numericSubject = /^[1-9][0-9]{4,31}$/;

function validTarget(target: PublisherTarget): boolean {
  return target != null && typeof target.connectionId === "string" && uuid.test(target.connectionId)
    && typeof target.accountSubject === "string" && numericSubject.test(target.accountSubject)
    && Number.isSafeInteger(target.grantGeneration) && target.grantGeneration > 0;
}

/**
 * Explicit, synthetic test adapter. It deliberately does NOT deduplicate creates:
 * that authority belongs to the durable intent store, not an invented Meta promise.
 * Its IDs and state are examples; no receipt from here proves a public post exists.
 */
export class MockInstagramPublisher implements InstagramPublisher {
  readonly mode = "mock" as const;
  private readonly target: PublisherTarget;
  private readonly containerState: ContainerState;
  private readonly createOutcome: NonNullable<MockPublisherOptions["createOutcome"]>;
  private readonly publishOutcome: NonNullable<MockPublisherOptions["publishOutcome"]>;
  private readonly containers = new Map<string, MockContainer>();
  private readonly media = new Map<string, PublishedMedia>();
  private readonly counts = { create: 0, status: 0, publish: 0, lookup: 0 };

  constructor(options: MockPublisherOptions) {
    if (!validTarget(options.target)
      || (options.containerState !== undefined && !["ready", "processing", "failed", "unknown"].includes(options.containerState))
      || (options.createOutcome !== undefined && !["ready", "timeout"].includes(options.createOutcome))
      || (options.publishOutcome !== undefined && !["published", "rejected", "timeout_before_accept", "timeout_after_accept"].includes(options.publishOutcome))) {
      throw new PublishProviderError("PUBLISH_INVALID_INPUT");
    }
    this.target = Object.freeze({ ...options.target });
    this.containerState = options.containerState ?? "ready";
    this.createOutcome = options.createOutcome ?? "ready";
    this.publishOutcome = options.publishOutcome ?? "published";
  }

  private checkTarget(target: PublisherTarget): void {
    if (!validTarget(target) || target.connectionId !== this.target.connectionId
      || target.accountSubject !== this.target.accountSubject || target.grantGeneration !== this.target.grantGeneration) {
      throw new PublishProviderError("PUBLISH_TARGET_MISMATCH");
    }
  }

  private container(id: string): MockContainer {
    const result = this.containers.get(id);
    if (!result) throw new PublishProviderError("PUBLISH_NOT_FOUND");
    return result;
  }

  callCounts(): Readonly<{ create: number; status: number; publish: number; lookup: number }> {
    return { ...this.counts };
  }

  async createImageContainer(input: ImageContainerInput): Promise<ContainerReceipt> {
    this.checkTarget(input.target);
    if (typeof input.intentId !== "string" || !uuid.test(input.intentId)
      || typeof input.imageSha256 !== "string" || !hash.test(input.imageSha256)
      || typeof input.caption !== "string" || input.caption.length > 16_384
      || typeof input.mediaHandle !== "string" || !/^mock-lease:[A-Za-z0-9_-]{1,128}$/.test(input.mediaHandle)) {
      throw new PublishProviderError("PUBLISH_INVALID_INPUT");
    }
    this.counts.create++;
    if (this.createOutcome === "timeout") throw new PublishProviderError("PUBLISH_OUTCOME_UNKNOWN", "unknown");
    const containerId = `900000000${this.counts.create.toString().padStart(8, "0")}`;
    // Neither the caption nor the media handle is needed to exercise state transitions.
    this.containers.set(containerId, { state: this.containerState, publishRequested: false });
    return { containerId, sampleOnly: true };
  }

  async getContainerStatus(target: PublisherTarget, containerId: string): Promise<{ state: ContainerState; sampleOnly: boolean }> {
    this.checkTarget(target);
    const container = this.container(containerId);
    this.counts.status++;
    return { state: container.state, sampleOnly: true };
  }

  async publishContainer(target: PublisherTarget, containerId: string): Promise<PublishReceipt> {
    this.checkTarget(target);
    const container = this.container(containerId);
    if (container.publishRequested) throw new PublishProviderError("PUBLISH_ALREADY_REQUESTED");
    if (container.state !== "ready") throw new PublishProviderError("PUBLISH_CONTAINER_NOT_READY");
    container.publishRequested = true;
    this.counts.publish++;
    if (this.publishOutcome === "rejected") {
      container.state = "failed";
      throw new PublishProviderError("PUBLISH_PROVIDER_REJECTED");
    }
    if (this.publishOutcome === "timeout_before_accept") {
      container.state = "unknown";
      throw new PublishProviderError("PUBLISH_OUTCOME_UNKNOWN", "unknown");
    }
    const mediaId = `910000000${this.counts.publish.toString().padStart(8, "0")}`;
    this.media.set(mediaId, { mediaId, accountSubject: target.accountSubject, permalink: null, sampleOnly: true });
    if (this.publishOutcome === "timeout_after_accept") {
      container.state = "unknown";
      throw new PublishProviderError("PUBLISH_OUTCOME_UNKNOWN", "unknown");
    }
    // A synthetic success is not an official permalink. Do not invent one.
    return { mediaId, sampleOnly: true };
  }

  async getPublishedMedia(target: PublisherTarget, mediaId: string): Promise<PublishedMedia> {
    this.checkTarget(target);
    const found = this.media.get(mediaId);
    if (!found) throw new PublishProviderError("PUBLISH_NOT_FOUND");
    this.counts.lookup++;
    return { ...found };
  }
}
