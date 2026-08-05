const MAX_DIAGNOSTIC_TEXT = 160;

const REDACTIONS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED_BEARER]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]"],
  [/\b(api[_-]?key|token|secret|password|authorization)\s*=\s*[^\s"'&;]+/gi, "$1=[REDACTED_CREDENTIAL]"],
  [/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi, "[REDACTED_CONNECTION]"],
  [/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
  [/\b[A-Za-z0-9]{8}-(?:[A-Za-z0-9]{4}-){3}[A-Za-z0-9]{12}\b/g, "[REDACTED_ID]"],
];

export type ResponseDiagnostic = {
  status: number;
  code?: string;
  category?: "client_failure" | "system_failure";
};

export function sanitizeDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  let sanitized = value.replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of REDACTIONS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.slice(0, MAX_DIAGNOSTIC_TEXT);
}

export async function expectSuccessfulResponse(
  response: Response,
  label: string,
): Promise<void> {
  if (response.ok) return;
  let payload: unknown = null;
  try {
    payload = await response.clone().json();
  } catch {
    payload = null;
  }
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const diagnostic: ResponseDiagnostic = { status: response.status };
  const code = sanitizeDiagnosticText(record.code);
  if (code !== undefined && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
    diagnostic.code = code;
  }
  if (typeof record.error === "string" || typeof record.message === "string") {
    diagnostic.category = response.status >= 500 ? "system_failure" : "client_failure";
  }
  throw new Error(label + " failed: " + JSON.stringify(diagnostic));
}
