// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { verifyGoogleIdentityToken } from "./googleIdentity.js";

const now = new Date("2026-10-31T00:00:00Z"), seconds = now.getTime()/1000;
let pair: CryptoKeyPair, jwk: JsonWebKey;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function token(changes: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const body = `${encode({alg:"RS256",kid:"fixture-key",...header})}.${encode({iss:"https://accounts.google.com",aud:"pilot-client",sub:"google-subject",nonce:"expected-nonce",iat:seconds,exp:seconds+3600,...changes})}`;
  return `${body}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",pair.privateKey,new TextEncoder().encode(body))).toString("base64url")}`;
}
beforeAll(async () => {
  pair = await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey("jwk",pair.publicKey);
});
describe("Google account identity binding", () => {
  const expected = {clientId:"pilot-client",nonce:"expected-nonce"};
  it("verifies an actual signed ID token with a trusted injected key resolver", async () => {
    const resolve = vi.fn(async (kid: string) => kid === "fixture-key" ? jwk : null);
    expect(await verifyGoogleIdentityToken(await token(),expected,resolve,now)).toEqual({subject:"google-subject"});
    expect(resolve).toHaveBeenCalledWith("fixture-key");
  });
  it.each([{nonce:"different"},{aud:"another-client"},{iss:"https://evil.example"},{exp:seconds},{iat:seconds+1000},{sub:""},{aud:["pilot-client","other"],azp:"other"}])("rejects wrong claims %j", async changes => {
    await expect(verifyGoogleIdentityToken(await token(changes),expected,async()=>jwk,now)).rejects.toThrow("OAUTH_IDENTITY_INVALID");
  });
  it("rejects tampering, algorithm substitution and untrusted key locations", async () => {
    const signed = await token();
    for (const invalid of [signed.slice(0,-8)+"AAAAAAAA",await token({}, {alg:"none"}),await token({}, {jku:"https://evil.example/keys"}),"bad.token",signed+"x".repeat(20000)]) {
      await expect(verifyGoogleIdentityToken(invalid,expected,async()=>jwk,now)).rejects.toThrow("OAUTH_IDENTITY_INVALID");
    }
    await expect(verifyGoogleIdentityToken(signed,expected,async()=>null,now)).rejects.toThrow("OAUTH_IDENTITY_INVALID");
  });
});
