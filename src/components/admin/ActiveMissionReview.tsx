import { useMemo, useState } from "react";
import {
  AdminRequestError,
  ActiveMissionReviewCategory,
  ActiveMissionRevisionItem,
  ActiveMissionWorkflow,
  ActiveMissionWorkItem,
} from "@/lib/admin";
import { useI18n } from "@/lib/i18n";

type StartInput = { workItemId: string; expectedState: string };
type RevisionInput = StartInput & { versionId: string; deadline?: string | null; items: ActiveMissionRevisionItem[] };
type GrantInput = { workItemId: string; reason: string; grantedCount: number };
type ApproveInput = StartInput & { versionId: string };

type Props = {
  workflow: ActiveMissionWorkflow;
  selectedWorkItemId?: string;
  onStartReview: (input: StartInput) => Promise<unknown>;
  onRequestRevision: (input: RevisionInput) => Promise<unknown>;
  onGrantRevision: (input: GrantInput) => Promise<unknown>;
  onApproveVersion: (input: ApproveInput) => Promise<unknown>;
  onMarkShipped: (input: { note?: string }) => Promise<unknown>;
  onActionError?: (error: unknown) => void;
};

const BUTTON = "rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-heading text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "min-h-10 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-sm";

function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function workItemFor(items: ActiveMissionWorkItem[], selectedWorkItemId?: string) {
  return items.find((item) => item.id === selectedWorkItemId)
    ?? items.find((item) => item.state === "submitted" || item.state === "under_review")
    ?? items[0];
}

function actionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AdminRequestError) {
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function revisionDeadlineLimit(workflow: ActiveMissionWorkflow, item: ActiveMissionWorkItem, now = Date.now()) {
  const candidates: number[] = [];
  const responseHours = workflow.workflow.revision_response_hours;
  if (typeof responseHours === "number" && Number.isFinite(responseHours) && responseHours > 0) {
    candidates.push(now + responseHours * 60 * 60 * 1000);
  }
  for (const value of [workflow.workflow.deadline, item.deadline]) {
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) candidates.push(parsed);
  }
  return candidates.length ? Math.min(...candidates) : null;
}

function dateTimeLocalValue(timestamp: number) {
  const date = new Date(timestamp);
  const localTimestamp = timestamp - date.getTimezoneOffset() * 60 * 1000;
  return new Date(localTimestamp).toISOString().slice(0, 16);
}

