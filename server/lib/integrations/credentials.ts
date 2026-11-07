import { IntegrationError } from "./policy.js";

export type EncryptedEnvelope = { keyId: string; iv: string; ciphertext: string };
const encode = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
const decode = (value: string) => {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new IntegrationError("CREDENTIAL_UNAVAILABLE", 503);
  return Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
};
export async function digest(value: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
/** The production key provider is intentionally absent in the mock-only stage. */
export class CredentialVault {
  private key: Promise<CryptoKey>;
  constructor(bytes: Uint8Array, private keyId: string) {
    if (bytes.byteLength !== 32 || !keyId) throw new IntegrationError("CREDENTIAL_UNAVAILABLE", 503);
    this.key = crypto.subtle.importKey("raw", Uint8Array.from(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async seal(value: unknown, identity: string): Promise<EncryptedEnvelope> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(identity) }, await this.key, new TextEncoder().encode(JSON.stringify(value)));
    return { keyId: this.keyId, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
  }
  async open<T>(envelope: EncryptedEnvelope, identity: string): Promise<T> {
    try {
      if (envelope.keyId !== this.keyId) throw new Error();
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv), additionalData: new TextEncoder().encode(identity) }, await this.key, decode(envelope.ciphertext));
      return JSON.parse(new TextDecoder().decode(plaintext)) as T;
    } catch { throw new IntegrationError("CREDENTIAL_UNAVAILABLE", 503); }
  }
}
