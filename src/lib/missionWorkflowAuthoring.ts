/** Existing deterministic authoring rules shared by form and server. No I/O. */
export type MissionWorkflowPolicyInput = {
  creator_workflow_mode: "legacy" | "active_workspace";
  fulfillment_required: boolean;
  revision_limit: number;
  review_sla_hours: number;
  revision_response_hours: number;
};

export type MissionDeliverableTemplateInput = {
  id?: string;
  title: string;
  platform: string | null;
  position: number;
  required: boolean;
  draft_due_offset_hours: number;
  publication_instructions: string;
  publication_window_hours: number;
  required_disclosures: string[];
  expected_account: string | null;
  proof_evidence_policy: Record<string, unknown>;
  requirements: {
    id?: string;
    category: "format" | "key_message" | "compliance" | "quality" | "other";
    text: string;
    required: boolean;
    position: number;
  }[];
};

export type MissionWorkflowAuthoringInput = Partial<MissionWorkflowPolicyInput> & {
  deliverable_templates?: MissionDeliverableTemplateInput[];
};

export const DEFAULT_MISSION_WORKFLOW_POLICY: MissionWorkflowPolicyInput = {
  creator_workflow_mode: "legacy",
  fulfillment_required: false,
  revision_limit: 2,
  review_sla_hours: 48,
  revision_response_hours: 48,
};

