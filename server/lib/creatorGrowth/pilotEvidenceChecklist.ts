/** Offline review metadata only. Never use this checklist as runtime authorization. */
export const PILOT_EVIDENCE_GATES = Object.freeze([
  "source_artifact", "app_identity", "revoke_contract", "notice_identity",
  "account_consent", "granted_scopes", "native_adapter", "image_preparation",
  "media_hosting", "database_restore", "native_auth_rls", "test_content",
  "window_budget_cleanup", "explicit_action_approval",
] as const);
type Gate = typeof PILOT_EVIDENCE_GATES[number];
type Checklist = { status: "incomplete" | "metadata_complete"; missing: Gate[]; executionAllowed: false };
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return NaN;
  return new Date(time).toISOString() === value.replace(/(?<!\.\d{3})Z$/, ".000Z") ? time : NaN;
}

/** Caller supplies already reviewed metadata; hashes do not verify files, grants or approval.
 * A complete result means only that the packet has evidence references for manual review.
 * No I/O, secrets, feature flags, database actions or provider capabilities are exposed.
 */
export function checkPilotEvidence(rows: unknown, packetSha256: unknown, now: number): Checklist {
  const missing = [...PILOT_EVIDENCE_GATES];
  const blocked = (): Checklist => ({ status: "incomplete", missing, executionAllowed: false });
  if (!digest(packetSha256) || !Number.isFinite(now) || !Array.isArray(rows) || rows.length > 100) return blocked();
  const records = rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
  const absent = missing.filter(gate => {
    const matches = records.filter(row => row.gate === gate);
    if (matches.length !== 1) return true;
    const row = matches[0];
    const reviewed = timestamp(row.reviewedAt), expiry = timestamp(row.expiresAt);
    return row.kind !== "reviewed" || row.packetSha256 !== packetSha256 || !digest(row.evidenceSha256)
      || !Number.isFinite(reviewed) || !Number.isFinite(expiry) || reviewed > now || expiry <= now || expiry <= reviewed;
  });
  return { status: absent.length ? "incomplete" : "metadata_complete", missing: absent, executionAllowed: false };
}
