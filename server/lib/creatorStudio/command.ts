import { createHash } from "node:crypto";

export type CanonicalCommandValue = null | boolean | number | string
  | CanonicalCommandValue[] | { [key: string]: CanonicalCommandValue };

const nonJsonCommand = (): never => {
  throw new TypeError("Creator Studio commands must be JSON serializable");
};

const canonicalize = (value: unknown, ancestors: WeakSet<object>): CanonicalCommandValue => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : nonJsonCommand();
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return nonJsonCommand();
    ancestors.add(value);
    const canonical = value.map((nested) => canonicalize(nested, ancestors));
    ancestors.delete(value);
    return canonical;
  }
  if (typeof value !== "object") return nonJsonCommand();

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return nonJsonCommand();
  if (ancestors.has(value)) return nonJsonCommand();
  ancestors.add(value);
  const canonical = Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested, ancestors)]),
  ) as { [key: string]: CanonicalCommandValue };
  ancestors.delete(value);
  return canonical;
};

export const canonicalizeCommand = (value: unknown): CanonicalCommandValue => canonicalize(value, new WeakSet<object>());

export const serializeCommand = (value: unknown): string => {
  const serialized = JSON.stringify(canonicalizeCommand(value));
  if (serialized === undefined) return nonJsonCommand();
  return serialized;
};

export const hashCommand = (value: unknown): string => createHash("sha256")
  .update(serializeCommand(value))
  .digest("hex");
