type EvidenceIssue = { index: number; code: "empty" | "invalid_url" | "unsupported_scheme" | "credentials_not_allowed" };
export function validateSubmissionEvidence(urls: readonly string[]): { ok: true; urls: string[] } | { ok: false; issues: EvidenceIssue[] } {
  if (!Array.isArray(urls) || urls.length === 0) return { ok: false, issues: [{ index: 0, code: "empty" }] };
  const issues: EvidenceIssue[] = [];
  const normalized: string[] = [];
  urls.forEach((value, index) => {
    if (typeof value !== "string" || !value.trim()) { issues.push({ index, code: "empty" }); return; }
    const text = value.trim();
    let url: URL;
    try { url = new URL(text); } catch { issues.push({ index, code: "invalid_url" }); return; }
    if (!["http:", "https:"].includes(url.protocol)) { issues.push({ index, code: "unsupported_scheme" }); return; }
    if (!/^https?:\/\//i.test(text) || !url.hostname || /[\s\\]/.test(text)) { issues.push({ index, code: "invalid_url" }); return; }
    if (url.username || url.password) { issues.push({ index, code: "credentials_not_allowed" }); return; }
    normalized.push(text);
  });
  return issues.length ? { ok: false, issues } : { ok: true, urls: [...new Set(normalized)] };
}
