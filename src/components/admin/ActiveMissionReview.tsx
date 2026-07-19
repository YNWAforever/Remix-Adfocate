import { useMemo, useState } from "react";
import type {
  ActiveMissionReviewCategory,
  ActiveMissionRevisionItem,
  ActiveMissionWorkflow,
  ActiveMissionWorkItem,
} from "@/lib/admin";

type StartInput = { workItemId: string; expectedState: string };
type RevisionInput = StartInput & { versionId: string; deadline: string; items: ActiveMissionRevisionItem[] };
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

export function ActiveMissionReview({
  workflow,
  selectedWorkItemId,
  onStartReview,
  onRequestRevision,
  onGrantRevision,
  onApproveVersion,
  onMarkShipped,
}: Props) {
  const [selectedId, setSelectedId] = useState(() => workItemFor(workflow.workItems, selectedWorkItemId)?.id ?? "");
  const [panel, setPanel] = useState<"revision" | "approval" | "shipping" | null>(null);
  const [deadline, setDeadline] = useState("");
  const [changeText, setChangeText] = useState("");
  const [category, setCategory] = useState<ActiveMissionReviewCategory>("other");
  const [validation, setValidation] = useState({ change: false, deadline: false });
  const [grantReason, setGrantReason] = useState("");
  const [localGrantAvailable, setLocalGrantAvailable] = useState(false);
  const [shippingNote, setShippingNote] = useState("");
  const [busy, setBusy] = useState(false);

  const item = workItemFor(workflow.workItems, selectedId);
  const mission = one(workflow.submission.missions);
  const creator = one(workflow.submission.creators);
  const version = useMemo(
    () => workflow.versions.find((candidate) => candidate.id === item?.current_submitted_version_id)
      ?? workflow.versions.filter((candidate) => candidate.mission_work_item_id === item?.id).at(-1),
    [item?.current_submitted_version_id, item?.id, workflow.versions],
  );
  const assets = workflow.assets.filter((asset) =>
    asset.mission_work_item_id === item?.id && (!asset.mission_draft_version_id || asset.mission_draft_version_id === version?.id));
  const completedRounds = workflow.reviews.filter((review) => review.mission_work_item_id === item?.id && review.state !== "open").length;
  const grantedRounds = workflow.grants
    .filter((grant) => grant.mission_work_item_id === item?.id)
    .reduce((total, grant) => total + grant.granted_count, 0);
  const revisionExhausted = completedRounds >= workflow.workflow.revision_limit + grantedRounds && !localGrantAvailable;

  if (!item) return <p>No reviewable deliverable was found.</p>;

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const sendRevision = async () => {
    const cleanChange = changeText.trim();
    const parsedDeadline = Date.parse(deadline);
    const invalid = { change: !cleanChange, deadline: !Number.isFinite(parsedDeadline) || parsedDeadline <= Date.now() };
    setValidation(invalid);
    if (invalid.change || invalid.deadline || !version) return;
    await perform(() => onRequestRevision({
      workItemId: item.id,
      expectedState: item.state,
      versionId: version.id,
      deadline: new Date(parsedDeadline).toISOString(),
      items: [{ requirementId: null, category, text: cleanChange, required: true }],
    }));
    setLocalGrantAvailable(false);
  };

  const grantRevision = async () => {
    const reason = grantReason.trim();
    if (!reason) return;
    await perform(() => onGrantRevision({ workItemId: item.id, reason, grantedCount: 1 }));
    setLocalGrantAvailable(true);
  };

  return (
    <section aria-labelledby="active-mission-review-heading" className="space-y-4 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[var(--color-soft-ink)]">{mission.title} · {creator?.display_name ?? "Creator"}</p>
          <h2 id="active-mission-review-heading" className="font-display text-2xl font-bold">{item.title}</h2>
        </div>
        {workflow.workItems.length > 1 ? (
          <label className="grid gap-1 text-sm font-bold">
            Deliverable
            <select className={FIELD} value={item.id} onChange={(event) => setSelectedId(event.target.value)}>
              {workflow.workItems.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
          </label>
        ) : null}
      </header>

      <div data-testid="review-layout" className="grid gap-4 lg:grid-cols-2">
        <article className="space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4">
          <h3 className="font-heading text-xl font-bold">Brief and checklist</h3>
          {mission.description ? <p className="whitespace-pre-wrap text-sm">{mission.description}</p> : null}
          <BriefList title="Key messages" items={mission.key_messages} />
          <BriefList title="Do" items={mission.dos} />
          <BriefList title="Do not" items={mission.donts} />
          <div>
            <h4 className="font-heading font-bold">Deliverable requirements</h4>
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
            <h3 className="font-heading text-xl font-bold">{version ? `Version ${version.version_number}` : "No submitted version"}</h3>
            {version ? <time className="text-xs text-[var(--color-soft-ink)]" dateTime={version.submitted_at}>{new Date(version.submitted_at).toLocaleString()}</time> : null}
          </div>
          {version ? (
            <>
              <div>
                <h4 className="font-heading text-sm font-bold">Caption</h4>
                <p className="mt-1 whitespace-pre-wrap text-sm">{version.caption_snapshot || "No caption supplied"}</p>
              </div>
              {version.external_draft_url_snapshot ? (
                <a className="inline-block break-all font-bold underline" href={version.external_draft_url_snapshot} target="_blank" rel="noreferrer">Open external draft</a>
              ) : null}
              <div>
                <h4 className="font-heading text-sm font-bold">Submitted checklist</h4>
                <dl className="mt-1 space-y-1 text-sm">
                  {Object.entries(version.checklist_snapshot).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3"><dt>{key}</dt><dd>{value ? "Complete" : "Not complete"}</dd></div>
                  ))}
                </dl>
              </div>
              <div>
                <h4 className="font-heading text-sm font-bold">Version assets</h4>
                {assets.length ? (
                  <ul className="mt-1 space-y-1 text-sm">
                    {assets.map((asset) => <li key={asset.id}><a className="font-bold underline" href={asset.signedUrl} target="_blank" rel="noreferrer">{asset.original_filename}</a></li>)}
                  </ul>
                ) : <p className="mt-1 text-sm text-[var(--color-soft-ink)]">No attached assets.</p>}
              </div>
            </>
          ) : null}
        </article>
      </div>

      {revisionExhausted ? (
        <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-sun)] p-4">
          <h3 className="font-heading font-bold">Revision limit reached</h3>
          <p className="mt-1 text-sm">Record why another revision is necessary before requesting it.</p>
          <label className="mt-3 grid gap-1 text-sm font-bold">
            Grant reason
            <textarea className={FIELD} value={grantReason} onChange={(event) => setGrantReason(event.target.value)} />
          </label>
          <button type="button" disabled={busy || !grantReason.trim()} onClick={() => void grantRevision()} className={`${BUTTON} mt-3 bg-white`}>Grant another revision</button>
        </div>
      ) : null}

      {panel === "revision" ? (
        <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="font-heading font-bold">Revision request for version {version?.version_number}</h3>
          <label className="grid gap-1 text-sm font-bold">Revision deadline<input type="datetime-local" className={FIELD} value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
          {validation.deadline ? <p role="alert" className="text-sm font-bold text-red-700">Choose a future revision deadline</p> : null}
          <label className="grid gap-1 text-sm font-bold">Change category<select className={FIELD} value={category} onChange={(event) => setCategory(event.target.value as ActiveMissionReviewCategory)}><option value="format">Format</option><option value="key_message">Key message</option><option value="compliance">Compliance</option><option value="quality">Quality</option><option value="other">Other</option></select></label>
          <label className="grid gap-1 text-sm font-bold">Required change 1<textarea className={FIELD} value={changeText} onChange={(event) => setChangeText(event.target.value)} /></label>
          {validation.change ? <p role="alert" className="text-sm font-bold text-red-700">Add at least one required change</p> : null}
          <button type="button" disabled={busy} onClick={() => void sendRevision()} className={`${BUTTON} bg-[var(--color-sun)]`}>Send revision request</button>
        </div>
      ) : null}

      {panel === "approval" && version ? (
        <div role="alertdialog" aria-labelledby="approval-title" aria-describedby="approval-description" className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 id="approval-title" className="font-heading font-bold">Approve version {version.version_number}?</h3>
          <p id="approval-description" className="text-sm">This approves version {version.version_number} for publishing. No reward is issued by this action.</p>
          <button type="button" disabled={busy} onClick={() => void perform(() => onApproveVersion({ workItemId: item.id, expectedState: item.state, versionId: version.id }))} className={`${BUTTON} bg-[var(--color-acid)]`}>Confirm approval</button>
        </div>
      ) : null}

      {panel === "shipping" ? (
        <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="font-heading font-bold">Mark fulfillment shipped</h3>
          <label className="grid gap-1 text-sm font-bold">Shipping note<textarea className={FIELD} value={shippingNote} onChange={(event) => setShippingNote(event.target.value)} /></label>
          <button type="button" disabled={busy} onClick={() => void perform(() => onMarkShipped({ note: shippingNote.trim() || undefined }))} className={`${BUTTON} bg-[var(--color-sky)]`}>Confirm shipped</button>
        </div>
      ) : null}

      <div data-testid="review-actions" className="sticky bottom-0 z-20 -mx-2 flex flex-wrap gap-2 border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-3 lg:static lg:mx-0">
        <button type="button" disabled={busy || item.state !== "submitted"} onClick={() => void perform(() => onStartReview({ workItemId: item.id, expectedState: item.state }))} className={`${BUTTON} bg-[var(--color-sky)]`}>Start review</button>
        <button type="button" disabled={busy || revisionExhausted || !version} onClick={() => setPanel("revision")} className={`${BUTTON} bg-[var(--color-sun)]`}>Request revision</button>
        <button type="button" disabled={busy || !version} onClick={() => setPanel("approval")} className={`${BUTTON} bg-[var(--color-acid)]`}>Approve version</button>
        {workflow.fulfillment && workflow.fulfillment.status !== "shipped" ? <button type="button" disabled={busy} onClick={() => setPanel("shipping")} className={`${BUTTON} bg-white`}>Mark shipped</button> : null}
      </div>
    </section>
  );
}

function BriefList({ title, items }: { title: string; items?: string[] | null }) {
  if (!items?.length) return null;
  return <div><h4 className="font-heading font-bold">{title}</h4><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}
