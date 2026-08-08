import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { InMemoryCreatorStudioRepository } from "../lib/creatorStudio/inMemoryRepository.js";
import type { CreatorStudioRepository } from "../lib/creatorStudio/repository.js";
import { SupabaseCreatorStudioRepository } from "../lib/creatorStudio/supabaseRepository.js";
import type { SubmissionWorkspace } from "../lib/creatorStudio/types.js";
import type { Env } from "../app.js";
import { createCreatorStudioRoutes } from "../routes/creatorStudio.js";

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const workspace = (): SubmissionWorkspace => ({
  submission: { id: "submission-1", creatorId: "creator-1", workspaceId: "workspace-1", missionId: "mission-1", status: "joined" },
  brief: { missionId: "mission-1", title: "Launch", deliverables: ["Proof"], requirements: [], platforms: ["instagram"] },
  workflow: { id: "workflow-1", state: "not_started", revision: 0 },
  workItems: [{
    id: "work-item-1", position: 1, title: "Proof", instructions: "Post proof",
    requirements: { caption: true, externalUrl: true, checklist: ["disclosure"] }, requiresAsset: true,
    state: "not_started", validation: { caption: false, externalUrl: false, checklist: false, assets: false },
    draft: null, assets: [], reviewFeedback: { status: "available", value: [] },
  }],
  nextAction: { workItemId: "work-item-1", state: "not_started", label: "Start Proof" },
});

const appFor = (repository: CreatorStudioRepository) => {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("userId", "creator-1");
    c.set("workspaceId", "workspace-1");
    c.set("jwt", "test-jwt");
    await next();
  });
  app.route("/my-missions", createCreatorStudioRoutes({ repositoryForRequest: () => repository }));
  return app;
};

const draftPath = "/my-missions/submission-1/work-items/work-item-1/draft";
const grantPath = "/my-missions/submission-1/work-items/work-item-1/assets/upload-grant";
const submitPath = "/my-missions/submission-1/work-items/work-item-1/submit";
const commandMigrationPath = resolve(process.cwd(), "supabase/migrations/20260809103000_creator_studio_command_rpc.sql");

const completeWorkItem = async (app: Hono<Env>, prefix: string) => {
  const draft = await app.request(draftPath, json({
    command_id: `${prefix}-draft`, expected_version: 0,
    patch: { caption: "A caption", external_url: "https://example.com/post", checklist: { disclosure: true } },
  }, "PATCH"));
  const grant = await app.request(grantPath, json({
    command_id: `${prefix}-grant`, file_name: "proof.png", mime_type: "image/png", byte_size: 1024,
  }));
  const { assetId } = await grant.json() as { assetId: string };
  const finalized = await app.request(`/my-missions/submission-1/work-items/work-item-1/assets/${assetId}/finalize`, json({
    command_id: `${prefix}-finalize`, byte_size: 1024, mime_type: "image/png", checksum_sha256: null,
  }));

  expect(draft.status).toBe(200);
  expect(grant.status).toBe(200);
  expect(finalized.status).toBe(200);
};

