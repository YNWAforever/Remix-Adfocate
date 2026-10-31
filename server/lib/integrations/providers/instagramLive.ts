import { IntegrationError } from "../policy.js";
import { normalizeInstagramMedia } from "../instagram.js";
import { digest } from "../credentials.js";
import type { ProviderHttpPort } from "../providerHttp.js";
import type { Actor, ConnectionRef, IntegrationProvider, ProviderAuthorization, ProviderFile, ProviderGrant, ProviderSnapshot } from "../types.js";
import { bearer, callbackUri, expiry, record, requireGrant, text } from "./protocol.js";

/** Official Instagram Media Insights reference, verified 2026-10-31 by the coordinating task. */
export const INSTAGRAM_API_VERSION = "v26.0";
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_manage_insights"] as const;
const METRICS = { reach: "reach", views: "views", likes: "likes", saved: "saves" } as const;
const DAY = 86400000;
const MAX_MEDIA = 50;
const MAX_PAGES = 5;
export type InstagramLiveOptions = { http: ProviderHttpPort; clientId: string; clientSecret: string; apiVersion: string; grantProject?: string };

function id(value: unknown): string {
  const result = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : text(value, 64);
  if (!/^\d+$/.test(result)) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
  return result;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
  return value;
}
function single(value: unknown): Record<string, unknown> {
  const data = record(value);
  if (data.data === undefined) return data;
  const rows = array(data.data);
  if (rows.length !== 1) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
  return record(rows[0]);
}
function permalink(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["www.instagram.com", "instagram.com"].includes(url.hostname) || !/^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return undefined;
    return url.origin + url.pathname;
  } catch { return undefined; }
}
function metricValues(value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of array(record(value).data)) {
    const metric = record(item);
    const name = text(metric.name, 64);
    if (!Object.hasOwn(METRICS, name)) continue;
    const mapped = METRICS[name as keyof typeof METRICS];
    if (Object.hasOwn(result, mapped) || metric.period !== "lifetime") throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
    let number: unknown;
    if (metric.values !== undefined) {
      const values = array(metric.values);
      if (values.length > 1) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
      number = values.length ? record(values[0]).value : undefined;
    }
    if (metric.total_value !== undefined) {
      const total = record(metric.total_value).value;
      if (number !== undefined && !Object.is(number, total)) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
      number = total;
    }
    // normalizeInstagramMedia retains real zero and maps missing/invalid/negative counts to null.
    result[mapped] = number;
  }
  return result;
}

