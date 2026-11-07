import { describe, expect, it, vi } from "vitest";

import {
  AssetPolicyError,
  MAX_IMAGE_BYTES,
  normalizeImageAsset,
} from "./assetPolicy.js";

function bytesFromHex(hex: string): Uint8Array {
  const compact = hex.replace(/\s+/g, "");
  if (compact.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(compact)) {
    throw new Error("Test fixture must be an even-length hexadecimal string.");
  }
  return Uint8Array.from(compact.match(/../g) ?? [], (value) =>
    Number.parseInt(value, 16),
  );
}

const RAW_EXIF_JPEG = bytesFromHex(
  "ffd8 ffe1 0010 457869660000 0100000000000000 ffd9",
);
const SANITIZED_JPEG = bytesFromHex(
  "ffd8 ffe0 0010 4a46494600 010100000100010000 ffd9",
);
const PNG_IMAGE = bytesFromHex(
  "89504e470d0a1a0a 0000000d4948445200000001000000010804000000b51c0c02 " +
    "0000000b4944415478da6364f80f00010501012718e366 " +
    "0000000049454e44ae426082",
);
const PDF_MARKER = bytesFromHex("255044462d312e34");
const PNG_PDF_POLYGLOT = new Uint8Array([
  ...PNG_IMAGE.slice(0, 33),
  ...PDF_MARKER,
  ...PNG_IMAGE.slice(33),
]);
const PNG_WITH_TRAILING_CONTAINER = new Uint8Array([
  ...PNG_IMAGE,
  ...bytesFromHex("747261696c696e672d64617461"),
  ...PNG_IMAGE.slice(-12),
]);
const SANITIZED_JPEG_SHA256 =
  "d20f6ffd523b78a86cd2f916fa34af5d1918d75f7b142237c752ad6b254213ab";

