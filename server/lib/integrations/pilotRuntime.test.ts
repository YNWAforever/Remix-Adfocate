// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createPilotRuntime, observePilotTarget, verifyPilotAdmission, type PilotApprovalRecord, type PilotControlPlaneReadPort } from "./pilotRuntime.js";

const now = new Date("2026-10-31T10:00:00.000Z");
function approval(): PilotApprovalRecord {
  return {
    stage: "D1", ownerApprovalReference: "owner:d1:revision-1",
    issuedAt: "2026-10-31T09:00:00.000Z", expiresAt: "2026-10-31T11:00:00.000Z",
    sourceSha: "a".repeat(40), schemaDigest: "b".repeat(64), artifactDigest: "c".repeat(64),
    deploymentId: "dpl_isolated", hostingProjectId: "prj_isolated", projectRef: "isolatedpilotproject",
    origin: "https://pilot.invalid", googleProjectId: "google-isolated", googleClientId: "isolated.apps.googleusercontent.com",
    metaAppId: "100001", instagramAppId: "200001",
    actors: [{ workspaceId: "w1", creatorId: "c1", subject: "auth-user-1" }], fixtureIds: ["fixture-1"],
    providerEnablement: { google_drive: false, instagram: false },
  };
}
function evidence() {
  return {
    provenance: { source: "control-plane", ownerApprovalReference: "owner:d1:revision-1", observedAt: "2026-10-31T10:00:00.000Z" },
    target: {
      sourceSha: "a".repeat(40), schemaDigest: "b".repeat(64), artifactDigest: "c".repeat(64),
      deploymentId: "dpl_isolated", hostingProjectId: "prj_isolated", hostingProjectName: "kocmax-integrations-pilot",
      projectRef: "isolatedpilotproject", origin: "https://pilot.invalid",
      googleProjectId: "google-isolated", googleClientId: "isolated.apps.googleusercontent.com", metaAppId: "100001", instagramAppId: "200001",
    },
    actors: [{ workspaceId: "w1", creatorId: "c1", subject: "auth-user-1" }], fixtureIds: ["fixture-1"],
  };
}
function ports(raw: unknown = evidence(), approved: unknown = approval()) {
  return { readApproval: vi.fn(async () => approved), readTarget: vi.fn(async () => raw) } satisfies PilotControlPlaneReadPort;
}

