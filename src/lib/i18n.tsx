import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { dict, type Locale } from "./i18n.dict";

const STORAGE_KEY = "lang";

function detectInitial(): Locale {
  if (typeof window === "undefined") return "zh";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "zh") return saved;
  const nav = window.navigator.language?.toLowerCase() ?? "";
  return nav.startsWith("en") ? "en" : "zh"; // HK audience default
}

const HTML_LANG: Record<Locale, string> = { en: "en", zh: "zh-Hant-HK" };

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

type Ctx = {
  lang: Locale;
  setLang: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nCtx = createContext<Ctx>({
  lang: "zh",
  setLang: () => {},
  // Default mirrors the provider's lookup so out-of-provider renders (e.g. the
  // router-level NotFound) still show real copy at the zh default, not raw keys.
  t: (k, params) => interpolate(dict.zh[k] ?? dict.en[k] ?? k, params),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Locale>("zh");

  // Resolve the real initial locale after mount (avoids SSR/prerender mismatch).
  useEffect(() => {
    setLangState(detectInitial());
  }, []);

  // Keep <html lang> in sync so assistive tech (and browser translate prompts)
  // pronounce/translate the page in the locale actually being rendered.
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang: (l) => {
        setLangState(l);
        if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
      },
      t: (key, params) => interpolate(dict[lang][key] ?? dict.en[key] ?? key, params),
    }),
    [lang],
  );

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
