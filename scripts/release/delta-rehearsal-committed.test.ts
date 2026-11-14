// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { canonicalDeltaJson, parseDeltaEvidence } from "./delta-evidence";
import { buildPhase3RehearsalPlan, type Phase3RehearsalPlan } from "./delta-rehearsal-plan";
import { DELTA_REQUIRED_GATES } from "./delta-release-contracts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SUBJECT = "d9d3803c348033a3fc43ed814d8dae3c98d9606a";
it("reproduces the actual offline engineering report without assigning the skipped owner decisions", async () => {
  const worksheetBytes = await readFile(resolve(ROOT, `docs/verification/phase3-rehearsal-preflight/worksheet-${SUBJECT}.json`));
  const reportBytes = await readFile(resolve(ROOT, `docs/verification/phase3-rehearsal-preflight/plan-${SUBJECT}-engineering-check.json`));
  const committed = JSON.parse(reportBytes.toString("utf8")) as Phase3RehearsalPlan;
  const actual = buildPhase3RehearsalPlan(JSON.parse(worksheetBytes.toString("utf8")), { sourceCommit: SUBJECT,
    preparedAt: committed.preparedAt, manifestSourceCount: 67, worksheetSha256: createHash("sha256").update(worksheetBytes).digest("hex") });
  expect(actual).toEqual(committed); expect(canonicalDeltaJson(actual) + "\n").toBe(reportBytes.toString("utf8"));
  expect(actual).toMatchObject({ decisionStatus: "incomplete", status: "HOLD", accepted: false, ownerAccepted: false,
    captureAuthorized: false, executionAuthorized: false, validReleaseEvidence: false, productionEquivalent: false });
  expect(actual.declaredInputs.githubReviewerId).toBe("201698560");
  expect(Object.values(actual.declaredInputs.roles).every(value => value === null)).toBe(true);
  expect(Object.values(actual.declaredInputs.budgets).every(value => value === null)).toBe(true);
  expect(Object.values(actual.declaredInputs.freeze).every(value => value === null)).toBe(true);
  expect(Object.values(actual.declaredInputs.planReferences).every(value => value === null)).toBe(true);
  expect(actual.declaredInputs.recoveryAcceptedBy).toBeNull();
  expect(actual.declaredInputs.recoveryCoverage.filter(row => ["storage-object-bytes", "role-passwords", "platform-encryption-keys", "wal-pitr", "extension-binaries"].includes(row.category))
    .every(row => row.decision === null && row.acceptanceReference === null)).toBe(true);
  expect(actual.gates).toEqual(DELTA_REQUIRED_GATES.map(gate => ({ gate, status: "HOLD", accepted: false })));
  expect(parseDeltaEvidence(actual).evidence).toBeUndefined();
});
