// src/components/admin/MissionEditor.tsx
import { useState } from "react";
import { MISSION_CATEGORIES } from "@/lib/missionCategories";
import { AdminRequestError, type AdminMission, type MissionDeliverableTemplateInput, type MissionDraftInput } from "@/lib/admin";
import { ArrayInput } from "./ArrayInput";
import { PlatformPicker } from "./PlatformPicker";
import { MissionBrief } from "@/components/MissionBrief";
import { MissionFacts } from "@/components/MissionFacts";
import type { Mission } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";

const MISSION_TYPES = ["koc_trial", "ugc", "clipping", "affiliate", "performance_cpm", "live_commerce", "brand_ambassador"] as const;
const REQUIREMENT_CATEGORIES = ["format", "key_message", "compliance", "quality", "other"] as const;
const LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;
const EFFORTS = ["", "low", "medium", "high"] as const;

type Mode = "create" | "edit";
type Props = {
  mode: Mode;
  initial?: AdminMission;
  workspaces?: { id: string; name: string }[];
  engaged?: boolean;
  onSave: (body: MissionDraftInput) => Promise<unknown>;
  saving?: boolean;
};

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
let editorKeySequence = 0;
const nextEditorKey = () => `mission-workflow-editor-${editorKeySequence++}`;
const PUBLICATION_POLICY_ERROR_MESSAGE_KEYS: Record<string, string> = {
  PUBLICATION_INSTRUCTIONS_REQUIRED: "app.admin.missionEditor.publicationInstructionsRequired",
  PUBLICATION_WINDOW_HOURS_INVALID: "app.admin.missionEditor.publicationWindowInvalid",
  REQUIRED_DISCLOSURES_INVALID: "app.admin.missionEditor.requiredDisclosuresInvalid",
  REQUIRED_DISCLOSURE_REQUIRED: "app.admin.missionEditor.requiredDisclosuresInvalid",
  EXPECTED_ACCOUNT_INVALID: "app.admin.missionEditor.expectedAccountInvalid",
  PROOF_EVIDENCE_POLICY_INVALID: "app.admin.missionEditor.proofEvidencePolicyInvalid",
};


type EditableRequirement = MissionDeliverableTemplateInput["requirements"][number] & { editorKey: string };
type EditableTemplate = Omit<MissionDeliverableTemplateInput, "requirements" | "proof_evidence_policy"> & {
  editorKey: string;
  proof_evidence_policy: Record<string, unknown>;
  proofEvidencePolicyText: string;
  requirements: EditableRequirement[];
};

function toEditableTemplates(templates: MissionDeliverableTemplateInput[]): EditableTemplate[] {
  return templates.map((template) => ({
    ...template,
    editorKey: nextEditorKey(),
    proofEvidencePolicyText: JSON.stringify(template.proof_evidence_policy),
    requirements: template.requirements.map((requirement) => ({ ...requirement, editorKey: nextEditorKey() })),
  }));
}

