// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ActiveMissionWorkspace } from "../../src/lib/activeMission";
import { ProviderRehearsalFailure, type ProviderActor, type ProviderRehearsalRuntime } from "./delta-provider-contracts";
import { createProviderJourneyFixture, createProviderMission, prepareProviderActiveFixture, providerFixtureJson, providerFixtureUuid, providerJourneyRequest, providerNeutrality, seedProviderIssuedHistory } from "./delta-provider-journey-fixtures";
const IDS = { run: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", creator: "33333333-3333-4333-8333-333333333333", submission: "44444444-4444-4444-8444-444444444444", workflow: "55555555-5555-4555-8555-555555555555", item: "66666666-6666-4666-8666-666666666666", version: "77777777-7777-4777-8777-777777777777" };
const PRIVATE = "nonsecret-private-journey-fixture";
function fixture() {
  const actor = { id: IDS.creator, email: `${PRIVATE}@example.test`, password: PRIVATE, accessToken: PRIVATE, client: {} } as ProviderActor;
  const assertOwned = vi.fn(async () => {}), sql = vi.fn(async (text: string): Promise<readonly string[]> => {
    const id = text.match(/where id='([a-f0-9-]+)'/)?.[1], slug = text.match(/provider-journey-[a-f0-9-]+/)?.[0]; return [JSON.stringify({ id, slug })];
  });
  const request = vi.fn<ProviderRehearsalRuntime["request"]>(async () => new Response("{}", { status: 200 })), record = vi.fn();
  const runtime = { runId: IDS.run, workspaceId: IDS.workspace, workspaceSlug: "synthetic", actors: { creator: actor, otherCreator: { ...actor, id: IDS.version }, reviewer: actor, operator: actor }, assertOwned, sql, request, record, httpRequests: 0 } as unknown as ProviderRehearsalRuntime;
  return { runtime, assertOwned, sql, request, record, actor };
}
async function held(promise: Promise<unknown>, code?: string) {
  const failure = await promise.then(() => undefined, error => error as ProviderRehearsalFailure);
  expect(failure).toBeInstanceOf(ProviderRehearsalFailure); if (code) expect(failure!.code).toBe(code);
  expect(`${failure!.message}\n${failure!.stack}`).not.toContain(PRIVATE); expect(failure).not.toHaveProperty("cause");
}
describe("owned provider journey fixture boundaries (offline only)", () => {
  it.each(["", "' OR true;--", "../escape", "00000000-0000-0000-0000-000000000000"])("rejects non-UUID fixture identity before SQL: %s", value => { expect(() => providerFixtureUuid(value)).toThrow(ProviderRehearsalFailure); });
  it("does not issue SQL if current owned identity cannot be reverified", async () => {
    const f = fixture(); f.assertOwned.mockRejectedValue(new Error(PRIVATE)); await held(createProviderMission(f.runtime, "active_workspace"), "journey-fixture-sql"); expect(f.sql).not.toHaveBeenCalled();
  });
  it.each([0, 4, -1, 1.5])("refuses an unbounded quota %s before SQL", async quota => {
    const f = fixture(); await held(createProviderMission(f.runtime, "active_workspace", { quota }), "journey-fixture-options"); expect(f.sql).not.toHaveBeenCalled();
  });
  it("writes only run-scoped fixed source fixtures and reads back the exact generated mission", async () => {
    const f = fixture(), mission = await createProviderMission(f.runtime, "active_workspace");
    expect(mission.slug).toContain(IDS.run); expect(f.assertOwned).toHaveBeenCalledOnce();
    const text = f.sql.mock.calls[0]![0]; expect(text).toContain("insert into public.mission_deliverable_templates"); expect(text).toContain("insert into public.mission_deliverable_requirements");
    expect(text).toContain(IDS.workspace); expect(text).not.toMatch(/alter\s+table|create\s+policy|grant\s|set\s+role/i); expect(text).not.toContain(PRIVATE);
  });
  it("refuses mismatched inserted mission readback", async () => {
    const f = fixture(); f.sql.mockResolvedValue([JSON.stringify({ id: IDS.run, slug: "wrong" })]); await held(createProviderMission(f.runtime, "legacy"), "journey-fixture-readback");
  });
  it.each([{ rows: [] }, { rows: ["{}", "{}"] }, { rows: ["not-json"] }])("does not accept missing/multiple/malformed fixture JSON rows", async ({ rows }) => {
    const f = fixture(); f.sql.mockResolvedValue(rows); await held(providerFixtureJson(f.runtime, "select fixed_json;"));
  });
  it("rejects incomplete synthetic issued-history prerequisites rather than counting a sparse anchor", async () => {
    const f = fixture(); const original = f.sql.getMockImplementation()!; f.sql.mockImplementation(async sql => sql.includes("synthetic prior-issued") ? [JSON.stringify({ submissionId: IDS.submission, pointLedger: 0, cashLedger: 0, budgetLedger: 0 })] : original(sql));
    await held(seedProviderIssuedHistory(f.runtime), "journey-history-fixture"); expect(f.record).not.toHaveBeenCalled();
  });
  it("validates snapshot identities before composing private SQL", async () => {
    const f = fixture(); const runtime = { ...f.runtime, workspaceId: "' OR true;--" }; await held(providerNeutrality(runtime), "journey-fixture-identity"); expect(f.sql).not.toHaveBeenCalled();
  });
});
describe("full app HTTP capability fixture adapter (offline responses are not provider evidence)", () => {
  it.each(["https://example.test/api/missions", "/api/../escape", "/api/path\\escape"])("refuses a nonlocal/ambiguous path %s", async path => {
    const f = fixture(); await held(providerJourneyRequest(f.runtime, f.actor, path), "journey-request-path"); expect(f.request).not.toHaveBeenCalled();
  });
  it("preserves workspace and idempotency intent without logging actor credentials", async () => {
    const f = fixture(); await providerJourneyRequest(f.runtime, f.actor, "/api/synthetic", "POST", { revision: 1 }, IDS.run);
    expect(f.request.mock.calls[0]).toEqual([f.actor, "/api/synthetic", { method: "POST", redirect: "error", headers: { "X-Workspace-Slug": "synthetic", "Content-Type": "application/json", "Idempotency-Key": IDS.run }, body: '{"revision":1}' }]);
  });
  it("does not count unexpected authorization denial as an intended business denial", async () => {
    const f = fixture(); f.request.mockResolvedValue(new Response(JSON.stringify({ private: PRIVATE }), { status: 403 })); await held(providerJourneyRequest(f.runtime, f.actor, "/api/synthetic", "POST", {}, undefined, 409), "journey-http-409"); expect(f.record).not.toHaveBeenCalled();
  });
  it("sanitizes transport and malformed response failures", async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error(PRIVATE)); await held(providerJourneyRequest(f.runtime, f.actor, "/api/synthetic"), "journey-http-failed");
    f.request.mockResolvedValueOnce(new Response(PRIVATE)); await held(providerJourneyRequest(f.runtime, f.actor, "/api/synthetic"), "journey-http-failed");
  });
  it("requires actual successful drafting and approval responses before returning a Storage fixture", async () => {
    const f = fixture();
    const workspace = (state: string, revision: number) => ({ workflow: { id: IDS.workflow, state }, workItems: [{ id: IDS.item, required: true, state,
      draft: { revision }, requirements: [{ id: IDS.run }], currentSubmittedVersionId: IDS.version }] }) as unknown as ActiveMissionWorkspace;
    const responses: unknown[] = [{ submission: { id: IDS.submission }, workflow: { id: IDS.workflow } }, workspace("drafting", 0), {}, workspace("drafting", 1), {}, workspace("submitted", 1), {}, {}, workspace("approved_to_publish", 1),
      { publication: { state: "approved_to_publish", revision: 0, approvedVersionId: IDS.version } }];
    f.request.mockImplementation(async () => new Response(JSON.stringify(responses.shift()), { status: 200 }));
    const ready = await prepareProviderActiveFixture(f.runtime, "approved_to_publish");
    expect(ready).toMatchObject({ submissionId: IDS.submission, workflowId: IDS.workflow, workItemId: IDS.item, instructionRevision: 0, creatorId: IDS.creator });
    expect(f.request.mock.calls.some(call => String(call[1]).endsWith("/approve-to-publish"))).toBe(true); expect(responses).toHaveLength(0);
  });
  it("does not fake an approved fixture after the real join transport failed", async () => {
    const f = fixture(); f.request.mockResolvedValue(new Response("{}", { status: 403 })); await held(createProviderJourneyFixture(f.runtime, { mode: "active_workspace", state: "approved_to_publish" }), "journey-http-200"); expect(f.request).toHaveBeenCalledOnce();
  });
});
