import { ArrowRight, Clock3, Sparkles } from "lucide-react";
import { useId } from "react";
import type { NextBestAction } from "../lib/creatorActivation";
import { formatCreatorDate } from "../lib/creatorFormatting";
import { dict, type Locale } from "../lib/i18n.dict";

function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string>,
): string {
  const value = dict[locale][key] ?? dict.en[key] ?? key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
}

export function NextBestActionCard({
  action,
  locale,
  onAction,
}: {
  action: NextBestAction;
  locale: Locale;
  onAction?: (action: NextBestAction) => void;
}) {
  const headingId = useId();
  const formattedDeadline = formatCreatorDate(action.deadline, locale);

  return (
    <section
      aria-labelledby={headingId}
      className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-5"
    >
      <p className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {translate(locale, "app.activation.next.heading")}
      </p>
      <h2 id={headingId} className="mt-2 font-heading text-xl font-bold">
        {translate(locale, action.titleKey)}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-soft-ink)]">
        {translate(locale, action.bodyKey)}
      </p>
      {formattedDeadline || action.rewardContext ? (
        <dl className="mt-3 space-y-1 text-sm">
          {formattedDeadline ? (
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              <dt className="font-semibold">
                {translate(locale, "app.activation.next.deadlineLabel")}
              </dt>
              <dd>{formattedDeadline}</dd>
            </div>
          ) : null}
          {action.rewardContext ? (
            <div className="flex items-baseline gap-2">
              <dt className="font-semibold">
                {translate(
                  locale,
                  "app.activation.next.rewardContextLabel",
                )}
              </dt>
              <dd>{action.rewardContext}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <a
        href={action.to}
        onClick={() => onAction?.(action)}
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2 font-bold text-white no-underline transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {translate(locale, action.ctaKey)}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </section>
  );
}
