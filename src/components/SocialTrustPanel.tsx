import { useState } from "react";
import { useAddSocialAccount, useConfirmVerification, useIssueVerification, useScanSocialAccount, useSocialAccounts, useUseSocialAvatar, type SocialHandle, type SocialPlatform } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { projectSocialAccounts, socialPlatformName, type SocialAccountPresentation } from "@/lib/socialAccountPresentation";
import { platformDisplayLabelKey } from "@/lib/labels";
import { SocialAccountSummary } from "./SocialAccountSummary";

const CONNECTABLE = ["instagram", "threads"] as const;
const button = "rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-xs font-bold disabled:opacity-50";
const number = (value?: number | null) => value == null ? "—" : new Intl.NumberFormat("en-HK").format(value);

export function SocialTrustPanel({ presentations, legacyHandles = [] }: { presentations?: SocialAccountPresentation[]; legacyHandles?: SocialHandle[] } = {}) {
  const { t } = useI18n();
  const accounts = useSocialAccounts();
  const add = useAddSocialAccount();
  const scan = useScanSocialAccount();
  const avatar = useUseSocialAvatar();
  const issue = useIssueVerification();
  const confirm = useConfirmVerification();
  const [handles, setHandles] = useState<Partial<Record<SocialPlatform, string>>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = add.isPending || scan.isPending || avatar.isPending || issue.isPending || confirm.isPending;
  const rows = presentations ?? projectSocialAccounts(accounts.data ?? [], legacyHandles);
  const platforms = [...new Set([...rows.map(row => row.platform), ...CONNECTABLE])];

  async function run(key: string, work: () => Promise<unknown>) {
    setErrors(current => ({ ...current, [key]: "" }));
    try { await work(); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const keyForCode: Record<string, string> = { code_expired: "app.social.errCodeExpired", code_not_in_bio: "app.social.errCodeNotInBio", handle_taken: "app.social.errHandleTaken", provider_unavailable: "app.social.errUnavailable" };
      setErrors(current => ({ ...current, [key]: t(keyForCode[code] ?? "app.social.actionError") }));
    }
  }
  const requestCode = (id: string) => run(id, async () => { const result = await issue.mutateAsync(id); setCodes(current => ({ ...current, [id]: result.code })); });

  if (accounts.isLoading && !rows.length) return <p role="status">{t("app.social.loading")}</p>;
  return <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
    <h2 className="font-heading font-bold">{t("app.profile.socialAccounts")}</h2>
    {accounts.isError ? <div role="alert" className="space-y-2 text-sm"><p>{t("app.social.loadError")}</p><button type="button" className={button} onClick={() => void accounts.refetch()}>{t("common.retry")}</button></div> : null}
    <p className="text-xs text-[var(--color-soft-ink)]">{t("app.social.optionalHelp")}</p>
    {platforms.map(platform => {
      const platformRows = rows.filter(row => row.platform === platform);
      const label = t(platformDisplayLabelKey(socialPlatformName(platform)));
      const connectable = CONNECTABLE.includes(platform as SocialPlatform);
      const inputKey = platform as SocialPlatform;
      const handle = handles[inputKey] ?? platformRows.find(row => row.source === "legacy")?.handle ?? "";
      return <div key={platform} className="space-y-3 rounded-xl border-2 border-[var(--color-ink)] p-3">
        {!platformRows.length ? <h3 className="font-heading font-bold">{label}</h3> : null}
        {platformRows.map(row => {
          const account = row.accountId ? accounts.data?.find(item => item.id === row.accountId) : undefined;
          return <div key={row.accountId ?? row.handle} className="space-y-3 border-b border-[var(--color-ink)] pb-3 last:border-b-0 last:pb-0">
            <SocialAccountSummary account={row} />
            {account ? <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span>{number(account.follower_count)}</span>
                <span>{t("app.social.engagement")} <span>{account.engagement_rate == null ? "—" : `${account.engagement_rate}%`}</span></span>
                <span>{t("app.social.avgLikes")} {number(account.avg_likes)}</span>
                <span>{t("app.social.avgComments")} {number(account.avg_comments)}</span>
              </div>
              {!row.ownershipVerified ? codes[account.id] ? <div className="space-y-2">
                <p className="text-xs">{t("app.social.verifyInstructions", { platform: label })}</p>
                <p className="break-all font-mono font-bold">{codes[account.id]}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={button} disabled={pending} onClick={() => void run(account.id, async () => {
                    await confirm.mutateAsync(account.id); setCodes(current => { const next = { ...current }; delete next[account.id]; return next; });
                  })}>{t("app.social.verifyNow")}</button>
                  <button type="button" className={button} disabled={pending} onClick={() => void requestCode(account.id)}>{t("app.social.verifyReissue")}</button>
                </div>
              </div> : <button type="button" className={button} disabled={pending} onClick={() => void requestCode(account.id)}>{t("app.social.verifyCta")}</button> : null}
              <button type="button" className={button} disabled={pending} onClick={() => void run(account.id, () => scan.mutateAsync(account.id))}>{t("app.social.refresh", { platform: label })}</button>
              {account.external_avatar_url ? <div className="flex flex-wrap items-center gap-3">
                <img src={account.external_avatar_url} alt="" className="h-10 w-10 rounded-full border-2 border-[var(--color-ink)] object-cover" />
                <button type="button" className={button} disabled={pending} onClick={() => void run(account.id, () => avatar.mutateAsync(account.id))}>{t("app.social.useAvatar")}</button>
              </div> : null}
              {errors[account.id] ? <p role="alert" className="text-sm text-[var(--color-magenta)]">{errors[account.id]}</p> : null}
            </> : null}
          </div>;
        })}
        {connectable ? <form className="space-y-2" onSubmit={event => {
          event.preventDefault(); if (!handle.trim() || pending) return;
          void run(platform, () => add.mutateAsync({ platform: inputKey, handle }));
        }}>
          <label className="block text-sm">{t("common.platformHandleLabel", { platform: label })}
            <input value={handle} onChange={event => setHandles(current => ({ ...current, [platform]: event.target.value }))}
              aria-label={t("common.platformHandleLabel", { platform: label })} disabled={pending}
              className="w-full min-w-0 rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-sm" />
          </label>
          <button type="submit" className={button} disabled={pending || !handle.trim()}>{t("app.social.save", { platform: label })}</button>
          {errors[platform] ? <p role="alert" className="text-sm text-[var(--color-magenta)]">{errors[platform]}</p> : null}
        </form> : null}
      </div>;
    })}
  </section>;
}
