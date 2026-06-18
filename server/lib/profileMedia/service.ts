import { randomUUID } from "node:crypto";
import {
  ALLOWED_AVATAR_MIME_TYPES,
  MAX_AVATAR_BYTES,
  PLATFORM_TYPES,
  type AvatarMimeType,
  type AvatarUploadRequest,
  type PortfolioPlatformType,
  type ProfileCompleteness,
  type ProfileMediaLink,
  type PublicProfileHighlight,
} from "./types";

export class ProfileMediaError extends Error {
  constructor(
    public code:
      | "bad_url"
      | "bad_title"
      | "bad_platform_type"
      | "bad_avatar_type"
      | "bad_avatar_size"
      | "bad_avatar_path"
      | "highlight_limit"
      | "not_found"
      | "db_error",
    message: string = code,
  ) {
    super(message);
    this.name = "ProfileMediaError";
  }
}

const AVATAR_EXTENSIONS: Record<string, AvatarUploadRequest["extension"]> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function parsePlatformType(value: unknown): PortfolioPlatformType | null {
  return typeof value === "string" && PLATFORM_TYPES.includes(value as PortfolioPlatformType)
    ? (value as PortfolioPlatformType)
    : null;
}

export function normalizePortfolioUrl(input: string): string {
  const trimmed = input.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ProfileMediaError("bad_url", "Enter a valid portfolio URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProfileMediaError("bad_url", "Portfolio URL must use HTTP or HTTPS");
  }
  return parsed.toString();
}

export function normalizeTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProfileMediaError("bad_title", "Portfolio title is required");
  }
  return value.trim().slice(0, 120);
}

export function normalizeCaption(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const caption = value.trim();
  return caption ? caption.slice(0, 240) : null;
}

export function normalizeSortOrder(value: unknown): number {
  return Number.isInteger(value) ? (value as number) : 0;
}

export function validateAvatarUpload(input: {
  fileName?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
}): AvatarUploadRequest {
  if (typeof input.contentType !== "string" || !ALLOWED_AVATAR_MIME_TYPES.includes(input.contentType as AvatarMimeType)) {
    throw new ProfileMediaError("bad_avatar_type", "Avatar must be a JPG, PNG, or WebP image");
  }
  if (typeof input.sizeBytes !== "number" || input.sizeBytes <= 0 || input.sizeBytes > MAX_AVATAR_BYTES) {
    throw new ProfileMediaError("bad_avatar_size", "Avatar must be 5 MB or smaller");
  }
  const fileName = typeof input.fileName === "string" && input.fileName.trim() ? input.fileName.trim() : "avatar";
  return {
    fileName,
    contentType: input.contentType as AvatarUploadRequest["contentType"],
    sizeBytes: input.sizeBytes,
    extension: AVATAR_EXTENSIONS[input.contentType as AvatarMimeType],
  };
}

export function ownedAvatarPath(creatorId: string, extension: AvatarUploadRequest["extension"], id = randomUUID()) {
  return `${creatorId}/${id}.${extension}`;
}

export function assertOwnedAvatarPath(creatorId: string, storagePath: unknown): string {
  if (typeof storagePath !== "string" || !storagePath.startsWith(`${creatorId}/`) || storagePath.includes("..")) {
    throw new ProfileMediaError("bad_avatar_path", "Avatar path is not owned by this creator");
  }
  return storagePath;
}

export function publicHighlightsFromLinks(links: ProfileMediaLink[]): PublicProfileHighlight[] {
  return links
    .filter((link) => link.publicHighlight)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 3)
    .map((link) => ({
      url: link.url,
      title: link.title,
      platform_type: link.platformType,
      caption: link.caption,
      sort_order: link.sortOrder,
    }));
}

export function calculateCompleteness(input: {
  avatarUrl: string | null;
  displayName: string | null;
  bio: string | null;
  categories: string[];
  portfolioLinks: ProfileMediaLink[];
  hasSocialScan: boolean;
}): ProfileCompleteness {
  const items: ProfileCompleteness["items"] = [
    { key: "avatar", label: "Avatar selected", complete: Boolean(input.avatarUrl) },
    { key: "display_name", label: "Display name added", complete: Boolean(input.displayName?.trim()) },
    { key: "bio", label: "Profile bio added", complete: Boolean(input.bio?.trim()) },
    { key: "categories", label: "Creator categories selected", complete: input.categories.length > 0 },
    { key: "portfolio", label: "Portfolio link added", complete: input.portfolioLinks.length > 0 },
    { key: "public_highlight", label: "Public highlight selected", complete: input.portfolioLinks.some((link) => link.publicHighlight) },
    { key: "social_scan", label: "Social scan connected", complete: input.hasSocialScan },
  ];
  const completeCount = items.filter((item) => item.complete).length;
  return { score: Math.round((completeCount / items.length) * 100), items };
}
