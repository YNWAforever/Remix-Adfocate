import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const KEY_ENV = "PROPOSAL_SIGNING_KEY";
const VERSION = 1;
const TTL_MS = 10 * 60_000;
const MAX_SECTIONS = 6;
const MAX_SECTION_CHARS = 3000;

export type ProposalKind = "brief";

export type ProposalTokenPayload = Readonly<{
  v: 1;
  kind: ProposalKind;
  threadId: string | null;
  creatorId: string;
  workspaceId: string;
  requestId: string;
  contentHash: string;
  exp: number;
}>;

function signingKey(): Buffer {
  const key = Buffer.from(process.env[KEY_ENV] ?? "", "base64");
  if (key.length < 32) throw new Error("proposal_signing_key_missing");
  return key;
}

export function proposalsConfigured(): boolean {
  try {
    signingKey();
    return true;
  } catch {
    return false;
  }
}

/** Normalises proposed brief sections; returns null when the payload is not executable. */
export function normalizeProposalSections(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SECTIONS) return null;
  const sections = value
    .filter((section): section is string => typeof section === "string")
    .map(section => section.trim().slice(0, MAX_SECTION_CHARS))
    .filter(Boolean);
  return sections.length ? sections : null;
}

export function proposalContentHash(sections: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(sections)).digest("hex");
}

function signature(encoded: string): string {
  return createHmac("sha256", signingKey()).update(encoded).digest("base64url");
}

/**
 * Signs the proposal binding: kind + thread/creator/workspace + request id + content hash + expiry.
 * Returns null when no signing key is configured (execution stays unavailable).
 */
export function signProposalToken(input: {
  kind: ProposalKind;
  threadId: string | null;
  creatorId: string;
  workspaceId: string;
  requestId: string;
  content: unknown;
  ttlMs?: number;
}): string | null {
  const sections = normalizeProposalSections(input.content);
  if (!sections || !proposalsConfigured()) return null;
  const payload: ProposalTokenPayload = {
    v: VERSION,
    kind: input.kind,
    threadId: input.threadId,
    creatorId: input.creatorId,
    workspaceId: input.workspaceId,
    requestId: input.requestId,
    contentHash: proposalContentHash(sections),
    exp: Date.now() + Math.max(60_000, Math.min(input.ttlMs ?? TTL_MS, TTL_MS)),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

/** Verifies signature, version, shape and expiry. Returns null for any invalid/tampered token. */
export function verifyProposalToken(token: string, now = Date.now()): ProposalTokenPayload | null {
  if (!proposalsConfigured()) return null;
  const [encoded, provided] = token.split(".");
  if (!encoded || !provided) return null;
  const expected = signature(encoded);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: Partial<ProposalTokenPayload>;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<ProposalTokenPayload>;
  } catch {
    return null;
  }
  if (payload.v !== VERSION || payload.kind !== "brief") return null;
  if (typeof payload.creatorId !== "string" || !payload.creatorId) return null;
  if (typeof payload.workspaceId !== "string" || !payload.workspaceId) return null;
  if (typeof payload.requestId !== "string" || !payload.requestId) return null;
  if (typeof payload.contentHash !== "string" || payload.contentHash.length !== 64) return null;
  if (payload.threadId !== null && typeof payload.threadId !== "string") return null;
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;
  return payload as ProposalTokenPayload;
}
