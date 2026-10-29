import { dict } from "./i18n.dict";

const CREATOR_LOCALES = {
  en: "en-HK",
  zh: "zh-Hant-HK",
} as const;

export function formatCreatorCurrency(
  amount: number,
  locale: "en" | "zh",
  currency: "HKD" = "HKD",
): string {
  return new Intl.NumberFormat(CREATOR_LOCALES[locale], {
    style: "currency",
    currency,
  }).format(amount);
}

export function formatCreatorDate(
  value: string | Date | null | undefined,
  locale: "en" | "zh",
): string | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(CREATOR_LOCALES[locale], {
    dateStyle: "medium",
    timeZone: "Asia/Hong_Kong",
  }).format(date);
}

/**
 * Date and time in Hong Kong time with an explicit zone label ("28 Oct 2026, 11:59 pm HKT").
 * Creator deadlines must never render in UTC: 23:59 HKT would show as 15:59.
 */
export function formatHongKongDateTime(value: string, locale: string, withSeconds = false): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    timeZone: "Asia/Hong_Kong", timeZoneName: "short",
  }).format(parsed);
}

export function formatMissionReward(
  input: { points: number; cash?: number | null },
  locale: "en" | "zh",
): string {
  const points = new Intl.NumberFormat(CREATOR_LOCALES[locale]).format(
    input.points,
  );
  const pointsReward = `${points} ${locale === "en" ? "points" : "積分"}`;

  if (input.cash == null) {
    return pointsReward;
  }

  return `${pointsReward} + ${formatCreatorCurrency(input.cash, locale)}`;
}

export function formatMissionDecisionReward(input: { points: number; cash?: number | null }, locale: "en" | "zh"): string {
  const reward = formatMissionReward(input, locale);
  return input.cash == null ? `${reward} · ${dict[locale]["app.mission.cardCashReward"]}: ${dict[locale]["app.mission.notProvided"]}` : reward;
}
