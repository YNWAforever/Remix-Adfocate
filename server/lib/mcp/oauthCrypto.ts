import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENV_KEY = "MCP_OAUTH_ENCRYPTION_KEY";

function encryptionKey(): Buffer {
  const decoded = Buffer.from(process.env[ENV_KEY] ?? "", "base64");
  if (decoded.length !== KEY_BYTES) throw new Error("mcp_oauth_encryption_key_missing");
  return decoded;
}

export function encryptionConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/** AES-256-GCM; returns base64(iv | tag | ciphertext). Never log the output. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const payload = Buffer.from(encoded, "base64");
  if (payload.length <= IV_BYTES + TAG_BYTES) throw new Error("mcp_oauth_cipher_invalid");
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

/** PKCE (S256) verifier + challenge for one authorization attempt. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function oauthState(): string {
  return randomBytes(32).toString("base64url");
}
