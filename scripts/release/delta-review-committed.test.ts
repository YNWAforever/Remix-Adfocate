// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { buildPhase3ReviewPacket, PHASE3_REVIEW_SOURCE_PATHS, type CapturedPublicArtifact, type Phase3ReviewPacket } from "./delta-review-packet";
import { parseDeltaEvidence } from "./delta-evidence";

const SUBJECT = "d11720d400642b495ed146723ddaf17fcc04bb9b";
const PATHS = {
  provider: `docs/verification/phase3-provider-rehearsal/owned-${SUBJECT.slice(0, 12)}-0066b82f-df25-4427-94d3-a33552efa497.json`,
  pairedRecovery: "docs/verification/phase3-paired-recovery/native-20261114-fault-confirmed.json",
  sourceCi: `docs/verification/phase3-release-review/source-ci-${SUBJECT}.json`,
};
const rootFile = (path: string) => new URL(`../../${path}`, import.meta.url);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

it("reproduces the committed main-source engineering packet from its real public observations while retaining all sixteen gates at HOLD", async () => {
  const selection = JSON.parse(await readFile(rootFile(`docs/verification/phase3-release-review/selection-${SUBJECT}.json`), "utf8"));
  const stored: Phase3ReviewPacket = JSON.parse(await readFile(rootFile(`docs/verification/phase3-release-review/review-${SUBJECT}.json`), "utf8"));
  expect(selection.sourceCommit).toBe(SUBJECT);
  async function capture(name: keyof typeof PATHS): Promise<CapturedPublicArtifact> {
    // Read the fixed committed paths only, never a filename supplied by JSON.
    expect(selection[name].path).toBe(PATHS[name]);
    return { ...selection[name], bytes: await readFile(rootFile(PATHS[name])) };
  }
  const [provider, pairedRecovery, sourceCi, currentSources] = await Promise.all([
    capture("provider"), capture("pairedRecovery"), capture("sourceCi"),
    Promise.all(PHASE3_REVIEW_SOURCE_PATHS.map(async path => { const bytes = await readFile(rootFile(path)); return { path, bytes, sha256: hash(bytes) }; })),
  ]);
  const ci = JSON.parse(Buffer.from(sourceCi.bytes).toString("utf8"));
  expect(ci).toMatchObject({ runId: "43565710614", sourceCommit: SUBJECT, branch: "main", event: "push", conclusion: "success" });
  const actual = buildPhase3ReviewPacket({ sourceCommit: SUBJECT, preparedAt: stored.preparedAt, provider, pairedRecovery, sourceCi, currentSources });
  expect(actual).toEqual(stored);
  expect(actual.engineeringStatus).toBe("complete");
  expect(actual.provider).toMatchObject({ complete: true, validatedPassedCases: 27, cleanupConfirmed: true });
  expect(actual.gates).toHaveLength(16); expect(actual.gates.every(gate => gate.status === "HOLD" && gate.accepted === false)).toBe(true);
  expect(actual.ownerInputs).toEqual({ rpoSeconds: null, rtoSeconds: null, freeze: null, roles: null, reportSet: null, outerApproval: null });
  expect(parseDeltaEvidence(actual).evidence).toBeUndefined();
});
