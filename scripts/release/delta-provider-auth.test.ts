// @vitest-environment node
import { createHash, createHmac } from "node:crypto";
import { AuthSessionMissingError, createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { providerTotpCode, runProviderAuthMfa } from "./delta-provider-auth";
import { ProviderRehearsalFailure, type ProviderActor, type ProviderRehearsalRuntime } from "./delta-provider-contracts";

// Pure RFC vectors and deliberately mocked SDK/HTTP orchestration only. No
// provider, app server, credentials, database or actual acceptance evidence.
const PRIVATE = "synthetic-private-sdk-detail@example.test";
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const UNIT_KEY = "unit-only-signature-key-no-provider";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const names = ["creator", "otherCreator", "operator", "reviewer", "staff", "revoked", "noMembership"] as const;
type Name = typeof names[number];
interface Options {
  hosted?: boolean; frozenCounter?: boolean; sdkThrow?: boolean; wrongUser?: boolean; wrongIssuer?: boolean;
  acceptFabricated?: boolean; acceptExpired?: boolean; mfaBypass?: boolean; mfaVerifyError?: boolean;
  unverifiedFactor?: boolean; membershipPresent?: boolean; wrongMembershipCode?: boolean; crossTenantAllowed?: boolean;
  revokedProviderAccepted?: boolean; revokedAppAccepted?: boolean; expiredNotExpired?: boolean; noMembershipNotStaff?: boolean;
  creatorFixtureForeign?: boolean; foreignMissing?: boolean; foreignWrongId?: boolean; foreignPrimarySlug?: boolean; foreignEmptySlug?: boolean;
  creatorPrimaryDenied?: boolean; creatorForeignAccepted?: boolean; creatorForeignMfa?: boolean; creatorForeignMembership?: boolean;
  revokedSdkNormalized?: boolean; revokedSdkPrivateError?: boolean; revokedWireStatus?: number; revokedWireCode?: unknown;
  revokedWireMissingCode?: boolean; revokedWireMalformed?: boolean; revokedWireBeforeStatus?: number; revokedWireBeforeWrongUser?: boolean;
  revokedAppStatus?: number; revokedAppCode?: unknown; revokedAppMalformed?: boolean; revokedAppBeforeDenied?: boolean; revokedShortLived?: boolean;
}
function fixture(options: Options = {}) {
  let requests = 0;
  const facts: { name: string; facts: unknown }[] = [], calls: { name: Name; method: string }[] = [];
  const revoked = new Set<string>(), verifiedFactors = new Set<Name>();
  const tick = () => { if (!options.frozenCounter) requests++; };
  const payload = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
  const mint = (claims: Record<string, unknown>) => {
    const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const data = Buffer.from(JSON.stringify(claims)).toString("base64url"), signed = `${head}.${data}`;
    return `${signed}.${createHmac("sha256", UNIT_KEY).update(signed).digest("base64url")}`;
  };
  const decode = (token: string) => {
    const parts = token.split("."), jwt = payload(token);
    const signed = createHmac("sha256", UNIT_KEY).update(`${parts[0]}.${parts[1]}`).digest("base64url");
    const signatureInvalid = signed !== parts[2], expired = Number(jwt.exp) * 1000 <= Date.now();
    return { jwt, invalid: signatureInvalid && !options.acceptFabricated || expired && !options.acceptExpired };
  };
  const actors = Object.fromEntries(names.map((name, index) => {
    const actor = { id: id(index + 1), email: `${name}-${PRIVATE}`, password: "unit-only-private-password",
      client: {} as SupabaseClient, accessToken: mint({ sub: id(index + 1), iss: options.wrongIssuer ? "https://wrong.invalid/auth/v1" : "http://127.0.0.1:54321/auth/v1",
        exp: Math.floor(Date.now() / 1000) + (name === "revoked" && options.revokedShortLived ? 5 : 3600), iat: Math.floor(Date.now() / 1000), session_id: id(index + 20), role: "authenticated", aud: "authenticated", aal: "aal1" }) };
    const factorId = id(index + 100), challengeId = id(index + 200);
    const operation = (method: string) => { calls.push({ name, method }); tick(); if (options.sdkThrow) throw new Error(PRIVATE); };
    actor.client = { auth: {
      getUser: async (token: string) => {
        operation("getUser"); const decoded = decode(token);
        if (decoded.invalid) return { data: { user: null }, error: { status: 403, code: "bad_jwt", message: PRIVATE } };
        if (revoked.has(String(decoded.jwt.session_id)) && !options.revokedProviderAccepted) return { data: { user: null }, error: options.revokedSdkNormalized ? new AuthSessionMissingError()
          : options.revokedSdkPrivateError ? { status: Number.MAX_SAFE_INTEGER, code: PRIVATE, name: PRIVATE, message: PRIVATE }
            : { status: 403, code: "session_not_found", message: PRIVATE } };
        return { data: { user: { id: options.wrongUser ? id(999) : actor.id, email: PRIVATE } }, error: null };
      },
      signOut: async ({ scope }: { scope: string }) => { operation("signOut"); expect(scope).toBe("local"); revoked.add(String(payload(actor.accessToken).session_id)); return { error: null }; },
      mfa: {
        enroll: async ({ factorType }: { factorType: string }) => { operation("enroll"); expect(factorType).toBe("totp"); return { error: null, data: { id: factorId, type: "totp", totp: { secret: SECRET, qr_code: PRIVATE, uri: PRIVATE } } }; },
        challenge: async (input: { factorId: string }) => { operation("challenge"); expect(input.factorId).toBe(factorId); return { error: null, data: { id: challengeId } }; },
        verify: async (input: { factorId: string; challengeId: string; code: string }) => {
          operation("verify"); expect(input.factorId).toBe(factorId); expect(input.challengeId).toBe(challengeId); expect(input.code).toMatch(/^\d{6}$/);
          if (options.mfaVerifyError) return { data: null, error: { status: 400, message: PRIVATE } };
          verifiedFactors.add(name); return { error: null, data: { access_token: mint({ ...payload(actor.accessToken), aal: "aal2" }), user: { id: actor.id }, refresh_token: PRIVATE } };
        },
        listFactors: async () => { operation("listFactors"); return { error: null, data: { totp: [{ id: factorId, status: !options.unverifiedFactor && verifiedFactors.has(name) ? "verified" : "unverified" }] } }; },
      },
    } } as unknown as SupabaseClient;
    return [name, actor];
  })) as Record<Name, ProviderActor>;
  const query = (table: string) => {
    const filters = new Map<string, unknown>();
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters.set(key, value); return chain; },
      single: async () => {
        tick();
        if (table === "creators") return { data: { id: filters.get("id"), workspace_id: options.creatorFixtureForeign ? id(301) : id(300) }, error: null };
        expect(table).toBe("workspaces"); expect(filters.get("id")).toBe(id(301));
        return { data: options.foreignMissing ? null : { id: options.foreignWrongId ? id(300) : id(301),
          slug: options.foreignPrimarySlug ? "owned-unit" : options.foreignEmptySlug ? "" : "owned-foreign" }, error: options.foreignMissing ? { message: PRIVATE } : null };
      },
      maybeSingle: async () => { tick(); expect(table).toBe("brand_users"); return { data: options.membershipPresent ? { user_id: filters.get("user_id") } : null, error: null }; } };
    return chain;
  };
  const response = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const runtime: ProviderRehearsalRuntime = {
    runId: "00000000000000000000000000000001", sourceCommit: "a".repeat(40), apiOrigin: options.hosted ? "https://hosted.invalid" : "http://127.0.0.1:54321", appOrigin: "http://127.0.0.1:8080",
    workspaceId: id(300), otherWorkspaceId: id(301), workspaceSlug: "owned-unit", anonKey: "unit-only", actors,
    service: { from: query } as unknown as SupabaseClient, anonymous: {} as SupabaseClient,
    get httpRequests() { return requests; }, assertOwned: async () => {}, sql: async () => { throw new Error("unit SQL unavailable"); },
    expiredSignedAccessToken: async actor => { tick(); return mint({ ...payload(actor.accessToken), exp: Math.floor(Date.now() / 1000) + (options.expiredNotExpired ? 600 : -60), iat: Math.floor(Date.now() / 1000) - 120 }); },
    providerUser: async actor => {
      tick(); expect(actor).toBe(actors.revoked); const afterLogout = revoked.has(String(payload(actor.accessToken).session_id));
      calls.push({ name: "revoked", method: afterLogout ? "wire-after-logout" : "wire-before-logout" });
      if (!afterLogout) return response(options.revokedWireBeforeStatus ?? 200, { id: options.revokedWireBeforeWrongUser ? id(999) : actor.id, email: PRIVATE });
      const status = options.revokedProviderAccepted ? 200 : options.revokedWireStatus ?? 403;
      if (options.revokedWireMalformed) return new Response(PRIVATE, { status });
      return response(status, status === 200 ? { id: actor.id, email: PRIVATE } : {
        ...(options.revokedWireMissingCode ? {} : { code: options.revokedWireCode ?? "session_not_found" }), message: PRIVATE,
      });
    },
    request: async (actor, path, init) => {
      tick(); if (!actor) return response(401, { code: "no_auth" });
      const { jwt, invalid } = decode(actor.accessToken);
      if (invalid) return response(401, { code: "bad_token" });
      const name = names.find(value => actors[value].id === actor.id)!;
      if (revoked.has(String(jwt.session_id))) {
        calls.push({ name, method: "app-after-logout" });
        const status = options.revokedAppAccepted ? 200 : options.revokedAppStatus ?? 401;
        if (options.revokedAppMalformed) return new Response(PRIVATE, { status });
        return response(status, status === 200 ? { submissions: [] } : { code: options.revokedAppCode ?? "bad_token", message: PRIVATE });
      }
      if (name === "revoked" && options.revokedAppBeforeDenied) return response(403, { code: "forbidden" });
      if (path.startsWith("/api/admin/")) {
        if (options.noMembershipNotStaff && name === "noMembership") return response(403, { code: "no_admin" });
        const pending = jwt.aal !== "aal2";
        if (path === "/api/admin/me") return response(200, { staff: { userId: actor.id, email: PRIVATE }, mfa_required: options.mfaBypass ? false : pending });
        if (pending && !options.mfaBypass) return response(403, { code: "mfa_required" });
        if (name === "noMembership") return response(403, { code: options.wrongMembershipCode ? "mfa_required" : "WORKSPACE_MEMBERSHIP_REQUIRED" });
        if (path.includes(id(301)) && !options.crossTenantAllowed) return response(404, { code: "NOT_FOUND" });
        return response(200, { missions: [] });
      }
      if (name === "otherCreator") {
        const slug = new Headers(init?.headers).get("X-Workspace-Slug") ?? runtime.workspaceSlug;
        if (slug === runtime.workspaceSlug && options.creatorPrimaryDenied) return response(403, { code: "forbidden" });
        if (slug !== runtime.workspaceSlug && !options.creatorForeignAccepted) return response(403, {
          code: options.creatorForeignMfa ? "mfa_required" : options.creatorForeignMembership ? "WORKSPACE_MEMBERSHIP_REQUIRED" : "forbidden",
        });
      }
      return response(200, { submissions: [] });
    },
    record: (name, privateFacts, before) => {
      expect(requests).toBeGreaterThan(before); facts.push({ name, facts: privateFacts });
      return { name, status: "passed", evidenceSha256: createHash("sha256").update(JSON.stringify(privateFacts)).digest("hex"), actualHttpRequests: requests - before };
    },
  };
  return { runtime, actors, facts, calls, payload };
}

