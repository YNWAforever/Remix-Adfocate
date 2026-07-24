import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { ActiveMissionError } from "./errors";
import type { ProofMetadataSnapshot } from "./types";

export const PLATFORM_HOSTS = {
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
  facebook: ["facebook.com", "www.facebook.com"],
} as const;

export type ProofMetadataErrorCategory =
  | "timeout"
  | "network"
  | "too_many_redirects"
  | "response_too_large"
  | "unsupported_content_type"
  | "malformed_metadata"
  | "platform_blocked"
  | "unsafe_destination";

export interface ProofUrlInspectionInput {
  url: string;
  platform: keyof typeof PLATFORM_HOSTS;
  unsafeBehavior?: "throw" | "report";
}

export interface ProofUrlInspection {
  normalizedUrl: string;
  status: "available" | "unavailable" | "unsafe";
  metadata: ProofMetadataSnapshot;
  errorCategory: ProofMetadataErrorCategory | null;
}

export interface ProofUrlDependencies {
  resolve(
    hostname: string,
  ): Promise<readonly { address: string; family: 4 | 6 }[]>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  now(): Date;
}

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 3_000;
const MAX_TITLE_LENGTH = 512;
const MAX_OPEN_GRAPH_TYPE_LENGTH = 128;

const defaultDependencies: ProofUrlDependencies = {
  resolve: async (hostname) => {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address, family }) => ({
      address,
      family: family as 4 | 6,
    }));
  },
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
};

interface ParsedMetadata {
  pageTitle: string | null;
  openGraphType: string | null;
  declaredPublicationTime: string | null;
  malformed: boolean;
}

export async function inspectProofUrl(
  input: ProofUrlInspectionInput,
  deps: ProofUrlDependencies = defaultDependencies,
): Promise<ProofUrlInspection> {
  const unsafeBehavior = input.unsafeBehavior ?? "throw";
  const parsedInput = parseAllowedUrl(input.url, input.platform);

  if (!parsedInput.safe) {
    return handleUnsafe(
      input.url.trim(),
      parsedInput.url?.toString() ?? input.url.trim(),
      unsafeBehavior,
      parsedInput.reason,
      deps,
    );
  }

  const normalizedUrl = parsedInput.url.toString();
  let currentUrl = parsedInput.url;
  let redirectCount = 0;

  while (true) {
    const destinationCheck = await validateResolvedDestination(
      currentUrl.hostname,
      deps,
    );
    if (destinationCheck === "network") {
      return unavailable(
        normalizedUrl,
        currentUrl.toString(),
        "network",
        deps,
      );
    }
    if (destinationCheck === "unsafe") {
      return handleUnsafe(
        normalizedUrl,
        currentUrl.toString(),
        unsafeBehavior,
        "URL resolved to a non-public address",
        deps,
      );
    }

    let response: Response;
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    try {
      response = await deps.fetch(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: {
          accept: "text/html,application/xhtml+xml",
        },
        signal,
      });
    } catch (error) {
      return unavailable(
        normalizedUrl,
        currentUrl.toString(),
        isTimeout(error, signal) ? "timeout" : "network",
        deps,
      );
    }

    if (isRedirect(response.status)) {
      if (redirectCount >= MAX_REDIRECTS) {
        await cancelBody(response);
        return unavailable(
          normalizedUrl,
          currentUrl.toString(),
          "too_many_redirects",
          deps,
        );
      }

      const location = response.headers.get("location");
      if (!location) {
        await cancelBody(response);
        return unavailable(
          normalizedUrl,
          currentUrl.toString(),
          "network",
          deps,
        );
      }

      let redirected: URL;
      try {
        redirected = new URL(location, currentUrl);
      } catch {
        await cancelBody(response);
        return handleUnsafe(
          normalizedUrl,
          location,
          unsafeBehavior,
          "Redirect URL is invalid",
          deps,
        );
      }

      const redirectPolicy = parseAllowedUrl(
        redirected.toString(),
        input.platform,
      );
      if (!redirectPolicy.safe) {
        await cancelBody(response);
        return handleUnsafe(
          normalizedUrl,
          redirectPolicy.url?.toString() ?? redirected.toString(),
          unsafeBehavior,
          redirectPolicy.reason,
          deps,
        );
      }

      await cancelBody(response);
      currentUrl = redirectPolicy.url;
      redirectCount += 1;
      continue;
    }

    if (isPlatformBlocked(response.status)) {
      await cancelBody(response);
      return unavailable(
        normalizedUrl,
        currentUrl.toString(),
        "platform_blocked",
        deps,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      await cancelBody(response);
      return unavailable(
        normalizedUrl,
        currentUrl.toString(),
        "network",
        deps,
      );
    }

    if (!isHtml(response.headers.get("content-type"))) {
      await cancelBody(response);
      return unavailable(
        normalizedUrl,
        currentUrl.toString(),
        "unsupported_content_type",
        deps,
      );
    }

    const declaredLength = parseContentLength(
      response.headers.get("content-length"),
    );
    if (
      declaredLength !== null &&
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      await cancelBody(response);
      return unavailable(
        normalizedUrl,
        currentUrl.toString(),
        "response_too_large",
        deps,
      );
    }

    const body = await readBoundedBody(response, signal);
    if (body.kind === "too_large") {
      return unavailable(
        normalizedUrl,
        currentUrl.toString(),
        "response_too_large",
        deps,
      );
    }
    if (body.kind === "timeout") {
      return unavailable(
        normalizedUrl,
        currentUrl.toString(),
        "timeout",
        deps,
      );
    }
    if (body.kind === "malformed") {
      return unavailable(
        normalizedUrl,
        currentUrl.toString(),
        "malformed_metadata",
        deps,
      );
    }

    const extracted = extractMetadata(body.html);
    const metadata = metadataSnapshot(
      currentUrl.toString(),
      extracted.malformed ? "unknown" : "success",
      deps,
      extracted,
    );

    if (extracted.malformed) {
      return {
        normalizedUrl,
        status: "unavailable",
        errorCategory: "malformed_metadata",
        metadata,
      };
    }

    return {
      normalizedUrl,
      status: "available",
      errorCategory: null,
      metadata,
    };
  }
}

