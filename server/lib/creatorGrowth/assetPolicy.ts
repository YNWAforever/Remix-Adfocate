import { createHash } from "node:crypto";

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedImageMime =
  (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MIN_IMAGE_DIMENSION = 1;
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_OWNER_ID_LENGTH = 128;

export type DecodeAndStripMetadata = (
  bytes: Uint8Array,
) => Promise<{
  bytes: Uint8Array;
  mime: SupportedImageMime;
  width: number;
  height: number;
}>;

export type NormalizeImageAssetInput = {
  bytes: Uint8Array;
  declaredMime: string;
  ownerId: string;
  rightsConfirmed: boolean;
  approvedSha256?: string;
};

export type NormalizedImageAsset = {
  sha256: string;
  detectedMime: SupportedImageMime;
  byteSize: number;
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type AssetPolicyErrorCode =
  | "DECODER_FAILED"
  | "IMAGE_TOO_LARGE"
  | "INVALID_APPROVED_HASH"
  | "INVALID_DECODER_DIMENSIONS"
  | "INVALID_DECODER_OUTPUT"
  | "INVALID_IMAGE_STRUCTURE"
  | "INVALID_OWNER"
  | "METADATA_NOT_STRIPPED"
  | "MIME_MISMATCH"
  | "MIME_NOT_SUPPORTED"
  | "POST_APPROVAL_CONVERSION"
  | "POLYGLOT_IMAGE"
  | "RIGHTS_NOT_CONFIRMED";

export class AssetPolicyError extends Error {
  constructor(
    readonly code: AssetPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AssetPolicyError";
  }
}

export type ImagePayloadInspection = {
  detectedMime: SupportedImageMime;
  byteSize: number;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OWNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_IEND = Uint8Array.from([
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PDF_SIGNATURE = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d,
]);
const ZIP_SIGNATURE = Uint8Array.from([
  0x50, 0x4b, 0x03, 0x04,
]);
const HTML_SIGNATURE = Uint8Array.from([
  0x3c, 0x21, 0x64, 0x6f, 0x63, 0x74, 0x79, 0x70, 0x65,
]);
const SCRIPT_SIGNATURE = Uint8Array.from([
  0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74,
]);
const JPEG_SIGNATURE = Uint8Array.from([0xff, 0xd8, 0xff]);
const WEBP_RIFF_SIGNATURE = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46,
]);
const WEBP_FORMAT_SIGNATURE = Uint8Array.from([
  0x57, 0x45, 0x42, 0x50,
]);

function fail(
  code: AssetPolicyErrorCode,
  message: string,
): never {
  throw new AssetPolicyError(code, message);
}

function sequenceAt(
  bytes: Uint8Array,
  offset: number,
  sequence: Uint8Array,
): boolean {
  if (offset < 0 || offset + sequence.length > bytes.length) {
    return false;
  }
  return sequence.every(
    (expected, sequenceOffset) =>
      bytes[offset + sequenceOffset] === expected,
  );
}

function readUint32BigEndian(
  bytes: Uint8Array,
  offset: number,
): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    return -1;
  }
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readUint32LittleEndian(
  bytes: Uint8Array,
  offset: number,
): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    return -1;
  }
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

function containsSequenceAfterStart(
  bytes: Uint8Array,
  sequence: Uint8Array,
): boolean {
  for (
    let offset = 1;
    offset + sequence.length <= bytes.length;
    offset += 1
  ) {
    if (sequenceAt(bytes, offset, sequence)) {
      return true;
    }
  }
  return false;
}

function assertNoPolyglot(
  bytes: Uint8Array,
  detectedMime: SupportedImageMime,
): void {
  const secondarySignatures = [
    PDF_SIGNATURE,
    ZIP_SIGNATURE,
    HTML_SIGNATURE,
    SCRIPT_SIGNATURE,
    detectedMime === "image/jpeg" ? PNG_SIGNATURE : JPEG_SIGNATURE,
  ];
  if (
    secondarySignatures.some((signature) =>
      containsSequenceAfterStart(bytes, signature),
    )
  ) {
    fail(
      "POLYGLOT_IMAGE",
      "The image contains a second executable or document container.",
    );
  }
}

