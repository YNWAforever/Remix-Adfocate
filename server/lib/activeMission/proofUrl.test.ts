import { describe, expect, it, vi } from "vitest";

import { ActiveMissionError } from "./errors";
import {
  PLATFORM_HOSTS,
  inspectProofUrl,
  type ProofUrlDependencies,
  type ProofUrlInspection,
} from "./proofUrl";

const SAFE_IPV4 = { address: "93.184.216.34", family: 4 as const };
const NOW = new Date("2026-07-24T04:05:06.000Z");

function htmlResponse(
  html: string,
  init: ResponseInit = {},
): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

function createDeps(
  overrides: Partial<ProofUrlDependencies> = {},
): ProofUrlDependencies {
  return {
    resolve: vi.fn(async () => [SAFE_IPV4]),
    fetch: vi.fn(async () => htmlResponse("<title>Published</title>")),
    now: () => NOW,
    ...overrides,
  };
}

async function expectUnsafe(
  promise: Promise<ProofUrlInspection>,
): Promise<ActiveMissionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ActiveMissionError);
    expect((error as ActiveMissionError).code).toBe("UNSAFE_PROOF_URL");
    return error as ActiveMissionError;
  }

  throw new Error("Expected inspectProofUrl to throw");
}

describe("inspectProofUrl input policy", () => {
  it("exports the explicit platform host allowlist", () => {
    expect(PLATFORM_HOSTS).toEqual({
      instagram: ["instagram.com", "www.instagram.com"],
      tiktok: ["tiktok.com", "www.tiktok.com"],
      youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
      facebook: ["facebook.com", "www.facebook.com"],
    });
  });

  it.each([
    ["HTTP", "http://www.instagram.com/p/1"],
    ["credentials", "https://creator:secret@www.instagram.com/p/1"],
    ["non-standard port", "https://www.instagram.com:444/p/1"],
    ["unlisted host", "https://media.instagram.com/p/1"],
    ["lookalike host", "https://www.instagram.com.evil.example/p/1"],
  ])("rejects %s before DNS or fetch", async (_case, url) => {
    const deps = createDeps();

    await expectUnsafe(
      inspectProofUrl({ url, platform: "instagram" }, deps),
    );

    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("rejects a URL whose host belongs to a different platform", async () => {
    const deps = createDeps();

    await expectUnsafe(
      inspectProofUrl(
        { url: "https://youtu.be/video", platform: "instagram" },
        deps,
      ),
    );

    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("normalizes the safe URL before returning or fetching it", async () => {
    const deps = createDeps();

    const result = await inspectProofUrl(
      {
        url: " HTTPS://WWW.INSTAGRAM.COM:443/p/1?ref=proof#published ",
        platform: "instagram",
      },
      deps,
    );

    expect(result.normalizedUrl).toBe(
      "https://www.instagram.com/p/1?ref=proof#published",
    );
    expect(deps.fetch).toHaveBeenCalledWith(
      result.normalizedUrl,
      expect.any(Object),
    );
  });

  it.each([
    ["IPv4 unspecified", "0.0.0.0"],
    ["IPv4 private 10/8", "10.20.30.40"],
    ["IPv4 private 100.64/10", "100.64.0.1"],
    ["IPv4 loopback", "127.0.0.1"],
    ["IPv4 link-local metadata", "169.254.169.254"],
    ["IPv4 private 172.16/12", "172.31.255.254"],
    ["IPv4 private 192.168/16", "192.168.10.1"],
    ["IPv4 documentation", "192.0.2.1"],
    ["IPv4 benchmark", "198.18.0.1"],
    ["IPv4 multicast", "224.0.0.1"],
    ["IPv4 reserved", "240.0.0.1"],
    ["IPv6 unspecified", "::"],
    ["IPv6 loopback", "::1"],
    ["IPv6 IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv6 unique-local", "fc00::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["IPv6 documentation expanded", "2001:0db8:0:0:0:0:0:1"],
    ["IPv6 reserved protocol assignment", "2001:1::1"],
    ["IPv6 multicast", "ff02::1"],
  ])("rejects resolved %s address %s", async (_case, address) => {
    const deps = createDeps({
      resolve: vi.fn(async () => [
        { address, family: address.includes(":") ? 6 : 4 } as
          | { address: string; family: 4 }
          | { address: string; family: 6 },
      ]),
    });

    await expectUnsafe(
      inspectProofUrl(
        { url: "https://www.instagram.com/p/1", platform: "instagram" },
        deps,
      ),
    );

    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("rejects a mixed DNS answer when any address is unsafe", async () => {
    const deps = createDeps({
      resolve: vi.fn(async () => [
        SAFE_IPV4,
        { address: "127.0.0.1", family: 4 as const },
      ]),
    });

    await expectUnsafe(
      inspectProofUrl(
        { url: "https://www.instagram.com/p/1", platform: "instagram" },
        deps,
      ),
    );

    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { address: "8.8.8.8", family: 4 as const },
    { address: "2606:4700:4700::1111", family: 6 as const },
  ])("accepts public address $address", async (address) => {
    const deps = createDeps({
      resolve: vi.fn(async () => [address]),
    });

    await expect(
      inspectProofUrl(
        { url: "https://www.instagram.com/p/1", platform: "instagram" },
        deps,
      ),
    ).resolves.toMatchObject({ status: "available" });
  });

  it("can report an unsafe destination without throwing or fetching", async () => {
    const deps = createDeps({
      resolve: vi.fn(async () => [
        { address: "127.0.0.1", family: 4 as const },
      ]),
    });

    const result = await inspectProofUrl(
      {
        url: "https://www.instagram.com/p/1",
        platform: "instagram",
        unsafeBehavior: "report",
      },
      deps,
    );

    expect(result).toEqual({
      normalizedUrl: "https://www.instagram.com/p/1",
      status: "unsafe",
      errorCategory: "unsafe_destination",
      metadata: {
        finalCanonicalUrl: "https://www.instagram.com/p/1",
        httpStatusCategory: "unknown",
        pageTitle: null,
        openGraphType: null,
        declaredPublicationTime: null,
        fetchedAt: NOW.toISOString(),
      },
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe("inspectProofUrl without a platform allowlist", () => {
  it.each([
    ["an absent platform", undefined],
    ["a null platform", null],
    ["an unlisted platform", "threads"],
    ["an inherited object key", "constructor"],
  ])("accepts a public HTTPS URL for %s", async (_case, platform) => {
    const deps = createDeps();

    await expect(
      inspectProofUrl(
        { url: "https://www.threads.net/@creator/post/1", platform },
        deps,
      ),
    ).resolves.toMatchObject({
      normalizedUrl: "https://www.threads.net/@creator/post/1",
      status: "available",
    });
  });

  it.each([
    ["HTTP", "http://www.threads.net/@creator/post/1"],
    ["a non-HTTPS scheme", "file:///etc/passwd"],
    ["credentials", "https://creator:secret@www.threads.net/post/1"],
    ["userinfo host confusion", "https://www.threads.net@evil.example/post/1"],
    ["a non-standard port", "https://www.threads.net:8443/post/1"],
  ])("still rejects %s before DNS or fetch", async (_case, url) => {
    const deps = createDeps();

    await expectUnsafe(inspectProofUrl({ url, platform: null }, deps));

    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("still rejects a host that resolves to a reserved address", async () => {
    const deps = createDeps({
      resolve: vi.fn(async (hostname: string) => [
        { address: hostname, family: 4 as const },
      ]),
    });

    await expectUnsafe(
      inspectProofUrl(
        { url: "https://169.254.169.254/latest/meta-data" },
        deps,
      ),
    );

    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("still revalidates URL policy on every redirect hop", async () => {
    const fetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    const deps = createDeps({ fetch });

    const error = await expectUnsafe(
      inspectProofUrl(
        { url: "https://www.threads.net/@creator/post/1", platform: "threads" },
        deps,
      ),
    );

    expect(error.message).toContain("HTTPS");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("applies the allowlist to a recognized platform whatever its casing", async () => {
    const deps = createDeps();

    await expectUnsafe(
      inspectProofUrl(
        { url: "https://www.threads.net/@creator/post/1", platform: " Instagram " },
        deps,
      ),
    );

    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe("inspectProofUrl DNS and redirects", () => {
  it("resolves twice immediately before the fetch to detect rebinding", async () => {
    const resolve = vi
      .fn<ProofUrlDependencies["resolve"]>()
      .mockResolvedValueOnce([SAFE_IPV4])
      .mockResolvedValueOnce([
        { address: "169.254.169.254", family: 4 as const },
      ]);
    const deps = createDeps({ resolve });

    await expectUnsafe(
      inspectProofUrl(
        { url: "https://www.instagram.com/p/1", platform: "instagram" },
        deps,
      ),
    );

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("follows a safe redirect after revalidating URL policy and DNS", async () => {
    const resolve = vi.fn(async () => [SAFE_IPV4]);
    const fetch = vi
      .fn<ProofUrlDependencies["fetch"]>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/p/final?proof=1" },
        }),
      )
      .mockResolvedValueOnce(
        htmlResponse(
          [
            "<html><head>",
            "<title>Final proof</title>",
            '<meta property="og:type" content="video">',
            '<meta property="article:published_time" content="2026-07-23T08:00:00Z">',
            "</head></html>",
          ].join(""),
        ),
      );
    const deps = createDeps({ resolve, fetch });

    const result = await inspectProofUrl(
      {
        url: "https://www.instagram.com/p/start",
        platform: "instagram",
      },
      deps,
    );

    expect(resolve).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://www.instagram.com/p/final?proof=1",
    );
    expect(result).toEqual({
      normalizedUrl: "https://www.instagram.com/p/start",
      status: "available",
      errorCategory: null,
      metadata: {
        finalCanonicalUrl: "https://www.instagram.com/p/final?proof=1",
        httpStatusCategory: "success",
        pageTitle: "Final proof",
        openGraphType: "video",
        declaredPublicationTime: "2026-07-23T08:00:00.000Z",
        fetchedAt: NOW.toISOString(),
      },
    });
  });

  it("rejects an unsafe redirect before fetching the destination", async () => {
    const fetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    const deps = createDeps({ fetch });

    await expectUnsafe(
      inspectProofUrl(
        { url: "https://www.instagram.com/p/start", platform: "instagram" },
        deps,
      ),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(deps.resolve).toHaveBeenCalledTimes(2);
  });

  it("returns unsafe for an unsafe redirect in report mode", async () => {
    const fetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://www.instagram.com.evil.test/private" },
      }),
    );
    const deps = createDeps({ fetch });

    const result = await inspectProofUrl(
      {
        url: "https://www.instagram.com/p/start",
        platform: "instagram",
        unsafeBehavior: "report",
      },
      deps,
    );

    expect(result).toMatchObject({
      normalizedUrl: "https://www.instagram.com/p/start",
      status: "unsafe",
      errorCategory: "unsafe_destination",
      metadata: {
        finalCanonicalUrl: "https://www.instagram.com.evil.test/private",
        httpStatusCategory: "unknown",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows three redirects and re-resolves both checks on every hop", async () => {
    const fetch = vi
      .fn<ProofUrlDependencies["fetch"]>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/p/2" } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 303, headers: { location: "/p/3" } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { location: "/p/4" } }),
      )
      .mockResolvedValueOnce(htmlResponse("<title>Fourth hop</title>"));
    const deps = createDeps({ fetch });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result.status).toBe("available");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(deps.resolve).toHaveBeenCalledTimes(8);
  });

  it("stops when a fourth redirect would be required", async () => {
    const fetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "/p/next" },
      }),
    );
    const deps = createDeps({ fetch });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      errorCategory: "too_many_redirects",
      metadata: { httpStatusCategory: "redirect" },
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe("inspectProofUrl bounded fetch and metadata", () => {
  it("uses manual redirects, omits credentials, and creates a three-second signal", async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) => {
        expect(milliseconds).toBe(3_000);
        return controller.signal;
      });
    const fetch = vi.fn<ProofUrlDependencies["fetch"]>(async () =>
      htmlResponse("<title>Proof</title>"),
    );
    const deps = createDeps({ fetch });

    try {
      await inspectProofUrl(
        { url: "https://www.instagram.com/p/1", platform: "instagram" },
        deps,
      );
    } finally {
      timeout.mockRestore();
    }

    const init = fetch.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      redirect: "manual",
      credentials: "omit",
      signal: controller.signal,
    });
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
  });

  it("returns a timeout fallback when the fetch times out", async () => {
    const deps = createDeps({
      fetch: vi.fn(async () => {
        throw new DOMException("The operation timed out", "TimeoutError");
      }),
    });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      errorCategory: "timeout",
      metadata: {
        finalCanonicalUrl: "https://www.instagram.com/p/1",
        httpStatusCategory: "unknown",
        fetchedAt: NOW.toISOString(),
      },
    });
  });

  it("returns a timeout fallback when the response body aborts", async () => {
    const response = {
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: {
        getReader() {
          return {
            read: vi.fn(async () => {
              throw new DOMException("The operation timed out", "TimeoutError");
            }),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(),
          };
        },
        cancel: vi.fn(async () => undefined),
      },
    } as unknown as Response;
    const deps = createDeps({
      fetch: vi.fn(async () => response),
    });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      errorCategory: "timeout",
      metadata: { httpStatusCategory: "success" },
    });
  });

  it("returns a network fallback when the response body connection resets", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(
          new TypeError("terminated", {
            cause: { code: "ECONNRESET" },
          }),
        );
      },
    });
    const deps = createDeps({
      fetch: vi.fn(async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      errorCategory: "network",
      metadata: { httpStatusCategory: "success" },
    });
  });

  it("returns a network fallback for DNS or fetch failures", async () => {
    const dnsResult = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      createDeps({
        resolve: vi.fn(async () => {
          throw new Error("DNS unavailable");
        }),
      }),
    );
    const fetchResult = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      createDeps({
        fetch: vi.fn(async () => {
          throw new TypeError("fetch failed");
        }),
      }),
    );

    expect(dnsResult).toMatchObject({
      status: "unavailable",
      errorCategory: "network",
    });
    expect(fetchResult).toMatchObject({
      status: "unavailable",
      errorCategory: "network",
    });
  });

  it("stops reading after the 256 KB response cap", async () => {
    const oversized = "a".repeat(256 * 1024 + 1);
    const deps = createDeps({
      fetch: vi.fn(async () => htmlResponse(oversized)),
    });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      errorCategory: "response_too_large",
      metadata: { httpStatusCategory: "success" },
    });
  });

  it("rejects an oversized declared content length without reading the body", async () => {
    let bodyRead = false;
    const response = {
      status: 200,
      headers: new Headers({
        "content-type": "text/html",
        "content-length": String(256 * 1024 + 1),
      }),
      body: {
        cancel: vi.fn(async () => undefined),
        getReader() {
          bodyRead = true;
          throw new Error("body must not be read");
        },
      },
    } as unknown as Response;
    const deps = createDeps({
      fetch: vi.fn(async () => response),
    });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result.errorCategory).toBe("response_too_large");
    expect(bodyRead).toBe(false);
  });

  it("rejects Content-Length above Number.MAX_SAFE_INTEGER before reading", async () => {
    let bodyRead = false;
    const response = {
      status: 200,
      headers: new Headers({
        "content-type": "text/html",
        "content-length": "900719925474099200000",
      }),
      body: {
        cancel: vi.fn(async () => undefined),
        getReader() {
          bodyRead = true;
          throw new Error("body must not be read");
        },
      },
    } as unknown as Response;
    const deps = createDeps({
      fetch: vi.fn(async () => response),
    });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result.errorCategory).toBe("response_too_large");
    expect(result.metadata.httpStatusCategory).toBe("success");
    expect(bodyRead).toBe(false);
  });

  it("extracts only the bounded HTML metadata fields", async () => {
    const deps = createDeps({
      fetch: vi.fn(async () =>
        htmlResponse(`
          <html>
            <head>
              <title>  Proof &amp; Launch  </title>
              <meta property="og:type" content="article">
              <meta property="article:published_time" content="2026-07-23T08:00:00+08:00">
              <meta name="description" content="must not be retained">
              <script>globalThis.stolen = document.cookie</script>
            </head>
          </html>
        `),
      ),
    });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result).toEqual({
      normalizedUrl: "https://www.instagram.com/p/1",
      status: "available",
      errorCategory: null,
      metadata: {
        finalCanonicalUrl: "https://www.instagram.com/p/1",
        httpStatusCategory: "success",
        pageTitle: "Proof & Launch",
        openGraphType: "article",
        declaredPublicationTime: "2026-07-23T00:00:00.000Z",
        fetchedAt: NOW.toISOString(),
      },
    });
    expect(Object.keys(result.metadata)).toEqual([
      "finalCanonicalUrl",
      "httpStatusCategory",
      "pageTitle",
      "openGraphType",
      "declaredPublicationTime",
      "fetchedAt",
    ]);
  });

  it.each([
    ["application/json", "application/json"],
    ["missing content type", null],
  ])("does not extract metadata for %s", async (_case, contentType) => {
    const headers = new Headers();
    if (contentType) headers.set("content-type", contentType);
    const deps = createDeps({
      fetch: vi.fn(async () =>
        new Response('{"title":"not html"}', { status: 200, headers }),
      ),
    });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      errorCategory: "unsupported_content_type",
      metadata: {
        httpStatusCategory: "success",
        pageTitle: null,
        openGraphType: null,
        declaredPublicationTime: null,
      },
    });
  });

  it("returns bounded fallback metadata for malformed declared metadata", async () => {
    const deps = createDeps({
      fetch: vi.fn(async () =>
        htmlResponse(`
          <title>Still bounded</title>
          <meta property="og:type" content="">
          <meta property="article:published_time" content="not-a-date">
        `),
      ),
    });

    const result = await inspectProofUrl(
      { url: "https://www.instagram.com/p/1", platform: "instagram" },
      deps,
    );

    expect(result).toEqual({
      normalizedUrl: "https://www.instagram.com/p/1",
      status: "unavailable",
      errorCategory: "malformed_metadata",
      metadata: {
        finalCanonicalUrl: "https://www.instagram.com/p/1",
        httpStatusCategory: "success",
        pageTitle: "Still bounded",
        openGraphType: null,
        declaredPublicationTime: null,
        fetchedAt: NOW.toISOString(),
      },
    });
  });

  it.each([401, 403, 429])(
    "keeps platform-blocked HTTP %s as unavailable proof metadata",
    async (status) => {
      const deps = createDeps({
        fetch: vi.fn(async () =>
          new Response("<title>Blocked</title>", {
            status,
            headers: { "content-type": "text/html" },
          }),
        ),
      });

      const result = await inspectProofUrl(
        { url: "https://www.instagram.com/p/1", platform: "instagram" },
        deps,
      );

      expect(result).toEqual({
        normalizedUrl: "https://www.instagram.com/p/1",
        status: "unavailable",
        errorCategory: "platform_blocked",
        metadata: {
          finalCanonicalUrl: "https://www.instagram.com/p/1",
          httpStatusCategory: "client_error",
          pageTitle: null,
          openGraphType: null,
          declaredPublicationTime: null,
          fetchedAt: NOW.toISOString(),
        },
      });
    },
  );

  it.each([
    [404, "client_error"],
    [500, "server_error"],
  ] as const)(
    "preserves the HTTP status category for unavailable HTTP %s",
    async (status, httpStatusCategory) => {
      const deps = createDeps({
        fetch: vi.fn(async () =>
          new Response(null, {
            status,
            headers: { "content-type": "text/html" },
          }),
        ),
      });

      const result = await inspectProofUrl(
        { url: "https://www.instagram.com/p/1", platform: "instagram" },
        deps,
      );

      expect(result).toMatchObject({
        status: "unavailable",
        errorCategory: "network",
        metadata: { httpStatusCategory },
      });
    },
  );

});
