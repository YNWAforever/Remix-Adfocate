// @vitest-environment node
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../app.js";
import { CredentialVault } from "../lib/integrations/credentials.js";
import { createLiveIntegrationRuntime, getLiveIntegrationRuntime, readLiveIntegrationSettings } from "../lib/integrations/liveRuntime.js";
import { MemoryIntegrationRepository } from "../lib/integrations/memoryRepo.js";
import { createMockProviders } from "../lib/integrations/mockProviders.js";
import { OAuthCoordinator, type OAuthConfig, type OAuthStore } from "../lib/integrations/oauth.js";
import { GoogleDriveLiveProvider } from "../lib/integrations/providers/googleDriveLive.js";
import { InstagramLiveProvider, INSTAGRAM_API_VERSION } from "../lib/integrations/providers/instagramLive.js";
import { ProviderHttp } from "../lib/integrations/providerHttp.js";
import { IntegrationService } from "../lib/integrations/service.js";
import type { IntegrationProvider, ProviderId } from "../lib/integrations/types.js";
import { integrationRoutes } from "../routes/integrations.js";

const origin = "https://adfocate-2.vercel.app";
const keyring = JSON.stringify({ activeKeyId: "k1", keys: { k1: Buffer.alloc(32, 9).toString("base64") } });
const baseEnv: Record<string, string | undefined> = {
  INTEGRATIONS_ENABLED: "true", INTEGRATIONS_MODE: "live_pilot", INTEGRATIONS_LIVE_ORIGIN: origin, INTEGRATIONS_KEYRING: keyring,
  INSTAGRAM_CONNECTIONS_ENABLED: "true", INSTAGRAM_APP_ID: "app-id", INSTAGRAM_APP_SECRET: "app-secret",
};
const actor = { creatorId: "creator", workspaceId: "workspace" };
const noNetwork = () => { throw new Error("network must not be touched"); };
const stubClient = {} as SupabaseClient;
const configs: Record<ProviderId, OAuthConfig> = {
  instagram: { clientId: "app-id", redirectUri: `${origin}/api/integration-oauth/instagram/callback` },
  google_drive: { clientId: "gid", redirectUri: `${origin}/api/integration-oauth/google_drive/callback` },
};
const liveProviders = () => {
  const http = new ProviderHttp(noNetwork, { transportKind: "live" });
  return {
    instagram: new InstagramLiveProvider({ http, clientId: "app-id", clientSecret: "secret", apiVersion: INSTAGRAM_API_VERSION }),
    google_drive: new GoogleDriveLiveProvider({ http, clientId: "gid", clientSecret: "gsecret", grantProject: "123", verifyIdentity: async () => ({ subject: "sub" }) }),
  } satisfies Record<ProviderId, IntegrationProvider>;
};

describe("live integration environment package", () => {
  it("stays disabled by default and never half-enables a provider", () => {
    expect(readLiveIntegrationSettings({})).toEqual({ enabled: false, reason: "DISABLED", missing: [] });
    const partial = readLiveIntegrationSettings({ ...baseEnv, INTEGRATIONS_KEYRING: "" });
    expect(partial.enabled).toBe(false);
    expect(partial.enabled ? [] : partial.missing).toContain("INTEGRATIONS_KEYRING");
    expect(readLiveIntegrationSettings({ ...baseEnv, INTEGRATIONS_LIVE_ORIGIN: "http://adfocate-2.vercel.app" }).enabled).toBe(false);
    const withoutProvider = readLiveIntegrationSettings({ ...baseEnv, INSTAGRAM_CONNECTIONS_ENABLED: "false" });
    expect(withoutProvider.enabled).toBe(false);
    const driveFlagOnly = readLiveIntegrationSettings({ ...baseEnv, DRIVE_CONNECTIONS_ENABLED: "true" });
    expect(driveFlagOnly.enabled).toBe(false);
    expect(driveFlagOnly.enabled ? [] : driveFlagOnly.missing).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(createLiveIntegrationRuntime({ env: {}, fetchImpl: noNetwork, client: stubClient })).toBeNull();
  });

  it("builds a live runtime without touching the network", () => {
    const runtime = createLiveIntegrationRuntime({ env: baseEnv, fetchImpl: noNetwork, client: stubClient });
    expect(runtime?.mode).toBe("live_pilot");
    expect(runtime?.origin).toBe(origin);
    expect(runtime?.picker).toBeUndefined();
    const google = createLiveIntegrationRuntime({ env: { ...baseEnv, DRIVE_CONNECTIONS_ENABLED: "true", GOOGLE_OAUTH_CLIENT_ID: "gid", GOOGLE_OAUTH_CLIENT_SECRET: "gsecret", GOOGLE_CLOUD_PROJECT_NUMBER: "123" }, fetchImpl: noNetwork, client: stubClient });
    expect(google?.picker).toBeDefined();
  });

  it("caches the process-lifetime runtime by origin", () => {
    const first = getLiveIntegrationRuntime(baseEnv, { fetchImpl: noNetwork, client: stubClient });
    const second = getLiveIntegrationRuntime(baseEnv, { fetchImpl: noNetwork, client: stubClient });
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });
});

