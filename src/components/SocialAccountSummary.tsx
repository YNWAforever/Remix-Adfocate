import { useI18n } from "@/lib/i18n";
import { platformDisplayLabelKey } from "@/lib/labels";
import { socialPlatformName, type SocialAccountPresentation } from "@/lib/socialAccountPresentation";

export function SocialAccountSummary({ account }: { account: SocialAccountPresentation }) {
  const { t, lang } = useI18n();
  const timestamp = account.lastSyncedAt ? Date.parse(account.lastSyncedAt) : NaN;
  return <div className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-heading font-bold">{t(platformDisplayLabelKey(socialPlatformName(account.platform)))}</span>
      <span className="break-all">{account.handle.startsWith("@") ? account.handle : `@${account.handle}`}</span>
    </div>
    <div className="flex flex-wrap gap-2 text-xs">
      <span>{t(`app.social.source.${account.source}`)}</span>
      <span>{t(`app.social.sync.${account.syncStatus}`)}</span>
      <span>{t(account.ownershipVerified ? "app.social.verified" : "app.social.unverified")}</span>
    </div>
    {account.legacyHandles.length ? <p className="break-words font-semibold">{t("app.social.conflictHelp", { handles: account.legacyHandles.join(", ") })}</p> : null}
    {Number.isFinite(timestamp) ? <p className="text-xs text-[var(--color-soft-ink)]">{t("app.social.lastSynced")} <time dateTime={account.lastSyncedAt!}>{new Intl.DateTimeFormat(lang === "en" ? "en-HK" : "zh-HK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Hong_Kong" }).format(timestamp)}</time></p> : null}
  </div>;
}
