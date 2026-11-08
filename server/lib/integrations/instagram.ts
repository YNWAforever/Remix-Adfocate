import { digest } from "./credentials.js";
import { normalizeMetric } from "./policy.js";
import type { EvidenceValue, ProviderSnapshot } from "./types.js";

function normalizeMockMetric(value: unknown): EvidenceValue {
  if (typeof value === "object" && value !== null && "availability" in value) {
    const availability = value.availability;
    if (availability === "unsupported" || availability === "stale") {
      return { value: null, availability, reason: availability === "unsupported" ? "此指標不支援，未驗證" : "資料已過期，未驗證" };
    }
  }
  return normalizeMetric(value);
}

/** A versioned adapter contract, not a claim that live Meta metrics were accepted. */
export async function normalizeInstagramMedia(input: { id: string; title: string; version: string; observedAt: string; metrics: Record<string, unknown> }, now: Date, partial = false): Promise<ProviderSnapshot> {
  const metrics = Object.fromEntries(["reach", "views", "likes", "saves"].map(name => [name, normalizeMockMetric(input.metrics[name])]));
  const excerpt = `${input.title}（模擬資料）\n${Object.entries(metrics).map(([name, metric]) => `${name}: ${metric.value ?? "資料不足／未驗證"}`).join("\n")}\n範圍：此則媒體；不代表所有廣告互動。`;
  return { resourceId: input.id, title: input.title, sourceVersion: input.version, contentHash: await digest(JSON.stringify({ metrics, version: input.version })),
    fetchedAt: now.toISOString(), observedAt: input.observedAt,
    // The service's media sampling window is not a measurement period for these counts.
    period: null,
    coverage: { region: null, language: null, partial }, metrics, excerpt };
}