function jpegHasMetadata(bytes: Uint8Array): boolean {
  let markerOffset = 2;
  while (markerOffset < bytes.length - 2) {
    if (bytes[markerOffset] !== 0xff) {
      fail("INVALID_IMAGE_STRUCTURE", "The JPEG marker structure is invalid.");
    }
    let codeOffset = markerOffset + 1;
    while (bytes[codeOffset] === 0xff) {
      codeOffset += 1;
    }
    const marker = bytes[codeOffset];
    if (marker === undefined) {
      fail("INVALID_IMAGE_STRUCTURE", "The JPEG marker is truncated.");
    }
    if (marker === 0xda) {
      return false;
    }
    if (marker === 0xd9) {
      return false;
    }
    if (
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd8)
    ) {
      markerOffset = codeOffset + 1;
      continue;
    }
    const lengthOffset = codeOffset + 1;
    const segmentLength = (
      bytes[lengthOffset] * 0x100 +
      bytes[lengthOffset + 1]
    );
    if (
      !Number.isFinite(segmentLength) ||
      segmentLength < 2 ||
      lengthOffset + segmentLength > bytes.length - 2
    ) {
      fail("INVALID_IMAGE_STRUCTURE", "The JPEG segment is truncated.");
    }
    if (marker === 0xe1 || marker === 0xfe) {
      return true;
    }
    markerOffset = lengthOffset + segmentLength;
  }
  return false;
}

function validateJpeg(bytes: Uint8Array): boolean {
  if (
    bytes.length < 4 ||
    !sequenceAt(bytes, 0, JPEG_SIGNATURE) ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    fail("INVALID_IMAGE_STRUCTURE", "The JPEG structure is invalid.");
  }
  return jpegHasMetadata(bytes);
}

function validatePng(bytes: Uint8Array): boolean {
  if (
    bytes.length < 20 ||
    !sequenceAt(bytes, 0, PNG_SIGNATURE) ||
    !sequenceAt(bytes, bytes.length - PNG_IEND.length, PNG_IEND)
  ) {
    fail("INVALID_IMAGE_STRUCTURE", "The PNG structure is invalid.");
  }

  let hasMetadata = false;
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const chunkLength = readUint32BigEndian(bytes, offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkLength < 0 || chunkEnd > bytes.length) {
      fail("INVALID_IMAGE_STRUCTURE", "The PNG chunk is truncated.");
    }
    const chunkType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    if (["eXIf", "iTXt", "tEXt", "zTXt"].includes(chunkType)) {
      hasMetadata = true;
    }
    if (chunkType === "IEND") {
      if (chunkEnd !== bytes.length) {
        fail(
          "INVALID_IMAGE_STRUCTURE",
          "The PNG contains trailing container data.",
        );
      }
      return hasMetadata;
    }
    offset = chunkEnd;
  }
  fail("INVALID_IMAGE_STRUCTURE", "The PNG end marker is missing.");
}

function validateWebp(bytes: Uint8Array): boolean {
  if (
    bytes.length < 20 ||
    !sequenceAt(bytes, 0, WEBP_RIFF_SIGNATURE) ||
    !sequenceAt(bytes, 8, WEBP_FORMAT_SIGNATURE)
  ) {
    fail("INVALID_IMAGE_STRUCTURE", "The WebP structure is invalid.");
  }
  const declaredSize = readUint32LittleEndian(bytes, 4);
  if (declaredSize < 12 || declaredSize + 8 !== bytes.length) {
    fail("INVALID_IMAGE_STRUCTURE", "The WebP container length is invalid.");
  }

  let hasMetadata = false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = readUint32LittleEndian(bytes, offset + 4);
    const chunkEnd = offset + 8 + chunkLength + (chunkLength % 2);
    if (chunkLength < 0 || chunkEnd > bytes.length) {
      fail("INVALID_IMAGE_STRUCTURE", "The WebP chunk is truncated.");
    }
    const chunkType = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    if (chunkType === "EXIF" || chunkType === "XMP ") {
      hasMetadata = true;
    }
    offset = chunkEnd;
  }
  if (offset !== bytes.length) {
    fail("INVALID_IMAGE_STRUCTURE", "The WebP contains trailing data.");
  }
  return hasMetadata;
}