describe("TOTP RFC 6238 independent public vectors", () => {
  it.each([[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]])("computes SHA1 six-digit code at %s seconds", (seconds, expected) => {
    expect(providerTotpCode(SECRET, Number(seconds) * 1000)).toBe(expected);
  });
  it.each(["", "lowercaseinvalid", "ABCDEFG1ABCDEFG1", "!".repeat(32), "A".repeat(129)])("rejects invalid private input without echo", secret => {
    expect(() => providerTotpCode(secret, Date.now())).toThrow("Provider rehearsal held");
  });
  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unbounded/nonintegral time", time => { expect(() => providerTotpCode(SECRET, time)).toThrow("Provider rehearsal held"); });
});

describe("offline Auth/MFA orchestration, never provider acceptance evidence", () => {
  it("requires provider/HTTP prerequisites, promotes four independent actors and keeps credentials out of records", async () => {
    const f = fixture(), original = new Map(Object.entries(f.actors).map(([name, actor]) => [name, actor.accessToken]));
    const cases = await runProviderAuthMfa(f.runtime);
    expect(cases).toHaveLength(12); expect(new Set(cases.map(row => row.name)).size).toBe(12);
    expect(cases.every(row => row.actualHttpRequests > 0 && row.status === "passed" && /^[a-f0-9]{64}$/.test(row.evidenceSha256))).toBe(true);
    for (const name of ["staff", "operator", "reviewer", "noMembership"] as const) {
      expect(f.actors[name].accessToken).not.toBe(original.get(name)); expect(f.payload(f.actors[name].accessToken).aal).toBe("aal2");
      expect(f.calls.filter(call => call.name === name && call.method === "enroll")).toHaveLength(1);
      expect(f.calls.filter(call => call.name === name && call.method === "challenge")).toHaveLength(1);
      expect(f.calls.filter(call => call.name === name && call.method === "verify")).toHaveLength(1);
    }
    expect(f.facts.find(row => row.name === "auth-owned-trusted-expired-token-denied")!.facts).toMatchObject({ signer: "owned-local-provider-key", providerIssued: false });
    const serialized = JSON.stringify(f.facts); expect(serialized).not.toContain(PRIVATE); expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("refresh_token"); expect(serialized).not.toContain("unit-only-private-password");
    for (const token of original.values()) expect(serialized).not.toContain(token);
  });
  it.each([
    ["hosted origin", { hosted: true }, "auth-runtime-prerequisite"],
    ["SDK without a real counter increment", { frozenCounter: true }, "auth-issued-session"],
    ["different returned provider user", { wrongUser: true }, "auth-issued-session"],
    ["wrong issuer", { wrongIssuer: true }, "auth-issued-session"],
    ["fabricated signature accepted", { acceptFabricated: true }, "auth-fabricated-token"],
    ["expired signed token accepted", { acceptExpired: true }, "auth-owned-expired-token"],
    ["signer returns fresh token", { expiredNotExpired: true }, "auth-owned-expired-token"],
    ["creator fixture moved from primary", { creatorFixtureForeign: true }, "auth-creator-tenant"],
    ["unknown foreign workspace", { foreignMissing: true }, "auth-creator-tenant"],
    ["foreign workspace has wrong ID", { foreignWrongId: true }, "auth-creator-tenant"],
    ["foreign scope repeats primary slug", { foreignPrimarySlug: true }, "auth-creator-tenant"],
    ["foreign scope has empty slug", { foreignEmptySlug: true }, "auth-creator-tenant"],
    ["same actor lacks primary access", { creatorPrimaryDenied: true }, "auth-creator-tenant"],
    ["creator foreign scope allowed", { creatorForeignAccepted: true }, "auth-creator-tenant"],
    ["creator foreign scope returns MFA denial", { creatorForeignMfa: true }, "auth-creator-tenant"],
    ["creator foreign scope returns membership denial", { creatorForeignMembership: true }, "auth-creator-tenant"],
    ["AAL1 bypasses MFA", { mfaBypass: true }, "auth-staff-mfa"],
    ["provider rejects TOTP", { mfaVerifyError: true }, "auth-staff-mfa"],
    ["provider factor remains unverified", { unverifiedFactor: true }, "auth-staff-mfa"],
    ["no-membership actor lacks staff prerequisite", { noMembershipNotStaff: true }, "auth-no-membership-mfa"],
    ["cross-tenant request allowed", { crossTenantAllowed: true }, "auth-staff-tenant"],
    ["unexpected active membership", { membershipPresent: true }, "auth-staff-membership"],
    ["MFA failure masquerades as membership failure", { wrongMembershipCode: true }, "auth-staff-membership"],
    ["revoked provider token still accepted", { revokedProviderAccepted: true }, "auth-revoked-provider-session-denial-w200-missing-sok-none-a401-bad_token"],
    ["revoked app token still accepted", { revokedAppAccepted: true }, "auth-revoked-app-session-denial-w403-session_not_found-s403-snf-a200-missing"],
  ] as const)("holds rather than recording a false pass: %s", async (_label, options, code) => {
    const f = fixture(options); const error = await runProviderAuthMfa(f.runtime).catch(error => error as unknown);
    expect(error).toBeInstanceOf(ProviderRehearsalFailure); expect((error as ProviderRehearsalFailure).code).toBe(code);
    expect(String(error)).toBe("ProviderRehearsalFailure: Provider rehearsal held");
  });
  it.each([401, 403])("requires actual wire denial %i without interpreting SDK status 400 as wire metadata", async status => {
    const f = fixture({ revokedSdkNormalized: true, revokedWireStatus: status });
    expect((await runProviderAuthMfa(f.runtime)).map(row => row.name)).toContain("provider-auth-revoked-session-denied");
    const result = f.facts.find(row => row.name === "provider-auth-revoked-session-denied")!.facts;
    expect(result).toMatchObject({ validProviderWireBefore: 200, providerWireStatus: status, providerWireCode: "session_not_found", sdkNormalizedStatus: "400", sdkFixedCode: "smiss", appStatus: 401, appCode: "bad_token" });
  });
  it.each([
    ["successful provider despite normalized SDK missing session", { revokedSdkNormalized: true, revokedWireStatus: 200 }, "auth-revoked-provider-session-denial", "w200-missing-s400-smiss-a401-bad_token"],
    ["wire 400 is never reinterpreted as 403", { revokedSdkNormalized: true, revokedWireStatus: 400 }, "auth-revoked-provider-session-denial", "w400-session_not_found-s400-smiss-a401-bad_token"],
    ["wire 404", { revokedWireStatus: 404 }, "auth-revoked-provider-session-denial", "w404-session_not_found-s403-snf-a401-bad_token"],
    ["wire 500", { revokedWireStatus: 500 }, "auth-revoked-provider-session-denial", "w500-session_not_found-s403-snf-a401-bad_token"],
    ["wire bad_jwt does not prove revoked session", { revokedWireStatus: 401, revokedWireCode: "bad_jwt" }, "auth-revoked-provider-session-denial", "w401-bad_jwt-s403-snf-a401-bad_token"],
    ["missing wire code", { revokedWireMissingCode: true }, "auth-revoked-provider-session-denial", "w403-missing-s403-snf-a401-bad_token"],
    ["malformed wire body", { revokedWireMalformed: true }, "auth-revoked-provider-session-denial", "w403-malformed-s403-snf-a401-bad_token"],
    ["app forbidden is the wrong denial", { revokedAppStatus: 403, revokedAppCode: "forbidden" }, "auth-revoked-app-session-denial", "w403-session_not_found-s403-snf-a403-forbidden"],
    ["app MFA is the wrong denial", { revokedAppStatus: 403, revokedAppCode: "mfa_required" }, "auth-revoked-app-session-denial", "w403-session_not_found-s403-snf-a403-mfa_required"],
    ["app membership is the wrong denial", { revokedAppStatus: 403, revokedAppCode: "WORKSPACE_MEMBERSHIP_REQUIRED" }, "auth-revoked-app-session-denial", "w403-session_not_found-s403-snf-a403-membership"],
    ["app malformed body", { revokedAppMalformed: true }, "auth-revoked-app-session-denial", "w403-session_not_found-s403-snf-a401-malformed"],
    ["private/unknown metadata", { revokedSdkPrivateError: true, revokedWireCode: PRIVATE, revokedAppCode: PRIVATE }, "auth-revoked-provider-session-denial", "w403-other-s0-other-a401-other"],
    ["maximum fixed diagnostic fields", { revokedWireCode: "unexpected_failure", revokedAppStatus: 503, revokedAppCode: "owned_http_refusal" }, "auth-revoked-provider-session-denial", "w403-unexpected_failure-s403-snf-a503-http_refusal"],
  ] as const)("fails closed with bounded diagnostics: %s", async (_label, options, prefix, suffix) => {
    const f = fixture(options), error = await runProviderAuthMfa(f.runtime).catch(error => error as unknown) as ProviderRehearsalFailure;
    expect(error).toBeInstanceOf(ProviderRehearsalFailure); expect(error.code).toBe(`${prefix}-${suffix}`);
    expect(error.code).toMatch(/^[a-zA-Z0-9_-]{1,100}$/); expect(JSON.stringify(error)).not.toContain(PRIVATE);
    expect(f.calls.filter(call => call.method === "wire-after-logout")).toHaveLength(1);
    expect(f.calls.filter(call => call.method === "app-after-logout")).toHaveLength(1);
    expect(f.facts.some(row => row.name === "provider-auth-revoked-session-denied")).toBe(false);
  });
  it.each([
    ["raw positive returns wrong user", { revokedWireBeforeWrongUser: true }],
    ["raw positive is not 200", { revokedWireBeforeStatus: 403 }],
    ["app positive denied", { revokedAppBeforeDenied: true }],
    ["JWT has insufficient remaining validity", { revokedShortLived: true }],
  ] as const)("requires revocation prerequisites: %s", async (_label, options) => {
    const f = fixture(options), error = await runProviderAuthMfa(f.runtime).catch(error => error as unknown) as ProviderRehearsalFailure;
    expect(error.code).toBe("auth-session-revoked"); expect(f.calls.some(call => call.method === "signOut")).toBe(false);
    expect(f.facts.some(row => row.name === "provider-auth-revoked-session-denied")).toBe(false);
  });
  it("drops private SDK error/cause details and performs no further cases", async () => {
    const f = fixture({ sdkThrow: true }), error = await runProviderAuthMfa(f.runtime).catch(error => error as unknown) as Error;
    expect(`${error.message}\n${error.stack}`).not.toContain(PRIVATE); expect(error).not.toHaveProperty("cause"); expect(f.facts).toEqual([]);
  });
});

describe("pinned SDK normalization through an offline fetch stub", () => {
  it.each([401, 403])("normalizes actual SDK input status %i session_not_found without exposing the wire status", async status => {
    let stubCalls = 0;
    const client = createClient("http://127.0.0.1:54321", "unit-only-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `unit-normalization-${status}` },
      global: { fetch: async input => {
        stubCalls++; expect(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname).toBe("/auth/v1/user");
        return new Response(JSON.stringify({ code: "session_not_found", message: PRIVATE }), { status, headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" } });
      } },
    });
    try {
      const result = await client.auth.getUser("unit.header.signature");
      expect(stubCalls).toBe(1); expect(result.data.user).toBeNull(); expect(result.error).toBeInstanceOf(AuthSessionMissingError);
      expect(result.error?.status).toBe(400); expect(result.error?.code).toBeUndefined(); expect(result.error?.name).toBe("AuthSessionMissingError");
    } finally { await client.auth.stopAutoRefresh(); await client.removeAllChannels(); }
  });
});
