export type OAuthProviderConfig = Readonly<{
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  /** Absent for public clients registered with token_endpoint_auth_method "none" (PKCE only). */
  clientSecret?: string;
  redirectUri: string;
  scopes: readonly string[];
}>;

export type OAuthProviderRegistry = Readonly<{
  providers: Readonly<Record<string, OAuthProviderConfig>>;
  errors: readonly string[];
}>;

const PROVIDER_NAME = /^[a-z0-9_]{1,32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function allowedUrl(raw: unknown): string | null {
  let url: URL;
  try { url = new URL(String(raw)); } catch { return null; }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.toString();
}

/** Parses MCP_OAUTH_PROVIDERS: a JSON object of provider → authorization/token config. */
export function loadOAuthProviders(raw = process.env.MCP_OAUTH_PROVIDERS): OAuthProviderRegistry {
  const errors: string[] = [];
  if (!raw?.trim()) return { providers: {}, errors };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { providers: {}, errors: ["oauth: providers config is not valid JSON"] }; }
  if (!isRecord(parsed)) return { providers: {}, errors: ["oauth: providers config must be an object"] };
  const providers: Record<string, OAuthProviderConfig> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!PROVIDER_NAME.test(name) || !isRecord(value)) { errors.push(`oauth:${name}: invalid provider entry`); continue; }
    const authorizationUrl = allowedUrl(value.authorizationUrl);
    const tokenUrl = allowedUrl(value.tokenUrl);
    const redirectUri = allowedUrl(value.redirectUri);
    const clientId = typeof value.clientId === "string" ? value.clientId.trim() : "";
    const clientSecret = typeof value.clientSecret === "string" ? value.clientSecret.trim() : "";
    const scopes = Array.isArray(value.scopes)
      ? value.scopes.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0 && scope.length <= 120)
      : [];
    if (!authorizationUrl || !tokenUrl || !redirectUri || !clientId || !scopes.length) {
      errors.push(`oauth:${name}: authorizationUrl, tokenUrl, redirectUri, clientId and scopes are required`);
      continue;
    }
    providers[name] = { authorizationUrl, tokenUrl, redirectUri, clientId, ...(clientSecret ? { clientSecret } : {}), scopes };
  }
  return { providers, errors };
}

export function findOAuthProvider(registry: OAuthProviderRegistry, name: string | null | undefined): OAuthProviderConfig | null {
  if (!name) return null;
  return registry.providers[name] ?? null;
}
