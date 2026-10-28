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
