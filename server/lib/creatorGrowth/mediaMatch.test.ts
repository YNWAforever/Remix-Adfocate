import { describe, expect, expectTypeOf, it } from "vitest";

import {
  isValidPublicImageReference,
  matchPublicImage,
  matchPublicImages,
  normalizeInstagramPermalink,
  type OfficialMediaRef,
  type PublicImageCandidate,
  type PublicImageMatch,
  type PublicImageVisibility,
} from "./mediaMatch.js";

const OFFICIAL: OfficialMediaRef = {
  subject: "17841400000000001",
  mediaId: "17900000000000001",
  permalink: "https://www.instagram.com/p/Canonical_Code/",
  mediaType: "IMAGE",
  observedAt: "2026-11-04T01:00:00.000Z",
};

const CANDIDATE: PublicImageCandidate = {
  provider: "rapidapi",
  subject: OFFICIAL.subject,
  permalink: "https://instagram.com/p/Canonical_Code",
  mediaId: OFFICIAL.mediaId,
  imageRef: "mock-image-ref:sample",
  fetchedAt: "2026-11-04T02:00:00.000Z",
  rights: "allowed",
  visibility: "public",
  provenance: "mock",
  sampleOnly: true,
};

describe("matchPublicImage", () => {
  it("matches an exact canonical media ID", () => {
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        permalink: null,
      }),
    ).toEqual({ status: "matched", reason: "exact_media_id" });
  });

  it("matches an exact normalized permalink", () => {
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        permalink: "HTTPS://WWW.INSTAGRAM.COM/p/Canonical_Code/?igsh=sample",
        mediaId: null,
      }),
    ).toEqual({ status: "matched", reason: "exact_permalink" });
  });

  it("matches when both supplied references are exact", () => {
    expect(matchPublicImage(OFFICIAL, CANDIDATE)).toEqual({
      status: "matched",
      reason: "exact_media_reference",
    });
  });

  it.each([
    ["another subject", "17841400000000002"],
    ["no bound subject", null],
    ["blank subject", " "],
    ["a padded subject", ` ${OFFICIAL.subject} `],
  ])("rejects %s even with exact references", (_label, subject) => {
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        subject,
      }),
    ).toEqual({ status: "rejected", reason: "subject_mismatch" });
  });

  it("does not treat username or caption as an ownership reference", () => {
    const candidate = {
      ...CANDIDATE,
      mediaId: null,
      permalink: null,
      username: "same_username",
      caption: "same exact caption",
    } as PublicImageCandidate;

    expect(matchPublicImage(OFFICIAL, candidate)).toEqual({
      status: "unverified",
      reason: "stable_reference_missing",
    });
  });

  it.each(["unknown", "denied"] as const)(
    "rejects %s rights candidates",
    (rights) => {
      expect(
        matchPublicImage(OFFICIAL, {
          ...CANDIDATE,
          rights,
        }),
      ).toEqual({ status: "rejected", reason: "rights_not_allowed" });
    },
  );

  it.each(["CAROUSEL_ALBUM", "VIDEO"] as const)(
    "rejects official %s media",
    (mediaType) => {
      expect(
        matchPublicImage(
          {
            ...OFFICIAL,
            mediaType,
          },
          CANDIDATE,
        ),
      ).toEqual({ status: "rejected", reason: "not_single_image" });
    },
  );

  it("rejects a reel permalink even when the supplied media ID matches", () => {
    const reelOfficial = {
      ...OFFICIAL,
      permalink: "https://www.instagram.com/reel/Canonical_Code/",
    };
    const reelCandidate = {
      ...CANDIDATE,
      permalink: reelOfficial.permalink,
    };

    expect(matchPublicImage(reelOfficial, reelCandidate)).toEqual({
      status: "rejected",
      reason: "single_image_permalink_required",
    });
  });

  it("rejects a conflicting supplied media ID even when the permalink matches", () => {
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        mediaId: "17900000000000002",
      }),
    ).toEqual({ status: "rejected", reason: "media_id_conflict" });
  });

  it("rejects a conflicting supplied permalink even when the media ID matches", () => {
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        permalink: "https://www.instagram.com/p/Another_Code/",
      }),
    ).toEqual({ status: "rejected", reason: "permalink_conflict" });
  });

  it("rejects a malformed supplied media ID instead of ignoring it", () => {
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        mediaId: "17900000000000001x",
      }),
    ).toEqual({ status: "rejected", reason: "invalid_media_id" });
  });

  it("rejects malformed or redirected permalinks", () => {
    const candidates = [
      "https://user:pass@www.instagram.com/p/Canonical_Code",
      "http://www.instagram.com/p/Canonical_Code",
      "https://instagram.com.evil.example/p/Canonical_Code",
      "https://evil.example/redirect?url=https://www.instagram.com/p/Canonical_Code",
      "https://www.instagram.com:8443/p/Canonical_Code",
      "https://www.instagram.com/p/Canonical_Code%2Fextra",
      "https://www.instagram.com\\@evil.example/p/Canonical_Code",
      "https://www.instagram.com/p/../p/Canonical_Code",
      "https://www.instagram.com/p/Canonical_Code/extra",
    ];

    for (const permalink of candidates) {
      expect(
        matchPublicImage(OFFICIAL, {
          ...CANDIDATE,
          permalink,
          mediaId: null,
        }),
      ).toEqual({ status: "rejected", reason: "invalid_permalink" });
    }
  });

  it("rejects different stable references as the wrong media", () => {
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        mediaId: "17900000000000002",
        permalink: "https://www.instagram.com/p/Another_Code/",
      }),
    ).toEqual({ status: "rejected", reason: "media_reference_mismatch" });
  });

  it("rejects an empty opaque image reference", () => {
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        imageRef: " ",
      }),
    ).toEqual({ status: "rejected", reason: "invalid_image_reference" });
  });

  it.each([
    "https://images.example/photo.jpg",
    "http://images.example/photo.jpg",
    "data:image/jpeg;base64,c2FtcGxl",
    "blob:https://www.instagram.com/sample",
    "//images.example/photo.jpg",
    "ftp://images.example/photo.jpg",
    "javascript:alert(1)",
    "mailto:sample@example.com",
    "mock-image-ref:unsafe/path",
  ])("rejects a fetchable image reference: %s", (imageRef) => {
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        imageRef,
      }),
    ).toEqual({ status: "rejected", reason: "invalid_image_reference" });
  });

  it.each([
    "opaque-token_123",
    "mock-image-ref:sample",
  ])("accepts an allowlisted opaque image reference: %s", (imageRef) => {
    expect(isValidPublicImageReference(imageRef)).toBe(true);
    expect(
      matchPublicImage(OFFICIAL, {
        ...CANDIDATE,
        imageRef,
      }),
    ).toEqual({
      status: "matched",
      reason: "exact_media_reference",
    });
  });

  it.each([
    "private",
    "unknown",
    undefined,
  ] as const)("does not match %s visibility", (visibility) => {
    const candidate = {
      ...CANDIDATE,
      visibility,
    } as PublicImageCandidate;

    expect(matchPublicImage(OFFICIAL, candidate)).toEqual({
      status: "rejected",
      reason: "visibility_not_public",
    });
  });

  it("types visibility as public, private, or unknown", () => {
    expectTypeOf<PublicImageCandidate["visibility"]>().toEqualTypeOf<PublicImageVisibility>();
    expectTypeOf<PublicImageVisibility>().toEqualTypeOf<
      "public" | "private" | "unknown"
    >();
  });

  it("rejects every duplicate candidate identity", () => {
    const duplicate = {
      ...CANDIDATE,
      imageRef: "mock-image-ref:duplicate",
    };

    expect(matchPublicImages(OFFICIAL, [CANDIDATE, duplicate])).toEqual([
      { status: "rejected", reason: "duplicate_candidate_identity" },
      { status: "rejected", reason: "duplicate_candidate_identity" },
    ]);
  });

  it("returns only the documented match statuses and reason", () => {
    expectTypeOf(matchPublicImage(OFFICIAL, CANDIDATE)).toEqualTypeOf<PublicImageMatch>();
  });
});

describe("normalizeInstagramPermalink", () => {
  it("normalizes the host, trailing slash, query, and fragment without changing the path", () => {
    expect(
      normalizeInstagramPermalink(
        "https://instagram.com/p/Canonical_Code/?igsh=sample#comments",
      ),
    ).toBe("https://www.instagram.com/p/Canonical_Code");
  });

  it.each([
    "ftp://www.instagram.com/p/Canonical_Code",
    "https://www.instagram.com@evil.example/p/Canonical_Code",
    "https://www.instagram.com./p/Canonical_Code",
    "https://www.instagram.com/p/Canonical%2FCode",
    "https://www.instagram.com/P/Canonical_Code",
    "https://www.instagram.com/stories/Canonical_Code",
    "https://www.instagram.com/p/",
    " https://www.instagram.com/p/Canonical_Code",
  ])("returns null for an unsafe or non-canonical URL: %s", (permalink) => {
    expect(normalizeInstagramPermalink(permalink)).toBeNull();
  });
});
