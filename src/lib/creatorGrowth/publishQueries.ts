import type { ApprovePublishInput, PublishPreview, PublishStatus } from "../../../server/lib/creatorGrowth/publishService";
import type { CreatorGrowthTransport } from "./queries";

export type CreatorPublishPreviewDto = PublishPreview;
export type CreatorPublishStatusDto = PublishStatus;
export type CreatorPublishApproval = ApprovePublishInput;

const root = "/creator-growth/publish";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function identifier(value: string): string {
  if (!uuid.test(value)) throw new Error("Invalid publication identifier");
  return value;
}
const json = (body: object): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" },
  cache: "no-store", body: JSON.stringify(body),
});

/** Explicit calls only: no cache, credential persistence, retry loop or execute method. */
export function createCreatorPublishClient(transport: CreatorGrowthTransport) {
  return {
    async prepare(draftId: string): Promise<CreatorPublishPreviewDto> {
      return transport.request(`${root}/preview`, json({ draftId: identifier(draftId) }));
    },
    async approve(input: CreatorPublishApproval): Promise<CreatorPublishStatusDto> {
      const init = json({ draftId: identifier(input.draftId), approvalId: identifier(input.approvalId), nonce: input.nonce, fingerprint: input.fingerprint });
      // apiFetch merges an enumerable header record into the authenticated request.
      const headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": identifier(input.requestId),
        "X-Creator-Confirmation": "exact-preview-v1",
      };
      return transport.request(`${root}/approve`, { ...init, headers });
    },
    async getStatus(intentId: string): Promise<CreatorPublishStatusDto> {
      return transport.request(`${root}/${identifier(intentId)}`, { method: "GET", cache: "no-store" });
    },
    async reconcile(intentId: string): Promise<CreatorPublishStatusDto> {
      return transport.request(`${root}/${identifier(intentId)}/reconcile`, json({}));
    },
  };
}
