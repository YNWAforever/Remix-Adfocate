import { IntegrationError } from "../policy.js";
import type { ProviderGrant } from "../types.js";

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 8192): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || [...value].some(char => char.charCodeAt(0) < 32)) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
  return value;
}
export function expiry(seconds: unknown, now: Date): string {
  if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 60 * 86400 || !Number.isFinite(now.getTime())) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
  return new Date(now.getTime() + seconds * 1000).toISOString();
}
export function scopeList(value: unknown): string[] {
  const list = text(value, 4096).split(/\s+/);
  if (list.length > 50) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
  return [...new Set(list)];
}
export function requireGrant(grant: ProviderGrant, project?: string) {
  text(grant.accessToken);
  text(grant.subject, 255);
  if (project && grant.grantProject !== project) throw new IntegrationError("PROVIDER_GRANT_MISMATCH", 403);
}
export function bearer(grant: Pick<ProviderGrant, "accessToken">) { return { Authorization: `Bearer ${text(grant.accessToken)}` }; }
export function callbackUri(value: unknown): string {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    return url.toString();
  } catch { throw new IntegrationError("INVALID_OAUTH_CONTEXT"); }
}
