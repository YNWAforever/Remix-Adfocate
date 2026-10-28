import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ target: {} as Record<string, unknown>, createClient: vi.fn() }));
vi.mock("../../scripts/audit/local-targets.mjs", () => ({ verifiedTarget: vi.fn(() => mocks.target) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { createAuditFixture } from "./auditWorkflowFixture";
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); vi.clearAllMocks(); });
function harness(failAuth = false) {
  const dir = mkdtempSync(join(tmpdir(), "adfocate-b2-wire-")); dirs.push(dir);
  const lineage = { projectId: "unit", phase: "core", namespace: "11111111-1111-4111-8111-111111111111" };
  const plan = { plannedNamespace: lineage.namespace, plannedPrimaryWorkspaceId: "22222222-2222-4222-8222-222222222222", plannedDenialWorkspaceId: "33333333-3333-4333-8333-333333333333", plannedMissions: [] };
  const context = { lineage, phase: "core", plan, manifest: { bootstrap: {}, fixture: { phases: [plan], rowScopes:{workspaces:{relation:"public.workspaces",key:["id"],selector:"workspace-self"}}, rowCaps: { core: { auth_users: 62, workspaces: 2, creators: 53, staff_users: 9, brand_users: 7, point_balances: 2, earnings_balances: 2, requests: 200 } } } },
    privatePath: (name: string) => join(dir, name), publicPath: (name: string) => join(dir, "public-" + name) };
  const journalPath = context.privatePath("owned-journal.jsonl"), writes: { table: string; rows: Record<string, unknown>[] }[] = [];
  let count = 0;
  const checkIntent = () => {
    expect(existsSync(journalPath), "intent must be durable before any setup write").toBe(true);
    const last = readFileSync(journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line)).at(-1);
    expect(last.state).toBe("intent"); expect(last.lineage).toEqual(lineage);
  };
  const client = {
    from: (table: string) => ({ insert: (value: Record<string, unknown> | Record<string, unknown>[]) => {
      checkIntent(); const rows = Array.isArray(value) ? value : [value]; writes.push({ table, rows });
      const result = { data: rows, error: null }; return Object.assign(Promise.resolve(result), { select: () => Promise.resolve(result) });
    } }),
    auth: { admin: { createUser: async () => { checkIntent(); if (failAuth) throw Error("lost Auth response"); return { data: { user: { id: `00000000-0000-4000-8000-${String(++count).padStart(12, "0")}` } }, error: null }; } },
      signInWithPassword: async () => ({ data: { session: { access_token: "unit-only" } }, error: null }) },
  };
  mocks.target = { identity: { projectId: "unit", runId: "unit" }, context, env: { SUPABASE_URL: "http://127.0.0.1:56821", SUPABASE_SERVICE_KEY: "unit-only", SUPABASE_ANON_KEY: "unit-only" }, sql: vi.fn(()=>"{}") };
  mocks.createClient.mockReturnValue(client);
  return { context, writes, journalPath, dir };
}
describe("B2 existing factory context wiring", () => {
  it("uses planned workspace/namespace IDs and writes durable intent/success receipts for setup", async () => {
    const h = harness(), f = await createAuditFixture();
    expect(f.runId).toBe(h.context.plan.plannedNamespace);
    expect(f.workspaceId).toBe(h.context.plan.plannedPrimaryWorkspaceId);
    expect(h.writes.find(w => w.table === "workspaces")!.rows.map(r => r.id)).toEqual([h.context.plan.plannedPrimaryWorkspaceId, h.context.plan.plannedDenialWorkspaceId]);
    const rows = readFileSync(h.journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(rows.filter(r => r.state === "success").flatMap(r => r.ids.auth_users ?? [])).toHaveLength(4);
    expect(existsSync(h.context.privatePath("fixture.private.json"))).toBe(true);
  });
  it("blocks a second whole-phase seed and retains UNKNOWN after an ambiguous Auth response", async () => {
    const h = harness(true); await expect(createAuditFixture()).rejects.toThrow("lost Auth response");
    expect(readFileSync(h.journalPath, "utf8")).toContain('"state":"unknown"');
    const calls = mocks.createClient.mock.calls.length;
    await expect(createAuditFixture()).rejects.toThrow(/already|unresolved|claim/i);
    expect(mocks.createClient).toHaveBeenCalledTimes(calls);
  });
});
