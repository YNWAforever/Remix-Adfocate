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
  expectedCapabilities: ["table:public.mission_workflows"],
  now: new Date("2026-08-01T00:00:00Z"),
};

describe("release rehearsal", () => {
  it("checks production shape before applying and runs the complete ordered gates", async () => {
    const preflight = vi.fn()
      .mockResolvedValueOnce({ schemaFingerprint: "prod-shape" })
      .mockResolvedValueOnce({
        schemaFingerprint: "empty-expanded-shape",
        capabilities: [{ name: "table:public.mission_workflows", status: "present" }],
      })
      .mockResolvedValueOnce({
        schemaFingerprint: "expanded-shape",
        capabilities: [{ name: "table:public.mission_workflows", status: "present" }],
      });
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "No pending migrations", stderr: "" });

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
      LEGACY_ONLY: "1",
    });
    expect(run.mock.calls[7]?.[2]?.env?.LEGACY_ONLY).toBeUndefined();
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

  it("rejects an IPv6 loopback API because the integration runner does not accept it", async () => {
    await expect(runRehearsal({
      ...baseInput,
      shapedTarget: { ...baseInput.shapedTarget, apiUrl: "http://[::1]:54321" },
    }, { run: vi.fn(), preflight: vi.fn() })).rejects.toThrow("loopback HTTP(S) URL");
  });

  it("fails closed before process execution without declared capabilities", async () => {
    const run = vi.fn();
    const preflight = vi.fn();

    await expect(runRehearsal({ ...baseInput, expectedCapabilities: [] }, { run, preflight }))
      .rejects.toThrow("declared capabilities");

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
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "No pending migrations", stderr: "" });
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

  it("requires every declared capability after shaped-target replay", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "No pending migrations", stderr: "" });
    const preflight = vi.fn()
      .mockResolvedValueOnce({ schemaFingerprint: "prod-shape" })
      .mockResolvedValueOnce({
        schemaFingerprint: "empty-expanded-shape",
        capabilities: [{ name: "table:public.mission_workflows", status: "present" }],
      })
      .mockResolvedValueOnce({
        schemaFingerprint: "expanded-shape",
        capabilities: [{ name: "table:public.mission_workflows", status: "absent" }],
      });

    await expect(runRehearsal(baseInput, { run, preflight }))
      .rejects.toThrow("shaped target missing required capabilities");
  });

  it.each([
    ["pass"],
    ["would be applied: 20260731100000_reward_handoff_schema.sql"],
  ])("rejects replay output that does not prove a clean migration history: %s", async (replayOutput) => {
    const run = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: "irrelevant", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "irrelevant", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "irrelevant", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "irrelevant", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: replayOutput, stderr: "" });
    const preflight = vi.fn()
      .mockResolvedValueOnce({ schemaFingerprint: "prod-shape" })
      .mockResolvedValueOnce({
        schemaFingerprint: "empty-expanded-shape",
        capabilities: [{ name: "table:public.mission_workflows", status: "present" }],
      });

    await expect(runRehearsal(baseInput, { run, preflight }))
      .rejects.toThrow("did not prove no pending migrations");
    expect(run).toHaveBeenCalledTimes(5);
  });
});
