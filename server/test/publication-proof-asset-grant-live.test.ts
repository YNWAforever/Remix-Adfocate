import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  activeMissionIntegrationSkipReason,
  serviceForTests,
} from "./helpers";
import {
  seedPublicationProofReleaseFixture,
} from "./fixtures/publicationProofRelease";

const skipReason = activeMissionIntegrationSkipReason();
const integrationSuite = skipReason === null ? describe : describe.skip;
const { app } = createApp();

integrationSuite("publication proof asset grant live path", () => {
  it("creates a grant for the browser fixture's valid PNG evidence path", async () => {
    const fixture = await seedPublicationProofReleaseFixture();
    const response = await app.request(
      `/api/my-missions/${fixture.submission.id}/publication/${fixture.items.requiredMetadataSuccess.id}/assets/upload-grant`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fixture.creator.jwt}`,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
          "X-Workspace-Slug": fixture.workspace.slug,
        },
        body: JSON.stringify({
          expectedState: "approved_to_publish",
          expectedRevision: 0,
          fileName: "browser-proof.png",
          contentType: "image/png",
          sizeBytes: 22_547,
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      asset?: { id?: string; uploadState?: string };
      expiresInSeconds?: number;
    };
    try {
      expect(body.asset).toMatchObject({ uploadState: "pending" });
      expect(body.expiresInSeconds).toBeGreaterThan(0);
    } finally {
      if (body.asset?.id) {
        const removed = await serviceForTests()
          .from("mission_publication_proof_assets")
          .delete()
          .eq("id", body.asset.id);
        expect(removed.error).toBeNull();
      }
    }
  });
});
