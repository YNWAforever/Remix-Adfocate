// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { databaseFailure, SupabaseIntegrationRepository } from "./repo.js";

it("selects only owned resource identities across generations for the selected external IDs", async () => {
  const actor = { workspaceId: "workspace", creatorId: "creator" };
  const rows = [{ id: "persisted-id", externalId: "mock-file", excerpt: "must not escape the adapter" }];
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: rows, error: null }) };
  const client = { from: vi.fn(() => query), rpc: vi.fn() };
  const repo = new SupabaseIntegrationRepository(client as unknown as Pick<SupabaseClient, "from" | "rpc">);
  expect(await repo.resourceIdentities(actor, "connection", ["mock-file"])).toEqual([{ id: "persisted-id", externalId: "mock-file" }]);
  expect(client.from).toHaveBeenCalledWith("integration_resources");
  expect(query.select).toHaveBeenCalledWith("id,externalId:data->>externalId");
  expect(query.eq.mock.calls).toEqual([["connection_id", "connection"], ["workspace_id", "workspace"], ["creator_id", "creator"]]);
  expect(query.in).toHaveBeenCalledWith("data->>externalId", ["mock-file"]);
  expect(query.limit).toHaveBeenCalledWith(1);
  client.from.mockClear();
  expect(await repo.resourceIdentities(actor, "connection", [])).toEqual([]);
  expect(client.from).not.toHaveBeenCalled();
});

it("maps reauthentication failures without leaking a database diagnostic", () => {
  expect(() => databaseFailure({ message: "REAUTH_REQUIRED" })).toThrow(expect.objectContaining({ code: "REAUTH_REQUIRED", status: 403 }));
  expect(() => databaseFailure({ message: "secret database detail" })).toThrow(expect.objectContaining({ code: "INTEGRATIONS_UNAVAILABLE", status: 503 }));
});

it("uses service-only callback RPCs without an actor supplied by callback input", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { stored: true }, error: null });
  const repo = new SupabaseIntegrationRepository({ rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">);
  const input = { stateHash: "a".repeat(64), provider: "google_drive", ticketHash: "b".repeat(64), code: { keyId: "fixture", iv: "fixture", ciphertext: "ENCRYPTED" }, expiresAt: "2099-01-01T00:00:00Z" };
  await repo.lookupOAuthState(input.stateHash, input.provider);
  await repo.bufferOAuthCallback(input);
  expect(rpc.mock.calls).toEqual([
    ["integration_oauth_lookup", { p_state_hash: input.stateHash, p_provider: input.provider }],
    ["integration_oauth_callback", { p_state_hash: input.stateHash, p_provider: input.provider, p_ticket_hash: input.ticketHash, p_code: input.code, p_expires_at: input.expiresAt }],
  ]);
  expect(() => databaseFailure({ message: "REFRESH_LEASE_STALE" })).toThrow(expect.objectContaining({ code: "REFRESH_LEASE_STALE", status: 409 }));
});

it("passes only the verified notice mapping and receipt to the atomic RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { confirmationCode: "a".repeat(32), status: "completed" }, error: null });
  const repo = new SupabaseIntegrationRepository({ rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">);
  const input = { providerProjectId: "fixture-app", subjectHash: "b".repeat(64), receiptHash: "c".repeat(64), kind: "deletion" as const };
  expect(await repo.applyProviderNotice(input)).toEqual({ confirmationCode: "a".repeat(32), status: "completed" });
  expect(rpc).toHaveBeenCalledWith("integration_provider_notice", { p_provider_project_id: input.providerProjectId, p_subject_hash: input.subjectHash, p_receipt_hash: input.receiptHash, p_kind: input.kind });
});
