// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { ProviderRehearsalFailure, type ProviderActor, type ProviderRehearsalRuntime } from "./delta-provider-contracts";
import { PROVIDER_JOURNEY_CASES, runProviderJourneys } from "./delta-provider-journey";
import { PsqlTransportError } from "./delta-psql-session";
const IDS = { run: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", creator: "33333333-3333-4333-8333-333333333333", other: "44444444-4444-4444-8444-444444444444", submission: "55555555-5555-4555-8555-555555555555" };
const PRIVATE = "nonsecret-private-provider-session";
function offlineRuntime(status: number, applyXp: boolean) {
  let requests = 0, xp = 135, joins = 0;
  const actor = { id: IDS.creator, email: `${PRIVATE}@example.test`, password: PRIVATE, accessToken: PRIVATE, client: {} } as ProviderActor;
  const sql = vi.fn(async (text: string): Promise<readonly string[]> => {
    if (text.includes("synthetic prior-issued")) return [JSON.stringify({ submissionId: text.match(/mission_submission:([a-f0-9-]+)/)![1], pointLedger: 1, cashLedger: 1, budgetLedger: 1 })];
    if (text.includes("'id',id,'slug',slug")) return [JSON.stringify({ id: [...text.matchAll(/where id='([a-f0-9-]+)'/g)].at(-1)![1], slug: text.match(/provider-journey-[a-f0-9-]+/)![0] })];
    if (text.includes("'submission',(select")) return [JSON.stringify({ submission: { id: text.match(/where s\.id='([a-f0-9-]+)'/)![1], status: "approved", points_awarded: 500, xp_awarded: 135, synthetic: true }, pointLedger: [{ delta: 500 }], cashLedger: [{ amount: 125 }], budgetLedger: [{ delta: -125 }] })];
    if (text.includes("jsonb_build_object('xp'")) return [JSON.stringify({ xp: { [IDS.creator]: xp, [IDS.other]: 0 }, financial: { rows: ["nonsecret-financial-anchor"] } })];
    throw new Error(PRIVATE);
  });
  const request = vi.fn(async (_actor: ProviderActor | null, path: string) => {
    requests++; if (path.endsWith("/join")) {
      joins++; if (joins > 1) return new Response(JSON.stringify({ code: "already_joined" }), { status: 409 });
      if (status === 200 && applyXp) xp += 10;
      return new Response(JSON.stringify(status === 200 ? { id: IDS.submission, status: "joined", xp_awarded: 10 } : { error: PRIVATE }), { status });
    }
    return new Response(JSON.stringify({ private: PRIVATE }), { status: 500 });
  });
  const record = vi.fn((name: string, _facts: unknown, before: number) => { if (requests <= before) throw new ProviderRehearsalFailure("offline-record-no-http"); return { name, status: "passed" as const, evidenceSha256: "0".repeat(64), actualHttpRequests: requests - before }; });
  const assertOwned = vi.fn(async () => {});
  const runtime = { runId: IDS.run, workspaceId: IDS.workspace, workspaceSlug: "synthetic", actors: { creator: actor, otherCreator: { ...actor, id: IDS.other }, reviewer: actor, operator: actor },
    request, record, sql, assertOwned, get httpRequests() { return requests; } } as unknown as ProviderRehearsalRuntime;
  return { runtime, record, request, sql, assertOwned };
}
async function failure(promise: Promise<unknown>, code: string) {
  const result = await promise.then(() => undefined, error => error as ProviderRehearsalFailure);
  expect(result).toBeInstanceOf(ProviderRehearsalFailure); expect(result!.code).toBe(code);
  expect(`${result!.message}\n${result!.stack}`).not.toContain(PRIVATE); expect(result).not.toHaveProperty("cause");
}
describe("provider journey evidence preconditions (offline, not provider evidence)", () => {
  it("freezes exactly the performed case names and keeps NULL coverage explicitly a schema guard", () => {
    expect(PROVIDER_JOURNEY_CASES).toEqual(["journey-legacy-join-xp", "journey-null-mode-schema-guard", "journey-legacy-resubmission", "journey-active-join-neutrality",
      "journey-active-draft-review", "journey-active-proof-correction", "journey-active-pending-reward", "journey-synthetic-issued-anchor-preserved"]);
    expect(new Set(PROVIDER_JOURNEY_CASES).size).toBe(8);
  });
  it.each([401, 403, 500])("does not count legacy XP or business denials if initial real HTTP status is %s", async status => {
    const f = offlineRuntime(status, true); await failure(runProviderJourneys(f.runtime), "journey-http-200"); expect(f.record).not.toHaveBeenCalled();
  });
  it("requires stored creator XP to change rather than trusting the HTTP xp_awarded field", async () => {
    const f = offlineRuntime(200, false); await failure(runProviderJourneys(f.runtime), "journey-xp-delta"); expect(f.record).not.toHaveBeenCalled();
  });
  it("records legacy join only after authoritative XP readback and exact duplicate rejection", async () => {
    const f = offlineRuntime(200, true); await failure(runProviderJourneys(f.runtime), "journey-http-200");
    expect(f.record).toHaveBeenCalledOnce(); expect(f.record.mock.calls[0]![0]).toBe("journey-legacy-join-xp");
    expect(f.request.mock.calls.filter(([, path]) => path.endsWith("/join"))).toHaveLength(2);
    expect(f.record.mock.calls[0]![2]).toBe(0);
  });
  it("sanitizes an owned-target failure before fixture creation", async () => {
    const f = offlineRuntime(200, true); f.assertOwned.mockRejectedValue(new Error(PRIVATE)); await failure(runProviderJourneys(f.runtime), "journey-runtime"); expect(f.sql).not.toHaveBeenCalled(); expect(f.record).not.toHaveBeenCalled();
  });
  it("sanitizes private fixture transport errors without successful case records", async () => {
    const f = offlineRuntime(200, true); f.sql.mockRejectedValue(new Error(PRIVATE)); await failure(runProviderJourneys(f.runtime), "journey-fixture-mission-legacy-failed"); expect(f.record).not.toHaveBeenCalled();
  });
  it("retains SQLSTATE and the legacy mission stage before publishing any journey record", async () => {
    const f = offlineRuntime(200, true); f.sql.mockRejectedValue(new PsqlTransportError("stderr-output", "23514"));
    await failure(runProviderJourneys(f.runtime), "journey-fixture-mission-legacy-psql-stderr-output-23514"); expect(f.record).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it("distinguishes a later issued-history fixture failure from mission creation with no false HTTP evidence", async () => {
    const f = offlineRuntime(200, true), original = f.sql.getMockImplementation()!;
    f.sql.mockImplementation(async text => { if (text.includes("synthetic prior-issued")) throw new PsqlTransportError("stderr-output", "23503"); return original(text); });
    await failure(runProviderJourneys(f.runtime), "journey-fixture-issued-history-psql-stderr-output-23503"); expect(f.sql).toHaveBeenCalledTimes(2); expect(f.record).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it("has inert imports and does not reuse historical app.request or fixture authorization guards", async () => {
    for (const path of ["./delta-provider-journey.ts", "./delta-provider-journey-fixtures.ts"]) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source).not.toContain("app.request"); expect(source).not.toMatch(/import\s.*(?:auditWorkflowFixture|local-targets|fixture-journal|staffCapabilityFixture)/);
      expect(source).not.toMatch(/process\.env|console\.|vi\.mock|createApp\(/);
    }
  });
});
