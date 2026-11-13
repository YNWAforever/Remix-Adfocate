// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error Existing audited SQL lexer has no declaration file.
import { topLevelStatements } from "../audit/b2-bootstrap-profile.mjs";
import { compileDeltaProgram, bindDeltaExecutionContext, digestDeltaExecutionProgram, type DeltaProgramBindings } from "./delta-program";
import { DELTA_BASELINE_HISTORY_SHA256, DELTA_REVIEWED_PACKET_SHA256, DELTA_SOURCE_SHA256 } from "./delta-release-contracts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const h = (text: string) => createHash("sha256").update(text).digest("hex");
async function bindings(): Promise<DeltaProgramBindings> {
  const hashFile = async (path: string) => h((await readFile(resolve(root, path), "utf8")).replace(/\r\n?/g, "\n"));
  return { sourceCommit: "dc2416adb34dea2a42f84d2e2760bd0e6a4be905", targetBindingHash: h("synthetic-test-target-no-source-connection"),
    collectorSha256: await hashFile("scripts/release/delta-semantic-capture.sql"), canonicalizerSha256: await hashFile("scripts/release/delta-fingerprint.ts"),
    invariantCollectorSha256: await hashFile("scripts/release/delta-invariant-capture.sql"),
    deferredAbsenceHashes: { "20261103215321": h("synthetic-absence-receipt-growth"), "20261104134202": h("synthetic-absence-receipt-publish") },
    retiredConstraintAbsenceHash: h("synthetic-retired-constraint-absence") };
}

describe("real repository combined-baseline program derivation (offline only)", () => {
  it("rederives 67 sources, the reviewed 62 envelope and exact XP packet without an inner COMMIT", async () => {
    const program = await compileDeltaProgram(root, await bindings());
    expect(program.plan.baseline.recordedRows).toBe(17);
    expect(program.plan.baseline.historySha256).toBe(DELTA_BASELINE_HISTORY_SHA256);
    expect(program.plan.delta.sourceSha256).toBe(DELTA_SOURCE_SHA256);
    expect(program.plan.delta.reviewedPacketSha256).toBe(DELTA_REVIEWED_PACKET_SHA256);
    expect(program.requiredCapabilities.length).toBeGreaterThan(800);
    expect(new Set(program.requiredCapabilities).size).toBe(program.requiredCapabilities.length);
    expect(program.applyDoSql.trimStart()).toMatch(/^DO\s+\$/i);
    expect((topLevelStatements(program.applyDoSql) as string[]).map(statement => statement.trim().split(/\s+/)[0].toUpperCase())).toEqual(["DO", "SET"]);
    expect(program.sessionLockSql).toContain("pg_advisory_lock");
    expect(program.beginSql).toContain("REPEATABLE READ READ WRITE");
    expect(program.expiryGuardSql).toContain("clock_timestamp");
    expect(program.applyDoSql).toContain("clock_timestamp");
    expect(digestDeltaExecutionProgram({ ...program, scopeDigest: program.plan.scopeDigest })).toBe(program.executionProgramSha256);
    expect(digestDeltaExecutionProgram({ ...program, scopeDigest: program.plan.scopeDigest, sessionLockSql: "SELECT 0;" })).not.toBe(program.executionProgramSha256);
  });
  it.each(["collectorSha256", "canonicalizerSha256", "invariantCollectorSha256"] as const)("rejects changed %s source bytes before generating a program", async key => {
    const input = await bindings();
    await expect(compileDeltaProgram(root, { ...input, [key]: h(`incorrect-${key}`) })).rejects.toThrow(/collector implementation bytes/);
  });
  it("binds fixed hashes and expiry through safe transaction-local context only", () => {
    const context = bindDeltaExecutionContext({ evidenceDigest: h("evidence"), programSha256: h("program"), scopeDigest: h("scope"), expiresAt: "2026-11-14T00:00:00.000Z" });
    expect(context).toContain("set_config('adfocate.release_bindings'");
    expect(context).toContain("true");
    expect(context).not.toMatch(/COMMIT|ROLLBACK/);
    expect(() => bindDeltaExecutionContext({ evidenceDigest: "';DROP SCHEMA public CASCADE;--", programSha256: h("p"), scopeDigest: h("s"), expiresAt: "invalid" })).toThrow();
  });
});
