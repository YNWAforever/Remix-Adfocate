import { afterEach, describe, expect, it, vi } from "vitest";
import { scanSocialAccountWithDeps, verifyOwnershipWithDeps } from "./service";
import { SocialProviderError, type SocialAccountRecord, type SocialScanResult } from "./types";

const baseAccount: SocialAccountRecord = {
  id: "acc-1",
  creator_id: "creator-1",
  workspace_id: "workspace-1",
  platform: "instagram",
  handle: "ming",
  profile_url: null,
  owner_verified: false,
  verification_code: null,
  verification_code_expires_at: null,
  verified_at: null,
  api_synced_at: null,
  sync_status: "pending",
  follower_count: null,
  following_count: null,
  post_count: null,
  bio: null,
  external_avatar_url: null,
  engagement_rate: null,
  avg_likes: null,
  avg_comments: null,
  posting_frequency: null,
  freshness_score: null,
  content_themes: [],
  summary: {},
  last_error_code: null,
  last_error_message: null,
};

const scanResult: SocialScanResult = {
  platform: "instagram",
  handle: "ming",
  profileUrl: "https://www.instagram.com/ming/",
  followerCount: 12000,
  followingCount: 321,
  postCount: 42,
  bio: "Beauty creator",
  externalAvatarUrl: "https://cdn.example.com/ming.jpg",
  engagementRate: 4.38,
  avgLikes: 500,
  avgComments: 25,
  postingFrequency: 2,
  freshnessScore: 100,
  contentThemes: ["beauty"],
  recentPostsSummary: [],
  summary: {
    postSampleSize: 0,
    hasRecentPosts: false,
    hasAvatar: true,
    hasBio: true,
  },
};

