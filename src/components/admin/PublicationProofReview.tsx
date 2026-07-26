import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActiveMissionPublicationProofAttempt,
  ActiveMissionPublicationProofReview,
  ActiveMissionWorkflow,
  PublicationProofChecklistInput,
  PublicationProofCorrectionInput,
} from "@/lib/admin";
import { useI18n } from "@/lib/i18n";

type ProofActionBase = {
  workItemId: string;
  attemptId: string;
  expectedState: string;
  expectedRevision: number;
};

type InstructionInput = {
  workItemId: string;
  expectedState: string;
  expectedRevision: number;
  overrideReason: string;
  instructions: {
    publicationInstructions: string;
    publicationWindowHours: number;
    requiredDisclosures: string[];
    expectedAccount: string | null;
    proofEvidencePolicy: Record<string, unknown>;
  };
};

export type PublicationProofReviewProps = {
  workflow: ActiveMissionWorkflow;
  selectedWorkItemId?: string;
  selectedAttemptId?: string;
  currentOperatorId: string;
  busy?: boolean;
  onClaim: (input: ProofActionBase) => Promise<unknown>;
  onRequestCorrection: (input: ProofActionBase & {
    checklist: PublicationProofChecklistInput;
    corrections: PublicationProofCorrectionInput[];
    summary?: string | null;
  }) => Promise<unknown>;
  onVerify: (input: ProofActionBase & {
    checklist: PublicationProofChecklistInput;
    summary?: string | null;
  }) => Promise<unknown>;
  onRefreshMetadata: (input: ProofActionBase) => Promise<unknown>;
  onSetInstructions: (input: InstructionInput) => Promise<unknown>;
  onActionError?: (error: unknown) => void;
};

const BUTTON = "min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-heading text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "min-h-11 w-full rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-2 text-sm";
const EMPTY_CHECKLIST: PublicationProofChecklistInput = {
  publiclyAccessible: false,
  platformMatches: false,
  accountMatches: false,
  contentMatchesApprovedVersion: false,
  timingAcceptable: false,
  disclosuresPresent: false,
};
const CHECKLIST_KEYS = Object.keys(EMPTY_CHECKLIST) as Array<keyof PublicationProofChecklistInput>;
const CATEGORIES: PublicationProofCorrectionInput["category"][] = [
  "access", "platform", "account", "content", "timing", "disclosure", "evidence", "other",
];

