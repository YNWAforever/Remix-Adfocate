type EvidenceIssue = { index: number; code: "empty" | "invalid_url" | "unsupported_scheme" | "credentials_not_allowed" };
// Match the SQL guard's serialized authority bounds as well as URL semantics.
// URL alone accepts empty ports/userinfo and overlong zero-padded ports; stored
// evidence in those forms needs the correction flow before SQL will approve it.
const STORED_HTTP_URL = /^https?:\/\/(\[[0-9a-f:.]+\]|[^/@:?#\s\\]+)(:[0-9]{1,5})?([/?#][^\s\\]*)?$/i;
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
    if (url.username || url.password) { issues.push({ index, code: "credentials_not_allowed" }); return; }
    if (!STORED_HTTP_URL.test(text) || !url.hostname) { issues.push({ index, code: "invalid_url" }); return; }
    normalized.push(text);
  });
  return issues.length ? { ok: false, issues } : { ok: true, urls: [...new Set(normalized)] };
}
