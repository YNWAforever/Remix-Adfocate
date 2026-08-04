import { describe, expect, it, vi } from "vitest";
import { verifyDeployment } from "./deployment";

const expectedSchemaFingerprint = "a".repeat(64);

function successfulFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "dpl_1",
          readyState: "READY",
          target: "production",
          meta: { githubCommitSha: "abc123", githubCommitRef: "main" },
          alias: ["adfocate-2.vercel.app"],
          secretField: "must-not-be-copied",
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    .mockResolvedValueOnce(new Response("<!doctype html>", { status: 200 }));
}

const baseInput = {
  deploymentId: "dpl_1",
  teamId: "team_1",
  token: "vercel-secret",
  expectedCommit: "abc123",
  productionAlias: "adfocate-2.vercel.app",
  appOrigin: "https://adfocate-2.vercel.app",
  expectedSchemaFingerprint,
};

describe("production deployment verification", () => {
  it("requires READY production deployment at the expected commit and healthy URLs", async () => {
    const fetch = successfulFetch();

    const report = await verifyDeployment(baseInput, { fetch });

    expect(report).toMatchObject({
      status: "passed",
      deploymentId: "dpl_1",
      commit: "abc123",
      productionAlias: "adfocate-2.vercel.app",
      schemaFingerprint: expectedSchemaFingerprint,
      deploymentStatusCode: 200,
      healthStatusCode: 200,
      homeStatusCode: 200,
    });
    expect(report.verifiedAt).toEqual(expect.any(String));
    expect(JSON.stringify(report)).not.toContain("vercel-secret");
    expect(JSON.stringify(report)).not.toContain("secretField");
  });

  it("uses the Vercel bearer token and team-scoped deployment URL without exposing headers", async () => {
    const fetch = successfulFetch();

    await verifyDeployment(baseInput, { fetch });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.vercel.com/v13/deployments/dpl_1?teamId=team_1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer vercel-secret",
          Accept: "application/json",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://adfocate-2.vercel.app/api/health",
      expect.anything(),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://adfocate-2.vercel.app/home",
      expect.anything(),
    );
  });

  it("fails closed when deployment identity does not match production", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "dpl_1",
          readyState: "BUILDING",
          target: "preview",
          meta: { githubCommitSha: "other", githubCommitRef: "feature" },
          alias: ["preview-adfocate.vercel.app"],
        }),
        { status: 200 },
      ),
    );

    await expect(verifyDeployment(baseInput, { fetch })).rejects.toThrow(
      "deployment identity verification failed",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("requires a healthy API response and home response", async () => {
    const healthFailure = successfulFetch();
    healthFailure.mockReset();
    healthFailure
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "dpl_1",
            readyState: "READY",
            target: "production",
            meta: { githubCommitSha: "abc123", githubCommitRef: "main" },
            alias: ["adfocate-2.vercel.app"],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 200 }));

    await expect(verifyDeployment(baseInput, { fetch: healthFailure })).rejects.toThrow(
      "health check failed",
    );

    const homeFailure = successfulFetch();
    homeFailure.mockReset();
    homeFailure
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "dpl_1",
            readyState: "READY",
            target: "production",
            meta: { githubCommitSha: "abc123", githubCommitRef: "main" },
            alias: ["adfocate-2.vercel.app"],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response("error", { status: 503 }));

    await expect(verifyDeployment(baseInput, { fetch: homeFailure })).rejects.toThrow(
      "home check failed",
    );
  });

  it("redacts token and URLs from request failures", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error(
      "request failed for https://api.vercel.com?token=vercel-secret Authorization: Bearer vercel-secret",
    ));

    await expect(verifyDeployment(baseInput, { fetch })).rejects.toThrow(
      "deployment request failed",
    );
    await expect(verifyDeployment(baseInput, { fetch })).rejects.not.toThrow("vercel-secret");
  });
});
