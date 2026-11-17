import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../supabase.js";
import { GoogleDriveLiveProvider, createGoogleSigningKeyResolver } from "./providers/googleDriveLive.js";
import { InstagramLiveProvider, INSTAGRAM_API_VERSION } from "./providers/instagramLive.js";
import { verifyGoogleIdentityToken } from "./googleIdentity.js";
import { keySourceFromSecret, RotatingCredentialVault } from "./keyProvider.js";
import { createMockProviders } from "./mockProviders.js";
import { OAuthCoordinator } from "./oauth.js";
import { RepositoryOAuthStore } from "./oauthStore.js";
import { PickerTokenChannel } from "./pickerToken.js";
import { ProviderHttp, type ProviderFetch } from "./providerHttp.js";
import { SupabaseIntegrationRepository } from "./repo.js";
import { IntegrationService } from "./service.js";
import type { Actor, ConnectionRecord, IntegrationProvider, ProviderId } from "./types.js";

/**
 * Opt-in live composition root.
 *
 * D0 keeps the product's `integrationMode()` closed and never constructs a coordinator or
 * service client. Here the same protocols run against live transports, but only when the
 * deployment supplies a complete, explicit environment package. Missing pieces never
 * half-enable a provider: the whole surface stays disabled and reports what is missing.
 */
export type LiveIntegrationSettings = {
  origin: string;
  keyring: string;
  instagram?: { clientId: string; clientSecret: string };
  googleDrive?: { clientId: string; clientSecret: string; grantProject: string; projectNumber: string };
};

export type LiveIntegrationCheck =
  | { enabled: true; settings: LiveIntegrationSettings }
  | { enabled: false; reason: "DISABLED" | "CONFIG_REQUIRED"; missing: string[] };

const flags = (env: Record<string, string | undefined>) => ({
  instagram: env.INSTAGRAM_CONNECTIONS_ENABLED === "true",
  googleDrive: env.DRIVE_CONNECTIONS_ENABLED === "true",
});

/** Never throws: a malformed package is reported as missing configuration. */
export function readLiveIntegrationSettings(env: Record<string, string | undefined> = process.env): LiveIntegrationCheck {
  if (env.INTEGRATIONS_ENABLED !== "true" || env.INTEGRATIONS_MODE !== "live_pilot") return { enabled: false, reason: "DISABLED", missing: [] };
  const missing: string[] = [];
  const origin = env.INTEGRATIONS_LIVE_ORIGIN ?? "";
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { missing.push("INTEGRATIONS_LIVE_ORIGIN"); }
  const keyring = env.INTEGRATIONS_KEYRING ?? "";
  try { keySourceFromSecret(keyring); } catch { missing.push("INTEGRATIONS_KEYRING"); }

  const enabled = flags(env);
  if (!enabled.instagram && !enabled.googleDrive) missing.push("INSTAGRAM_CONNECTIONS_ENABLED or DRIVE_CONNECTIONS_ENABLED");
  let instagram: LiveIntegrationSettings["instagram"], googleDrive: LiveIntegrationSettings["googleDrive"];
  if (enabled.instagram) {
    const clientId = env.INSTAGRAM_APP_ID ?? "", clientSecret = env.INSTAGRAM_APP_SECRET ?? "";
    if (!clientId) missing.push("INSTAGRAM_APP_ID");
    if (!clientSecret) missing.push("INSTAGRAM_APP_SECRET");
    if (clientId && clientSecret) instagram = { clientId, clientSecret };
  }
  if (enabled.googleDrive) {
    const clientId = env.GOOGLE_OAUTH_CLIENT_ID ?? "", clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET ?? "", projectNumber = env.GOOGLE_CLOUD_PROJECT_NUMBER ?? "";
    if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
    if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
    if (!/^\d{1,32}$/.test(projectNumber)) missing.push("GOOGLE_CLOUD_PROJECT_NUMBER");
    if (clientId && clientSecret && /^\d{1,32}$/.test(projectNumber)) googleDrive = { clientId, clientSecret, projectNumber, grantProject: projectNumber };
  }
  if (missing.length) return { enabled: false, reason: "CONFIG_REQUIRED", missing };
  return { enabled: true, settings: { origin, keyring, ...(instagram ? { instagram } : {}), ...(googleDrive ? { googleDrive } : {}) } };
}

export type LiveIntegrationRuntime = {
  readonly mode: "live_pilot";
  readonly origin: string;
  readonly service: IntegrationService;
  readonly coordinator: OAuthCoordinator;
  readonly picker?: PickerTokenChannel;
  readonly currentConnection: (actor: Actor, provider: ProviderId) => Promise<{ generation: number; providerRevocation: ConnectionRecord["providerRevocation"] } | null>;
};