describe("normalizeImageAsset", () => {
  it("hashes and returns only the decoder-sanitized preview bytes", async () => {
    const decodeAndStripMetadata = vi.fn(async () => ({
      bytes: SANITIZED_JPEG,
      mime: "image/jpeg" as const,
      width: 1080,
      height: 1350,
    }));

    const asset = await normalizeImageAsset(
      {
        bytes: RAW_EXIF_JPEG,
        declaredMime: "image/jpeg",
        ownerId: "creator-a",
        rightsConfirmed: true,
      },
      { decodeAndStripMetadata },
    );

    expect(decodeAndStripMetadata).toHaveBeenCalledOnce();
    expect(asset).toMatchObject({
      sha256: SANITIZED_JPEG_SHA256,
      detectedMime: "image/jpeg",
      byteSize: 22,
      width: 1080,
      height: 1350,
    });
    expect(Array.from(asset.bytes)).toEqual(Array.from(SANITIZED_JPEG));
    expect(Buffer.from(asset.bytes).includes("Exif")).toBe(false);
    expect(asset.sha256).not.toBe(
      "b96a3e3f1b46f490e48476fa13208dfb4391c0b7d3d934a55759225267c26b32",
    );
  });

  it.each([
    {
      name: "unsupported declared MIME",
      input: {
        bytes: PNG_IMAGE,
        declaredMime: "image/gif",
        ownerId: "creator-a",
        rightsConfirmed: true,
      },
      code: "MIME_NOT_SUPPORTED",
    },
    {
      name: "declared and detected MIME mismatch",
      input: {
        bytes: RAW_EXIF_JPEG,
        declaredMime: "image/png",
        ownerId: "creator-a",
        rightsConfirmed: true,
      },
      code: "MIME_MISMATCH",
    },
    {
      name: "polyglot payload",
      input: {
        bytes: PNG_PDF_POLYGLOT,
        declaredMime: "image/png",
        ownerId: "creator-a",
        rightsConfirmed: true,
      },
      code: "POLYGLOT_IMAGE",
    },
    {
      name: "missing owner",
      input: {
        bytes: PNG_IMAGE,
        declaredMime: "image/png",
        ownerId: " ",
        rightsConfirmed: true,
      },
      code: "INVALID_OWNER",
    },
  ] as const)("rejects $name before decoding", async ({ input, code }) => {
    const decodeAndStripMetadata = vi.fn(async () => ({
      bytes: PNG_IMAGE,
      mime: "image/png" as const,
      width: 1,
      height: 1,
    }));

    await expect(
      normalizeImageAsset(input, { decodeAndStripMetadata }),
    ).rejects.toMatchObject({
      name: "AssetPolicyError",
      code,
    });
    expect(decodeAndStripMetadata).not.toHaveBeenCalled();
  });

  it("rejects oversized input before decoding", async () => {
    const decodeAndStripMetadata = vi.fn(async () => ({
      bytes: PNG_IMAGE,
      mime: "image/png" as const,
      width: 1,
      height: 1,
    }));

    await expect(
      normalizeImageAsset(
        {
          bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
          declaredMime: "image/png",
          ownerId: "creator-a",
          rightsConfirmed: true,
        },
        { decodeAndStripMetadata },
      ),
    ).rejects.toMatchObject({
      name: "AssetPolicyError",
      code: "IMAGE_TOO_LARGE",
    });
    expect(decodeAndStripMetadata).not.toHaveBeenCalled();
  });

  it("rejects a PNG with a second payload after its first end marker", async () => {
    const decodeAndStripMetadata = vi.fn(async () => ({
      bytes: PNG_IMAGE,
      mime: "image/png" as const,
      width: 1,
      height: 1,
    }));

    await expect(
      normalizeImageAsset(
        {
          bytes: PNG_WITH_TRAILING_CONTAINER,
          declaredMime: "image/png",
          ownerId: "creator-a",
          rightsConfirmed: true,
        },
        { decodeAndStripMetadata },
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE_STRUCTURE" });
    expect(decodeAndStripMetadata).not.toHaveBeenCalled();
  });

  it("requires an explicit rights declaration before decoding", async () => {
    const decodeAndStripMetadata = vi.fn(async () => ({
      bytes: PNG_IMAGE,
      mime: "image/png" as const,
      width: 1,
      height: 1,
    }));

    await expect(
      normalizeImageAsset(
        {
          bytes: PNG_IMAGE,
          declaredMime: "image/png",
          ownerId: "creator-a",
          rightsConfirmed: false,
        },
        { decodeAndStripMetadata },
      ),
    ).rejects.toBeInstanceOf(AssetPolicyError);
    await expect(
      normalizeImageAsset(
        {
          bytes: PNG_IMAGE,
          declaredMime: "image/png",
          ownerId: "creator-a",
          rightsConfirmed: false,
        },
        { decodeAndStripMetadata },
      ),
    ).rejects.toMatchObject({ code: "RIGHTS_NOT_CONFIRMED" });
    expect(decodeAndStripMetadata).not.toHaveBeenCalled();
  });

  it("rejects a decoder that returns the original EXIF-bearing bytes", async () => {
    const decodeAndStripMetadata = vi.fn(async () => ({
      bytes: RAW_EXIF_JPEG,
      mime: "image/jpeg" as const,
      width: 1080,
      height: 1350,
    }));

    await expect(
      normalizeImageAsset(
        {
          bytes: RAW_EXIF_JPEG,
          declaredMime: "image/jpeg",
          ownerId: "creator-a",
          rightsConfirmed: true,
        },
        { decodeAndStripMetadata },
      ),
    ).rejects.toMatchObject({ code: "METADATA_NOT_STRIPPED" });
  });

  it("validates decoder dimensions against conservative pilot limits", async () => {
    const decodeAndStripMetadata = vi.fn(async () => ({
      bytes: PNG_IMAGE,
      mime: "image/png" as const,
      width: 0,
      height: 1,
    }));

    await expect(
      normalizeImageAsset(
        {
          bytes: PNG_IMAGE,
          declaredMime: "image/png",
          ownerId: "creator-a",
          rightsConfirmed: true,
        },
        { decodeAndStripMetadata },
      ),
    ).rejects.toMatchObject({ code: "INVALID_DECODER_DIMENSIONS" });
  });

  it("rejects decoder output with a different detected MIME", async () => {
    const decodeAndStripMetadata = vi.fn(async () => ({
      bytes: SANITIZED_JPEG,
      mime: "image/png" as const,
      width: 1080,
      height: 1350,
    }));

    await expect(
      normalizeImageAsset(
        {
          bytes: PNG_IMAGE,
          declaredMime: "image/png",
          ownerId: "creator-a",
          rightsConfirmed: true,
        },
        { decodeAndStripMetadata },
      ),
    ).rejects.toMatchObject({ code: "INVALID_DECODER_OUTPUT" });
  });

  it("refuses to alter a mission-approved sanitized hash", async () => {
    const decodeAndStripMetadata = vi.fn(async () => ({
      bytes: SANITIZED_JPEG,
      mime: "image/jpeg" as const,
      width: 1080,
      height: 1350,
    }));

    await expect(
      normalizeImageAsset(
        {
          bytes: RAW_EXIF_JPEG,
          declaredMime: "image/jpeg",
          ownerId: "creator-a",
          rightsConfirmed: true,
          approvedSha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        { decodeAndStripMetadata },
      ),
    ).rejects.toMatchObject({ code: "POST_APPROVAL_CONVERSION" });
  });
});
