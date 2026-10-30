import { describe, expect, it } from "vitest";
import { CONTENT_MEDIA_MAX_BYTES, checkContentMedia } from "./contentMedia";

const bytes = (...head: number[]) => new Uint8Array([...head, ...new Array(16).fill(0)]);

describe("checkContentMedia", () => {
  it("accepts PNG, JPEG, GIF and WebP by magic bytes and derives the extension", () => {
    expect(checkContentMedia(bytes(0x89, 0x50, 0x4e, 0x47))).toEqual({ ok: true, contentType: "image/png", ext: "png" });
    expect(checkContentMedia(bytes(0xff, 0xd8, 0xff))).toMatchObject({ ok: true, contentType: "image/jpeg", ext: "jpg" });
    expect(checkContentMedia(bytes(0x47, 0x49, 0x46, 0x38))).toMatchObject({ ok: true, ext: "gif" });
    expect(checkContentMedia(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toMatchObject({ ok: true, ext: "webp" });
  });

  it("rejects HTML and SVG regardless of declared type or filename", () => {
    const enc = new TextEncoder();
    expect(checkContentMedia(enc.encode("<script>alert(1)</script>"))).toEqual({ ok: false, code: "media_type_not_allowed" });
    expect(checkContentMedia(enc.encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toEqual({ ok: false, code: "media_type_not_allowed" });
  });

  it("rejects empty and oversized files", () => {
    expect(checkContentMedia(new Uint8Array())).toEqual({ ok: false, code: "media_empty" });
    const big = new Uint8Array(CONTENT_MEDIA_MAX_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    expect(checkContentMedia(big)).toEqual({ ok: false, code: "media_too_large" });
  });
});
