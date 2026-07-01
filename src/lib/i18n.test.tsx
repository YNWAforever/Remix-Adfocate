import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { dict } from "./i18n.dict";
import { I18nProvider, useI18n } from "./i18n";

describe("i18n dictionary", () => {
  it("en and zh have identical key sets", () => {
    const missingInZh = Object.keys(dict.en).filter((k) => !(k in dict.zh));
    const missingInEn = Object.keys(dict.zh).filter((k) => !(k in dict.en));
    expect(missingInZh, `missing in zh: ${missingInZh.join(", ")}`).toEqual([]);
    expect(missingInEn, `missing in en: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("has no empty values", () => {
    (["en", "zh"] as const).forEach((loc) =>
      Object.entries(dict[loc]).forEach(([k, v]) =>
        expect(v.trim().length, `${loc}.${k} is empty`).toBeGreaterThan(0),
      ),
    );
  });
});

function Probe() {
  const { t } = useI18n();
  return <span>{t("app.notFound.title")}</span>;
}

describe("brand resources i18n keys", () => {
  it("defines app.brand.resources.* + app.brand.navResources in both locales", () => {
    const keys = [
      "app.brand.resources.title",
      "app.brand.resources.empty",
      "app.brand.resources.loading",
      "app.brand.resources.error",
      "app.brand.navResources",
    ];
    for (const k of keys) {
      expect(dict.en[k], `en.${k}`).toBeDefined();
      expect(dict.zh[k], `zh.${k}`).toBeDefined();
    }
  });
});

describe("i18n provider", () => {
  beforeEach(() => {
    // Pre-seed storage so detectInitial() returns "zh" (jsdom navigator.language is "en-US").
    window.localStorage.setItem("lang", "zh");
  });

  it("renders translated copy under the provider (zh default)", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    // useEffect resolves locale post-mount; zh is the SSR/first default.
    expect(screen.getByText(dict.zh["app.notFound.title"])).toBeInTheDocument();
  });
});
