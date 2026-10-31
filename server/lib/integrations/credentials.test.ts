// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CredentialVault, digest } from "./credentials.js";

describe("integration credential envelope", () => {
  it("encrypts, authenticates owner/workspace/provider and rotates keys without exposing plaintext", async () => {
    const vault=new CredentialVault(new Uint8Array(32).fill(7),"key-v1");
    const identity="workspace:creator:instagram", plaintext={accessToken:"mock-access",refreshToken:"mock-refresh"};
    const envelope=await vault.seal(plaintext,identity);
    expect(JSON.stringify(envelope)).not.toContain("mock-access");
    expect(await vault.open(envelope,identity)).toEqual(plaintext);
    await expect(vault.open(envelope,"workspace:other:instagram")).rejects.toThrow("CREDENTIAL_UNAVAILABLE");
    await expect(new CredentialVault(new Uint8Array(32).fill(8),"key-v2").open(envelope,identity)).rejects.toThrow();
    const tampered={...envelope,ciphertext:envelope.ciphertext.slice(0,-2)+"00"};
    await expect(vault.open(tampered,identity)).rejects.toThrow();
    expect(await digest("private source")).toHaveLength(64);
  });
});
