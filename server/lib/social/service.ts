import { serviceClient } from "../supabase";
import { persistScores } from "../persistScores";
import { scanRapidApiProfile } from "./rapidApi";
import * as repo from "./repo";
import type {
  SocialAccountRecord,
  SocialPlatform,
  SocialProviderError,
  SocialProviderErrorCode,
  SocialScanResult,
  SocialSyncStatus,
} from "./types";

type Provider = (input: { platform: SocialPlatform; handle: string }) => Promise<SocialScanResult>;

type ScanRepo = {
  getAccountForCreator: (creatorId: string, accountId: string) => Promise<SocialAccountRecord | null>;
  updateAccountFromScan: (accountId: string, result: SocialScanResult) => Promise<SocialAccountRecord>;
  insertSnapshot: (
    accountId: string,
    provider: string,
    status: SocialSyncStatus,
    result: SocialScanResult | { errorCode: string; errorMessage: string },
  ) => Promise<void>;
  markAccountScanFailed: (
    accountId: string,
    input: { status: SocialSyncStatus; errorCode: string; errorMessage: string },
  ) => Promise<SocialAccountRecord>;
};

export const MANUAL_SOCIAL_SCAN_COOLDOWN_MS = 60 * 60 * 1000;
export const MANUAL_SOCIAL_SCAN_COOLDOWN_MESSAGE = "Social scan cooldown active";
export const UNEXPECTED_PROVIDER_ERROR_MESSAGE = "Social scan provider failed";

const PROVIDER_ERROR_CODES = new Set<SocialProviderErrorCode>([
  "provider_not_configured",
  "not_found",
  "private_or_unavailable",
  "rate_limited",
  "provider_error",
]);

function isProviderFailure(err: unknown): err is SocialProviderError {
  if (!err || typeof err !== "object") return false;
  const maybeError = err as { code?: unknown };
  return typeof maybeError.code === "string" && PROVIDER_ERROR_CODES.has(maybeError.code as SocialProviderErrorCode);
}

function errorStatus(
  err: unknown,
): { status: SocialSyncStatus; code: SocialProviderErrorCode | "provider_error"; message: string } {
  if (!isProviderFailure(err)) {
    return {
      status: "failed",
      code: "provider_error",
      message: UNEXPECTED_PROVIDER_ERROR_MESSAGE,
    };
  }

  const e = err as { code?: SocialProviderErrorCode; status?: SocialSyncStatus; message?: string };
  return {
    status: e.status ?? (e.code === "rate_limited" ? "rate_limited" : "failed"),
    code: e.code ?? "provider_error",
    message: e.message ?? UNEXPECTED_PROVIDER_ERROR_MESSAGE,
  };
}

function hasRecentSync(apiSyncedAt: string | null, now = Date.now()): boolean {
  if (!apiSyncedAt) return false;
  const syncedAt = Date.parse(apiSyncedAt);
  if (!Number.isFinite(syncedAt)) return false;
  return now - syncedAt < MANUAL_SOCIAL_SCAN_COOLDOWN_MS;
}

export async function scanSocialAccountWithDeps(input: {
  creatorId: string;
  accountId: string;
  repo: ScanRepo;
  provider: Provider;
}): Promise<SocialAccountRecord> {
  const account = await input.repo.getAccountForCreator(input.creatorId, input.accountId);
  if (!account) throw Object.assign(new Error("Social account not found"), { code: "not_found" });

  if (hasRecentSync(account.api_synced_at)) {
    const updated = await input.repo.markAccountScanFailed(account.id, {
      status: "rate_limited",
      errorCode: "rate_limited",
      errorMessage: MANUAL_SOCIAL_SCAN_COOLDOWN_MESSAGE,
    });
    await input.repo.insertSnapshot(account.id, "rapidapi", "rate_limited", {
      errorCode: "rate_limited",
      errorMessage: MANUAL_SOCIAL_SCAN_COOLDOWN_MESSAGE,
    });
    return updated;
  }

  let result: SocialScanResult;
  try {
    result = await input.provider({ platform: account.platform, handle: account.handle });
  } catch (err) {
    if (isProviderFailure(err) && err.code === "provider_not_configured") throw err;
    const failure = errorStatus(err);
    const updated = await input.repo.markAccountScanFailed(account.id, {
      status: failure.status,
      errorCode: failure.code,
      errorMessage: failure.message,
    });
    await input.repo.insertSnapshot(account.id, "rapidapi", failure.status, {
      errorCode: failure.code,
      errorMessage: failure.message,
    });
    return updated;
  }

  const updated = await input.repo.updateAccountFromScan(account.id, result);
  await input.repo.insertSnapshot(account.id, "rapidapi", "synced", result);
  return updated;
}

export async function scanSocialAccount(input: {
  creatorId: string;
  accountId: string;
}): Promise<SocialAccountRecord> {
  const svc = serviceClient();
  const updated = await scanSocialAccountWithDeps({
    creatorId: input.creatorId,
    accountId: input.accountId,
    repo: {
      getAccountForCreator: (creatorId, accountId) => repo.getAccountForCreator(svc, { creatorId, accountId }),
      updateAccountFromScan: (accountId, result) => repo.updateAccountFromScan(svc, accountId, result),
      insertSnapshot: (accountId, provider, status, result) =>
        repo.insertSnapshot(svc, accountId, provider, status, result),
      markAccountScanFailed: (accountId, failure) => repo.markAccountScanFailed(svc, accountId, failure),
    },
    provider: ({ platform, handle }) => scanRapidApiProfile({ platform, handle }),
  });

  await persistScores(input.creatorId);
  return updated;
}

export async function selectSocialAvatar(input: { creatorId: string; accountId: string }): Promise<string> {
  const svc = serviceClient();
  const account = await repo.getAccountForCreator(svc, input);
  if (!account) throw Object.assign(new Error("Social account not found"), { code: "not_found" });
  if (!account.external_avatar_url?.startsWith("https://")) {
    throw Object.assign(new Error("No scanned avatar available"), { code: "no_avatar" });
  }

  const { error } = await svc
    .from("creators")
    .update({ avatar_url: account.external_avatar_url })
    .eq("id", input.creatorId);

  if (error) throw error;
  return account.external_avatar_url;
}

export async function refreshDueSocialAccounts(limit = 25): Promise<{ scanned: number; failed: number }> {
  const svc = serviceClient();
  const accounts = await repo.listDueSocialAccounts(svc, limit);
  let scanned = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      const updated = await scanSocialAccount({ creatorId: account.creator_id, accountId: account.id });
      if (updated.sync_status === "synced") scanned += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  return { scanned, failed };
}
