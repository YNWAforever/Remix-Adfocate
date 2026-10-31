/** Browser-safe integration contracts. Tokens are deliberately absent. */
export type ProviderId = "instagram" | "google_drive";
export type IntegrationStatus = "connected" | "partial" | "reauth_required" | "revoked";
export type Availability = "available" | "missing" | "unsupported" | "stale" | "revoked" | "rate_limited";
export type EvidenceValue = { value: number | null; availability: Availability; reason: string | null };
export type IntegrationConnection = {
  id: string; provider: ProviderId; label: string; status: IntegrationStatus;
  scopes: string[]; generation: number; lastSyncAt: string | null; expiresAt: string;
  lastError: string | null; sampleOnly: true; providerRevocation: "not_requested" | "revoked" | "pending" | "manual_action";
};
export type IntegrationResource = {
  id: string; connectionId: string; externalId: string; title: string; mimeType: string;
  version: string; selected: boolean; canDownload: boolean; rights: "owned" | "licensed" | "unknown";
  availability: Availability; excerpt: string | null; metrics: Record<string, EvidenceValue>;
  observedAt: string; fetchedAt: string; coverage: { region: string | null; language: string | null; partial: boolean };
  sampleOnly: true;
};
export type IntegrationList = { mode: "mock" | "disabled"; connections: IntegrationConnection[] };
export type StartConnection = { state: string; expiresAt: string; provider: ProviderId; scopes: string[]; sampleOnly: true };
export type IntegrationImport = {
  threadId: string; revision: number; resourceIds: string[]; question: string;
  modelConsent: boolean; processingRights: boolean; shareRights: boolean; requestId: string;
};
export type IntegrationSourceMetadata = {
  connection_id: string; snapshot_id: string; resource_id: string; generation: number;
  source_version: string; content_hash: string; model_allowed: boolean;
  provenance: ProviderId; availability: Availability; sample_only: true;
  coverage: { region: string | null; language: string | null; partial: boolean };
};
