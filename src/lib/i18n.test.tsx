import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("creator acquisition and auth recovery dictionary", () => {
  it("defines the Task 2 copy contract in both locales", () => {
    const keys = [
      "creators.final.cta",
      "creators.faq.1.q",
      "creators.faq.1.a",
      "app.login.emailLabel",
      "app.login.emailHelp",
      "app.login.phoneLabel",
      "app.login.phoneHelp",
      "app.login.codeLabel",
      "app.login.codeHelp",
      "app.login.sendingStatus",
      "app.auth.action.retry",
      "app.auth.action.requestNewLink",
      "app.auth.action.backToLogin",
      "app.auth.feedback.expired.title",
      "app.auth.feedback.expired.body",
      "app.auth.feedback.alreadyUsed.title",
      "app.auth.feedback.alreadyUsed.body",
      "app.auth.feedback.malformed.title",
      "app.auth.feedback.malformed.body",
      "app.auth.feedback.rateLimited.title",
      "app.auth.feedback.rateLimited.body",
      "app.auth.feedback.deliveryFailed.title",
      "app.auth.feedback.deliveryFailed.body",
      "app.auth.feedback.unknown.title",
      "app.auth.feedback.unknown.body",
    ];

    for (const locale of ["en", "zh"] as const) {
      for (const key of keys) {
        expect(dict[locale][key], `${locale}.${key}`).toBeDefined();
      }
    }
  });
});

describe("creator activation dictionary", () => {
  it("defines milestone, benefit, action, and emitted next-action copy in both locales", () => {
    const keys = [
      "app.activation.milestone.accountCreated.label",
      "app.activation.milestone.accountCreated.benefit",
      "app.activation.milestone.onboardingCompleted.label",
      "app.activation.milestone.onboardingCompleted.benefit",
      "app.activation.milestone.interestsSelected.label",
      "app.activation.milestone.interestsSelected.benefit",
      "app.activation.milestone.socialAdded.label",
      "app.activation.milestone.socialAdded.benefit",
      "app.activation.milestone.socialVerified.label",
      "app.activation.milestone.socialVerified.benefit",
      "app.activation.milestone.paymentReady.label",
      "app.activation.milestone.paymentReady.benefit",
      "app.activation.milestone.firstMissionViewed.label",
      "app.activation.milestone.firstMissionViewed.benefit",
      "app.activation.milestone.firstMissionJoined.label",
      "app.activation.milestone.firstMissionJoined.benefit",
      "app.activation.action.createAccount",
      "app.activation.action.resumeOnboarding",
      "app.activation.action.setPreferences",
      "app.activation.action.addSocial",
      "app.activation.action.verifySocial",
      "app.activation.action.viewMissions",
      "app.activation.next.submitProof.title",
      "app.activation.next.submitProof.body",
      "app.activation.next.submitProof.cta",
      "app.activation.next.resumeOnboarding.title",
      "app.activation.next.resumeOnboarding.body",
      "app.activation.next.resumeOnboarding.cta",
      "app.activation.next.improveProfile.title",
      "app.activation.next.improveProfile.body",
      "app.activation.next.improveProfile.cta",
      "app.activation.next.viewRecommendedMission.title",
      "app.activation.next.viewRecommendedMission.body",
      "app.activation.next.viewRecommendedMission.cta",
      "app.activation.next.setPreferences.title",
      "app.activation.next.setPreferences.body",
      "app.activation.next.setPreferences.cta",
      "app.activation.next.reviewGrowth.title",
      "app.activation.next.reviewGrowth.body",
      "app.activation.next.reviewGrowth.cta",
    ];
    for (const locale of ["en", "zh"] as const) {
      for (const key of keys) expect(dict[locale][key], `${locale}.${key}`).toBeDefined();
    }
  });
});

describe("creator activation card dictionary", () => {
  it("defines headings, readiness semantics, states, retries, and wallet copy", () => {
    const keys = [
      "app.activation.next.heading",
      "app.activation.next.deadline",
      "app.activation.next.rewardContext",
      "app.activation.next.deadlineLabel",
      "app.activation.next.rewardContextLabel",
      "app.activation.progress.heading",
      "app.activation.progress.explanation",
      "app.activation.progress.summary",
      "app.activation.state.complete",
      "app.activation.state.recommended",
      "app.activation.state.blocked",
      "app.activation.state.notApplicable",
      "app.activation.earnings.heading",
      "app.activation.earnings.available",
      "app.activation.earnings.pending",
      "app.activation.earnings.loading",
      "app.activation.earnings.error",
      "app.activation.earnings.retry",
      "app.activation.earnings.walletLink",
      "app.activation.missions.heading",
      "app.activation.missions.loading",
      "app.activation.missions.error",
      "app.activation.missions.retry",
      "app.activation.missions.status.joined",
      "app.activation.missions.status.submitted",
      "app.activation.missions.status.underReview",
    ];

    for (const locale of ["en", "zh"] as const) {
      for (const key of keys) {
        expect(dict[locale][key], `${locale}.${key}`).toBeDefined();
      }
    }
  });
});

function Probe() {
  const { t } = useI18n();
  return <span>{t("app.notFound.title")}</span>;
}

function LocaleReadyProbe({ observed }: { observed: string[] }) {
  const { lang, localeReady } = useI18n();
  observed.push(`${lang}:${localeReady}`);
  return <span>{`${lang}:${localeReady}`}</span>;
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

  it("marks locale ready only after resolving the stored locale", async () => {
    const observed: string[] = [];
    window.localStorage.setItem("lang", "en");

    render(
      <I18nProvider>
        <LocaleReadyProbe observed={observed} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText("en:true")).toBeInTheDocument());
    expect(observed).toContain("zh:false");
    expect(observed).toContain("en:true");
  });
});

describe("forgiving creator onboarding dictionary", () => {
  it("defines shell, recovery, empty, and completion copy in both locales", () => {
    const keys = [
      "app.onboarding.loading",
      "app.onboarding.stepLabel",
      "app.onboarding.saveIdle",
      "app.onboarding.saving",
      "app.onboarding.saved",
      "app.onboarding.discardTitle",
      "app.onboarding.discardBody",
      "app.onboarding.discardConfirm",
      "app.onboarding.primerRewards",
      "app.onboarding.primerSocial",
      "app.onboarding.primerTime",
      "app.onboarding.recommendationsLoading",
      "app.onboarding.recommendationsError",
      "app.onboarding.recommendationsEmptyTitle",
      "app.onboarding.recommendationsEmptyBody",
      "app.onboarding.preferencesAction",
      "app.onboarding.guideAction",
      "app.onboarding.readinessAction",
      "app.onboarding.completionReadiness",
      "app.onboarding.completionRemaining",
      "app.onboarding.completionReady",
      "app.onboarding.completionNext",
    ];

    for (const locale of ["en", "zh"] as const) {
      for (const key of keys) {
        expect(dict[locale][key], `${locale}.${key}`).toBeDefined();
      }
    }
  });
});