function parseAllowedUrl(
  rawUrl: string,
  platform: keyof typeof PLATFORM_HOSTS,
):
  | { safe: true; url: URL }
  | { safe: false; url: URL | null; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { safe: false, url: null, reason: "URL is invalid" };
  }

  if (url.protocol !== "https:") {
    return { safe: false, url, reason: "URL must use HTTPS" };
  }
  if (url.username || url.password) {
    return { safe: false, url, reason: "URL credentials are not allowed" };
  }
  if (url.port !== "") {
    return { safe: false, url, reason: "URL must use the standard HTTPS port" };
  }

  const platformHosts = PLATFORM_HOSTS[platform];
  if (
    !platformHosts ||
    !(platformHosts as readonly string[]).includes(url.hostname)
  ) {
    return {
      safe: false,
      url,
      reason: "URL host is not allowed for the selected platform",
    };
  }

  return { safe: true, url };
}

async function validateResolvedDestination(
  hostname: string,
  deps: ProofUrlDependencies,
): Promise<"safe" | "unsafe" | "network"> {
  for (let check = 0; check < 2; check += 1) {
    let addresses: readonly { address: string; family: 4 | 6 }[];
    try {
      addresses = await deps.resolve(hostname);
    } catch {
      return "network";
    }

    if (addresses.length === 0) {
      return "network";
    }

    if (addresses.some((address) => !isPublicAddress(address))) {
      return "unsafe";
    }
  }

  // The native fetch contract cannot pin the just-approved address. This
  // second resolution narrows, but cannot eliminate, the DNS check/use race.
  return "safe";
}

function isPublicAddress(candidate: {
  address: string;
  family: 4 | 6;
}): boolean {
  const detectedFamily = isIP(candidate.address);
  if (detectedFamily !== candidate.family) {
    return false;
  }

  if (candidate.family === 4) {
    return isPublicIpv4(candidate.address);
  }

  return isPublicIpv6(candidate.address);
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) =>
        !Number.isInteger(octet) || octet < 0 || octet > 255,
    )
  ) {
    return false;
  }

  const [first, second, third] = octets as [number, number, number, number];

  return !(
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPublicIpv6(address: string): boolean {
  if (address.includes("%")) {
    return false;
  }

  const hextets = parseIpv6Hextets(address);
  if (!hextets) {
    return false;
  }

  const [first, second] = hextets;
  const inGlobalUnicast = first >= 0x2000 && first <= 0x3fff;
  const reservedProtocolAssignment =
    first === 0x2001 && second <= 0x01ff;
  const documentation =
    (first === 0x2001 && second === 0x0db8) ||
    (first === 0x3fff && second <= 0x0fff);
  const transition = first === 0x2002;

  return (
    inGlobalUnicast &&
    !reservedProtocolAssignment &&
    !documentation &&
    !transition
  );
}

function parseIpv6Hextets(address: string): number[] | null {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const ipv4Start = normalized.lastIndexOf(":") + 1;
    const octets = normalized.slice(ipv4Start).split(".").map(Number);
    if (octets.length !== 4) {
      return null;
    }

    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    normalized =
      `${normalized.slice(0, ipv4Start)}${high.toString(16)}:` +
      low.toString(16);
  }

  const compressed = normalized.split("::");
  if (compressed.length > 2) {
    return null;
  }

  const left = compressed[0] ? compressed[0].split(":") : [];
  const right = compressed[1] ? compressed[1].split(":") : [];
  const hasCompression = compressed.length === 2;
  const zeroCount = 8 - left.length - right.length;
  if (
    (hasCompression && zeroCount < 1) ||
    (!hasCompression && zeroCount !== 0)
  ) {
    return null;
  }

  const parts = [
    ...left,
    ...Array.from({ length: zeroCount }, () => "0"),
    ...right,
  ];
  const hextets = parts.map((part) => Number.parseInt(part, 16));
  return hextets.length === 8 && hextets.every(Number.isFinite)
    ? hextets
    : null;
}