const REQUIREMENT_CATEGORIES = new Set(["format", "key_message", "compliance", "quality", "other"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateMissionWorkflowAuthoring(input: unknown) {
  const errors: Record<string, string> = {};
  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) errors.root = "Must be an object";

  const policy = {
    creator_workflow_mode: raw.creator_workflow_mode === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.creator_workflow_mode
      : raw.creator_workflow_mode,
    fulfillment_required: raw.fulfillment_required === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.fulfillment_required
      : raw.fulfillment_required,
    revision_limit: raw.revision_limit === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.revision_limit
      : raw.revision_limit,
    review_sla_hours: raw.review_sla_hours === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.review_sla_hours
      : raw.review_sla_hours,
    revision_response_hours: raw.revision_response_hours === undefined
      ? DEFAULT_MISSION_WORKFLOW_POLICY.revision_response_hours
      : raw.revision_response_hours,
  };

  if (!(policy.creator_workflow_mode === "legacy" || policy.creator_workflow_mode === "active_workspace")) {
    errors.creator_workflow_mode = "Invalid creator workflow";
  }
  if (typeof policy.fulfillment_required !== "boolean") errors.fulfillment_required = "Must be a boolean";
  if (typeof policy.revision_limit !== "number" || !Number.isInteger(policy.revision_limit) || policy.revision_limit < 0) {
    errors.revision_limit = "Must be a non-negative integer";
  }
  if (typeof policy.review_sla_hours !== "number" || !Number.isInteger(policy.review_sla_hours) || policy.review_sla_hours <= 0) errors.review_sla_hours = "Must be a positive integer";
  if (typeof policy.revision_response_hours !== "number" || !Number.isInteger(policy.revision_response_hours) || policy.revision_response_hours <= 0) errors.revision_response_hours = "Must be a positive integer";

  let templates: unknown[] = [];
  if (raw.deliverable_templates !== undefined) {
    if (Array.isArray(raw.deliverable_templates)) templates = raw.deliverable_templates;
    else errors.deliverable_templates = "Must be an array";
  }
  if (policy.creator_workflow_mode === "active_workspace" && !templates.some((template) => isRecord(template) && template.required === true)) {
    errors.deliverable_templates = "Add at least one required deliverable";
  }
  const positions = new Set<number>();
  templates.forEach((template, templateIndex) => {
    const key = `deliverable_templates.${templateIndex}`;
    if (!isRecord(template)) {
      errors[key] = "Must be an object";
      return;
    }
    if (template.id !== undefined && (typeof template.id !== "string" || !UUID_PATTERN.test(template.id))) {
      errors[`${key}.id`] = "Must be a UUID";
    }
    if (typeof template.title !== "string" || !template.title.trim()) errors[`${key}.title`] = "Title is required";
    if (!(template.platform === null || (typeof template.platform === "string" && template.platform.trim()))) {
      errors[`${key}.platform`] = "Platform must be null or a non-empty string";
    }
    if (typeof template.position !== "number" || !Number.isInteger(template.position) || template.position < 0) errors[`${key}.position`] = "Must be a non-negative integer";
    else if (positions.has(template.position as number)) errors[`${key}.position`] = "Deliverable positions must be unique";
    else positions.add(template.position as number);
    if (typeof template.required !== "boolean") errors[`${key}.required`] = "Must be a boolean";
    if (typeof template.draft_due_offset_hours !== "number" || !Number.isInteger(template.draft_due_offset_hours) || template.draft_due_offset_hours < 0) {
      errors[`${key}.draft_due_offset_hours`] = "Must be a non-negative integer";
    }
    if (policy.creator_workflow_mode === "active_workspace") {
      if (typeof template.publication_instructions !== "string" || !template.publication_instructions.trim()) {
        errors[`${key}.publication_instructions`] = "PUBLICATION_INSTRUCTIONS_REQUIRED";
      }
      if (typeof template.publication_window_hours !== "number" || !Number.isInteger(template.publication_window_hours) || template.publication_window_hours <= 0) {
        errors[`${key}.publication_window_hours`] = "PUBLICATION_WINDOW_HOURS_INVALID";
      }
      if (!Array.isArray(template.required_disclosures)) {
        errors[`${key}.required_disclosures`] = "REQUIRED_DISCLOSURES_INVALID";
      } else {
        template.required_disclosures.forEach((disclosure, disclosureIndex) => {
          if (typeof disclosure !== "string" || !disclosure.trim()) errors[`${key}.required_disclosures.${disclosureIndex}`] = "REQUIRED_DISCLOSURE_REQUIRED";
        });
      }
      if (!(template.expected_account === null || template.expected_account === undefined
        || (typeof template.expected_account === "string" && template.expected_account.trim()))) {
        errors[`${key}.expected_account`] = "EXPECTED_ACCOUNT_INVALID";
      }
      if (!isRecord(template.proof_evidence_policy)) errors[`${key}.proof_evidence_policy`] = "PROOF_EVIDENCE_POLICY_INVALID";
    }

    if (!Array.isArray(template.requirements)) {
      errors[`${key}.requirements`] = "Must be an array";
      return;
    }
    const requirementPositions = new Set<number>();
    template.requirements.forEach((requirement, requirementIndex) => {
      const requirementKey = `${key}.requirements.${requirementIndex}`;
      if (!isRecord(requirement)) {
        errors[requirementKey] = "Must be an object";
        return;
      }
      if (requirement.id !== undefined && (typeof requirement.id !== "string" || !UUID_PATTERN.test(requirement.id))) {
        errors[`${requirementKey}.id`] = "Must be a UUID";
      }
      if (typeof requirement.text !== "string" || !requirement.text.trim()) {
        errors[`${requirementKey}.text`] = "Requirement text is required";
      }
      if (typeof requirement.category !== "string" || !REQUIREMENT_CATEGORIES.has(requirement.category)) errors[`${requirementKey}.category`] = "Invalid requirement category";
      if (typeof requirement.position !== "number" || !Number.isInteger(requirement.position) || requirement.position < 0) errors[`${requirementKey}.position`] = "Must be a non-negative integer";
      else if (requirementPositions.has(requirement.position as number)) errors[`${requirementKey}.position`] = "Requirement positions must be unique";
      else requirementPositions.add(requirement.position as number);
      if (typeof requirement.required !== "boolean") errors[`${requirementKey}.required`] = "Must be a boolean";
    });
  });

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    policy: policy as MissionWorkflowPolicyInput,
    templates: templates as MissionDeliverableTemplateInput[],
  };
}

