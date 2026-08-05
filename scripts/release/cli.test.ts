import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { executePilotCli } from "./pilot";
import { executeObserverCli } from "./observer";

const thresholds = {
  maxQueueAgeSeconds: 3600,
  maxReviewLatencySeconds: 86400,
  maxOverdueItems: 0,
  maxUnexpected5xx: 0,
  maxDatabaseErrorClusters: 0,
  maxNotificationDeadLetters: 0,
};

function observation(day: number, completed = 0, pending = 0) {
  return {
    observedAt: new Date(Date.UTC(2026, 7, day)).toISOString(),
    workspaceId: "workspace-1",
    missionId: "mission-1",
    workflowCount: 1,
    submissionCount: 1,
    proofAttemptCount: 1,
    completionDecisionCount: 1,
    pendingRewards: pending,
    completedWorkflows: completed,
    completedCreatorCount: 1,
    creatorIdentityHash: "1".repeat(64),
    workflowIds: ["2".repeat(64)],
    integrityIncidents: 0,
    tenantIsolationIncidents: 0,
    illegalTransitions: 0,
    duplicateDecisions: 0,
    missingRewardContracts: 0,
    notificationRetries: 0,
    notificationDeadLetters: 0,
    maxQueueAgeSeconds: 0,
    reviewLatencySeconds: 0,
    overdueItems: 0,
    unexpected5xx: 0,
    requestErrorClusters: 0,
    databaseErrorClusters: 0,
    queueHealthy: true,
    telemetryAvailable: true,
    notificationQueueHealthy: true,
    retryQueueHealthy: true,
    financialMovement: { points: 0, cash: 0, xp: 0, ledgerRows: 0 },
    rewardSnapshotBefore: { points: 10, cash: 0, xp: 0 },
    rewardSnapshotAfter: { points: 10, cash: 0, xp: 0 },
    thresholds,
  };
}

function runNpmScript(script: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  try {
    const stdout = execFileSync("npm", ["run", script, "--", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const caught = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string; output?: Array<Buffer | string | null> };
    return {
      status: caught.status ?? 1,
      output: [
        ...(caught.output ?? []),
        caught.stdout,
        caught.stderr,
      ].filter((value): value is Buffer | string => value !== undefined && value !== null)
        .map((value) => value.toString())
        .join(""),
    };
  }
}

describe("release npm entrypoints", () => {
  it("fails closed when release:execute runs without database configuration", () => {
    const result = runNpmScript("release:execute", [
      "--bundle",
      "nonexistent.json",
      "--bundle-digest",
      "a".repeat(64),
      "--project-ref",
      "release-project",
      "--approval",
      `APPROVE release-project ${"a".repeat(64)}`,
      "--apply",
    ], { RELEASE_DATABASE_URL: "", RELEASE_PROJECT_REF: "release-project", RELEASE_APPLICATION_COMMIT: "e".repeat(40) });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("RELEASE_DATABASE_URL is required");
  }, 180000);

  it("fails closed when release:evidence runs without an input file", () => {
    const result = runNpmScript("release:evidence", [], {});

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("usage: evidence.ts --input");
  }, 180000);
});

describe("guarded pilot/observer commands", () => {
  it("executes the npm/vite-node evaluate boundary even when VITEST is inherited", () => {
    const runner = process.execPath;
    const viteNode = resolve("node_modules/vite-node/vite-node.mjs");
    let output = "";
    let status = 0;
    try {
      output = execFileSync(runner, [viteNode, "--script", resolve("scripts/release/observer-cli.ts"), "evaluate"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VITEST: "1",
          RELEASE_PILOT_OBSERVATIONS_PATH: "",
          RELEASE_PILOT_CONTAINMENT_JSON: "",
          RELEASE_PILOT_CONTAINMENT_PATH: "",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const caught = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string; output?: Array<Buffer | string | null> };
      status = caught.status ?? 1;
      output = [
        ...(caught.output ?? []),
        caught.stdout,
        caught.stderr,
      ].filter((value): value is Buffer | string => value !== undefined && value !== null)
        .map((value) => value.toString())
        .join("");
    }
    expect(status).not.toBe(0);
    const line = output.trim().split(/\r?\n/).at(-1);
    expect(line).toBeTruthy();
    expect(JSON.parse(line!)).toMatchObject({ status: "failed" });
    expect(output).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|postgres(?:ql)?:\/\/[^\s"']+/i);
  }, 30000);

  it("executes the real npm entrypoint and fails closed with JSON", () => {
    const runner = process.execPath;
    const viteNode = resolve("node_modules/vite-node/vite-node.mjs");
    let error: { stdout?: Buffer; stderr?: Buffer } | undefined;
    try {
      execFileSync(runner, [viteNode, "--script", resolve("scripts/release/observer-cli.ts"), "evaluate"], {
        cwd: process.cwd(),
        env: { ...process.env, RELEASE_PILOT_OBSERVATIONS_PATH: "", RELEASE_PILOT_CONTAINMENT_JSON: "" },
        encoding: "buffer",
      });
    } catch (caught) {
      error = caught as { stdout?: Buffer; stderr?: Buffer; output?: Array<Buffer | string | null> };
    }
    expect(error).toBeDefined();
    const captured = error as { stdout?: Buffer | string; stderr?: Buffer | string; output?: Array<Buffer | string | null> };
    const output = [
      ...(captured.output ?? []),
      captured.stdout,
      captured.stderr,
    ].filter((value): value is Buffer | string => value !== undefined && value !== null)
      .map((value) => value.toString())
      .join("");
    expect(output).toContain("RELEASE_PILOT_OBSERVATIONS_PATH");
  });

  it("refuses pilot inspect without explicit service-client configuration", async () => {
    await expect(executePilotCli(["inspect"], {
      RELEASE_PILOT_WORKSPACE_ID: "workspace-1",
      RELEASE_PILOT_MISSION_ID: "mission-1",
    })).rejects.toThrow("explicit Supabase service client configuration");
  });

  it("evaluates observations from an approved input path without a database client", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adfocate-pilot-cli-"));
    const observationsPath = join(directory, "observations.json");
    const observations = Array.from({ length: 7 }, (_, index) => observation(index + 1, index === 6 ? 1 : 0, index === 6 ? 1 : 0));
    await writeFile(observationsPath, JSON.stringify(observations), "utf8");
    try {
      const result = await executeObserverCli(["evaluate"], {
        RELEASE_PILOT_OBSERVATIONS_PATH: observationsPath,
        RELEASE_PILOT_CONTAINMENT_JSON: JSON.stringify({ passed: true, thresholds }),
      });
      expect(result).toEqual({ decision: "expand", reasons: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when evaluate input or containment evidence is missing", async () => {
    await expect(executeObserverCli(["evaluate"], {})).rejects.toThrow("RELEASE_PILOT_OBSERVATIONS_PATH");
  });
});
