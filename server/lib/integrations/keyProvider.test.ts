// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RotatingCredentialVault, keySourceFromSecret } from "./keyProvider.js";

describe("persistent integration key source", () => {
  const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");
  const secret = (activeKeyId = "v1") => JSON.stringify({ activeKeyId, keys: { v1: key(7), v2: key(9) } });
  it("survives restart and rewraps an old envelope without losing its owner binding", async () => {
    const first = new RotatingCredentialVault(keySourceFromSecret(secret()));
    const envelope = await first.seal({ accessToken: "synthetic-only" }, "w1:c1:ig:1");
    const restarted = new RotatingCredentialVault(keySourceFromSecret(secret("v2")));
    expect(await restarted.open(envelope, "w1:c1:ig:1")).toEqual({ accessToken: "synthetic-only" });
    await expect(restarted.open(envelope, "w2:c1:ig:1")).rejects.toThrow("CREDENTIAL_UNAVAILABLE");
    const rotated = await restarted.rewrap(envelope, "w1:c1:ig:1");
    expect(rotated.keyId).toBe("v2");
    expect(await first.open(rotated, "w1:c1:ig:1")).toEqual({ accessToken: "synthetic-only" });
    expect(JSON.stringify(rotated)).not.toContain("synthetic-only");
  });
  it("fails closed for absent, invalid or retired keys instead of generating a replacement", async () => {
    for (const input of [undefined, "{}", "bad-json", JSON.stringify({ activeKeyId: "v1", keys: { v1: "short" } })]) {
      expect(() => keySourceFromSecret(input)).toThrow("CREDENTIAL_UNAVAILABLE");
    }
    const vault = new RotatingCredentialVault(keySourceFromSecret(secret()));
    const envelope = await vault.seal({ token: "private" }, "owner");
    const retired = new RotatingCredentialVault(keySourceFromSecret(JSON.stringify({activeKeyId:"v2",keys:{v2:key(9)}})));
    await expect(retired.open(envelope, "owner")).rejects.toThrow("CREDENTIAL_UNAVAILABLE");
  });
});
