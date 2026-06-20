import { useI18n } from "@/lib/i18n";

/** Compact en/zh switch. Shows the language it will switch TO. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "zh" : "en")}
      aria-label="Toggle language"
      className={
        "inline-flex h-9 w-9 items-center justify-center rounded-full border-2 " +
        "border-[var(--color-ink)] bg-white text-sm font-bold text-[var(--color-ink)] " +
        "font-heading transition-transform hover:-translate-y-0.5 " +
        className
      }
    >
      {lang === "en" ? "中" : "EN"}
    </button>
  );
}
