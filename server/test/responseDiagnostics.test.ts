import { describe, expect, it } from "vitest";
import { expectSuccessfulResponse } from "./responseDiagnostics";

describe("integration response diagnostics", () => {
  it("does not consume a successful response body", async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await expectSuccessfulResponse(response, "success");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("keeps only stable fields and redacts sensitive values", async () => {
    const response = new Response(JSON.stringify({
      code: "UNKNOWN",
      error: "request https://example.test/upload?token=secret for alice@example.test",
      message: "Bearer secret-token eyJheader.payload.signature 11111111-1111-4111-8111-111111111111",
      details: "authored content must not be printed",
    }), { status: 500 });
    let thrown = "";
    try {
      await expectSuccessfulResponse(response, "grant");
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }

    expect(thrown).toContain('"status":500');
    expect(thrown).toContain('"code":"UNKNOWN"');
    expect(thrown).not.toContain("secret-token");
    expect(thrown).not.toContain("example.test");
    expect(thrown).not.toContain("alice@example.test");
    expect(thrown).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(thrown).not.toContain("authored content must not be printed");
  });
});
