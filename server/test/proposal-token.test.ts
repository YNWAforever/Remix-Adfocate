// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeProposalSections,
  proposalContentHash,
  proposalsConfigured,
  signProposalToken,
  verifyProposalToken,
} from "../lib/assistant/proposalToken";

const KEY = Buffer.alloc(32, 5).toString("base64");
const base = { kind: "brief" as const, threadId: "thread-1", creatorId: "creator-1", workspaceId: "workspace-1", requestId: "request-1", content: ["第一段", "第二段"] };

beforeEach(() => vi.stubEnv("PROPOSAL_SIGNING_KEY", KEY));
afterEach(() => vi.unstubAllEnvs());

describe("proposal tokens", () => {
  it("signs and verifies a bound proposal token", () => {
    const token = signProposalToken(base);
    expect(token).toBeTruthy();
    const payload = verifyProposalToken(token!);
    expect(payload).toMatchObject({
      v: 1, kind: "brief", threadId: "thread-1", creatorId: "creator-1", workspaceId: "workspace-1", requestId: "request-1",
      contentHash: proposalContentHash(["第一段", "第二段"]),
    });
    expect(payload!.exp).toBeGreaterThan(Date.now());
  });

  it("rejects tampering, wrong version, wrong key and expired tokens", () => {
    const token = signProposalToken(base)!;
    const [encoded, signature] = token.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")), requestId: "other" })).toString("base64url")}.${signature}`;
    expect(verifyProposalToken(tampered)).toBeNull();
    vi.stubEnv("PROPOSAL_SIGNING_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(verifyProposalToken(token)).toBeNull();
    vi.stubEnv("PROPOSAL_SIGNING_KEY", KEY);
    const expired = signProposalToken({ ...base, ttlMs: 60_000 });
    expect(verifyProposalToken(expired!, Date.now() + 120_000)).toBeNull();
  });

  it("stays unavailable without a signing key", () => {
    vi.stubEnv("PROPOSAL_SIGNING_KEY", "");
    expect(proposalsConfigured()).toBe(false);
    expect(signProposalToken(base)).toBeNull();
    expect(verifyProposalToken("anything.signature")).toBeNull();
  });

  it("normalises sections and rejects invalid payloads", () => {
    expect(normalizeProposalSections(["  a  ", "", 3, "b"])).toEqual(["a", "b"]);
    expect(normalizeProposalSections("nope")).toBeNull();
    expect(normalizeProposalSections([])).toBeNull();
    expect(normalizeProposalSections(Array.from({ length: 7 }, (_, index) => `s${index}`))).toBeNull();
    expect(normalizeProposalSections(["x".repeat(4000)])![0]).toHaveLength(3000);
  });
});
