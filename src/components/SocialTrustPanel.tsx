import { useState } from "react";
import {
  useAddSocialAccount,
  useConfirmVerification,
  useIssueVerification,
  useScanSocialAccount,
  useSocialAccounts,
  useUseSocialAvatar,
  type SocialPlatform,
} from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";

const PLATFORMS: Array<{ id: SocialPlatform; label: string }> = [
  { id: "instagram", label: "Instagram" },
  { id: "threads", label: "Threads" },
];

function formatNumber(value?: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value?: number | null) {
  return value == null ? "—" : `${value}%`;
}

function formatHandle(handle: string) {
  return handle.startsWith("@") ? handle : `@${handle}`;
}

export function SocialTrustPanel() {
  const { t } = useI18n();
  const accounts = useSocialAccounts();
  const add = useAddSocialAccount();
  const scan = useScanSocialAccount();
  const avatar = useUseSocialAvatar();
  const issue = useIssueVerification();
  const confirm = useConfirmVerification();
  const [handles, setHandles] = useState<Record<SocialPlatform, string>>({ instagram: "", threads: "" });
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});

  if (accounts.isLoading) return <p className="text-sm text-[var(--color-soft-ink)]">Loading social trust...</p>;
  if (accounts.isError) return <p className="text-sm text-[var(--color-magenta)]">Social trust failed to load</p>;

  return (
    <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
      <h2 className="font-heading font-bold">Social trust</h2>
      <div className="space-y-3">
        {PLATFORMS.map((platform) => {
          const account = accounts.data?.find((item) => item.platform === platform.id);
          return (
            <div key={platform.id} className="space-y-2 rounded-xl border-2 border-[var(--color-ink)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading font-bold">{platform.label}</span>
                {account?.sync_status === "synced" ? (
                  <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold">
                    API-synced
                  </span>
                ) : null}
              </div>

              {account ? (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[var(--color-soft-ink)]">{formatHandle(account.handle)}</span>
                    <span className="font-heading font-bold">{formatNumber(account.follower_count)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span>
                      <span className="text-[var(--color-soft-ink)]">Engagement </span>
                      <span>{formatPercent(account.engagement_rate)}</span>
                    </span>
                    <span>
                      <span className="text-[var(--color-soft-ink)]">Avg likes </span>
                      <span>{formatNumber(account.avg_likes)}</span>
                    </span>
                    <span>
                      <span className="text-[var(--color-soft-ink)]">Avg comments </span>
                      <span>{formatNumber(account.avg_comments)}</span>
                    </span>
                    <span>
                      <span className="text-[var(--color-soft-ink)]">Freshness </span>
                      <span>{account.freshness_score ?? "—"}</span>
                    </span>
                  </div>
                  {account.owner_verified ? (
                    <p className="text-xs font-bold text-[var(--color-acid-ink,var(--color-ink))]">✓ {t("app.social.verified")}</p>
                  ) : codes[account.id] ? (
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--color-soft-ink)]">
                        {t("app.social.verifyInstructions", { platform: platform.label })}
                      </p>
                      <p className="font-mono text-sm font-bold tracking-widest">{codes[account.id]}</p>
                      {errs[account.id] && <p className="text-xs text-[var(--color-magenta)]">{errs[account.id]}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            setErrs((e) => ({ ...e, [account.id]: "" }));
                            try {
                              await confirm.mutateAsync(account.id);
                              setCodes((cs) => { const n = { ...cs }; delete n[account.id]; return n; });
                            } catch (err) {
                              const code = (err as { code?: string }).code;
                              const key =
                                code === "code_not_in_bio" ? "app.social.errCodeNotInBio"
                                : code === "code_expired" ? "app.social.errCodeExpired"
                                : code === "provider_unavailable" ? "app.social.errUnavailable"
                                : code === "handle_taken" ? "app.social.errHandleTaken"
                                : "common.saveError";
                              setErrs((e) => ({ ...e, [account.id]: t(key) }));
                            }
                          }}
                          disabled={confirm.isPending}
                          className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold disabled:opacity-50"
                        >
                          {t("app.social.verifyNow")}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const { code } = await issue.mutateAsync(account.id);
                            setCodes((cs) => ({ ...cs, [account.id]: code }));
                          }}
                          disabled={issue.isPending}
                          className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-bold disabled:opacity-50"
                        >
                          {t("app.social.verifyReissue")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        const { code } = await issue.mutateAsync(account.id);
                        setCodes((cs) => ({ ...cs, [account.id]: code }));
                      }}
                      disabled={issue.isPending}
                      className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold disabled:opacity-50"
                    >
                      {t("app.social.verifyCta")}
                    </button>
                  )}
                  {account.api_synced_at ? (
                    <p className="text-xs text-[var(--color-soft-ink)]">
                      Last synced {new Date(account.api_synced_at).toLocaleDateString()}
                    </p>
                  ) : null}
                  {account.external_avatar_url ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={account.external_avatar_url}
                        alt=""
                        className="h-10 w-10 rounded-full border-2 border-[var(--color-ink)] object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => avatar.mutateAsync(account.id)}
                        className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-bold"
                      >
                        Use as Adfocate avatar
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => scan.mutateAsync(account.id)}
                    className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold"
                  >
                    Refresh {platform.label}
                  </button>
                </>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={handles[platform.id]}
                    onChange={(event) => setHandles((current) => ({ ...current, [platform.id]: event.target.value }))}
                    aria-label={`${platform.label} handle`}
                    className="min-w-0 flex-1 rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => add.mutateAsync({ platform: platform.id, handle: handles[platform.id] })}
                    className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold"
                  >
                    Save {platform.label}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
