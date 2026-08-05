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
import {
  classifyPublicationProofGrantBoundary,
  cleanupPublicationProofProbeAsset,
  expectSuccessfulResponse,
  type PublicationProofGrantBoundary,
} from "./responseDiagnostics";

const skipReason = activeMissionIntegrationSkipReason();
const integrationSuite = skipReason === null ? describe : describe.skip;
const { app } = createApp();

async function diagnoseGrantFailureBoundary(input: {
  creatorId: string;
  creatorJwt: string;
  workspaceSlug: string;
  workspaceId: string;
  submissionId: string;
  workflowId: string;
  workItemId: string;
  idempotencyKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<PublicationProofGrantBoundary> {
  let workspaceResponse: Response;
  try {
    workspaceResponse = await app.request(
      `/api/my-missions/${input.submissionId}/workspace`,
      {
        headers: {
          Authorization: `Bearer ${input.creatorJwt}`,
          "X-Workspace-Slug": input.workspaceSlug,
        },
      },
    );
  } catch {
    return classifyPublicationProofGrantBoundary({ workspaceOk: false });
  }
  if (!workspaceResponse.ok) {
    return classifyPublicationProofGrantBoundary({ workspaceOk: false });
  }

  const extension = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["video/mp4", "mp4"],
    ["video/quicktime", "mov"],
    ["video/webm", "webm"],
  ]).get(input.contentType);
  if (!extension) return "route_or_unknown";

  const service = serviceForTests();
  const storageObjectPath = `${input.creatorId}/${input.workflowId}/${input.workItemId}/proof-evidence/${input.idempotencyKey}.${extension}`;
  let rpc: { data: unknown; error: unknown };
  try {
    rpc = await service.rpc("create_publication_proof_asset", {
      p_submission: input.submissionId,
      p_creator: input.creatorId,
      p_workspace: input.workspaceId,
      p_work_item: input.workItemId,
      p_filename: input.fileName,
      p_mime_type: input.contentType,
      p_byte_size: input.sizeBytes,
      p_storage_object_path: storageObjectPath,
      p_grant_seconds: 600,
      p_expected_state: "approved_to_publish",
      p_expected_revision: 0,
      p_idempotency_key: input.idempotencyKey,
    });
  } catch {
    return classifyPublicationProofGrantBoundary({ workspaceOk: true, rpcOk: false });
  }
  const row = rpc.data as { id?: string; storage_object_path?: string } | null;
  if (!row?.id) {
    return classifyPublicationProofGrantBoundary({ workspaceOk: true, rpcOk: false });
  }
  const cleanup = () => cleanupPublicationProofProbeAsset({
    assetId: row.id,
    workspaceId: input.workspaceId,
    creatorId: input.creatorId,
    submissionId: input.submissionId,
    workItemId: input.workItemId,
    storageObjectPath: row.storage_object_path,
    abandon: async () => await service.rpc("abandon_publication_proof_asset", {
      p_submission: input.submissionId,
      p_creator: input.creatorId,
      p_workspace: input.workspaceId,
      p_work_item: input.workItemId,
      p_asset: row.id,
      p_storage_object_path: row.storage_object_path,
    }),
    fallbackDelete: async (scope) => {
      const deletion = service
        .from("mission_publication_proof_assets")
        .delete()
        .eq("id", scope.assetId)
        .eq("workspace_id", scope.workspaceId)
        .eq("creator_id", scope.creatorId)
        .eq("mission_submission_id", scope.submissionId)
        .eq("mission_work_item_id", scope.workItemId)
        .eq("upload_state", scope.uploadState);
      return await (scope.storageObjectPath
        ? deletion.eq("storage_object_path", scope.storageObjectPath)
        : deletion);
    },
  });
  if (rpc.error || !row.storage_object_path) {
    await cleanup();
    return classifyPublicationProofGrantBoundary({ workspaceOk: true, rpcOk: false });
  }

  try {
    const signed = await service.storage
      .from("mission-publication-proof-assets")
      .createSignedUploadUrl(row.storage_object_path, { upsert: false });
    return classifyPublicationProofGrantBoundary({
      workspaceOk: true,
      rpcOk: true,
      signingOk: !signed.error && Boolean(signed.data?.token),
    });
  } catch {
    return classifyPublicationProofGrantBoundary({
      workspaceOk: true,
      rpcOk: true,
      signingOk: false,
    });
  } finally {
    await cleanup();
  }
}

integrationSuite("publication proof asset grant live path", () => {
  it("creates a grant for the browser fixture's valid PNG evidence path", async () => {
    const fixture = await seedPublicationProofReleaseFixture();
    const grantKey = randomUUID();
    const response = await app.request(
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
          fileName: "browser-proof.png",
          contentType: "image/png",
          sizeBytes: 22_547,
        }),
      },
    );

    const boundary = response.ok ? undefined : await diagnoseGrantFailureBoundary({
      creatorId: fixture.creator.id,
      creatorJwt: fixture.creator.jwt,
      workspaceSlug: fixture.workspace.slug,
      workspaceId: fixture.workspace.id,
      submissionId: fixture.submission.id,
      workflowId: fixture.workflow.id,
      workItemId: fixture.items.requiredMetadataSuccess.id,
      idempotencyKey: grantKey,
      fileName: "browser-proof.png",
      contentType: "image/png",
      sizeBytes: 22_547,
    });
    await expectSuccessfulResponse(response, "PNG publication proof grant", boundary);
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

    const boundary = grantResponse.ok ? undefined : await diagnoseGrantFailureBoundary({
      creatorId: fixture.creator.id,
      creatorJwt: fixture.creator.jwt,
      workspaceSlug: fixture.workspace.slug,
      workspaceId: fixture.workspace.id,
      submissionId: fixture.submission.id,
      workflowId: fixture.workflow.id,
      workItemId: fixture.items.requiredMetadataSuccess.id,
      idempotencyKey: grantKey,
      fileName: `proof-${grantKey}`,
      contentType,
      sizeBytes: bytes.byteLength,
    });
    await expectSuccessfulResponse(
      grantResponse,
      "GIF or MP4 publication proof grant",
      boundary,
    );
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
