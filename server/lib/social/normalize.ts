import type { SocialPlatform } from "./types";

export function normalizeHandle(platform: SocialPlatform, handle: string): string {
  const normalized = handle
    .trim()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^https?:\/\/(www\.)?threads\.net\/@?/, "");
  const firstSegment = normalized.split(/[/?#]/)[0] ?? "";
  const lowered = firstSegment.toLowerCase();
  if (!lowered) throw new Error(`empty_${platform}_handle`);
  return lowered;
}

export function profileUrlFor(platform: SocialPlatform, handle: string): string {
  const h = normalizeHandle(platform, handle);
  if (platform === "instagram") return `https://www.instagram.com/${h}/`;
  return `https://www.threads.net/@${h}`;
}
