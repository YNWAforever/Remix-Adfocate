import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type Audience = "creator" | "brand";

/**
 * Creator / Brand switch for the homepage. Page-local state only — it toggles
 * which set of homepage sections renders; the global MarketingHeader still
 * links out to the standalone /creators and /brands routes.
 */
export function AudienceToggle({
  audience,
  onChange,
  className,
}: {
  audience: Audience;
  onChange: (next: Audience) => void;
  className?: string;
}) {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  const options: { key: Audience; label: string }[] = [
    { key: "creator", label: tx("I'm a Creator", "我是創作者") },
    { key: "brand", label: tx("I'm a Brand", "我是品牌") },
  ];

  return (
    <div
      role="tablist"
      aria-label={tx("Choose your view", "選擇你的視角")}
      className={cn(
        "inline-flex gap-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-1",
        className,
      )}
    >
      {options.map((o) => {
        const active = audience === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-bold transition-colors whitespace-nowrap",
              active
                ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                : "bg-transparent text-[var(--color-soft-ink)] hover:text-[var(--color-ink)]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
