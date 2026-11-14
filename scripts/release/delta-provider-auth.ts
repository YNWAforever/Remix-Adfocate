import { createHmac } from "node:crypto";
import { ProviderRehearsalFailure, requireProviderFact, type ProviderActor, type ProviderCaseResult, type ProviderRehearsalRuntime } from "./delta-provider-contracts";

// Import is inert. Only the owned runtime supplies clients and actual HTTP.
// No credentials, raw SDK objects, JWTs, TOTP secrets/codes or app bodies leave
// this module. record() receives selected private facts, never credential bytes.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CREATOR_PATH = "/api/missions/my";
const ADMIN_ME = "/api/admin/me";
type JwtClaims = { sub: string; iss: string; exp: number; session_id: string; aal: string; role: string; aud: string | string[] };
type PrivateObject = Record<string, unknown>;

/** RFC 6238 SHA1 / 30-second / six-digit code. The caller retains the secret only in RAM. */
export function providerTotpCode(secret: string, epochMilliseconds: number): string {
  let key: Buffer | undefined, counter: Buffer | undefined, mac: Buffer | undefined;
  const decoded: number[] = [];
  try {
    requireProviderFact(typeof secret === "string" && /^[A-Z2-7]{16,128}$/.test(secret), "auth-totp-input");
    requireProviderFact(Number.isSafeInteger(epochMilliseconds) && epochMilliseconds >= 0, "auth-totp-input");
    let bits = 0, accumulator = 0;
    for (const character of secret) {
      accumulator = (accumulator << 5) | BASE32.indexOf(character); bits += 5;
      if (bits >= 8) { bits -= 8; decoded.push((accumulator >>> bits) & 255); }
      accumulator &= (1 << bits) - 1;
    }
    requireProviderFact(accumulator === 0 && decoded.length >= 10, "auth-totp-input");
    key = Buffer.from(decoded); decoded.fill(0);
    counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(epochMilliseconds / 30_000)));
    mac = createHmac("sha1", key).update(counter).digest(); const offset = mac[mac.length - 1]! & 15;
    const value = mac.readUInt32BE(offset) & 0x7fffffff;
    return String(value % 1_000_000).padStart(6, "0");
  } catch { throw new ProviderRehearsalFailure("auth-totp-input"); }
  finally { decoded.fill(0); key?.fill(0); counter?.fill(0); mac?.fill(0); }
}
function claims(token: string): JwtClaims {
  requireProviderFact(typeof token === "string" && token.length <= 16_384, "auth-token-shape");
  const parts = token.split(".");
  requireProviderFact(parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part)), "auth-token-shape");
  const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as PrivateObject;
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as PrivateObject;
  requireProviderFact(header && ["HS256", "ES256", "RS256"].includes(String(header.alg)) && payload && typeof payload === "object", "auth-token-shape");
  requireProviderFact(typeof payload.sub === "string" && UUID.test(payload.sub) && typeof payload.iss === "string"
    && Number.isSafeInteger(payload.exp) && typeof payload.session_id === "string" && UUID.test(payload.session_id)
    && ["aal1", "aal2"].includes(String(payload.aal)) && payload.role === "authenticated"
    && (payload.aud === "authenticated" || Array.isArray(payload.aud) && payload.aud.includes("authenticated")), "auth-token-shape");
  return payload as unknown as JwtClaims;
}
function localOrigin(raw: string): string {
  const url = new URL(raw);
  requireProviderFact(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) && url.origin === raw, "auth-owned-origin");
  return url.origin;
}
function signatureTamper(token: string): string {
  const parts = token.split("."), signature = Buffer.from(parts[2]!, "base64url");
  try {
    requireProviderFact(signature.length > 0, "auth-token-shape"); signature[0] = signature[0]! ^ 1;
    return `${parts[0]}.${parts[1]}.${signature.toString("base64url")}`;
  } finally { signature.fill(0); }
}
async function body(response: Response): Promise<PrivateObject> {
  const value: unknown = await response.json();
  requireProviderFact(value && typeof value === "object" && !Array.isArray(value), "auth-app-response");
  return value as PrivateObject;
}
type ProviderUserResult = { data: { user: unknown }; error: { status?: number; code?: string; name?: string } | null };
function deniedProvider(result: ProviderUserResult, code?: string): boolean {
  return !result.data.user && Boolean(result.error) && [401, 403].includes(result.error?.status ?? 0)
    && (code === undefined || result.error?.code === code);
}
function diagnosticStatus(status: unknown): string {
  // Zero means absent/invalid metadata, never a claimed HTTP response.
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : "0";
}
function providerCode(code: unknown): string {
  return typeof code === "string" && ["session_not_found", "bad_jwt", "user_not_found", "no_authorization", "session_expired", "unexpected_failure", "malformed"].includes(code)
    ? code : code === undefined ? "missing" : "other";
}
function sdkDiagnostic(provider: ProviderUserResult) {
  // "ok" is SDK success, not a fabricated wire status. smiss denotes the SDK
  // AuthSessionMissingError normalization (status 400/code absent in 2.108.1).
  const status = provider.error ? diagnosticStatus(provider.error.status) : provider.data.user ? "ok" : "empty";
  const code = !provider.error ? "none" : provider.error.name === "AuthSessionMissingError" ? "smiss"
    : ({ session_not_found: "snf", bad_jwt: "bjwt", user_not_found: "unf", no_authorization: "nauth", session_expired: "sexp", unexpected_failure: "fail" } as Record<string, string>)[providerCode(provider.error.code)] ?? providerCode(provider.error.code);
  return { status, code };
}
function revocationDiagnostic(wireStatus: number, wireCode: unknown, sdk: ProviderUserResult, appStatus: number, appCode: unknown): string {
  const normalized = sdkDiagnostic(sdk);
  const safeAppCode = appCode === "WORKSPACE_MEMBERSHIP_REQUIRED" ? "membership" : appCode === "owned_http_refusal" ? "http_refusal"
    : typeof appCode === "string" && ["bad_token", "no_auth", "forbidden", "mfa_required", "malformed"].includes(appCode) ? appCode : appCode === undefined ? "missing" : "other";
  return `w${diagnosticStatus(wireStatus)}-${providerCode(wireCode)}-s${normalized.status}-${normalized.code}-a${diagnosticStatus(appStatus)}-${safeAppCode}`;
}

