import { describe, expect, it } from "vitest";
import { checkPilotEvidence, PILOT_EVIDENCE_GATES } from "./pilotEvidenceChecklist.js";

const now = Date.parse("2026-11-05T00:00:00Z");
const binding = "a".repeat(64);
const evidence = () => PILOT_EVIDENCE_GATES.map(gate => ({ gate, kind: "reviewed", packetSha256: binding, evidenceSha256: "b".repeat(64), reviewedAt: "2026-11-04T23:00:00Z", expiresAt: "2026-11-05T01:00:00Z" }));
describe("offline pilot evidence checklist", () => {
  it("lists every missing gate and never grants execution", () => {
    const result = checkPilotEvidence([], binding, now);
    expect(result.missing).toEqual([...PILOT_EVIDENCE_GATES]);
    expect(result).toMatchObject({ status: "incomplete", executionAllowed: false });
  });
  it("complete metadata remains a review checklist, not verified authority", () => {
    expect(checkPilotEvidence(evidence(), binding, now)).toEqual({ status: "metadata_complete", missing: [], executionAllowed: false });
  });
  it.each(["synthetic", "mock", "verified", null])("rejects non-reviewed evidence kind %s", kind => {
    const rows = evidence(); rows[0] = { ...rows[0], kind: kind as string };
    expect(checkPilotEvidence(rows, binding, now).missing).toContain(PILOT_EVIDENCE_GATES[0]);
  });
  it.each([
    { packetSha256: "c".repeat(64) }, { evidenceSha256: "" },
    { reviewedAt: "2026-11-05T02:00:00Z" }, { expiresAt: "2026-11-05T00:00:00Z" },
    { reviewedAt: "invalid" }, { expiresAt: null },
  ])("rejects stale or unbound evidence %j", patch => {
    const rows = evidence(); Object.assign(rows[0], patch);
    expect(checkPilotEvidence(rows, binding, now).status).toBe("incomplete");
  });
  it("rejects ambiguous duplicates rather than picking a good row", () => {
    const rows = evidence(); rows.push({ ...rows[0] });
    expect(checkPilotEvidence(rows, binding, now).missing).toEqual([PILOT_EVIDENCE_GATES[0]]);
  });
  it("fails closed on malformed packet, clock and row collections", () => {
    for (const rows of [null, {}, [null], Array(101).fill({})]) expect(checkPilotEvidence(rows, binding, now).status).toBe("incomplete");
    expect(checkPilotEvidence(evidence(), "", now).missing).toHaveLength(PILOT_EVIDENCE_GATES.length);
    expect(checkPilotEvidence(evidence(), binding, NaN).status).toBe("incomplete");
  });
  it("never projects evidence content, keys or untrusted gate names", () => {
    const rows = [...evidence(), { gate: "secret-marker", token: "private-token" }];
    const output = JSON.stringify(checkPilotEvidence(rows, binding, now));
    expect(output).not.toContain("secret-marker"); expect(output).not.toContain("private-token");
  });
});
