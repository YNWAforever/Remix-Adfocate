import type { EvidenceValue, ProviderId } from "./types.js";

export class IntegrationError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export const CONSENT_VERSION = "kocmax-integrations-mock-2026-10-31";
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 8000;
export const SYNC_COOLDOWN_MS = 60 * 60 * 1000;
export function integrationMode(env: Record<string, string | undefined>): "mock" | "disabled" {
  return env.NODE_ENV !== "production" && env.INTEGRATIONS_ENABLED === "true" && env.INTEGRATIONS_MODE === "mock" ? "mock" : "disabled";
}
export function requiredScopes(provider: ProviderId): string[] {
  return provider === "instagram" ? ["instagram_business_basic", "instagram_business_manage_insights"] : ["https://www.googleapis.com/auth/drive.file"];
}
export function hasScopes(provider: ProviderId, scopes: string[]) { return requiredScopes(provider).every(scope => scopes.includes(scope)); }
export function validateProvider(value: unknown): ProviderId {
  if (value !== "instagram" && value !== "google_drive") throw new IntegrationError("INVALID_PROVIDER");
  return value;
}
export function validateReturnPath(value: unknown): string {
  return typeof value === "string" && /^\/(connections|studio|home)(\?|$)/.test(value) && !/[\\%\s]/.test(value) ? value : "/connections";
}
export function normalizeMetric(value: unknown): EvidenceValue {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { value, availability: "available", reason: null }
    : { value: null, availability: "missing", reason: "資料不足，未驗證" };
}
export function validateFile(file: { mimeType: string; sizeBytes: number; canDownload: boolean }) {
  if (!file.canDownload) throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
  if (!["application/vnd.google-apps.document", "text/plain", "application/pdf"].includes(file.mimeType)) throw new IntegrationError("UNSUPPORTED_FILE");
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > MAX_FILE_BYTES) throw new IntegrationError("FILE_TOO_LARGE");
}
export function validateSelection(values: unknown, max = 5): string[] {
  if (!Array.isArray(values) || !values.length || values.length > max || new Set(values).size !== values.length || values.some(value => typeof value !== "string" || !value || value.length > 200)) throw new IntegrationError("INVALID_SELECTION");
  return values as string[];
}
export function requireRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new IntegrationError("INVALID_REQUEST_ID");
  return value;
}
export function boundedText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || [...value].length > max) throw new IntegrationError("INVALID_INPUT");
  return value.trim();
}
