// Pure acceptance orchestration. Importing this module cannot create a client or touch a target.
import assert from "node:assert/strict";

export function assertApplicationSupplementPlan(manifest) {
  const p = manifest?.supplement;
  assert.equal(manifest?.kind, "D19_B2_EXECUTION_SPEC");
  assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.specificationReady, true);
  assert(/^[a-f0-9]{64}$/.test(manifest.candidate?.fingerprint));
  assert(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(manifest.execution?.artifactNamespace));
  assert.equal(p?.kind, "APPLICATION_DECISIONS_ONLY");
  assert.equal(p.originManifestSha256, "696e94c29e62a27e820d7d12f5aa74c0d1e7b62f97f3b57db787074512a2626d");
  assert.deepEqual(p.resourceAdds, { projects: 0, volumes: 0, networks: 0, containers: 0 });
  assert.equal(p.authSubjects, 6); assert.equal(p.workspaces, 1); assert.equal(p.missions, 4);
  assert.equal(p.schema?.file, "supabase/migrations/20261025120934_application_decisions.sql");
  assert(/^[a-f0-9]{64}$/.test(p.schema.sha256)); assert.equal(p.schema.baselineMigrationCount, 72);
  for (const key of ["providerEnabled", "legacyIssuance", "cleanupApproved", "runtimeApproved"]) assert.equal(p[key], false, key);
  for (const key of ["incidentOpen", "releaseHold"]) assert.equal(p[key], true, key);
  assert.equal(p.originalApiReruns, 0); assert.equal(p.originalBrowserReruns, 0);
  return p;
}

export function assertApplicationRollback(before, after) {
  assert.deepEqual(after, before, "Application transaction did not fully roll back");
}

export function assertFinancialRowsUnchanged(before, after) {
  assert.deepEqual(after, before, "Application supplement changed financial rows");
}

export function assertDecisionRace(responses, before, after) {
  assert.equal(responses.length, 2);
  const success = responses.filter(r => r.status === 200);
  const conflict = responses.filter(r => r.status === 409);
  assert.equal(success.length, 1, "Exactly one operator must win");
  assert.equal(conflict.length, 1, "Exactly one operator must see the saved winning decision");
  const decision = success[0].body?.decision;
  assert(decision && ["accept", "decline"].includes(decision.action));
  assert(typeof decision.actorId === "string" && decision.actorId.length > 0);
  assert(typeof decision.actorLabel === "string" && decision.actorLabel.length > 0);
  assert(Number.isFinite(Date.parse(decision.decidedAt)), "Saved attribution requires a real time");
  assert.equal(decision.revision, 1);
  assert.equal(conflict[0].body?.code, "APPLICATION_DECIDED");
  assert.deepEqual(conflict[0].body.current_decision, decision);
  assert.deepEqual(after.decision, decision);
  const accepted = decision.action === "accept" ? 1 : 0;
  assert.equal(before.status, "applied");
  assert.equal(after.status, accepted ? "joined" : "declined");
  for (const [field, delta] of Object.entries({ filled: accepted, xp: accepted * 10, workflows: accepted, audit: 1, receipts: 1 })) {
    assert.equal(after[field], before[field] + delta, `Wrong atomic race delta: ${field}`);
  }
  return decision;
}

export async function runApplicationSupplement(driver) {
  let stage = "authorize";
  try {
    // Keep these sequential. Even a client constructor or setup import can have effects.
    await driver.authorize();
    stage = "identity"; await driver.identity();
    stage = "provenance"; await driver.provenance();
    stage = "claim"; await driver.claim();
    stage = "migrate"; await driver.migrate();
    stage = "createClient"; await driver.createClient();
    stage = "fixture"; await driver.fixture();
    stage = "api"; await driver.api();
    stage = "browser"; await driver.browser();
    stage = "finalReadback"; const final = await driver.finalReadback();
    assert.equal(final?.allEqual, true, "Final financial/provenance readback is incomplete");
    await driver.record({ status: "PASS_APPLICATION_SUPPLEMENT", allEqual: true, releaseHold: true,
      wholeR1Verified: false, incidentOpen: true, provider: "disabled" });
    return final;
  } catch (error) {
    // A missing response is UNKNOWN. Never compensate, reseed or auto-retry here.
    await driver.record({ status: "STOPPED_RETAIN_EXACT_RECORDS", failedStage: stage, releaseHold: true,
      incidentOpen: true, provider: "disabled", reason: "Inspect private journal and exact readback before any continuation" });
    throw error;
  }
}