describe("D1 observer and admission", () => {
  it("admits fresh independently observed isolated evidence while both providers remain disabled", async () => {
    const record = approval(), port = ports();
    const observed = await observePilotTarget(record, port, () => now);
    expect(port.readApproval).toHaveBeenCalledWith({ ownerApprovalReference: "owner:d1:revision-1" });
    expect(port.readTarget).toHaveBeenCalledWith({
      deploymentId: "dpl_isolated", hostingProjectId: "prj_isolated", projectRef: "isolatedpilotproject",
      googleProjectId: "google-isolated", googleClientId: "isolated.apps.googleusercontent.com", metaAppId: "100001", instagramAppId: "200001",
    });
    expect(verifyPilotAdmission(record, observed, now)).toEqual({
      admitted: true, phase: "D1_ENVIRONMENT_READY", providerStates: { google_drive: "disabled", instagram: "disabled" }, reasons: [],
    });
  });

  it.each(["sourceSha", "schemaDigest", "artifactDigest", "deploymentId", "hostingProjectId", "projectRef", "origin", "googleProjectId", "googleClientId", "metaAppId", "instagramAppId"] as const)("rejects independently observed %s mismatch", async key => {
    const raw = evidence(); raw.target[key] = key === "origin" ? "https://other.invalid" : key === "sourceSha" ? "e".repeat(40)
      : ["schemaDigest", "artifactDigest"].includes(key) ? "e".repeat(64) : "wrong";
    await expect(observePilotTarget(approval(), ports(raw), () => now)).rejects.toThrow("PILOT_TARGET_MISMATCH");
  });

  it.each([
    { ...evidence(), provenance: { ...evidence().provenance, source: "browser" } },
    { ...evidence(), provenance: { ...evidence().provenance, observedAt: "2026-10-31T09:54:59.000Z" } },
    { ...evidence(), provenance: { ...evidence().provenance, observedAt: "2026-10-31T10:00:00.001Z" } },
    { ...evidence(), provenance: { ...evidence().provenance, ownerApprovalReference: "old-d0-receipt" } },
  ])("rejects untrusted, stale, future or old-receipt evidence", async raw => {
    await expect(observePilotTarget(approval(), ports(raw), () => now)).rejects.toThrow();
  });

  it.each([
    [{ workspaceId: "other", creatorId: "c1", subject: "auth-user-1" }],
    [{ workspaceId: "w1", creatorId: "c1", subject: "forged-subject" }],
    [{ workspaceId: "w1", creatorId: "other", subject: "auth-user-1" }],
    [],
  ].map(actors => ({ actors })))("rejects wrong actor or forged authentication subject", async ({ actors }) => {
    await expect(observePilotTarget(approval(), ports({ ...evidence(), actors }), () => now)).rejects.toThrow(actors.length ? "PILOT_IDENTITY_MISMATCH" : "PILOT_OBSERVATION_INVALID");
  });

  it("rejects mismatched fixtures and product hosting names even when IDs look isolated", async () => {
    await expect(observePilotTarget(approval(), ports({ ...evidence(), fixtureIds: ["other"] }), () => now)).rejects.toThrow("PILOT_IDENTITY_MISMATCH");
    for (const hostingProjectName of ["kocmax", "kocmax2", "adfocate-2", "adfocate-site", "ADFocATE-2"]) {
      await expect(observePilotTarget(approval(), ports({ ...evidence(), target: { ...evidence().target, hostingProjectName } }), () => now)).rejects.toThrow("PILOT_PRODUCTION_TARGET");
    }
  });

  it.each([null, [], {}, { ...approval(), actors: [null] }, { ...approval(), fixtureIds: [1] },
    { ...approval(), expiresAt: "garbage" }, { ...approval(), stage: "D2" }, { ...approval(), origin: "http://pilot.invalid" },
    { ...approval(), providerEnablement: { google_drive: true, instagram: false } },
    { ...approval(), providerEnablement: { google_drive: "false", instagram: false } },
    { ...approval(), allowLive: true }, { ...approval(), sampleOnly: false },
    { ...approval(), actors: [...approval().actors, ...approval().actors] },
    { ...approval(), fixtureIds: ["fixture-1", "fixture-1"] },
  ])("fails closed at the untrusted approval boundary before any reads", async record => {
    const port = ports();
    expect(verifyPilotAdmission(record, evidence(), now).admitted).toBe(false);
    await expect(observePilotTarget(record, port, () => now)).rejects.toThrow();
    expect(port.readApproval).not.toHaveBeenCalled(); expect(port.readTarget).not.toHaveBeenCalled();
  });

  it.each(["mhkoayftiuojxlrkollf", "kocmax", "kocmax2", "prj_1kjq3IJGCYVzlGnxRlzUpypJeMg5", "prj_7zxcc1I7x6lAOHIEVCCCAX0nh6hO", "adfocate-2", "adfocate-site", "prj_tBHX5vuMvZ4dEbQJpzhkM3VRJd0g", "prj_xHgVQRoZheStpNLVAUMZvq2p9R11"])("rejects product target %s before even approval lookup", async id => {
    const record = approval();
    if (id === "mhkoayftiuojxlrkollf") record.projectRef = id; else record.hostingProjectId = id;
    const port = ports();
    await expect(observePilotTarget(record, port, () => now)).rejects.toThrow("PILOT_PRODUCTION_TARGET");
    expect(port.readApproval).not.toHaveBeenCalled(); expect(port.readTarget).not.toHaveBeenCalled();
  });
  it.each(["https://adfocate-2.vercel.app", "https://adfocate-site.vercel.app"])("rejects product origin %s before reads and in independent target observations", async origin => {
    const record = { ...approval(), origin }, port = ports();
    await expect(observePilotTarget(record, port, () => now)).rejects.toThrow("PILOT_PRODUCTION_TARGET");
    expect(verifyPilotAdmission(record, null, now).reasons).toEqual(["PILOT_PRODUCTION_TARGET"]);
    expect(port.readApproval).not.toHaveBeenCalled(); expect(port.readTarget).not.toHaveBeenCalled();
    const observed = ports({ ...evidence(), target: { ...evidence().target, origin } });
    await expect(observePilotTarget(approval(), observed, () => now)).rejects.toThrow("PILOT_PRODUCTION_TARGET");
  });

  it("requires independent owner approval and checks expiry again after approval lookup", async () => {
    const record = approval(), wrong = ports(evidence(), { ...approval(), ownerApprovalReference: "old-d0-receipt" });
    await expect(observePilotTarget(record, wrong, () => now)).rejects.toThrow("PILOT_OWNER_APPROVAL_MISMATCH");
    expect(wrong.readTarget).not.toHaveBeenCalled();
    const port = ports(); let current = now;
    port.readApproval.mockImplementation(async () => { current = new Date(record.expiresAt); return approval(); });
    await expect(observePilotTarget(record, port, () => current)).rejects.toThrow("PILOT_APPROVAL_EXPIRED");
    expect(port.readTarget).not.toHaveBeenCalled();
  });

  it("does not trust JSON copies or self-declared provenance as observed evidence", async () => {
    const record = approval(), observed = await observePilotTarget(record, ports(), () => now);
    for (const fake of [evidence(), JSON.parse(JSON.stringify(observed)), { ...record, provenance: evidence().provenance }]) {
      expect(verifyPilotAdmission(record, fake, now)).toMatchObject({ admitted: false, reasons: ["PILOT_OBSERVATION_REQUIRED"] });
    }
  });

  it.each([null, [], {}, { ...evidence(), actors: [null] }, { ...evidence(), fixtureIds: [false] },
    { ...evidence(), target: null }, { ...evidence(), provenance: null }, { ...evidence(), extra: "untrusted" },
  ])("validates untrusted control-plane JSON and suppresses transport errors", async raw => {
    await expect(observePilotTarget(approval(), ports(raw), () => now)).rejects.toThrow("PILOT_OBSERVATION_INVALID");
  });

  it("sanitizes read-port errors instead of leaking credentials or transport details", async () => {
    const port = ports(); port.readTarget.mockRejectedValue(new Error("SECRET-from-transport"));
    await expect(observePilotTarget(approval(), port, () => now)).rejects.toThrow(/^PILOT_OBSERVATION_FAILED$/);
  });

  it("rechecks time after the target read and on every later admission", async () => {
    const record = approval(), observed = await observePilotTarget(record, ports(), () => now);
    expect(verifyPilotAdmission(record, observed, new Date(record.expiresAt)).admitted).toBe(false);
    expect(verifyPilotAdmission(record, observed, new Date("2026-10-31T10:05:00.001Z")).admitted).toBe(false);
    const port = ports(); let current = now;
    port.readTarget.mockImplementation(async () => { current = new Date(record.expiresAt); return evidence(); });
    await expect(observePilotTarget(record, port, () => current)).rejects.toThrow("PILOT_APPROVAL_EXPIRED");
  });

  it("binds an observation to the entire approved record and snapshots mutable inputs", async () => {
    const record = approval(), raw = evidence(), port = ports(raw);
    const observed = await observePilotTarget(record, port, () => now);
    raw.target.sourceSha = "e".repeat(40);
    expect(verifyPilotAdmission(record, observed, now).admitted).toBe(true);
    expect(verifyPilotAdmission({ ...record, ownerApprovalReference: "owner:d1:revision-2" }, observed, now).admitted).toBe(false);
    expect(verifyPilotAdmission({ ...record, expiresAt: "2026-11-01T10:00:00.000Z" }, observed, now).admitted).toBe(false);
  });
});

