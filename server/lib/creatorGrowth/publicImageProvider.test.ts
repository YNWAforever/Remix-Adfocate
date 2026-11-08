import { afterEach, describe, expect, it, vi } from "vitest";

import { matchPublicImage, type PublicImageCandidate } from "./mediaMatch.js";
import {
  PublicImageProvider,
  PublicImageProviderError,
  createPublicImageProvider,
} from "./publicImageProvider.js";

const PROFILE = {
  subject: "17841400000000001",
  username: "approved_creator",
  officialPermalink: "https://instagram.com/p/Canonical_Code/",
};

const FETCHED_AT = "2026-11-04T02:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PublicImageProvider", () => {
  it("returns a clearly labeled matching sample from an injected mock", async () => {
    const provider = new PublicImageProvider({
      mode: "mock",
      now: () => new Date(FETCHED_AT),
    });

    const candidates = await provider.listForProfile(
      PROFILE,
      new AbortController().signal,
    );

    expect(provider.mode).toBe("mock");
    expect(candidates).toEqual([
      {
        provider: "rapidapi",
        subject: PROFILE.subject,
        permalink: "https://www.instagram.com/p/Canonical_Code",
        mediaId: null,
        imageRef: "mock-image-ref:sample",
        fetchedAt: FETCHED_AT,
        rights: "allowed",
        visibility: "public",
        provenance: "mock",
        sampleOnly: true,
      },
    ]);
  });

  it("does not return official or RapidAPI metric fields", async () => {
    const provider = createPublicImageProvider({
      mode: "mock",
      now: () => new Date(FETCHED_AT),
      samples: [
        {
          provider: "rapidapi",
          subject: PROFILE.subject,
          permalink: PROFILE.officialPermalink,
          mediaId: null,
          imageRef: "mock-image-ref:no-metrics",
          fetchedAt: FETCHED_AT,
          rights: "allowed",
          visibility: "public",
          provenance: "mock",
          sampleOnly: true,
          metrics: {
            reach: 999,
            likes: 99,
            comments: 9,
          },
        } as PublicImageCandidate,
      ],
    });

    const [candidate] = await provider.listForProfile(
      PROFILE,
      new AbortController().signal,
    );

    expect(candidate).toBeDefined();
    expect(candidate).not.toHaveProperty("metrics");
    expect(candidate).not.toHaveProperty("reach");
    expect(candidate).not.toHaveProperty("likes");
    expect(candidate).not.toHaveProperty("comments");
    expect(candidate?.imageRef).toMatch(/^mock-image-ref:/);
  });

  it("binds every returned candidate to the official subject", async () => {
    const provider = createPublicImageProvider({
      mode: "mock",
      now: () => new Date(FETCHED_AT),
      samples: [
        {
          provider: "rapidapi",
          subject: "17841400000000002",
          permalink: PROFILE.officialPermalink,
          mediaId: null,
          imageRef: "mock-image-ref:other-subject",
          fetchedAt: FETCHED_AT,
          rights: "allowed",
          visibility: "public",
          provenance: "mock",
          sampleOnly: true,
        },
      ],
    });

    await expect(
      provider.listForProfile(PROFILE, new AbortController().signal),
    ).resolves.toEqual([]);
  });

  it.each([
    "private",
    "unknown",
    undefined,
  ] as const)("rejects %s visibility in injected samples", async (visibility) => {
    const provider = createPublicImageProvider({
      mode: "mock",
      samples: [
        {
          provider: "rapidapi",
          subject: PROFILE.subject,
          permalink: PROFILE.officialPermalink,
          mediaId: null,
          imageRef: "mock-image-ref:private",
          fetchedAt: FETCHED_AT,
          rights: "allowed",
          visibility,
          provenance: "mock",
          sampleOnly: true,
        } as PublicImageCandidate,
      ],
    });

    await expect(
      provider.listForProfile(PROFILE, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "PUBLIC_IMAGE_PROVIDER_INVALID_CANDIDATE",
    });
  });

  it("rejects duplicate canonical candidate identities", async () => {
    const sample = {
      provider: "rapidapi",
      subject: PROFILE.subject,
      permalink: "https://www.instagram.com/p/Canonical_Code",
      mediaId: null,
      imageRef: "mock-image-ref:duplicate",
      fetchedAt: FETCHED_AT,
      rights: "allowed",
      visibility: "public",
      provenance: "mock",
      sampleOnly: true,
    } satisfies PublicImageCandidate;
    const provider = createPublicImageProvider({
      mode: "mock",
      samples: [sample, { ...sample, imageRef: "mock-image-ref:duplicate-2" }],
    });

    await expect(
      provider.listForProfile(PROFILE, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "PUBLIC_IMAGE_PROVIDER_DUPLICATE_CANDIDATE",
    });
  });

  it("does not call fetch when the provider feature flag is disabled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = createPublicImageProvider({ mode: "disabled" });

    await expect(
      provider.listForProfile(PROFILE, new AbortController().signal),
    ).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed before any request when live mode is forced at runtime", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = createPublicImageProvider({
      mode: "live" as unknown as "disabled",
    });

    await expect(
      provider.listForProfile(PROFILE, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "PUBLIC_IMAGE_PROVIDER_UNVERIFIED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createPublicImageProvider({ mode: "mock" });

    await expect(
      provider.listForProfile(PROFILE, controller.signal),
    ).rejects.toBeInstanceOf(PublicImageProviderError);
    await expect(
      provider.listForProfile(PROFILE, controller.signal),
    ).rejects.toMatchObject({
      code: "PUBLIC_IMAGE_PROVIDER_CANCELLED",
    });
  });

  it("does not use the username as a substitute for an invalid official permalink", async () => {
    const provider = createPublicImageProvider({ mode: "mock" });

    await expect(
      provider.listForProfile(
        {
          ...PROFILE,
          officialPermalink: "https://evil.example/p/Canonical_Code",
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "PUBLIC_IMAGE_PROVIDER_INVALID_PROFILE",
    });
  });

  it.each(["", " ", " padded-subject"])(
    "rejects an unbound subject %j even with a plausible username",
    async (subject) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const provider = createPublicImageProvider({ mode: "mock" });
      await expect(provider.listForProfile(
        { ...PROFILE, subject }, new AbortController().signal,
      )).rejects.toMatchObject({ code: "PUBLIC_IMAGE_PROVIDER_INVALID_PROFILE" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://images.example/image.jpg",
    "http://127.0.0.1/private",
    "data:image/png;base64,untrusted",
  ])("rejects a fetchable image reference %s without fetching it", async (imageRef) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = createPublicImageProvider({
      mode: "mock",
      samples: [{
        provider: "rapidapi", subject: PROFILE.subject,
        permalink: PROFILE.officialPermalink, mediaId: null, imageRef,
        fetchedAt: FETCHED_AT, rights: "allowed", visibility: "public",
      }],
    });
    await expect(provider.listForProfile(PROFILE, new AbortController().signal))
      .rejects.toMatchObject({ code: "PUBLIC_IMAGE_PROVIDER_INVALID_CANDIDATE" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["unknown", "denied"] as const)(
    "preserves %s rights so the real matcher denies the synthetic candidate",
    async (rights) => {
      const provider = createPublicImageProvider({
        mode: "mock", now: () => new Date(FETCHED_AT),
        samples: [{
          provider: "rapidapi", subject: PROFILE.subject,
          permalink: PROFILE.officialPermalink, mediaId: null,
          imageRef: "mock-image-ref:unapproved", fetchedAt: FETCHED_AT,
          rights, visibility: "public",
        }],
      });
      const [candidate] = await provider.listForProfile(PROFILE, new AbortController().signal);
      expect(candidate).toMatchObject({ rights, provenance: "mock", sampleOnly: true });
      expect(matchPublicImage({
        ...PROFILE, mediaId: "17900000000000001", permalink: PROFILE.officialPermalink,
        mediaType: "IMAGE", observedAt: FETCHED_AT,
      }, candidate)).toEqual({ status: "rejected", reason: "rights_not_allowed" });
    },
  );

  it("cannot promote injected flags or rights records into a live transport", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const untrustedOptions = {
      mode: "live" as unknown as "disabled",
      enabled: true, rightsApproved: true,
      approvedProvider: { endpoint: "https://unreviewed.example/images", termsVersion: "claimed" },
    };
    const provider = createPublicImageProvider(untrustedOptions);
    await expect(provider.listForProfile(PROFILE, new AbortController().signal))
      .rejects.toMatchObject({ code: "PUBLIC_IMAGE_PROVIDER_UNVERIFIED" });
    expect(provider.mode).toBe("disabled");
    expect(fetch).not.toHaveBeenCalled();
  });
});
