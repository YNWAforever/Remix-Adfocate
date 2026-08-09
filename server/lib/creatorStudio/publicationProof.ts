export const PROOF_ATTEMPT_STATES = [
  "draft",
  "submitted",
  "verified",
  "changes_requested",
] as const;

export type ProofAttemptState = (typeof PROOF_ATTEMPT_STATES)[number];

export const PROOF_METADATA_STATES = [
  "pending",
  "available",
  "unavailable",
  "failed",
] as const;

export type ProofMetadataState = (typeof PROOF_METADATA_STATES)[number];

export type PublicationProofRequirement = {
  kind: "publication_url";
  allowedPlatforms: string[];
  evidence: "optional";
};
export type PublicationProofMetadata = {
  title: string | null;
  author: string | null;
  publishedAt: string | null;
};

export type PublicationProofEvidence = {
  id: string;
  attemptId: string;
  storagePath: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  byteSize: number;
  checksumSha256: string | null;
  status: "pending" | "finalized";
};

export type PublicationProofAttempt = {
  id: string;
  workItemId: string;
  parentAttemptId: string | null;
  sequence: number;
  publishedUrl: string;
  platform: string | null;
  state: ProofAttemptState;
  metadataState: ProofMetadataState;
  metadata: PublicationProofMetadata | null;
  operatorMessage: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  evidence: PublicationProofEvidence[];
};

export type PublicationProofSnapshot = {
  required: boolean;
  currentAttempt: PublicationProofAttempt | null;
  history: PublicationProofAttempt[];
};

export const canEditProofAttempt = (state: ProofAttemptState): boolean => state === "draft";

export const canCreateCorrection = (state: ProofAttemptState): boolean => state === "changes_requested";

export const validatePublicationProofUrl = (value: string): boolean => {
  if (!value || value !== value.trim() || /\s/.test(value)) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.hash.includes("\n");
  } catch {
    return false;
  }
};

export const validatePublicationProofPlatform = (
  platform: string,
  allowedPlatforms: string[],
): boolean => {
  const normalizedPlatform = platform.trim().toLowerCase();
  if (!normalizedPlatform) return false;
  return allowedPlatforms.some((allowed) => allowed.trim().toLowerCase() === normalizedPlatform);
};

export const manualReviewMessageForMetadataState = (state: ProofMetadataState): string => {
  switch (state) {
    case "available":
      return "Metadata is available, but manual review is still required.";
    case "unavailable":
      return "Metadata is unavailable; manual review is required.";
    case "failed":
      return "Metadata lookup failed; manual review is required.";
    case "pending":
      return "Metadata is pending; manual review is required.";
  }
};
