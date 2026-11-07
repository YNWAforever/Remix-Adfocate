export type OfficialMediaRef = {
  subject: string;
  mediaId: string;
  permalink: string;
  mediaType: "IMAGE" | "CAROUSEL_ALBUM" | "VIDEO";
  observedAt: string;
};

export type PublicImageVisibility = "public" | "private" | "unknown";

export type PublicImageCandidate = {
  provider: "rapidapi";
  subject: string | null;
  permalink: string | null;
  mediaId: string | null;
  imageRef: string;
  fetchedAt: string;
  rights: "allowed" | "unknown" | "denied";
  visibility: PublicImageVisibility;
  provenance?: "mock";
  sampleOnly?: true;
};

export type PublicImageMatch = {
  status: "matched" | "unverified" | "rejected";
  reason: string;
};

type ParsedInstagramPermalink = {
  canonical: string;
  kind: "post" | "reel";
};

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const MEDIA_ID = /^[1-9]\d*$/;
const OPAQUE_IMAGE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$/;
const MOCK_IMAGE_REFERENCE =
  /^mock-image-ref:[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$/;
const INSTAGRAM_PERMALINK =
  /^(https):\/\/([^/?#]+)\/(p|reel)\/([A-Za-z0-9_-]+)\/?(?:[?#][^\s\\]*)?$/i;

function hasUnsafeCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x5c) {
      return true;
    }
  }
  return false;
}

function parseInstagramPermalink(
  permalink: unknown,
): ParsedInstagramPermalink | null {
  if (typeof permalink !== "string") {
    return null;
  }
  if (
    permalink !== permalink.trim() ||
    hasUnsafeCharacters(permalink)
  ) {
    return null;
  }

  const match = INSTAGRAM_PERMALINK.exec(permalink);
  if (!match) {
    return null;
  }

  const authority = match[2].toLowerCase();
  if (
    !INSTAGRAM_HOSTS.has(authority) ||
    match[3] !== match[3].toLowerCase()
  ) {
    return null;
  }

  try {
    const parsed = new URL(permalink);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== authority ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const kind = match[3].toLowerCase() === "p" ? "post" : "reel";
  return {
    canonical: `https://www.instagram.com/${match[3].toLowerCase()}/${match[4]}`,
    kind,
  };
}

export function normalizeInstagramPermalink(permalink: string): string | null {
  return parseInstagramPermalink(permalink)?.canonical ?? null;
}

function isCanonicalMediaId(mediaId: unknown): mediaId is string {
  return typeof mediaId === "string" && MEDIA_ID.test(mediaId);
}

export function isValidPublicImageReference(
  imageRef: unknown,
): imageRef is string {
  return (
    typeof imageRef === "string" &&
    (OPAQUE_IMAGE_TOKEN.test(imageRef) || MOCK_IMAGE_REFERENCE.test(imageRef))
  );
}

export function matchPublicImage(
  official: OfficialMediaRef,
  candidate: PublicImageCandidate,
): PublicImageMatch {
  if (candidate.rights !== "allowed") {
    return { status: "rejected", reason: "rights_not_allowed" };
  }
  if (
    typeof candidate.subject !== "string" ||
    candidate.subject.length === 0 ||
    candidate.subject !== official.subject ||
    typeof official.subject !== "string" ||
    official.subject.length === 0
  ) {
    return { status: "rejected", reason: "subject_mismatch" };
  }
  if (official.mediaType !== "IMAGE") {
    return { status: "rejected", reason: "not_single_image" };
  }
  if (candidate.visibility !== "public") {
    return { status: "rejected", reason: "visibility_not_public" };
  }
  if (!isCanonicalMediaId(official.mediaId)) {
    return { status: "rejected", reason: "invalid_official_media_id" };
  }

  const officialPermalink = parseInstagramPermalink(official.permalink);
  if (!officialPermalink) {
    return { status: "rejected", reason: "invalid_official_permalink" };
  }
  if (officialPermalink.kind !== "post") {
    return {
      status: "rejected",
      reason: "single_image_permalink_required",
    };
  }
  if (!isValidPublicImageReference(candidate.imageRef)) {
    return { status: "rejected", reason: "invalid_image_reference" };
  }
  if (candidate.mediaId !== null && !isCanonicalMediaId(candidate.mediaId)) {
    return { status: "rejected", reason: "invalid_media_id" };
  }

  const candidatePermalink =
    candidate.permalink === null
      ? null
      : parseInstagramPermalink(candidate.permalink);
  if (candidate.permalink !== null && !candidatePermalink) {
    return { status: "rejected", reason: "invalid_permalink" };
  }
  if (candidatePermalink?.kind === "reel") {
    return {
      status: "rejected",
      reason: "single_image_permalink_required",
    };
  }
  if (candidate.mediaId === null && candidatePermalink === null) {
    return { status: "unverified", reason: "stable_reference_missing" };
  }

  const mediaIdMatches =
    candidate.mediaId !== null && candidate.mediaId === official.mediaId;
  const permalinkMatches =
    candidatePermalink !== null &&
    candidatePermalink.canonical === officialPermalink.canonical;

  if (
    candidate.mediaId !== null &&
    candidatePermalink !== null &&
    !mediaIdMatches &&
    !permalinkMatches
  ) {
    return { status: "rejected", reason: "media_reference_mismatch" };
  }
  if (candidate.mediaId !== null && !mediaIdMatches) {
    return { status: "rejected", reason: "media_id_conflict" };
  }
  if (candidatePermalink !== null && !permalinkMatches) {
    return { status: "rejected", reason: "permalink_conflict" };
  }
  if (mediaIdMatches && permalinkMatches) {
    return { status: "matched", reason: "exact_media_reference" };
  }
  if (mediaIdMatches) {
    return { status: "matched", reason: "exact_media_id" };
  }
  if (permalinkMatches) {
    return { status: "matched", reason: "exact_permalink" };
  }
  return { status: "rejected", reason: "media_reference_mismatch" };
}

export function matchPublicImages(
  official: OfficialMediaRef,
  candidates: readonly PublicImageCandidate[],
): PublicImageMatch[] {
  const seenIdentities = new Set<string>();
  const duplicateIndexes = new Set<number>();

  candidates.forEach((candidate, index) => {
    const identities = new Set<string>();
    if (candidate.mediaId !== null) {
      identities.add(`media:${candidate.mediaId.trim()}`);
    }
    if (candidate.permalink !== null) {
      const permalink =
        normalizeInstagramPermalink(candidate.permalink) ??
        candidate.permalink.trim();
      identities.add(`permalink:${permalink}`);
    }
    for (const identity of identities) {
      if (seenIdentities.has(identity)) {
        duplicateIndexes.add(index);
        candidates.forEach((otherCandidate, otherIndex) => {
          const sharesIdentity =
            otherCandidate.mediaId?.trim() ===
              identity.replace(/^media:/, "") ||
            normalizeInstagramPermalink(otherCandidate.permalink ?? "") ===
              identity.replace(/^permalink:/, "");
          if (sharesIdentity) {
            duplicateIndexes.add(otherIndex);
          }
        });
      }
      seenIdentities.add(identity);
    }
  });

  return candidates.map((candidate, index) =>
    duplicateIndexes.has(index)
      ? { status: "rejected", reason: "duplicate_candidate_identity" }
      : matchPublicImage(official, candidate),
  );
}