export function ActiveMissionReview({
  workflow,
  selectedWorkItemId,
  onStartReview,
  onRequestRevision,
  onGrantRevision,
  onApproveVersion,
  onMarkShipped,
  onActionError,
}: Props) {
  const [selectedId, setSelectedId] = useState(() => workItemFor(workflow.workItems, selectedWorkItemId)?.id ?? "");
  const [panel, setPanel] = useState<"revision" | "approval" | "shipping" | null>(null);
  const [deadline, setDeadline] = useState("");
  const [changeText, setChangeText] = useState("");
  const { lang, t } = useI18n();
  const locale = lang === "zh" ? "zh-HK" : "en-US";
  const [category, setCategory] = useState<ActiveMissionReviewCategory>("other");
  const [validation, setValidation] = useState({ change: false, deadline: false });
  const [grantReason, setGrantReason] = useState("");
  const [localGrantAvailable, setLocalGrantAvailable] = useState(false);
  const [shippingNote, setShippingNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const item = workItemFor(workflow.workItems, selectedId);
  const mission = one(workflow.submission.missions);
  const creator = one(workflow.submission.creators);
  const version = useMemo(
    () => workflow.versions.find((candidate) => candidate.id === item?.current_submitted_version_id)
      ?? workflow.versions.filter((candidate) => candidate.mission_work_item_id === item?.id).at(-1),
    [item?.current_submitted_version_id, item?.id, workflow.versions],
  );
  const assets = workflow.assets.filter((asset) =>
    asset.mission_work_item_id === item?.id && asset.mission_draft_version_id === version?.id);
  const completedRounds = workflow.reviews.filter((review) => review.mission_work_item_id === item?.id && review.state !== "open").length;
  const grantedRounds = workflow.grants
    .filter((grant) => grant.mission_work_item_id === item?.id)
    .reduce((total, grant) => total + grant.granted_count, 0);
  const revisionExhausted = completedRounds >= workflow.workflow.revision_limit + grantedRounds && !localGrantAvailable;
  const canDecide = item?.state === "under_review";
  const canShip = workflow.fulfillment?.status === "preparing";
  const deadlineLimit = useMemo(
    () => item ? revisionDeadlineLimit(workflow, item) : null,
    [item, workflow],
  );
  const deadlineMax = deadlineLimit === null ? undefined : dateTimeLocalValue(deadlineLimit);

  if (!item) return <p>{t("app.admin.activeMission.review.noDeliverable")}</p>;

  const perform = async (action: () => Promise<unknown>) => {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(actionErrorMessage(error, t("app.admin.activeMission.review.actionError")));
      onActionError?.(error);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const selectWorkItem = (workItemId: string) => {
    setPanel(null);
    setDeadline("");
    setChangeText("");
    setCategory("other");
    setValidation({ change: false, deadline: false });
    setGrantReason("");
    setLocalGrantAvailable(false);
    setShippingNote("");
    setActionError(null);
    setSelectedId(workItemId);
  };

  const openRevision = () => {
    setValidation({ change: false, deadline: false });
    setDeadline(deadlineMax ?? "");
    setPanel("revision");
  };

  const sendRevision = async () => {
    const cleanChange = changeText.trim();
    const hasDeadline = Boolean(deadline.trim());
    const parsedDeadline = hasDeadline ? Date.parse(deadline) : null;
    const invalidDeadline = parsedDeadline !== null && (!Number.isFinite(parsedDeadline)
      || parsedDeadline <= Date.now()
      || (deadlineLimit !== null && parsedDeadline > deadlineLimit));
    const invalid = { change: !cleanChange, deadline: invalidDeadline };
    setValidation(invalid);
    if (invalid.change || invalid.deadline || !version || !canDecide) return;
    const succeeded = await perform(() => onRequestRevision({
      workItemId: item.id,
      expectedState: item.state,
      versionId: version.id,
      deadline: parsedDeadline === null ? null : new Date(parsedDeadline).toISOString(),
      items: [{ requirementId: null, category, text: cleanChange, required: true }],
    }));
    if (succeeded) {
      setLocalGrantAvailable(false);
      setPanel(null);
    }
  };

  const grantRevision = async () => {
    const reason = grantReason.trim();
    if (!reason || !canDecide) return;
    const succeeded = await perform(() => onGrantRevision({ workItemId: item.id, reason, grantedCount: 1 }));
    if (succeeded) setLocalGrantAvailable(true);
  };

  return (
    <section aria-labelledby="active-mission-review-heading" className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[var(--color-soft-ink)]">{mission.title} · {creator?.display_name ?? t("app.admin.activeMission.review.creator")}</p>
          <h2 id="active-mission-review-heading" className="font-display text-2xl font-bold">{item.title}</h2>
        </div>
        {workflow.workItems.length > 1 ? (
          <label className="grid gap-1 text-sm font-bold">
            {t("app.admin.activeMission.review.deliverable")}
            <select className={FIELD} value={item.id} disabled={busy} onChange={(event) => selectWorkItem(event.target.value)}>
              {workflow.workItems.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
          </label>
        ) : null}
      </header>

      <div data-testid="review-layout" className="grid gap-4 lg:grid-cols-2">
        <article className="space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4">
          <h3 className="font-heading text-xl font-bold">{t("app.admin.activeMission.review.briefChecklist")}</h3>
          {mission.description ? <p className="whitespace-pre-wrap text-sm">{mission.description}</p> : null}
          <BriefList title={t("app.admin.activeMission.review.keyMessages")} items={mission.key_messages} />
          <BriefList title={t("app.admin.activeMission.review.do")} items={mission.dos} />
          <BriefList title={t("app.admin.activeMission.review.doNot")} items={mission.donts} />
          <div>
            <h4 className="font-heading font-bold">{t("app.admin.activeMission.review.requirements")}</h4>
            <ul className="mt-2 space-y-2">
              {item.requirements_snapshot.map((requirement, index) => (
                <li key={requirement.id ?? `${requirement.text}-${index}`} className="flex gap-2 text-sm">
                  <span aria-hidden>{requirement.required === false ? "○" : "●"}</span>
                  <span>{requirement.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-heading text-xl font-bold">{version ? t("app.admin.activeMission.review.version", { number: version.version_number }) : t("app.admin.activeMission.review.noVersion")}</h3>
            {version ? <time className="text-xs text-[var(--color-soft-ink)]" dateTime={version.submitted_at}>{new Date(version.submitted_at).toLocaleString(locale)}</time> : null}
          </div>
          {version ? (
            <>
              <div>
                <h4 className="font-heading text-sm font-bold">{t("app.admin.activeMission.review.caption")}</h4>
                <p className="mt-1 whitespace-pre-wrap text-sm">{version.caption_snapshot || t("app.admin.activeMission.review.noCaption")}</p>
              </div>
              {version.external_draft_url_snapshot ? (
                <a className="inline-block break-all font-bold underline" href={version.external_draft_url_snapshot} target="_blank" rel="noreferrer">{t("app.admin.activeMission.review.openExternal")}</a>
              ) : null}
              <div>
                <h4 className="font-heading text-sm font-bold">{t("app.admin.activeMission.review.submittedChecklist")}</h4>
                <dl className="mt-1 space-y-1 text-sm">
                  {Object.entries(version.checklist_snapshot).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3"><dt>{key}</dt><dd>{value ? t("app.admin.activeMission.review.complete") : t("app.admin.activeMission.review.notComplete")}</dd></div>
                  ))}
                </dl>
              </div>
              <div>
                <h4 className="font-heading text-sm font-bold">{t("app.admin.activeMission.review.versionAssets")}</h4>
                {assets.length ? (
                  <ul className="mt-1 space-y-1 text-sm">
                    {assets.map((asset) => <li key={asset.id}><a className="font-bold underline" href={asset.signedUrl} target="_blank" rel="noreferrer">{asset.original_filename}</a></li>)}
                  </ul>
                ) : <p className="mt-1 text-sm text-[var(--color-soft-ink)]">{t("app.admin.activeMission.review.noAssets")}</p>}
              </div>
            </>
          ) : null}
        </article>
      </div>

      {actionError ? (
        <p role="alert" aria-live="assertive" className="rounded-[var(--radius)] border-2 border-red-700 bg-red-50 p-3 text-sm font-bold text-red-700">{actionError}</p>
      ) : null}

      {canDecide && revisionExhausted ? (
        <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-sun)] p-4">
          <h3 className="font-heading font-bold">{t("app.admin.activeMission.review.revisionLimit")}</h3>
          <p className="mt-1 text-sm">{t("app.admin.activeMission.review.revisionLimitHelp")}</p>
          <label className="mt-3 grid gap-1 text-sm font-bold">
            {t("app.admin.activeMission.review.grantReason")}
            <textarea className={FIELD} value={grantReason} onChange={(event) => setGrantReason(event.target.value)} />
          </label>
          <button type="button" disabled={busy || !grantReason.trim()} onClick={() => void grantRevision()} className={`${BUTTON} mt-3 bg-white`}>{t("app.admin.activeMission.review.grantAnother")}</button>
        </div>
      ) : null}

      {panel === "revision" ? (
        <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="font-heading font-bold">{t("app.admin.activeMission.review.revisionTitle", { number: version?.version_number ?? "" })}</h3>
          <label className="grid gap-1 text-sm font-bold">{t("app.admin.activeMission.review.revisionDeadline")}<input type="datetime-local" className={FIELD} value={deadline} max={deadlineMax} onChange={(event) => setDeadline(event.target.value)} /></label>
          {validation.deadline ? <p role="alert" className="text-sm font-bold text-red-700">{t("app.admin.activeMission.review.deadlineInvalid")}</p> : null}
          <label className="grid gap-1 text-sm font-bold">{t("app.admin.activeMission.review.changeCategory")}<select className={FIELD} value={category} onChange={(event) => setCategory(event.target.value as ActiveMissionReviewCategory)}><option value="format">{t("app.admin.activeMission.review.category.format")}</option><option value="key_message">{t("app.admin.activeMission.review.category.keyMessage")}</option><option value="compliance">{t("app.admin.activeMission.review.category.compliance")}</option><option value="quality">{t("app.admin.activeMission.review.category.quality")}</option><option value="other">{t("app.admin.activeMission.review.category.other")}</option></select></label>
          <label className="grid gap-1 text-sm font-bold">{t("app.admin.activeMission.review.requiredChange")}<textarea className={FIELD} value={changeText} onChange={(event) => setChangeText(event.target.value)} /></label>
          {validation.change ? <p role="alert" className="text-sm font-bold text-red-700">{t("app.admin.activeMission.review.changeInvalid")}</p> : null}
          <button type="button" disabled={busy || !canDecide} onClick={() => void sendRevision()} className={`${BUTTON} bg-[var(--color-sun)]`}>{t("app.admin.activeMission.review.sendRevision")}</button>
        </div>
      ) : null}

      {panel === "approval" && version ? (
        <div role="alertdialog" aria-labelledby="approval-title" aria-describedby="approval-description" className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 id="approval-title" className="font-heading font-bold">{t("app.admin.activeMission.review.approveTitle", { number: version.version_number })}</h3>
          <p id="approval-description" className="text-sm">{t("app.admin.activeMission.review.approveDescription", { number: version.version_number })}</p>
          <button
            type="button"
            disabled={busy || !canDecide}
            onClick={() => void perform(async () => {
              if (!canDecide) return;
              await onApproveVersion({ workItemId: item.id, expectedState: item.state, versionId: version.id });
            })}
            className={`${BUTTON} bg-[var(--color-acid)]`}
          >{t("app.admin.activeMission.review.confirmApproval")}</button>
        </div>
      ) : null}

      {panel === "shipping" ? (
        <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="font-heading font-bold">{t("app.admin.activeMission.review.shippingTitle")}</h3>
          <label className="grid gap-1 text-sm font-bold">{t("app.admin.activeMission.review.shippingNote")}<textarea className={FIELD} value={shippingNote} onChange={(event) => setShippingNote(event.target.value)} /></label>
          <button
            type="button"
            disabled={busy || !canShip}
            onClick={() => void perform(async () => {
              if (!canShip) return;
              await onMarkShipped({ note: shippingNote.trim() || undefined });
            })}
            className={`${BUTTON} bg-[var(--color-sky)]`}
          >{t("app.admin.activeMission.review.confirmShipped")}</button>
        </div>
      ) : null}

      <div data-testid="review-actions" className="sticky bottom-0 z-20 -mx-2 flex flex-wrap gap-2 border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-3 lg:static lg:mx-0">
        <button type="button" disabled={busy || item.state !== "submitted"} onClick={() => void perform(() => onStartReview({ workItemId: item.id, expectedState: item.state }))} className={`${BUTTON} bg-[var(--color-sky)]`}>{t("app.admin.activeMission.review.startReview")}</button>
        <button type="button" disabled={busy || !canDecide || revisionExhausted || !version} onClick={openRevision} className={`${BUTTON} bg-[var(--color-sun)]`}>{t("app.admin.activeMission.review.requestRevision")}</button>
        <button type="button" disabled={busy || !canDecide || !version} onClick={() => setPanel("approval")} className={`${BUTTON} bg-[var(--color-acid)]`}>{t("app.admin.activeMission.review.approveVersion")}</button>
        {canShip ? <button type="button" disabled={busy} onClick={() => setPanel("shipping")} className={`${BUTTON} bg-white`}>{t("app.admin.activeMission.review.markShipped")}</button> : null}
      </div>
    </section>
  );
}

function BriefList({ title, items }: { title: string; items?: string[] | null }) {
  if (!items?.length) return null;
  return <div><h4 className="font-heading font-bold">{title}</h4><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}