const COPY = {
  en: {
    proofAttempt: (number: number) => `Publication proof attempt ${number}`,
    submittedLate: "Submitted late",
    approvedDraft: "Approved immutable draft",
    noApprovedDraft: "No approved draft version is available.",
    frozenInstructions: "Frozen publication instructions",
    platform: "Platform",
    expectedAccount: "Expected account",
    deadline: "Publication deadline",
    disclosures: "Required disclosures",
    publishedUrls: "Published URLs",
    primaryUrl: "Primary published URL",
    additionalUrl: (number: number) => `Additional published URL ${number}`,
    metadata: "Bounded page metadata",
    metadataUnavailable: "Automatic metadata is unavailable. Continue with manual review.",
    refreshMetadata: "Refresh metadata",
    evidence: "Private evidence",
    noEvidence: "No private evidence was submitted.",
    history: "Prior attempts and decisions",
    noHistory: "No prior proof attempts.",
    attempt: (number: number) => `Attempt ${number}`,
    checklist: "Structured review checklist",
    checklistLabels: {
      publiclyAccessible: "Publicly accessible",
      platformMatches: "Platform matches",
      accountMatches: "Account matches",
      contentMatchesApprovedVersion: "Content matches approved version",
      timingAcceptable: "Timing acceptable",
      disclosuresPresent: "Disclosures present",
    },
    claim: "Claim review",
    claimedBy: "Claimed by",
    addCorrection: "Add correction",
    requestCorrection: "Request correction",
    correctionCategory: (number: number) => `Correction category ${number}`,
    correctionText: (number: number) => `Correction ${number}`,
    remove: "Remove",
    sendCorrections: "Send correction request",
    correctionRequired: "Add at least one categorized correction.",
    summary: "Review summary (optional)",
    verify: "Verify proof",
    verifyTitle: (number: number) => `Verify publication proof attempt ${number}?`,
    noReward: "No reward is issued by this action.",
    typeAttempt: (number: number) => `Type attempt number ${number} to confirm`,
    confirmVerification: "Confirm verification",
    cancelVerification: "Cancel verification",
    actionFailed: "The proof review action could not be completed.",
    instructionsRequired: "Publication setup required",
    instructionText: "Publication instructions",
    windowHours: "Publication window (hours)",
    account: "Expected account (optional)",
    disclosureList: "Required disclosures (one per line)",
    evidenceRequired: "Require private evidence",
    overrideReason: "Setup reason",
    saveInstructions: "Save and freeze instructions",
    setupInvalid: "Complete the publication instructions, window, and setup reason.",
  },
  zh: {
    proofAttempt: (number: number) => `發佈證明第 ${number} 次提交`,
    submittedLate: "逾期提交",
    approvedDraft: "已核准且不可修改的草稿",
    noApprovedDraft: "未有可用的已核准草稿版本。",
    frozenInstructions: "已凍結的發佈指示",
    platform: "平台",
    expectedAccount: "指定帳戶",
    deadline: "發佈截止時間",
    disclosures: "必須披露內容",
    publishedUrls: "已發佈連結",
    primaryUrl: "主要發佈連結",
    additionalUrl: (number: number) => `其他發佈連結 ${number}`,
    metadata: "有限頁面資料",
    metadataUnavailable: "未能取得自動頁面資料，請繼續人手審批。",
    refreshMetadata: "重新擷取頁面資料",
    evidence: "私人證明檔案",
    noEvidence: "創作者沒有提交私人證明檔案。",
    history: "過往提交及決定",
    noHistory: "沒有過往發佈證明。",
    attempt: (number: number) => `第 ${number} 次提交`,
    checklist: "結構化審批清單",
    checklistLabels: {
      publiclyAccessible: "公開可存取",
      platformMatches: "平台相符",
      accountMatches: "帳戶相符",
      contentMatchesApprovedVersion: "內容符合已核准版本",
      timingAcceptable: "發佈時間可接受",
      disclosuresPresent: "披露內容齊備",
    },
    claim: "接手審批",
    claimedBy: "審批人員",
    addCorrection: "新增修正項目",
    requestCorrection: "要求修正",
    correctionCategory: (number: number) => `修正類別 ${number}`,
    correctionText: (number: number) => `修正項目 ${number}`,
    remove: "移除",
    sendCorrections: "送出修正要求",
    correctionRequired: "請新增至少一項已分類的修正要求。",
    summary: "審批摘要（選填）",
    verify: "核實證明",
    verifyTitle: (number: number) => `核實第 ${number} 次發佈證明？`,
    noReward: "此操作不會發放任何獎賞。",
    typeAttempt: (number: number) => `輸入提交次數 ${number} 以確認`,
    confirmVerification: "確認核實",
    cancelVerification: "取消核實",
    actionFailed: "未能完成發佈證明審批操作。",
    instructionsRequired: "需要設定發佈資料",
    instructionText: "發佈指示",
    windowHours: "發佈時限（小時）",
    account: "指定帳戶（選填）",
    disclosureList: "必須披露內容（每行一項）",
    evidenceRequired: "必須提交私人證明",
    overrideReason: "設定原因",
    saveInstructions: "儲存並凍結指示",
    setupInvalid: "請填妥發佈指示、時限及設定原因。",
  },
} as const;

