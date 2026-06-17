import type { SocialTrust } from "@/lib/queries/kocmax";

function formatNumber(value: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number | null) {
  return value == null ? "—" : `${value}%`;
}

export function PassportTrustSummary({ socialTrust }: { socialTrust?: SocialTrust }) {
  if (!socialTrust?.accounts.length) {
    return (
      <section className="space-y-2">
        <h2 className="font-heading font-bold">Social trust</h2>
        <p className="text-sm text-[var(--color-soft-ink)]">Connect Instagram or Threads to sync public creator metrics.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="font-heading font-bold">Social trust</h2>
      <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]">
        {socialTrust.accounts.map((account) => (
          <div key={account.id} className="space-y-2 border-b-2 border-[var(--color-ink)] pb-3 last:border-b-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-heading font-bold capitalize">{account.platform}</span>
              <span className="text-sm text-[var(--color-soft-ink)]">@{account.handle}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span>{formatNumber(account.followerCount)} followers</span>
              <span>{formatPercent(account.engagementRate)} engagement</span>
              <span>{formatNumber(account.avgLikes)} avg likes</span>
              <span>{formatNumber(account.avgComments)} avg comments</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {account.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
