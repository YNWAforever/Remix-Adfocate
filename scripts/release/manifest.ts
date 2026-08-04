import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ReleaseManifest,
  ReleaseMigration,
  ReleasePhase,
} from "./contracts";

interface ReviewedMigration {
  readonly version: string;
  readonly name: string;
  readonly phase: ReleasePhase;
  readonly dependsOn: readonly string[];
  readonly capabilities: readonly string[];
  readonly transactionExpectation: "transactional";
  readonly replayExpectation: "migration_history_noop";
}

const REVIEWED_MIGRATIONS = [
  {
    version: "20260715163350",
    name: "active_mission_workspace",
    phase: "active_mission",
    dependsOn: [],
    capabilities: [
      "table:public.mission_deliverable_templates",
      "table:public.mission_deliverable_requirements",
      "table:public.mission_workflows",
      "table:public.mission_work_items",
      "table:public.mission_working_drafts",
      "table:public.mission_draft_versions",
      "table:public.mission_draft_assets",
      "table:public.mission_review_rounds",
      "table:public.mission_review_items",
      "table:public.mission_revision_grants",
      "table:public.mission_fulfillments",
      "table:public.mission_workflow_events",
      "column:public.missions.creator_workflow_mode",
      "column:public.missions.fulfillment_required",
      "column:public.missions.revision_limit",
      "column:public.missions.review_sla_hours",
      "column:public.missions.revision_response_hours",
      "column:public.mission_draft_assets.mission_workflow_id",
      "column:public.mission_draft_assets.file_extension",
      "constraint:public.mission_work_items.mission_work_items_current_version_fk",
      "constraint:public.mission_work_items.mission_work_items_approved_version_fk",
      "constraint:public.missions.missions_id_workspace_unique",
      "constraint:public.mission_submissions.mission_submissions_id_workspace_unique",
      "constraint:public.mission_work_items.mission_work_items_id_workspace_unique",
      "constraint:public.mission_draft_versions.mission_draft_versions_id_item_workspace_unique",
      "constraint:public.mission_draft_versions.mission_draft_versions_item_workspace_fk",
      "constraint:public.mission_draft_assets.mission_draft_assets_item_workspace_fk",
      "constraint:public.mission_draft_assets.mission_draft_assets_version_item_workspace_fk",
      "constraint:public.mission_review_rounds.mission_review_rounds_item_workspace_fk",
      "constraint:public.mission_review_rounds.mission_review_rounds_version_item_workspace_fk",
      "constraint:public.creators.creators_id_workspace_unique",
      "constraint:public.mission_deliverable_templates.mission_templates_id_workspace_unique",
      "constraint:public.mission_workflows.mission_workflows_id_workspace_unique",
      "constraint:public.mission_work_items.mission_work_items_id_workflow_workspace_unique",
      "constraint:public.mission_review_rounds.mission_review_rounds_id_workspace_unique",
      "constraint:public.mission_submissions.mission_submissions_mission_workspace_fk",
      "constraint:public.mission_submissions.mission_submissions_creator_workspace_fk",
      "constraint:public.mission_deliverable_templates.mission_templates_mission_workspace_fk",
      "constraint:public.mission_deliverable_requirements.mission_requirements_template_workspace_fk",
      "constraint:public.mission_workflows.mission_workflows_submission_workspace_fk",
      "constraint:public.mission_work_items.mission_work_items_workflow_workspace_fk",
      "constraint:public.mission_work_items.mission_work_items_template_workspace_fk",
      "constraint:public.mission_working_drafts.mission_working_drafts_item_workspace_fk",
      "constraint:public.mission_review_items.mission_review_items_round_workspace_fk",
      "constraint:public.mission_revision_grants.mission_revision_grants_item_workspace_fk",
      "constraint:public.mission_fulfillments.mission_fulfillments_workflow_workspace_fk",
      "constraint:public.mission_workflow_events.mission_events_workflow_workspace_fk",
      "constraint:public.mission_workflow_events.mission_events_item_workflow_workspace_fk",
      "constraint:public.mission_draft_assets.mission_draft_assets_extension_check",
      "constraint:public.mission_draft_assets.mission_draft_assets_mime_extension_check",
      "constraint:public.mission_draft_assets.mission_draft_assets_canonical_path_check",
      "constraint:public.mission_draft_assets.mission_draft_assets_creator_workspace_fk",
      "constraint:public.mission_draft_assets.mission_draft_assets_workflow_workspace_fk",
      "constraint:public.mission_draft_assets.mission_draft_assets_item_workflow_workspace_fk",
      "index:public.mission_working_drafts.mission_working_drafts_one_active_idx",
      "index:public.mission_review_rounds.mission_review_rounds_one_decision_per_version_idx",
      "index:public.mission_deliverable_templates.mission_templates_workspace_idx",
      "index:public.mission_deliverable_templates.mission_templates_mission_idx",
      "index:public.mission_deliverable_requirements.mission_requirements_workspace_idx",
      "index:public.mission_deliverable_requirements.mission_requirements_template_idx",
      "index:public.mission_workflows.mission_workflows_workspace_idx",
      "index:public.mission_work_items.mission_work_items_workspace_idx",
      "index:public.mission_work_items.mission_work_items_workflow_idx",
      "index:public.mission_work_items.mission_work_items_queue_idx",
      "index:public.mission_working_drafts.mission_working_drafts_workspace_idx",
      "index:public.mission_draft_versions.mission_versions_workspace_idx",
      "index:public.mission_draft_versions.mission_versions_work_item_idx",
      "index:public.mission_draft_assets.mission_assets_workspace_idx",
      "index:public.mission_draft_assets.mission_assets_work_item_idx",
      "index:public.mission_draft_assets.mission_assets_creator_idx",
      "index:public.mission_draft_assets.mission_assets_version_idx",
      "index:public.mission_review_rounds.mission_reviews_workspace_idx",
      "index:public.mission_review_rounds.mission_reviews_work_item_idx",
      "index:public.mission_review_rounds.mission_reviews_version_idx",
      "index:public.mission_review_items.mission_review_items_workspace_idx",
      "index:public.mission_review_items.mission_review_items_round_idx",
      "index:public.mission_revision_grants.mission_revision_grants_workspace_idx",
      "index:public.mission_revision_grants.mission_revision_grants_work_item_idx",
      "index:public.mission_fulfillments.mission_fulfillments_workspace_idx",
      "index:public.mission_workflow_events.mission_workflow_events_workspace_idx",
      "index:public.mission_workflow_events.mission_workflow_events_timeline_idx",
      "index:public.mission_workflow_events.mission_workflow_events_work_item_idx",
      "index:public.mission_draft_assets.mission_assets_workflow_workspace_idx",
      "function:private.refresh_mission_workflow_state",
      "function:private.create_mission_workflow",
      "function:public.refresh_mission_workflow_state",
      "function:public.create_mission_workflow",
      "function:private.raise_immutable_record",
      "function:private.guard_completed_review_round",
      "function:private.guard_finalized_mission_asset",
      "function:private.guard_mission_draft_asset_owner",
      "policy:public.mission_deliverable_templates.mission_templates_creator_read",
      "policy:public.mission_deliverable_requirements.mission_requirements_creator_read",
      "policy:public.mission_workflows.mission_workflows_creator_read",
      "policy:public.mission_work_items.mission_work_items_creator_read",
      "policy:public.mission_working_drafts.mission_working_drafts_creator_read",
      "policy:public.mission_draft_versions.mission_versions_creator_read",
      "policy:public.mission_draft_assets.mission_assets_creator_read",
      "policy:public.mission_review_rounds.mission_reviews_creator_read",
      "policy:public.mission_review_items.mission_review_items_creator_read",
      "policy:public.mission_revision_grants.mission_revision_grants_creator_read",
      "policy:public.mission_fulfillments.mission_fulfillments_creator_read",
      "policy:public.mission_workflow_events.mission_events_creator_read",
      "storage-policy:storage.objects.mission_draft_assets_storage_read",
      "storage-policy:storage.objects.mission_draft_assets_storage_insert",
      "storage-policy:storage.objects.mission_draft_assets_storage_update",
      "storage-policy:storage.objects.mission_draft_assets_storage_delete",
      "storage-bucket:storage.buckets.mission-draft-assets",
      "trigger:public.mission_draft_versions_immutable",
      "trigger:public.mission_completed_reviews_immutable",
      "trigger:public.mission_revision_grants_immutable",
      "trigger:public.mission_workflow_events_immutable",
      "trigger:public.mission_finalized_assets_guard",
      "rls:public.mission_deliverable_templates",
      "rls:public.mission_deliverable_requirements",
      "rls:public.mission_workflows",
      "rls:public.mission_work_items",
      "rls:public.mission_working_drafts",
      "rls:public.mission_draft_versions",
      "rls:public.mission_draft_assets",
      "rls:public.mission_review_rounds",
      "rls:public.mission_review_items",
      "rls:public.mission_revision_grants",
      "rls:public.mission_fulfillments",
      "rls:public.mission_workflow_events",
      "grant:authenticated.public.refresh_mission_workflow_state(uuid)",
      "grant:service_role.public.refresh_mission_workflow_state(uuid)",
      "grant:authenticated.public.create_mission_workflow(uuid)",
      "grant:service_role.public.create_mission_workflow(uuid)",
      "grant:service_role.public.mission_deliverable_templates(all)",
      "grant:service_role.public.mission_deliverable_requirements(all)",
      "grant:service_role.public.mission_workflows(all)",
      "grant:service_role.public.mission_work_items(all)",
      "grant:service_role.public.mission_working_drafts(all)",
      "grant:service_role.public.mission_draft_versions(all)",
      "grant:service_role.public.mission_draft_assets(all)",
      "grant:service_role.public.mission_review_rounds(all)",
      "grant:service_role.public.mission_review_items(all)",
      "grant:service_role.public.mission_revision_grants(all)",
      "grant:service_role.public.mission_fulfillments(all)",
      "grant:service_role.public.mission_workflow_events(all)",
      "grant:authenticated.public.mission_deliverable_templates(select)",
      "grant:authenticated.public.mission_deliverable_requirements(select)",
      "grant:authenticated.public.mission_workflows(select)",
      "grant:authenticated.public.mission_work_items(select)",
      "grant:authenticated.public.mission_working_drafts(select)",
      "grant:authenticated.public.mission_draft_versions(select)",
      "grant:authenticated.public.mission_draft_assets(select)",
      "grant:authenticated.public.mission_review_rounds(select)",
      "grant:authenticated.public.mission_review_items(select)",
      "grant:authenticated.public.mission_revision_grants(select)",
      "grant:authenticated.public.mission_fulfillments(select)",
      "grant:authenticated.public.mission_workflow_events(select)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260717190420",
    name: "receive_mission_fulfillment",
    phase: "active_mission",
    dependsOn: ["20260715163350"],
    capabilities: [
      "function:private.receive_mission_fulfillment",
      "function:public.receive_mission_fulfillment",
      "grant:service_role.public.receive_mission_fulfillment(uuid,uuid,uuid)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260718134500",
    name: "active_mission_operator_lifecycle",
    phase: "active_mission",
    dependsOn: ["20260717190420"],
    capabilities: [
      "function:private.assert_active_mission_operator",
      "function:private.start_mission_review",
      "function:private.request_mission_revision",
      "function:private.v_item_round_limit",
      "function:private.grant_mission_revision",
      "function:private.approve_mission_version",
      "function:private.mark_mission_fulfillment_shipped",
      "function:public.start_mission_review",
      "function:public.request_mission_revision",
      "function:public.grant_mission_revision",
      "function:public.approve_mission_version",
      "function:public.mark_mission_fulfillment_shipped",
      "grant:service_role.public.start_mission_review(uuid,uuid,uuid,uuid,text)",
      "grant:service_role.public.request_mission_revision(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb)",
      "grant:service_role.public.grant_mission_revision(uuid,uuid,uuid,uuid,text,smallint)",
      "grant:service_role.public.approve_mission_version(uuid,uuid,uuid,uuid,uuid,text)",
      "grant:service_role.public.mark_mission_fulfillment_shipped(uuid,uuid,uuid,text)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260718193000",
    name: "harden_active_mission_operator_lifecycle",
    phase: "active_mission",
    dependsOn: ["20260718134500"],
    capabilities: [
      "function:private.v_item_round_limit",
      "function:private.start_mission_review",
      "function:private.request_mission_revision",
      "function:private.grant_mission_revision",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260718210000",
    name: "author_active_mission_workflow_policies",
    phase: "active_mission",
    dependsOn: ["20260718193000"],
    capabilities: [
      "column:public.mission_deliverable_templates.platform",
      "column:public.mission_work_items.platform",
      "function:private.author_mission_workflow",
      "function:public.author_mission_workflow",
      "grant:service_role.public.author_mission_workflow(uuid,jsonb,jsonb,jsonb)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260718213000",
    name: "guard_mission_authoring_snapshot_race",
    phase: "active_mission",
    dependsOn: ["20260718210000"],
    capabilities: [
      "function:private.guard_mission_work_item_source_template",
      "trigger:public.mission_work_items_source_template_guard",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260719133000",
    name: "submit_active_mission_draft",
    phase: "active_mission",
    dependsOn: ["20260718213000"],
    capabilities: [
      "column:public.mission_draft_assets.upload_grant_expires_at",
      "column:public.mission_draft_versions.submission_idempotency_key",
      "index:public.mission_draft_versions.mission_submission_idempotency_key",
      "function:private.create_active_mission_asset",
      "function:public.create_active_mission_asset",
      "function:private.finalize_active_mission_asset",
      "function:public.finalize_active_mission_asset",
      "function:private.submit_active_mission_draft",
      "function:public.submit_active_mission_draft",
      "grant:service_role.public.create_active_mission_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer)",
      "grant:service_role.public.finalize_active_mission_asset(uuid,uuid,uuid,uuid,uuid,text)",
      "grant:service_role.public.submit_active_mission_draft(uuid,uuid,uuid,uuid,integer,text)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260719160000",
    name: "abandon_active_mission_asset",
    phase: "active_mission",
    dependsOn: ["20260719133000"],
    capabilities: [
      "function:private.abandon_active_mission_asset",
      "function:public.abandon_active_mission_asset",
      "grant:service_role.public.abandon_active_mission_asset(uuid,uuid,uuid,uuid,uuid,text)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260719200000",
    name: "active_mission_workflow_notifications",
    phase: "active_mission",
    dependsOn: ["20260719160000"],
    capabilities: [
      "table:private.mission_workflow_notification_dedupe",
      "constraint:public.notifications.notifications_type_check",
      "constraint:public.notifications.notifications_workflow_payload_size_check",
      "function:private.notify_mission_workflow",
      "function:private.notify_mission_fulfillment_transition",
      "function:private.notify_mission_work_item_transition",
      "function:private.notify_mission_workflow_transition",
      "function:public.emit_active_mission_deadline_notifications",
      "trigger:public.mission_fulfillment_workflow_notifications",
      "trigger:public.mission_work_item_workflow_notifications",
      "trigger:public.mission_workflow_state_notifications",
      "grant:service_role.public.emit_active_mission_deadline_notifications(timestamptz)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260719220000",
    name: "migrate_pristine_joined_active_mission",
    phase: "active_mission",
    dependsOn: ["20260719200000"],
    capabilities: [
      "function:public.migrate_pristine_joined_active_mission",
      "grant:service_role.public.migrate_pristine_joined_active_mission(uuid)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260720033542",
    name: "final_review_active_mission_contracts",
    phase: "active_mission",
    dependsOn: ["20260719220000"],
    capabilities: [
      "table:private.mission_draft_submission_idempotency",
      "function:private.submit_active_mission_draft",
      "function:public.submit_active_mission_draft",
      "function:private.save_active_mission_draft",
      "function:public.save_active_mission_draft",
      "function:private.start_mission_review",
      "function:public.start_mission_review",
      "function:private.request_mission_revision",
      "function:public.request_mission_revision",
      "grant:service_role.public.submit_active_mission_draft(uuid,uuid,uuid,uuid,integer,text)",
      "grant:service_role.public.save_active_mission_draft(uuid,uuid,uuid,uuid,integer,jsonb)",
      "grant:service_role.public.start_mission_review(uuid,uuid,uuid,uuid,text)",
      "grant:service_role.public.request_mission_revision(uuid,uuid,uuid,uuid,uuid,text,timestamptz,jsonb)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260720175319",
    name: "grant_service_role_budget_read",
    phase: "active_mission",
    dependsOn: ["20260720033542"],
    capabilities: [
      "grant:service_role.public.workspace_budgets(select)",
      "grant:service_role.public.workspace_budget_transactions(select)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260720193637",
    name: "resolve_mission_submission_relationships",
    phase: "active_mission",
    dependsOn: ["20260720175319"],
    capabilities: [
      "constraint-removed:public.mission_submissions.mission_submissions_creator_workspace_fk",
      "constraint-removed:public.mission_submissions.mission_submissions_mission_id_fkey",
      "constraint-removed:public.mission_workflows.mission_workflows_mission_submission_id_fkey",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260723090000",
    name: "publication_proof_validation",
    phase: "publication_proof",
    dependsOn: ["20260720193637"],
    capabilities: [
      "table:public.mission_publication_instructions",
      "table:public.mission_publication_proof_attempts",
      "table:public.mission_publication_proof_assets",
      "table:public.mission_publication_proof_reviews",
      "table:public.mission_publication_proof_review_items",
      "column:public.mission_deliverable_templates.publication_instructions",
      "column:public.mission_deliverable_templates.publication_window_hours",
      "column:public.mission_deliverable_templates.required_disclosures",
      "column:public.mission_deliverable_templates.expected_account",
      "column:public.mission_deliverable_templates.proof_evidence_policy",
      "column:public.mission_work_items.current_proof_attempt_id",
      "column:public.mission_work_items.verified_proof_attempt_id",
      "column:public.mission_publication_instructions.platform",
      "column:public.mission_publication_instructions.source_template_id",
      "column:public.mission_publication_instructions.override_reason",
      "column:public.mission_publication_instructions.overridden_by",
      "column:public.mission_publication_instructions.overridden_at",
      "column:public.mission_publication_instructions.publication_due_at",
      "column:public.mission_publication_instructions.frozen_at",
      "column:public.mission_publication_instructions.revision",
      "column:public.mission_publication_instructions.idempotency_keys",
      "column:public.mission_publication_proof_reviews.claimed_at",
      "column:public.mission_publication_proof_reviews.review_due_at",
      "column:public.mission_publication_proof_reviews.creator_response_deadline",
      "column:public.mission_publication_proof_reviews.checklist",
      "column:public.mission_publication_proof_reviews.claim_idempotency_key",
      "column:public.mission_publication_proof_reviews.decision_idempotency_key",
      "constraint:public.brand_users.brand_users_user_workspace_unique",
      "constraint:public.mission_work_items.mission_work_items_current_proof_attempt_fk",
      "constraint:public.mission_work_items.mission_work_items_verified_proof_attempt_fk",
      "constraint:public.mission_publication_instructions.mission_publication_instructions_work_item_workspace_fk",
      "constraint:public.mission_publication_instructions.mission_publication_instructions_source_template_workspace_fk",
      "constraint:public.mission_publication_instructions.mission_publication_instructions_overridden_by_workspace_fk",
      "constraint:public.mission_publication_proof_attempts.mission_publication_proof_attempts_workspace_fk",
      "constraint:public.mission_publication_proof_attempts.mission_publication_proof_attempts_work_item_workspace_fk",
      "constraint:public.mission_publication_proof_attempts.mission_publication_proof_attempts_submitter_workspace_fk",
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_workspace_fk",
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_attempt_workspace_fk",
      "constraint:public.mission_publication_proof_reviews.mission_publication_proof_reviews_workspace_fk",
      "constraint:public.mission_publication_proof_reviews.mission_publication_proof_reviews_attempt_workspace_fk",
      "constraint:public.mission_publication_proof_reviews.mission_publication_proof_reviews_reviewer_workspace_fk",
      "constraint:public.mission_publication_proof_review_items.mission_publication_proof_review_items_workspace_fk",
      "constraint:public.mission_publication_proof_review_items.mission_publication_proof_review_items_review_workspace_fk",
      "constraint:public.mission_workflows.mission_workflows_state_check",
      "constraint:public.mission_work_items.mission_work_items_state_check",
      "constraint:public.mission_publication_proof_review_items.mission_publication_proof_review_items_category_check",
      "index:public.mission_publication_proof_reviews.mission_publication_proof_reviews_one_terminal_decision_idx",
      "index:public.mission_work_items.mission_work_items_current_proof_attempt_idx",
      "index:public.mission_publication_instructions.mission_publication_instructions_due_at_idx",
      "index:public.mission_publication_proof_attempts.mission_publication_proof_attempts_late_idx",
      "index:public.mission_publication_proof_attempts.mission_publication_proof_attempts_metadata_status_idx",
      "index:public.mission_publication_proof_reviews.mission_publication_proof_reviews_reviewer_idx",
      "index:public.mission_publication_proof_reviews.mission_publication_proof_reviews_claim_idempotency_idx",
      "index:public.mission_publication_proof_reviews.mission_publication_proof_reviews_decision_idempotency_idx",
      "function:private.author_mission_workflow",
      "function:public.author_mission_workflow",
      "function:private.snapshot_publication_instructions",
      "function:private.guard_publication_instruction_mutation",
      "function:private.set_publication_instructions",
      "function:public.set_publication_instructions",
      "function:private.approve_mission_version",
      "function:public.approve_mission_version",
      "function:public.submit_mission_publication_proof",
      "function:private.guard_publication_proof_review_mutation",
      "function:private.refresh_mission_workflow_state",
      "function:private.start_publication_proof_review",
      "function:public.start_publication_proof_review",
      "function:private.request_publication_proof_correction",
      "function:public.request_publication_proof_correction",
      "function:private.verify_publication_proof",
      "function:public.verify_publication_proof",
      "function:private.guard_publication_proof_attempt",
      "function:private.request_publication_proof_metadata_refresh",
      "function:public.request_publication_proof_metadata_refresh",
      "function:public.complete_publication_proof_metadata_refresh",
      "policy:public.mission_publication_instructions.mission_publication_instructions_creator_read",
      "policy:public.mission_publication_proof_attempts.mission_publication_proof_attempts_creator_read",
      "policy:public.mission_publication_proof_assets.mission_publication_proof_assets_creator_read",
      "policy:public.mission_publication_proof_reviews.mission_publication_proof_reviews_creator_read",
      "policy:public.mission_publication_proof_review_items.mission_publication_proof_review_items_creator_read",
      "storage-policy:storage.objects.mission_publication_proof_assets_storage_read",
      "storage-policy:storage.objects.mission_publication_proof_assets_storage_insert",
      "storage-bucket:storage.buckets.mission-publication-proof-assets",
      "trigger:public.mission_publication_instructions_immutable",
      "trigger:public.mission_publication_proof_attempts_immutable",
      "trigger:public.mission_publication_proof_assets_immutable",
      "trigger:public.mission_publication_proof_reviews_immutable",
      "trigger:public.mission_publication_proof_review_items_immutable",
      "trigger:public.mission_work_items_snapshot_publication_instructions",
      "rls:public.mission_publication_instructions",
      "rls:public.mission_publication_proof_attempts",
      "rls:public.mission_publication_proof_assets",
      "rls:public.mission_publication_proof_reviews",
      "rls:public.mission_publication_proof_review_items",
      "grant:authenticated.public.mission_publication_instructions(select)",
      "grant:authenticated.public.mission_publication_proof_attempts(select)",
      "grant:authenticated.public.mission_publication_proof_assets(select)",
      "grant:authenticated.public.mission_publication_proof_reviews(select)",
      "grant:authenticated.public.mission_publication_proof_review_items(select)",
      "grant:service_role.public.mission_publication_instructions(all)",
      "grant:service_role.public.mission_publication_proof_attempts(all)",
      "grant:service_role.public.mission_publication_proof_assets(all)",
      "grant:service_role.public.mission_publication_proof_reviews(all)",
      "grant:service_role.public.mission_publication_proof_review_items(all)",
      "grant:service_role.public.author_mission_workflow(uuid,jsonb,jsonb,jsonb)",
      "grant:service_role.public.set_publication_instructions(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb)",
      "grant:service_role.public.approve_mission_version(uuid,uuid,uuid,uuid,uuid,text)",
      "grant:service_role.public.submit_mission_publication_proof(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb,uuid[])",
      "grant:service_role.public.start_publication_proof_review(uuid,uuid,uuid,uuid,text,integer,uuid,uuid)",
      "grant:service_role.public.request_publication_proof_correction(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,jsonb,jsonb,text)",
      "grant:service_role.public.verify_publication_proof(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,jsonb,text)",
      "grant:service_role.public.request_publication_proof_metadata_refresh(uuid,uuid,uuid,uuid,text,integer,uuid,uuid)",
      "grant:service_role.public.complete_publication_proof_metadata_refresh(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,text,jsonb,text)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260723170000",
    name: "publication_proof_rollout",
    phase: "publication_proof",
    dependsOn: ["20260723090000"],
    capabilities: [
      "column:public.mission_publication_proof_assets.mission_submission_id",
      "column:public.mission_publication_proof_assets.mission_workflow_id",
      "column:public.mission_publication_proof_assets.mission_work_item_id",
      "column:public.mission_publication_proof_assets.creator_id",
      "column:public.mission_publication_proof_assets.upload_state",
      "column:public.mission_publication_proof_assets.upload_grant_expires_at",
      "column:public.mission_publication_proof_assets.finalized_at",
      "column:public.mission_publication_proof_assets.mission_publication_proof_attempt_id",
      "column:public.mission_publication_proof_assets.content_checksum",
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_attempt_workspace_fk",
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_submission_workspace_fk",
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_workflow_workspace_fk",
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_work_item_workspace_fk",
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_creator_workspace_fk",
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_upload_state_check",
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_pending_attempt_check",
      "index:public.mission_publication_proof_assets.mission_publication_proof_assets_owner_idx",
      "function:private.guard_publication_proof_asset_mutation",
      "function:private.create_publication_proof_asset",
      "function:public.create_publication_proof_asset",
      "function:private.finalize_publication_proof_asset",
      "function:public.finalize_publication_proof_asset",
      "function:private.abandon_publication_proof_asset",
      "function:public.abandon_publication_proof_asset",
      "policy:public.mission_publication_proof_assets.mission_publication_proof_assets_creator_read",
      "storage-policy:storage.objects.mission_publication_proof_assets_storage_read",
      "storage-policy:storage.objects.mission_publication_proof_assets_storage_insert",
      "trigger:public.mission_publication_proof_assets_immutable",
      "grant:service_role.public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer)",
      "grant:service_role.public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text)",
      "grant:service_role.public.abandon_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260725090000",
    name: "publication_proof_rollout_compat",
    phase: "publication_proof",
    dependsOn: ["20260723170000"],
    capabilities: [
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_pending_attempt_check",
      "function:private.guard_publication_proof_asset_mutation",
      "function:public.create_publication_proof_asset",
      "function:public.finalize_publication_proof_asset",
      "grant:service_role.public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text)",
      "grant:service_role.public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260725110000",
    name: "publication_proof_asset_policy",
    phase: "publication_proof",
    dependsOn: ["20260725090000"],
    capabilities: [
      "function:private.create_publication_proof_asset",
      "function:public.create_publication_proof_asset",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260725130000",
    name: "publication_proof_asset_mutation_guards",
    phase: "publication_proof",
    dependsOn: ["20260725110000"],
    capabilities: [
      "column:public.mission_publication_proof_assets.upload_idempotency_key",
      "column:public.mission_publication_proof_assets.finalize_idempotency_key",
      "index:public.mission_publication_proof_assets.mission_publication_proof_assets_upload_idempotency_idx",
      "function:public.create_publication_proof_asset",
      "function:public.finalize_publication_proof_asset",
      "grant:service_role.public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text)",
      "grant:service_role.public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260725140000",
    name: "publication_proof_asset_guards",
    phase: "publication_proof",
    dependsOn: ["20260725130000"],
    capabilities: ["function:private.create_publication_proof_asset"],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260725143000",
    name: "publication_proof_public_guards",
    phase: "publication_proof",
    dependsOn: ["20260725140000"],
    capabilities: [
      "function:public.create_publication_proof_asset",
      "function:public.finalize_publication_proof_asset",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260725150000",
    name: "publication_proof_public_rpc_final",
    phase: "publication_proof",
    dependsOn: ["20260725143000"],
    capabilities: [
      "function:public.create_publication_proof_asset",
      "function:public.finalize_publication_proof_asset",
      "grant:service_role.public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text)",
      "grant:service_role.public.finalize_publication_proof_asset(uuid,uuid,uuid,uuid,uuid,text,text,integer,text)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260727120000",
    name: "publication_proof_instrumentation",
    phase: "publication_proof",
    dependsOn: ["20260725150000"],
    capabilities: [
      "constraint:public.notifications.notifications_type_check",
      "constraint:public.notifications.notifications_workflow_payload_size_check",
      "function:private.notify_publication_proof_outcome",
      "function:private.notify_publication_proof_event",
      "trigger:public.publication_proof_workflow_event_notifications",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260727130000",
    name: "publication_proof_existing_setup",
    phase: "publication_proof",
    dependsOn: ["20260727120000"],
    capabilities: [
      "function:private.setup_existing_publication_instructions",
      "function:public.setup_existing_publication_instructions",
      "grant:service_role.public.setup_existing_publication_instructions(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260728135000",
    name: "fix_publication_proof_asset_path_regex",
    phase: "publication_proof",
    dependsOn: ["20260727130000"],
    capabilities: ["function:public.create_publication_proof_asset"],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260729010000",
    name: "align_publication_proof_asset_mime_contract",
    phase: "publication_proof",
    dependsOn: ["20260728135000"],
    capabilities: [
      "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_mime_type_check",
      "storage-bucket:storage.buckets.mission-publication-proof-assets",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260731100000",
    name: "reward_handoff_schema",
    phase: "reward_handoff",
    dependsOn: ["20260729010000"],
    capabilities: [
      "table:public.mission_reward_contracts",
      "table:public.mission_completion_decisions",
      "table:public.mission_pending_rewards",
      "column:public.workspaces.reward_processing_window_days",
      "column:public.mission_workflows.revision",
      "constraint:public.mission_workflows.mission_workflows_state_check",
      "constraint:public.mission_completion_decisions.mission_completion_decisions_pending_reward_fk",
      "index:public.mission_pending_rewards.mission_pending_rewards_one_pending_idx",
      "index:public.mission_reward_contracts.mission_reward_contracts_workspace_workflow_idx",
      "index:public.mission_reward_contracts.mission_reward_contracts_workspace_submission_idx",
      "index:public.mission_reward_contracts.mission_reward_contracts_workspace_mission_idx",
      "index:public.mission_completion_decisions.mission_completion_decisions_workspace_workflow_idx",
      "index:public.mission_completion_decisions.mission_completion_decisions_workspace_contract_idx",
      "index:public.mission_completion_decisions.mission_completion_decisions_workspace_pending_reward_idx",
      "index:public.mission_pending_rewards.mission_pending_rewards_workspace_creator_idx",
      "index:public.mission_pending_rewards.mission_pending_rewards_workspace_workflow_idx",
      "index:public.mission_pending_rewards.mission_pending_rewards_workspace_submission_idx",
      "index:public.mission_pending_rewards.mission_pending_rewards_workspace_mission_idx",
      "function:private.guard_reward_contract_immutable",
      "function:private.guard_completion_decision_immutable",
      "function:private.guard_pending_reward_update",
      "trigger:public.mission_reward_contracts_immutable",
      "trigger:public.mission_completion_decisions_immutable",
      "trigger:public.mission_pending_rewards_guarded_update",
      "rls:public.mission_reward_contracts",
      "rls:public.mission_completion_decisions",
      "rls:public.mission_pending_rewards",
      "grant:service_role.public.mission_reward_contracts(all)",
      "grant:service_role.public.mission_completion_decisions(all)",
      "grant:service_role.public.mission_pending_rewards(all)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260731110000",
    name: "reward_contract_capture",
    phase: "reward_handoff",
    dependsOn: ["20260731100000"],
    capabilities: [
      "function:public.join_active_mission",
      "function:private.backfill_mission_reward_contract",
      "function:public.backfill_mission_reward_contract",
      "function:private.set_reward_processing_window",
      "function:public.set_reward_processing_window",
      "grant:authenticated.public.join_active_mission(uuid)",
      "grant:service_role.public.backfill_mission_reward_contract(uuid,uuid,uuid,integer,numeric,text,integer,timestamptz,text,text,uuid)",
      "grant:service_role.public.set_reward_processing_window(uuid,uuid,smallint)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260731120000",
    name: "reward_handoff_transitions",
    phase: "reward_handoff",
    dependsOn: ["20260731110000"],
    capabilities: [
      "function:private.approve_mission_completion",
      "function:public.approve_mission_completion",
      "function:private.cancel_mission_reward_handoff",
      "function:public.cancel_mission_reward_handoff",
      "function:public.get_my_mission_reward_handoff",
      "grant:service_role.public.approve_mission_completion(uuid,uuid,uuid,text,integer,uuid)",
      "grant:service_role.public.cancel_mission_reward_handoff(uuid,uuid,uuid,text,integer,uuid,text,text)",
      "grant:authenticated.public.get_my_mission_reward_handoff(uuid)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260731130000",
    name: "reward_handoff_notifications",
    phase: "reward_handoff",
    dependsOn: ["20260731120000"],
    capabilities: [
      "constraint:public.notifications.notifications_type_check",
      "constraint:public.notifications.notifications_workflow_payload_size_check",
      "function:private.notify_reward_handoff_outcome",
      "function:private.notify_reward_handoff_event",
      "trigger:public.reward_handoff_workflow_event_notifications",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260731140000",
    name: "reward_handoff_release_hardening",
    phase: "reward_handoff",
    dependsOn: ["20260731130000"],
    capabilities: [
      "column:public.mission_reward_contracts.backfill_idempotency_key",
      "column:public.mission_reward_contracts.backfill_request_hash",
      "constraint:public.mission_reward_contracts.mission_reward_contracts_backfill_replay_check",
      "constraint:public.mission_reward_contracts.mission_reward_contracts_workspace_backfill_key_unique",
      "function:private.backfill_mission_reward_contract",
      "function:public.retry_reward_handoff_notification",
      "grant:service_role.public.retry_reward_handoff_notification(uuid,uuid,uuid,text)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
  {
    version: "20260731150000",
    name: "enable_pilot_if_empty",
    phase: "reward_handoff",
    dependsOn: ["20260731140000"],
    capabilities: [
      "function:public.enable_pilot_if_empty",
      "grant:service_role.public.enable_pilot_if_empty(uuid,uuid,text,text,text,boolean)",
    ],
    transactionExpectation: "transactional",
    replayExpectation: "migration_history_noop",
  },
] as const satisfies readonly ReviewedMigration[];

const NON_RELEASE_TIMESTAMP_MIGRATIONS = new Set([
  "20260618135028_profile_media_private_grants.sql",
  "20260619013000_profile_media_url_validation.sql",
]);

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "cliVersion",
  "generatedFrom",
  "migrations",
] as const;
const MIGRATION_KEYS = [
  "version",
  "name",
  "path",
  "sha256",
  "phase",
  "dependsOn",
  "capabilities",
  "transactionExpectation",
  "replayExpectation",
] as const;
const CAPABILITY_PATTERN = /^(?:(?:table|column|constraint|constraint-removed|index|function|policy|storage-policy|storage-bucket|trigger|rls):[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+|grant:[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\([a-z0-9_,\x5b\x5d]+\))$/;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationFile(metadata: ReviewedMigration) {
  return `${metadata.version}_${metadata.name}.sql`;
}

function invalid(path: string, message: string): never {
  throw new Error(`invalid release manifest: ${path} ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
) {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) invalid(`${path}.${key}`, "is unknown");
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, "is missing");
  }
}

function stringValue(value: unknown, path: string, pattern?: RegExp) {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    return invalid(path, "is invalid");
  }
  return value;
}

function stringArray(value: unknown, path: string, pattern?: RegExp) {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  const values = value.map((item, index) =>
    stringValue(item, `${path}[${index}]`, pattern),
  );
  if (new Set(values).size !== values.length) invalid(path, "has duplicates");
  return values;
}

function freezeManifest(manifest: ReleaseManifest): ReleaseManifest {
  for (const migration of manifest.migrations) {
    Object.freeze(migration.dependsOn);
    Object.freeze(migration.capabilities);
    Object.freeze(migration);
  }
  Object.freeze(manifest.migrations);
  return Object.freeze(manifest);
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  const source = record(value, "$manifest");
  exactKeys(source, TOP_LEVEL_KEYS, "$manifest");
  if (source.schemaVersion !== 1) invalid("$manifest.schemaVersion", "must be 1");
  if (source.cliVersion !== "2.110.0") {
    invalid("$manifest.cliVersion", "must be 2.110.0");
  }
  if (source.generatedFrom !== "supabase/migrations") {
    invalid("$manifest.generatedFrom", "must be supabase/migrations");
  }
  if (!Array.isArray(source.migrations)) {
    invalid("$manifest.migrations", "must be an array");
  }

  const migrations = source.migrations.map((candidate, index) => {
    const path = `$manifest.migrations[${index}]`;
    const migration = record(candidate, path);
    exactKeys(migration, MIGRATION_KEYS, path);
    const version = stringValue(migration.version, `${path}.version`, /^\d{14}$/);
    const name = stringValue(migration.name, `${path}.name`, /^[a-z0-9_]+$/);
    const migrationPath = stringValue(
      migration.path,
      `${path}.path`,
      /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/,
    );
    if (migrationPath !== `supabase/migrations/${version}_${name}.sql`) {
      invalid(`${path}.path`, "must match version and name");
    }
    const hash = stringValue(migration.sha256, `${path}.sha256`, /^[a-f0-9]{64}$/);
    if (
      migration.phase !== "active_mission" &&
      migration.phase !== "publication_proof" &&
      migration.phase !== "reward_handoff"
    ) {
      invalid(`${path}.phase`, "is invalid");
    }
    if (migration.transactionExpectation !== "transactional") {
      invalid(`${path}.transactionExpectation`, "is invalid");
    }
    if (migration.replayExpectation !== "migration_history_noop") {
      invalid(`${path}.replayExpectation`, "is invalid");
    }
    return {
      version,
      name,
      path: migrationPath,
      sha256: hash,
      phase: migration.phase,
      dependsOn: stringArray(
        migration.dependsOn,
        `${path}.dependsOn`,
        /^\d{14}$/,
      ),
      capabilities: stringArray(
        migration.capabilities,
        `${path}.capabilities`,
        CAPABILITY_PATTERN,
      ),
      transactionExpectation: migration.transactionExpectation,
      replayExpectation: migration.replayExpectation,
    } satisfies ReleaseMigration;
  });

  return freezeManifest({
    schemaVersion: 1,
    cliVersion: "2.110.0",
    generatedFrom: "supabase/migrations",
    migrations,
  });
}

function stableManifest(manifest: ReleaseManifest) {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    cliVersion: manifest.cliVersion,
    generatedFrom: manifest.generatedFrom,
    migrations: manifest.migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
      path: migration.path.replaceAll("\\", "/"),
      sha256: migration.sha256,
      phase: migration.phase,
      dependsOn: migration.dependsOn,
      capabilities: migration.capabilities,
      transactionExpectation: migration.transactionExpectation,
      replayExpectation: migration.replayExpectation,
    })),
  });
}

interface RepositoryInspection {
  readonly migrations: readonly ReleaseMigration[];
  readonly errors: readonly string[];
}

async function inspectRepository(rootDir: string): Promise<RepositoryInspection> {
  const migrationDir = join(rootDir, "supabase", "migrations");
  const names = (await readdir(migrationDir))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  const reviewedFiles = new Set(REVIEWED_MIGRATIONS.map(migrationFile));
  const errors: string[] = [];
  for (const name of names) {
    if (!reviewedFiles.has(name) && !NON_RELEASE_TIMESTAMP_MIGRATIONS.has(name)) {
      errors.push(`unclassified migration: ${name}`);
    }
  }

  const present = new Set(names);
  const migrations: ReleaseMigration[] = [];
  for (const metadata of REVIEWED_MIGRATIONS) {
    const filename = migrationFile(metadata);
    if (!present.has(filename)) {
      errors.push(`missing reviewed migration: ${filename}`);
      continue;
    }
    migrations.push({
      version: metadata.version,
      name: metadata.name,
      path: `supabase/migrations/${filename}`,
      sha256: sha256(await readFile(join(migrationDir, filename))),
      phase: metadata.phase,
      dependsOn: [...metadata.dependsOn],
      capabilities: [...metadata.capabilities],
      transactionExpectation: metadata.transactionExpectation,
      replayExpectation: metadata.replayExpectation,
    });
  }
  return { migrations, errors };
}

export async function buildManifest(rootDir: string): Promise<ReleaseManifest> {
  const inspection = await inspectRepository(rootDir);
  if (inspection.errors.length) throw new Error(inspection.errors.join("\n"));
  return parseReleaseManifest({
    schemaVersion: 1,
    cliVersion: "2.110.0",
    generatedFrom: "supabase/migrations",
    migrations: inspection.migrations,
  });
}

function pushUnique(errors: string[], error: string) {
  if (!errors.includes(error)) errors.push(error);
}

export async function validateManifest(
  manifest: ReleaseManifest,
  rootDir: string,
): Promise<string[]> {
  let parsed: ReleaseManifest;
  try {
    parsed = parseReleaseManifest(manifest);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const inspection = await inspectRepository(rootDir);
  const errors = [...inspection.errors];
  const versions = parsed.migrations.map((migration) => migration.version);
  const expectedVersions = REVIEWED_MIGRATIONS.map((migration) => migration.version);
  const currentByVersion = new Map(
    inspection.migrations.map((migration) => [migration.version, migration]),
  );

  if (new Set(versions).size !== versions.length) {
    pushUnique(errors, "duplicate migration version");
  }
  if (versions.join() !== [...versions].sort().join()) {
    pushUnique(errors, "migration order mismatch");
  }
  if (versions[0] !== expectedVersions[0]) {
    pushUnique(errors, `first migration mismatch: ${expectedVersions[0]}`);
  }
  if (versions.at(-1) !== expectedVersions.at(-1)) {
    pushUnique(errors, `last migration mismatch: ${expectedVersions.at(-1)}`);
  }
  for (const version of expectedVersions) {
    if (!versions.includes(version)) {
      pushUnique(errors, `missing manifest migration: ${version}`);
    }
  }
  for (const version of versions) {
    if (!expectedVersions.includes(version)) {
      pushUnique(errors, `unclassified manifest migration: ${version}`);
    }
  }
  for (const phase of [
    "active_mission",
    "publication_proof",
    "reward_handoff",
  ] satisfies ReleasePhase[]) {
    if (!parsed.migrations.some((migration) => migration.phase === phase)) {
      pushUnique(errors, `missing release phase: ${phase}`);
    }
  }

  parsed.migrations.forEach((migration, index) => {
    const actual = currentByVersion.get(migration.version);
    if (!actual) {
      pushUnique(errors, `missing migration file: ${migration.version}`);
    } else if (actual.sha256 !== migration.sha256) {
      pushUnique(errors, `checksum drift: ${migration.version}`);
    }
    for (const dependency of migration.dependsOn) {
      const dependencyIndex = versions.indexOf(dependency);
      if (dependencyIndex === -1) {
        pushUnique(errors, `unknown dependency: ${dependency}`);
      } else if (dependencyIndex >= index) {
        pushUnique(errors, `dependency order mismatch: ${dependency}`);
      }
    }
  });

  const current = parseReleaseManifest({
    schemaVersion: 1,
    cliVersion: "2.110.0",
    generatedFrom: "supabase/migrations",
    migrations: inspection.migrations,
  });
  if (stableManifest(parsed) !== stableManifest(current)) {
    pushUnique(errors, "manifest content drift");
  }
  return errors;
}

export function digestManifest(manifest: ReleaseManifest) {
  return sha256(stableManifest(parseReleaseManifest(manifest)));
}
