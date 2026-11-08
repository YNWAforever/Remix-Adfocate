import { IntegrationError, MAX_FILE_BYTES, validateSelection } from "../policy.js";
import { extractDriveContent } from "../driveContent.js";
import type { ProviderHttpPort } from "../providerHttp.js";
import type { Actor, ConnectionRef, IntegrationProvider, ProviderAuthorization, ProviderFile, ProviderGrant, ProviderSnapshot } from "../types.js";
import { bearer, callbackUri, expiry, record, requireGrant, scopeList, text } from "./protocol.js";

export const GOOGLE_DRIVE_SCOPES = ["openid", "https://www.googleapis.com/auth/drive.file"] as const;
export type GoogleDriveLiveOptions = {
  http: ProviderHttpPort; clientId: string; clientSecret: string; grantProject: string;
  verifyIdentity?: (idToken: string, nonce: string) => Promise<{ subject: string }>;
  /** Server-authoritative selection, bound to actor/workspace/connection/generation (never Picker metadata). */
  isSelected?: (connection: ConnectionRef, externalId: string) => boolean | Promise<boolean>;
};
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MIME = ["text/plain", "application/pdf", "application/vnd.google-apps.document"];
const FIELDS = "id,name,mimeType,version,size,trashed,capabilities(canDownload),driveId,ownedByMe";

/** Only the fixed trusted Google JWKS endpoint; no token-supplied URL or arbitrary key import. */
export function createGoogleSigningKeyResolver(http: ProviderHttpPort): (kid: string) => Promise<JsonWebKey | null> {
  return async kid => {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(kid)) return null;
    const response = record(await http.json<unknown>({ url: "https://www.googleapis.com/oauth2/v3/certs", method: "GET", operation: "read", maxBytes: 65536 }));
    if (!Array.isArray(response.keys) || !response.keys.length || response.keys.length > 10) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
    const seen = new Set<string>();
    let found: JsonWebKey | null = null;
    for (const value of response.keys) {
      const key = record(value);
      const keyId = text(key.kid, 200);
      if (seen.has(keyId) || key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig" || typeof key.n !== "string" || !/^[A-Za-z0-9_-]{342,1366}$/.test(key.n) || key.e !== "AQAB" || key.d !== undefined) throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
      seen.add(keyId);
      if (keyId === kid) found = { kty: "RSA", alg: "RS256", use: "sig", n: key.n, e: "AQAB", ext: true, key_ops: ["verify"] };
    }
    return found;
  };
}