describe("D1 runtime has no activation capability", () => {
  it("keeps approvedOrigin bound to the parsed approval snapshot", async () => {
    const record = approval(), observed = await observePilotTarget(record, ports(), () => now);
    const runtime = createPilotRuntime(record, observed, () => now);
    record.origin = "https://attacker.invalid";
    expect(runtime.approvedOrigin).toBe("https://pilot.invalid");
    expect(runtime.admission().admitted).toBe(true);
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it("authorizes only approved actor/verified-subject pairs and freezes the server-only actor list", async () => {
    const record = approval(), observed = await observePilotTarget(record, ports(), () => now);
    let current = now;
    const runtime = createPilotRuntime(record, observed, () => current);
    expect(runtime.authorizeActor({ creatorId: "c1", workspaceId: "w1" }, "auth-user-1")).toEqual({ creatorId: "c1", workspaceId: "w1", subject: "auth-user-1" });
    expect(Object.isFrozen(runtime.approvedActors)).toBe(true); expect(Object.isFrozen(runtime.approvedActors[0])).toBe(true);
    for (const [actor, subject] of [[{ creatorId: "c1", workspaceId: "other" }, "auth-user-1"], [{ creatorId: "c1", workspaceId: "w1" }, "forged"], [null, "auth-user-1"]]) {
      expect(() => runtime.authorizeActor(actor, subject)).toThrow("PILOT_ACTOR_DENIED");
    }
    current = new Date(record.expiresAt);
    expect(() => runtime.authorizeActor({ creatorId: "c1", workspaceId: "w1" }, "auth-user-1")).toThrow("PILOT_APPROVAL_EXPIRED");
  });

  it("keeps OAuth/token/content disabled under flags and rechecks admission expiry", async () => {
    const record = approval(), observed = await observePilotTarget(record, ports(), () => now);
    let current = now;
    const runtime = createPilotRuntime(record, observed, () => current);
    record.expiresAt = "2099-01-01T00:00:00.000Z";
    expect(runtime.admission().admitted).toBe(true);
    expect(runtime.getIntegrationService()).toBeNull(); expect(runtime.getOAuthCoordinator()).toBeNull();
    for (const operation of ["oauth", "token", "content"] as const) {
      expect(() => runtime.requireProviderAccess("google_drive", operation)).toThrow("LIVE_PROVIDER_DISABLED");
      expect(() => runtime.requireProviderAccess("instagram", operation)).toThrow("LIVE_PROVIDER_DISABLED");
    }
    current = new Date("2026-10-31T11:00:00.000Z");
    expect(runtime.admission()).toMatchObject({ admitted: false, phase: "D1_BLOCKED", reasons: ["PILOT_APPROVAL_EXPIRED"] });
    expect(runtime.getIntegrationService()).toBeNull(); expect(runtime.getOAuthCoordinator()).toBeNull();
  });
});
