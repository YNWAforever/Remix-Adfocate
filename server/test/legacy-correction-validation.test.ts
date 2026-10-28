// @vitest-environment node
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";

const workspace = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const submission = "00000000-0000-4000-8000-000000000003";
const request = "00000000-0000-4000-8000-000000000004";
const saved = { submission_id: submission, status: "joined", revision: 4, receipt_id: request };
const h = vi.hoisted(() => ({ urls: ["https://example.test/work"], revision: 3, receipt: false,
  sqlValid: true, failedRead: "", rpc: vi.fn(), reads: [] as Array<{ table: string; columns: string; filters: Record<string, unknown> }> }));
vi.mock("../lib/supabase", () => ({
  makeUserClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: actor, email: "operator@example.test" } }, error: null }) } }),
  serviceClient: () => ({ rpc: (name: string, args: Record<string, unknown>) => {
    if (name !== "get_legacy_correction_evidence") return h.rpc(name, args);
    h.reads.push({ table: "get_legacy_correction_evidence", columns: "content_urls,evidence_revision,sql_valid", filters: args });
    return Promise.resolve(h.failedRead === "evidence" ? { data: null, error: { code: "42883", message: "private database details" } }
      : { data: { content_urls: h.urls, evidence_revision: h.revision, sql_valid: h.sqlValid }, error: null });
  }, from(table: string) {
    const read = { table, columns: "", filters: {} as Record<string, unknown> }; h.reads.push(read);
    const query = { select(columns: string) { read.columns = columns; return query; },
      eq(key: string, value: unknown) { read.filters[key] = value; return query; },
      async maybeSingle() {
        const data = table === "staff_users" ? { user_id: actor, email: "operator@example.test", active: true }
          : table === "brand_users" ? { user_id: actor, workspace_id: workspace, active: true, workspaces: { id: workspace, slug: "owned" } }
          : table === "staff_workspace_roles" ? { user_id: actor, workspace_id: workspace, role: "operator", active: true, revision: 1 }
          : table === "legacy_evidence_corrections" ? h.receipt ? { workspace_id: workspace, operator_id: actor, request_id: request } : null
          : { id: submission, workspace_id: workspace, content_urls: h.urls, evidence_revision: h.revision };
        const error = h.failedRead === table || (h.failedRead === "evidence" && read.columns.includes("content_urls")) ? { code: "08006", message: "private database details" } : null;
        return { data, error };
      } };
    return query;
  } }),
}));
import { adminRoutes } from "../routes/admin";
const app = new Hono().route("/admin", adminRoutes);
const send = (revision = 3) => app.request(`/admin/submissions/${submission}/request-correction`, {
  method: "POST", headers: { Authorization: "Bearer offline-transport", "X-Workspace-Slug": "owned", "Content-Type": "application/json" },
  body: JSON.stringify({ note: "Replace the invalid work URL", request_id: request, expected_revision: revision }),
});
beforeEach(() => {
  Object.assign(h, { urls: ["https://example.test/work"], revision: 3, receipt: false, sqlValid: true, failedRead: "", reads: [] });
  h.rpc.mockReset().mockResolvedValue({ data: saved, error: null });
});

it("rejects a fresh correction of evidence accepted by the canonical URL parser", async () => {
  const response = await send();
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "wrong_state" });
  expect(h.rpc).not.toHaveBeenCalled();
});
it.each(["https://256.1.1.1/work", "https://a\u200db.test/work"])("allows a fresh correction of canonically invalid historical evidence: %s", async url => {
  h.urls = [url]; expect(() => new URL(url)).toThrow();
  const response = await send();
  expect(response.status).toBe(200); expect(await response.json()).toEqual(saved);
  expect(h.rpc).toHaveBeenCalledWith("request_legacy_evidence_correction", expect.objectContaining({ p_workspace: workspace, p_operator: actor, p_submission: submission, p_request: request, p_expected_revision: 3 }));
  expect(h.reads.find(read => read.table === "legacy_evidence_corrections")?.filters).toEqual({ workspace_id: workspace, operator_id: actor, request_id: request });
  expect(h.reads.find(read => read.table === "get_legacy_correction_evidence")?.filters).toEqual({ p_submission: submission, p_workspace: workspace });
});
it.each(["https://example.test:/work", "https://example.test:000080/work", "https://@example.test/work"])("allows correction when canonical parsing accepts but the SQL guard rejects historical evidence: %s", async url => {
  h.urls = [url]; h.sqlValid = false; expect(() => new URL(url)).not.toThrow();
  const response = await send();
  expect(response.status).toBe(200); expect(await response.json()).toEqual(saved);
  expect(h.rpc).toHaveBeenCalledWith("request_legacy_evidence_correction", expect.objectContaining({ p_expected_revision: 3 }));
});
it("replays a saved receipt after valid replacement evidence and a newer revision were stored", async () => {
  h.receipt = true; h.revision = 5;
  const response = await send();
  expect(response.status).toBe(200); expect(await response.json()).toEqual(saved);
  expect(h.rpc).toHaveBeenCalledWith("request_legacy_evidence_correction", expect.objectContaining({ p_expected_revision: 3 }));
  expect(h.reads.some(read => read.table === "get_legacy_correction_evidence")).toBe(false);
});
it("lets the SQL receipt replay win when a concurrent original request commits after the receipt lookup", async () => {
  h.receipt = false; h.revision = 5;
  const response = await send();
  expect(response.status).toBe(200); expect(await response.json()).toEqual(saved);
  expect(h.rpc).toHaveBeenCalledWith("request_legacy_evidence_correction", expect.objectContaining({ p_expected_revision: 3 }));
});
it("keeps the SQL payload-hash conflict authoritative on receipt replay", async () => {
  h.receipt = true; h.rpc.mockResolvedValue({ data: null, error: { message: "IDEMPOTENCY_CONFLICT" } });
  const response = await send();
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
it.each(["legacy_evidence_corrections", "evidence"])("fails closed when %s lookup is unavailable", async failedRead => {
  h.urls = ["invalid"]; h.failedRead = failedRead;
  const response = await send();
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("private database details");
  expect(h.rpc).not.toHaveBeenCalled();
});
it("fails closed when the helper cannot confirm SQL validity", async () => {
  h.urls = ["invalid"]; h.sqlValid = null as unknown as boolean;
  const response = await send();
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "correction_unavailable" });
  expect(h.rpc).not.toHaveBeenCalled();
});
it("leaves a stale fresh correction to the locked SQL revision check", async () => {
  h.urls = ["invalid"]; h.rpc.mockResolvedValue({ data: null, error: { message: "EVIDENCE_STALE" } });
  const response = await send(2);
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "EVIDENCE_STALE" });
  expect(h.rpc).toHaveBeenCalledWith("request_legacy_evidence_correction", expect.objectContaining({ p_expected_revision: 2 }));
});
