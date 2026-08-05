const MAX_DIAGNOSTIC_TEXT = 160;

const REDACTIONS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED_BEARER]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]"],
  [/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s\"'<>]+/gi, "[REDACTED_CONNECTION]"],
  [/https?:\/\/[^\s\"'<>]+/gi, "[REDACTED_URL]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[REDACTED_ID]"],
];

export type ResponseDiagnostic = {
  status: number;
  code?: string;
  error?: string;
  message?: string;
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
  for (const key of ["code", "error", "message"] as const) {
    const value = sanitizeDiagnosticText(record[key]);
    if (value !== undefined) diagnostic[key] = value;
  }
  throw new Error(label + " failed: " + JSON.stringify(diagnostic));
}
