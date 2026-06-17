import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";

vi.mock("../lib/social/service.js", () => ({
  refreshDueSocialAccounts: vi.fn().mockResolvedValue({ scanned: 2, failed: 1 }),
}));

const { refreshDueSocialAccounts } = await import("../lib/social/service.js");
const { app } = createApp();

describe("social refresh cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "secret-1234567890";
  });

  it("rejects requests without the Vercel cron bearer token", async () => {
    const res = await app.request("/api/cron/social-refresh");
    expect(res.status).toBe(401);
  });

  it("refreshes due accounts when authorized", async () => {
    const res = await app.request("/api/cron/social-refresh", {
      headers: { Authorization: "Bearer secret-1234567890" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scanned: 2, failed: 1 });
    expect(refreshDueSocialAccounts).toHaveBeenCalledWith(25);
  });
});
