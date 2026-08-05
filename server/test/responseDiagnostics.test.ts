import { describe, expect, it, vi } from "vitest";
import {
  classifyPublicationProofGrantBoundary,
  cleanupPublicationProofProbeAsset,
  expectSuccessfulResponse,
  sanitizeDiagnosticText,
} from "./responseDiagnostics";

describe("integration response diagnostics", () => {
  it("does not consume a successful response body", async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await expectSuccessfulResponse(response, "success");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("redacts credential key-value pairs and UUID-like identifiers", () => {
    const sanitized = sanitizeDiagnosticText(
      "api_key=api-secret token=token-secret secret=secret-value password=password-value authorization=authorization-value",
    );
    const identifier = sanitizeDiagnosticText("11111111-1111-9111-c111-111111111111");

    expect(sanitized).toContain("api_key=[REDACTED_CREDENTIAL]");
    expect(sanitized).toContain("token=[REDACTED_CREDENTIAL]");
    expect(sanitized).toContain("secret=[REDACTED_CREDENTIAL]");
    expect(sanitized).toContain("password=[REDACTED_CREDENTIAL]");
    expect(sanitized).toContain("authorization=[REDACTED_CREDENTIAL]");
    expect(identifier).toBe("[REDACTED_ID]");
    expect(sanitized).not.toContain("api-secret");
    expect(identifier).not.toContain("11111111-1111-9111-c111-111111111111");
  });

  it("emits only status, safe code, and category for selected failure fields", async () => {
    const response = new Response(JSON.stringify({
      code: "UNKNOWN",
      error: "authored content in error must not be printed api_key=api-secret",
      message: "authored content in message must not be printed 11111111-1111-9111-c111-111111111111",
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
    expect(thrown).toContain('"category":"system_failure"');
    expect(thrown).not.toContain("authored content in error");
    expect(thrown).not.toContain("authored content in message");
    expect(thrown).not.toContain("api-secret");
    expect(thrown).not.toContain("11111111-1111-9111-c111-111111111111");
    expect(thrown).not.toContain("authored content must not be printed");
  });

  it("emits only a fixed publication-proof failure boundary", async () => {
    expect(classifyPublicationProofGrantBoundary({ workspaceOk: false })).toBe("workspace_lookup");
    expect(classifyPublicationProofGrantBoundary({ workspaceOk: true, rpcOk: false })).toBe("publication_rpc");
    expect(classifyPublicationProofGrantBoundary({ workspaceOk: true, rpcOk: true, signingOk: false })).toBe("storage_signing");
    expect(classifyPublicationProofGrantBoundary({ workspaceOk: true, rpcOk: true, signingOk: true })).toBe("route_or_unknown");

    const response = new Response(JSON.stringify({
      error: "authored content must not be printed",
    }), { status: 500 });
    let thrown = "";
    try {
      await expectSuccessfulResponse(response, "grant", "publication_rpc");
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }

    expect(thrown).toContain('"boundary":"publication_rpc"');
    expect(thrown).not.toContain("authored content must not be printed");
  });

  it("falls back to deleting a probe asset when guarded cleanup cannot complete", async () => {
    const deleteMissingPath = vi.fn().mockResolvedValue(undefined);
    const abandonMissingPath = vi.fn();
    await cleanupPublicationProofProbeAsset({
      assetId: "asset-id",
      storageObjectPath: undefined,
      abandon: abandonMissingPath,
      fallbackDelete: deleteMissingPath,
    });
    expect(abandonMissingPath).not.toHaveBeenCalled();
    expect(deleteMissingPath).toHaveBeenCalledOnce();

    const deleteAfterThrow = vi.fn().mockResolvedValue(undefined);
    await cleanupPublicationProofProbeAsset({
      assetId: "asset-id",
      storageObjectPath: "object-path",
      abandon: vi.fn().mockRejectedValue(new Error("raw service error")),
      fallbackDelete: deleteAfterThrow,
    });
    expect(deleteAfterThrow).toHaveBeenCalledOnce();

    const deleteAfterError = vi.fn().mockResolvedValue(undefined);
    await cleanupPublicationProofProbeAsset({
      assetId: "asset-id",
      storageObjectPath: "object-path",
      abandon: vi.fn().mockResolvedValue({ error: new Error("raw service error") }),
      fallbackDelete: deleteAfterError,
    });
    expect(deleteAfterError).toHaveBeenCalledOnce();
  });
});
