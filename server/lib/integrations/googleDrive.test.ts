// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeDriveFile } from "./googleDrive.js";
import { MAX_FILE_BYTES, MAX_SOURCE_CHARS } from "./policy.js";
import type { ProviderFile } from "./types.js";

const now = new Date("2026-10-31T03:00:00.000Z");
function file(overrides: Partial<ProviderFile> = {}): ProviderFile {
  return { externalId: "mock-file", title: "文字示例", mimeType: "text/plain", version: "mock-v1", sizeBytes: 12,
    canDownload: true, rights: "owned", content: "mock excerpt", ...overrides };
}

describe("mock Drive extracted-text normalization", () => {
  it("accepts only the three extracted-text formats without claiming to parse a real PDF", async () => {
    for (const mimeType of ["application/vnd.google-apps.document", "text/plain", "application/pdf"]) {
      const result = await normalizeDriveFile(file({ mimeType }), now);
      expect(result).toMatchObject({ resourceId: "mock-file", excerpt: "mock excerpt", period: null,
        observedAt: now.toISOString(), fetchedAt: now.toISOString(), coverage: { region: null, language: null, partial: false } });
    }
  });

  it("keeps exactly 8000 Unicode code points and marks only the truncated excerpt partial", async () => {
    const content = "🧋".repeat(MAX_SOURCE_CHARS);
    const exact = await normalizeDriveFile(file({ content }), now);
    const truncated = await normalizeDriveFile(file({ content: `${content}茶` }), now);
    expect(exact.excerpt).toBe(content);
    expect(exact.coverage.partial).toBe(false);
    expect(truncated.excerpt).toBe(content);
    expect([...truncated.excerpt!]).toHaveLength(MAX_SOURCE_CHARS);
    expect(truncated.coverage.partial).toBe(true);
  });

  it("enforces the 5 MiB boundary on both declared size and actual UTF-8 text", async () => {
    const content = "🧋".repeat(MAX_FILE_BYTES / 4);
    await expect(normalizeDriveFile(file({ content, sizeBytes: MAX_FILE_BYTES }), now)).resolves.toMatchObject({ coverage: { partial: true } });
    await expect(normalizeDriveFile(file({ sizeBytes: MAX_FILE_BYTES + 1 }), now)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    await expect(normalizeDriveFile(file({ content: `${content}a`, sizeBytes: 1 }), now)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects a download denial before accepting an otherwise valid excerpt", async () => {
    await expect(normalizeDriveFile(file({ canDownload: false }), now)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 403 });
  });

  it.each(["application/vnd.google-apps.shortcut", "application/vnd.google-apps.folder", "application/vnd.google-apps.spreadsheet", "application/zip"])("rejects unsupported MIME %s", async mimeType => {
    await expect(normalizeDriveFile(file({ mimeType }), now)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
  });

  it("rejects empty text and a NUL even beyond the visible excerpt", async () => {
    await expect(normalizeDriveFile(file({ content: " \n\t" }), now)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(normalizeDriveFile(file({ content: `${"a".repeat(MAX_SOURCE_CHARS)}\u0000` }), now)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
  });

  it("detects changes beyond the excerpt using the complete content hash", async () => {
    const prefix = "a".repeat(MAX_SOURCE_CHARS);
    const first = await normalizeDriveFile(file({ content: `${prefix}first` }), now);
    const changed = await normalizeDriveFile(file({ content: `${prefix}changed` }), now);
    expect(changed.excerpt).toBe(first.excerpt);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });
});