describe("live OAuth coordinator", () => {
  const coordinator = (allowLive: boolean, providers = liveProviders()) => {
    const store = { start: async () => undefined, callback: async () => undefined, complete: async () => { throw new Error("not used"); } } as unknown as OAuthStore;
    return new OAuthCoordinator(store, new CredentialVault(new Uint8Array(32).fill(3), "k1"), providers, configs,
      async () => ({ id: "connection", generation: 1 }), () => new Date("2026-11-18T00:00:00Z"), allowLive ? { externalAccess: true } : {});
  };

  it("still rejects live providers unless the composition opts in", () => {
    expect(() => coordinator(false)).toThrow("LIVE_PROVIDER_DISABLED");
    expect(() => new IntegrationService(new MemoryIntegrationRepository(), liveProviders(), new CredentialVault(new Uint8Array(32).fill(3), "k1"))).toThrow("LIVE_PROVIDER_DISABLED");
    expect(() => new IntegrationService(new MemoryIntegrationRepository(), liveProviders(), new CredentialVault(new Uint8Array(32).fill(3), "k1"), undefined, { externalAccess: true })).not.toThrow();
  });

  it("begins a real Instagram authorization without exchanging anything", async () => {
    const begin = await coordinator(true).begin(actor, "instagram", "session", "/connections", 0);
    expect(begin.sampleOnly).toBe(false);
    expect(begin.scopes).toEqual(["instagram_business_basic", "instagram_business_manage_insights"]);
    const url = new URL(begin.authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://api.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("app-id");
    expect(url.searchParams.get("redirect_uri")).toBe(configs.instagram.redirectUri);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("begins a real Google authorization with PKCE and a nonce", async () => {
    const begin = await coordinator(true).begin(actor, "google_drive", "session", "/connections", 0);
    expect(begin.sampleOnly).toBe(false);
    expect(begin.scopes).toEqual(["https://www.googleapis.com/auth/drive.file", "openid"]);
    const url = new URL(begin.authorizationUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("redirect_uri")).toBe(configs.google_drive.redirectUri);
  });
});

describe("live integration routes", () => {
  it("reports live mode, keeps the provider flag gate, and closes the mock-only endpoints", async () => {
    const env = { ...baseEnv, DRIVE_CONNECTIONS_ENABLED: "false" };
    const service = new IntegrationService(new MemoryIntegrationRepository(), createMockProviders(), new CredentialVault(new Uint8Array(32).fill(3), "k1"));
    const app = new Hono<Env>();
    app.use("*", async (c, next) => { c.set("userId", actor.creatorId); c.set("workspaceId", actor.workspaceId); c.set("jwt", "session"); await next(); });
    app.route("/api/me/integrations", integrationRoutes({ getService: () => service, mode: () => "live_pilot", environment: env }));
    expect(await (await app.request("http://localhost/api/me/integrations")).json()).toEqual({ mode: "live_pilot", connections: [] });
    const start = await app.request("http://localhost/api/me/integrations/instagram/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(start.status).toBe(409);
    expect(await start.json()).toMatchObject({ code: "OAUTH_REQUIRED" });
    const picker = await app.request("http://localhost/api/me/integrations/any-connection/picker");
    expect(picker.status).toBe(409);
    const blocked = new IntegrationService(new MemoryIntegrationRepository(), createMockProviders(), new CredentialVault(new Uint8Array(32).fill(3), "k1"));
    const guarded = new Hono<Env>();
    guarded.use("*", async (c, next) => { c.set("userId", actor.creatorId); c.set("workspaceId", actor.workspaceId); c.set("jwt", "session"); await next(); });
    guarded.route("/api/me/integrations", integrationRoutes({ getService: () => blocked, mode: () => "live_pilot", environment: { ...env, DRIVE_CONNECTIONS_ENABLED: "false" } }));
    expect((await guarded.request("http://localhost/api/me/integrations/google_drive/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(409);
  });
});
