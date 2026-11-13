// @vitest-environment node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { preparePhase3Delta, runDeltaPreparationCli, validatePhase3Catalog } from "./delta-preparation";

type MutableCatalog = Record<string, unknown> & {
  observedAt: string; connection: Record<string, unknown>; functions: Record<string, unknown>[];
  foreignKeys: Record<string, unknown>[]; triggers: Record<string, unknown>[]; history: Record<string, unknown>[];
};
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixturePath = join(root, "docs/verification/2026-11-13-phase3-delta-catalog.snapshot.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as MutableCatalog;
const now = new Date(Date.parse(fixture.observedAt) + 1_000);
const clone = () => structuredClone(fixture);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), "phase3-preparation-"));
  if (!directory.startsWith(join(tmpdir(), "phase3-preparation-"))) throw new Error("unexpected cleanup directory");
  return directory;
}

describe("fixed combined-baseline delta preparation", () => {
  it("binds the current captured baseline to the exact reviewed delta and retired constraint", async () => {
    const prepared = await preparePhase3Delta(root, clone(), now);
    expect(prepared.report).toMatchObject({ decision: "HOLD", validReleaseEvidence: false,
      baseline: { recordedRows: 17, combinedVersion: "20261031201901", sourceEnvelopeCount: 62 },
      delta: { version: "20261113090001", productionApplied: false }, automaticWrites: [],
      retiredConstraint: { removalVersion: "20260720193637" }, excludedVersions: ["20261103215321", "20261104134202"] });
    expect(prepared.packet.sqlSha256).toBe(sha(prepared.packet.sql));
    expect(prepared.packet.sqlSha256).toBe("e7ce6a847f57d05d9efde376a2a774e9f6b7310b3cb362fd979936a4891be9da");
    expect(prepared.report.scopeLimits.join(" ")).toContain("protected live executor remains unchanged");
  });

  it.each([
    ["wrong project", (value: MutableCatalog) => { value.projectRef = "other-project"; }],
    ["non-readonly", (value: MutableCatalog) => { value.transactionReadOnly = false; }],
    ["role substitution", (value: MutableCatalog) => { value.sessionRole = "service_role"; }],
    ["unreviewed server", (value: MutableCatalog) => { value.serverVersionNum = "170011"; }],
    ["unverified TLS", (value: MutableCatalog) => { value.connection.verifiedServerCertificate = false; }],
    ["unbound username", (value: MutableCatalog) => { value.connection.usernameProjectRefBound = false; }],
    ["raw statement field", (value: MutableCatalog) => { value.statements = ["select sensitive_value"]; }],
  ] as const)("rejects %s", (_label, mutate) => {
    const value = clone(); mutate(value);
    expect(() => validatePhase3Catalog(value, now)).toThrow("Phase 3 preparation rejected");
  });

  it("rejects stale, future and timezone-free captures", () => {
    expect(() => validatePhase3Catalog(clone(), new Date(now.getTime() + 60 * 60_000))).toThrow("stale");
    expect(() => validatePhase3Catalog(clone(), new Date(Date.parse(fixture.observedAt) - 1))).toThrow("future");
    const value = clone(); value.observedAt = "2026-11-13T09:42:00";
    expect(() => validatePhase3Catalog(value, now)).toThrow("capture time");
  });

  it("requires the real surviving composite foreign keys with enabled RI triggers", () => {
    for (const field of ["validated", "deferrable", "definition"] as const) {
      const value = clone();
      const key = value.foreignKeys.find(row => row.name === "mission_submissions_mission_workspace_fk")!;
      key[field] = field === "definition" ? "FOREIGN KEY (mission_id) REFERENCES missions(id)" : field === "deferrable";
      expect(() => validatePhase3Catalog(value, now)).toThrow("foreign-key");
    }
    const value = clone();
    value.triggers.find(row => row.constraintName === "mission_workflows_submission_workspace_fk")!.enabled = "D";
    expect(() => validatePhase3Catalog(value, now)).toThrow("trigger");
  });

  it("rejects missing RI coverage and reinstating the deliberately retired equality FK", () => {
    const missing = clone();
    missing.triggers = missing.triggers.filter(row => row.constraintName !== "mission_workflows_submission_workspace_fk");
    expect(() => validatePhase3Catalog(missing, now)).toThrow("trigger coverage");
    const extra = clone();
    extra.foreignKeys.push({ ...extra.foreignKeys[0], name: "mission_submissions_creator_workspace_fk" });
    expect(() => validatePhase3Catalog(extra, now)).toThrow("foreign-key inventory");
  });

  it("requires four distinct parent/child RI operations rather than a row count", () => {
    const duplicate = clone();
    const first = duplicate.triggers.find(row => row.constraintName === "mission_submissions_mission_workspace_fk")!;
    duplicate.triggers = duplicate.triggers.map(row => row.constraintName === first.constraintName ? structuredClone(first) : row);
    expect(() => validatePhase3Catalog(duplicate, now)).toThrow("trigger disabled, duplicated or replaced");
    for (const field of ["relation", "function"] as const) {
      const value = clone();
      const row = value.triggers.find(row => row.constraintName === "mission_workflows_submission_workspace_fk")!;
      row[field] = field === "relation" ? "unrelated_table" : "pg_catalog.RI_FKey_nonexistent";
      expect(() => validatePhase3Catalog(value, now)).toThrow("trigger disabled, duplicated or replaced");
    }
  });

  it("rejects broad grants, changed function attributes and duplicate signatures", () => {
    const grant = clone();
    (grant.functions[0]!.execute as Record<string, unknown>).public = true;
    expect(() => validatePhase3Catalog(grant, now)).toThrow("execute boundary");
    const attributes = clone();
    (attributes.functions[0]!.attributes as Record<string, unknown>).strict = true;
    expect(() => validatePhase3Catalog(attributes, now)).toThrow("attributes");
    const duplicate = clone(); duplicate.functions[1] = structuredClone(duplicate.functions[0]!);
    expect(() => validatePhase3Catalog(duplicate, now)).toThrow("duplicate function");
  });

  it("rejects history/hash drift even when migration names remain familiar", async () => {
    const value = clone(); value.history[0]!.statementsSha256 = "0".repeat(64);
    await expect(preparePhase3Delta(root, value, now)).rejects.toThrow("baseline history changed");
  });

  it("rejects replacing an observed predecessor body with a guessed canonical body", async () => {
    const value = clone(); value.functions[0]!.bodySha256 = "0".repeat(64);
    await expect(preparePhase3Delta(root, value, now)).rejects.toThrow("predecessor body differs");
  });

  it("imports under ordinary vite-node without invoking the producer CLI", async () => {
    const directory = await mkdtemp(join(root, ".phase3-import-"));
    if (!directory.startsWith(join(root, ".phase3-import-"))) throw new Error("unexpected import cleanup directory");
    try {
      const entrypoint = join(directory, "entry.ts");
      const unwantedOutput = join(directory, "unwanted-output");
      await writeFile(entrypoint, 'import "../scripts/release/delta-preparation.ts";\n');
      const child = spawnSync(process.execPath, [join(root, "node_modules/vite-node/vite-node.mjs"), entrypoint,
        "--", "--catalog", fixturePath, "--output", unwantedOutput], { cwd: root, stdio: "ignore", timeout: 30_000 });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      await expect(stat(unwantedOutput)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 40_000);

  it("creates only a new review directory and refuses apply/overwrite/junction outputs", async () => {
    const directory = await temporary();
    try {
      const input = join(directory, "catalog.json");
      const output = join(directory, "review");
      await writeFile(input, JSON.stringify(fixture));
      const args = ["--catalog", input, "--output", output];
      const report = await runDeltaPreparationCli(args, root, now);
      const sql = await readFile(join(output, "guarded-delta.sql"), "utf8");
      expect(sha(sql)).toBe(report.delta.packetSha256);
      expect(JSON.parse(await readFile(join(output, "preparation.json"), "utf8"))).toMatchObject({ validReleaseEvidence: false, decision: "HOLD" });
      await expect(runDeltaPreparationCli(args, root, now)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(join(output, "guarded-delta.sql"), "utf8")).toBe(sql);
      await expect(runDeltaPreparationCli([...args, "--apply"], root, now)).rejects.toThrow("usage");
      await expect(runDeltaPreparationCli([...args, "--catalog", input], root, now)).rejects.toThrow("usage");
      await symlink(join(root, "supabase/migrations"), join(directory, "alias"), process.platform === "win32" ? "junction" : "dir");
      await expect(runDeltaPreparationCli(["--catalog", input, "--output", join(directory, "alias", "new-review")], root, now)).rejects.toThrow("outside migrations");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
