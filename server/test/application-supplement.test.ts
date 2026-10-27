// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Native pure acceptance orchestration, no client imports.
import { runApplicationSupplement, assertDecisionRace, assertApplicationRollback, assertFinancialRowsUnchanged, assertApplicationSupplementPlan } from "../../scripts/audit/application-supplement.mjs";

const winner = { action: "accept", actorId: "operator-a", actorLabel: "A", decidedAt: "2026-10-25T12:00:00Z", revision: 1 };
const before = { status: "applied", filled: 0, xp: 0, workflows: 0, audit: 0, receipts: 0 };
const financial = { balance: 0, ledger: [], inventory: [{ id: "gift", stock: 3 }] };
function drivers(failAt = "") {
  const order: string[] = [];
  const step = (name: string, value: unknown = {}) => vi.fn(async () => { order.push(name); if (failAt === name) throw new Error(name); return value; });
  return { order, authorize: step("authorize"), identity: step("identity"), provenance: step("provenance"),
    claim: step("claim"), migrate: step("migrate"), createClient: step("createClient"), fixture: step("fixture"),
    api: step("api"), browser: step("browser"), finalReadback: step("finalReadback", { allEqual: true }),
    record: vi.fn(async (value: Record<string, unknown>) => { void value; }) };
}

describe("D19 supplement pure safety orchestration (no runtime evidence)", () => {
  it("proves approval, identity and provenance before claim, migration, client or setup", async () => {
    const d = drivers(); await runApplicationSupplement(d);
    expect(d.order).toEqual(["authorize", "identity", "provenance", "claim", "migrate", "createClient", "fixture", "api", "browser", "finalReadback"]);
    expect(d.record.mock.calls.at(-1)?.[0]).toMatchObject({ status: "PASS_APPLICATION_SUPPLEMENT", allEqual: true });
  });
  for (const stage of ["authorize", "identity", "provenance", "claim", "migrate", "createClient", "fixture", "api", "browser", "finalReadback"]) {
    it(`stops dependent work on ${stage} failure without deleting, compensating or retrying`, async () => {
      const d = drivers(stage); await expect(runApplicationSupplement(d)).rejects.toThrow(stage);
      expect(d.order.at(-1)).toBe(stage);
      expect(d.order.filter(x => x === stage)).toHaveLength(1);
      expect(d.record.mock.calls.at(-1)?.[0]).toMatchObject({ status: "STOPPED_RETAIN_EXACT_RECORDS", failedStage: stage, releaseHold: true, incidentOpen: true });
    });
  }
  it("cannot turn a failed final financial readback into success", async () => {
    const d = drivers(); d.finalReadback.mockResolvedValue({ allEqual: false });
    await expect(runApplicationSupplement(d)).rejects.toThrow(/financial/i);
    expect(d.record.mock.calls.at(-1)?.[0]).toMatchObject({ status: "STOPPED_RETAIN_EXACT_RECORDS" });
  });
  it("accepts either legal race winner with exactly one durable transaction", () => {
    for (const action of ["accept", "decline"]) {
      const decision = { ...winner, action };
      const after = { ...before, status: action === "accept" ? "joined" : "declined", filled: action === "accept" ? 1 : 0,
        xp: action === "accept" ? 10 : 0, workflows: action === "accept" ? 1 : 0, audit: 1, receipts: 1, decision };
      expect(() => assertDecisionRace([{ status: 200, body: { decision } }, { status: 409, body: { code: "APPLICATION_DECIDED", current_decision: decision } }], before, after)).not.toThrow();
    }
  });
  it.each(["xp", "filled", "workflows", "audit", "receipts"])("rejects duplicate or missing race side effect %s", key => {
    const after = { ...before, status: "joined", filled: 1, xp: 10, workflows: 1, audit: 1, receipts: 1, decision: winner, [key]: 2 };
    expect(() => assertDecisionRace([{ status: 200, body: { decision: winner } }, { status: 409, body: { code: "APPLICATION_DECIDED", current_decision: winner } }], before, after)).toThrow();
  });
  it("rejects two winners, a stale winner attribution or an invalid timestamp", () => {
    const after = { ...before, status: "joined", filled: 1, xp: 10, workflows: 1, audit: 1, receipts: 1, decision: winner };
    const success = { status: 200, body: { decision: winner } };
    expect(() => assertDecisionRace([success, success], before, after)).toThrow();
    expect(() => assertDecisionRace([success, { status: 409, body: { code: "APPLICATION_DECIDED", current_decision: { ...winner, actorId: "wrong" } } }], before, after)).toThrow();
    expect(() => assertDecisionRace([{ status: 200, body: { decision: { ...winner, decidedAt: "invalid" } } }, { status: 409, body: { code: "APPLICATION_DECIDED", current_decision: winner } }], before, after)).toThrow();
  });
  it("compares all rollback rows and all financial row contents, not just totals", () => {
    expect(() => assertApplicationRollback(before, { ...before })).not.toThrow();
    expect(() => assertApplicationRollback(before, { ...before, receipts: 1 })).toThrow();
    expect(() => assertFinancialRowsUnchanged(financial, structuredClone(financial))).not.toThrow();
    expect(() => assertFinancialRowsUnchanged(financial, { ...financial, inventory: [{ id: "different", stock: 3 }] })).toThrow();
  });
  const plan = () => ({ kind: "D19_B2_EXECUTION_SPEC", schemaVersion: 2, specificationReady: true,
    candidate: { fingerprint: "a".repeat(64) }, execution: { artifactNamespace: "00000000-0000-4000-8000-000000000099" },
    supplement: { kind: "APPLICATION_DECISIONS_ONLY", originManifestSha256: "696e94c29e62a27e820d7d12f5aa74c0d1e7b62f97f3b57db787074512a2626d",
      resourceAdds: { projects: 0, volumes: 0, networks: 0, containers: 0 }, authSubjects: 6, workspaces: 1, missions: 4,
      schema: { file: "supabase/migrations/20261025120934_application_decisions.sql", sha256: "b".repeat(64), baselineMigrationCount: 72 },
      originalApiReruns: 0, originalBrowserReruns: 0, legacyIssuance: false, providerEnabled: false, cleanupApproved: false,
      incidentOpen: true, releaseHold: true, runtimeApproved: false } });
  it("accepts a bounded local review plan without granting runtime authority", () => {
    expect(() => assertApplicationSupplementPlan(plan())).not.toThrow();
  });
  it.each(["providerEnabled", "legacyIssuance", "cleanupApproved", "runtimeApproved"])("rejects implicit expansion of %s", field => {
    const p = plan(); (p.supplement as Record<string, unknown>)[field] = true;
    expect(() => assertApplicationSupplementPlan(p)).toThrow();
  });
  it("rejects resource additions, another migration or omitted subject bounds", () => {
    const p = plan(); p.supplement.resourceAdds.containers = 1;
    expect(() => assertApplicationSupplementPlan(p)).toThrow();
    p.supplement.resourceAdds.containers = 0; p.supplement.schema.file = "reset.sql";
    expect(() => assertApplicationSupplementPlan(p)).toThrow();
    p.supplement.schema.file = "supabase/migrations/20261025120934_application_decisions.sql"; p.supplement.authSubjects = 7;
    expect(() => assertApplicationSupplementPlan(p)).toThrow();
  });
});
