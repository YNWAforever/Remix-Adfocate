import type { ReactNode } from "react";

/**
 * Render a translated template that contains a single `{value}` token, with the
 * value wrapped in bold. Keeps the full sentence in ONE dict entry (no fragile
 * prefix/suffix split) and works wherever the token sits in the sentence.
 * Pass the template via t("key") WITHOUT params so `{value}` survives to here.
 */
export function BoldValue({
  template,
  value,
  className = "font-bold text-[var(--color-ink)]",
}: {
  template: string;
  value: ReactNode;
  className?: string;
}) {
  const [before = "", after = ""] = template.split("{value}");
  return (
    <>
      {before}
      <span className={className}>{value}</span>
      {after}
    </>
  );
}
