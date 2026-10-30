// CMS media lands in a public bucket, so only real raster images are accepted. The declared
// MIME type and filename are attacker-controlled; the file's own magic bytes decide the type and
// the stored extension (never the uploaded name), which rules out HTML/SVG served as content.

export const CONTENT_MEDIA_MAX_BYTES = 5 * 1024 * 1024;

const SIGNATURES: Array<{ type: string; ext: string; match: (b: Uint8Array) => boolean }> = [
  { type: "image/png", ext: "png", match: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/jpeg", ext: "jpg", match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/gif", ext: "gif", match: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    type: "image/webp", ext: "webp",
    match: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

export type ContentMediaCheck =
  | { ok: true; contentType: string; ext: string }
  | { ok: false; code: "media_too_large" | "media_type_not_allowed" | "media_empty" };

export function checkContentMedia(bytes: Uint8Array): ContentMediaCheck {
  if (bytes.byteLength === 0) return { ok: false, code: "media_empty" };
  if (bytes.byteLength > CONTENT_MEDIA_MAX_BYTES) return { ok: false, code: "media_too_large" };
  const sig = SIGNATURES.find((s) => s.match(bytes));
  return sig ? { ok: true, contentType: sig.type, ext: sig.ext } : { ok: false, code: "media_type_not_allowed" };
}
