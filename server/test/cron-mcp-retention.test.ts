import { describe, it, expect, vi, beforeEach } from "vitest";

const { deleteMock, ltMock, fromMock } = vi.hoisted(() => ({ deleteMock: vi.fn(), ltMock: vi.fn(), fromMock: vi.fn() }));
vi.mock("../lib/supabase.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/supabase.js")>();
  return { ...actual, serviceClient: () => ({ from: fromMock }) };
});

process.env.CRON_SECRET = process.env.CRON_SECRET || "test-cron-secret";
const { createApp } = await import("../app");
const { app } = createApp();
const SECRET = process.env.CRON_SECRET;
const path = "/api/cron/mcp-audit-retention";
const authed = () => app.request(path, { headers: { Authorization: `Bearer ${SECRET}` } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("STUDIO_MCP_ENABLED", "true");
  fromMock.mockImplementation(() => ({
    delete: (options: unknown) => {
      deleteMock(options);
      return {
        lt: (column: string, value: string) => {
          ltMock(column, value);
          return { then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, count: 7 }).then(resolve) };
        },
      };
    },
  }));
});

describe("cron mcp audit retention", () => {
  it("401s without the secret", async () => {
    expect((await app.request(path)).status).toBe(401);
    expect((await app.request(path, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("skips cleanly when MCP is disabled", async () => {
    vi.stubEnv("STUDIO_MCP_ENABLED", "false");
    const response = await authed();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: true, deleted: 0, code: "mcp_disabled" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("deletes audit rows older than 90 days", async () => {
    const response = await authed();
    expect(response.status).toBe(200);
    const body = await response.json() as { deleted: number; proposalsDeleted: number; cutoff: string };
    expect(body.deleted).toBe(7);
    expect(body.proposalsDeleted).toBe(7);
    expect(fromMock).toHaveBeenCalledWith("mcp_call_audit");
    expect(fromMock).toHaveBeenCalledWith("assistant_proposal_audit");
    expect(deleteMock).toHaveBeenCalledWith({ count: "exact" });
    expect(ltMock).toHaveBeenCalledWith("created_at", expect.any(String));
    const cutoff = Date.parse(String(ltMock.mock.calls[0][1]));
    const ageDays = (Date.now() - cutoff) / 86_400_000;
    expect(ageDays).toBeGreaterThan(89.9);
    expect(ageDays).toBeLessThan(90.1);
  });
});