describe("Creator Studio mutation routes", () => {
  it("saves a draft, returns a replay snapshot, and rejects a stale version without overwriting", async () => {
    const repository = new InMemoryCreatorStudioRepository({ workspace: workspace() });
    const app = appFor(repository);
    const command = {
      command_id: "draft-1", expected_version: 0,
      patch: { caption: "A caption", external_url: "https://example.com/post", checklist: { disclosure: true } },
    };

    const first = await app.request(draftPath, json(command, "PATCH"));
    const replay = await app.request(draftPath, json(command, "PATCH"));
    const stale = await app.request(draftPath, json({
      command_id: "stale-1", expected_version: 0, patch: { caption: "Stale write" },
    }, "PATCH"));

    expect(first.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, draft: { version: 1 } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "version_conflict" });
    expect(repository.getDraft("work-item-1")?.caption).toBe("A caption");
  });

  it("returns an idempotent server-generated upload grant and finalizes it only once", async () => {
    const app = appFor(new InMemoryCreatorStudioRepository({ workspace: workspace() }));
    const grantCommand = { command_id: "grant-1", file_name: "proof.png", mime_type: "image/png", byte_size: 1024 };

    const first = await app.request(grantPath, json(grantCommand));
    const replay = await app.request(grantPath, json(grantCommand));
    const granted = await first.json() as { bucket: string; path: string; token: string; assetId: string; expiresAt: string };
    const replayed = await replay.json() as { assetId: string };
    const finalizePath = `/my-missions/submission-1/work-items/work-item-1/assets/${granted.assetId}/finalize`;
    const finalized = await app.request(finalizePath, json({
      command_id: "finalize-1", byte_size: 1024, mime_type: "image/png", checksum_sha256: null,
    }));
    const secondFinalize = await app.request(finalizePath, json({
      command_id: "finalize-2", byte_size: 1024, mime_type: "image/png", checksum_sha256: null,
    }));

    expect(first.status).toBe(200);
    expect(granted).toEqual({
      bucket: "creator-studio-assets", path: expect.stringContaining("asset-1.png"), token: expect.any(String),
      assetId: "asset-1", expiresAt: expect.any(String),
    });
    expect(replayed.assetId).toBe(granted.assetId);
    expect(finalized.status).toBe(200);
    expect(secondFinalize.status).toBe(409);
    expect(await secondFinalize.json()).toMatchObject({ code: "asset_finalized" });
  });

  it("submits only after required draft fields and a finalized asset, then uses submitted transitions", async () => {
    const app = appFor(new InMemoryCreatorStudioRepository({ workspace: workspace() }));
    const blocked = await app.request("/my-missions/submission-1/work-items/work-item-1/submit", json({
      command_id: "submit-before-ready", expected_version: 0,
    }));
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "invalid_transition" });
  });

  it("rejects an asset-only work item with no current draft without mutating it", async () => {
    const assetOnlyWorkspace = workspace();
    assetOnlyWorkspace.workItems[0].requirements = { caption: false, externalUrl: false, checklist: [] };
    const repository = new InMemoryCreatorStudioRepository({ workspace: assetOnlyWorkspace });
    const app = appFor(repository);

    const grant = await app.request(grantPath, json({
      command_id: "asset-only-grant", file_name: "proof.png", mime_type: "image/png", byte_size: 1024,
    }));
    const { assetId } = await grant.json() as { assetId: string };
    const finalized = await app.request(`/my-missions/submission-1/work-items/work-item-1/assets/${assetId}/finalize`, json({
      command_id: "asset-only-finalize", byte_size: 1024, mime_type: "image/png", checksum_sha256: null,
    }));
    const before = await repository.getWorkspace({ actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" });
    const eventsBefore = repository.events();

    const rejected = await app.request(submitPath, json({ command_id: "asset-only-submit", expected_version: 0 }));

    expect(finalized.status).toBe(200);
    expect(before).toMatchObject({ workItems: [{ state: "ready_to_submit", draft: null }] });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "invalid_transition" });
    expect(await repository.getWorkspace({ actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" })).toEqual(before);
    expect(repository.events()).toEqual(eventsBefore);
  });

  it("submits a completed work item once and replays without duplicate evidence", async () => {
    const repository = new InMemoryCreatorStudioRepository({ workspace: workspace() });
    const app = appFor(repository);
    await completeWorkItem(app, "first-submit");
    const command = { command_id: "first-submit-command", expected_version: 1 };

    const first = await app.request(submitPath, json(command));
    const replay = await app.request(submitPath, json(command));

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ workItem: { state: "submitted" } });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, workItem: { state: "submitted" } });
    expect(repository.events().filter((event) => event.type === "work_item.submitted")).toHaveLength(1);
  });

  it("moves a completed changes-requested work item to resubmitted", async () => {
    const revisedWorkspace = workspace();
    revisedWorkspace.workItems[0].state = "changes_requested";
    revisedWorkspace.workflow.state = "changes_requested";
    revisedWorkspace.nextAction = { workItemId: "work-item-1", state: "changes_requested", label: "Revise Proof" };
    const app = appFor(new InMemoryCreatorStudioRepository({ workspace: revisedWorkspace }));
    await completeWorkItem(app, "resubmit");

    const response = await app.request(submitPath, json({ command_id: "resubmit-command", expected_version: 1 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workItem: { state: "resubmitted" } });
  });

  it("accepts only snake_case fields and rejects invalid command, version, URL, checklist, MIME, and size values without mutation", async () => {
    const repository = new InMemoryCreatorStudioRepository({ workspace: workspace() });
    const app = appFor(repository);
    const before = await repository.getWorkspace({ actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" });

    for (const body of [
      { command_id: "", expected_version: 0, patch: {} },
      { command_id: "x".repeat(129), expected_version: 0, patch: {} },
      { command_id: "fractional", expected_version: 0.5, patch: {} },
      { command_id: "negative", expected_version: -1, patch: {} },
      { command_id: "bad-url", expected_version: 0, patch: { external_url: "ftp://example.com" } },
      { command_id: "bad-checklist", expected_version: 0, patch: { checklist: { disclosure: "yes" } } },
      { commandId: "camel-case", expectedVersion: 0, patch: { caption: "ignored" } },
    ]) {
      const response = await app.request(draftPath, json(body, "PATCH"));
      expect(response.status).toBe(422);
    }

    for (const body of [
      { command_id: "bad-mime", file_name: "proof.mov", mime_type: "video/quicktime", byte_size: 1024 },
      { command_id: "too-large", file_name: "proof.png", mime_type: "image/png", byte_size: (50 * 1024 * 1024) + 1 },
    ]) {
      const response = await app.request(grantPath, json(body));
      expect(response.status).toBe(422);
    }

    expect(await repository.getWorkspace({ actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" })).toEqual(before);
    expect(repository.events()).toEqual([]);
  });

  it("does not write command evidence when a validly parsed request fails a state prerequisite", async () => {
    const repository = new InMemoryCreatorStudioRepository({ workspace: workspace() });
    const app = appFor(repository);
    const response = await app.request("/my-missions/submission-1/work-items/work-item-1/submit", json({
      command_id: "blocked-command", expected_version: 0,
    }));

    expect(response.status).toBe(409);
    expect(repository.events()).toEqual([]);
    await expect(repository.saveDraft({ actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" }, "work-item-1", {
      commandId: "blocked-command", expectedVersion: 0, patch: { caption: "Still reusable" },
    })).resolves.toMatchObject({ replayed: false });
  });

  it("retries a Supabase storage-signing failure through the same reserved asset without another command payload", async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let signAttempts = 0;
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return {
          data: {
            replayed: rpcCalls.length > 1,
            grant: {
              bucket: "creator-studio-assets",
              path: "creator-1/workflow-1/work-item-1/asset-1.png",
              asset_id: "asset-1",
              expires_at: "2026-08-09T01:00:00.000Z",
            },
          },
          error: null,
        };
      },
      storage: {
        from: () => ({
          createSignedUploadUrl: async () => {
            signAttempts += 1;
            return signAttempts === 1
              ? { data: null, error: new Error("signing unavailable") }
              : { data: { token: "fresh-upload-token" }, error: null };
          },
        }),
      },
    } as unknown as SupabaseClient;
    const repository = new SupabaseCreatorStudioRepository(client);
    const context = { actorId: "creator-1", workspaceId: "workspace-1", submissionId: "submission-1" };
    const input = { commandId: "storage-retry", fileName: "proof.png", mimeType: "image/png", byteSize: 1024 };

    await expect(repository.createUploadGrant(context, "work-item-1", input)).rejects.toMatchObject({ code: "storage_error" });
    await expect(repository.createUploadGrant(context, "work-item-1", input)).resolves.toEqual({
      replayed: true,
      value: {
        bucket: "creator-studio-assets", path: "creator-1/workflow-1/work-item-1/asset-1.png",
        assetId: "asset-1", expiresAt: "2026-08-09T01:00:00.000Z", token: "fresh-upload-token",
      },
    });

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls.map(({ name }) => name)).toEqual(["creator_studio_create_upload_grant", "creator_studio_create_upload_grant"]);
    expect(rpcCalls[1]?.args).toEqual(rpcCalls[0]?.args);
  });

  it("keeps persisted URL validation strict and checks upload-grant replay before current item state", () => {
    const sql = readFileSync(commandMigrationPath, "utf8");
    const submit = sql.slice(
      sql.indexOf("create or replace function public.creator_studio_submit_work_item"),
      sql.indexOf("revoke all on function public.creator_studio_save_draft"),
    );
    const uploadGrant = sql.slice(
      sql.indexOf("create or replace function public.creator_studio_create_upload_grant"),
      sql.indexOf("create or replace function public.creator_studio_finalize_asset"),
    );

    expect(sql).toContain("^https?://(?:[[:alnum:]](?:[[:alnum:].-]*[[:alnum:]])?|\\[[0-9a-f:.]+\\])(?::[0-9]{1,5})?(?:[/?#][^[:space:]]*)?$");
    expect(submit.indexOf("from public.mission_workflow_commands command")).toBeLessThan(submit.indexOf("from public.mission_work_items"));
    expect(uploadGrant.indexOf("from public.mission_workflow_commands command")).toBeLessThan(uploadGrant.indexOf("from public.mission_work_items"));
    expect(uploadGrant.indexOf("from public.mission_workflow_commands command")).toBeLessThan(uploadGrant.indexOf("if coalesce(length(btrim(p_file_name))"));
    expect(uploadGrant).toContain("return v_existing_response || jsonb_build_object('replayed', true);");
    expect(uploadGrant).not.toContain("raise exception 'asset_finalized'");
  });
});
