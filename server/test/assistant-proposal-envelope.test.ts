// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proposalEnvelope } from "../routes/assistant.js";
import { verifyProposalToken } from "../lib/assistant/proposalToken.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const result = { proposals: [{ kind: "brief" as const, sections: ["One", "Two"] }] };
const threadId = "00000000-0000-4000-8000-0000000000aa";
const input = { threadId, requestId: "00000000-0000-4000-8000-000000000001" };

beforeEach(() => {
  vi.stubEnv("PROPOSAL_SIGNING_KEY", KEY);
  vi.stubEnv("STUDIO_ASSISTANT_PROPOSAL_EXECUTION", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("proposal envelope", () => {
  it("binds the token to the saved thread, not the missing request conversation", () => {
    const envelope = proposalEnvelope(result, input, "creator-1", "workspace-1") as { proposals: Array<{ token?: string }> };
    expect(envelope.proposals[0].token).toBeTruthy();
    expect(verifyProposalToken(envelope.proposals[0].token!)).toMatchObject({ threadId });
  });

  it("returns plain proposals when execution is off", () => {
    vi.stubEnv("STUDIO_ASSISTANT_PROPOSAL_EXECUTION", "false");
    const envelope = proposalEnvelope(result, input, "creator-1", "workspace-1") as { proposals: Array<{ token?: string }> };
    expect(envelope.proposals[0].token).toBeUndefined();
  });
});