function handleUnsafe(
  normalizedUrl: string,
  finalUrl: string,
  unsafeBehavior: "throw" | "report",
  reason: string,
  deps: ProofUrlDependencies,
): ProofUrlInspection {
  if (unsafeBehavior === "throw") {
    throw new ActiveMissionError(
      "UNSAFE_PROOF_URL",
      `UNSAFE_PROOF_URL: ${reason}`,
      { url: finalUrl },
    );
  }

  return {
    normalizedUrl,
    status: "unsafe",
    errorCategory: "unsafe_destination",
    metadata: metadataSnapshot(finalUrl, "unknown", deps),
  };
}

function unavailable(
  normalizedUrl: string,
  finalUrl: string,
  category: Exclude<
    ProofMetadataErrorCategory,
    "unsafe_destination"
  >,
  deps: ProofUrlDependencies,
): ProofUrlInspection {
  return {
    normalizedUrl,
    status: "unavailable",
    errorCategory: category,
    metadata: metadataSnapshot(finalUrl, "unknown", deps),
  };
}

function metadataSnapshot(
  finalCanonicalUrl: string,
  httpStatusCategory: ProofMetadataSnapshot["httpStatusCategory"],
  deps: ProofUrlDependencies,
  extracted?: Pick<
    ParsedMetadata,
    "pageTitle" | "openGraphType" | "declaredPublicationTime"
  >,
): ProofMetadataSnapshot {
  return {
    finalCanonicalUrl,
    httpStatusCategory,
    pageTitle: extracted?.pageTitle ?? null,
    openGraphType: extracted?.openGraphType ?? null,
    declaredPublicationTime: extracted?.declaredPublicationTime ?? null,
    fetchedAt: deps.now().toISOString(),
  };
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return true;
  }

  return (
    signal.aborted &&
    signal.reason instanceof DOMException &&
    (signal.reason.name === "TimeoutError" ||
      signal.reason.name === "AbortError")
  );
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function isPlatformBlocked(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }

  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "text/html" || mediaType === "application/xhtml+xml";
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) {
    return null;
  }

  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

async function readBoundedBody(
  response: Response,
  signal: AbortSignal,
): Promise<
  | { kind: "ok"; html: string }
  | { kind: "too_large" }
  | { kind: "timeout" }
  | { kind: "malformed" }
> {
  if (!response.body) {
    return { kind: "ok", html: "" };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(next.value);
    }
  } catch (error) {
    return {
      kind: isTimeout(error, signal) ? "timeout" : "malformed",
    };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      kind: "ok",
      html: new TextDecoder("utf-8", { fatal: true }).decode(body),
    };
  } catch {
    return { kind: "malformed" };
  }
}

function extractMetadata(html: string): ParsedMetadata {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = titleMatch
    ? boundedText(titleMatch[1].replace(/<[^>]*>/g, ""), MAX_TITLE_LENGTH)
    : null;

  let openGraphType: string | null = null;
  let publicationValue: string | null = null;
  let publicationDeclared = false;
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of metaTags) {
    const attributes = parseAttributes(tag);
    const key = (attributes.property ?? attributes.name)?.toLowerCase();
    if (key === "og:type" && openGraphType === null) {
      openGraphType = boundedText(
        attributes.content ?? "",
        MAX_OPEN_GRAPH_TYPE_LENGTH,
      );
    }
    if (
      (key === "article:published_time" ||
        key === "og:published_time") &&
      !publicationDeclared
    ) {
      publicationDeclared = true;
      publicationValue = attributes.content ?? "";
    }
  }

  let declaredPublicationTime: string | null = null;
  let malformed = false;
  if (publicationDeclared) {
    const timestamp = Date.parse(publicationValue ?? "");
    if (Number.isNaN(timestamp)) {
      malformed = true;
    } else {
      declaredPublicationTime = new Date(timestamp).toISOString();
    }
  }

  return {
    pageTitle: title,
    openGraphType,
    declaredPublicationTime,
    malformed,
  };
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern =
    /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(tag)) !== null) {
    const name = match[1].toLowerCase();
    if (!(name in attributes)) {
      attributes[name] = decodeHtmlEntities(
        match[2] ?? match[3] ?? match[4] ?? "",
      );
    }
  }

  return attributes;
}

function boundedText(value: string, maxLength: number): string | null {
  const normalized = decodeHtmlEntities(value)
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, encoded: string) => {
      const lower = encoded.toLowerCase();
      if (lower.startsWith("#x")) {
        return safeCodePoint(Number.parseInt(lower.slice(2), 16), entity);
      }
      if (lower.startsWith("#")) {
        return safeCodePoint(Number.parseInt(lower.slice(1), 10), entity);
      }

      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      return named[lower] ?? entity;
    },
  );
}

function safeCodePoint(codePoint: number, fallback: string): string {
  try {
    return Number.isInteger(codePoint) &&
      codePoint >= 0 &&
      codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : fallback;
  } catch {
    return fallback;
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The outcome of cleanup cannot widen the URL policy.
  }
}