export type LiveIntegrationDeps = {
  env?: Record<string, string | undefined>;
  fetchImpl?: ProviderFetch;
  clock?: () => Date;
  client?: SupabaseClient;
};

/**
 * Builds the live runtime or returns null. Callers must treat null as "connections disabled";
 * this function never creates a Supabase client unless the environment package is complete.
 */
export function createLiveIntegrationRuntime(deps: LiveIntegrationDeps = {}): LiveIntegrationRuntime | null {
  const check = readLiveIntegrationSettings(deps.env);
  if (!check.enabled) return null;
  const { settings } = check;
  const client = deps.client ?? serviceClient();
  const http = new ProviderHttp(deps.fetchImpl ?? ((url, init) => fetch(url, init)), { transportKind: "live" });
  const clock = deps.clock ?? (() => new Date());
  const vault = new RotatingCredentialVault(keySourceFromSecret(settings.keyring));
  const repo = new SupabaseIntegrationRepository(client);
  const mock = createMockProviders();
  const providers: Record<ProviderId, IntegrationProvider> = {
    instagram: settings.instagram
      ? new InstagramLiveProvider({ http, clientId: settings.instagram.clientId, clientSecret: settings.instagram.clientSecret, apiVersion: INSTAGRAM_API_VERSION })
      : mock.instagram,
    google_drive: settings.googleDrive
      ? new GoogleDriveLiveProvider({
        http, clientId: settings.googleDrive.clientId, clientSecret: settings.googleDrive.clientSecret, grantProject: settings.googleDrive.grantProject,
        verifyIdentity: (idToken, nonce) => verifyGoogleIdentityToken(idToken, { clientId: settings.googleDrive!.clientId, nonce }, createGoogleSigningKeyResolver(http), clock()),
        isSelected: async (connection, externalId) => {
          // Server-authoritative selection: current row, same actor/generation, still selected.
          const row = await repo.connection(connection, connection.id);
          if (!row || row.creatorId !== connection.creatorId || row.workspaceId !== connection.workspaceId || row.generation !== connection.generation
            || row.status === "revoked" || row.status === "reauth_required") return false;
          return (await repo.resources(connection, connection.id)).some(resource =>
            resource.externalId === externalId && resource.generation === connection.generation && resource.selected && resource.availability !== "revoked");
        },
      })
      : mock.google_drive,
  };
  const service = new IntegrationService(repo, providers, vault, clock, { externalAccess: true });
  const configs: Partial<Record<ProviderId, { clientId: string; redirectUri: string }>> = {};
  if (settings.instagram) configs.instagram = { clientId: settings.instagram.clientId, redirectUri: `${settings.origin}/api/integration-oauth/instagram/callback` };
  if (settings.googleDrive) configs.google_drive = { clientId: settings.googleDrive.clientId, redirectUri: `${settings.origin}/api/integration-oauth/google_drive/callback` };
  const coordinator = new OAuthCoordinator(
    new RepositoryOAuthStore(repo, client),
    vault,
    providers,
    configs as Record<ProviderId, { clientId: string; redirectUri: string }>,
    async (actor, provider, grant, expectedGeneration) => {
      const connection = await service.acceptAuthorizedGrant(actor, provider, grant, expectedGeneration);
      return { id: connection.id, generation: connection.generation };
    },
    clock,
    { externalAccess: true },
  );
  const picker = settings.googleDrive
    ? new PickerTokenChannel(
      { origin: settings.origin, projectNumber: settings.googleDrive.projectNumber },
      (actor, id, generation) => service.pickerAccessGrant(actor, id, generation),
    )
    : undefined;
  return {
    mode: "live_pilot",
    origin: settings.origin,
    service,
    coordinator,
    ...(picker ? { picker } : {}),
    currentConnection: async (actor, provider) => {
      const row = (await repo.list(actor)).find(candidate => candidate.provider === provider && candidate.status !== "revoked");
      return row ? { generation: row.generation, providerRevocation: row.providerRevocation } : null;
    },
  };
}

let cached: { key: string; runtime: LiveIntegrationRuntime | null } | null = null;

/** Process-lifetime runtime: the environment package is deployment configuration, not request data. */
export function getLiveIntegrationRuntime(env: Record<string, string | undefined> = process.env, deps: Omit<LiveIntegrationDeps, "env"> = {}): LiveIntegrationRuntime | null {
  const check = readLiveIntegrationSettings(env);
  const key = check.enabled ? `enabled:${check.settings.origin}` : `disabled:${check.reason}`;
  if (!cached || cached.key !== key) cached = { key, runtime: check.enabled ? createLiveIntegrationRuntime({ env, ...deps }) : null };
  return cached.runtime;
}
