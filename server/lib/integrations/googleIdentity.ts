import { IntegrationError } from "./policy.js";

export type GoogleIdentityExpectation = {clientId: string; nonce: string};
export type GoogleSigningKeyResolver = (kid: string) => Promise<JsonWebKey | null>;
const fail = (): never => { throw new IntegrationError("OAUTH_IDENTITY_INVALID",403); };
function bytes(value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return fail();
  return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=")),char=>char.charCodeAt(0));
}
function object(value: string): Record<string,unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes(value)));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail();
  return parsed as Record<string,unknown>;
}

/** Only the caller's trusted Google key resolver is used; token-supplied URLs never run. */
export async function verifyGoogleIdentityToken(token: string, expected: GoogleIdentityExpectation, resolve: GoogleSigningKeyResolver, now = new Date()): Promise<{subject:string}> {
  try {
    if (typeof token !== "string" || token.length > 16384 || !expected.clientId || !expected.nonce) return fail();
    const parts = token.split("."); if (parts.length !== 3) return fail();
    const header = object(parts[0]), claims = object(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 200 || header.jku || header.x5u || header.crit) return fail();
    const key = await resolve(header.kid);
    if (!key || key.kty !== "RSA" || (key.use && key.use !== "sig") || (key.alg && key.alg !== "RS256") || typeof key.n !== "string" || bytes(key.n).length < 256) return fail();
    const imported = await crypto.subtle.importKey("jwk",key,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",imported,bytes(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return fail();
    const seconds = now.getTime()/1000;
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!["https://accounts.google.com","accounts.google.com"].includes(String(claims.iss)) || !audience.includes(expected.clientId)
      || (audience.length > 1 && claims.azp !== expected.clientId) || (claims.azp !== undefined && claims.azp !== expected.clientId)
      || claims.nonce !== expected.nonce || typeof claims.sub !== "string" || !/^[a-zA-Z0-9_-]{1,255}$/.test(claims.sub)
      || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= seconds
      || typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > seconds+60 || claims.exp <= claims.iat) return fail();
    return {subject:claims.sub};
  } catch { return fail(); }
}
