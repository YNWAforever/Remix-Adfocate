import type { SocialPlatform } from "./types";

export function normalizeHandle(platform: SocialPlatform, handle: string): string {
  const trimmed = handle.trim();
  const isInstagramUrl = /^https?:\/\/(www\.)?instagram\.com\//i.test(trimmed);
  const isThreadsUrl = /^https?:\/\/(www\.)?threads\.net\/@?/i.test(trimmed);

  if ((platform === "instagram" && isThreadsUrl) || (platform === "threads" && isInstagramUrl)) {
    throw new Error(`mismatched_${platform}_handle`);
  }

  const normalized = trimmed
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^https?:\/\/(www\.)?threads\.net\/@?/i, "");
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
