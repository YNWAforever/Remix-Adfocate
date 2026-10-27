import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error Native pure planning helper; never connects to a database.
import { buildBootstrapProfile, topLevelStatements } from "../../scripts/audit/b2-bootstrap-profile.mjs";
const reviewed = JSON.parse(readFileSync("docs/verification/D19-B2-manifest.json", "utf8"));
const core = reviewed.fixture.phases.find((p: { phase: string }) => p.phase === "core");
const historical = { phase: "core", workspaceId: core.plannedPrimaryWorkspaceId, missionId: core.plannedMissions.find((m: { kind: string }) => m.kind === "legacy").id,
  creatorId: "11111111-1111-4111-8111-111111111111", submissionId: "22222222-2222-4222-8222-222222222222", namespace: core.plannedNamespace, contentUrls: ["wwww"], queueIndex: 0 };
describe("B2 bootstrap profile, offline only", () => {
  it("pins all 72 original migration bytes and inserts the historical checkpoint before the guard", () => {
    const profile = buildBootstrapProfile(reviewed.schemaProfile, historical);
    expect(profile.migrations).toHaveLength(72);
    const checkpoint = profile.steps.findIndex((s: { kind: string }) => s.kind === "owned-historical-checkpoint");
    expect(profile.steps[checkpoint + 1].path).toBe("supabase/migrations/20261022170454_audit_legacy_evidence.sql");
    expect(profile.steps[checkpoint].sql).toContain(historical.submissionId);
    expect(profile.steps[checkpoint].sql).not.toMatch(/disable|session_replication_role|truncate|delete from/i);
    expect(profile.steps.filter((s: { kind: string }) => s.kind === "compatibility")).toHaveLength(9);
    expect(profile.seedInventory.find((s: { table: string }) => s.table === "public.academy_content").valueRowCount).toBe(31);
    expect(profile.seedInventory.some((s: { table: string }) => s.table === "storage.buckets")).toBe(true);
  });
  it("refuses a source checksum mismatch, missing checkpoint and SQL interpolation in IDs", () => {
    const altered = structuredClone(reviewed.schemaProfile); altered.fullMigrations[0].sha256 = "0".repeat(64);
    expect(() => buildBootstrapProfile(altered, historical)).toThrow(/checksum/i);
    expect(() => buildBootstrapProfile(reviewed.schemaProfile, null)).toThrow(/historical/i);
    expect(() => buildBootstrapProfile(reviewed.schemaProfile, { ...historical, creatorId: "';drop table" })).toThrow(/ID/i);
  });
  it("does not treat function bodies, quoted prose or dollar-quoted lesson text as top-level DML", () => {
    const statements = topLevelStatements("-- seed\ncreate function f() returns void as $$begin insert into x values(1); end;$$ language plpgsql; insert into y values ('semi;quote');");
    expect(statements).toHaveLength(2); expect(statements[1]).toMatch(/^insert into y/);
    expect(topLevelStatements("select 'unterminated")).toHaveLength(0);
  });
  it("separates legacy join10, submit25, approval100 from cumulative135, and pins the no-rating approval", () => {
    const profile = buildBootstrapProfile(reviewed.schemaProfile, historical);
    expect(profile.legacyXp).toEqual({ join: 10, submit: 25, ordinaryApproval: 100, fiveStarBonus: 50, testQualityRating: null, cumulative: 135, activeJoin: 10 });
  });
});
