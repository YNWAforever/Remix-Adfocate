// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { PsqlTransportError, type PsqlTransportFailureCode } from "./delta-psql-session";
import type { ActiveMissionWorkspace } from "../../src/lib/activeMission";
import { ProviderRehearsalFailure, type ProviderActor, type ProviderRehearsalRuntime } from "./delta-provider-contracts";
import { createProviderJourneyFixture, createProviderMission, prepareProviderActiveFixture, providerFixtureJson, providerFixtureUuid, providerJourneyRequest, providerNeutrality, seedProviderIssuedHistory, PROVIDER_FIXTURE_SQL_STAGES, providerFixtureDiagnosticCode, providerJourneyDiagnostic } from "./delta-provider-journey-fixtures";
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
  expect(`${failure!.message}\n${failure!.stack}`).not.toContain(PRIVATE); expect(failure).not.toHaveProperty("cause"); return failure!;
}
describe("owned provider journey fixture boundaries (offline only)", () => {
  it.each(["", "' OR true;--", "../escape", "00000000-0000-0000-0000-000000000000"])("rejects non-UUID fixture identity before SQL: %s", value => { expect(() => providerFixtureUuid(value)).toThrow(ProviderRehearsalFailure); });
  it("does not issue SQL if current owned identity cannot be reverified", async () => {
    const f = fixture(); f.assertOwned.mockRejectedValue(new Error(PRIVATE)); await held(createProviderMission(f.runtime, "active_workspace"), "journey-fixture-mission-active-failed"); expect(f.sql).not.toHaveBeenCalled();
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
function publicationValues(sql: string): Array<{ disclosures: unknown; policy: unknown }> {
  const templateInsert = sql.split("insert into public.mission_deliverable_templates")[1]?.split("insert into public.mission_deliverable_requirements")[0] ?? "";
  return [...templateInsert.matchAll(/never publish',72,'([^']+)'(?:::jsonb)?,'([^']+)'(?:::jsonb)?/g)].map(match => ({ disclosures: JSON.parse(match[1]!), policy: JSON.parse(match[2]!) }));
}
describe("migrated local fixture JSON contract and bounded SQL diagnostics (offline only)", () => {
  it("matches the actual migrated disclosure-array and proof-policy-object constraints for both templates", async () => {
    const migration = await readFile(new URL("../../supabase/migrations/20260723090000_publication_proof_validation.sql", import.meta.url), "utf8");
    expect(migration).toMatch(/required_disclosures jsonb[^;]+jsonb_typeof\(required_disclosures\) = 'array'/);
    expect(migration).toMatch(/proof_evidence_policy jsonb[^;]+jsonb_typeof\(proof_evidence_policy\) = 'object'/);
    const f = fixture(); await createProviderMission(f.runtime, "active_workspace"); const values = publicationValues(f.sql.mock.calls[0]![0]);
    expect(values).toHaveLength(2); expect(values.map(value => value.disclosures)).toEqual([[], []]); expect(values.map(value => value.policy)).toEqual([{}, {}]);
  });
  it("has a valid positive fixture prerequisite before rejecting the former object-for-array mutation", async () => {
    const f = fixture(), original = f.sql.getMockImplementation()!;
    f.sql.mockImplementation(async text => {
      for (const input of publicationValues(text)) if (!Array.isArray(input.disclosures) || !input.policy || Array.isArray(input.policy) || typeof input.policy !== "object") throw new PsqlTransportError("stderr-output", "23514");
      return original(text);
    });
    await createProviderMission(f.runtime, "active_workspace"); expect(f.sql).toHaveBeenCalledOnce();
    const wrong = f.sql.mock.calls[0]![0].replaceAll("'[]'::jsonb", "'{}'::jsonb"); expect(publicationValues(wrong).map(value => value.disclosures)).toEqual([{}, {}]);
    await held(providerFixtureJson(f.runtime, wrong, "mission-active"), "journey-fixture-mission-active-psql-stderr-output-23514"); expect(f.record).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(PROVIDER_FIXTURE_SQL_STAGES)("retains SQLSTATE with a closed %s stage and no original private error", async stage => {
    const f = fixture(), original = new PsqlTransportError("stderr-output", "23514"); original.message = PRIVATE; original.stack = PRIVATE;
    f.sql.mockRejectedValue(original); const error = await held(providerFixtureJson(f.runtime, "select fixed_json;", stage), `journey-fixture-${stage}-psql-stderr-output-23514`);
    expect(providerFixtureDiagnosticCode(error.code)).toBe(true); expect(providerJourneyDiagnostic(error)).toBe(`${stage}-psql-stderr-output-23514`); expect(error.code.length).toBeLessThanOrEqual(100);
  });
  it("preserves every actual closed psql transport classification even when no SQLSTATE is available", async () => {
    const codes = ["invalid-options", "invalid-query", "spawn-failed", "process-error", "unexpected-exit", "protocol-error", "query-timeout", "output-limit", "stdin-error", "stderr-output", "busy", "closed", "aborted", "close-timeout", "json-result"] satisfies PsqlTransportFailureCode[];
    for (const code of codes) {
      const f = fixture(); f.sql.mockRejectedValue(new PsqlTransportError(code));
      const error = await held(providerFixtureJson(f.runtime, "select fixed_json;", "issued-history"), `journey-fixture-issued-history-psql-${code}`);
      expect(providerFixtureDiagnosticCode(error.code)).toBe(true); expect(providerJourneyDiagnostic(error)).toBe(`issued-history-psql-${code}`);
    }
  });
  it("keeps an owned-identity ProviderRehearsalFailure unchanged rather than calling it a SQL failure", async () => {
    const f = fixture(), original = new ProviderRehearsalFailure("owned-stack-identity-held"); f.assertOwned.mockRejectedValue(original);
    expect(await held(createProviderMission(f.runtime, "active_workspace"), original.code)).toBe(original); expect(f.sql).not.toHaveBeenCalled();
  });
  it("separates closed row cardinality, JSON and unknown SQL failures", async () => {
    const f = fixture(); f.sql.mockResolvedValueOnce([]); await held(providerFixtureJson(f.runtime, "select fixed_json;", "neutrality"), "journey-fixture-neutrality-row");
    f.sql.mockResolvedValueOnce([PRIVATE]); await held(providerFixtureJson(f.runtime, "select fixed_json;", "issued-anchor"), "journey-fixture-issued-anchor-json");
    f.sql.mockRejectedValueOnce({ code: "23514", message: PRIVATE, details: PRIVATE }); await held(providerFixtureJson(f.runtime, "select fixed_json;", "legacy-events"), "journey-fixture-legacy-events-failed");
  });
  it("does not reinterpret raw code-like fields or invalid psql classifications as trusted diagnostics", async () => {
    const f = fixture(); f.sql.mockRejectedValue(new PsqlTransportError(PRIVATE as PsqlTransportFailureCode, "23514"));
    await held(providerFixtureJson(f.runtime, "select fixed_json;", "pending-counts"), "journey-fixture-pending-counts-failed");
    expect(providerJourneyDiagnostic({ code: "journey-fixture-mission-active-psql-stderr-output-23514" })).toBeUndefined();
  });
  it.each([PRIVATE, "journey-fixture-untrusted-psql-stderr-output-23514", "journey-fixture-mission-active-psql-unknown-23514", "journey-fixture-mission-active-psql-stderr-output-23514-private", "journey-fixture-mission-active-psql-stderr-output-23p01", "journey-http-999", null, 23514])("rejects nonclosed diagnostic token %s", value => {
    expect(providerFixtureDiagnosticCode(value)).toBe(false); if (typeof value === "string") expect(providerJourneyDiagnostic(new ProviderRehearsalFailure(value))).toBeUndefined();
  });
  it("rejects an unrecognized stage before SQL and never copies it to the failure code", async () => {
    const f = fixture(); await held(providerFixtureJson(f.runtime, "select fixed_json;", PRIVATE as never), "journey-fixture-stage"); expect(f.sql).not.toHaveBeenCalled();
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
