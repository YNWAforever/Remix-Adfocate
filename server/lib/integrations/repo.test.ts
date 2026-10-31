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