export function detectImageMime(
  bytes: Uint8Array,
): SupportedImageMime | null {
  if (sequenceAt(bytes, 0, JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  if (sequenceAt(bytes, 0, PNG_SIGNATURE)) {
    return "image/png";
  }
  if (
    sequenceAt(bytes, 0, WEBP_RIFF_SIGNATURE) &&
    sequenceAt(bytes, 8, WEBP_FORMAT_SIGNATURE)
  ) {
    return "image/webp";
  }
  return null;
}

export function isSupportedImageMime(
  value: unknown,
): value is SupportedImageMime {
  return (
    typeof value === "string" &&
    SUPPORTED_IMAGE_MIME_TYPES.includes(value as SupportedImageMime)
  );
}

export function inspectImagePayload(
  bytes: Uint8Array,
  options: { requireSanitized?: boolean } = {},
): ImagePayloadInspection {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    fail("INVALID_IMAGE_STRUCTURE", "The image payload is empty.");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    fail("IMAGE_TOO_LARGE", "The image exceeds the local pilot size limit.");
  }
  const detectedMime = detectImageMime(bytes);
  if (detectedMime === null) {
    fail("INVALID_IMAGE_STRUCTURE", "The image format is not supported.");
  }

  assertNoPolyglot(bytes, detectedMime);
  let hasMetadata = false;
  if (detectedMime === "image/jpeg") {
    hasMetadata = validateJpeg(bytes);
  } else if (detectedMime === "image/png") {
    hasMetadata = validatePng(bytes);
  } else {
    hasMetadata = validateWebp(bytes);
  }
  if (options.requireSanitized === true && hasMetadata) {
    fail(
      "METADATA_NOT_STRIPPED",
      "The decoder output still contains unneeded image metadata.",
    );
  }
  return {
    detectedMime,
    byteSize: bytes.length,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateOwnerId(ownerId: string): void {
  if (
    typeof ownerId !== "string" ||
    ownerId.length > MAX_OWNER_ID_LENGTH ||
    !OWNER_ID_PATTERN.test(ownerId)
  ) {
    fail("INVALID_OWNER", "The asset owner identifier is invalid.");
  }
}

function validateDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < MIN_IMAGE_DIMENSION ||
    height < MIN_IMAGE_DIMENSION ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    fail(
      "INVALID_DECODER_DIMENSIONS",
      "The sanitized image dimensions exceed the local pilot limits.",
    );
  }
}

export async function normalizeImageAsset(
  input: NormalizeImageAssetInput,
  deps: { decodeAndStripMetadata: DecodeAndStripMetadata },
): Promise<NormalizedImageAsset> {
  validateOwnerId(input.ownerId);
  if (input.rightsConfirmed !== true) {
    fail(
      "RIGHTS_NOT_CONFIRMED",
      "The creator must confirm rights to the uploaded image.",
    );
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) {
    fail("INVALID_IMAGE_STRUCTURE", "The uploaded image is empty.");
  }
  if (input.bytes.length > MAX_IMAGE_BYTES) {
    fail("IMAGE_TOO_LARGE", "The uploaded image exceeds the local pilot limit.");
  }
  if (!isSupportedImageMime(input.declaredMime)) {
    fail("MIME_NOT_SUPPORTED", "Use a JPEG, PNG, or WebP image.");
  }
  const inputInspection = inspectImagePayload(input.bytes);
  if (inputInspection.detectedMime !== input.declaredMime) {
    fail(
      "MIME_MISMATCH",
      "The declared image type does not match the detected bytes.",
    );
  }
  if (typeof deps.decodeAndStripMetadata !== "function") {
    fail(
      "DECODER_FAILED",
      "A trusted local decoder is required before image storage.",
    );
  }

  let decoded: Awaited<ReturnType<DecodeAndStripMetadata>>;
  try {
    decoded = await deps.decodeAndStripMetadata(
      new Uint8Array(input.bytes),
    );
  } catch {
    fail(
      "DECODER_FAILED",
      "The trusted local decoder could not sanitize the image.",
    );
  }

  if (
    decoded === null ||
    typeof decoded !== "object" ||
    !(decoded.bytes instanceof Uint8Array) ||
    !isSupportedImageMime(decoded.mime)
  ) {
    fail(
      "INVALID_DECODER_OUTPUT",
      "The trusted decoder returned an invalid image.",
    );
  }
  let outputInspection: ImagePayloadInspection;
  try {
    outputInspection = inspectImagePayload(decoded.bytes, {
      requireSanitized: true,
    });
  } catch (error) {
    if (
      error instanceof AssetPolicyError &&
      error.code === "METADATA_NOT_STRIPPED"
    ) {
      throw error;
    }
    fail(
      "INVALID_DECODER_OUTPUT",
      "The trusted decoder returned unsupported image bytes.",
    );
  }
  if (decoded.mime !== outputInspection.detectedMime) {
    fail(
      "INVALID_DECODER_OUTPUT",
      "The trusted decoder reported the wrong image type.",
    );
  }
  validateDimensions(decoded.width, decoded.height);

  const sanitizedBytes = new Uint8Array(decoded.bytes);
  const digest = sha256Hex(sanitizedBytes);
  if (input.approvedSha256 !== undefined) {
    if (!SHA256_PATTERN.test(input.approvedSha256)) {
      fail("INVALID_APPROVED_HASH", "The approved image digest is invalid.");
    }
    if (digest !== input.approvedSha256) {
      fail(
        "POST_APPROVAL_CONVERSION",
        "The sanitized bytes no longer match the approved mission digest.",
      );
    }
  }

  return {
    sha256: digest,
    detectedMime: outputInspection.detectedMime,
    byteSize: sanitizedBytes.length,
    bytes: sanitizedBytes,
    width: decoded.width,
    height: decoded.height,
  };
}
