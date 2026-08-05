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
import { expectSuccessfulResponse } from "./responseDiagnostics";

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

    await expectSuccessfulResponse(response, "PNG publication proof grant");
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
  it.each([
    ["GIF", "image/gif", new Uint8Array([0x47, 0x49, 0x46, 0x38])],
    ["MP4", "video/mp4", new Uint8Array([0x00, 0x00, 0x00, 0x18])],
  ] as const)("uploads and finalizes %s evidence", async (_label, contentType, bytes) => {
    const fixture = await seedPublicationProofReleaseFixture();
    const grantKey = randomUUID();
    const grantResponse = await app.request(
      `/api/my-missions/${fixture.submission.id}/publication/${fixture.items.requiredMetadataSuccess.id}/assets/upload-grant`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fixture.creator.jwt}`,
          "Content-Type": "application/json",
          "Idempotency-Key": grantKey,
          "X-Workspace-Slug": fixture.workspace.slug,
        },
        body: JSON.stringify({
          expectedState: "approved_to_publish",
          expectedRevision: 0,
          fileName: `proof-${grantKey}`,
          contentType,
          sizeBytes: bytes.byteLength,
        }),
      },
    );

    await expectSuccessfulResponse(grantResponse, "GIF or MP4 publication proof grant");
    const grant = await grantResponse.json() as {
      asset: { id: string; storageObjectPath: string; uploadState: string };
      token: string;
    };
    const uploaded = await serviceForTests()
      .storage
      .from("mission-publication-proof-assets")
      .uploadToSignedUrl(grant.asset.storageObjectPath, grant.token, bytes, { contentType });
    expect(uploaded.error).toBeNull();

    const finalizeResponse = await app.request(
      `/api/my-missions/${fixture.submission.id}/publication/${fixture.items.requiredMetadataSuccess.id}/assets/${grant.asset.id}/finalize`,
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
          checksum: `sha256-${grantKey}`,
        }),
      },
    );

    await expectSuccessfulResponse(finalizeResponse, "GIF or MP4 publication proof finalize");
    expect(await finalizeResponse.json()).toMatchObject({
      asset: { id: grant.asset.id, uploadState: "finalized", contentType },
    });
    const removed = await serviceForTests()
      .storage
      .from("mission-publication-proof-assets")
      .remove([grant.asset.storageObjectPath]);
    expect(removed.error).toBeNull();
  });
});
