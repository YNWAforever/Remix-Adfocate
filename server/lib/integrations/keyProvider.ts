import { CredentialVault, type EncryptedEnvelope } from "./credentials.js";
import { IntegrationError } from "./policy.js";

/** The secret store is provided by the host; construction never reads a remote vault. */
export interface IntegrationKeySource {
  activeKeyId(): Promise<string>;
  key(id: string): Promise<Uint8Array | null>;
}
export interface CredentialStore {
  seal(value: unknown, identity: string): Promise<EncryptedEnvelope>;
  open<T>(envelope: EncryptedEnvelope, identity: string): Promise<T>;
}

/** A restart-safe key ring, obtained explicitly from an approved server secret. */
export function keySourceFromSecret(secret: string | undefined): IntegrationKeySource {
  try {
    if (!secret || secret.length > 16000) throw new Error();
    const parsed = JSON.parse(secret) as {activeKeyId: string; keys: Record<string,string>};
    if (!parsed || typeof parsed.activeKeyId !== "string" || !parsed.keys || Array.isArray(parsed.keys)) throw new Error();
    const keys = new Map<string,Uint8Array>();
    for (const [id, encoded] of Object.entries(parsed.keys)) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error();
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      if (bytes.length !== 32) throw new Error();
      keys.set(id,bytes);
    }
    if (!keys.size || keys.size > 10 || !keys.has(parsed.activeKeyId)) throw new Error();
    return { activeKeyId: async()=>parsed.activeKeyId, key:async id=>keys.has(id)?Uint8Array.from(keys.get(id)!):null };
  } catch { throw new IntegrationError("CREDENTIAL_UNAVAILABLE",503); }
}

export class RotatingCredentialVault implements CredentialStore {
  constructor(private readonly source: IntegrationKeySource) {}
  private async vault(id: string): Promise<CredentialVault> {
    try {
      const bytes = await this.source.key(id);
      if (!bytes || bytes.length !== 32) throw new Error();
      return new CredentialVault(bytes,id);
    } catch { throw new IntegrationError("CREDENTIAL_UNAVAILABLE",503); }
  }
  async seal(value: unknown, identity: string) {
    try { return await (await this.vault(await this.source.activeKeyId())).seal(value,identity); }
    catch { throw new IntegrationError("CREDENTIAL_UNAVAILABLE",503); }
  }
  async open<T>(envelope: EncryptedEnvelope, identity: string): Promise<T> {
    try { return await (await this.vault(envelope.keyId)).open<T>(envelope,identity); }
    catch { throw new IntegrationError("CREDENTIAL_UNAVAILABLE",503); }
  }
  async rewrap(envelope: EncryptedEnvelope, identity: string): Promise<EncryptedEnvelope> {
    return this.seal(await this.open(envelope,identity),identity);
  }
}
