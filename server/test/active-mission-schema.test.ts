import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  activeMissionIntegrationSkipReason,
  creatorRewardSnapshot,
  makeBrand,
  makeCreator,
  makeStaff,
  seedActiveMission,
  serviceForTests,
  userForJwt,
} from "./helpers";

const integrationSkipReason = activeMissionIntegrationSkipReason();
const suite = integrationSkipReason === null ? describe : describe.skip;
const suiteName = integrationSkipReason === null ? "active mission workflow schema" : `active mission workflow schema (skipped: ${integrationSkipReason})`;
const unique = () => randomUUID();

const rewardContractMigrationSql = () => readFileSync(
  resolve("supabase/migrations/20260731110000_reward_contract_capture.sql"),
  "utf8",
).toLowerCase().replace(/\r\n/g, "\n");

const rewardHandoffTransitionMigrationSql = () => {
  const path = resolve(
    "supabase/migrations/20260731120000_reward_handoff_transitions.sql",
  );
  return existsSync(path)
    ? readFileSync(path, "utf8").toLowerCase().replace(/\r\n/g, "\n")
    : "";
};

function sqlFunctionBlock(sql: string, qualifiedName: string) {
  const signature = `create or replace function ${qualifiedName}(`;
  const start = sql.indexOf(signature);
  expect(start, `missing function: ${qualifiedName}`).toBeGreaterThanOrEqual(0);
  const bodyStart = sql.indexOf("as $$", start);
  expect(bodyStart, `missing function body: ${qualifiedName}`).toBeGreaterThan(start);
  const end = sql.indexOf("\n$$;", bodyStart);
  expect(end, `unterminated function body: ${qualifiedName}`).toBeGreaterThan(bodyStart);
  return sql.slice(start, end + 4);
}

function expectSqlOrder(block: string, qualifiedName: string, tokens: string[]) {
  let previous = -1;
  for (const token of tokens) {
    const index = block.indexOf(token);
    expect(
      index,
      `${qualifiedName}: missing or out-of-order token: ${token}`,
    ).toBeGreaterThan(previous);
    previous = index;
  }
}

function normalizedSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

