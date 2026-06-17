import { createHash, randomBytes } from "node:crypto";

export function createPublicToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashPublicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
