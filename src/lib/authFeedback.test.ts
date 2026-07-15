import { describe, expect, it } from "vitest";

import { classifyAuthError } from "./authFeedback";

describe("classifyAuthError", () => {
  it.each([
    {
      name: "expired OTP links",
      input: { code: "otp_expired", message: "provider detail must stay private" },
      expected: {
        category: "expired",
        titleKey: "app.auth.feedback.expired.title",
        bodyKey: "app.auth.feedback.expired.body",
        actionKey: "app.auth.action.requestNewLink",
        action: "request_new_link",
      },
    },
    {
      name: "access-denied links",
      input: { code: "access_denied", message: "Email link is invalid or has already been used" },
      expected: {
        category: "already_used",
        titleKey: "app.auth.feedback.alreadyUsed.title",
        bodyKey: "app.auth.feedback.alreadyUsed.body",
        actionKey: "app.auth.action.requestNewLink",
        action: "request_new_link",
      },
    },
    {
      name: "reused links",
      input: { message: "Magic link was already used" },
      expected: {
        category: "already_used",
        titleKey: "app.auth.feedback.alreadyUsed.title",
        bodyKey: "app.auth.feedback.alreadyUsed.body",
        actionKey: "app.auth.action.requestNewLink",
        action: "request_new_link",
      },
    },
    {
      name: "malformed callbacks",
      input: { code: "malformed_callback", message: "no auth code in callback URL" },
      expected: {
        category: "malformed",
        titleKey: "app.auth.feedback.malformed.title",
        bodyKey: "app.auth.feedback.malformed.body",
        actionKey: "app.auth.action.backToLogin",
        action: "back_to_login",
      },
    },
    {
      name: "HTTP rate limits",
      input: { status: 429, message: "too many requests for private@example.com" },
      expected: {
        category: "rate_limited",
        titleKey: "app.auth.feedback.rateLimited.title",
        bodyKey: "app.auth.feedback.rateLimited.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "text rate limits",
      input: { message: "Email rate limit exceeded" },
      expected: {
        category: "rate_limited",
        titleKey: "app.auth.feedback.rateLimited.title",
        bodyKey: "app.auth.feedback.rateLimited.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "delivery failures",
      input: { code: "email_send_failed", message: "Error sending magic link" },
      expected: {
        category: "delivery_failed",
        titleKey: "app.auth.feedback.deliveryFailed.title",
        bodyKey: "app.auth.feedback.deliveryFailed.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "unknown provider failures",
      input: { code: "unexpected_provider_error", message: "raw upstream failure" },
      expected: {
        category: "unknown",
        titleKey: "app.auth.feedback.unknown.title",
        bodyKey: "app.auth.feedback.unknown.body",
        actionKey: "app.auth.action.backToLogin",
        action: "back_to_login",
      },
    },
  ])("returns static dictionary feedback for $name", ({ input, expected }) => {
    const result = classifyAuthError(input);

    expect(result).toEqual(expected);
    if (input.message) {
      expect(JSON.stringify(result)).not.toContain(input.message);
    }
  });
});