describe("active mission migration contract", () => {
  it("defines an additive, reward-neutral handoff schema", () => {
    const sql = readFileSync(
      resolve("supabase/migrations/20260731100000_reward_handoff_schema.sql"),
      "utf8",
    );
    expect(sql).toContain("create table public.mission_reward_contracts");
    expect(sql).toContain("create table public.mission_completion_decisions");
    expect(sql).toContain("create table public.mission_pending_rewards");
    expect(sql).toContain("reward_processing_window_days");
    expect(sql).toContain("'reward_pending'");
    expect(sql).toContain("where status = 'pending'");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke all");
    expect(sql).not.toContain("approve_submission(");
  });

  it("binds fresh active joins to an atomic zero-XP reward contract", () => {
    const sql = rewardContractMigrationSql();
    const join = sqlFunctionBlock(sql, "public.join_active_mission");

    expectSqlOrder(join, "public.join_active_mission", [
      "v_submission := public.join_mission(p_mission);",
      "v_workflow := private.create_mission_workflow(v_submission.id);",
      "insert into public.mission_reward_contracts",
      "currency,\n    xp_amount,\n    source,",
      "'hkd',\n    0,\n    'join',",
    ]);
    expect(join).toContain("set search_path = ''");
    expect(sql).not.toContain("create trigger mission_reward_contract");
    expect(sql).toContain(
      "grant execute on function public.join_active_mission(uuid) to authenticated",
    );
  });

  it("guards service-only reward wrappers before private dispatch", () => {
    const sql = rewardContractMigrationSql();
    const backfill = sqlFunctionBlock(
      sql,
      "public.backfill_mission_reward_contract",
    );
    const sla = sqlFunctionBlock(
      sql,
      "public.set_reward_processing_window",
    );

    for (const [name, block, dispatch] of [
      [
        "public.backfill_mission_reward_contract",
        backfill,
        "return private.backfill_mission_reward_contract(",
      ],
      [
        "public.set_reward_processing_window",
        sla,
        "return private.set_reward_processing_window(",
      ],
    ] as const) {
      expectSqlOrder(block, name, [
        "auth.jwt() ->> 'role'",
        "= 'service_role'",
        "raise exception 'not_authorized';",
        dispatch,
      ]);
      expect(block).toContain("set search_path = ''");
    }

    expect(sql).toContain(
      "revoke all on function public.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) to service_role",
    );
    expect(sql).toContain(
      "revoke all on function public.set_reward_processing_window(uuid, uuid, smallint) from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.set_reward_processing_window(uuid, uuid, smallint) to service_role",
    );
  });

  it("authorizes and tenant-scopes backfill before workflow or contract lookup", () => {
    const sql = rewardContractMigrationSql();
    const backfill = sqlFunctionBlock(
      sql,
      "private.backfill_mission_reward_contract",
    );

    expectSqlOrder(backfill, "private.backfill_mission_reward_contract", [
      "perform private.assert_active_mission_operator(p_operator);",
      "from public.brand_users membership",
      "membership.user_id = p_operator",
      "membership.workspace_id = p_workspace",
      "membership.active",
      "raise exception 'not_authorized';",
      "select workflow.* into v_workflow",
      "from public.mission_workflows workflow",
      "workflow.id = p_workflow",
      "workflow.workspace_id = p_workspace",
      "for update;",
      "from public.mission_reward_contracts contract",
    ]);
    expect(backfill).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke all on function private.backfill_mission_reward_contract(uuid, uuid, uuid, integer, numeric, text, integer, timestamptz, text, text, uuid) from public, anon, authenticated, service_role",
    );
  });

  it("keeps nullable SLA bounds and updates only the workspace SLA column", () => {
    const sql = rewardContractMigrationSql();
    const sla = sqlFunctionBlock(
      sql,
      "private.set_reward_processing_window",
    );

    expectSqlOrder(sla, "private.set_reward_processing_window", [
      "perform private.assert_active_mission_operator(p_operator);",
      "from public.brand_users membership",
      "membership.workspace_id = p_workspace",
      "membership.active",
      "raise exception 'not_authorized';",
      "p_days is not null and (p_days < 0 or p_days > 365)",
      "update public.workspaces",
    ]);
    expect(sla).not.toContain("p_days is null then");
    const updates = sla.match(
      /update public\.workspaces[\s\S]*?where id = p_workspace;/g,
    ) ?? [];
    expect(updates).toHaveLength(1);
    expect(normalizedSql(updates[0]!)).toBe(
      "update public.workspaces set reward_processing_window_days = p_days where id = p_workspace;",
    );
    expect(sla).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke all on function private.set_reward_processing_window(uuid, uuid, smallint) from public, anon, authenticated, service_role",
    );
  });

  it("defines service-only atomic approval and cancellation wrappers", () => {
    const sql = rewardHandoffTransitionMigrationSql();
    const approve = sqlFunctionBlock(
      sql,
      "public.approve_mission_completion",
    );
    const cancel = sqlFunctionBlock(
      sql,
      "public.cancel_mission_reward_handoff",
    );

    for (const [name, block, dispatch] of [
      [
        "public.approve_mission_completion",
        approve,
        "return private.approve_mission_completion(",
      ],
      [
        "public.cancel_mission_reward_handoff",
        cancel,
        "return private.cancel_mission_reward_handoff(",
      ],
    ] as const) {
      expectSqlOrder(block, name, [
        "auth.jwt() ->> 'role'",
        "= 'service_role'",
        "raise exception 'not_authorized';",
        dispatch,
      ]);
      expect(block).toContain("set search_path = ''");
    }
    expect(normalizedSql(sql)).toContain(
      "grant execute on function public.approve_mission_completion(uuid, uuid, uuid, text, integer, uuid) to service_role",
    );
    expect(normalizedSql(sql)).toContain(
      "grant execute on function public.cancel_mission_reward_handoff(uuid, uuid, uuid, text, integer, uuid, text, text) to service_role",
    );
  });

  it("authorizes, locks, verifies evidence, and appends approval in transaction order", () => {
    const approve = sqlFunctionBlock(
      rewardHandoffTransitionMigrationSql(),
      "private.approve_mission_completion",
    );
    const workflowLock = approve.indexOf(
      "select workflow.* into v_workflow",
    );
    const replayAfterLock = approve.indexOf(
      "from public.mission_completion_decisions decision",
      workflowLock,
    );

    expectSqlOrder(approve, "private.approve_mission_completion", [
      "perform private.assert_active_mission_operator(p_operator);",
      "from public.brand_users membership",
      "membership.user_id = p_operator",
      "membership.workspace_id = p_workspace",
      "membership.active",
      "raise exception 'not_authorized';",
      "extensions.digest(convert_to(",
      "select workflow.* into v_workflow",
      "workflow.workspace_id = p_workspace",
      "for update;",
      "from public.mission_completion_decisions decision",
    ]);
    expect(approve.slice(0, workflowLock)).not.toContain(
      "from public.mission_completion_decisions decision",
    );
    expect(replayAfterLock).toBeGreaterThan(workflowLock);
    expectSqlOrder(
      approve.slice(replayAfterLock),
      "private.approve_mission_completion mutation",
      [
        "from public.mission_reward_contracts contract",
        "from public.mission_work_items item",
        "item.required",
        "item.verified_proof_attempt_id",
        "from public.mission_publication_proof_attempts attempt",
        "join public.mission_publication_proof_reviews review",
        "review.state = 'verified'",
        "review.decision = 'verified'",
        "insert into public.mission_completion_decisions",
        "insert into public.mission_pending_rewards",
        "update public.mission_workflows",
        "state = 'reward_pending'",
        "revision = revision + 1",
        "'mission_completion_approved'",
      ],
    );
    expect(approve).toContain(
      "when v_processing_days is null then null",
    );
    expect(approve).toContain(
      "else v_now + make_interval(days => v_processing_days)",
    );
    expect(approve).toMatch(
      /pending_reward_id,[\s\S]*?\)\s*values\s*\([\s\S]*?null,/,
    );
    expect(approve).toContain("'proofreviewid'");
    expect(approve).not.toContain("'primaryurl'");
    expect(approve).not.toContain("'additionalurls'");
    expect(approve).not.toContain("'storageobjectpath'");
  });

  it("locks before replay and reconstructs immutable cycle snapshots with tenant-bound joins", () => {
    const sql = rewardHandoffTransitionMigrationSql();
    const approve = sqlFunctionBlock(
      sql,
      "private.approve_mission_completion",
    );
    const cancel = sqlFunctionBlock(
      sql,
      "private.cancel_mission_reward_handoff",
    );

    for (const [name, block, replayState, pendingState] of [
      [
        "private.approve_mission_completion",
        approve,
        "'state', 'reward_pending'",
        "'status', 'pending'",
      ],
      [
        "private.cancel_mission_reward_handoff",
        cancel,
        "'state', 'proof_verified'",
        "'status', 'cancelled'",
      ],
    ] as const) {
      const workflowLock = block.indexOf(
        "select workflow.* into v_workflow",
      );
      const keyLookupStart = block.indexOf(
        "select decision.* into v_decision",
      );
      const keyLookupEnd = block.indexOf(";", keyLookupStart);
      const keyLookup = block.slice(keyLookupStart, keyLookupEnd + 1);
      const requestHashCheck = block.indexOf(
        "v_decision.request_hash <> v_request_hash",
      );
      const requestedWorkflowCheck = block.indexOf(
        "v_decision.mission_workflow_id <> p_workflow",
      );
      const canonicalSubmission = block.indexOf(
        "select submission.* into v_submission",
      );
      const canonicalContract = block.indexOf(
        "select contract.* into v_contract",
      );
      const replayLookup = block.indexOf(
        "select pending as pending_row",
      );
      const stateCheck = block.indexOf(
        "if v_workflow.state <> v_expected_state then",
      );

      expect(workflowLock, `${name} workflow lock`).toBeGreaterThanOrEqual(0);
      expect(keyLookupStart, `${name} key lookup`).toBeGreaterThan(workflowLock);
      expect(requestHashCheck, `${name} hash check`).toBeGreaterThan(keyLookupEnd);
      expect(requestedWorkflowCheck, `${name} workflow check`)
        .toBeGreaterThan(requestHashCheck);
      expect(canonicalSubmission, `${name} canonical submission`)
        .toBeGreaterThan(requestedWorkflowCheck);
      expect(canonicalContract, `${name} canonical contract`)
        .toBeGreaterThan(canonicalSubmission);
      expect(replayLookup, `${name} replay lookup`)
        .toBeGreaterThan(canonicalContract);
      expect(stateCheck, `${name} state check`).toBeGreaterThan(replayLookup);
      expect(block.slice(0, workflowLock)).not.toContain(
        "from public.mission_completion_decisions decision",
      );
      expect(keyLookup).toContain("decision.workspace_id = p_workspace");
      expect(keyLookup).toContain(
        "decision.idempotency_key = p_idempotency_key",
      );
      expect(keyLookup).not.toContain("decision.mission_workflow_id");
      for (const predicate of [
        "submission.id = v_workflow.mission_submission_id",
        "submission.workspace_id = p_workspace",
        "contract.workspace_id = p_workspace",
        "contract.mission_workflow_id = p_workflow",
        "contract.mission_submission_id = v_submission.id",
        "contract.mission_id = v_submission.mission_id",
        "pending.workspace_id = p_workspace",
        "pending.mission_workflow_id = p_workflow",
        "pending.mission_submission_id = v_submission.id",
        "pending.creator_id = v_submission.creator_id",
        "pending.mission_id = v_submission.mission_id",
        "pending.reward_contract_id = v_contract.id",
        "approval.workspace_id = pending.workspace_id",
        "approval.mission_workflow_id = pending.mission_workflow_id",
        "approval.reward_contract_id = pending.reward_contract_id",
        "pending.completion_decision_id = approval.id",
        "approval.decision_kind = 'approved'",
        "cancellation.workspace_id = pending.workspace_id",
        "cancellation.mission_workflow_id = pending.mission_workflow_id",
        "cancellation.reward_contract_id = pending.reward_contract_id",
        "pending.id = cancellation.pending_reward_id",
        "pending.cancellation_decision_id = cancellation.id",
        "cancellation.supersedes_decision_id = pending.completion_decision_id",
        "cancellation.decision_kind = 'cancelled'",
      ]) {
        expect(block, `${name} missing replay predicate: ${predicate}`)
          .toContain(predicate);
      }
      expect(block).toContain(
        "'id', v_decision.mission_workflow_id",
      );
      expect(block).toContain(replayState);
      expect(block).toContain(
        "'revision', v_decision.workflow_revision + 1",
      );
      expect(block).toContain(
        "'updated_at', v_decision.decided_at",
      );
      expect(block).toContain(pendingState);
      expect(block).not.toContain(
        "'workflow', to_jsonb(v_workflow)",
      );
      expect(block).not.toContain(
        "'pendingreward', to_jsonb(v_pending),",
      );
    }
    expect(approve).toContain("'cancellation_decision_id', null");
    expect(approve).toContain("'cancelled_at', null");
    expect(cancel).toContain(
      "'cancellation_decision_id', v_decision.id",
    );
    expect(cancel).toContain(
      "'cancelled_at', v_decision.decided_at",
    );
  });

  it("normalizes idempotency hashes and rolls pending conflicts back", () => {
    const sql = rewardHandoffTransitionMigrationSql();
    const approve = sqlFunctionBlock(
      sql,
      "private.approve_mission_completion",
    );
    const cancel = sqlFunctionBlock(
      sql,
      "private.cancel_mission_reward_handoff",
    );

    for (const [, block] of [
      ["private.approve_mission_completion", approve],
      ["private.cancel_mission_reward_handoff", cancel],
    ] as const) {
      expect(block).toContain("extensions.digest(convert_to(");
      expect(block).toContain("'sha256'");
      expect(block).toContain("'action'");
      expect(block).toContain("'workflowid'");
      expect(block).toContain("'expectedstate'");
      expect(block).toContain("'expectedrevision'");
      expect(block).toContain("btrim(");
      expect(block).toContain("raise exception 'idempotency_conflict'");
      expect(block).toContain("'idempotent', true");
      expect(block).toContain("'idempotent', false");
      expect(block).toContain(
        "select decision.* into v_decision",
      );
      expect(block).not.toContain("select decision, pending");
    }
    expect(cancel).toContain("lower(btrim(p_reason_category))");
    expect(cancel).toContain("btrim(p_reason_note)");
    expect(approve).toContain("exception when unique_violation then");
    expect(approve).toContain("raise exception 'pending_reward_exists'");
  });

  it("locks and appends cancellation while changing only the guarded fields", () => {
    const cancel = sqlFunctionBlock(
      rewardHandoffTransitionMigrationSql(),
      "private.cancel_mission_reward_handoff",
    );
    expectSqlOrder(cancel, "private.cancel_mission_reward_handoff auth", [
      "perform private.assert_active_mission_operator(p_operator);",
      "from public.brand_users membership",
      "raise exception 'not_authorized';",
      "select workflow.* into v_workflow",
      "for update;",
    ]);
    const pendingLock = cancel.lastIndexOf(
      "select pending.* into v_pending",
    );
    expect(pendingLock).toBeGreaterThanOrEqual(0);
    expectSqlOrder(
      cancel.slice(pendingLock),
      "private.cancel_mission_reward_handoff mutation",
      [
      "select pending.* into v_pending",
      "status = 'pending'",
      "for update of pending;",
      "insert into public.mission_completion_decisions",
      "update public.mission_pending_rewards",
      "set status = 'cancelled',",
      "cancellation_decision_id = v_decision.id,",
      "cancelled_at = v_now",
      "update public.mission_workflows",
      "state = 'proof_verified'",
      "revision = revision + 1",
      "'mission_reward_pending_cancelled'",
      ],
    );
    expect(cancel).toContain(
      "('contract_error','eligibility_error','duplicate','other')",
    );
    expect(cancel).toContain("supersedes_decision_id");
    expect(cancel).toContain("pending_reward_id");
  });

  it("keeps transition RPCs reward and budget neutral", () => {
    const sql = rewardHandoffTransitionMigrationSql();
    for (const forbidden of [
      "approve_submission(",
      "update public.mission_submissions",
      "update public.creators",
      "insert into public.point_transactions",
      "update public.point_balances",
      "insert into public.earnings_transactions",
      "update public.earnings_balances",
      "insert into public.workspace_budget_transactions",
      "update public.workspace_budgets",
      "insert into public.redemptions",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("returns a creator-owned bounded handoff without audit or proof secrets", () => {
    const sql = rewardHandoffTransitionMigrationSql();
    const creatorRead = sqlFunctionBlock(
      sql,
      "public.get_my_mission_reward_handoff",
    );
    expectSqlOrder(creatorRead, "public.get_my_mission_reward_handoff auth", [
      "auth.uid()",
      "from public.mission_submissions submission",
      "submission.creator_id = v_creator",
    ]);
    const ownedRead = creatorRead.slice(
      creatorRead.indexOf("from public.mission_submissions submission"),
    );
    expectSqlOrder(ownedRead, "public.get_my_mission_reward_handoff owned read", [
      "from public.mission_submissions submission",
      "submission.creator_id = v_creator",
      "if v_workflow is null then",
      "raise exception 'not_found';",
      "from public.mission_reward_contracts contract",
      "contract.workspace_id = v_workspace",
      "contract.mission_workflow_id = v_workflow",
      "contract.mission_submission_id = p_submission",
      "contract.mission_id = v_mission",
      "from public.mission_pending_rewards pending",
      "jsonb_build_object(",
    ]);
    for (const predicate of [
      "pending.workspace_id = v_workspace",
      "pending.mission_workflow_id = v_workflow",
      "pending.mission_submission_id = p_submission",
      "pending.creator_id = v_creator",
      "pending.mission_id = v_mission",
      "pending.reward_contract_id = v_contract",
      "approval.workspace_id = pending.workspace_id",
      "approval.mission_workflow_id = pending.mission_workflow_id",
      "approval.reward_contract_id = pending.reward_contract_id",
      "approval.id = pending.completion_decision_id",
      "approval.decision_kind = 'approved'",
      "cancellation.workspace_id = pending.workspace_id",
      "cancellation.mission_workflow_id = pending.mission_workflow_id",
      "cancellation.reward_contract_id = pending.reward_contract_id",
      "cancellation.id = pending.cancellation_decision_id",
      "cancellation.pending_reward_id = pending.id",
      "cancellation.supersedes_decision_id = approval.id",
      "cancellation.decision_kind = 'cancelled'",
    ]) {
      expect(creatorRead, `missing creator tenant predicate: ${predicate}`)
        .toContain(predicate);
    }
    expect(creatorRead).toContain(
      "select pending as pending_row,",
    );
    expect(creatorRead).toContain("into v_read");
    expect(creatorRead).toContain("v_pending := v_read.pending_row");
    for (const forbidden of [
      "reason_note",
      "confirmation_reason",
      "confirmation_evidence_source",
      "confirmed_by",
      "decided_by",
      "actor_id",
      "idempotency_key",
      "request_hash",
      "evidence_snapshot",
      "primary_url",
      "additional_urls",
      "storage_object_path",
      "signed",
      "to_jsonb(v_decision)",
      "to_jsonb(v_pending)",
    ]) {
      expect(creatorRead).not.toContain(forbidden);
    }
    expect(creatorRead).toContain("set search_path = ''");
    expect(normalizedSql(sql)).toContain(
      "grant execute on function public.get_my_mission_reward_handoff(uuid) to authenticated",
    );
    expect(normalizedSql(sql)).not.toContain(
      "grant execute on function public.get_my_mission_reward_handoff(uuid) to anon",
    );
  });

  it("documents a non-destructive publication-proof rollback and operator recovery contract", () => {
    const runbookPath = resolve("docs/operations/publication-proof-release-runbook.md");
    const runbook = existsSync(runbookPath)
      ? readFileSync(runbookPath, "utf8").toLowerCase().replace(/\r\n/g, "\n")
      : "";

    for (const token of [
      "mission_publication_instructions",
      "mission_publication_proof_attempts",
      "setup_existing_publication_instructions",
      "p_workspace",
      "p_workflow",
      "p_work_item",
      "p_operator",
      "p_expected_state",
      "p_expected_revision",
      "p_idempotency_key",
      "p_instructions",
      "proof_submitted",
      "proof_under_review",
      "proof_correction_requested",
      "metadata_status",
      "refresh-publication-proof-metadata",
      "workflow_stale",
      "publication-proof-enabled",
      "route/feature boundary",
      "new creator proof mutations",
      "operator queue/review actions",
      "mission_workflow_events",
      "mission_publication_proof_assets",
      "mission_publication_proof_reviews",
      "mission_publication_proof_review_items",
      "content_urls",
      "points_awarded",
      "xp_awarded",
      "earnings",
      "workspace budget",
    ]) expect(runbook, `missing publication-proof runbook token: ${token}`).toContain(token);

    for (const forbidden of [
      "drop table",
      "truncate table",
      "delete from",
      "reverse migration",
      "update public.mission_submissions set",
      "delete storage",
    ]) expect(runbook, `destructive rollback instruction found: ${forbidden}`).not.toContain(forbidden);
  });

  it("documents complete and privacy-safe publication-proof emergency controls", () => {
    const runbookPath = resolve("docs/operations/publication-proof-release-runbook.md");
    const runbook = existsSync(runbookPath)
      ? readFileSync(runbookPath, "utf8").toLowerCase().replace(/\r\n/g, "\n")
      : "";

    for (const token of [
      "put /admin/active-missions/:workflowid/work-items/:workitemid/publication-instructions",
      "set_publication_instructions(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb)",
      "item.deadline as creator_deadline",
      "item.review_due_at",
      "md5(coalesce(array_to_string(content_urls",
      "pb.workspace_id = '<workspace_uuid>'::uuid",
      "eb.workspace_id = '<workspace_uuid>'::uuid",
      "point_transactions where creator_id = '<creator_uuid>'::uuid and workspace_id = '<workspace_uuid>'::uuid",
      "earnings_transactions where creator_id = '<creator_uuid>'::uuid and workspace_id = '<workspace_uuid>'::uuid",
    ]) expect(runbook, `missing reviewed emergency-control token: ${token}`).toContain(token);

    expect(runbook).not.toContain("select id, workspace_id, mission_id, status, content_urls");

    const blockedDiagnostic = runbook
      .split("### blocked-item diagnostic")[1]
      ?.split("### overdue priority")[0] ?? "";
    expect(blockedDiagnostic).toContain("item.deadline as creator_deadline");
    expect(blockedDiagnostic).toContain("item.review_due_at");
    expect(blockedDiagnostic).not.toContain("review.review_due_at");
  });

  it("defines a service-only existing publication setup RPC with locked canonical anchors", () => {
    const migrationPath = resolve("supabase/migrations/20260727130000_publication_proof_existing_setup.sql");
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n")
      : "";

    for (const token of [
      "function private.setup_existing_publication_instructions",
      "function public.setup_existing_publication_instructions",
      "security definer",
      "set search_path = ''",
      "auth.jwt() ->> 'role'",
      "private.assert_active_mission_operator(p_operator)",
      "from public.brand_users",
      "membership.workspace_id = p_workspace",
      "membership.active",
      "from public.mission_workflows",
      "from public.mission_work_items",
      "from public.mission_publication_instructions",
      "from public.mission_publication_proof_attempts",
      "for update",
      "v_item.state is distinct from 'approved_to_publish'",
      "p_expected_state",
      "p_expected_revision",
      "p_idempotency_key uuid",
      "mission_publication_existing_instructions_setup",
    ]) expect(sql, `missing existing publication setup token: ${token}`).toContain(token);

    const locks = [
      "from public.mission_workflows",
      "from public.mission_work_items",
      "from public.mission_publication_instructions",
      "from public.mission_publication_proof_attempts",
    ].map((token) => sql.indexOf(token));
    expect(locks.every((position) => position >= 0)).toBe(true);
    expect(locks).toEqual([...locks].sort((left, right) => left - right));
  });

  it("requires a complete authored policy, freezes once, and preserves exact idempotency", () => {
    const migrationPath = resolve("supabase/migrations/20260727130000_publication_proof_existing_setup.sql");
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n")
      : "";

    for (const field of [
      "publication_instructions",
      "publication_window_hours",
      "required_disclosures",
      "expected_account",
      "proof_evidence_policy",
    ]) {
      expect(sql).toContain(`p_instructions ? '${field}'`);
    }
    expect(sql).toMatch(/jsonb_array_elements\([^)]*required_disclosures[^)]*\)[\s\S]*btrim/);
    expect(sql).toMatch(
      /case when jsonb_typeof\(p_instructions->'required_disclosures'\) = 'array' then exists/,
    );
    expect(sql).toMatch(/proof_evidence_policy[\s\S]*jsonb_typeof/);
    expect(sql).toContain("p_expected_state is distinct from 'approved_to_publish'");
    expect(sql).toContain("v_item.state is distinct from p_expected_state");
    expect(sql).toContain("v_item.state is distinct from 'approved_to_publish'");
    expect(sql).toContain("jsonb_typeof(p_instructions->'publication_window_hours') = 'number'");
    expect(sql).toContain("v_window_hours > 8760");
    expect(sql).toContain("v_setup_event public.mission_workflow_events");
    for (const correlation of [
      "event.workspace_id = p_workspace",
      "event.mission_workflow_id = p_workflow",
      "event.mission_work_item_id = p_work_item",
      "event.actor_type = 'operator'",
      "event.actor_id = p_operator",
      "event.entity_id = v_instruction.id",
      "event.metadata->>'idempotency_key' = p_idempotency_key::text",
    ]) expect(sql).toContain(correlation);
    expect(sql).toContain("v_setup_event.metadata->>'revision' is distinct from p_expected_revision::text");
    expect(sql).toContain("publication_due_at");
    expect(sql).toContain("make_interval(hours =>");
    expect(sql).toContain("frozen_at");
    expect(sql).toContain("idempotency_keys");
    expect(sql).toContain("array[p_idempotency_key]");
    expect(sql).toMatch(/p_idempotency_key\s*=\s*any\(v_instruction\.idempotency_keys\)/);
    expect(sql).toContain("raise exception 'idempotency_conflict'");
    expect(sql).toContain("'idempotent', true");
    expect(sql).toContain("'idempotent', false");
    expect(sql).toContain("event.event_type = 'mission_publication_existing_instructions_setup'");
    expect(sql).not.toMatch(/coalesce\(\s*p_instructions(?:->[^,]+)?\s*,/);
  });
  it("parenthesizes CASE expressions inside the existing-setup PL/pgSQL validation IF", () => {
    const migrationPath = resolve("supabase/migrations/20260727130000_publication_proof_existing_setup.sql");
    const sql = readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n");
    const validationStart = sql.indexOf("if p_workspace is null");
    const validationEnd = sql.indexOf("then\n    return jsonb_build_object('code', 'validation_failed')", validationStart);
    const validation = sql.slice(validationStart, validationEnd);

    expect(validationStart).toBeGreaterThanOrEqual(0);
    expect(validationEnd).toBeGreaterThan(validationStart);
    expect(validation.match(/\bor\s+\(\s*case\b/g) ?? []).toHaveLength(2);
    expect(validation).not.toMatch(/\bor\s+case\b/);
  });

  it("keeps existing setup audit metadata private, reward-neutral, and service-only", () => {
    const migrationPath = resolve("supabase/migrations/20260727130000_publication_proof_existing_setup.sql");
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n")
      : "";
    const eventStart = sql.indexOf("'mission_publication_existing_instructions_setup'");
    const eventEnd = sql.indexOf("return jsonb_build_object", eventStart);
    const eventWrite = sql.slice(eventStart, eventEnd);
    const signature = "(uuid, uuid, uuid, uuid, text, integer, uuid, jsonb)";

    expect(eventStart).toBeGreaterThanOrEqual(0);
    expect(eventWrite).not.toMatch(
      /publication_instructions|required_disclosures|expected_account|proof_evidence_policy/,
    );
    expect(sql).toContain(`revoke all on function private.setup_existing_publication_instructions${signature} from public, anon, authenticated, service_role`);
    expect(sql).toContain(`revoke all on function public.setup_existing_publication_instructions${signature} from public, anon, authenticated, service_role`);
    expect(sql).toContain(`grant execute on function public.setup_existing_publication_instructions${signature} to service_role`);
    expect(sql).not.toMatch(/grant execute[^;]*to (public|anon|authenticated)/);
    expect(sql).not.toMatch(/update\s+public\.(mission_submissions|point_balances|earnings_balances)/);
    expect(sql).not.toMatch(/update\s+public\.creators\s+set\s+xp/);
  });

  it("snapshots complete publication policy, guards overrides, and freezes the approval deadline", () => {
    const migrationPath = resolve("supabase/migrations/20260723090000_publication_proof_validation.sql");
    const sql = readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n");

    for (const token of [
      "source_template_id uuid", "override_reason text", "overridden_by uuid", "overridden_at timestamptz",
      "frozen_at timestamptz", "revision integer", "idempotency_keys uuid[]",
      "function private.snapshot_publication_instructions", "after insert on public.mission_work_items",
      "function private.set_publication_instructions", "function public.set_publication_instructions",
      "p_expected_state text", "p_expected_revision integer", "p_idempotency_key uuid", "p_instructions jsonb",
      "override_reason_required", "mission_publication_instructions_frozen",
      "function private.approve_mission_version", "function public.approve_mission_version",
      "publication_setup_required", "make_interval(hours => v_instruction.publication_window_hours)",
      "least(", "frozen_at = coalesce(frozen_at, v_now)", "to service_role",
    ]) expect(sql, `missing publication instruction lifecycle token: ${token}`).toContain(token);

    expect(sql).toMatch(/creator_workflow_mode[\s\S]*active_workspace[\s\S]*publication_instructions/);
    expect(sql).toMatch(/jsonb_array_elements\([^)]*required_disclosures[^)]*\)[\s\S]*btrim/);
    expect(sql).toMatch(/proof_evidence_policy[\s\S]*jsonb_typeof/);
    expect(sql).toMatch(/p_idempotency_key\s*=\s*any\(v_instruction\.idempotency_keys\)/);
    expect(sql).toMatch(/idempotency_keys\s*=\s*array_append\(idempotency_keys, p_idempotency_key\)/);
    expect(sql).toMatch(/old\.frozen_at is not null[\s\S]*mission_publication_instructions_frozen/);
    expect(sql).not.toMatch(/update\s+public\.mission_submissions\s+set\s+status/i);
    expect(sql).not.toMatch(/update\s+public\.(point_balances|earnings_balances)/i);
    expect(sql).not.toMatch(/update\s+public\.creators\s+set\s+xp/i);
  });
  it("parenthesizes CASE/EXISTS validation inside the publication-instructions PL/pgSQL IF", () => {
    const migrationPath = resolve("supabase/migrations/20260723090000_publication_proof_validation.sql");
    const sql = readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n");
    const setterStart = sql.indexOf("create or replace function private.set_publication_instructions");
    const setterEnd = sql.indexOf("create or replace function public.set_publication_instructions", setterStart);
    const setter = sql.slice(setterStart, setterEnd);

    expect(setter).toMatch(
      /or\s+\(\s*case when jsonb_typeof\(p_instructions->'required_disclosures'\) = 'array' then exists \([\s\S]*?\)\s+else true end\s*\)\s+or/,
    );
  });
  it("keeps operator override prose out of workflow event metadata", () => {
    const migrationPath = resolve("supabase/migrations/20260723090000_publication_proof_validation.sql");
    const sql = readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n");
    const eventStart = sql.indexOf("'mission_publication_instructions_overridden'");
    const eventEnd = sql.indexOf("return jsonb_build_object", eventStart);
    const eventWrite = sql.slice(eventStart, eventEnd);
    const metadata = eventWrite.slice(eventWrite.indexOf("jsonb_build_object"));

    expect(eventStart).toBeGreaterThanOrEqual(0);
    expect(metadata).toContain("jsonb_build_object('revision', v_instruction.revision)");
    expect(metadata).not.toMatch(
      /override_reason|v_reason|publication_instructions|required_disclosures|expected_account|proof_evidence_policy/,
    );
  });

  it("records no-op idempotency without incrementing revision or emitting an override event", () => {
    const migrationPath = resolve("supabase/migrations/20260723090000_publication_proof_validation.sql");
    const sql = readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n");
    const setterStart = sql.indexOf("create or replace function private.set_publication_instructions");
    const setterEnd = sql.indexOf("create or replace function public.set_publication_instructions", setterStart);
    const setter = sql.slice(setterStart, setterEnd);

    expect(setter).toMatch(
      /if not v_changed then[\s\S]*idempotency_keys\s*=\s*array_append\(idempotency_keys, p_idempotency_key\)[\s\S]*return jsonb_build_object\('instruction', to_jsonb\(v_instruction\)\);[\s\S]*end if;/,
    );
    expect(setter.indexOf("if not v_changed then")).toBeLessThan(
      setter.indexOf("'mission_publication_instructions_overridden'"),
    );
  });
  it("defines the publication proof schema and tenant-safe immutable boundary", () => {
    const migrationPath = resolve("supabase/migrations/20260723090000_publication_proof_validation.sql");
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n")
      : "";

    for (const field of [
      "publication_instructions text",
      "publication_window_hours integer",
      "required_disclosures jsonb",
      "expected_account text",
      "proof_evidence_policy jsonb",
    ]) {
      expect(sql, `missing publication template field: ${field}`).toContain(field);
    }

    for (const table of [
      "mission_publication_instructions",
      "mission_publication_proof_attempts",
      "mission_publication_proof_assets",
      "mission_publication_proof_reviews",
      "mission_publication_proof_review_items",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`on public.${table}`);
    }

    expect(sql).toContain("unique (workspace_id, mission_work_item_id, attempt_number)");
    expect(sql).toContain("unique (workspace_id, mission_work_item_id)");
    expect(sql).toContain("current_proof_attempt_id uuid");
    expect(sql).toContain("verified_proof_attempt_id uuid");
    expect(sql).toContain("foreign key (mission_work_item_id, workspace_id)\n    references public.mission_work_items(id, workspace_id)");
    expect(sql).toContain("foreign key (mission_publication_proof_attempt_id, workspace_id)\n    references public.mission_publication_proof_attempts(id, workspace_id)");
    expect(sql).toContain("foreign key (mission_publication_proof_review_id, workspace_id)\n    references public.mission_publication_proof_reviews(id, workspace_id)");
    expect(sql).toContain("add constraint brand_users_user_workspace_unique unique (user_id, workspace_id)");
    expect(sql).toContain("foreign key (reviewer_id, workspace_id)\n    references public.brand_users(user_id, workspace_id)");
    expect(sql).toContain("mission_publication_proof_reviews_one_terminal_decision_idx");

    for (const policy of [
      "mission_publication_instructions_creator_read",
      "mission_publication_proof_attempts_creator_read",
      "mission_publication_proof_assets_creator_read",
      "mission_publication_proof_reviews_creator_read",
      "mission_publication_proof_review_items_creator_read",
    ]) {
      const start = sql.lastIndexOf(`create policy ${policy}`);
      const end = sql.indexOf(";", start);
      expect(start, `missing policy: ${policy}`).toBeGreaterThanOrEqual(0);
      const definition = sql.slice(start, end);
      expect(definition).toContain("workspace_id");
      expect(definition).toContain("auth.uid()");
    }

    expect(sql).toContain("grant select on");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("grant all on");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)[^;]*to\s+authenticated/i);

    for (const table of [
      "mission_publication_instructions",
      "mission_publication_proof_attempts",
      "mission_publication_proof_assets",
      "mission_publication_proof_reviews",
      "mission_publication_proof_review_items",
    ]) {
      expect(sql).toContain(`before update or delete on public.${table}`);
      expect(sql).toContain("execute function private.raise_immutable_record()");
    }

    expect(sql).toContain("'mission-publication-proof-assets'");
    expect(sql).toContain("public = false");
    expect(sql).toContain("mission_publication_proof_assets_storage_read");
    expect(sql).toContain("mission_publication_proof_assets_storage_insert");
    expect(sql).toContain("mission_publication_instructions_due_at_idx");
    expect(sql).toContain("mission_publication_proof_attempts_late_idx");
    expect(sql).toContain("mission_publication_proof_attempts_metadata_status_idx");
    expect(sql).toContain("mission_publication_proof_reviews_reviewer_idx");
    expect(sql).toContain("mission_work_items_current_proof_attempt_idx");
    expect(sql).not.toMatch(/update\s+public\.mission_submissions\s+set\s+status/i);
  });

  it("loads workflow and work-item composite rows separately in draft RPCs", () => {
    const migrationPath = resolve("supabase/migrations/20260719133000_submit_active_mission_draft.sql");
    const sql = readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n");

    expect(sql).not.toMatch(/select\s+i,\s*w\s+into\s+v_item,\s*v_workflow/);
    expect(sql.match(/select w\.\* into v_workflow/g)).toHaveLength(2);
    expect(sql.match(/select i\.\* into v_item/g)).toHaveLength(2);
  });
  it("preserves cross-workspace campaign creators without weakening mission tenant integrity", () => {
    const migrationDir = resolve("supabase/migrations");
    const sql = readdirSync(migrationDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(resolve(migrationDir, name), "utf8"))
      .join("\n")
      .toLowerCase()
      .replace(/\r\n/g, "\n");

    expect(sql).toContain("drop constraint if exists mission_submissions_creator_workspace_fk");
    expect(sql).toContain("drop constraint if exists mission_submissions_mission_id_fkey");
    expect(sql).toContain("drop constraint if exists mission_workflows_mission_submission_id_fkey");
    expect(sql).toContain("constraint mission_workflows_submission_workspace_fk");
    expect(sql).toContain("constraint mission_submissions_mission_workspace_fk");
  });


  it("defines a locked service-only migration for pristine joined legacy submissions", () => {
    const migrationName = "20260719220000_migrate_pristine_joined_active_mission.sql";
    const migrationPath = resolve("supabase/migrations", migrationName);
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, "utf8").toLowerCase().replace(/\r\n/g, "\n")
      : "";

    expect(sql).toContain("create or replace function public.migrate_pristine_joined_active_mission");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("from public.mission_submissions");
    expect(sql).toContain("for update");
    expect(sql).toContain("v_submission.status <> 'joined'");
    expect(sql).toContain("coalesce(cardinality(v_submission.content_urls), 0) <> 0");
    expect(sql).toContain("v_submission.submission_data <> '{}'::jsonb");
    expect(sql).toContain("v_submission.submitted_at is not null");
    expect(sql).toContain("v_submission.points_awarded <> 0");
    expect(sql).toContain("v_submission.xp_awarded <> 0");
    expect(sql).toContain("v_submission.quality_rating is not null");
    expect(sql).toContain("from public.mission_workflows");
    expect(sql).toContain("raise exception 'wrong_state'");
    expect(sql).toContain("private.create_mission_workflow(p_submission)");
    expect(sql).toContain("'legacy_submission_migrated'");
    expect(sql).toContain("revoke all on function public.migrate_pristine_joined_active_mission(uuid) from public, anon, authenticated, service_role");
    expect(sql).toContain("grant execute on function public.migrate_pristine_joined_active_mission(uuid) to service_role");
    for (const forbidden of [
      "update public.mission_submissions",
      "update public.point_balances",
      "update public.earnings_balances",
      "update public.creators set xp",
      "approve_submission(",
      "delete from public.mission_workflow",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("runs the guarded integration suite through a cross-platform Node launcher", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const runnerPath = resolve("scripts/run-integration-tests.mjs");
    const runner = existsSync(runnerPath) ? readFileSync(runnerPath, "utf8") : "";

    expect(pkg.scripts["test:integration"]).toBe("node scripts/run-integration-tests.mjs");
    expect(runner).toContain('RUN_INTEGRATION: "1"');
    expect(runner).toContain("node_modules/vitest/vitest.mjs");
    expect(runner).toContain('"--no-file-parallelism"');
    for (const file of [
      "server/test/rls.test.ts",
      "server/test/notifications-triggers.test.ts",
      "server/test/academy-seed.test.ts",
    ]) expect(runner).toContain(file);
  });

  it("runs live cases only against an explicitly enabled loopback Supabase", () => {
    const localEnv = {
      RUN_INTEGRATION: "1",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_KEY: "service-key",
      SUPABASE_ANON_KEY: "anon-key",
    };

    expect(activeMissionIntegrationSkipReason(localEnv)).toBeNull();
    expect(activeMissionIntegrationSkipReason({ ...localEnv, RUN_INTEGRATION: "0" }))
      .toBe("RUN_INTEGRATION=1 is required");
    expect(activeMissionIntegrationSkipReason({ ...localEnv, SUPABASE_URL: "https://example.supabase.co" }))
      .toBe("SUPABASE_URL must use localhost or 127.0.0.1");
  });

  it("defines the normalized workflow, guarded RPCs, RLS, private assets, and reward boundary", () => {
    const migrationPath = resolve("supabase/migrations/20260715163350_active_mission_workspace.sql");
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

    for (const token of [
      "creator_workflow_mode",
      "create table public.mission_deliverable_templates",
      "create table public.mission_workflows",
      "create table public.mission_work_items",
      "create table public.mission_draft_versions",
      "create table public.mission_workflow_events",
      "create or replace function public.create_mission_workflow",
      "create or replace function public.refresh_mission_workflow_state",
      "security definer",
      "private.create_mission_workflow",
      "enable row level security",
      "mission-draft-assets",
      "immutable_record",
    ]) {
      expect(sql, `missing migration contract token: ${token}`).toContain(token);
    }
    for (const table of [
      "mission_deliverable_templates",
      "mission_deliverable_requirements",
      "mission_workflows",
      "mission_work_items",
      "mission_working_drafts",
      "mission_draft_versions",
      "mission_draft_assets",
      "mission_review_rounds",
      "mission_review_items",
      "mission_revision_grants",
      "mission_fulfillments",
      "mission_workflow_events",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`on public.${table}`);
    }
    expect(sql).toContain("revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role");
    expect(sql).not.toContain("grant execute on function private.create_mission_workflow(uuid) to authenticated");
    expect(sql).toContain("if v_workflow.state in ('cancelled', 'expired') then return v_workflow");
    expect(sql).toContain("foreign key (current_submitted_version_id, id, workspace_id)");
    expect(sql).toContain("foreign key (mission_draft_version_id, mission_work_item_id, workspace_id)");
    expect(sql).toContain("private_rpc_exposed");
    expect(sql).toContain("authenticated_grant_drift");
    expect(sql).toContain("ownership_index_required");
    expect(sql).not.toContain("update public.point_balances");
    expect(sql).not.toContain("update public.earnings_balances");
    expect(sql).not.toContain("update public.workspace_budgets");
    expect(sql).not.toContain("update public.creators set xp");
  });

  it("binds every active-mission relationship and creator lookup to one workspace", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260715163350_active_mission_workspace.sql"), "utf8").toLowerCase().replace(/\r\n/g, "\n");

    for (const relationship of [
      "foreign key (mission_id, workspace_id)\n    references public.missions(id, workspace_id)",
      "foreign key (creator_id, workspace_id)\n    references public.creators(id, workspace_id)",
      "foreign key (mission_deliverable_template_id, workspace_id)\n    references public.mission_deliverable_templates(id, workspace_id)",
      "foreign key (mission_submission_id, workspace_id)\n    references public.mission_submissions(id, workspace_id)",
      "foreign key (mission_workflow_id, workspace_id)\n    references public.mission_workflows(id, workspace_id)",
      "foreign key (mission_work_item_id, mission_workflow_id, workspace_id)\n    references public.mission_work_items(id, mission_workflow_id, workspace_id)",
      "foreign key (mission_review_round_id, workspace_id)\n    references public.mission_review_rounds(id, workspace_id)",
    ]) {
      expect(sql, `missing tenant relationship: ${relationship}`).toContain(relationship);
    }

    for (const policy of [
      "mission_templates_creator_read",
      "mission_requirements_creator_read",
      "mission_workflows_creator_read",
      "mission_work_items_creator_read",
      "mission_working_drafts_creator_read",
      "mission_versions_creator_read",
      "mission_assets_creator_read",
      "mission_reviews_creator_read",
      "mission_review_items_creator_read",
      "mission_revision_grants_creator_read",
      "mission_fulfillments_creator_read",
      "mission_events_creator_read",
    ]) {
      const start = sql.lastIndexOf(`create policy ${policy}`);
      const end = sql.indexOf(";", start);
      expect(start, `missing policy: ${policy}`).toBeGreaterThanOrEqual(0);
      expect(sql.slice(start, end), `${policy} must scope ownership joins by workspace_id`).toContain("workspace_id");
    }

    for (const fn of [
      "private.refresh_mission_workflow_state",
      "private.create_mission_workflow",
      "public.refresh_mission_workflow_state",
      "public.create_mission_workflow",
    ]) {
      const start = sql.lastIndexOf(`create or replace function ${fn}`);
      const end = sql.indexOf("\n$$;", start);
      expect(sql.slice(start, end), `${fn} must scope lookups by workspace_id`).toContain("workspace_id");
    }
    expect(sql.match(/i\.mission_workflow_id = v_workflow\.id\s+and i\.workspace_id = v_workflow\.workspace_id/g)).toHaveLength(3);
    expect(sql).toContain("f.mission_workflow_id = v_workflow.id\n      and f.workspace_id = v_workflow.workspace_id");
    expect(sql).toContain("where id = v_workflow.id and workspace_id = v_workflow.workspace_id");
  });

  it("denies execution on every current and future private function", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260715163350_active_mission_workspace.sql"), "utf8").toLowerCase().replace(/\r\n/g, "\n");

    expect(sql).toContain("alter default privileges for role postgres revoke execute on functions from public, anon, authenticated");
    expect(sql).toContain("alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated");
    for (const signature of [
      "private.refresh_mission_workflow_state(uuid)",
      "private.create_mission_workflow(uuid)",
      "private.raise_immutable_record()",
      "private.guard_completed_review_round()",
      "private.guard_finalized_mission_asset()",
      "private.guard_mission_draft_asset_owner()",
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated, service_role`);
    }
    expect(sql).toContain("private_function_execute_exposed");
  });

  it("requires relationally scoped canonical draft-asset object paths", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260715163350_active_mission_workspace.sql"), "utf8").toLowerCase().replace(/\r\n/g, "\n");
    const canonicalPath = "creator_id::text || '/' || mission_workflow_id::text || '/' || mission_work_item_id::text || '/' || id::text || '.' || file_extension";

    expect(sql).toContain("mission_workflow_id uuid not null");
    expect(sql).toContain("file_extension text not null");
    expect(sql).toContain(`storage_object_path = ${canonicalPath}`);
    expect(sql).toContain("foreign key (creator_id, workspace_id)\n    references public.creators(id, workspace_id)");
    expect(sql).toContain("foreign key (mission_work_item_id, mission_workflow_id, workspace_id)\n    references public.mission_work_items(id, mission_workflow_id, workspace_id)");
    expect(sql).toContain("create constraint trigger mission_draft_assets_owner_guard");
    expect(sql).toContain("execute function private.guard_mission_draft_asset_owner()");
    expect(sql).toContain("s.creator_id = new.creator_id");
    expect(sql).toContain("s.workspace_id = new.workspace_id");
    for (const policy of ["read", "insert", "update", "delete"]) {
      const start = sql.lastIndexOf(`create policy mission_draft_assets_storage_${policy}`);
      const end = sql.indexOf(";", start);
      const definition = sql.slice(start, end);
      expect(definition).toContain("a.creator_id::text || '/' || a.mission_workflow_id::text");
      expect(definition).toContain("a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension");
      expect(definition).toContain("join public.mission_work_items i");
      expect(definition).toContain("join public.mission_workflows w");
      expect(definition).toContain("join public.mission_submissions s");
      expect(definition).toContain("s.creator_id = a.creator_id");
      expect(definition).toContain("s.workspace_id = a.workspace_id");
    }
  });
  it("hardens backfill replay, canonical queue ordering, and notification retry", () => {
    const sql = readFileSync(
      resolve("supabase/migrations/20260731140000_reward_handoff_release_hardening.sql"),
      "utf8",
    );
    expect(sql).toContain("backfill_idempotency_key");
    expect(sql).toContain("backfill_request_hash");
    expect(sql).toContain("unique (workspace_id, backfill_idempotency_key)");
    expect(sql).toContain("idempotency_conflict");
    expect(sql).toMatch(/jsonb_build_array\(\s*'reward_contract_backfill',\s*p_workspace,\s*p_operator,/);
    expect(sql).toContain("p_notification_type = 'mission_reward_pending' and pending.status = 'pending'");
    expect(sql).toContain("p_notification_type = 'mission_reward_pending_cancelled' and pending.status = 'cancelled'");
    expect(sql).toContain("retry_reward_handoff_notification");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("grant execute on function public.retry_reward_handoff_notification");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("revoke all");
    const runbook = readFileSync(resolve("docs/operations/reward-handoff.md"), "utf8");
    expect(runbook).toContain(`    curl.exe --fail-with-body -X POST "$ADFOCATE_BASE_URL/api/admin/reward-handoffs/$PENDING_REWARD_ID/notifications/retry" -H "Authorization: Bearer $STAFF_ACCESS_TOKEN" -H "X-Workspace-Slug: $WORKSPACE_SLUG" -H "Content-Type: application/json" --data ('{"notificationType":"{0}"}' -f $NOTIFICATION_TYPE)`);
  });});

// Immutable workflow history is intentionally not deleted in-test. The integration harness
// resets its disposable local database, while full UUIDs keep each fixture isolated until reset.
suite(suiteName, () => {
  it("creates one idempotent active workflow without changing the reward anchor", async () => {
    const id = unique();
    const { mission, creator, submission } = await seedActiveMission({
      email: `active-schema-${id}@test.local`,
      slug: `test-active-schema-${id}`,
      fulfillmentRequired: false,
      deliverables: [{
        title: "Instagram Reel",
        platform: "instagram",
        required: true,
        requirements: [{ category: "compliance", text: "Show the required disclosure" }],
      }],
    });
    const before = await creatorRewardSnapshot(creator.id);
    const user = userForJwt(creator.jwt);

    const first = await user.rpc("create_mission_workflow", { p_submission: submission.id });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ state: "drafting", mission_submission_id: submission.id });

    const second = await user.rpc("create_mission_workflow", { p_submission: submission.id });
    expect(second.error).toBeNull();
    expect(second.data.id).toBe(first.data.id);

    const svc = serviceForTests();
    const [anchor, items, drafts, events] = await Promise.all([
      svc.from("mission_submissions").select("status, xp_awarded, points_awarded").eq("id", submission.id).single(),
      svc.from("mission_work_items").select("id, state, title, platform, requirements_snapshot").eq("mission_workflow_id", first.data.id),
      svc.from("mission_working_drafts").select("id, mission_work_item_id, revision"),
      svc.from("mission_workflow_events").select("event_type").eq("mission_workflow_id", first.data.id),
    ]);
    expect(anchor.error).toBeNull();
    expect(anchor.data).toEqual({ status: "joined", xp_awarded: 0, points_awarded: 0 });
    expect(items.error).toBeNull();
    expect(items.data).toHaveLength(1);
    expect(items.data?.[0]).toMatchObject({ state: "drafting", title: "Instagram Reel", platform: "instagram" });
    expect(drafts.data?.filter((draft) => draft.mission_work_item_id === items.data?.[0].id)).toHaveLength(1);
    expect(events.data).toEqual([{ event_type: "workflow_created" }]);
    expect(await creatorRewardSnapshot(creator.id)).toEqual(before);
    expect(mission.creator_workflow_mode).toBe("active_workspace");
  });

  it("starts fulfilment-required work blocked and keeps the private bucket private", async () => {
    const id = unique();
    const { creator, submission } = await seedActiveMission({
      email: `active-fulfillment-${id}@test.local`,
      slug: `test-active-fulfillment-${id}`,
      fulfillmentRequired: true,
      deliverables: [{ title: "Unboxing Reel", platform: "instagram", required: true }],
    });
    const result = await userForJwt(creator.jwt).rpc("create_mission_workflow", { p_submission: submission.id });
    expect(result.error).toBeNull();
    expect(result.data.state).toBe("fulfillment_pending");

    const svc = serviceForTests();
    const [fulfilment, items, bucket] = await Promise.all([
      svc.from("mission_fulfillments").select("status").eq("mission_workflow_id", result.data.id).single(),
      svc.from("mission_work_items").select("state").eq("mission_workflow_id", result.data.id),
      svc.storage.getBucket("mission-draft-assets"),
    ]);
    expect(fulfilment.data?.status).toBe("preparing");
    expect(items.data).toEqual([{ state: "blocked_by_fulfillment" }]);
    expect(bucket.error).toBeNull();
    expect(bucket.data).toMatchObject({ public: false, file_size_limit: 20 * 1024 * 1024 });
    expect(bucket.data?.allowed_mime_types).toEqual(expect.arrayContaining(["image/jpeg", "image/png", "video/mp4"]));
  });

  it("allows creator self-read only and protects append-only records", async () => {
    const id = unique();
    const own = await seedActiveMission({
      email: `active-owner-${id}@test.local`,
      slug: `test-active-owner-${id}`,
      deliverables: [{ title: "Story", platform: "instagram" }],
    });
    const other = await seedActiveMission({
      email: `active-other-${id}@test.local`,
      slug: `test-active-other-${id}`,
      deliverables: [{ title: "Video", platform: "tiktok" }],
    });
    const ownWorkflow = await userForJwt(own.creator.jwt).rpc("create_mission_workflow", { p_submission: own.submission.id });
    await userForJwt(other.creator.jwt).rpc("create_mission_workflow", { p_submission: other.submission.id });

    const ownRows = await userForJwt(own.creator.jwt).from("mission_workflows").select("id");
    expect(ownRows.error).toBeNull();
    expect(ownRows.data).toEqual([{ id: ownWorkflow.data.id }]);

    const svc = serviceForTests();
    const event = await svc.from("mission_workflow_events").select("id").eq("mission_workflow_id", ownWorkflow.data.id).single();
    const mutation = await svc.from("mission_workflow_events").update({ event_type: "tampered" }).eq("id", event.data!.id);
    expect(mutation.error?.message).toContain("immutable_record");
    const deletion = await svc.from("mission_workflow_events").delete().eq("id", event.data!.id);
    expect(deletion.error?.message).toContain("immutable_record");
  });
  it("preserves terminal state and rejects cross-owner create", async () => {
    const id = unique();
    const own = await seedActiveMission({
      email: `active-terminal-${id}@test.local`,
      slug: `test-active-terminal-${id}`,
      deliverables: [{ title: "Post", platform: "instagram" }],
    });
    const other = await seedActiveMission({
      email: `active-terminal-other-${id}@test.local`,
      slug: `test-active-terminal-other-${id}`,
      deliverables: [{ title: "Post", platform: "instagram" }],
    });
    const ownUser = userForJwt(own.creator.jwt);
    const created = await ownUser.rpc("create_mission_workflow", { p_submission: own.submission.id });
    expect(created.error).toBeNull();

    const crossCreate = await ownUser.rpc("create_mission_workflow", { p_submission: other.submission.id });
    expect(crossCreate.error?.message).toContain("not_found");

    const svc = serviceForTests();
    const terminal = await svc.from("mission_workflows").update({ state: "cancelled" }).eq("id", created.data.id);
    expect(terminal.error).toBeNull();

    const refreshed = await ownUser.rpc("refresh_mission_workflow_state", { p_workflow: created.data.id });
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.state).toBe("cancelled");
    const retried = await ownUser.rpc("create_mission_workflow", { p_submission: own.submission.id });
    expect(retried.error).toBeNull();
    expect(retried.data.state).toBe("cancelled");
  });

  it("rejects linking a draft version to another work item", async () => {
    const id = unique();
    const first = await seedActiveMission({
      email: `active-fk-first-${id}@test.local`,
      slug: `test-active-fk-first-${id}`,
      deliverables: [{ title: "First", platform: "instagram" }],
    });
    const second = await seedActiveMission({
      email: `active-fk-second-${id}@test.local`,
      slug: `test-active-fk-second-${id}`,
      deliverables: [{ title: "Second", platform: "tiktok" }],
    });
    const firstWorkflow = await userForJwt(first.creator.jwt).rpc("create_mission_workflow", { p_submission: first.submission.id });
    const secondWorkflow = await userForJwt(second.creator.jwt).rpc("create_mission_workflow", { p_submission: second.submission.id });
    const svc = serviceForTests();
    const firstItem = await svc.from("mission_work_items").select("id, workspace_id").eq("mission_workflow_id", firstWorkflow.data.id).single();
    const secondItem = await svc.from("mission_work_items").select("id").eq("mission_workflow_id", secondWorkflow.data.id).single();
    const version = await svc.from("mission_draft_versions").insert({
      workspace_id: firstItem.data!.workspace_id,
      mission_work_item_id: firstItem.data!.id,
      version_number: 1,
      submitted_by: first.creator.id,
      content_checksum: `checksum-${id}`,
    }).select("id").single();
    expect(version.error).toBeNull();

    const crossLink = await svc.from("mission_work_items")
      .update({ current_submitted_version_id: version.data!.id })
      .eq("id", secondItem.data!.id);
    expect(crossLink.error?.code).toBe("23503");
  });
});

suite(suiteName, () => {
  it("rejects cross-workspace relationships, access, and asset scopes", async () => {
    const id = unique();
    const svc = serviceForTests();
    const alternateWorkspaceId = unique();
    const workspace = await svc.from("workspaces").insert({
      id: alternateWorkspaceId,
      slug: `test-active-cross-${id}`,
      name: `test-active-cross-${id}`,
    });
    expect(workspace.error).toBeNull();

    const crossCreator = await makeCreator(`active-cross-${id}@test.local`, 0);
    const moveCreator = await svc.from("creators")
      .update({ workspace_id: alternateWorkspaceId })
      .eq("id", crossCreator.userId);
    expect(moveCreator.error).toBeNull();

    const crossMission = await svc.from("missions").insert({
      workspace_id: alternateWorkspaceId,
      slug: `test-active-cross-${id}`,
      title: `test-active-cross-${id}`,
      mission_type: "ugc",
      access_type: "open",
      points_reward: 0,
      quota: 1,
      status: "active",
      required_level: "L0",
      creator_workflow_mode: "active_workspace",
      fulfillment_required: false,
    }).select("id").single();
    expect(crossMission.error).toBeNull();
    const crossTemplate = await svc.from("mission_deliverable_templates").insert({
      workspace_id: alternateWorkspaceId,
      mission_id: crossMission.data!.id,
      title: "Cross-workspace post",
      platform: "instagram",
      position: 0,
      required: true,
    });
    expect(crossTemplate.error).toBeNull();
    const crossSubmission = await svc.from("mission_submissions").insert({
      workspace_id: alternateWorkspaceId,
      mission_id: crossMission.data!.id,
      creator_id: crossCreator.userId,
      status: "joined",
    }).select("id").single();
    expect(crossSubmission.error).toBeNull();
    const crossWorkflow = await userForJwt(crossCreator.jwt)
      .rpc("create_mission_workflow", { p_submission: crossSubmission.data!.id });
    expect(crossWorkflow.error).toBeNull();

    const own = await seedActiveMission({
      email: `active-cross-owner-${id}@test.local`,
      slug: `test-active-cross-owner-${id}`,
      deliverables: [{ title: "Owned post", platform: "instagram" }],
    });
    const ownUser = userForJwt(own.creator.jwt);
    const ownWorkflow = await ownUser.rpc("create_mission_workflow", { p_submission: own.submission.id });
    expect(ownWorkflow.error).toBeNull();
    const ownItem = await svc.from("mission_work_items")
      .select("id, workspace_id")
      .eq("mission_workflow_id", ownWorkflow.data.id)
      .single();
    expect(ownItem.error).toBeNull();

    const sameWorkspaceCreator = await makeCreator(`active-same-workspace-${id}@test.local`, 0);

    const hidden = await ownUser.from("mission_workflows")
      .select("id")
      .eq("id", crossWorkflow.data.id);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
    const deniedRefresh = await ownUser.rpc("refresh_mission_workflow_state", {
      p_workflow: crossWorkflow.data.id,
    });
    expect(deniedRefresh.error?.message).toContain("not_found");

    const crossWorkspaceItem = await svc.from("mission_work_items").insert({
      workspace_id: alternateWorkspaceId,
      mission_workflow_id: ownWorkflow.data.id,
      title: "Invalid cross-workspace item",
      platform: "instagram",
      required: true,
      position: 99,
      state: "drafting",
    });
    expect(crossWorkspaceItem.error?.code).toBe("23503");

    const malformedAssetId = unique();
    const malformedPath = await svc.from("mission_draft_assets").insert({
      id: malformedAssetId,
      workspace_id: ownItem.data!.workspace_id,
      mission_workflow_id: ownWorkflow.data.id,
      mission_work_item_id: ownItem.data!.id,
      creator_id: own.creator.id,
      file_extension: "png",
      storage_object_path: `not-canonical-${malformedAssetId}.png`,
      original_filename: "draft.png",
      mime_type: "image/png",
      byte_size: 1024,
    });
    expect(malformedPath.error?.code).toBe("23514");

    const sameWorkspaceAssetId = unique();
    const sameWorkspaceCreatorAsset = await svc.from("mission_draft_assets").insert({
      id: sameWorkspaceAssetId,
      workspace_id: ownItem.data!.workspace_id,
      mission_workflow_id: ownWorkflow.data.id,
      mission_work_item_id: ownItem.data!.id,
      creator_id: sameWorkspaceCreator.userId,
      file_extension: "png",
      storage_object_path: `${sameWorkspaceCreator.userId}/${ownWorkflow.data.id}/${ownItem.data!.id}/${sameWorkspaceAssetId}.png`,
      original_filename: "draft.png",
      mime_type: "image/png",
      byte_size: 1024,
    });
    expect(sameWorkspaceCreatorAsset.error?.code).toBe("23514");
    expect(sameWorkspaceCreatorAsset.error?.message)
      .toContain("mission_draft_asset_owner_mismatch");

    const crossCreatorAssetId = unique();
    const crossCreatorAsset = await svc.from("mission_draft_assets").insert({
      id: crossCreatorAssetId,
      workspace_id: ownItem.data!.workspace_id,
      mission_workflow_id: ownWorkflow.data.id,
      mission_work_item_id: ownItem.data!.id,
      creator_id: crossCreator.userId,
      file_extension: "png",
      storage_object_path: `${crossCreator.userId}/${ownWorkflow.data.id}/${ownItem.data!.id}/${crossCreatorAssetId}.png`,
      original_filename: "draft.png",
      mime_type: "image/png",
      byte_size: 1024,
    });
    expect(crossCreatorAsset.error?.code).toBe("23503");
  });
});

suite(suiteName, () => {
  it("enforces publication proof tenant ownership, immutability, privacy, and relationships", async () => {
    const id = unique();
    const svc = serviceForTests();
    const own = await seedActiveMission({
      email: `publication-owner-${id}@test.local`,
      slug: `test-publication-owner-${id}`,
      deliverables: [{
        title: "Publication proof post",
        platform: "instagram",
        publicationInstructions: "Publish the approved reel with the required disclosure",
        publicationWindowHours: 48,
        requiredDisclosures: ["#ad"],
        expectedAccount: "@test_creator",
        proofEvidencePolicy: { screenshots: 1 },
      }],
    });
    const ownUser = userForJwt(own.creator.jwt);
    const workflow = await ownUser.rpc("create_mission_workflow", { p_submission: own.submission.id });
    expect(workflow.error).toBeNull();
    const item = await svc.from("mission_work_items")
      .select("id, workspace_id")
      .eq("mission_workflow_id", workflow.data.id)
      .single();
    expect(item.error).toBeNull();

    const alternateWorkspaceId = unique();
    const alternateWorkspace = await svc.from("workspaces").insert({
      id: alternateWorkspaceId,
      slug: `test-publication-cross-${id}`,
      name: `test-publication-cross-${id}`,
    });
    expect(alternateWorkspace.error).toBeNull();
    const other = await makeCreator(`publication-other-${id}@test.local`, 0);
    const moveCreator = await svc.from("creators")
      .update({ workspace_id: alternateWorkspaceId })
      .eq("id", other.userId);
    expect(moveCreator.error).toBeNull();
    const otherUser = userForJwt(other.jwt);

    const instruction = await svc.from("mission_publication_instructions")
      .select("id, publication_instructions, publication_window_hours, required_disclosures, expected_account, proof_evidence_policy")
      .eq("mission_work_item_id", item.data!.id)
      .single();
    expect(instruction.error).toBeNull();
    expect(instruction.data).toMatchObject({
      publication_instructions: "Publish the approved reel with the required disclosure",
      publication_window_hours: 48,
      required_disclosures: ["#ad"],
      expected_account: "@test_creator",
      proof_evidence_policy: { screenshots: 1 },
    });
    const duplicateInstruction = await svc.from("mission_publication_instructions").insert({
      workspace_id: item.data!.workspace_id,
      mission_work_item_id: item.data!.id,
      publication_instructions: "Duplicate",
      publication_window_hours: 48,
      required_disclosures: [],
      proof_evidence_policy: {},
      publication_due_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(duplicateInstruction.error?.code).toBe("23505");

    const attempt = await svc.from("mission_publication_proof_attempts").insert({
      workspace_id: item.data!.workspace_id,
      mission_work_item_id: item.data!.id,
      attempt_number: 1,
      primary_url: "https://example.com/proof",
      additional_urls: [],
      submitted_by: own.creator.id,
      submitted_late: false,
      metadata_status: "available",
      metadata_snapshot: { account: "@test_creator" },
      content_checksum: `publication-proof-${id}`,
      submission_idempotency_key: unique(),
    }).select("id").single();
    expect(attempt.error).toBeNull();
    const crossWorkspaceAttempt = await svc.from("mission_publication_proof_attempts").insert({
      workspace_id: alternateWorkspaceId,
      mission_work_item_id: item.data!.id,
      attempt_number: 2,
      primary_url: "https://example.com/cross-workspace-proof",
      additional_urls: [],
      submitted_by: other.userId,
      submitted_late: false,
      metadata_status: "unavailable",
      metadata_snapshot: {},
      content_checksum: `publication-cross-${id}`,
      submission_idempotency_key: unique(),
    });
    expect(crossWorkspaceAttempt.error?.code).toBe("23503");

    const pointAtAttempt = await svc.from("mission_work_items")
      .update({ current_proof_attempt_id: attempt.data!.id })
      .eq("id", item.data!.id);
    expect(pointAtAttempt.error).toBeNull();

    const assetId = unique();
    const objectPath = `${own.creator.id}/${workflow.data.id}/${item.data!.id}/proof-evidence/${assetId}.jpg`;
    const asset = await svc.from("mission_publication_proof_assets").insert({
      id: assetId,
      workspace_id: item.data!.workspace_id,
      mission_publication_proof_attempt_id: attempt.data!.id,
      mission_submission_id: own.submission.id,
      mission_workflow_id: workflow.data.id,
      mission_work_item_id: item.data!.id,
      creator_id: own.creator.id,
      storage_object_path: objectPath,
      original_filename: "proof.jpg",
      mime_type: "image/jpeg",
      byte_size: 5,
      upload_state: "pending",
      upload_grant_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      content_checksum: `asset-${id}`,
    });
    expect(asset.error).toBeNull();
    const crossWorkspaceAsset = await svc.from("mission_publication_proof_assets").insert({
      workspace_id: alternateWorkspaceId,
      mission_publication_proof_attempt_id: attempt.data!.id,
      storage_object_path: `${other.userId}/${attempt.data!.id}/${unique()}.jpg`,
      original_filename: "cross-proof.jpg",
      mime_type: "image/jpeg",
      byte_size: 5,
      content_checksum: `cross-asset-${id}`,
    });
    expect(crossWorkspaceAsset.error?.code).toBe("23503");

    const creatorReview = await svc.from("mission_publication_proof_reviews").insert({
      workspace_id: item.data!.workspace_id,
      mission_publication_proof_attempt_id: attempt.data!.id,
      decision: "verified",
      reviewer_id: own.creator.id,
      summary: "Creator identities cannot review publication proof",
    });
    expect(creatorReview.error?.code).toBe("23503");

    const foreignWorkspaceOperator = await makeBrand(`publication-foreign-reviewer-${id}@test.local`);
    const foreignWorkspaceReview = await svc.from("mission_publication_proof_reviews").insert({
      workspace_id: item.data!.workspace_id,
      mission_publication_proof_attempt_id: attempt.data!.id,
      decision: "verified",
      reviewer_id: foreignWorkspaceOperator.userId,
      summary: "Foreign-workspace operators cannot review publication proof",
    });
    expect(foreignWorkspaceReview.error?.code).toBe("23503");

    const sameWorkspaceOperator = await makeBrand(
      `publication-reviewer-${id}@test.local`,
      item.data!.workspace_id,
      "member",
    );
    const review = await svc.from("mission_publication_proof_reviews").insert({
      workspace_id: item.data!.workspace_id,
      mission_publication_proof_attempt_id: attempt.data!.id,
      decision: "verified",
      reviewer_id: sameWorkspaceOperator.userId,
      summary: "Publication proof verified",
    }).select("id").single();
    expect(review.error).toBeNull();
    const duplicateTerminalReview = await svc.from("mission_publication_proof_reviews").insert({
      workspace_id: item.data!.workspace_id,
      mission_publication_proof_attempt_id: attempt.data!.id,
      decision: "rejected",
      reviewer_id: own.creator.id,
      summary: "Duplicate terminal decision",
    });
    expect(duplicateTerminalReview.error?.code).toBe("23505");
    const reviewItem = await svc.from("mission_publication_proof_review_items").insert({
      workspace_id: item.data!.workspace_id,
      mission_publication_proof_review_id: review.data!.id,
      category: "disclosure",
      finding_text: "Required disclosure is visible",
      passed: true,
      position: 0,
    });
    expect(reviewItem.error).toBeNull();

    const [ownAttempts, hiddenAttempts, relationship] = await Promise.all([
      ownUser.from("mission_publication_proof_attempts").select("id"),
      otherUser.from("mission_publication_proof_attempts").select("id"),
      svc.from("mission_publication_proof_attempts").select(
        "id, mission_work_items!mission_publication_proof_attempts_work_item_workspace_fk(id), mission_publication_proof_reviews(id)",
      ).eq("id", attempt.data!.id).single(),
    ]);
    expect(ownAttempts.error).toBeNull();
    expect(ownAttempts.data).toEqual([{ id: attempt.data!.id }]);
    expect(hiddenAttempts.error).toBeNull();
    expect(hiddenAttempts.data).toEqual([]);
    expect(relationship.error).toBeNull();
    expect(relationship.data).toMatchObject({ id: attempt.data!.id });

    const [authenticatedAttemptUpdate, authenticatedAttemptDelete, authenticatedReviewUpdate, authenticatedReviewDelete] = await Promise.all([
      ownUser.from("mission_publication_proof_attempts").update({ content_checksum: "tampered" }).eq("id", attempt.data!.id),
      ownUser.from("mission_publication_proof_attempts").delete().eq("id", attempt.data!.id),
      ownUser.from("mission_publication_proof_reviews").update({ summary: "tampered" }).eq("id", review.data!.id),
      ownUser.from("mission_publication_proof_reviews").delete().eq("id", review.data!.id),
    ]);
    for (const mutation of [authenticatedAttemptUpdate, authenticatedAttemptDelete, authenticatedReviewUpdate, authenticatedReviewDelete]) {
      expect(mutation.error).not.toBeNull();
    }
    const serviceAttemptMutation = await svc.from("mission_publication_proof_attempts")
      .update({ content_checksum: "service-tampered" })
      .eq("id", attempt.data!.id);
    expect(serviceAttemptMutation.error?.message).toContain("immutable_record");
    const serviceReviewDeletion = await svc.from("mission_publication_proof_reviews")
      .delete()
      .eq("id", review.data!.id);
    expect(serviceReviewDeletion.error?.message).toContain("immutable_record");

    const bucket = await svc.storage.getBucket("mission-publication-proof-assets");
    expect(bucket.error).toBeNull();
    expect(bucket.data).toMatchObject({ public: false });
    const proofBytes = new Uint8Array([112, 114, 111, 111, 102]);
    const deniedUpload = await otherUser.storage.from("mission-publication-proof-assets")
      .upload(objectPath, proofBytes, { contentType: "image/jpeg" });
    expect(deniedUpload.error).not.toBeNull();
    const upload = await ownUser.storage.from("mission-publication-proof-assets")
      .upload(objectPath, proofBytes, { contentType: "image/jpeg" });
    expect(upload.error).toBeNull();
    const finalizeAsset = await svc.from("mission_publication_proof_assets")
      .update({
        upload_state: "finalized",
        finalized_at: new Date().toISOString(),
      })
      .eq("id", assetId);
    expect(finalizeAsset.error).toBeNull();
    const ownEvidence = await ownUser.storage.from("mission-publication-proof-assets").download(objectPath);
    expect(ownEvidence.error).toBeNull();
    const hiddenEvidence = await otherUser.storage.from("mission-publication-proof-assets").download(objectPath);
    expect(hiddenEvidence.error).not.toBeNull();
    await svc.storage.from("mission-publication-proof-assets").remove([objectPath]);
  });
});

describe("publication proof asset rollout policy", () => {
  it("aligns the proof asset table and private bucket with the seven-type Phase 2 MIME contract", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260729010000_align_publication_proof_asset_mime_contract.sql"), "utf8");
    for (const mimeType of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/quicktime",
      "video/webm",
    ]) {
      expect(sql).toContain(mimeType);
    }
    expect(sql).toContain("drop constraint if exists mission_publication_proof_assets_mime_type_check");
    expect(sql).toContain("allowed_mime_types = excluded.allowed_mime_types");
    expect(sql).not.toContain("application/pdf");
  });

  it("uses the Phase 2 MIME map and workflow-scoped canonical path", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260725110000_publication_proof_asset_policy.sql"), "utf8");
    expect(sql).toContain("video/quicktime");
    expect(sql).toContain("video/webm");
    expect(sql).toContain("v_workflow.id::text||'/'||p_work_item::text");
    expect(sql).toContain("if v_asset.id is not null then return v_asset");
  });
  it("assigns unique migration versions in the publication-proof asset guard order", () => {
    const migrations = readdirSync(resolve("supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const versions = migrations.map((name) => name.split("_", 1)[0]);
    const mutationGuards = migrations.findIndex((name) => name.endsWith("publication_proof_asset_mutation_guards.sql"));
    const lifecycleGuards = migrations.findIndex((name) => name.endsWith("publication_proof_asset_guards.sql"));
    const publicGuards = migrations.findIndex((name) => name.endsWith("publication_proof_public_guards.sql"));

    expect(new Set(versions).size).toBe(versions.length);
    expect(mutationGuards).toBeGreaterThanOrEqual(0);
    expect(lifecycleGuards).toBeGreaterThan(mutationGuards);
    expect(publicGuards).toBeGreaterThan(lifecycleGuards);
  });
});

describe("publication proof lifecycle guards", () => {
  it("restricts states and makes staging concurrent-safe", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260725140000_publication_proof_asset_guards.sql"), "utf8");
    expect(sql).toContain("v_item.state not in ('approved_to_publish','proof_correction_requested')");
    expect(sql).toContain("on conflict (storage_object_path) do nothing");
    expect(sql).toContain("idempotency_conflict");
  });
});

describe("publication proof public RPC guards", () => {
  it("guards the active callable create and finalize functions", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260725143000_publication_proof_public_guards.sql"), "utf8");
    expect(sql).toContain("create or replace function public.create_publication_proof_asset");
    expect(sql).toContain("create or replace function public.finalize_publication_proof_asset");
    expect(sql).toContain("proof_correction_requested");
  });
});

describe("publication proof immutable submit transaction", () => {
  it("defines one guarded atomic submit RPC without reward or legacy mutations", () => {
    const sql = readFileSync(
      resolve("supabase/migrations/20260723090000_publication_proof_validation.sql"),
      "utf8",
    ).toLowerCase().replace(/\r\n/g, "\n");
    const start = sql.indexOf("create or replace function public.submit_mission_publication_proof");
    const submit = sql.slice(start);
    expect(start).toBeGreaterThanOrEqual(0);
    for (const token of [
      "p_submission uuid", "p_creator uuid", "p_workspace uuid", "p_work_item uuid",
      "p_expected_state text", "p_expected_revision integer", "p_idempotency_key uuid",
      "p_proof jsonb", "p_evidence_asset_ids uuid[]", "for update",
      "mission_publication_proof_attempts", "mission_publication_proof_reviews",
      "current_proof_attempt_id", "submitted_late", "content_checksum",
      "mission_publication_proof_submitted", "refresh_mission_workflow_state",
      "proof_correction_requested", "publication_due_at", "evidence_required",
      "creator_id = p_creator", "submission_idempotency_key",
      "current_publication",
    ]) expect(submit, `missing immutable submit token: ${token}`).toContain(token);
    expect(submit).toMatch(/attempt_number[\s\S]*coalesce\(max\([^)]*attempt_number/);
    expect(submit).toMatch(/upload_state\s*=\s*'finalized'/);
    expect(submit).toMatch(/mission_publication_proof_attempt_id\s+is\s+null/);
    expect(submit).not.toMatch(/update\s+public\.mission_submissions\s+set\s+status/);
    expect(submit).not.toMatch(/update\s+public\.(point_balances|earnings_balances)/);
    expect(submit).not.toMatch(/update\s+public\.creators\s+set\s+xp/);
  });
});

describe("publication proof operator review lifecycle", () => {
  const migrationSql = () => readFileSync(
    resolve("supabase/migrations/20260723090000_publication_proof_validation.sql"),
    "utf8",
  ).toLowerCase().replace(/\r\n/g, "\n");
  const functionSource = (sql: string, qualifiedName: string) => {
    const start = sql.indexOf(`create or replace function ${qualifiedName}(`);
    const next = sql.indexOf("create or replace function ", start + 1);
    expect(start, `${qualifiedName} definition`).toBeGreaterThanOrEqual(0);
    return sql.slice(start, next < 0 ? undefined : next);
  };

  it("defines guarded exact-attempt claim, correction, and verification RPCs", () => {
    const sql = migrationSql();
    for (const name of [
      "start_publication_proof_review",
      "request_publication_proof_correction",
      "verify_publication_proof",
    ]) {
      const rpc = functionSource(sql, `public.${name}`);
      for (const parameter of [
        "p_workspace uuid",
        "p_workflow uuid",
        "p_work_item uuid",
        "p_attempt uuid",
        "p_expected_state text",
        "p_expected_revision integer",
        "p_operator uuid",
        "p_idempotency_key uuid",
      ]) expect(rpc, `${name} missing ${parameter}`).toContain(parameter);
      expect(rpc).toContain("security definer set search_path = ''");
      expect(rpc).toContain("auth.jwt()");
      expect(rpc).toContain("private.assert_active_mission_operator");
      expect(sql).toContain(`grant execute on function public.${name}`);
      expect(sql).toContain(`revoke all on function public.${name}`);
    }
  });

  it("locks the canonical rows and enforces current-attempt claim ownership", () => {
    const sql = migrationSql();
    const start = functionSource(sql, "private.start_publication_proof_review");
    const correction = functionSource(sql, "private.request_publication_proof_correction");
    const verify = functionSource(sql, "private.verify_publication_proof");
    for (const source of [start, correction, verify]) {
      expect(source).toContain("from public.mission_workflows");
      expect(source).toContain("from public.mission_work_items");
      expect(source).toContain("from public.mission_publication_instructions");
      expect(source).toContain("from public.mission_publication_proof_attempts");
      expect(source).toContain("from public.mission_publication_proof_reviews");
      expect(source.match(/for update/g)?.length).toBeGreaterThanOrEqual(5);
      expect(source).toContain("current_proof_attempt_id");
      expect(source).toContain("p_attempt");
      expect(source).toContain("p_expected_revision");
    }
    expect(start).toContain("state = 'proof_under_review'");
    expect(start).toContain("current_reviewer_id = p_operator");
    expect(start).toContain("claim_idempotency_key");
    expect(correction).toContain("reviewer_id <> p_operator");
    expect(verify).toContain("reviewer_id <> p_operator");
  });

  it("requires the six-key checklist and categorized non-blank corrections", () => {
    const sql = migrationSql();
    const correction = functionSource(sql, "private.request_publication_proof_correction");
    const verify = functionSource(sql, "private.verify_publication_proof");
    for (const key of [
      "publicly_accessible",
      "platform_matches",
      "account_matches",
      "content_matches_approved_version",
      "timing_acceptable",
      "disclosures_present",
    ]) {
      expect(correction).toContain(`'${key}'`);
      expect(verify).toContain(`'${key}'`);
    }
    for (const category of [
      "access", "platform", "account", "content", "timing", "disclosure", "evidence", "other",
    ]) expect(correction).toContain(`'${category}'`);
    expect(correction).toContain("coalesce(item->>'category', '') not in");
    expect(correction).toContain("jsonb_array_length(p_items) = 0");
    expect(correction).toContain("select count(*) from jsonb_object_keys(p_checklist)");
    expect(correction + verify).not.toContain("jsonb_object_length");
    expect(correction).toContain("p_checklist is null");
    expect(correction).toContain("p_items is null");
    expect(correction).toContain("case when jsonb_typeof(item->'position') = 'number'");
    expect(correction).toContain("nullif(btrim(item->>'text'), '') is null");
    expect(verify).toContain("value <> 'true'::jsonb");
  });

  it("uses snapshotted SLAs, completes required aggregates, and stays reward-neutral", () => {
    const sql = migrationSql();
    const start = functionSource(sql, "private.start_publication_proof_review");
    const correction = functionSource(sql, "private.request_publication_proof_correction");
    const verify = functionSource(sql, "private.verify_publication_proof");
    expect(start).toContain("make_interval(hours => v_workflow.review_sla_hours)");
    expect(correction).toContain("v_now + make_interval(hours => v_workflow.revision_response_hours)");
    expect(correction).not.toContain("least(");
    expect(correction).toContain("state = 'proof_correction_requested'");
    expect(verify).toContain("verified_proof_attempt_id = p_attempt");
    expect(verify).toContain("state = 'proof_verified'");
    expect(verify).toContain("private.refresh_mission_workflow_state");
    expect(sql).toContain("v_state := 'proof_verified'");
    for (const source of [start, correction, verify]) {
      expect(source).not.toMatch(/update\s+public\.mission_submissions/);
      expect(source).not.toMatch(/update\s+public\.(point_balances|earnings_balances|workspace_budgets)/);
      expect(source).not.toMatch(/update\s+public\.creators\s+set\s+xp/);
    }
  });

  it("keeps mixed required verified and approved items in publication progress", () => {
    const refresh = functionSource(
      migrationSql(),
      "private.refresh_mission_workflow_state",
    );
    const allVerified = refresh.indexOf("v_state := 'proof_verified'");
    const inProgress = refresh.indexOf("v_state := 'publication_in_progress'");
    const approved = refresh.indexOf("v_state := 'approved_to_publish'");
    expect(allVerified).toBeGreaterThanOrEqual(0);
    expect(allVerified).toBeLessThan(inProgress);
    expect(inProgress).toBeLessThan(approved);
    const progressGuard = refresh.slice(refresh.lastIndexOf("elsif exists", inProgress), inProgress);
    expect(progressGuard).toContain("'proof_verified'");
  });
});

describe("publication proof correction checksum replay contract", () => {
  it("limits checksum replay to the current submitted attempt and emits a resubmission event", () => {
    const sql = readFileSync(
      resolve("supabase/migrations/20260723090000_publication_proof_validation.sql"),
      "utf8",
    ).toLowerCase().replace(/\r\n/g, "\n");
    const start = sql.indexOf("create or replace function public.submit_mission_publication_proof");
    const submit = sql.slice(start);
    const keyReplay = submit.indexOf("submission_idempotency_key = p_idempotency_key");
    const checksumReplay = submit.indexOf("attempt.content_checksum = v_content_checksum");
    const staleGuard = submit.indexOf("if v_item.state <> p_expected_state");

    expect(keyReplay).toBeGreaterThanOrEqual(0);
    expect(keyReplay).toBeLessThan(checksumReplay);
    expect(checksumReplay).toBeLessThan(staleGuard);
    expect(submit).toMatch(
      /attempt\.content_checksum\s*=\s*v_content_checksum[\s\S]*v_item\.state\s*=\s*'proof_submitted'[\s\S]*attempt\.id\s*=\s*v_item\.current_proof_attempt_id/,
    );
    expect(submit).toContain("'mission_publication_proof_resubmitted'");
    expect(submit).toMatch(
      /case\s+when\s+v_item\.state\s*=\s*'proof_correction_requested'[\s\S]*mission_publication_proof_resubmitted/,
    );
  });
});

suite(suiteName, () => {
  it("creates a new attempt when a correction resubmits an unchanged checksum", async () => {
    const id = unique();
    const svc = serviceForTests();
    const active = await seedActiveMission({
      email: `publication-resubmit-${id}@test.local`,
      slug: `test-publication-resubmit-${id}`,
      deliverables: [{
        title: "Correction checksum proof",
        platform: "instagram",
        publicationInstructions: "Publish the approved post",
        publicationWindowHours: 48,
        requiredDisclosures: [],
        proofEvidencePolicy: {},
      }],
    });
    const created = await userForJwt(active.creator.jwt).rpc(
      "create_mission_workflow",
      { p_submission: active.submission.id },
    );
    expect(created.error).toBeNull();
    const item = await svc.from("mission_work_items")
      .select("id, workspace_id")
      .eq("mission_workflow_id", created.data.id)
      .single();
    expect(item.error).toBeNull();
    const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    expect((await svc.from("mission_publication_instructions").update({
      publication_due_at: dueAt,
      frozen_at: new Date().toISOString(),
    }).eq("mission_work_item_id", item.data!.id)).error).toBeNull();
    expect((await svc.from("mission_work_items").update({
      state: "approved_to_publish",
    }).eq("id", item.data!.id)).error).toBeNull();

    const proof = {
      primary_url: "https://www.instagram.com/p/unchanged/",
      additional_urls: [],
      metadata_status: "unavailable",
      metadata_snapshot: {
        finalCanonicalUrl: "https://www.instagram.com/p/unchanged/",
        httpStatusCategory: "unknown",
        pageTitle: null,
        openGraphType: null,
        declaredPublicationTime: null,
        fetchedAt: new Date().toISOString(),
      },
      metadata_error_category: "platform_blocked",
    };
    const beforeRewards = await creatorRewardSnapshot(active.creator.id);
    const firstKey = unique();
    const submit = (state: string, key: string) => svc.rpc(
      "submit_mission_publication_proof",
      {
        p_submission: active.submission.id,
        p_creator: active.creator.id,
        p_workspace: item.data!.workspace_id,
        p_work_item: item.data!.id,
        p_expected_state: state,
        p_expected_revision: 0,
        p_idempotency_key: key,
        p_proof: proof,
        p_evidence_asset_ids: [],
      },
    );

    const first = await submit("approved_to_publish", firstKey);
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ attempt: { attempt_number: 1 }, idempotent: false });
    const exactRetry = await submit("approved_to_publish", firstKey);
    expect(exactRetry.error).toBeNull();
    expect(exactRetry.data).toMatchObject({
      attempt: { id: first.data.attempt.id, attempt_number: 1 },
      idempotent: true,
    });

    expect((await svc.from("mission_work_items").update({
      state: "proof_correction_requested",
    }).eq("id", item.data!.id)).error).toBeNull();
    const correction = await submit("proof_correction_requested", unique());
    expect(correction.error).toBeNull();
    expect(correction.data).toMatchObject({ attempt: { attempt_number: 2 }, idempotent: false });
    expect(correction.data.attempt.id).not.toBe(first.data.attempt.id);

    const [attempts, reviews, current, events] = await Promise.all([
      svc.from("mission_publication_proof_attempts").select("id, attempt_number, content_checksum")
        .eq("mission_work_item_id", item.data!.id).order("attempt_number"),
      svc.from("mission_publication_proof_reviews").select("mission_publication_proof_attempt_id, state")
        .eq("workspace_id", item.data!.workspace_id)
        .in("mission_publication_proof_attempt_id", [first.data.attempt.id, correction.data.attempt.id])
        .order("review_number"),
      svc.from("mission_work_items").select("state, current_proof_attempt_id").eq("id", item.data!.id).single(),
      svc.from("mission_workflow_events").select("event_type").eq("mission_work_item_id", item.data!.id)
        .in("event_type", ["mission_publication_proof_submitted", "mission_publication_proof_resubmitted"]),
    ]);
    expect(attempts.error).toBeNull();
    expect(attempts.data).toHaveLength(2);
    expect(attempts.data![0].content_checksum).toBe(attempts.data![1].content_checksum);
    expect(reviews.data).toEqual([
      { mission_publication_proof_attempt_id: first.data.attempt.id, state: "open" },
      { mission_publication_proof_attempt_id: correction.data.attempt.id, state: "open" },
    ]);
    expect(current.data).toEqual({
      state: "proof_submitted",
      current_proof_attempt_id: correction.data.attempt.id,
    });
    expect(events.data).toEqual(expect.arrayContaining([
      { event_type: "mission_publication_proof_submitted" },
      { event_type: "mission_publication_proof_resubmitted" },
    ]));
    expect(await creatorRewardSnapshot(active.creator.id)).toEqual(beforeRewards);
  });
});

suite(suiteName, () => {
  it("sets up one existing approved item with exact replay, private audit, and neutral rewards", async () => {
    const id = unique();
    const svc = serviceForTests();
    const active = await seedActiveMission({
      email: `publication-existing-${id}@test.local`,
      slug: `test-publication-existing-${id}`,
      deliverables: [{
        title: "Current authored item",
        platform: "instagram",
        publicationInstructions: "Current template policy",
        publicationWindowHours: 48,
        requiredDisclosures: [],
        proofEvidencePolicy: {},
      }],
    });
    const created = await userForJwt(active.creator.jwt).rpc(
      "create_mission_workflow",
      { p_submission: active.submission.id },
    );
    expect(created.error).toBeNull();

    const canonical = await svc.from("mission_work_items")
      .select("workspace_id")
      .eq("mission_workflow_id", created.data.id)
      .single();
    expect(canonical.error).toBeNull();
    const workItemId = unique();
    const inserted = await svc.from("mission_work_items").insert({
      id: workItemId,
      workspace_id: canonical.data!.workspace_id,
      mission_workflow_id: created.data.id,
      source_template_id: null,
      title: "Existing approved legacy item",
      platform: "instagram",
      requirements_snapshot: [],
      required: true,
      position: 1,
      state: "approved_to_publish",
    });
    expect(inserted.error).toBeNull();

    const operator = await makeStaff(`publication-existing-operator-${id}@test.local`);
    expect((await svc.from("brand_users").insert({
      user_id: operator.userId,
      workspace_id: canonical.data!.workspace_id,
      email: `publication-existing-operator-${id}@test.local`,
      role: "member",
      active: true,
    })).error).toBeNull();
    const otherOperator = await makeStaff(`publication-existing-other-${id}@test.local`);
    expect((await svc.from("brand_users").insert({
      user_id: otherOperator.userId,
      workspace_id: canonical.data!.workspace_id,
      email: `publication-existing-other-${id}@test.local`,
      role: "member",
      active: true,
    })).error).toBeNull();
    const inactiveWorkspaceOperator = await makeStaff(
      `publication-existing-outsider-${id}@test.local`,
    );
    const beforeRewards = await creatorRewardSnapshot(active.creator.id);
    const key = unique();
    const instructions = {
      publication_instructions: "Publish exactly as approved.",
      publication_window_hours: 36,
      required_disclosures: ["#ad", "Paid partnership"],
      expected_account: "@approved",
      proof_evidence_policy: { required: true },
    };
    const setup = (patch: Record<string, unknown> = {}) => svc.rpc(
      "setup_existing_publication_instructions",
      {
        p_workspace: canonical.data!.workspace_id,
        p_workflow: created.data.id,
        p_work_item: workItemId,
        p_operator: operator.userId,
        p_expected_state: "approved_to_publish",
        p_expected_revision: 0,
        p_idempotency_key: key,
        p_instructions: instructions,
        ...patch,
      },
    );

    for (const invalidState of [null, "under_review"]) {
      const invalid = await setup({
        p_expected_state: invalidState,
        p_idempotency_key: unique(),
      });
      expect(invalid.data).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    for (const invalidWindow of [null, 1.5, -1, 0, 8761, 999999999999999]) {
      const invalid = await setup({
        p_idempotency_key: unique(),
        p_instructions: {
          ...instructions,
          publication_window_hours: invalidWindow,
        },
      });
      expect(invalid.data).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    const setupArgs = {
      p_workspace: canonical.data!.workspace_id,
      p_workflow: created.data.id,
      p_work_item: workItemId,
      p_operator: operator.userId,
      p_expected_state: "approved_to_publish",
      p_expected_revision: 0,
      p_idempotency_key: unique(),
      p_instructions: instructions,
    };
    const [anonDenied, authenticatedDenied] = await Promise.all([
      userForJwt("").rpc("setup_existing_publication_instructions", setupArgs),
      userForJwt(active.creator.jwt).rpc("setup_existing_publication_instructions", setupArgs),
    ]);
    expect(anonDenied.error?.message.toLowerCase()).toContain("permission denied");
    expect(authenticatedDenied.error?.message.toLowerCase()).toContain("permission denied");

    const otherWorkspace = await makeBrand(`publication-existing-workspace-${id}@test.local`);
    const wrongWorkspaceOperator = await makeStaff(
      `publication-existing-wrong-workspace-${id}@test.local`,
    );
    expect((await svc.from("brand_users").insert({
      user_id: wrongWorkspaceOperator.userId,
      workspace_id: otherWorkspace.workspaceId,
      email: `publication-existing-wrong-workspace-${id}@test.local`,
      role: "member",
      active: true,
    })).error).toBeNull();
    const wrongWorkspace = await setup({
      p_workspace: otherWorkspace.workspaceId,
      p_operator: wrongWorkspaceOperator.userId,
      p_idempotency_key: unique(),
    });
    expect(wrongWorkspace.data).toMatchObject({ code: "WORKFLOW_NOT_FOUND" });

    const attemptItemId = unique();
    const historyItemId = unique();
    const collisionItemId = unique();
    expect((await svc.from("mission_work_items").insert([
      {
        id: attemptItemId, workspace_id: canonical.data!.workspace_id,
        mission_workflow_id: created.data.id, source_template_id: null,
        title: "Prior attempt item", platform: "instagram", requirements_snapshot: [],
        required: true, position: 2, state: "approved_to_publish",
      },
      {
        id: historyItemId, workspace_id: canonical.data!.workspace_id,
        mission_workflow_id: created.data.id, source_template_id: null,
        title: "History rewind item", platform: "instagram", requirements_snapshot: [],
        required: true, position: 3, state: "approved_to_publish",
      },
      {
        id: collisionItemId, workspace_id: canonical.data!.workspace_id,
        mission_workflow_id: created.data.id, source_template_id: null,
        title: "Normal setter collision item", platform: "instagram", requirements_snapshot: [],
        required: true, position: 4, state: "approved_to_publish",
      },
    ])).error).toBeNull();
    expect((await svc.from("mission_publication_proof_attempts").insert({
      workspace_id: canonical.data!.workspace_id, mission_work_item_id: attemptItemId,
      attempt_number: 1, primary_url: "https://www.instagram.com/p/prior",
      additional_urls: [], submitted_by: active.creator.id, submitted_late: false,
      metadata_status: "unavailable", metadata_snapshot: {},
      content_checksum: "prior-attempt", submission_idempotency_key: unique(),
    })).error).toBeNull();
    const preExistingAttempt = await setup({
      p_work_item: attemptItemId,
      p_idempotency_key: unique(),
    });
    expect(preExistingAttempt.data).toMatchObject({ code: "WRONG_STATE" });
    expect((await svc.from("mission_workflow_events").insert({
      workspace_id: canonical.data!.workspace_id, mission_workflow_id: created.data.id,
      mission_work_item_id: historyItemId, actor_type: "operator", actor_id: operator.userId,
      event_type: "mission_publication_existing_instructions_setup",
      entity_type: "mission_publication_instruction", metadata: {
        revision: 0, idempotency_key: unique(),
      },
    })).error).toBeNull();
    const historyOnly = await setup({
      p_work_item: historyItemId,
      p_idempotency_key: unique(),
    });
    expect(historyOnly.data).toMatchObject({ code: "WRONG_STATE" });
    const collisionKey = unique();
    expect((await svc.from("mission_publication_instructions").insert({
      workspace_id: canonical.data!.workspace_id, mission_work_item_id: collisionItemId,
      platform: "instagram", source_template_id: null,
      publication_instructions: instructions.publication_instructions,
      publication_window_hours: instructions.publication_window_hours,
      required_disclosures: instructions.required_disclosures,
      expected_account: instructions.expected_account,
      proof_evidence_policy: instructions.proof_evidence_policy,
      publication_due_at: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      idempotency_keys: [collisionKey],
    })).error).toBeNull();
    const collision = await setup({
      p_work_item: collisionItemId,
      p_idempotency_key: collisionKey,
    });
    expect(collision.data).toMatchObject({ code: "WRONG_STATE" });

    const staleBeforeSetup = await setup({
      p_idempotency_key: unique(),
      p_expected_revision: 1,
    });
    expect(staleBeforeSetup.data).toMatchObject({ code: "WORKFLOW_STALE" });
    const first = await setup();
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({
      instruction: {
        mission_work_item_id: workItemId,
        frozen_at: expect.any(String),
        revision: 0,
      },
      idempotent: false,
    });
    const replay = await setup();
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({
      instruction: { id: first.data.instruction.id },
      idempotent: true,
    });
    expect((await svc.from("mission_work_items").update({
      state: "proof_submitted",
    }).eq("id", workItemId)).error).toBeNull();
    const progressedReplay = await setup();
    expect(progressedReplay.error).toBeNull();
    expect(progressedReplay.data).toMatchObject({
      instruction: { id: first.data.instruction.id },
      idempotent: true,
    });
    const otherOperatorCollision = await setup({
      p_operator: otherOperator.userId,
    });
    expect(otherOperatorCollision.data).toMatchObject({ code: "WRONG_STATE" });
    const changed = await setup({
      p_instructions: { ...instructions, publication_window_hours: 72 },
    });
    expect(changed.error?.message.toLowerCase()).toContain("idempotency_conflict");
    const secondSetup = await setup({
      p_idempotency_key: unique(),
    });
    expect(secondSetup.data).toMatchObject({ code: "WRONG_STATE" });
    const unauthorized = await setup({
      p_operator: inactiveWorkspaceOperator.userId,
      p_idempotency_key: unique(),
    });
    expect(unauthorized.error?.message.toLowerCase()).toContain("not_authorized");

    const [instruction, attempts, event] = await Promise.all([
      svc.from("mission_publication_instructions").select("*")
        .eq("mission_work_item_id", workItemId).single(),
      svc.from("mission_publication_proof_attempts").select("id")
        .eq("mission_work_item_id", workItemId),
      svc.from("mission_workflow_events").select("event_type, metadata")
        .eq("mission_work_item_id", workItemId)
        .eq("event_type", "mission_publication_existing_instructions_setup").single(),
    ]);
    expect(instruction.data?.idempotency_keys).toContain(key);
    expect(attempts.data).toEqual([]);
    expect(event.data).toMatchObject({
      event_type: "mission_publication_existing_instructions_setup",
      metadata: { revision: 0, idempotency_key: key },
    });
    expect(JSON.stringify(event.data)).not.toContain("Publish exactly as approved.");
    expect(await creatorRewardSnapshot(active.creator.id)).toEqual(beforeRewards);
  });

});
