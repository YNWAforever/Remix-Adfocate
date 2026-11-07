// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthPilotFixtures, pilotRequestId, PROJECT_REF, RUN_ID } from "./auth-pilot-fixtures.mjs";

const manifestText = readFileSync(resolve("docs/review/kocmax-stage-4d/d1/auth-permission-execution/fixture-manifest.prepared.json"), "utf8");
const manifest = JSON.parse(manifestText);
const fixtureId = (n: number) => `fa000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const usersReceipt = () => ({ phase: "users_created", projectRef: PROJECT_REF, runId: RUN_ID,
  users: manifest.accounts.map((row: { alias: string; email: string }, i: number) => ({ alias: row.alias, email: row.email, authId: fixtureId(i + 1), createdThisRun: true })) });
const options = () => ({ manifestText, usersCreated: usersReceipt(), approvalRef: `owner-approval:${RUN_ID}`, observedAt: "2026-11-01T12:00:00.000Z" });
const create = () => createAuthPilotFixtures(options());
const network = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("offline Auth pilot fixture boundary", () => {
  it("emits only the bounded initial seed with owner, identity, collision and audit checks", () => {
    const pilot = create(), sql = pilot.seedSql();
    expect(pilot.scope.accounts).toHaveLength(9);
    expect(pilot.scope.workspaces.map((row: { id: string }) => row.id)).toEqual(["00391df1-e411-4a82-a317-4a73bb293f89", "5d92d267-1b2a-4f19-97bd-3c80f1f3b213"]);
    expect(sql).toContain("current_user <> 'postgres'");
    expect(sql).toContain("email_confirmed_at IS NOT NULL");
    expect(sql).toContain("FIXTURE_COLLISION_STOP_NO_UPSERT");
    expect(sql).toContain("EXACT_SEED_POSTCONDITION_FAILED");
    expect(sql.match(/outcome := private\.bootstrap_staff_access\(/g)).toHaveLength(4);
    expect(sql.match(/INSERT INTO public\./g)).toHaveLength(3);
    expect(sql).not.toMatch(/INSERT INTO (auth\.|public\.(creators|point_balances|earnings_balances|missions))/);
    expect(sql).not.toMatch(/ON CONFLICT|TRUNCATE|DISABLE TRIGGER|UPDATE auth\.|DELETE FROM/);
    expect(sql).toBe(create().seedSql());
  });

  it("does not mutate the prepared inputs or retain caller-mutable user IDs", () => {
    const input = options(), before = JSON.stringify(input);
    const pilot = createAuthPilotFixtures(input);
    expect(JSON.stringify(input)).toBe(before);
    input.usersCreated.users[0].authId = fixtureId(500);
    expect(pilot.seedSql()).not.toContain(fixtureId(500));
  });

  it.each(["runId", "projectRef", "phase"])("rejects changed receipt %s", key => {
    const input = options();
    Object.assign(input.usersCreated, { [key]: "wrong" });
    expect(() => createAuthPilotFixtures(input)).toThrow("EXACT_USERS_CREATED_RECEIPT_REQUIRED");
  });

  it("rejects any change to the reviewed manifest, including target and row caps", () => {
    expect(() => createAuthPilotFixtures({ ...options(), manifestText: manifestText + "\n" })).toThrow("PREPARED_MANIFEST_HASH_MISMATCH");
  });

  it.each(["missing", "extra", "duplicate-alias", "duplicate-id", "wrong-email", "unowned", "invalid-id", "unknown-alias"])("rejects %s identities", kind => {
    const input = options(), users = input.usersCreated.users;
    switch (kind) {
      case "missing": users.pop(); break;
      case "extra": users.push({ ...users[0] }); break;
      case "duplicate-alias": users[1].alias = users[0].alias; break;
      case "duplicate-id": users[1].authId = users[0].authId; break;
      case "wrong-email": users[0].email = "someone-else@example.invalid"; break;
      case "unowned": users[0].createdThisRun = false; break;
      case "invalid-id": users[0].authId = "';select 1;--"; break;
      case "unknown-alias": users[0].alias = "CUSTOMER"; break;
    }
    expect(() => createAuthPilotFixtures(input)).toThrow(/EXACT_USERS_CREATED_RECEIPT_REQUIRED|AUTH_IDENTITY_RECEIPT_MISMATCH/);
  });

  it("rejects credentials even in nested receipt metadata without echoing them", () => {
    const input = options();
    Object.assign(input.usersCreated.users[0], { debug: { access_token: "never-print-this" } });
    expect(() => createAuthPilotFixtures(input)).toThrow(/^SANITIZED_RECEIPT_REQUIRED$/);
  });

  it.each(["", " ", "x".repeat(501), "owner\0reference"])("requires a bounded explicit approval reference", approvalRef => {
    expect(() => createAuthPilotFixtures({ ...options(), approvalRef })).toThrow("EXPLICIT_APPROVAL_REFERENCE_REQUIRED");
  });

  it("quotes approval text and cannot close the generated dollar block", () => {
    const approvalRef = "Owner's approval \\ test $pilot_seed$; END; --";
    const sql = createAuthPilotFixtures({ ...options(), approvalRef }).seedSql();
    expect(sql).toContain("E'Owner''s approval \\\\ test $pilot_seed$; END; --'");
    const delimiter = sql.match(/DO (\$pilot_[0-9a-f]{20}\$)/)?.[1];
    expect(delimiter).toBeDefined();
    expect(sql.split(delimiter!)).toHaveLength(3);
  });

  it("pins reviewer revocation to the owned initial grant and optimistic revision 1", () => {
    const pilot = create(), sql = pilot.roleRevokeSql();
    expect(sql).toContain("EXACT_REVIEWER_REVISION_ONE_REQUIRED");
    expect(sql).toContain("role='reviewer' AND active AND revision=1");
    expect(sql).toContain(pilotRequestId("grant:S-R"));
    expect(sql).toContain(pilotRequestId("revoke:S-R"));
    expect(sql).toContain("E'reviewer',false,1,");
    expect(sql).toContain("::integer IS DISTINCT FROM 2");
    expect(sql.match(/outcome := private\.bootstrap_staff_access\(/g)).toHaveLength(1);
    expect(sql).not.toMatch(/UPDATE public\.|DELETE FROM/);
  });
});

describe("bounded manual Studio plan and cleanup inventory", () => {
  type Receipt = { step: string; requestId: string; result: Record<string, unknown> };
  function completePlan() {
    const pilot = create(), receipts: Receipt[] = [], requests = [];
    let nextId = 100;
    for (const step of pilot.studioSteps) {
      const request = pilot.studioRequest(step.key, receipts);
      requests.push(request);
      const actor = pilot.scope.accounts.find((row: { alias: string }) => row.alias === step.alias)!;
      const ws = pilot.scope.workspaces.find((row: { alias: string }) => row.alias === (step.alias === "C-B" ? "B" : "A"))!;
      const result: Record<string, unknown> = { id: fixtureId(nextId++), creator_id: actor.authId, workspace_id: ws.id };
      if (step.kind === "thread") Object.assign(result, { conversation_id: fixtureId(nextId++), revision: 0 });
      else {
        result.thread_id = request.body.payload.threadId;
        if (step.kind === "brief") result.version = 1;
        else Object.assign(result, { kind: "manual", status: "unverified", shareable: false, integration: null, revoked_at: null });
      }
      receipts.push({ step: step.key, requestId: step.requestId, result });
    }
    return { pilot, receipts, requests };
  }

  it("materializes 3 threads, 4 private manual sources and 3 first-version briefs", () => {
    const { requests } = completePlan();
    expect(requests.map(row => row.body.action).filter(action => action === "create_thread")).toHaveLength(3);
    expect(requests.map(row => row.body.action).filter(action => action === "add_source")).toHaveLength(4);
    expect(requests.map(row => row.body.action).filter(action => action === "save_brief")).toHaveLength(3);
    expect(new Set(requests.map(row => row.body.requestId)).size).toBe(10);
    for (const request of requests) {
      expect(request.path).toBe("/api/studio/commands");
      expect(request.headers).not.toHaveProperty("Authorization");
      expect(request.body.payload).not.toHaveProperty("missionId");
      if (request.body.action === "add_source") expect(request.body.payload).toMatchObject({ kind: "manual", shareable: false, platform: "manual", region: "HK", language: "zh-Hant", observed_at: options().observedAt });
    }
    expect(requests.filter(row => row.body.action === "save_brief").map(row => row.body.payload.revision)).toEqual([2, 1, 1]);
  });

  it("requires real prior result IDs and rejects a foreign actor or thread binding", () => {
    const { pilot, receipts } = completePlan();
    expect(() => pilot.studioRequest("C-A:brief", [])).toThrow("PRIOR_STUDIO_RECEIPTS_REQUIRED");
    const foreign = structuredClone(receipts);
    foreign[0].result.creator_id = fixtureId(900);
    expect(() => pilot.studioRequest("C-A:brief", foreign)).toThrow("STUDIO_RECEIPT_OWNERSHIP_MISMATCH");
    const wrongThread = structuredClone(receipts);
    wrongThread[1].result.thread_id = fixtureId(901);
    expect(() => pilot.cleanupInventorySql(wrongThread)).toThrow("STUDIO_RECEIPT_THREAD_MISMATCH");
  });

  it("rejects shareable/provider sources and unsupported extra steps", () => {
    const { pilot, receipts } = completePlan();
    receipts[1].result.shareable = true;
    expect(() => pilot.cleanupInventorySql(receipts)).toThrow("PRIVATE_MANUAL_SOURCE_REQUIRED");
    expect(() => pilot.studioRequest("C-P:source-2", [])).toThrow("UNKNOWN_STUDIO_STEP");
    expect(() => pilotRequestId("mission:join")).toThrow("UNKNOWN_REQUEST_LABEL");
  });

  it("emits only precise read-only cleanup inventory and retained-parent instructions", () => {
    const { pilot, receipts } = completePlan(), sql = pilot.cleanupInventorySql(receipts);
    expect(sql).toContain("BEGIN READ ONLY;");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/);
    for (const row of receipts) expect(sql).toContain(String(row.result.id));
    expect(sql).toContain("WHERE user_id=ANY(");
    expect(sql).not.toMatch(/\bLIKE\b/);
    expect(pilot.cleanupPlan.minimumRetainedAuthAliases).toEqual(["S-A", "S-O", "S-R", "S-F"]);
    expect(pilot.cleanupPlan.minimumRetainedWorkspaceIds).toEqual(["00391df1-e411-4a82-a317-4a73bb293f89"]);
    expect(pilot.cleanupPlan.exclusions).toContain("No missions, positive joins, shares, AI, providers or awards in this module");
  });
});