function itemRevision(item: ActiveMissionWorkflow["workItems"][number]) {
  const revision = (item as { revision?: unknown }).revision;
  return typeof revision === "number" && Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function currentAttemptId(item: ActiveMissionWorkflow["workItems"][number]) {
  const id = (item as { current_proof_attempt_id?: unknown }).current_proof_attempt_id;
  return typeof id === "string" ? id : null;
}

function safeMetadata(attempt: ActiveMissionPublicationProofAttempt) {
  const allowed = ["pageTitle", "finalCanonicalUrl", "httpStatusCategory", "openGraphType", "declaredPublicationTime", "fetchedAt"];
  return allowed.flatMap((key) => {
    const value = attempt.metadataSnapshot[key];
    return typeof value === "string" && value ? [[key, value] as const] : [];
  });
}

function reviewFor(workflow: ActiveMissionWorkflow, attemptId: string) {
  return workflow.proofReviews?.find((review) => review.attemptId === attemptId) ?? null;
}

export function PublicationProofReview({
  workflow, selectedWorkItemId, selectedAttemptId, currentOperatorId, busy = false,
  onClaim, onRequestCorrection, onVerify, onRefreshMetadata, onSetInstructions, onActionError,
}: PublicationProofReviewProps) {
  const { lang } = useI18n();
  const c = COPY[lang === "zh" ? "zh" : "en"];
  const item = workflow.workItems.find((candidate) => candidate.id === selectedWorkItemId)
    ?? workflow.workItems.find((candidate) => candidate.state.startsWith("proof_"))
    ?? workflow.workItems[0];
  const attempts = useMemo(() => (workflow.proofAttempts ?? [])
    .filter((attempt) => attempt.workItemId === item?.id)
    .sort((a, b) => a.attemptNumber - b.attemptNumber), [item?.id, workflow.proofAttempts]);
  const attempt = attempts.find((candidate) => candidate.id === selectedAttemptId)
    ?? attempts.find((candidate) => candidate.id === (item ? currentAttemptId(item) : null))
    ?? attempts.at(-1);
  const review = attempt ? reviewFor(workflow, attempt.id) : null;
  const approvedVersion = workflow.versions.find((version) => version.id === item?.approved_version_id);
  const approvedAssets = workflow.assets.filter((asset) =>
    asset.mission_work_item_id === item?.id && asset.mission_draft_version_id === approvedVersion?.id);
  const instructions = workflow.publicationInstructions?.find((value) => value.workItemId === item?.id);
  const proofAssets = workflow.proofAssets?.filter((asset) => asset.attemptId === attempt?.id) ?? [];
  const claimedByCurrent = item?.state === "proof_under_review" && review?.reviewerId === currentOperatorId;
  const [checklist, setChecklist] = useState<PublicationProofChecklistInput>(EMPTY_CHECKLIST);
  const [corrections, setCorrections] = useState<PublicationProofCorrectionInput[]>([]);
  const [summary, setSummary] = useState("");
  const [correctionError, setCorrectionError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [attemptConfirmation, setAttemptConfirmation] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [setup, setSetup] = useState({
    publicationInstructions: "", publicationWindowHours: "48", expectedAccount: "",
    requiredDisclosures: "", evidenceRequired: false, overrideReason: "",
  });
  const [setupError, setSetupError] = useState(false);
  const firstCorrectionRef = useRef<HTMLTextAreaElement>(null);
  const focusCorrectionAfterAddRef = useRef(false);
  const verifyInputRef = useRef<HTMLInputElement>(null);
  const verifyTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreVerifyFocusRef = useRef(false);

  useEffect(() => {
    const saved = review?.checklist;
    setChecklist(saved ? {
      publiclyAccessible: Boolean(saved.publiclyAccessible ?? saved.publicly_accessible),
      platformMatches: Boolean(saved.platformMatches ?? saved.platform_matches),
      accountMatches: Boolean(saved.accountMatches ?? saved.account_matches),
      contentMatchesApprovedVersion: Boolean(saved.contentMatchesApprovedVersion ?? saved.content_matches_approved_version),
      timingAcceptable: Boolean(saved.timingAcceptable ?? saved.timing_acceptable),
      disclosuresPresent: Boolean(saved.disclosuresPresent ?? saved.disclosures_present),
    } : EMPTY_CHECKLIST);
    setCorrections([]);
    setSummary("");
    setConfirming(false);
    setAttemptConfirmation("");
    setActionError(null);
  }, [attempt?.id, review?.id]);

  useEffect(() => {
    if (focusCorrectionAfterAddRef.current && corrections.length) {
      focusCorrectionAfterAddRef.current = false;
      firstCorrectionRef.current?.focus();
    }
  }, [corrections.length]);

  useEffect(() => {
    if (confirming) {
      verifyInputRef.current?.focus();
      return;
    }
    if (restoreVerifyFocusRef.current) {
      restoreVerifyFocusRef.current = false;
      verifyTriggerRef.current?.focus();
    }
  }, [confirming]);

  if (!item) return null;

  const base = attempt ? {
    workItemId: item.id, attemptId: attempt.id,
    expectedState: item.state, expectedRevision: itemRevision(item),
  } : null;
  const allPassed = CHECKLIST_KEYS.every((key) => checklist[key]);
  const isBusy = busy || localBusy;

  async function perform(action: () => Promise<unknown>) {
    setActionError(null);
    setLocalBusy(true);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error && error.message ? error.message : c.actionFailed);
      onActionError?.(error);
    } finally {
      setLocalBusy(false);
    }
  }

  async function sendCorrections() {
    if (!base || !claimedByCurrent) return;
    const clean = corrections.map((value, position) => ({ ...value, text: value.text.trim(), position }))
      .filter((value) => value.text);
    if (!clean.length) {
      setCorrectionError(true);
      firstCorrectionRef.current?.focus();
      return;
    }
    setCorrectionError(false);
    await perform(() => onRequestCorrection({ ...base, checklist, corrections: clean, summary: summary.trim() || null }));
  }

  function focusCorrection() {
    if (corrections.length) {
      firstCorrectionRef.current?.focus();
      return;
    }
    focusCorrectionAfterAddRef.current = true;
    setCorrections([{ category: "other", text: "", position: 0 }]);
  }

  function openVerification() {
    restoreVerifyFocusRef.current = true;
    setConfirming(true);
  }

  function closeVerification() {
    setConfirming(false);
    setAttemptConfirmation("");
  }

  async function saveInstructions() {
    const text = setup.publicationInstructions.trim();
    const reason = setup.overrideReason.trim();
    const hours = Number(setup.publicationWindowHours);
    if (!text || !reason || !Number.isInteger(hours) || hours <= 0) {
      setSetupError(true);
      return;
    }
    setSetupError(false);
    await perform(() => onSetInstructions({
      workItemId: item.id, expectedState: item.state, expectedRevision: itemRevision(item),
      overrideReason: reason,
      instructions: {
        publicationInstructions: text, publicationWindowHours: hours,
        requiredDisclosures: setup.requiredDisclosures.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        expectedAccount: setup.expectedAccount.trim() || null,
        proofEvidencePolicy: setup.evidenceRequired ? { required: true } : {},
      },
    }));
  }

  if (!instructions && item.state === "approved_to_publish") {
    return (
      <section aria-labelledby="publication-setup-title" className="space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5">
        <h2 id="publication-setup-title" className="font-heading text-xl font-bold">{c.instructionsRequired}</h2>
        <label className="grid gap-1 font-bold">{c.instructionText}<textarea className={FIELD} value={setup.publicationInstructions} onChange={(event) => setSetup({ ...setup, publicationInstructions: event.target.value })} /></label>
        <label className="grid gap-1 font-bold">{c.windowHours}<input className={FIELD} type="number" min="1" value={setup.publicationWindowHours} onChange={(event) => setSetup({ ...setup, publicationWindowHours: event.target.value })} /></label>
        <label className="grid gap-1 font-bold">{c.account}<input className={FIELD} value={setup.expectedAccount} onChange={(event) => setSetup({ ...setup, expectedAccount: event.target.value })} /></label>
        <label className="grid gap-1 font-bold">{c.disclosureList}<textarea className={FIELD} value={setup.requiredDisclosures} onChange={(event) => setSetup({ ...setup, requiredDisclosures: event.target.value })} /></label>
        <label className="flex gap-2 font-bold"><input type="checkbox" checked={setup.evidenceRequired} onChange={(event) => setSetup({ ...setup, evidenceRequired: event.target.checked })} />{c.evidenceRequired}</label>
        <label className="grid gap-1 font-bold">{c.overrideReason}<textarea className={FIELD} value={setup.overrideReason} onChange={(event) => setSetup({ ...setup, overrideReason: event.target.value })} /></label>
        {setupError ? <p role="alert" className="font-bold text-red-700">{c.setupInvalid}</p> : null}
        <button type="button" disabled={isBusy} onClick={() => void saveInstructions()} className={`${BUTTON} bg-[var(--color-acid)]`}>{c.saveInstructions}</button>
      </section>
    );
  }

  if (!attempt) return <p className="text-sm text-[var(--color-soft-ink)]">{c.noHistory}</p>;

  return (
    <section className="space-y-5 pb-28 lg:pb-0" aria-labelledby="proof-review-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[var(--color-soft-ink)]">{item.title}</p>
          <h2 id="proof-review-title" className="font-display text-2xl font-bold">{c.proofAttempt(attempt.attemptNumber)}</h2>
        </div>
        {attempt.submittedLate ? <span className="rounded-full border-2 border-amber-800 bg-amber-100 px-3 py-1 text-xs font-bold">{c.submittedLate}</span> : null}
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="font-heading text-lg font-bold">{c.approvedDraft}</h3>
          {approvedVersion ? <><p className="whitespace-pre-wrap text-sm">{approvedVersion.caption_snapshot}</p>
            {approvedAssets.map((asset) => <a key={asset.id} href={asset.signedUrl} target="_blank" rel="noreferrer" className="block break-all font-bold underline">{asset.original_filename}</a>)}</>
            : <p>{c.noApprovedDraft}</p>}
        </article>
        <article className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4">
          <h3 className="font-heading text-lg font-bold">{c.frozenInstructions}</h3>
          {instructions ? <><p className="whitespace-pre-wrap text-sm">{instructions.publicationInstructions}</p>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="font-bold">{c.platform}</dt><dd>{item.platform}</dd></div>
              <div><dt className="font-bold">{c.expectedAccount}</dt><dd>{instructions.expectedAccount ?? "—"}</dd></div>
              <div><dt className="font-bold">{c.deadline}</dt><dd><time dateTime={instructions.publicationDueAt}>{new Date(instructions.publicationDueAt).toLocaleString()}</time></dd></div>
            </dl>
            {instructions.requiredDisclosures.length ? <div><h4 className="font-bold">{c.disclosures}</h4><ul className="list-disc pl-5">{instructions.requiredDisclosures.map((value) => <li key={value}>{value}</li>)}</ul></div> : null}</> : null}
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="font-heading font-bold">{c.publishedUrls}</h3>
          <ul className="mt-3 space-y-2 break-all text-sm">
            <li><a href={attempt.primaryUrl} target="_blank" rel="noreferrer noopener" className="font-bold underline">{c.primaryUrl}</a></li>
            {attempt.additionalUrls.map((url, index) => <li key={url}><a href={url} target="_blank" rel="noreferrer noopener" className="font-bold underline">{c.additionalUrl(index + 1)}</a></li>)}
          </ul>
        </article>
        <article className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="font-heading font-bold">{c.metadata}</h3>
          {attempt.metadataStatus === "available" ? <dl className="mt-3 space-y-2 text-sm">{safeMetadata(attempt).map(([key, value]) => <div key={key}><dt className="font-bold">{key}</dt><dd className="break-all">{value}</dd></div>)}</dl>
            : <p className="mt-3 text-sm">{c.metadataUnavailable}</p>}
          <button type="button" disabled={isBusy} onClick={() => base && void perform(() => onRefreshMetadata(base))} className={`${BUTTON} mt-3 bg-[var(--color-sky)]`}>{c.refreshMetadata}</button>
        </article>
        <article className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="font-heading font-bold">{c.evidence}</h3>
          {proofAssets.length ? <ul className="mt-3 space-y-2">{proofAssets.map((asset) => <li key={asset.id}><a href={asset.signedUrl} target="_blank" rel="noreferrer" className="font-bold underline">{asset.originalFilename}</a></li>)}</ul>
            : <p className="mt-3 text-sm">{c.noEvidence}</p>}
        </article>
      </div>

      <fieldset className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <legend className="px-2 font-heading text-lg font-bold">{c.checklist}</legend>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CHECKLIST_KEYS.map((key) => <label key={key} className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--color-ink)] p-3 font-bold">
            <input type="checkbox" checked={checklist[key]} disabled={!claimedByCurrent || isBusy} onChange={(event) => setChecklist({ ...checklist, [key]: event.target.checked })} />
            {c.checklistLabels[key]}
          </label>)}
        </div>
      </fieldset>

      {claimedByCurrent ? <section className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-heading font-bold">{c.requestCorrection}</h3><button type="button" className={`${BUTTON} bg-white`} onClick={() => setCorrections((values) => [...values, { category: "other", text: "", position: values.length }])}>{c.addCorrection}</button></div>
        {corrections.map((value, index) => <div key={index} className="grid gap-2 rounded-xl border border-[var(--color-ink)] p-3 sm:grid-cols-[12rem_1fr_auto]">
          <label className="grid gap-1 font-bold">{c.correctionCategory(index + 1)}<select className={FIELD} value={value.category} onChange={(event) => setCorrections((values) => values.map((entry, position) => position === index ? { ...entry, category: event.target.value as PublicationProofCorrectionInput["category"] } : entry))}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label className="grid gap-1 font-bold">{c.correctionText(index + 1)}<textarea ref={index === 0 ? firstCorrectionRef : undefined} className={FIELD} value={value.text} onChange={(event) => setCorrections((values) => values.map((entry, position) => position === index ? { ...entry, text: event.target.value } : entry))} /></label>
          <button type="button" className={`${BUTTON} self-end bg-white`} onClick={() => setCorrections((values) => values.filter((_, position) => position !== index))}>{c.remove}</button>
        </div>)}
        {correctionError ? <p role="alert" className="font-bold text-red-700">{c.correctionRequired}</p> : null}
        <label className="grid gap-1 font-bold">{c.summary}<textarea className={FIELD} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <button type="button" disabled={isBusy} onClick={() => void sendCorrections()} className={`${BUTTON} bg-[var(--color-sun)]`}>{c.sendCorrections}</button>
      </section> : null}

      <section className="space-y-3">
        <h3 className="font-heading text-lg font-bold">{c.history}</h3>
        {attempts.filter((value) => value.id !== attempt.id).length ? attempts.filter((value) => value.id !== attempt.id).map((value) => {
          const previousReview: ActiveMissionPublicationProofReview | null = reviewFor(workflow, value.id);
          return <article key={value.id} className="rounded-xl border border-[var(--color-ink)] bg-white p-3"><h4 className="font-bold">{c.attempt(value.attemptNumber)}</h4><p className="text-sm">{previousReview?.summary ?? previousReview?.decision ?? "—"}</p></article>;
        }) : <p className="text-sm">{c.noHistory}</p>}
      </section>

      {actionError ? <p role="alert" aria-live="assertive" className="rounded-xl border-2 border-red-700 bg-red-50 p-3 font-bold text-red-700">{actionError}</p> : null}
      {confirming ? <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="verify-proof-title"
        aria-describedby="verify-proof-description"
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled)',
            ));
            const first = focusable[0];
            const last = focusable.at(-1);
            if (first && last && ((!event.shiftKey && document.activeElement === last)
              || (event.shiftKey && document.activeElement === first))) {
              event.preventDefault();
              (event.shiftKey ? last : first).focus();
            }
          }
          if (event.key === "Escape") {
            event.preventDefault();
            closeVerification();
          }
        }}
        className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4"
      >
        <h3 id="verify-proof-title" className="font-heading font-bold">{c.verifyTitle(attempt.attemptNumber)}</h3>
        <p id="verify-proof-description">{c.noReward}</p>
        <label className="grid gap-1 font-bold">{c.typeAttempt(attempt.attemptNumber)}<input ref={verifyInputRef} className={FIELD} inputMode="numeric" value={attemptConfirmation} onChange={(event) => setAttemptConfirmation(event.target.value)} /></label>
        <button type="button" onClick={closeVerification} className={`${BUTTON} bg-white`}>{c.cancelVerification}</button>
        <button type="button" disabled={isBusy || attemptConfirmation !== String(attempt.attemptNumber)} onClick={() => base && void perform(() => onVerify({ ...base, checklist, summary: summary.trim() || null }))} className={`${BUTTON} bg-[var(--color-acid)]`}>{c.confirmVerification}</button>
      </div> : null}

      <div data-testid="proof-review-actions" className="sticky bottom-0 z-20 -mx-2 flex flex-wrap gap-2 border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-3 lg:static lg:mx-0">
        <button type="button" disabled={isBusy || item.state !== "proof_submitted" || !base} onClick={() => base && void perform(() => onClaim(base))} className={`${BUTTON} bg-[var(--color-sky)]`}>{c.claim}</button>
        <span className="self-center text-sm font-bold">{review?.reviewerId ? `${c.claimedBy}: ${review.reviewerId}` : null}</span>
        <button type="button" disabled={isBusy || !claimedByCurrent} onClick={focusCorrection} className={`${BUTTON} bg-[var(--color-sun)]`}>{c.requestCorrection}</button>
        <button ref={verifyTriggerRef} type="button" disabled={isBusy || !claimedByCurrent || !allPassed} onClick={openVerification} className={`${BUTTON} bg-[var(--color-acid)]`}>{c.verify}</button>
      </div>
    </section>
  );
}
