import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  activeMissionIntegrationSkipReason,
  serviceForTests,
} from "./helpers";
import {
  seedPublicationProofReleaseFixture,
  type PublicationProofReleaseFixture,
} from "./fixtures/publicationProofRelease";

const skipReason = activeMissionIntegrationSkipReason();
const integrationSuite = skipReason === null ? describe : describe.skip;
const { app } = createApp();

integrationSuite("publication proof operator read routes live path", () => {
  let fixture: PublicationProofReleaseFixture;

  beforeAll(async () => {
    fixture = await seedPublicationProofReleaseFixture();
    const submitted = await serviceForTests().rpc(
      "submit_mission_publication_proof",
      {
        p_submission: fixture.submission.id,
        p_creator: fixture.creator.id,
        p_workspace: fixture.workspace.id,
        p_work_item: fixture.items.optionalEvidence.id,
        p_expected_state: "approved_to_publish",
        p_expected_revision: 0,
        p_idempotency_key: randomUUID(),
        p_proof: {
          primary_url: `https://www.instagram.com/p/${randomUUID()}`,
          additional_urls: [],
          metadata_status: "unavailable",
          metadata_snapshot: {},
          metadata_error_category: "platform_blocked",
        },
        p_evidence_asset_ids: [],
      },
    );
    expect(submitted.error).toBeNull();
  });

  const headers = () => ({
    Authorization: `Bearer ${fixture.operator.jwt}`,
    "X-Workspace-Slug": fixture.workspace.slug,
  });

  it("loads the browser queue through the live PostgREST relationships", async () => {
    const response = await app.request("/api/admin/active-missions/queue", {
      headers: headers(),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { items?: Array<{ deliverableTitle?: string }> };
    expect(body.items?.map((item) => item.deliverableTitle)).toEqual(["Optional evidence"]);
  });

  it("loads the browser detail through the live PostgREST relationships", async () => {
    const response = await app.request(
      `/api/admin/active-missions/${fixture.workflow.id}`,
      { headers: headers() },
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      submission?: unknown;
      workItems?: Array<unknown>;
    };
    expect(body.submission).toBeTruthy();
    expect(body.workItems).toHaveLength(4);
  });
});
