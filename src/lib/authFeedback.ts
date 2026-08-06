import type { ActivationAuthErrorCategory } from "./activationAnalytics";

export type AuthErrorCategory = ActivationAuthErrorCategory;

export type AuthFeedbackState = {
  category: AuthErrorCategory;
  titleKey: string;
  bodyKey: string;
  actionKey: string;
  action: "retry" | "request_new_link" | "back_to_login";
};

const feedbackByCategory: Record<AuthErrorCategory, AuthFeedbackState> = {
  expired: {
    category: "expired",
    titleKey: "app.auth.feedback.expired.title",
    bodyKey: "app.auth.feedback.expired.body",
    actionKey: "app.auth.action.requestNewLink",
    action: "request_new_link",
  },
  already_used: {
    category: "already_used",
    titleKey: "app.auth.feedback.alreadyUsed.title",
    bodyKey: "app.auth.feedback.alreadyUsed.body",
    actionKey: "app.auth.action.requestNewLink",
    action: "request_new_link",
  },
  malformed: {
    category: "malformed",
    titleKey: "app.auth.feedback.malformed.title",
    bodyKey: "app.auth.feedback.malformed.body",
    actionKey: "app.auth.action.backToLogin",
    action: "back_to_login",
  },
  rate_limited: {
    category: "rate_limited",
    titleKey: "app.auth.feedback.rateLimited.title",
    bodyKey: "app.auth.feedback.rateLimited.body",
    actionKey: "app.auth.action.retry",
    action: "retry",
  },
  delivery_failed: {
    category: "delivery_failed",
    titleKey: "app.auth.feedback.deliveryFailed.title",
    bodyKey: "app.auth.feedback.deliveryFailed.body",
    actionKey: "app.auth.action.retry",
    action: "retry",
  },
  invalid_credentials: {
    category: "invalid_credentials",
    titleKey: "app.auth.feedback.invalidCredentials.title",
    bodyKey: "app.auth.feedback.invalidCredentials.body",
    actionKey: "app.auth.action.retry",
    action: "retry",
  },
  weak_password: {
    category: "weak_password",
    titleKey: "app.auth.feedback.weakPassword.title",
    bodyKey: "app.auth.feedback.weakPassword.body",
    actionKey: "app.auth.action.retry",
    action: "retry",
  },
  email_taken: {
    category: "email_taken",
    titleKey: "app.auth.feedback.emailTaken.title",
    bodyKey: "app.auth.feedback.emailTaken.body",
    actionKey: "app.auth.action.retry",
    action: "retry",
  },
  unknown: {
    category: "unknown",
    titleKey: "app.auth.feedback.unknown.title",
    bodyKey: "app.auth.feedback.unknown.body",
    actionKey: "app.auth.action.backToLogin",
    action: "back_to_login",
  },
};

function feedback(category: AuthErrorCategory): AuthFeedbackState {
  return { ...feedbackByCategory[category] };
}

export function classifyAuthError(input: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}): AuthFeedbackState {
  const code = input.code?.toLowerCase() ?? "";
  const message = input.message?.toLowerCase() ?? "";

  if (code === "otp_expired" || /\b(expired|expiry)\b/.test(message)) {
    return feedback("expired");
  }

  if (
    code === "access_denied" ||
    code === "otp_disabled" ||
    /\b(already used|reused|used link)\b/.test(message)
  ) {
    return feedback("already_used");
  }

  if (
    code === "malformed_callback" ||
    code === "missing_code" ||
    /\b(no auth code|missing auth code|malformed callback|incomplete link)\b/.test(message)
  ) {
    return feedback("malformed");
  }

  if (
    input.status === 429 ||
    code.includes("rate_limit") ||
    /\b(rate limit|too many (requests|attempts))\b/.test(message)
  ) {
    return feedback("rate_limited");
  }

  // Password branches sit below rate limiting so a throttled attempt still tells the
  // creator to wait, and above delivery failures so credential wording wins over the
  // generic "failed" copy.
  if (
    code === "invalid_credentials" ||
    code === "invalid_grant" ||
    /\binvalid login credentials\b/.test(message)
  ) {
    return feedback("invalid_credentials");
  }

  if (
    code === "weak_password" ||
    /\b(password should be at least|password is too short|weak password)\b/.test(message)
  ) {
    return feedback("weak_password");
  }

  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    /\b(user already registered|already been registered)\b/.test(message)
  ) {
    return feedback("email_taken");
  }

  if (
    /(?:email|sms|otp|magic_link)_send_failed|delivery_failed/.test(code) ||
    /\b(error|failed|unable) (sending|to send|delivering)\b|\bdelivery failed\b/.test(message)
  ) {
    return feedback("delivery_failed");
  }

  return feedback("unknown");
}