export class InstagramLiveProvider implements IntegrationProvider {
  readonly id = "instagram" as const;
  readonly mode = "live_pilot" as const;
  readonly sampleOnly: boolean;
  constructor(private readonly options: InstagramLiveOptions) {
    if (options.apiVersion !== INSTAGRAM_API_VERSION) throw new IntegrationError("INSTAGRAM_VERSION_UNVERIFIED", 503);
    if (!options.clientId || !options.clientSecret) throw new IntegrationError("PROVIDER_INVALID_CONFIG", 503);
    this.sampleOnly = options.http.transportKind !== "live";
  }
  private url(path: string, parameters?: Record<string, string>) {
    return `https://graph.instagram.com/${INSTAGRAM_API_VERSION}/${path}${parameters ? `?${new URLSearchParams(parameters)}` : ""}`;
  }
  async authorize(code: string, _actor: Actor, now: Date, context?: ProviderAuthorization): Promise<ProviderGrant> {
    if (!context) throw new IntegrationError("INVALID_OAUTH_CONTEXT");
    const response = record(await this.options.http.json<unknown>({ url: "https://api.instagram.com/oauth/access_token", method: "POST", operation: "oauth",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.options.clientId, client_secret: this.options.clientSecret,
        grant_type: "authorization_code", redirect_uri: callbackUri(context.redirectUri), code: text(code) }).toString() }));
    const data = single(response);
    const authorizationId = id(data.user_id);
    // The code-exchange response is the documented source of actual granted permissions.
    const scopes = text(data.permissions, 4096).split(",").map(scope => text(scope.trim(), 200));
    const long = record(await this.options.http.json<unknown>({ url: `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: this.options.clientSecret, access_token: text(data.access_token) })}`, method: "GET", operation: "oauth" }));
    const accessToken = text(long.access_token);
    const expiresAt = expiry(long.expires_in, now);
    const identity = single(await this.options.http.json<unknown>({ url: this.url("me", { fields: "id,user_id,username,account_type" }), method: "GET", operation: "read", headers: bearer({ accessToken }) }));
    if (id(identity.id ?? identity.user_id) !== authorizationId) throw new IntegrationError("PROVIDER_IDENTITY_MISMATCH", 403);
    const subject = id(identity.user_id);
    if (!["BUSINESS", "MEDIA_CREATOR"].includes(String(identity.account_type).toUpperCase())) throw new IntegrationError("INSTAGRAM_ACCOUNT_UNSUPPORTED", 403);
    return { subject, label: `@${text(identity.username, 100)}`, scopes: [...new Set(scopes)], accessToken, refreshToken: "", expiresAt, issuedAt: now.toISOString(), grantProject: this.options.grantProject };
  }
  async refresh(grant: ProviderGrant, now: Date): Promise<ProviderGrant> {
    requireGrant(grant, this.options.grantProject);
    if (!grant.scopes.includes("instagram_business_basic")) throw new IntegrationError("INSUFFICIENT_SCOPES", 403);
    const issued = Date.parse(grant.issuedAt ?? "");
    const expires = Date.parse(grant.expiresAt);
    if (!Number.isFinite(expires) || expires <= now.getTime()) throw new IntegrationError("PROVIDER_AUTH_REQUIRED", 401);
    if (!Number.isFinite(issued) || now.getTime() - issued < DAY) throw new IntegrationError("PROVIDER_REFRESH_TOO_EARLY", 409);
    const data = record(await this.options.http.json<unknown>({ url: `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: grant.accessToken })}`, method: "GET", operation: "refresh" }));
    return { ...grant, accessToken: text(data.access_token), refreshToken: "", expiresAt: expiry(data.expires_in, now), issuedAt: now.toISOString() };
  }
  async revoke(grant: ProviderGrant): Promise<void> {
    requireGrant(grant, this.options.grantProject);
    const result = record(await this.options.http.json<unknown>({ url: this.url(`${id(grant.subject)}/permissions`), method: "DELETE", operation: "revoke", headers: bearer(grant) }));
    if (result.success !== true) throw new IntegrationError("PROVIDER_REVOKE_FAILED", 502);
  }
  async files(_connection: ConnectionRef, _grant: ProviderGrant): Promise<ProviderFile[]> { void [_connection, _grant]; return []; }
  async file(_connection: ConnectionRef, _grant: ProviderGrant, _externalId: string): Promise<ProviderFile> { void [_connection, _grant, _externalId]; throw new IntegrationError("UNSUPPORTED_FILE"); }
  private cursor(page: Record<string, unknown>, subject: string): string | undefined {
    if (page.paging === undefined) return undefined;
    const paging = record(page.paging);
    if (paging.next === undefined) return undefined;
    try {
      const next = new URL(text(paging.next, 8192));
      const after = text(record(paging.cursors).after, 2048);
      if (next.protocol !== "https:" || next.hostname !== "graph.instagram.com" || next.port || next.username || next.password || next.hash || next.pathname !== `/${INSTAGRAM_API_VERSION}/${subject}/media`) throw new Error();
      return after;
    } catch { throw new IntegrationError("PROVIDER_INVALID_PAGINATION", 502); }
  }
  async read(connection: ConnectionRef, grant: ProviderGrant, now: Date, signal: AbortSignal): Promise<ProviderSnapshot[]> {
    if (signal.aborted) throw new IntegrationError("PROVIDER_CANCELLED", 409);
    requireGrant(grant, this.options.grantProject);
    if (connection.provider !== this.id) throw new IntegrationError("PROVIDER_GRANT_MISMATCH", 403);
    if (!INSTAGRAM_SCOPES.every(scope => grant.scopes.includes(scope))) throw new IntegrationError("INSUFFICIENT_SCOPES", 403);
    if (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now.getTime()) throw new IntegrationError("PROVIDER_AUTH_REQUIRED", 401);
    const subject = id(grant.subject);
    const start = new Date(now.getTime() - 30 * DAY);
    const results: ProviderSnapshot[] = [];
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let after: string | undefined;
    let partial = false;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
      try {
        const page = record(await this.options.http.json<unknown>({ url: this.url(`${subject}/media`, { fields: "id,caption,media_type,media_product_type,timestamp,permalink", limit: "50", ...(after ? { after } : {}) }), method: "GET", operation: "read", headers: bearer(grant), signal }));
        const next = this.cursor(page, subject);
        if (next && cursors.has(next)) { partial = true; break; }
        if (next) cursors.add(next);
        const items = array(page.data);
        for (const item of items) {
          if (signal.aborted) throw new IntegrationError("PROVIDER_CANCELLED", 409);
          const row = record(item);
          const mediaId = id(row.id);
          const observed = Date.parse(text(row.timestamp, 100));
          if (!Number.isFinite(observed)) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
          if (observed < start.getTime() || observed > now.getTime() || seen.has(mediaId)) continue;
          if (!((row.media_product_type === "FEED" && ["IMAGE", "CAROUSEL_ALBUM"].includes(String(row.media_type))) || (row.media_product_type === "REELS" && row.media_type === "VIDEO"))) continue;
          seen.add(mediaId);
          if (results.length === MAX_MEDIA) { partial = true; break; }
          let metrics: Record<string, unknown>;
          try {
            metrics = metricValues(await this.options.http.json<unknown>({ url: this.url(`${mediaId}/insights`, { metric: Object.keys(METRICS).join(",") }), method: "GET", operation: "read", headers: bearer(grant), signal }));
          } catch (error) {
            if (!(error instanceof IntegrationError) || error.code !== "PROVIDER_REQUEST_REJECTED" || error.status !== 400) throw error;
            metrics = Object.fromEntries(Object.values(METRICS).map(name => [name, { availability: "unsupported" }]));
            partial = true;
          }
          const title = typeof row.caption === "string" && row.caption.trim() ? [...row.caption.trim()].slice(0, 240).join("") : "Instagram 媒體";
          const sourceVersion = `${INSTAGRAM_API_VERSION}:${await digest(JSON.stringify({ mediaId, observed, metrics, title }))}`;
          const snapshot = await normalizeInstagramMedia({ id: mediaId, title, version: sourceVersion, observedAt: new Date(observed).toISOString(), metrics }, now);
          snapshot.excerpt = `${title}\n${this.sampleOnly ? "離線協定樣本" : "試點平台資料"}；此則媒體 lifetime 累計指標。近 30 日僅指媒體選取期間。\n${Object.entries(snapshot.metrics).map(([name, metric]) => `${name}: ${metric.value ?? "資料不足／未驗證"}`).join("\n")}\n指標可能延遲最多 48 小時；不代表廣告總互動或香港受眾。`;
          snapshot.evidence = { apiVersion: INSTAGRAM_API_VERSION, endpoint: this.url(`${mediaId}/insights`), measurementPeriod: "lifetime", selectionPeriod: { start: start.toISOString(), end: now.toISOString() }, ...(permalink(row.permalink) ? { permalink: permalink(row.permalink) } : {}) };
          results.push(snapshot);
        }
        if (!next || partial || results.length >= MAX_MEDIA) { partial ||= !!next; break; }
        after = next;
        if (pageNumber === MAX_PAGES - 1) partial = true;
      } catch (error) {
        if (results.length && error instanceof IntegrationError && ["PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT", "PROVIDER_CIRCUIT_OPEN"].includes(error.code)) { partial = true; break; }
        throw error;
      }
    }
    if (signal.aborted) throw new IntegrationError("PROVIDER_CANCELLED", 409);
    if (partial && !results.length) throw new IntegrationError("PROVIDER_INCOMPLETE", 503);
    if (partial) for (const result of results) result.coverage.partial = true;
    return results;
  }
}