/** Actual provider Auth/MFA and real app HTTP, not an application test injection. */
export async function runProviderAuthMfa(runtime: ProviderRehearsalRuntime): Promise<ProviderCaseResult[]> {
  let failure = "auth-runtime-prerequisite";
  const results: ProviderCaseResult[] = [];
  try {
    await runtime.assertOwned(); const issuer = `${localOrigin(runtime.apiOrigin)}/auth/v1`; localOrigin(runtime.appOrigin);
    requireProviderFact(UUID.test(runtime.workspaceId) && UUID.test(runtime.otherWorkspaceId) && runtime.workspaceId !== runtime.otherWorkspaceId, failure);
    const actors = Object.values(runtime.actors);
    requireProviderFact(actors.length === 7 && new Set(actors.map(actor => actor.id)).size === 7 && actors.every(actor => UUID.test(actor.id)), failure);
    const protectedAdmin = `/api/admin/missions?workspace=${encodeURIComponent(runtime.workspaceId)}`;
    async function verified(actor: ProviderActor, requiredAal?: "aal1" | "aal2") {
      // Reading unverified claims is never used as a substitute for this actual
      // Auth server request. The owned SDK fetch counter must increase.
      const before = runtime.httpRequests, answer = await actor.client.auth.getUser(actor.accessToken);
      requireProviderFact(!answer.error && answer.data.user?.id === actor.id && runtime.httpRequests > before, failure);
      const jwt = claims(actor.accessToken);
      requireProviderFact(jwt.sub === actor.id && jwt.iss === issuer && jwt.exp * 1000 > Date.now() && (!requiredAal || jwt.aal === requiredAal), failure);
      return jwt;
    }
    async function run(name: string, code: string, work: () => Promise<unknown>) {
      failure = code; await runtime.assertOwned(); const before = runtime.httpRequests;
      const facts = await work(); requireProviderFact(runtime.httpRequests > before, code);
      results.push(runtime.record(name, facts, before));
    }
    async function staffMe(actor: ProviderActor, pending: boolean) {
      const response = await runtime.request(actor, ADMIN_ME), value = await body(response);
      const staff = value.staff as PrivateObject | undefined;
      requireProviderFact(response.status === 200 && value.mfa_required === pending && staff?.userId === actor.id, failure);
      return { status: response.status, mfaRequired: value.mfa_required };
    }
    async function promote(actor: ProviderActor, label: string) {
      const initial = await verified(actor, "aal1"); await staffMe(actor, true);
      const blocked = await runtime.request(actor, protectedAdmin), blockedBody = await body(blocked);
      requireProviderFact(blocked.status === 403 && blockedBody.code === "mfa_required", failure);
      await runtime.assertOwned(); const enrolled = await actor.client.auth.mfa.enroll({ factorType: "totp", friendlyName: `owned-${runtime.runId}-${label}`, issuer: "KOCmax owned rehearsal" });
      requireProviderFact(!enrolled.error && enrolled.data?.type === "totp" && UUID.test(enrolled.data.id) && typeof enrolled.data.totp.secret === "string", failure);
      const factorId = enrolled.data.id;
      await runtime.assertOwned(); const challenged = await actor.client.auth.mfa.challenge({ factorId });
      requireProviderFact(!challenged.error && challenged.data && UUID.test(challenged.data.id), failure);
      const code = providerTotpCode(enrolled.data.totp.secret, Date.now());
      await runtime.assertOwned(); const checked = await actor.client.auth.mfa.verify({ factorId, challengeId: challenged.data.id, code });
      requireProviderFact(!checked.error && checked.data && typeof checked.data.access_token === "string" && checked.data.access_token !== actor.accessToken, failure);
      actor.accessToken = checked.data.access_token;
      const elevated = await verified(actor, "aal2"), listed = await actor.client.auth.mfa.listFactors();
      requireProviderFact(!listed.error && listed.data.totp.some(factor => factor.id === factorId && factor.status === "verified"), failure);
      await staffMe(actor, false);
      return { actorId: actor.id, originalSession: initial.session_id, elevatedSession: elevated.session_id, originalAal: initial.aal,
        elevatedAal: elevated.aal, providerFactorVerified: true, aal1Denied: blocked.status, meAal2MfaRequired: false };
    }

    await run("provider-auth-issued-session", "auth-issued-session", async () => {
      const jwt = await verified(runtime.actors.creator, "aal1"), response = await runtime.request(runtime.actors.creator, CREATOR_PATH), value = await body(response);
      requireProviderFact(response.status === 200 && Array.isArray(value.submissions), failure);
      return { actorId: runtime.actors.creator.id, issuer: jwt.iss, sessionId: jwt.session_id, providerAuthenticated: true, appStatus: response.status };
    });
    await run("provider-auth-fabricated-token-denied", "auth-fabricated-token", async () => {
      await verified(runtime.actors.creator); const altered = signatureTamper(runtime.actors.creator.accessToken);
      const rejected = await runtime.actors.creator.client.auth.getUser(altered);
      requireProviderFact(deniedProvider(rejected, "bad_jwt"), failure);
      const response = await runtime.request({ ...runtime.actors.creator, accessToken: altered }, CREATOR_PATH), value = await body(response);
      requireProviderFact(response.status === 401 && value.code === "bad_token", failure);
      return { providerDenied: true, appStatus: response.status, appCode: value.code, signatureByteChanged: true };
    });
    await run("auth-owned-trusted-expired-token-denied", "auth-owned-expired-token", async () => {
      const actor = runtime.actors.creator, original = await verified(actor);
      await runtime.assertOwned(); const expired = await runtime.expiredSignedAccessToken(actor), expiredClaims = claims(expired);
      requireProviderFact(expired !== actor.accessToken && expiredClaims.sub === actor.id && expiredClaims.iss === issuer
        && expiredClaims.session_id === original.session_id && expiredClaims.exp * 1000 <= Date.now() - 30_000, failure);
      const rejected = await actor.client.auth.getUser(expired); requireProviderFact(deniedProvider(rejected, "bad_jwt"), failure);
      const response = await runtime.request({ ...actor, accessToken: expired }, CREATOR_PATH), value = await body(response);
      requireProviderFact(response.status === 401 && value.code === "bad_token", failure);
      return { signer: "owned-local-provider-key", providerIssued: false, originalSessionAuthenticated: true,
        expiredByAtLeastSeconds: 30, providerDenied: true, appStatus: response.status, appCode: value.code };
    });
    await run("provider-auth-anonymous-denied", "auth-anonymous", async () => {
      const response = await runtime.request(null, CREATOR_PATH), value = await body(response);
      requireProviderFact(response.status === 401 && value.code === "no_auth", failure);
      return { appStatus: response.status, appCode: value.code };
    });
    await run("provider-auth-creator-cross-tenant-denied", "auth-creator-tenant", async () => {
      const actor = runtime.actors.otherCreator; await verified(actor);
      const row = await runtime.service.from("creators").select("id,workspace_id").eq("id", actor.id).single();
      requireProviderFact(!row.error && row.data?.id === actor.id && row.data.workspace_id === runtime.workspaceId, failure);
      const foreign = await runtime.service.from("workspaces").select("id,slug").eq("id", runtime.otherWorkspaceId).single();
      requireProviderFact(!foreign.error && foreign.data?.id === runtime.otherWorkspaceId && typeof foreign.data.slug === "string"
        && foreign.data.slug.length > 0 && foreign.data.slug !== runtime.workspaceSlug, failure);
      const positive = await runtime.request(actor, CREATOR_PATH), positiveBody = await body(positive);
      requireProviderFact(positive.status === 200 && Array.isArray(positiveBody.submissions), failure);
      const response = await runtime.request(actor, CREATOR_PATH, { headers: { "X-Workspace-Slug": foreign.data.slug } }), value = await body(response);
      requireProviderFact(response.status === 403 && value.code === "forbidden", failure);
      return { primaryCreatorFixturePresent: true, knownForeignWorkspacePresent: true, validPrimaryStatus: positive.status,
        appStatus: response.status, appCode: value.code };
    });
    await run("provider-auth-staff-totp-aal2", "auth-staff-mfa", async () => {
      const facts = await promote(runtime.actors.staff, "staff"), allowed = await runtime.request(runtime.actors.staff, protectedAdmin);
      requireProviderFact(allowed.status === 200, failure); return { ...facts, scopedAdminAal2Status: allowed.status };
    });
    for (const label of ["operator", "reviewer", "noMembership"] as const) {
      const publicLabel = label === "noMembership" ? "no-membership" : label;
      await run(`provider-auth-${publicLabel}-totp-aal2`, `auth-${publicLabel}-mfa`, () => promote(runtime.actors[label], label));
    }
    await run("provider-auth-staff-cross-tenant-denied", "auth-staff-tenant", async () => {
      await verified(runtime.actors.staff, "aal2");
      const response = await runtime.request(runtime.actors.staff, `/api/admin/missions?workspace=${encodeURIComponent(runtime.otherWorkspaceId)}`), value = await body(response);
      requireProviderFact(response.status === 404 && value.code === "NOT_FOUND", failure);
      return { aal: "aal2", appStatus: response.status, appCode: value.code };
    });
    await run("provider-auth-staff-no-membership-denied", "auth-staff-membership", async () => {
      const actor = runtime.actors.noMembership; await verified(actor, "aal2");
      const membership = await runtime.service.from("brand_users").select("user_id").eq("user_id", actor.id).eq("active", true).maybeSingle();
      requireProviderFact(!membership.error && membership.data === null, failure);
      const response = await runtime.request(actor, protectedAdmin), value = await body(response);
      requireProviderFact(response.status === 403 && value.code === "WORKSPACE_MEMBERSHIP_REQUIRED", failure);
      return { aal: "aal2", activeMembershipAbsent: true, appStatus: response.status, appCode: value.code };
    });
    await run("provider-auth-revoked-session-denied", "auth-session-revoked", async () => {
      const actor = runtime.actors.revoked, original = actor.accessToken, jwt = await verified(actor);
      requireProviderFact(jwt.exp * 1000 > Date.now() + 30_000, failure);
      const before = await runtime.request(actor, CREATOR_PATH), beforeBody = await body(before);
      requireProviderFact(before.status === 200 && Array.isArray(beforeBody.submissions), failure);
      const wireBefore = await runtime.providerUser(actor), wireBeforeBody = await body(wireBefore);
      requireProviderFact(wireBefore.status === 200 && wireBeforeBody.id === actor.id && actor.accessToken === original, failure);
      await runtime.assertOwned(); const logout = await actor.client.auth.signOut({ scope: "local" }); requireProviderFact(!logout.error, failure);
      requireProviderFact(actor.accessToken === original, failure);
      const sdk = await actor.client.auth.getUser(original), wire = await runtime.providerUser(actor);
      const response = await runtime.request({ ...actor, accessToken: original }, CREATOR_PATH);
      // Read both actual responses before judging either denial. Malformed bodies
      // retain only a fixed enum; SDK/body messages and credential bytes never escape.
      let wireValue: PrivateObject = { code: "malformed" }, value: PrivateObject = { code: "malformed" };
      try { wireValue = await body(wire); } catch { /* fixed malformed diagnostic */ }
      try { value = await body(response); } catch { /* fixed malformed diagnostic */ }
      const diagnostic = revocationDiagnostic(wire.status, wireValue.code, sdk, response.status, value.code);
      failure = `auth-revoked-provider-session-denial-${diagnostic}`;
      requireProviderFact([401, 403].includes(wire.status) && wireValue.code === "session_not_found" && jwt.exp * 1000 > Date.now(), failure);
      failure = `auth-revoked-app-session-denial-${diagnostic}`;
      requireProviderFact(response.status === 401 && value.code === "bad_token", failure);
      const normalized = sdkDiagnostic(sdk);
      return { validAppBefore: before.status, validProviderWireBefore: wireBefore.status, providerSessionMissing: true, jwtNotYetExpired: true,
        providerWireStatus: wire.status, providerWireCode: "session_not_found", sdkNormalizedStatus: normalized.status, sdkFixedCode: normalized.code,
        appStatus: response.status, appCode: value.code };
    });
    return results;
  } catch { throw new ProviderRehearsalFailure(failure); }
}