describe("social scan service", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores latest metrics and a snapshot after a successful scan", async () => {
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue(baseAccount),
      latestScanSnapshotAt: vi.fn().mockResolvedValue(null),
      updateAccountFromScan: vi
        .fn()
        .mockResolvedValue({ ...baseAccount, sync_status: "synced", follower_count: 12000 }),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi.fn(),
    };
    const provider = vi.fn().mockResolvedValue(scanResult);

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.follower_count).toBe(12000);
    expect(provider).toHaveBeenCalledWith({ platform: "instagram", handle: "ming" });
    expect(repo.updateAccountFromScan).toHaveBeenCalledWith("acc-1", scanResult);
    expect(repo.insertSnapshot).toHaveBeenCalledWith("acc-1", "rapidapi", "synced", scanResult);
  });

  it("skips provider calls during the manual scan cooldown and keeps prior metrics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T10:00:00.000Z"));

    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue({
        ...baseAccount,
        api_synced_at: "2026-06-18T09:30:00.000Z",
        sync_status: "synced",
        follower_count: 1000,
      }),
      latestScanSnapshotAt: vi.fn().mockResolvedValue(null),
      updateAccountFromScan: vi.fn(),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi
        .fn()
        .mockResolvedValue({ ...baseAccount, sync_status: "rate_limited", follower_count: 1000 }),
    };
    const provider = vi.fn();

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.sync_status).toBe("rate_limited");
    expect(account.follower_count).toBe(1000);
    expect(provider).not.toHaveBeenCalled();
    expect(repo.updateAccountFromScan).not.toHaveBeenCalled();
    expect(repo.markAccountScanFailed).toHaveBeenCalledWith("acc-1", {
      status: "rate_limited",
      errorCode: "rate_limited",
      errorMessage: "Social scan cooldown active",
    });
    expect(repo.insertSnapshot).toHaveBeenCalledWith(
      "acc-1",
      "rapidapi",
      "rate_limited",
      expect.objectContaining({
        errorCode: "rate_limited",
        errorMessage: "Social scan cooldown active",
      }),
    );
  });

  it("skips provider calls when a recent scan snapshot exists without a successful sync yet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T10:00:00.000Z"));

    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue({
        ...baseAccount,
        api_synced_at: null,
        sync_status: "failed",
        follower_count: 1000,
      }),
      latestScanSnapshotAt: vi.fn().mockResolvedValue("2026-06-18T09:30:00.000Z"),
      updateAccountFromScan: vi.fn(),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi
        .fn()
        .mockResolvedValue({ ...baseAccount, sync_status: "rate_limited", follower_count: 1000 }),
    };
    const provider = vi.fn();

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.sync_status).toBe("rate_limited");
    expect(provider).not.toHaveBeenCalled();
    expect(repo.markAccountScanFailed).toHaveBeenCalledWith("acc-1", {
      status: "rate_limited",
      errorCode: "rate_limited",
      errorMessage: "Social scan cooldown active",
    });
    expect(repo.insertSnapshot).toHaveBeenCalledWith(
      "acc-1",
      "rapidapi",
      "rate_limited",
      expect.objectContaining({
        errorCode: "rate_limited",
        errorMessage: "Social scan cooldown active",
      }),
    );
  });

  it("still performs a first scan when there is no successful sync and no snapshot history", async () => {
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue(baseAccount),
      latestScanSnapshotAt: vi.fn().mockResolvedValue(null),
      updateAccountFromScan: vi
        .fn()
        .mockResolvedValue({ ...baseAccount, sync_status: "synced", follower_count: 12000 }),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi.fn(),
    };
    const provider = vi.fn().mockResolvedValue(scanResult);

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.sync_status).toBe("synced");
    expect(provider).toHaveBeenCalledWith({ platform: "instagram", handle: "ming" });
    expect(repo.updateAccountFromScan).toHaveBeenCalledWith("acc-1", scanResult);
  });

  it("records failed status without erasing prior metrics", async () => {
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue({ ...baseAccount, follower_count: 1000 }),
      latestScanSnapshotAt: vi.fn().mockResolvedValue(null),
      updateAccountFromScan: vi.fn(),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi
        .fn()
        .mockResolvedValue({ ...baseAccount, sync_status: "rate_limited", follower_count: 1000 }),
    };
    const provider = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("limited"), { code: "rate_limited", status: "rate_limited" }));

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.sync_status).toBe("rate_limited");
    expect(account.follower_count).toBe(1000);
    expect(repo.updateAccountFromScan).not.toHaveBeenCalled();
    expect(repo.insertSnapshot).toHaveBeenCalledWith(
      "acc-1",
      "rapidapi",
      "rate_limited",
      expect.objectContaining({ errorCode: "rate_limited" }),
    );
  });

  it("rethrows provider_not_configured without mutating account state", async () => {
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue(baseAccount),
      latestScanSnapshotAt: vi.fn().mockResolvedValue(null),
      updateAccountFromScan: vi.fn(),
      insertSnapshot: vi.fn(),
      markAccountScanFailed: vi.fn(),
    };
    const provider = vi
      .fn()
      .mockRejectedValue(
        new SocialProviderError("provider_not_configured", "RapidAPI social scan is not configured"),
      );

    await expect(
      scanSocialAccountWithDeps({
        creatorId: "creator-1",
        accountId: "acc-1",
        repo,
        provider,
      }),
    ).rejects.toMatchObject({ code: "provider_not_configured" });

    expect(repo.updateAccountFromScan).not.toHaveBeenCalled();
    expect(repo.markAccountScanFailed).not.toHaveBeenCalled();
    expect(repo.insertSnapshot).not.toHaveBeenCalled();
  });

  it("normalizes unexpected provider throws into failed provider_error snapshots", async () => {
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue(baseAccount),
      latestScanSnapshotAt: vi.fn().mockResolvedValue(null),
      updateAccountFromScan: vi.fn(),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
      markAccountScanFailed: vi
        .fn()
        .mockResolvedValue({ ...baseAccount, sync_status: "failed", last_error_code: "provider_error" }),
    };
    const provider = vi.fn().mockRejectedValue(new Error("socket hang up"));

    const account = await scanSocialAccountWithDeps({
      creatorId: "creator-1",
      accountId: "acc-1",
      repo,
      provider,
    });

    expect(account.sync_status).toBe("failed");
    expect(repo.markAccountScanFailed).toHaveBeenCalledWith("acc-1", {
      status: "failed",
      errorCode: "provider_error",
      errorMessage: "Social scan provider failed",
    });
    expect(repo.insertSnapshot).toHaveBeenCalledWith(
      "acc-1",
      "rapidapi",
      "failed",
      expect.objectContaining({
        errorCode: "provider_error",
        errorMessage: "Social scan provider failed",
      }),
    );
  });

  it("propagates account update write failures without rewriting them as provider errors", async () => {
    const repoError = new Error("write failed");
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue(baseAccount),
      latestScanSnapshotAt: vi.fn().mockResolvedValue(null),
      updateAccountFromScan: vi.fn().mockRejectedValue(repoError),
      insertSnapshot: vi.fn(),
      markAccountScanFailed: vi.fn(),
    };
    const provider = vi.fn().mockResolvedValue(scanResult);

    await expect(
      scanSocialAccountWithDeps({
        creatorId: "creator-1",
        accountId: "acc-1",
        repo,
        provider,
      }),
    ).rejects.toBe(repoError);

    expect(repo.markAccountScanFailed).not.toHaveBeenCalled();
    expect(repo.insertSnapshot).not.toHaveBeenCalled();
  });

  it("propagates failure-status write errors without inserting a failure snapshot", async () => {
    const repoError = new Error("failure write failed");
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue(baseAccount),
      latestScanSnapshotAt: vi.fn().mockResolvedValue(null),
      updateAccountFromScan: vi.fn(),
      insertSnapshot: vi.fn(),
      markAccountScanFailed: vi.fn().mockRejectedValue(repoError),
    };
    const provider = vi
      .fn()
      .mockRejectedValue(new SocialProviderError("rate_limited", "RapidAPI rate limit reached", "rate_limited"));

    await expect(
      scanSocialAccountWithDeps({
        creatorId: "creator-1",
        accountId: "acc-1",
        repo,
        provider,
      }),
    ).rejects.toBe(repoError);

    expect(repo.insertSnapshot).not.toHaveBeenCalled();
  });

  it("propagates snapshot write failures after a successful scan", async () => {
    const repoError = new Error("snapshot failed");
    const repo = {
      getAccountForCreator: vi.fn().mockResolvedValue(baseAccount),
      latestScanSnapshotAt: vi.fn().mockResolvedValue(null),
      updateAccountFromScan: vi
        .fn()
        .mockResolvedValue({ ...baseAccount, sync_status: "synced", follower_count: 12000 }),
      insertSnapshot: vi.fn().mockRejectedValue(repoError),
      markAccountScanFailed: vi.fn(),
    };
    const provider = vi.fn().mockResolvedValue(scanResult);

    await expect(
      scanSocialAccountWithDeps({
        creatorId: "creator-1",
        accountId: "acc-1",
        repo,
        provider,
      }),
    ).rejects.toBe(repoError);

    expect(repo.markAccountScanFailed).not.toHaveBeenCalled();
  });

  it("continues refreshing other due accounts when one scan fails", async () => {
    vi.resetModules();

    const accounts = [
      { ...baseAccount, id: "acc-ok", handle: "good", sync_status: "stale" as const },
      { ...baseAccount, id: "acc-boom", handle: "boom", sync_status: "stale" as const },
      { ...baseAccount, id: "acc-config", handle: "no-provider", sync_status: "stale" as const },
    ];

    const repo = {
      listDueSocialAccounts: vi.fn().mockResolvedValue(accounts),
      getAccountForCreator: vi.fn(async (_supabase: unknown, input: { creatorId: string; accountId: string }) => {
        return accounts.find((account) => account.id === input.accountId) ?? null;
      }),
      latestScanSnapshotAt: vi.fn(async () => null),
      updateAccountFromScan: vi.fn(async (_supabase: unknown, accountId: string, result: SocialScanResult) => ({
        ...baseAccount,
        id: accountId,
        handle: result.handle,
        sync_status: "synced" as const,
        follower_count: result.followerCount,
      })),
      markAccountScanFailed: vi.fn(
        async (_supabase: unknown, accountId: string, failure: { errorCode: string }) => ({
        ...baseAccount,
        id: accountId,
        sync_status: "failed" as const,
        last_error_code: failure.errorCode,
        }),
      ),
      insertSnapshot: vi.fn().mockResolvedValue(undefined),
    };
    const persistScores = vi.fn().mockResolvedValue(undefined);
    const scanRapidApiProfile = vi.fn(async ({ platform, handle }: { platform: "instagram" | "threads"; handle: string }) => {
      if (handle === "boom") throw new Error("socket hang up");
      if (handle === "no-provider") {
        throw new SocialProviderError("provider_not_configured", "RapidAPI social scan is not configured");
      }

      return {
        ...scanResult,
        platform,
        handle,
        profileUrl:
          platform === "instagram"
            ? `https://www.instagram.com/${handle}/`
            : `https://www.threads.net/@${handle}`,
      };
    });

    vi.doMock("../supabase", () => ({
      serviceClient: vi.fn(() => ({})),
    }));
    vi.doMock("./repo", () => repo);
    vi.doMock("../persistScores", () => ({ persistScores }));
    vi.doMock("./rapidApi", () => ({ scanRapidApiProfile }));

    const { refreshDueSocialAccounts } = await import("./service");
    const result = await refreshDueSocialAccounts(25);

    expect(result).toEqual({ scanned: 1, failed: 2 });
    expect(scanRapidApiProfile).toHaveBeenCalledTimes(3);
    expect(repo.markAccountScanFailed).toHaveBeenCalledTimes(1);
    expect(repo.markAccountScanFailed).toHaveBeenCalledWith(
      {},
      "acc-boom",
      expect.objectContaining({ errorCode: "provider_error" }),
    );
    expect(repo.insertSnapshot).toHaveBeenCalledTimes(2);
    expect(persistScores).toHaveBeenCalledTimes(2);
  });
});