export class GoogleDriveLiveProvider implements IntegrationProvider {
  readonly id = "google_drive" as const;
  readonly mode = "live_pilot" as const;
  readonly sampleOnly: boolean;
  constructor(private readonly options: GoogleDriveLiveOptions) {
    this.sampleOnly = options.http.transportKind !== "live";
    if (!options.clientId || !options.clientSecret || !options.grantProject) throw new IntegrationError("PROVIDER_INVALID_CONFIG", 503);
  }
  /** New instance only; does not mutate the durable reader's selected-resource authority. */
  withSelection(isSelected: NonNullable<GoogleDriveLiveOptions["isSelected"]>): GoogleDriveLiveProvider {
    return new GoogleDriveLiveProvider({ ...this.options, isSelected });
  }
  /** Authenticated, explicitly consented Picker candidates; caller still owns the final generation check/commit. */
  async selectedFiles(connection: ConnectionRef, grant: ProviderGrant, ids: string[]): Promise<ProviderFile[]> {
    const selected = Object.freeze([...validateSelection(ids)]);
    if (selected.some(value => !/^[A-Za-z0-9_-]{1,200}$/.test(value))) throw new IntegrationError("INVALID_SELECTION");
    const scope = Object.freeze({ ...connection });
    const capturedGrant = { ...grant, scopes: [...grant.scopes] };
    const temporary = this.withSelection((ref, externalId) =>
      ref.creatorId === scope.creatorId && ref.workspaceId === scope.workspaceId && ref.id === scope.id
      && ref.provider === scope.provider && ref.generation === scope.generation && selected.includes(externalId));
    const files: ProviderFile[] = [];
    for (const externalId of selected) files.push(await temporary.file(scope, capturedGrant, externalId));
    return files;
  }
  private async token(fields: Record<string, string>, operation: "oauth" | "refresh") {
    const data = record(await this.options.http.json<unknown>({ url: TOKEN_URL, method: "POST", operation,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, client_id: this.options.clientId, client_secret: this.options.clientSecret }).toString() }));
    if (data.token_type !== "Bearer") throw new IntegrationError("PROVIDER_INVALID_RESPONSE", 502);
    return data;
  }
  async authorize(code: string, _actor: Actor, now: Date, context?: ProviderAuthorization): Promise<ProviderGrant> {
    if (!this.options.verifyIdentity) throw new IntegrationError("IDENTITY_VERIFICATION_REQUIRED", 503);
    if (!context?.nonce || context.nonce.length > 256 || !context.codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(context.codeVerifier)) throw new IntegrationError("INVALID_OAUTH_CONTEXT");
    const data = await this.token({ code: text(code), grant_type: "authorization_code", redirect_uri: callbackUri(context.redirectUri), code_verifier: context.codeVerifier }, "oauth");
    const accessToken = text(data.access_token);
    const refreshToken = data.refresh_token === undefined ? "" : text(data.refresh_token);
    const scopes = scopeList(data.scope);
    const expiresAt = expiry(data.expires_in, now);
    const idToken = text(data.id_token, 32768);
    let subject: string;
    try { subject = text((await this.options.verifyIdentity(idToken, context.nonce)).subject, 255); }
    catch { throw new IntegrationError("IDENTITY_VERIFICATION_FAILED", 403); }
    return { subject, label: "Google Drive", scopes, accessToken, refreshToken, expiresAt, issuedAt: now.toISOString(), grantProject: this.options.grantProject };
  }
  async refresh(grant: ProviderGrant, now: Date): Promise<ProviderGrant> {
    requireGrant(grant, this.options.grantProject);
    if (!grant.refreshToken) throw new IntegrationError("PROVIDER_AUTH_REQUIRED", 401);
    const data = await this.token({ refresh_token: text(grant.refreshToken), grant_type: "refresh_token" }, "refresh");
    return { ...grant, accessToken: text(data.access_token), refreshToken: data.refresh_token === undefined ? grant.refreshToken : text(data.refresh_token),
      scopes: data.scope === undefined ? [...grant.scopes] : scopeList(data.scope), expiresAt: expiry(data.expires_in, now), issuedAt: now.toISOString() };
  }
  async revoke(grant: ProviderGrant): Promise<void> {
    requireGrant(grant, this.options.grantProject);
    await this.options.http.bytes({ url: "https://oauth2.googleapis.com/revoke", method: "POST", operation: "revoke",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: grant.refreshToken || grant.accessToken }).toString(), maxBytes: 4096 });
  }
  async read(_connection: ConnectionRef, _grant: ProviderGrant, _now: Date, _signal: AbortSignal): Promise<ProviderSnapshot[]> { void [_connection, _grant, _now, _signal]; return []; }
  /** Picker candidates come from the dedicated UI/session channel. Never enumerate Drive here. */
  async files(_connection: ConnectionRef, _grant: ProviderGrant): Promise<ProviderFile[]> { void [_connection, _grant]; return []; }
  private async selected(connection: ConnectionRef, externalId: string) {
    if (connection.provider !== this.id || !/^[A-Za-z0-9_-]{1,200}$/.test(externalId) || !this.options.isSelected || !(await this.options.isSelected(connection, externalId))) throw new IntegrationError("FILE_NOT_SELECTED", 403);
  }
  private async metadata(grant: ProviderGrant, externalId: string) {
    const data = record(await this.options.http.json<unknown>({ url: `https://www.googleapis.com/drive/v3/files/${externalId}?${new URLSearchParams({ fields: FIELDS })}`, method: "GET", operation: "read", headers: bearer(grant) }));
    if (data.id !== externalId || typeof data.trashed !== "boolean" || data.trashed || record(data.capabilities).canDownload !== true) throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
    if (data.driveId !== undefined || !MIME.includes(String(data.mimeType))) throw new IntegrationError("UNSUPPORTED_FILE");
    const size = data.size === undefined && data.mimeType === MIME[2] ? null : typeof data.size === "string" && /^\d+$/.test(data.size) ? Number(data.size) : NaN;
    if (size !== null && (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES)) throw new IntegrationError("FILE_TOO_LARGE");
    return { id: externalId, title: text(data.name, 1000), mimeType: text(data.mimeType), version: text(data.version, 200), size, canDownload: true };
  }
  async file(connection: ConnectionRef, grant: ProviderGrant, externalId: string): Promise<ProviderFile> {
    await this.selected(connection, externalId);
    requireGrant(grant, this.options.grantProject);
    if (!GOOGLE_DRIVE_SCOPES.every(scope => grant.scopes.includes(scope))) throw new IntegrationError("INSUFFICIENT_SCOPES", 403);
    const before = await this.metadata(grant, externalId);
    const suffix = before.mimeType === MIME[2] ? "/export?mimeType=text%2Fplain" : "?alt=media";
    const bytes = await this.options.http.bytes({ url: `https://www.googleapis.com/drive/v3/files/${externalId}${suffix}`, method: "GET", operation: "read", headers: bearer(grant), maxBytes: MAX_FILE_BYTES });
    if (bytes.length > MAX_FILE_BYTES) throw new IntegrationError("FILE_TOO_LARGE");
    if (before.size !== null && before.size !== bytes.length) throw new IntegrationError("SOURCE_CHANGED", 409);
    const content = await extractDriveContent(before.mimeType, bytes);
    const after = await this.metadata(grant, externalId);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new IntegrationError("SOURCE_CHANGED", 409);
    await this.selected(connection, externalId);
    // Drive ownership is not proof of rights to process/share every piece of content.
    return { externalId, title: after.title, mimeType: after.mimeType, version: after.version, sizeBytes: bytes.length, canDownload: true, rights: "unknown", content };
  }
}
