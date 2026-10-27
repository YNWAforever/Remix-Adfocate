import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, writes: 0, rpcError: null as null | { code: string; message: string }, rpcArgs: null as null | Record<string, unknown> }));
vi.mock("../lib/supabase", () => ({ serviceClient: () => ({
  from() {
    const query = {
      select() { return query; }, eq() { return query; }, in() { return query; },
      update(patch: Record<string, unknown>) { state.writes++; Object.assign(state.row, patch); return query; },
      async maybeSingle() { return { data: state.row, error: null }; },
      async single() { return { data: state.row, error: null }; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); },
    }; return query;
  },
  async rpc(_name: string, args: Record<string, unknown>) { state.rpcArgs = args; return { data: state.rpcError ? null : state.row, error: state.rpcError }; },
}) }));
import { adminMissionRoutes, validateMissionWorkflowAuthoring } from "../routes/adminMissions";
const app = new Hono().route("/admin", adminMissionRoutes);
const template = { title: "合成交付", platform: "instagram", position: 0, required: true, draft_due_offset_hours: 24,
  publication_instructions: "發布已批准的短片", publication_window_hours: 48, required_disclosures: ["#廣告"], expected_account: null,
  proof_evidence_policy: { legacy_review: { manual: true } }, requirements: [{ category: "compliance", text: "披露品牌合作", required: true, position: 0 }] };
const mission = { id: "mission", workspace_id: "workspace", slug: "synthetic-authoring", title: "合成任務", mission_type: "ugc",
  description: "合成介紹", category: "寵物", access_type: "open", required_level: "L0", points_reward: 100, cash_reward: 25, quota: 10,
  filled: 0, status: "draft", deadline: "2030-11-30", creator_workflow_mode: "active_workspace", fulfillment_required: false,
  revision_limit: 2, review_sla_hours: 48, revision_response_hours: 48, deliverable_templates: [template] };
describe("D12 authoring server boundary (unit transport; auth covered separately)", () => {
  beforeEach(() => { state.row = structuredClone(mission); state.writes = 0; state.rpcArgs = null; state.rpcError = null; });
  it("preserves unknown nested evidence policy values through the existing validator", () => {
    const result = validateMissionWorkflowAuthoring(mission);
    expect(result.ok).toBe(true);
    expect(result.templates[0].proof_evidence_policy).toEqual({ legacy_review: { manual: true } });
  });
  it("rejects publishing a legacy-stored invalid active template before changing status", async () => {
    state.row.deliverable_templates = [{ ...template, publication_window_hours: -1 }];
    const response = await app.request("/admin/missions/mission/publish", { method: "POST" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ fields: { "deliverable_templates.0.publication_window_hours": "PUBLICATION_WINDOW_HOURS_INVALID" } });
    expect(state.writes).toBe(0);
    expect(state.row.status).toBe("draft");
  });
  it("does not publish an active mission that has no required deliverable", async () => {
    state.row.deliverable_templates = [];
    const response = await app.request("/admin/missions/mission/publish", { method: "POST" });
    expect(response.status).toBe(422);
    expect(state.writes).toBe(0);
  });
  it("does not claim a saved draft when the existing authoring RPC is unavailable", async () => {
    state.rpcError = { code: "PGRST202", message: "Synthetic unavailable schema capability" };
    const response = await app.request("/admin/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mission) });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "db_error" });
    expect(state.writes).toBe(0);
  });
});
