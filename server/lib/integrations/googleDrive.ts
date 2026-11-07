import { digest } from "./credentials.js";
import { IntegrationError, MAX_FILE_BYTES, MAX_SOURCE_CHARS, validateFile } from "./policy.js";
import type { ProviderFile, ProviderSnapshot } from "./types.js";

/** Receives provider-extracted text. Mock providers never fetch or parse a real file. */
export async function normalizeDriveFile(file: ProviderFile, now: Date): Promise<ProviderSnapshot> {
  validateFile(file);
  if (new TextEncoder().encode(file.content).byteLength > MAX_FILE_BYTES) throw new IntegrationError("FILE_TOO_LARGE");
  if (!file.content.trim() || file.content.includes("\u0000")) throw new IntegrationError("UNSUPPORTED_FILE");
  const chars = [...file.content];
  return { resourceId: file.externalId, title: file.title, sourceVersion: file.version,
    contentHash: await digest(JSON.stringify({ version: file.version, content: file.content })), fetchedAt: now.toISOString(), observedAt: now.toISOString(), period: null,
    coverage: { region: null, language: null, partial: chars.length > MAX_SOURCE_CHARS }, metrics: {}, excerpt: chars.slice(0, MAX_SOURCE_CHARS).join("") };
}
