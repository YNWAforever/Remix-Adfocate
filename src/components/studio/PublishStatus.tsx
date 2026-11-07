import { useEffect, useId, useRef, useState } from "react";
import { useStudioText } from "./StudioPrimitives";
import "./publish.css";

export type PublishStatusModel = Readonly<{
  mode: "native" | "synthetic";
  state: "preparing" | "processing" | "publish_requested" | "published" | "failed" | "outcome_unknown" | "cancelled" | "invalidated";
  account: Readonly<{ username: string; subject: string }>;
  /** Sanitized, server-resolved receipt only; the component cannot verify a provider. */
  receipt?: Readonly<{ mediaId: string; accountSubject: string; publishedAt: string; permalink?: string | null }>;
}>;
export type PublishStatusProps = {
  model: PublishStatusModel;
  /** Must only query/reconcile status; never create another publishing command. */
  onCheckStatus?: () => void | Promise<void>;
  /** Open original mission review/proof; unresolved outcomes must not initiate publishing. */
  onManualProof: () => void;
};

function safePermalink(value: string | null | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && !url.port
      && /^\/p\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)) return value;
  } catch { /* Do not render unsafe or credential-bearing links, even as text. */ }
}

function StatusSession({ model, onCheckStatus, onManualProof }: PublishStatusProps) {
  const tx = useStudioText();
  const titleId = useId();
  const [checking, setChecking] = useState(false), [checkFailed, setCheckFailed] = useState(false);
  const lock = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const synthetic = model.mode === "synthetic";
  const receipt = model.receipt;
  const receiptComplete = receipt && /^\d+$/.test(receipt.mediaId) && receipt.accountSubject === model.account.subject && Number.isFinite(Date.parse(receipt.publishedAt));
  const state = model.state === "published" && !synthetic && !receiptComplete ? "outcome_unknown" : model.state;
  const titles = {
    preparing: tx("準備中", "Preparing"), processing: tx("處理中", "Processing"),
    publish_requested: tx("已要求發佈，結果待確認", "Publication requested; awaiting result"),
    published: synthetic ? tx("示例回執 · 沒有發佈", "Example receipt · no post") : tx("已發佈", "Published"),
    failed: tx("發佈失敗", "Publishing failed"), outcome_unknown: tx("結果待確認", "Outcome unknown"),
    cancelled: tx("已取消", "Cancelled"), invalidated: tx("確認已失效", "Confirmation invalidated"),
  };
  const descriptions = {
    preparing: tx("正在準備這一次發佈意圖，尚未確認貼文已發佈。", "Preparing this publishing intent. Publication is not confirmed."),
    processing: tx("圖片仍在處理，尚未確認貼文已發佈。", "The image is processing. Publication is not confirmed."),
    publish_requested: tx("發佈要求已送出，仍未取得可核對的結果。請勿重複提交。", "Publication was requested, but a verifiable result is still unavailable. Do not submit again."),
    published: synthetic ? tx("這是示例回執，沒有外部貼文或官方 media ID。", "This is an example receipt, with no external post or official media ID.") : tx("以下為伺服器提供的發佈回執。任務仍須循原流程提交證明。", "The server supplied the receipt below. Submit mission proof through the original workflow."),
    failed: tx("此意圖回報失敗。不會自動重試；確認未發佈前，請勿再次發佈。", "This intent reports failure. No automatic retry; establish that no post exists before any new publication."),
    outcome_unknown: tx("可能已發佈。請先到 Instagram 核對目標帳號及貼文，必要時請負責人協助對帳；未核實前不要重新發佈。", "A post may already exist. Check the target account and post on Instagram and ask the responsible person to reconcile if needed. Do not post again before verification."),
    cancelled: tx("此意圖已取消；這不會刪除或撤回任何已公開的 Instagram 貼文。", "This intent is cancelled. This does not delete or retract any public Instagram post."),
    invalidated: tx("內容、帳號、授權或有效期已變更。舊確認不能沿用，請返回原草稿／審核流程。", "Content, account, permission or expiry changed. The old confirmation cannot be reused; return to the original draft/review workflow."),
  };
  const syntheticDescriptions = {
    preparing: tx("模擬準備狀態；沒有建立真實發佈意圖。", "Simulated preparation; no real publishing intent was created."),
    processing: tx("模擬處理狀態；沒有圖片送往 Instagram。", "Simulated processing; no image was sent to Instagram."),
    publish_requested: tx("模擬等待發佈結果；沒有送出真實發佈要求。", "Simulated wait for a publishing result; no real publication was requested."),
    published: descriptions.published,
    failed: tx("模擬失敗；沒有發佈，也不會自動重試。", "Simulated failure; nothing was published and there is no automatic retry."),
    outcome_unknown: tx("此示例沒有發佈。真實結果不明時，應先到 Instagram 核對目標帳號及貼文，必要時請負責人協助對帳；未核實前不要重新發佈。", "This example did not publish. For a real unknown outcome, check the target Instagram account and post, and ask the responsible person to reconcile if needed. Do not post again before verification."),
    cancelled: tx("模擬已取消；沒有 Instagram 貼文要撤回。", "Simulation cancelled; there is no Instagram post to retract."),
    invalidated: tx("示例確認已失效。真實流程須重新核對內容、帳號、授權及有效期。", "Example confirmation invalidated. A real flow must review content, account, permission and expiry again."),
  };
  const canCheck = ["preparing", "processing", "publish_requested", "outcome_unknown"].includes(state);
  const permalink = !synthetic && state === "published" ? safePermalink(receipt?.permalink) : undefined;
  async function check() {
    if (!mounted.current || lock.current || !onCheckStatus) return;
    lock.current = true; setChecking(true); setCheckFailed(false);
    try { await onCheckStatus(); }
    catch { if (mounted.current) setCheckFailed(true); }
    finally { lock.current = false; if (mounted.current) setChecking(false); }
  }
  return <section className="s-publish" aria-labelledby={titleId}>
    <header className="s-publish-heading"><span className="s-publish-step" aria-hidden="true">02</span><div><p className="s-publish-eyebrow">{synthetic ? tx("模擬狀態", "Simulated status") : tx("發佈狀態", "Publishing status")}</p><h2 id={titleId}>{titles[state]}</h2></div></header>
    {synthetic && <p className="s-publish-notice" role="note">{tx("模擬流程：沒有連接 Instagram、沒有發佈或保存，也不會獲得積分或徽章。", "Simulation only. No Instagram connection, post, save, points or badge.")}</p>}
    <div role="status" aria-live="polite"><p>{synthetic ? syntheticDescriptions[state] : descriptions[state]}</p></div>
    <div className="s-publish-account"><span>{tx("目標帳號", "Target account")}</span><strong>@{model.account.username.replace(/^@/, "")}</strong></div>
    <details className="s-publish-details">
      <summary>{tx("帳號與授權詳情", "Account & permission details")}</summary>
      <dl className="s-publish-facts"><div><dt>{tx("帳號識別", "Account subject")}</dt><dd>{model.account.subject}</dd></div></dl>
    </details>
    {!synthetic && state === "published" && receipt && <>
      <p className="s-publish-deadline">{tx("發佈時間：", "Published at: ")}<span>{receipt.publishedAt}</span></p>
      <details className="s-publish-details"><summary>{tx("發佈回執詳情", "Publishing receipt details")}</summary><dl className="s-publish-facts"><div><dt>Instagram media ID</dt><dd>{receipt.mediaId}</dd></div></dl></details>
    </>}
    {permalink && <a className="s-publish-button" href={permalink} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{tx("查看 Instagram 貼文", "View Instagram post")}</a>}
    {!synthetic && <p>{tx("發佈不代表任務證明獲批或獎勵入帳。原任務審核及結算記錄仍為準。", "Publishing does not approve mission proof or credit rewards. Original mission review and settlement remain authoritative.")}</p>}
    {canCheck && <div className="s-publish-stack"><p>{tx("對帳只查詢狀態，不會再次發佈。", "Reconciliation only checks status; it does not publish again.")}</p>
      <button type="button" className="s-publish-button" disabled={checking || !onCheckStatus} aria-busy={checking} onClick={() => { void check(); }}>{tx("檢查發佈狀態（唯讀）", "Check publishing status (read-only)")}</button>
      {!onCheckStatus && <p>{tx("尚未接通狀態查詢，請由負責人手動核對。", "Status checking is unavailable; ask the responsible person to check manually.")}</p>}
    </div>}
    {checkFailed && <p role="alert" className="s-publish-notice">{tx("未能讀取最新狀態；結果仍待確認。不會自動重試。", "Could not read the latest status; the outcome is still unconfirmed. No automatic retry.")}</p>}
    <button type="button" className="s-publish-button" onClick={onManualProof}>{canCheck ? tx("回到原任務核對", "Review original mission") : tx("原有手動發佈／提交證明", "Original manual publishing / proof")}</button>
  </section>;
}

export function PublishStatus(props: PublishStatusProps) {
  return <StatusSession key={JSON.stringify(props.model)} {...props} />;
}
