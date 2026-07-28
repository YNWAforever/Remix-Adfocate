import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

type FixtureBaseline = {
  attemptId: string;
  item: {
    state: string;
    current_proof_attempt_id: string | null;
    verified_proof_attempt_id: string | null;
    current_reviewer_id: string | null;
    review_started_at: string | null;
    review_due_at: string | null;
    updated_at: string;
  };
  workflow: {
    state: string;
    updated_at: string;
  };
  instruction: {
    revision: number;
  };
};

function sqlLiteral(value: string | number | null) {
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function localDatabaseContainer() {
  const config = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!projectId) throw new Error("Local Supabase project_id is unavailable.");
  return `supabase_db_${projectId}`;
}

function restoreFixtureBaseline(
  fixture: PublicationProofReleaseFixture,
  baseline: FixtureBaseline,
) {
  const sql = `
begin;
set local client_min_messages = warning;
alter table public.mission_work_items disable trigger user;
alter table public.mission_workflows disable trigger user;
alter table public.mission_workflow_events disable trigger user;
alter table public.mission_publication_instructions disable trigger user;
alter table public.mission_publication_proof_assets disable trigger user;
alter table public.mission_publication_proof_review_items disable trigger user;
alter table public.mission_publication_proof_reviews disable trigger user;
alter table public.mission_publication_proof_attempts disable trigger user;

delete from public.mission_publication_proof_review_items
where mission_publication_proof_review_id in (
  select id from public.mission_publication_proof_reviews
  where mission_publication_proof_attempt_id = ${sqlLiteral(baseline.attemptId)}
);
delete from public.mission_publication_proof_reviews
where mission_publication_proof_attempt_id = ${sqlLiteral(baseline.attemptId)};
update public.mission_publication_proof_assets
set mission_publication_proof_attempt_id = null
where mission_publication_proof_attempt_id = ${sqlLiteral(baseline.attemptId)};
update public.mission_work_items
set state = ${sqlLiteral(baseline.item.state)},
    current_proof_attempt_id = ${sqlLiteral(baseline.item.current_proof_attempt_id)},
    verified_proof_attempt_id = ${sqlLiteral(baseline.item.verified_proof_attempt_id)},
    current_reviewer_id = ${sqlLiteral(baseline.item.current_reviewer_id)},
    review_started_at = ${sqlLiteral(baseline.item.review_started_at)},
    review_due_at = ${sqlLiteral(baseline.item.review_due_at)},
    updated_at = ${sqlLiteral(baseline.item.updated_at)}
where id = ${sqlLiteral(fixture.items.optionalEvidence.id)}
  and workspace_id = ${sqlLiteral(fixture.workspace.id)};
update public.mission_publication_instructions
set revision = ${sqlLiteral(baseline.instruction.revision)}
where mission_work_item_id = ${sqlLiteral(fixture.items.optionalEvidence.id)}
  and workspace_id = ${sqlLiteral(fixture.workspace.id)};
delete from public.mission_workflow_events
where entity_type = 'mission_publication_proof_attempt'
  and entity_id = ${sqlLiteral(baseline.attemptId)}
  and mission_workflow_id = ${sqlLiteral(fixture.workflow.id)};
delete from public.mission_publication_proof_attempts
where id = ${sqlLiteral(baseline.attemptId)};
update public.mission_workflows
set state = ${sqlLiteral(baseline.workflow.state)},
    updated_at = ${sqlLiteral(baseline.workflow.updated_at)}
where id = ${sqlLiteral(fixture.workflow.id)}
  and workspace_id = ${sqlLiteral(fixture.workspace.id)};

alter table public.mission_publication_proof_attempts enable trigger user;
alter table public.mission_publication_proof_reviews enable trigger user;
alter table public.mission_publication_proof_review_items enable trigger user;
alter table public.mission_publication_proof_assets enable trigger user;
alter table public.mission_publication_instructions enable trigger user;
alter table public.mission_workflow_events enable trigger user;
alter table public.mission_workflows enable trigger user;
alter table public.mission_work_items enable trigger user;
commit;
`;
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      localDatabaseContainer(),
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { encoding: "utf8", input: sql },
  );
  if (result.status !== 0) {
    throw new Error("Could not restore the local publication-proof fixture baseline.");
  }
}

integrationSuite("publication proof operator read routes live path", () => {
  let fixture: PublicationProofReleaseFixture;
  let baseline: FixtureBaseline | undefined;

  beforeAll(async () => {
    fixture = await seedPublicationProofReleaseFixture();
    const svc = serviceForTests();
    const [item, workflow, instruction] = await Promise.all([
      svc.from("mission_work_items")
        .select("state, current_proof_attempt_id, verified_proof_attempt_id, current_reviewer_id, review_started_at, review_due_at, updated_at")
        .eq("id", fixture.items.optionalEvidence.id)
        .single(),
      svc.from("mission_workflows")
        .select("state, updated_at")
        .eq("id", fixture.workflow.id)
        .single(),
      svc.from("mission_publication_instructions")
        .select("revision")
        .eq("mission_work_item_id", fixture.items.optionalEvidence.id)
        .single(),
    ]);
    expect(item.error).toBeNull();
    expect(workflow.error).toBeNull();
    expect(instruction.error).toBeNull();

    const submitted = await svc.rpc(
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
    baseline = {
      attemptId: submitted.data.attempt.id as string,
      item: item.data!,
      workflow: workflow.data!,
      instruction: instruction.data!,
    };
  });

  afterAll(async () => {
    if (!baseline) return;
    restoreFixtureBaseline(fixture, baseline);
    await seedPublicationProofReleaseFixture();
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
