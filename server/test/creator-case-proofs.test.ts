import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminEnv } from "../lib/staffAuth";
import { adminRoutes } from "../routes/admin";

const clients = vi.hoisted(() => ({ serviceClient: vi.fn(), makeUserClient: vi.fn() }));
vi.mock("../lib/supabase.js", () => clients);

function proof(id: string, workspaceId: string, creatorId = "creator-1") {
  return {
    id, workspace_id: workspaceId, submitted_by: creatorId, attempt_number: 1,
    primary_url: `https://example.com/${id}`, submitted_at: "2026-08-01T00:00:00.000Z",
    mission_work_items: {
      id: `item-${id}`, title: "IG Reel", platform: "instagram", current_proof_attempt_id: id,
      mission_workflows: { id: `workflow-${id}`, mission_submission_id: `submission-${id}` },
    },
    mission_publication_proof_reviews: [{ review_number: 1, state: "verified", summary: `Private ${id} review` }],
  };
}

const requests: URL[] = [];
let clientSequence = 0;
let membershipError = false;
const app = new Hono<AdminEnv>().route("/api/admin", adminRoutes);
const path = "/api/admin/creators/creator-1/publication-proofs";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_SECRET", "local-test-secret");
  requests.length = 0;
  membershipError = false;
  clients.makeUserClient.mockImplementation((userId: string) => ({
    auth: { getUser: async () => ({ data: { user: {
      id: userId, email: `${userId}@test.local`, email_confirmed_at: "2026-08-01T00:00:00.000Z",
    } }, error: null }) },
  }));
  const client = createClient("http://localhost:54321", "local-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: `creator-case-proofs-${clientSequence++}` },
    global: { fetch: async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      requests.push(url);
      const table = url.pathname.split("/").at(-1)!;
      if (table === "brand_users" && membershipError) {
        return Response.json({ code: "57014", message: "timeout" }, { status: 500 });
      }
      const tables: Record<string, Record<string, unknown>[]> = {
        staff_users: ["operator-1", "operator-2", "unassigned"].map((user_id) => ({
          user_id, email: `${user_id}@test.local`, active: true,
        })),
        brand_users: [
          { user_id: "operator-1", workspace_id: "workspace-owned", active: true },
          { user_id: "operator-1", workspace_id: "workspace-revoked", active: false },
          { user_id: "operator-2", workspace_id: "workspace-other", active: true },
        ],
        mission_publication_proof_attempts: [
          proof("owned", "workspace-owned"), proof("other", "workspace-other"),
          proof("revoked", "workspace-revoked"), proof("another-creator", "workspace-owned", "creator-2"),
        ],
        mission_submissions: [],
      };
      if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
      const rows = tables[table].filter((row) => [...url.searchParams].every(([column, filter]) => {
        if (filter.startsWith("eq.")) return String(row[column]) === filter.slice(3);
        if (filter.startsWith("in.(")) return filter.slice(4, -1).split(",").includes(String(row[column]));
        return true;
      }));
      // PostgREST's maybeSingle accepts array responses and performs cardinality checking.
      return Response.json(rows);
    } },
  });
  clients.serviceClient.mockReturnValue(client);
});

afterEach(() => vi.unstubAllEnvs());

describe("creator case publication proof authorization", () => {
  it("returns only this creator's proofs in the authenticated staff member's active workspaces", async () => {
    const response = await app.request(path, { headers: {
      Authorization: "Bearer operator-1", "x-operator-id": "operator-2", "X-Workspace-Slug": "other",
    } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.proofs.status).toBe("available");
    expect(body.proofs.value.map((item: { attemptId: string }) => item.attemptId)).toEqual(["owned"]);
    expect(body.proofs.value[0].reviewSummary).toBe("Private owned review");
    expect(JSON.stringify(body)).not.toMatch(/Private (other|revoked) review|another-creator/);
    const membership = requests.find((url) => url.pathname.endsWith("/brand_users"));
    expect(membership?.searchParams.get("user_id")).toBe("eq.operator-1");
    expect(membership?.searchParams.get("active")).toBe("eq.true");
  });

  it("returns no proofs and never queries attempts for staff without active workspace membership", async () => {
    const response = await app.request(path, { headers: { Authorization: "Bearer unassigned" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ proofs: { status: "available", value: [] } });
    expect(requests.some((url) => url.pathname.endsWith("/mission_publication_proof_attempts"))).toBe(false);
  });

  it("fails closed when the membership lookup fails", async () => {
    membershipError = true;
    const response = await app.request(path, { headers: { Authorization: "Bearer operator-1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ proofs: { status: "unavailable", reason: "source_error" } });
    expect(requests.some((url) => url.pathname.endsWith("/mission_publication_proof_attempts"))).toBe(false);
  });

  it("requires a real staff identity even when a shared secret and spoofed operator ID are supplied", async () => {
    const response = await app.request(path, { headers: {
      "x-admin-secret": "local-test-secret", "x-operator-id": "operator-1",
    } });
    expect(response.status).toBe(403);
    expect(clients.serviceClient).not.toHaveBeenCalled();
  });

  it.each([
    { token: "", status: 401 },
    { token: "creator-1", status: 403 },
  ])("rejects requests without staff authorization ($status)", async ({ token, status }) => {
    const response = await app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    expect(response.status).toBe(status);
    expect(requests.some((url) => url.pathname.endsWith("/mission_publication_proof_attempts"))).toBe(false);
  });
});
