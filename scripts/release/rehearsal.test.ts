import { describe, expect, it, vi } from "vitest";
import { runRehearsal } from "./rehearsal";

const baseInput = {
  emptyTarget: { ref: "local-empty", databaseUrl: "postgresql://empty/db" },
  shapedTarget: {
    ref: "local-rehearsal-shape",
    databaseUrl: "postgresql://shape/db",
    apiUrl: "http://127.0.0.1:54321",
    anonKey: "disposable-anon-key",
    serviceKey: "disposable-service-key",
  },
  production: {
    ref: "mhkoayftiuojxlrkollf",
    databaseUrl: "postgresql://production/db",
    schemaFingerprint: "prod-shape",
  },
  manifestDigest: "a".repeat(64),
  now: new Date("2026-08-01T00:00:00Z"),
};

describe("release rehearsal", () => {
  it("checks production shape before applying and runs the complete ordered gates", async () => {
    const preflight = vi.fn()
      .mockResolvedValueOnce({ schemaFingerprint: "prod-shape" })
      .mockResolvedValueOnce({
        schemaFingerprint: "empty-expanded-shape",
        capabilities: [{ status: "present" }],
      })
      .mockResolvedValueOnce({
        schemaFingerprint: "expanded-shape",
        capabilities: [{ status: "present" }],
      });
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "pass", stderr: "" });

    const report = await runRehearsal(baseInput, { run, preflight });

    expect(run.mock.calls.map((call) => call[1].join(" "))).toEqual([
      "run test:legacy-integration",
      "supabase db reset --db-url postgresql://empty/db --no-seed",
      "supabase db push --dry-run --db-url postgresql://shape/db",
      "supabase db push --db-url postgresql://shape/db",
      "supabase db push --dry-run --db-url postgresql://shape/db",
      "run seed:reward-handoff-acceptance",
      "run test:integration",
      "run test:legacy-integration",
      "run test:active-missions",
    ]);
    expect(run.mock.calls[0]?.[2]?.env).toMatchObject({
      RUN_INTEGRATION: "1",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "disposable-anon-key",
      SUPABASE_SERVICE_KEY: "disposable-service-key",
    });
    expect(report.status).toBe("passed");
    expect(JSON.stringify(report)).not.toContain("disposable-anon-key");
    expect(JSON.stringify(report)).not.toContain("disposable-service-key");
  });

  it("fails closed before process execution when the target API is not loopback", async () => {
    const run = vi.fn();
    const preflight = vi.fn();

    await expect(runRehearsal({
      ...baseInput,
      shapedTarget: { ...baseInput.shapedTarget, apiUrl: "https://example.supabase.co" },
    }, { run, preflight })).rejects.toThrow("loopback HTTP(S) URL");

    expect(run).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
  });

  it("does not write a shaped target when its preflight fingerprint drifts", async () => {
    const run = vi.fn();
    const preflight = vi.fn().mockResolvedValue({ schemaFingerprint: "unexpected-shape" });

    await expect(runRehearsal(baseInput, { run, preflight }))
      .rejects.toThrow("production-shaped schema fingerprint mismatch");

    expect(run).not.toHaveBeenCalled();
  });

  it("requires every empty-target capability before shaped-target commands", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "pass", stderr: "" });
    const preflight = vi.fn()
      .mockResolvedValueOnce({ schemaFingerprint: "prod-shape" })
      .mockResolvedValueOnce({
        schemaFingerprint: "empty-expanded-shape",
        capabilities: [{ name: "table:public.mission_workflows", status: "absent" }],
      });

    await expect(runRehearsal(baseInput, { run, preflight }))
      .rejects.toThrow("empty target missing required capabilities");

    expect(run.mock.calls.map((call) => call[1].join(" "))).toEqual([
      "run test:legacy-integration",
      "supabase db reset --db-url postgresql://empty/db --no-seed",
    ]);
  });
});
