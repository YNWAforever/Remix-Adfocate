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
      name: "wrong password sign-ins",
      input: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" },
      expected: {
        category: "invalid_credentials",
        titleKey: "app.auth.feedback.invalidCredentials.title",
        bodyKey: "app.auth.feedback.invalidCredentials.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "legacy invalid_grant password sign-ins",
      input: { code: "invalid_grant", status: 400, message: "Invalid login credentials" },
      expected: {
        category: "invalid_credentials",
        titleKey: "app.auth.feedback.invalidCredentials.title",
        bodyKey: "app.auth.feedback.invalidCredentials.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "code-less invalid credential messages",
      input: { message: "Invalid login credentials" },
      expected: {
        category: "invalid_credentials",
        titleKey: "app.auth.feedback.invalidCredentials.title",
        bodyKey: "app.auth.feedback.invalidCredentials.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "short passwords",
      input: { code: "weak_password", status: 422, message: "Password should be at least 6 characters." },
      expected: {
        category: "weak_password",
        titleKey: "app.auth.feedback.weakPassword.title",
        bodyKey: "app.auth.feedback.weakPassword.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "code-less short password messages",
      input: { message: "Password is too short" },
      expected: {
        category: "weak_password",
        titleKey: "app.auth.feedback.weakPassword.title",
        bodyKey: "app.auth.feedback.weakPassword.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "weak passwords reported with failure wording",
      input: { status: 422, message: "Sign up failed: weak password" },
      expected: {
        category: "weak_password",
        titleKey: "app.auth.feedback.weakPassword.title",
        bodyKey: "app.auth.feedback.weakPassword.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "sign-ups for an existing account",
      input: { code: "user_already_exists", status: 422, message: "User already registered" },
      expected: {
        category: "email_taken",
        titleKey: "app.auth.feedback.emailTaken.title",
        bodyKey: "app.auth.feedback.emailTaken.body",
        actionKey: "app.auth.action.retry",
        action: "retry",
      },
    },
    {
      name: "email_exists sign-ups",
      input: {
        code: "email_exists",
        status: 422,
        message: "A user with this email address has already been registered",
      },
      expected: {
        category: "email_taken",
        titleKey: "app.auth.feedback.emailTaken.title",
        bodyKey: "app.auth.feedback.emailTaken.body",
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

  it("keeps throttling ahead of password classification", () => {
    expect(classifyAuthError({
      code: "over_request_rate_limit",
      status: 429,
      message: "Request rate limit reached",
    }).category).toBe("rate_limited");

    expect(classifyAuthError({
      code: "invalid_credentials",
      status: 429,
      message: "Invalid login credentials",
    }).category).toBe("rate_limited");
  });

  it("keeps link classification ahead of password classification", () => {
    expect(classifyAuthError({
      code: "otp_expired",
      status: 403,
      message: "Email link is invalid or has expired",
    }).category).toBe("expired");

    expect(classifyAuthError({
      code: "email_send_failed",
      status: 500,
      message: "Error sending recovery email",
    }).category).toBe("delivery_failed");
  });
});
