import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";

vi.mock("../lib/social/service.js", () => ({
  refreshDueSocialAccounts: vi.fn().mockResolvedValue({ scanned: 2, failed: 1 }),
}));

const { refreshDueSocialAccounts } = await import("../lib/social/service.js");
const { app } = createApp();
const ORIGINAL_ENV = {
  CRON_SECRET: process.env.CRON_SECRET,
  RAPIDAPI_KEY: process.env.RAPIDAPI_KEY,
  RAPIDAPI_INSTAGRAM_PROFILE_URL: process.env.RAPIDAPI_INSTAGRAM_PROFILE_URL,
  RAPIDAPI_THREADS_PROFILE_URL: process.env.RAPIDAPI_THREADS_PROFILE_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("social refresh cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "secret-1234567890";
    process.env.RAPIDAPI_KEY = "rapid-key";
    process.env.RAPIDAPI_INSTAGRAM_PROFILE_URL = "https://instagram.example.com";
    process.env.RAPIDAPI_THREADS_PROFILE_URL = "https://threads.example.com";
  });

  afterEach(() => {
    restoreEnv();
  });

  it("rejects requests without the Vercel cron bearer token", async () => {
    const res = await app.request("/api/cron/social-refresh");
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong Vercel cron bearer token", async () => {
    const res = await app.request("/api/cron/social-refresh", {
      headers: { Authorization: "Bearer not-the-secret" },
    });

    expect(res.status).toBe(401);
  });

  it("skips refresh when RapidAPI scan config is missing", async () => {
    delete process.env.RAPIDAPI_KEY;

    const res = await app.request("/api/cron/social-refresh", {
      headers: { Authorization: "Bearer secret-1234567890" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scanned: 0,
      failed: 0,
      skipped: true,
      code: "provider_not_configured",
    });
    expect(refreshDueSocialAccounts).not.toHaveBeenCalled();
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