function parsedEvidencePolicy(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function toTemplatePayload(templates: EditableTemplate[]): MissionDeliverableTemplateInput[] {
  return templates.map(({ editorKey: templateKey, proofEvidencePolicyText, requirements, ...template }) => {
    void templateKey;
    const proofEvidencePolicy = parsedEvidencePolicy(proofEvidencePolicyText);
    if (!proofEvidencePolicy) throw new Error("invalid_proof_evidence_policy");
    return {
      ...template,
      proof_evidence_policy: proofEvidencePolicy,
      requirements: requirements.map(({ editorKey: requirementKey, ...requirement }) => {
        void requirementKey;
        return requirement;
      }),
    };
  });
}

export function MissionEditor({ mode, initial, workspaces = [], engaged = false, onSave, saving }: Props) {
  const { t } = useI18n();
  const published = mode === "edit" && initial?.status !== "draft";
  const [f, setF] = useState({
    workspace_id: initial?.workspace_id ?? workspaces[0]?.id ?? "",
    slug: initial?.slug ?? "",
    title: initial?.title ?? "",
    mission_type: initial?.mission_type ?? "ugc",
    description: initial?.description ?? "",
    category: initial?.category ?? "",
    access_type: initial?.access_type ?? "open",
    required_level: initial?.required_level ?? "L0",
    points_reward: String(initial?.points_reward ?? ""),
    cash_reward: initial?.cash_reward != null ? String(initial.cash_reward) : "",
    cpm_rate: initial?.cpm_rate != null ? String(initial.cpm_rate) : "",
    cpm_budget_pool: initial?.cpm_budget_pool != null ? String(initial.cpm_budget_pool) : "",
    deadline: initial?.deadline ?? "",
    quota: String(initial?.quota ?? "10"),
    deliverables: initial?.deliverables ?? [],
    requirements: initial?.requirements ?? [],
    platforms: initial?.platforms ?? [],
    effort: initial?.effort ?? "",
    target_audience: initial?.target_audience ?? "",
    dos: initial?.dos ?? [],
    donts: initial?.donts ?? [],
    key_messages: initial?.key_messages ?? [],
    reference_links: initial?.reference_links ?? [],
    creator_workflow_mode: initial?.creator_workflow_mode ?? "legacy",
    fulfillment_required: initial?.fulfillment_required ?? false,
    revision_limit: String(initial?.revision_limit ?? 2),
    review_sla_hours: String(initial?.review_sla_hours ?? 48),
    revision_response_hours: String(initial?.revision_response_hours ?? 48),
    deliverable_templates: toEditableTemplates(initial?.deliverable_templates ?? []),
  });
  const [preview, setPreview] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const isCpm = f.mission_type === "performance_cpm";

  const submit = async () => {
    setErrors({});
    const invalidEvidencePolicyIndex = f.creator_workflow_mode === "active_workspace"
      ? f.deliverable_templates.findIndex((template) => parsedEvidencePolicy(template.proofEvidencePolicyText) === null)
      : -1;
    if (invalidEvidencePolicyIndex >= 0) {
      setErrors({
        [`deliverable_templates.${invalidEvidencePolicyIndex}.proof_evidence_policy`]: "PROOF_EVIDENCE_POLICY_INVALID",
      });
      return;
    }
    const body: MissionDraftInput = {
      workspace_id: f.workspace_id, slug: f.slug, title: f.title, mission_type: f.mission_type,
      description: f.description || null, category: f.category || null,
      access_type: f.access_type as "open" | "application", required_level: f.required_level,
      // Off-type reward fields are nulled on save so no stale values persist.
      points_reward: isCpm ? 0 : Number(f.points_reward || 0),
      cash_reward: isCpm ? null : numOrNull(f.cash_reward),
      cpm_rate: isCpm ? numOrNull(f.cpm_rate) : null,
      cpm_budget_pool: isCpm ? numOrNull(f.cpm_budget_pool) : null,
      deadline: f.deadline || null, quota: Number(f.quota || 0),
      creator_workflow_mode: f.creator_workflow_mode,
      fulfillment_required: f.fulfillment_required,
      revision_limit: Number(f.revision_limit),
      review_sla_hours: Number(f.review_sla_hours),
      revision_response_hours: Number(f.revision_response_hours),
      deliverable_templates: toTemplatePayload(f.deliverable_templates),
      deliverables: f.deliverables, requirements: f.requirements, platforms: f.platforms,
      effort: (f.effort || null) as MissionDraftInput["effort"],
      target_audience: f.target_audience.trim() || null,
      dos: f.dos, donts: f.donts, key_messages: f.key_messages, reference_links: f.reference_links,
    };
    try {
      await onSave(body);
    } catch (e) {
      if (e instanceof AdminRequestError && e.fields) setErrors(e.fields);
      else window.alert(e instanceof Error ? e.message : "儲存失敗");
    }
  };

  const Err = ({ k, nested = false }: { k: string; nested?: boolean }) => {
    const raw = errors[k] ?? (nested
      ? Object.entries(errors).find(([field]) => field.startsWith(`${k}.`))?.[1]
      : undefined);
    if (!raw) return null;
    const messageKey = PUBLICATION_POLICY_ERROR_MESSAGE_KEYS[raw];
    return <p className="text-xs font-bold text-red-600">{messageKey ? t(messageKey) : raw}</p>;
  };
  const input = "h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm disabled:opacity-50";
  const area = "w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm";
  const lockNote = (reason: string) => <span className="ml-2 text-xs text-[var(--color-soft-ink)]">{reason}</span>;

  const previewMission: Mission = {
    id: initial?.id ?? "preview",
    slug: f.slug || "preview",
    title: f.title || "（未命名任務）",
    description: f.description || undefined,
    category: f.category || undefined,
    mission_type: f.mission_type,
    access_type: f.access_type,
    points_reward: Number(f.points_reward || 0),
    cash_reward: numOrNull(f.cash_reward),
    required_level: f.required_level,
    deliverables: f.deliverables,
    requirements: f.requirements,
    platforms: f.platforms,
    effort: (f.effort || null) as Mission["effort"],
    target_audience: f.target_audience.trim() || null,
    dos: f.dos,
    donts: f.donts,
    key_messages: f.key_messages,
    reference_links: f.reference_links,
    deadline: f.deadline || undefined,
    quota: Number(f.quota || 0),
    filled: initial?.filled ?? 0,
    status: initial?.status ?? "draft",
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">基本</h2>
        <label className="block text-sm">品牌
          <select aria-label="品牌" className={input} value={f.workspace_id} disabled={mode === "edit"} onChange={set("workspace_id")}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">標題 (zh-HK)
          <input aria-label="標題" className={input} value={f.title} onChange={set("title")} /><Err k="title" />
        </label>
        <label className="block text-sm">Slug (english){published ? lockNote("已發佈：不可更改") : null}
          <input aria-label="Slug" className={input} value={f.slug} disabled={published} onChange={set("slug")} /><Err k="slug" />
        </label>
        <label className="block text-sm">分類
          <select aria-label="分類" className={input} value={f.category} onChange={set("category")}>
            <option value="">— 選擇 —</option>
            {MISSION_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select><Err k="category" />
        </label>
        <label className="block text-sm">任務類型{published ? lockNote("已發佈：不可更改") : null}
          <select aria-label="任務類型" className={input} value={f.mission_type} disabled={published} onChange={set("mission_type")}>
            {MISSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select><Err k="mission_type" />
        </label>
        <label className="block text-sm">參與方式{engaged ? lockNote("已鎖定") : null}
          <select aria-label="參與方式" className={input} value={f.access_type} disabled={engaged} onChange={set("access_type")}>
            <option value="open">公開 (open)</option>
            <option value="application">申請制 (application)</option>
          </select><Err k="access_type" />
        </label>
        <label className="block text-sm">等級要求{engaged ? lockNote("已鎖定") : null}
          <select aria-label="等級要求" className={input} value={f.required_level} disabled={engaged} onChange={set("required_level")}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select><Err k="required_level" />
        </label>
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">獎勵{engaged ? lockNote("已鎖定") : null}</h2>
        {isCpm ? (
          <>
            <label className="block text-sm">CPM 單價
              <input aria-label="CPM 單價" className={input} type="number" value={f.cpm_rate} disabled={engaged} onChange={set("cpm_rate")} /><Err k="cpm_rate" />
            </label>
            <label className="block text-sm">預算池
              <input aria-label="預算池" className={input} type="number" value={f.cpm_budget_pool} disabled={engaged} onChange={set("cpm_budget_pool")} /><Err k="cpm_budget_pool" />
            </label>
          </>
        ) : (
          <>
            <label className="block text-sm">積分獎勵
              <input aria-label="積分獎勵" className={input} type="number" value={f.points_reward} disabled={engaged} onChange={set("points_reward")} /><Err k="points_reward" />
            </label>
            <label className="block text-sm">現金獎勵 (HK$)
              <input aria-label="現金獎勵" className={input} type="number" value={f.cash_reward} disabled={engaged} onChange={set("cash_reward")} /><Err k="cash_reward" />
            </label>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">名額與期限</h2>
        <label className="block text-sm">名額{engaged ? lockNote(`不可低於已參與人數 (${initial?.filled ?? 0})`) : null}
          <input aria-label="名額" className={input} type="number" min={engaged ? initial?.filled ?? 1 : 1} value={f.quota} onChange={set("quota")} /><Err k="quota" />
        </label>
        <label className="block text-sm">截止日期{engaged ? lockNote("只可延後") : null}
          <input aria-label="截止日期" className={input} type="date" value={f.deadline} onChange={set("deadline")} /><Err k="deadline" />
        </label>
      </section>

      <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <h2 className="font-heading font-bold">簡介</h2>
        <label className="block text-sm">任務簡介
          <textarea aria-label="任務簡介" rows={4} className={area} value={f.description} onChange={set("description")} /><Err k="description" />
        </label>
        <label className="block text-sm">Creator workflow
          <select aria-label="Creator workflow" className={input} value={f.creator_workflow_mode} onChange={set("creator_workflow_mode")}>
            <option value="legacy">Legacy submission</option>
            <option value="active_workspace">Active mission workspace</option>
          </select><Err k="creator_workflow_mode" />
        </label>

        {f.creator_workflow_mode === "active_workspace" ? (
          <div className="space-y-3 rounded-[var(--radius)] border border-[var(--color-ink)] p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                aria-label="Fulfillment required"
                type="checkbox"
                checked={f.fulfillment_required}
                onChange={(event) => setF((previous) => ({ ...previous, fulfillment_required: event.target.checked }))}
              />
              Fulfillment required
            </label>
            <label className="block text-sm">Revision limit
              <input aria-label="Revision limit" className={input} type="number" min={0} value={f.revision_limit} onChange={set("revision_limit")} />
            </label>
            <label className="block text-sm">Review SLA hours
              <input aria-label="Review SLA hours" className={input} type="number" min={1} value={f.review_sla_hours} onChange={set("review_sla_hours")} />
            </label>
            <label className="block text-sm">Revision response hours
              <input aria-label="Revision response hours" className={input} type="number" min={1} value={f.revision_response_hours} onChange={set("revision_response_hours")} />
            </label>
            <button
              type="button"
              onClick={() => setF((previous) => ({
                ...previous,
                deliverable_templates: [...previous.deliverable_templates, {
                  editorKey: nextEditorKey(),
                  title: "",
                  platform: null,
                  position: previous.deliverable_templates.length,
                  required: true,
                  draft_due_offset_hours: 0,
                  publication_instructions: "",
                  publication_window_hours: 72,
                  required_disclosures: [],
                  expected_account: null,
                  proof_evidence_policy: {},
                  proofEvidencePolicyText: "{}",
                  requirements: [],
                } satisfies EditableTemplate],
              }))}
              className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-bold"
            >
              Add deliverable
            </button>
            {f.deliverable_templates.map((template, templateIndex) => (
              <fieldset key={template.editorKey} className="space-y-3 rounded-[var(--radius)] border border-[var(--color-ink)] p-3">
                <legend className="px-1 text-sm font-bold">Deliverable {templateIndex + 1}</legend>
                <label className="block text-sm">Title
                  <input
                    aria-label={`Deliverable title ${templateIndex + 1}`}
                    className={input}
                    value={template.title}
                    onChange={(event) => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => (
                        index === templateIndex ? { ...item, title: event.target.value } : item
                      )),
                    }))}
                  />
                </label>
                <label className="block text-sm">Platform (optional)
                  <input
                    aria-label={`Deliverable platform ${templateIndex + 1}`}
                    className={input}
                    value={template.platform ?? ""}
                    onChange={(event) => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => (
                        index === templateIndex ? { ...item, platform: event.target.value.trim() || null } : item
                      )),
                    }))}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    aria-label={`Deliverable required ${templateIndex + 1}`}
                    type="checkbox"
                    checked={template.required}
                    onChange={(event) => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => (
                        index === templateIndex ? { ...item, required: event.target.checked } : item
                      )),
                    }))}
                  />
                  Required deliverable
                </label>
                <label className="block text-sm">Draft due offset (hours)
                  <input
                    aria-label={`Draft due offset ${templateIndex + 1}`}
                    className={input}
                    type="number"
                    min={0}
                    value={template.draft_due_offset_hours}
                    onChange={(event) => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => (
                        index === templateIndex ? { ...item, draft_due_offset_hours: Number(event.target.value) } : item
                      )),
                    }))}
                  />
                </label>
                <label className="block text-sm">{t("app.admin.missionEditor.publicationInstructions")}
                  <textarea
                    aria-label={t("app.admin.missionEditor.publicationInstructionsAria", { position: templateIndex + 1 })}
                    rows={3}
                    className={area}
                    value={template.publication_instructions}
                    onChange={(event) => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => (
                        index === templateIndex ? { ...item, publication_instructions: event.target.value } : item
                      )),
                    }))}
                  />
                </label>
                  <Err k={`deliverable_templates.${templateIndex}.publication_instructions`} />
                <label className="block text-sm">{t("app.admin.missionEditor.publicationWindow")}
                  <input
                    aria-label={t("app.admin.missionEditor.publicationWindowAria", { position: templateIndex + 1 })}
                    className={input}
                    type="number"
                    min={1}
                    value={template.publication_window_hours}
                    onChange={(event) => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => (
                        index === templateIndex ? { ...item, publication_window_hours: Number(event.target.value) } : item
                      )),
                    }))}
                  />
                </label>
                  <Err k={`deliverable_templates.${templateIndex}.publication_window_hours`} />
                <label className="block text-sm">{t("app.admin.missionEditor.requiredDisclosures")}
                  <textarea
                    aria-label={t("app.admin.missionEditor.requiredDisclosuresAria", { position: templateIndex + 1 })}
                    rows={3}
                    className={area}
                    value={template.required_disclosures.join("\n")}
                    onChange={(event) => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => (
                        index === templateIndex ? {
                          ...item,
                          required_disclosures: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
                        } : item
                      )),
                    }))}
                  />
                </label>
                  <Err k={`deliverable_templates.${templateIndex}.required_disclosures`} nested />
                <label className="block text-sm">{t("app.admin.missionEditor.expectedAccount")}
                  <input
                    aria-label={t("app.admin.missionEditor.expectedAccountAria", { position: templateIndex + 1 })}
                    className={input}
                    value={template.expected_account ?? ""}
                    onChange={(event) => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => (
                        index === templateIndex ? { ...item, expected_account: event.target.value.trim() || null } : item
                      )),
                    }))}
                  />
                </label>
                  <Err k={`deliverable_templates.${templateIndex}.expected_account`} />
                <label className="block text-sm">{t("app.admin.missionEditor.proofEvidencePolicy")}
                  <textarea
                    aria-label={t("app.admin.missionEditor.proofEvidencePolicyAria", { position: templateIndex + 1 })}
                    rows={2}
                    className={area}
                    value={template.proofEvidencePolicyText}
                    onChange={(event) => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => (
                        index === templateIndex ? { ...item, proofEvidencePolicyText: event.target.value } : item
                      )),
                    }))}
                  />
                  <Err k={`deliverable_templates.${templateIndex}.proof_evidence_policy`} />
                </label>
                <button
                  type="button"
                  aria-label={`Remove deliverable ${templateIndex + 1}`}
                  className="rounded-full border border-[var(--color-ink)] px-3 py-1 text-sm"
                  onClick={() => setF((previous) => ({
                    ...previous,
                    deliverable_templates: previous.deliverable_templates
                      .filter((_, index) => index !== templateIndex)
                      .map((item, position) => ({ ...item, position })),
                  }))}
                >
                  Remove deliverable
                </button>

                <div className="space-y-3 border-l-2 border-[var(--color-ink)] pl-3">
                  <p className="text-sm font-bold">Checklist</p>
                  {template.requirements.map((requirement, requirementIndex) => (
                    <fieldset key={requirement.editorKey} className="space-y-2">
                      <legend className="text-xs font-bold">Checklist item {requirementIndex + 1}</legend>
                      <label className="block text-sm">Category
                        <select
                          aria-label={`Checklist category ${requirementIndex + 1} for deliverable ${templateIndex + 1}`}
                          className={input}
                          value={requirement.category}
                          onChange={(event) => setF((previous) => ({
                            ...previous,
                            deliverable_templates: previous.deliverable_templates.map((item, index) => index === templateIndex
                              ? { ...item, requirements: item.requirements.map((check, checkIndex) => checkIndex === requirementIndex
                                ? { ...check, category: event.target.value as EditableRequirement["category"] }
                                : check) }
                              : item),
                          }))}
                        >
                          {REQUIREMENT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                      </label>
                      <label className="block text-sm">Requirement
                        <input
                          aria-label={`Checklist text ${requirementIndex + 1} for deliverable ${templateIndex + 1}`}
                          className={input}
                          value={requirement.text}
                          onChange={(event) => setF((previous) => ({
                            ...previous,
                            deliverable_templates: previous.deliverable_templates.map((item, index) => index === templateIndex
                              ? { ...item, requirements: item.requirements.map((check, checkIndex) => checkIndex === requirementIndex
                                ? { ...check, text: event.target.value }
                                : check) }
                              : item),
                          }))}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          aria-label={`Checklist required ${requirementIndex + 1} for deliverable ${templateIndex + 1}`}
                          type="checkbox"
                          checked={requirement.required}
                          onChange={(event) => setF((previous) => ({
                            ...previous,
                            deliverable_templates: previous.deliverable_templates.map((item, index) => index === templateIndex
                              ? { ...item, requirements: item.requirements.map((check, checkIndex) => checkIndex === requirementIndex
                                ? { ...check, required: event.target.checked }
                                : check) }
                              : item),
                          }))}
                        />
                        Required checklist item
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove checklist item ${requirementIndex + 1} from deliverable ${templateIndex + 1}`}
                        className="rounded-full border border-[var(--color-ink)] px-3 py-1 text-sm"
                        onClick={() => setF((previous) => ({
                          ...previous,
                          deliverable_templates: previous.deliverable_templates.map((item, index) => index === templateIndex
                            ? { ...item, requirements: item.requirements
                              .filter((_, checkIndex) => checkIndex !== requirementIndex)
                              .map((check, position) => ({ ...check, position })) }
                            : item),
                        }))}
                      >
                        Remove checklist item
                      </button>
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    aria-label={`Add checklist item to deliverable ${templateIndex + 1}`}
                    className="rounded-full border border-[var(--color-ink)] px-3 py-1 text-sm font-bold"
                    onClick={() => setF((previous) => ({
                      ...previous,
                      deliverable_templates: previous.deliverable_templates.map((item, index) => index === templateIndex
                        ? { ...item, requirements: [...item.requirements, {
                          editorKey: nextEditorKey(), category: "other", text: "", required: true, position: item.requirements.length,
                        }] }
                        : item),
                    }))}
                  >
                    Add checklist item
                  </button>
                </div>
              </fieldset>
            ))}
            <Err k="deliverable_templates" />
          </div>
        ) : (
          <>
            <p className="block text-sm font-bold">交付內容</p>
            <ArrayInput value={f.deliverables} onChange={(v) => setF({ ...f, deliverables: v })} placeholder="新增交付項目…" />

            <p className="block text-sm font-bold">注意事項 / 要求</p>
            <ArrayInput value={f.requirements} onChange={(v) => setF({ ...f, requirements: v })} placeholder="新增要求…" />
          </>
        )}

        <p className="block text-sm font-bold">發佈平台</p>
        <PlatformPicker value={f.platforms} onChange={(v) => setF({ ...f, platforms: v })} />

        <label className="block text-sm font-bold" htmlFor="m-audience">目標受眾</label>
        <textarea
          id="m-audience"
          aria-label="目標受眾"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm"
          rows={2}
          value={f.target_audience}
          onChange={(e) => setF({ ...f, target_audience: e.target.value })}
        />

        <p className="block text-sm font-bold">建議做法（Do's）</p>
        <ArrayInput value={f.dos} onChange={(v) => setF({ ...f, dos: v })} placeholder="新增建議做法…" />

        <p className="block text-sm font-bold">避免事項（Don'ts）</p>
        <ArrayInput value={f.donts} onChange={(v) => setF({ ...f, donts: v })} placeholder="新增避免事項…" />

        <p className="block text-sm font-bold">重點訊息</p>
        <ArrayInput value={f.key_messages} onChange={(v) => setF({ ...f, key_messages: v })} placeholder="重點訊息…" />

        <p className="block text-sm font-bold">參考及素材連結</p>
        <ArrayInput value={f.reference_links} onChange={(v) => setF({ ...f, reference_links: v })} placeholder="https://…" />

        <label className="block text-sm">投入程度
          <select aria-label="投入程度" className={input} value={f.effort} onChange={set("effort")}>
            {EFFORTS.map((e) => <option key={e} value={e}>{e === "" ? "— 不指定 —" : e}</option>)}
          </select><Err k="effort" />
        </label>
      </section>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-bold"
        >
          {preview ? "隱藏預覽" : "預覽"}
        </button>
        {preview && (
          <div className="space-y-3 rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-3">
            <MissionFacts mission={previewMission} />
            <MissionBrief mission={previewMission} />
          </div>
        )}
      </div>

      <button onClick={submit} disabled={saving} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-2 font-heading font-bold">
        {mode === "create" ? "儲存草稿" : "儲存變更"}
      </button>
    </div>
  );
}
