import {
  isValidPublicImageReference,
  normalizeInstagramPermalink,
  type PublicImageCandidate,
} from "./mediaMatch.js";

export type PublicImageProfile = {
  subject: string;
  username: string;
  officialPermalink: string;
};

export type PublicImageProviderMode = "mock" | "disabled";

export type PublicImageProviderOptions = {
  mode: PublicImageProviderMode;
  samples?: readonly PublicImageCandidate[];
  now?: () => Date;
};

export type PublicImageProviderErrorCode =
  | "PUBLIC_IMAGE_PROVIDER_CANCELLED"
  | "PUBLIC_IMAGE_PROVIDER_DUPLICATE_CANDIDATE"
  | "PUBLIC_IMAGE_PROVIDER_INVALID_CANDIDATE"
  | "PUBLIC_IMAGE_PROVIDER_INVALID_PROFILE"
  | "PUBLIC_IMAGE_PROVIDER_UNVERIFIED";

export class PublicImageProviderError extends Error {
  constructor(
    readonly code: PublicImageProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PublicImageProviderError";
  }
}

function fail(
  code: PublicImageProviderErrorCode,
  message: string,
): never {
  throw new PublicImageProviderError(code, message);
}

function duplicateCandidateIdentity(
  candidates: readonly PublicImageCandidate[],
): boolean {
  const identities = new Set<string>();
  for (const candidate of candidates) {
    const candidateIdentities = new Set<string>();
    if (candidate.mediaId !== null) {
      candidateIdentities.add(`media:${candidate.mediaId}`);
    }
    if (candidate.permalink !== null) {
      candidateIdentities.add(
        `permalink:${normalizeInstagramPermalink(candidate.permalink) ?? candidate.permalink}`,
      );
    }
    for (const identity of candidateIdentities) {
      if (identities.has(identity)) {
        return true;
      }
      identities.add(identity);
    }
  }
  return false;
}

export class PublicImageProvider {
  readonly mode: PublicImageProviderMode;
  private readonly configuredMode: string;
  private readonly samples: readonly PublicImageCandidate[] | undefined;
  private readonly now: () => Date;

  constructor(options: PublicImageProviderOptions) {
    this.configuredMode = String(options.mode);
    this.mode = this.configuredMode === "mock" ? "mock" : "disabled";
    this.samples = options.samples;
    this.now = options.now ?? (() => new Date());
  }

  async listForProfile(
    profile: PublicImageProfile,
    signal: AbortSignal,
  ): Promise<PublicImageCandidate[]> {
    if (signal.aborted) {
      fail(
        "PUBLIC_IMAGE_PROVIDER_CANCELLED",
        "The public image request was cancelled.",
      );
    }
    if (this.configuredMode === "live") {
      fail(
        "PUBLIC_IMAGE_PROVIDER_UNVERIFIED",
        "Live public image retrieval is disabled pending provider and rights review.",
      );
    }
    if (this.configuredMode !== "mock") {
      return [];
    }
    if (
      typeof profile.subject !== "string" ||
      typeof profile.username !== "string" ||
      profile.subject.length === 0 ||
      profile.username.length === 0 ||
      profile.subject !== profile.subject.trim() ||
      profile.username !== profile.username.trim()
    ) {
      fail(
        "PUBLIC_IMAGE_PROVIDER_INVALID_PROFILE",
        "The official profile binding is invalid.",
      );
    }

    const officialPermalink = normalizeInstagramPermalink(
      profile.officialPermalink,
    );
    if (!officialPermalink) {
      fail(
        "PUBLIC_IMAGE_PROVIDER_INVALID_PROFILE",
        "The official permalink is invalid.",
      );
    }

    const fetchedAt = this.now().toISOString();
    if (this.samples === undefined) {
      return [
        {
          provider: "rapidapi",
          subject: profile.subject,
          permalink: officialPermalink,
          mediaId: null,
          imageRef: "mock-image-ref:sample",
          fetchedAt,
          rights: "allowed",
          visibility: "public",
          provenance: "mock",
          sampleOnly: true,
        },
      ];
    }

    const boundSamples = this.samples.filter(
      (candidate) => candidate.subject === profile.subject,
    );
    const sanitized = boundSamples.map((candidate) => {
      if (
        candidate.provider !== "rapidapi" ||
        !["allowed", "unknown", "denied"].includes(candidate.rights) ||
        candidate.visibility !== "public" ||
        !isValidPublicImageReference(candidate.imageRef)
      ) {
        fail(
          "PUBLIC_IMAGE_PROVIDER_INVALID_CANDIDATE",
          "The injected public image sample is invalid.",
        );
      }
      const canonicalPermalink =
        candidate.permalink === null
          ? null
          : normalizeInstagramPermalink(candidate.permalink);
      if (candidate.permalink !== null && !canonicalPermalink) {
        fail(
          "PUBLIC_IMAGE_PROVIDER_INVALID_CANDIDATE",
          "The injected public image permalink is invalid.",
        );
      }
      return {
        provider: "rapidapi" as const,
        subject: profile.subject,
        permalink: canonicalPermalink,
        mediaId: candidate.mediaId,
        imageRef: candidate.imageRef,
        fetchedAt,
        rights: candidate.rights,
        visibility: "public" as const,
        provenance: "mock" as const,
        sampleOnly: true as const,
      };
    });

    if (duplicateCandidateIdentity(sanitized)) {
      fail(
        "PUBLIC_IMAGE_PROVIDER_DUPLICATE_CANDIDATE",
        "Duplicate public image candidates are ambiguous.",
      );
    }
    return sanitized;
  }
}

export function createPublicImageProvider(
  options: PublicImageProviderOptions,
): PublicImageProvider {
  return new PublicImageProvider(options);
}
