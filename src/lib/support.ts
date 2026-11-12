export type SupportEnv = {
  VITE_SUPPORT_WHATSAPP?: string;
  VITE_SUPPORT_EMAIL?: string;
};

export type SupportContext = {
  reason: "rejected_closed" | "revision_limit" | "deadline";
  submissionId?: string;
};

const WHATSAPP = /^\+?[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only well-formed destinations are exposed; anything else hides the handoff. */
export function resolveSupport(env: SupportEnv) {
  const whatsapp = (env.VITE_SUPPORT_WHATSAPP ?? "").replace(/[\s()-]/g, "");
  const email = (env.VITE_SUPPORT_EMAIL ?? "").trim();
  return {
    whatsapp: WHATSAPP.test(whatsapp) ? whatsapp.replace(/^\+/, "") : "",
    email: EMAIL.test(email) ? email : "",
  };
}

/**
 * The prefill contains only a stable reason code and an opaque submission id —
 * never mission titles, review notes, evidence URLs, or account data.
 */
function payload({ reason, submissionId }: SupportContext) {
  return ["ADFOCATE", reason, submissionId].filter(Boolean).join(":");
}

export function supportHref(
  context: SupportContext,
  env: SupportEnv = import.meta.env as SupportEnv,
): string | null {
  const { whatsapp, email } = resolveSupport(env);
  const text = encodeURIComponent(payload(context));
  if (whatsapp) return `https://wa.me/${whatsapp}?text=${text}`;
  if (email) {
    return `mailto:${email}?subject=${encodeURIComponent("ADFOCATE support")}&body=${text}`;
  }
  return null;
}
