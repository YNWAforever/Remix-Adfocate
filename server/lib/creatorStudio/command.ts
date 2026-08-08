import { createHash } from "node:crypto";

export const canonicalizeCommand = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeCommand);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeCommand(nested)]),
    );
  }
  return value;
};

export const serializeCommand = (value: unknown): string => JSON.stringify(canonicalizeCommand(value));

export const hashCommand = (value: unknown): string => createHash("sha256")
  .update(serializeCommand(value))
  .digest("hex");
