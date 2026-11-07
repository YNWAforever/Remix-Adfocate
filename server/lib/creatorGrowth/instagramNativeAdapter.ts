import { MockInstagramPublisher, PublishProviderError, type MockPublisherOptions, type InstagramPublisher, type PublisherTarget, type ImageContainerInput } from "./instagramPublisher.js";

/** Internal operation envelopes, NOT a verified Meta HTTP protocol. No network,
 * endpoint, token, live mode or caller-supplied transport exists in this adapter.
 * The underlying mock owns target/state checks; this boundary projects receipts.
 */
export class MockNativeInstagramAdapter implements InstagramPublisher {
  readonly mode: "disabled" | "mock";
  private readonly provider: MockInstagramPublisher;
  constructor(options: MockPublisherOptions & { enabled?: boolean }) {
    this.mode = options.enabled === true ? "mock" : "disabled";
    this.provider = new MockInstagramPublisher(options);
  }
  private check() { if (this.mode !== "mock") throw new PublishProviderError("PUBLISH_PROTOCOL_UNVERIFIED"); }
  private id(value: string) {
    if (!/^[1-9][0-9]{0,63}$/.test(value)) throw new PublishProviderError("PUBLISH_OUTCOME_UNKNOWN", "unknown");
    return value;
  }
  callCounts() { return this.provider.callCounts(); }
  async createImageContainer(input: ImageContainerInput) {
    this.check();
    const response = await this.provider.createImageContainer(input);
    const envelope = { id: response.containerId, provenance: "mock" } as const;
    return { containerId: this.id(envelope.id), sampleOnly: true };
  }
  async getContainerStatus(target: PublisherTarget, containerId: string) {
    this.check();
    const response = await this.provider.getContainerStatus(target, this.id(containerId));
    const nativeStatus = { ready: "FINISHED", processing: "IN_PROGRESS", failed: "ERROR", unknown: "UNKNOWN" } as const;
    const envelope = { status_code: nativeStatus[response.state] };
    const state = ({ FINISHED: "ready", IN_PROGRESS: "processing", ERROR: "failed", UNKNOWN: "unknown" } as const)[envelope.status_code];
    return { state, sampleOnly: true };
  }
  async publishContainer(target: PublisherTarget, containerId: string) {
    this.check();
    const response = await this.provider.publishContainer(target, this.id(containerId));
    return { mediaId: this.id(response.mediaId), sampleOnly: true };
  }
  async getPublishedMedia(target: PublisherTarget, mediaId: string) {
    this.check();
    const response = await this.provider.getPublishedMedia(target, this.id(mediaId));
    return { mediaId: this.id(response.mediaId), accountSubject: response.accountSubject, permalink: null, sampleOnly: true };
  }
}
