import { useEffect, useId, useRef, useState } from "react";
import { useStudioText } from "./StudioPrimitives";
import "./publish.css";

export type PublishBlockReason =
  | "PUBLISH_PROTOCOL_UNVERIFIED" | "PUBLISH_GRANT_INVALID" | "PUBLISH_DRAFT_INVALID"
  | "PUBLISH_ASSET_INVALID" | "MISSION_APPROVAL_MISMATCH" | "MISSION_DISCLOSURE_MISMATCH"
  | "LEGACY_MANUAL_PROOF" | "SPONSORED_POLICY_REQUIRED" | "PUBLISH_DISCLOSURE_MISSING"
  | "PUBLISH_DISCLOSURE_UNSUPPORTED" | "PUBLISH_DISCLOSURE_INVALID"
  | "DRAFT_CHANGED" | "ACCOUNT_CHANGED" | "GRANT_CHANGED";

type LabelSupport = "not_required" | "supported" | "unsupported" | "unverified";
/** Safe, immutable display projection. No tokens, signed URLs or raw service errors.
 * identityKey changes with authenticated session/owner; it is not an auth credential.
 * eligible is a snapshot, never proof of a current server grant. The approve endpoint
 * must revalidate owner/session, grant, exact content, expiry and one-use nonce.
 */
export type PublishPreviewModel = Readonly<{
  mode: "native" | "synthetic";
  identityKey: string;
  fingerprint: string;
  nonce: string;
  expiresAt: string;
  account: Readonly<{ username: string; subject: string; appId: string; grantGeneration: number }>;
  image: Readonly<{ src: string; alt: string; sha256: string }>;
  caption: string;
  disclosure: Readonly<{ sponsored: boolean; captionText: string; platformLabel: LabelSupport; brandTag: LabelSupport }>;
  mission: Readonly<{
    kind: "active" | "legacy"; state: "approved_to_publish" | "review_required";
    approvedVersionId: string | null; instructionRevision: number; summary: string;
  }> | null;
  eligible: boolean;
  reason?: PublishBlockReason;
}>;
export type PublishConfirmation = Readonly<{ fingerprint: string; nonce: string }>;
export type PublishPreviewProps = {
  model: PublishPreviewModel;
  disabled?: boolean;
  onConfirm: (confirmation: PublishConfirmation) => void | Promise<void>;
  /** Navigation only. Leaving/reviewing must not cancel or retry a publishing command. */
  onEdit: () => void;
  onCancel: () => void;
  onManualProof: () => void;
};

function imageSource(value: string): string | undefined {
  // Local object URLs and raster data are display-only; never send them in confirmation.
  if (/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value)) return value;
  if (/^blob:(https?:\/\/|null\/)[a-zA-Z0-9/:._-]+$/.test(value)) return value;
  if (/^\/(?!\/)[a-zA-Z0-9/_.%-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash) return value;
  } catch { /* Unsafe or malformed sources are not rendered. */ }
  return undefined;
}

function blockCopy(reason: PublishBlockReason | undefined, tx: ReturnType<typeof useStudioText>) {
  switch (reason) {
    case "PUBLISH_PROTOCOL_UNVERIFIED": return tx("官方發佈協定尚未核實；請使用原有手動流程。", "The official publishing protocol is unverified. Use the original manual route.");
    case "PUBLISH_GRANT_INVALID": case "GRANT_CHANGED": return tx("官方發佈授權未確認或已變更；舊確認不能使用。", "Official publishing permission is unconfirmed or changed. The old confirmation cannot be used.");
    case "ACCOUNT_CHANGED": return tx("帳號已變更；請重新核對目標帳號及內容。", "The account changed. Review the target account and content again.");
    case "DRAFT_CHANGED": return tx("草稿已變更；舊確認已失效，任務作品須返回原審核流程。", "The draft changed. The old confirmation is invalid; mission work must return to the original review flow.");
    case "LEGACY_MANUAL_PROOF": return tx("此任務沿用原有手動發佈及提交證明流程。", "This mission uses the original manual publishing and proof flow.");
    case "MISSION_APPROVAL_MISMATCH": return tx("圖片、文案或任務指示未與原核准版本一致；請返回原審核流程。", "The image, caption or instructions do not match the approved mission version. Return to the original review flow.");
    case "PUBLISH_DISCLOSURE_UNSUPPORTED": return tx("必要的合作標籤或品牌標記未獲支援或核實；請使用原有手動流程。", "Required partnership labels or brand tags are unsupported or unverified. Use the original manual route.");
    case "SPONSORED_POLICY_REQUIRED": case "MISSION_DISCLOSURE_MISMATCH": case "PUBLISH_DISCLOSURE_MISSING": case "PUBLISH_DISCLOSURE_INVALID": return tx("合作披露要求尚未核對完成；文案不能代替必要的平台標籤。", "Disclosure requirements are not fully checked. Caption text cannot replace required platform labels.");
    case "PUBLISH_ASSET_INVALID": return tx("最終圖片尚未通過檢查；請返回草稿核對。", "The final image has not passed validation. Return to the draft.");
    default: return tx("此預覽暫時不能確認；請返回草稿及原有流程核對。", "This preview cannot be confirmed. Return to the draft and original workflow.");
  }
}

