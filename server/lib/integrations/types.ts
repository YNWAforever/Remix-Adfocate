import type { IntegrationConnection, IntegrationResource, ProviderId, EvidenceValue, Availability, IntegrationImport } from "../../../src/lib/integrations/types.js";
export type { IntegrationConnection, IntegrationResource, ProviderId, EvidenceValue, Availability, IntegrationImport };
export type Actor = { creatorId: string; workspaceId: string };
export type ConnectionRef = Actor & { id: string; provider: ProviderId; generation: number };
export type ConnectionRecord = IntegrationConnection & Actor & { subject: string; consentVersion: string };
export type ResourceRecord = IntegrationResource & Actor & { generation: number; contentHash: string; sizeBytes: number; snapshotId?: string };
export type ProviderGrant = { subject: string; label: string; scopes: string[]; accessToken: string; refreshToken: string; expiresAt: string };
export type ProviderFile = { externalId: string; title: string; mimeType: string; version: string; sizeBytes: number; canDownload: boolean; rights: "owned" | "licensed" | "unknown"; content: string };
export type ProviderSnapshot = {
  resourceId: string; title: string; sourceVersion: string; contentHash: string;
  fetchedAt: string; observedAt: string; period: { start: string; end: string } | null;
  coverage: { region: string | null; language: string | null; partial: boolean };
  metrics: Record<string, EvidenceValue>; excerpt: string | null;
};
export type SourceUse = "read" | "model" | "save_brief" | "share";
export type UsePermit = { id: string; sourceId: string; snapshotId: string; generation: number; contentHash: string; use: SourceUse; expiresAt: string };
export interface IntegrationProvider {
  readonly id: ProviderId;
  readonly mode: "mock";
  authorize(code: string, actor: Actor, now: Date): Promise<ProviderGrant>;
  refresh(grant: ProviderGrant, now: Date): Promise<ProviderGrant>;
  revoke(grant: ProviderGrant): Promise<void>;
  read(connection: ConnectionRef, grant: ProviderGrant, now: Date, signal: AbortSignal): Promise<ProviderSnapshot[]>;
  files(connection: ConnectionRef, grant: ProviderGrant): Promise<ProviderFile[]>;
  file(connection: ConnectionRef, grant: ProviderGrant, externalId: string): Promise<ProviderFile>;
}
export type IntegrationRecord = Record<string, unknown>;
export interface IntegrationRepository {
  list(actor: Actor): Promise<ConnectionRecord[]>;
  connection(actor: Actor, id: string): Promise<ConnectionRecord | null>;
  resources(actor: Actor, id: string): Promise<ResourceRecord[]>;
  /** Server-only identity lookup; never returns historical excerpts or consent. */
  resourceIdentities(actor: Actor, id: string, externalIds: string[]): Promise<Array<Pick<ResourceRecord, "id" | "externalId">>>;
  command(actor: Actor, requestId: string, action: string, payload: IntegrationRecord): Promise<IntegrationRecord>;
}