describe("verifyOwnershipWithDeps", () => {
  const account = {
    ...baseAccount,
    verification_code: "ADF-7K9Q2M",
    verification_code_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    verified_at: null,
  };
  function deps(over: Partial<{ acct: typeof account; bio: string | null }> = {}) {
    const verified = { ...(over.acct ?? account), owner_verified: true, verified_at: new Date().toISOString() };
    return {
      repo: {
        getAccountForCreator: vi.fn().mockResolvedValue(over.acct ?? account),
        markVerified: vi.fn().mockResolvedValue(verified),
      },
      provider: vi.fn().mockResolvedValue({ bio: over.bio ?? "beauty creator ADF-7K9Q2M in HK" }),
      verified,
    };
  }

  it("flips verified when the code is in the bio (case-insensitive)", async () => {
    const d = deps({ bio: "Beauty ✨ adf-7k9q2m" });
    const res = await verifyOwnershipWithDeps({ creatorId: "creator-1", accountId: "acc-1", repo: d.repo, provider: d.provider });
    expect(d.repo.markVerified).toHaveBeenCalledWith("acc-1");
    expect(res.owner_verified).toBe(true);
  });

  it("throws code_not_in_bio when absent", async () => {
    const d = deps({ bio: "no code here" });
    await expect(verifyOwnershipWithDeps({ creatorId: "creator-1", accountId: "acc-1", repo: d.repo, provider: d.provider }))
      .rejects.toMatchObject({ code: "code_not_in_bio" });
    expect(d.repo.markVerified).not.toHaveBeenCalled();
  });

  it("throws code_expired when expired or missing", async () => {
    const expired = { ...account, verification_code_expires_at: new Date(Date.now() - 1000).toISOString() };
    const d = deps({ acct: expired });
    await expect(verifyOwnershipWithDeps({ creatorId: "creator-1", accountId: "acc-1", repo: d.repo, provider: d.provider }))
      .rejects.toMatchObject({ code: "code_expired" });
    expect(d.provider).not.toHaveBeenCalled();
  });

  it("propagates provider_not_configured", async () => {
    const d = deps();
    d.provider.mockRejectedValue(new SocialProviderError("provider_not_configured", "off"));
    await expect(verifyOwnershipWithDeps({ creatorId: "creator-1", accountId: "acc-1", repo: d.repo, provider: d.provider }))
      .rejects.toMatchObject({ code: "provider_not_configured" });
  });
});
