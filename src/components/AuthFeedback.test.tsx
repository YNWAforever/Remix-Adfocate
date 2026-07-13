import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

import { I18nProvider } from "@/lib/i18n";
import { dict, type Locale } from "@/lib/i18n.dict";
import type { AuthFeedbackState } from "@/lib/authFeedback";
import { AuthFeedback } from "./AuthFeedback";

const expiredFeedback: AuthFeedbackState = {
  category: "expired",
  titleKey: "app.auth.feedback.expired.title",
  bodyKey: "app.auth.feedback.expired.body",
  actionKey: "app.auth.action.requestNewLink",
  action: "request_new_link",
};

function renderFeedback(locale: Locale, feedback: AuthFeedbackState, onRetry?: () => void) {
  window.localStorage.setItem("lang", locale);
  return render(
    <I18nProvider>
      <AuthFeedback feedback={feedback} onRetry={onRetry} loginTo="/login" requestNewLinkTo="/login" />
    </I18nProvider>,
  );
}

describe("AuthFeedback", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it.each(["en", "zh"] as const)("renders %s dictionary copy in an alert", async (locale) => {
    renderFeedback(locale, expiredFeedback);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(dict[locale][expiredFeedback.titleKey]));
    expect(alert).toHaveTextContent(dict[locale][expiredFeedback.bodyKey]);
    expect(alert).toHaveTextContent(dict[locale][expiredFeedback.actionKey]);
  });

  it("runs the retry callback for retry feedback", async () => {
    const onRetry = vi.fn();
    renderFeedback("en", {
      category: "rate_limited",
      titleKey: "app.auth.feedback.rateLimited.title",
      bodyKey: "app.auth.feedback.rateLimited.body",
      actionKey: "app.auth.action.retry",
      action: "retry",
    }, onRetry);

    fireEvent.click(await screen.findByRole("button", { name: dict.en["app.auth.action.retry"] }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("links back to login for non-retry feedback", async () => {
    renderFeedback("en", {
      category: "malformed",
      titleKey: "app.auth.feedback.malformed.title",
      bodyKey: "app.auth.feedback.malformed.body",
      actionKey: "app.auth.action.backToLogin",
      action: "back_to_login",
    });

    expect(await screen.findByRole("link", { name: dict.en["app.auth.action.backToLogin"] }))
      .toHaveAttribute("href", "/login");
  });

  it("uses unique label and description references for simultaneous feedback", async () => {
    render(
      <I18nProvider>
        <AuthFeedback feedback={expiredFeedback} />
        <AuthFeedback feedback={expiredFeedback} />
      </I18nProvider>,
    );

    const alerts = await screen.findAllByRole("alert");
    const labelIds = alerts.map((alert) => alert.getAttribute("aria-labelledby"));
    const descriptionIds = alerts.map((alert) => alert.getAttribute("aria-describedby"));

    expect(new Set(labelIds).size).toBe(2);
    expect(new Set(descriptionIds).size).toBe(2);
    for (const id of [...labelIds, ...descriptionIds]) {
      expect(id).not.toBeNull();
      expect(document.getElementById(id!)).toBeInTheDocument();
    }
  });
});