function PreviewSession({ model, disabled = false, onConfirm, onEdit, onCancel, onManualProof, attemptedBefore, pendingElsewhere }: PublishPreviewProps & { attemptedBefore: boolean; pendingElsewhere: boolean }) {
  const tx = useStudioText();
  const headingId = useId(), actionId = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  const [imageState, setImageState] = useState<"loading" | "loaded" | "failed">("loading");
  const [attempt, setAttempt] = useState<"idle" | "pending" | "submitted" | "unknown">("idle");
  const expires = Date.parse(model.expiresAt);
  const [expired, setExpired] = useState(!Number.isFinite(expires) || expires <= Date.now());
  const used = useRef(false), mounted = useRef(false);
  const confirmation = Object.freeze({ fingerprint: model.fingerprint, nonce: model.nonce });
  const src = imageSource(model.image.src);
  const synthetic = model.mode === "synthetic";
  const account = `@${model.account.username.replace(/^@/, "")}`;
  const pending = attempt === "pending";
  const needsStatusReview = attempt !== "idle" || attemptedBefore || pendingElsewhere;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!Number.isFinite(expires)) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = expires - Date.now();
      if (remaining <= 0) { setExpired(true); setAcknowledged(false); }
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    return () => clearTimeout(timer);
  }, [expires]);

  let reason = model.reason;
  if (!reason && [model.disclosure.platformLabel, model.disclosure.brandTag].some(value => value === "unsupported" || value === "unverified")) reason = "PUBLISH_DISCLOSURE_UNSUPPORTED";
  if (!reason && model.mission?.kind === "legacy") reason = "LEGACY_MANUAL_PROOF";
  if (!reason && model.mission && (model.mission.state !== "approved_to_publish" || !model.mission.approvedVersionId)) reason = "MISSION_APPROVAL_MISMATCH";
  if (!reason && model.disclosure.sponsored && !model.mission) reason = "SPONSORED_POLICY_REQUIRED";
  if (!reason && model.disclosure.captionText && !model.caption.includes(model.disclosure.captionText)) reason = "PUBLISH_DISCLOSURE_MISSING";
  const blocked = disabled || !model.eligible || !!reason || !model.fingerprint || !model.nonce || attemptedBefore || pendingElsewhere;
  const canConfirm = !blocked && !expired && !!src && imageState === "loaded" && acknowledged && attempt === "idle";

  async function confirm() {
    if (!mounted.current || used.current || !canConfirm) return;
    if (!Number.isFinite(expires) || Date.now() >= expires) { setExpired(true); setAcknowledged(false); return; }
    used.current = true; // Synchronous lock: two clicks cannot enqueue two approvals.
    setAttempt("pending");
    try {
      await onConfirm(confirmation);
      if (mounted.current) setAttempt("submitted");
    } catch {
      // Transport failure cannot establish that a post was not accepted. Never retry.
      if (mounted.current) { setAttempt("unknown"); setAcknowledged(false); }
    }
  }

  const labelCopy = (value: LabelSupport) => ({
    not_required: tx("不需要", "Not required"), supported: tx("需要 · 預覽標示支援", "Required · supported in this snapshot"),
    unsupported: tx("需要 · 不支援", "Required · unsupported"), unverified: tx("需要 · 未核實", "Required · unverified"),
  })[value];

  return <section className="s-publish" aria-labelledby={headingId}>
    <header className="s-publish-heading">
      <span className="s-publish-step" aria-hidden="true">01</span>
      <div><p className="s-publish-eyebrow">{tx("最後核對", "Final review")}</p><h2 id={headingId}>{tx("這一篇，由你確認", "Your post, your confirmation")}</h2></div>
      <span className="s-publish-tag">{synthetic ? tx("模擬 · 不會發佈", "Simulation · no post") : tx("單張圖片", "Single image")}</span>
    </header>
    {synthetic && <p className="s-publish-notice" role="note">{tx("模擬流程：沒有連接 Instagram、沒有發佈或保存，也不會獲得積分或徽章。", "Simulation only. No Instagram connection, post, save, points or badge.")}</p>}
    <div className="s-publish-layout">
      <figure className="s-publish-image">
        {src && <img src={src} alt={model.image.alt} onLoad={() => setImageState("loaded")} onError={() => { setImageState("failed"); setAcknowledged(false); }} />}
        <figcaption>{tx("完整圖片 · 不裁切", "Full image · no crop")}</figcaption>
        {(!src || imageState === "failed") && <p role="alert">{tx("圖片未能完整載入；請返回草稿核對，暫時不能確認。", "The full image could not load. Return to the draft; confirmation is unavailable.")}</p>}
      </figure>
      <div className="s-publish-stack">
        <div className="s-publish-account"><span>{tx("目標 Instagram 帳號", "Target Instagram account")}</span><strong>{account}</strong></div>
        <details className="s-publish-details">
          <summary>{tx("帳號與授權詳情", "Account & permission details")}</summary>
          <dl className="s-publish-facts">
            <div><dt>{tx("帳號識別", "Account subject")}</dt><dd>{model.account.subject}</dd></div>
            <div><dt>{tx("App 識別", "App identity")}</dt><dd>{model.account.appId}</dd></div>
            <div><dt>{tx("授權代次", "Grant generation")}</dt><dd>{model.account.grantGeneration}</dd></div>
          </dl>
        </details>
        <div><h3>{tx("完整文案", "Full caption")}</h3><p className="s-publish-caption" aria-label={tx("完整文案", "Full caption")}>{model.caption}</p></div>
      </div>
    </div>
    <div className="s-publish-summary">
      <div><h3>{tx("合作與披露", "Sponsorship & disclosure")}</h3>
        <dl className="s-publish-facts">
          <div><dt>{tx("品牌合作", "Sponsored")}</dt><dd>{model.disclosure.sponsored ? tx("有", "Yes") : tx("無", "No")}</dd></div>
          <div><dt>{tx("披露文字", "Disclosure text")}</dt><dd className="s-publish-exact">{model.disclosure.captionText || tx("未要求", "Not required")}</dd></div>
          <div><dt>{tx("合作標籤", "Partnership label")}</dt><dd>{labelCopy(model.disclosure.platformLabel)}</dd></div>
          <div><dt>{tx("品牌標記", "Brand tag")}</dt><dd>{labelCopy(model.disclosure.brandTag)}</dd></div>
        </dl>
      </div>
      <div><h3>{tx("原任務核准", "Original mission approval")}</h3>
        {model.mission ? <>
          <p>{model.mission.kind === "legacy" ? tx("Legacy 任務 · 手動流程", "Legacy mission · manual flow") : model.mission.state === "approved_to_publish" ? tx("已核准此版本發佈", "This version is approved to publish") : tx("需要原任務重新審核", "Original mission review required")}</p>
          <p className="s-publish-exact">{model.mission.summary}</p>
          <details className="s-publish-details">
            <summary>{tx("審核版本詳情", "Approval version details")}</summary>
            <dl className="s-publish-facts"><div><dt>{tx("核准版本", "Approved version")}</dt><dd>{model.mission.approvedVersionId ?? tx("未核准", "Not approved")}</dd></div><div><dt>{tx("指示版本", "Instruction revision")}</dt><dd>{model.mission.instructionRevision}</dd></div></dl>
          </details>
        </> : <p>{tx("個人創作，不另計積分或 XP。", "Personal creation; no additional points or XP.")}</p>}
      </div>
    </div>
    <p className="s-publish-deadline">{tx("預覽有效至：", "Preview expires: ")}<span>{model.expiresAt}</span></p>
    {expired && <p className="s-publish-notice" role="status">{needsStatusReview
      ? tx("預覽已過期；已交出的確認仍須核對結果，勿重新發佈。", "This preview expired; the handed-over confirmation still needs a status check. Do not post again.")
      : tx("預覽已過期；舊確認已失效，請取得最新預覽。", "This preview expired. The old confirmation is invalid; get a fresh preview.")}</p>}
    {blocked && attempt === "idle" && <p className="s-publish-notice" role="status">{attemptedBefore || pendingElsewhere ? tx("已有確認交出；請先核對發佈狀態，不要重複提交。", "A confirmation has already been handed over. Check publishing status before any further submission.") : blockCopy(reason, tx)}</p>}
    <div className="s-publish-confirm">
      <p id={actionId}>{synthetic ? tx("只模擬逐篇確認，不會向 Instagram 發送貼文。", "Simulate per-post confirmation only. Nothing is sent to Instagram.") : tx("立即公開發佈單張圖片。KOCmax 不會撤回已公開的貼文。伺服器仍須重新核對當前授權、內容及有效期。", "Post one image publicly now. KOCmax will not retract a public post. The server must still revalidate current permission, content and expiry.")}</p>
      <label className="s-publish-check"><input type="checkbox" checked={acknowledged && !expired} disabled={blocked || expired || attempt !== "idle"} onChange={event => setAcknowledged(event.target.checked)} />
        <span>{synthetic ? tx("我已核對示例圖片、文案及帳號，只進行模擬。", "I reviewed the example image, caption and account for simulation only.") : tx(`我已核對完整圖片、文案、披露及 ${account}，確認立即發佈。`, `I reviewed the full image, caption, disclosure and ${account}, and confirm immediate posting.`)}</span>
      </label>
      <button type="button" className="s-publish-button s-publish-primary" disabled={!canConfirm} aria-describedby={actionId} aria-busy={pending} onClick={() => { void confirm(); }}>{synthetic ? tx("模擬確認 · 不會發佈到 Instagram", "Simulate confirmation · no Instagram post") : tx(`立即發佈到 ${account}`, `Post now to ${account}`)}</button>
      <div role="status" aria-live="polite">{pending ? tx("正在交出確認，請勿重複提交。", "Handing over confirmation. Do not submit again.") : attempt === "submitted" ? (synthetic ? tx("模擬確認已完成；沒有真實發佈。", "Simulated confirmation complete; no real post.") : tx("確認已交出，發佈結果仍待核實。請查看發佈狀態。", "Confirmation handed over; publication is not yet verified. Check publishing status.")) : null}</div>
      {needsStatusReview && !synthetic && <p>{tx("可離開預覽或回原任務核對。離開預覽不代表取消發佈要求；結果仍須確認。", "You can leave the preview or review the original mission. Leaving does not cancel the publishing request; its outcome still needs checking.")}</p>}
      {attempt === "unknown" && <p role="alert" className="s-publish-notice">{tx("未能確認是否已接收；不會自動重試。請返回檢查狀態，並核對 Instagram 目標帳號，勿重複發佈。", "We could not confirm whether it was received. There is no automatic retry. Return to check status and the target Instagram account; do not post again.")}</p>}
    </div>
    <footer className="s-publish-actions">
      <button type="button" className="s-publish-button" onClick={onEdit}>{needsStatusReview ? tx("核對草稿與狀態", "Review draft & status") : tx("修改草稿", "Edit draft")}</button>
      <button type="button" className="s-publish-button" onClick={onCancel}>{tx("離開預覽", "Leave preview")}</button>
      <button type="button" className="s-publish-button" onClick={onManualProof}>{needsStatusReview ? tx("回到原任務核對", "Review original mission") : tx("原有手動發佈／提交證明", "Original manual publishing / proof")}</button>
    </footer>
  </section>;
}

export function PublishPreview(props: PublishPreviewProps) {
  const used = useRef(new Set<string>());
  const [attempted, setAttempted] = useState<ReadonlyArray<string>>([]);
  const [inFlight, setInFlight] = useState<string | null>(null);
  const confirmationKey = JSON.stringify([props.model.fingerprint, props.model.nonce]);
  async function submit(confirmation: PublishConfirmation) {
    const key = JSON.stringify([confirmation.fingerprint, confirmation.nonce]);
    if (used.current.has(key)) return;
    used.current.add(key);
    setAttempted(previous => [...previous, key]);
    setInFlight(key);
    try { await props.onConfirm(confirmation); }
    finally { setInFlight(null); }
  }
  // Reset interactive consent even if a caller changes content without a new fingerprint.
  // This is a UI guard only: server one-use nonce/idempotency remains authoritative.
  return <PreviewSession key={JSON.stringify([props.model, props.disabled])} {...props} onConfirm={submit} attemptedBefore={attempted.includes(confirmationKey)} pendingElsewhere={inFlight !== null && inFlight !== confirmationKey} />;
}
