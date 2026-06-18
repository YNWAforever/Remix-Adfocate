export const PROFILE_MEDIA_BUCKET = "creator-avatars";
export const MAX_AVATAR_BYTES = 5_242_880;
export const ALLOWED_AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PLATFORM_TYPES = ["instagram", "threads", "tiktok", "youtube", "website", "case_study", "other"] as const;

export type AvatarMimeType = (typeof ALLOWED_AVATAR_MIME_TYPES)[number];
export type PortfolioPlatformType = (typeof PLATFORM_TYPES)[number];

export type ProfileMediaLink = {
  id: string;
  creatorId: string;
  workspaceId: string;
  url: string;
  title: string;
  platformType: PortfolioPlatformType;
  caption: string | null;
  sortOrder: number;
  publicHighlight: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicProfileHighlight = {
  url: string;
  title: string;
  platform_type: PortfolioPlatformType;
  caption: string | null;
  sort_order: number;
};

export type ProfileCompletenessItem = {
  key: "avatar" | "display_name" | "bio" | "categories" | "portfolio" | "public_highlight" | "social_scan";
  label: string;
  complete: boolean;
};

export type ProfileCompleteness = {
  score: number;
  items: ProfileCompletenessItem[];
};

export type CreatorProfileMedia = {
  avatarUrl: string | null;
  portfolioLinks: ProfileMediaLink[];
  publicHighlights: PublicProfileHighlight[];
  published: {
    avatarUrl: string | null;
    highlights: PublicProfileHighlight[];
    publishedAt: string | null;
  };
  completeness: ProfileCompleteness;
};

export type AvatarUploadRequest = {
  fileName: string;
  contentType: AvatarMimeType;
  sizeBytes: number;
  extension: "jpg" | "png" | "webp";
};
