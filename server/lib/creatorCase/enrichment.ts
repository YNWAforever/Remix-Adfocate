import type { CreatorCaseEnrichment } from "./types.js";

export async function readOptional<T>(read: () => Promise<T>): Promise<CreatorCaseEnrichment<T>> {
  try {
    return { status: "available", value: await read() };
  } catch {
    return { status: "unavailable", reason: "source_error" };
  }
}
