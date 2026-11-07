import { useId, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { SYNTHETIC_GROWTH_REPORT } from "@/lib/creatorGrowth/sampleReport";
import {
  GrowthImageWorkspace,
  type GrowthImageWorkspaceProps,
  type GrowthSampleUi,
} from "./GrowthImageWorkspace";
import { useStudioText } from "./StudioPrimitives";
import { PublishPreview, type PublishPreviewModel } from "./PublishPreview";
import { PublishStatus, type PublishStatusModel } from "./PublishStatus";
import { MockNativePilot } from "./MockNativePilot";

const SAMPLE_DRAFT = [
  "這張圖讓我留意的是主體很清楚，但故事還少了一個真實體驗。",
  "我會用一個具體問題開場，再說出實際觀察，最後邀請讀者分享自己的做法。",
  "成效數字只按已核實來源填寫；未提供的資料保持空白。",
].join("\n\n");

function GrowthImageWorkspaceDevSession(
  props: GrowthImageWorkspaceProps,
) {
  const tx = useStudioText();
  const [showSyntheticReport, setShowSyntheticReport] = useState(false);
  const [sampleOpenRevision, setSampleOpenRevision] = useState(0);
  const [hasLocalUpload, setHasLocalUpload] = useState(false);
  const [publishScenario, setPublishScenario] = useState("receipt");
  const [publishPreview, setPublishPreview] = useState<PublishPreviewModel | null>(null);
  const [publishStatus, setPublishStatus] = useState<PublishStatusModel | null>(null);
  const [publishFeedback, setPublishFeedback] = useState("");
  const publishRevision = useRef(0);
  const scenarioId = useId();
  const demoOpen = publishPreview !== null || publishStatus !== null;

  function openPublishingExample() {
    if (hasLocalUpload || demoOpen) return;
    publishRevision.current += 1;
    const mission = publishScenario === "mission" || publishScenario === "manual";
    setPublishFeedback("");
    setPublishPreview({
      mode: "synthetic", identityKey: `${props.identityKey}:${props.threadId}:synthetic-only`,
      fingerprint: `synthetic-publish-preview-${publishRevision.current}`,
      nonce: `synthetic-publish-nonce-${publishRevision.current}`,
      expiresAt: new Date(Date.now() + (publishScenario === "expired" ? -1 : 5 * 60_000)).toISOString(),
      account: { username: "kocmax_demo_only", subject: "synthetic-account-only", appId: "synthetic-app-only", grantGeneration: 1 },
      image: { src: "/og.png", alt: tx("開發示例圖片，非使用者上傳", "Development example image, not a user upload"), sha256: "synthetic-image-only" },
      caption: tx("今天的創作練習：先看完整圖片，再核對每一行文字。\n\n這是開發用合成示例，不會保存或發佈。", "Today's creative exercise: review the full image, then every line of the caption.\n\nThis is a synthetic development example. Nothing is saved or posted.") + (publishScenario === "manual" ? "\n#合作" : ""),
      disclosure: { sponsored: publishScenario === "manual", captionText: publishScenario === "manual" ? "#合作" : "", platformLabel: publishScenario === "manual" ? "unsupported" : "not_required", brandTag: "not_required" },
      mission: mission ? { kind: "active", state: "approved_to_publish", approvedVersionId: "synthetic-approved-version", instructionRevision: 1, summary: tx("示例核准：只限此圖片及完整文案；改動後須回原任務審核。", "Example approval: this exact image and caption only. Changes return to original mission review.") } : null,
      eligible: !["manual", "changed"].includes(publishScenario),
      ...(publishScenario === "manual" ? { reason: "PUBLISH_DISCLOSURE_UNSUPPORTED" as const } : publishScenario === "changed" ? { reason: "DRAFT_CHANGED" as const } : {}),
    });
  }

  function explainManualRoute() {
    const unresolved = publishStatus && ["preparing", "processing", "publish_requested", "outcome_unknown"].includes(publishStatus.state);
    setPublishFeedback(unresolved
      ? tx("示例只說明原任務核對流程：真實結果不明時，請核對 Instagram 目標帳號、既有貼文及原任務證明，必要時請負責人協助。未核實前不要重新發佈。此示例沒有發佈、提交證明、保存或加分。", "This example explains original mission review: for a real unknown outcome, check the target Instagram account, existing posts and original mission proof; ask the responsible person for help if needed. Do not post again before verification. This example does not publish, submit proof, save or award points.")
      : tx("示例只說明原任務手動流程：先到 Instagram 核對帳號及是否已有貼文，再依原任務要求手動發佈及提交證明。此處不提交證明、不核准、不保存，也不加分。", "This example explains the original manual mission route: check the account and any existing post on Instagram first, then follow the original mission's manual publishing and proof instructions. This does not submit proof, approve, save or award points."));
  }
  const report = showSyntheticReport
    ? SYNTHETIC_GROWTH_REPORT
    : props.report;
  const sampleUi: GrowthSampleUi = showSyntheticReport
    ? {
        trigger: null,
        banner: (
          <div className="s-sample-banner" role="note">
            <strong>{tx("合成示例 · 未驗證", "Synthetic example · unverified")}</strong>
            <span>{tx(
              "只用來示範流程；不是你真實圖片或帳戶的分析。",
              "This demonstrates the flow. It is not an analysis of your image or account.",
            )}</span>
          </div>
        ),
        metricBadge: tx("示例數值 · 非官方", "Sample values · not official"),
        metricNotice: tx(
          "這張示例卡不代表真實帳戶指標。",
          "This sample card does not represent a real account.",
        ),
        publicImageBadge: tx("公開圖片 · 示例", "Public image · sample"),
        manualHeading: tx("合成手動示例", "Synthetic manual example"),
        manualBadge: tx("示例 · 非本人提供", "Sample · not creator-provided"),
        manualBody: tx(
          "示例畫面文字，不是你的圖片。",
          "Example image text, not your image.",
        ),
        coverageNotice: tx(
          "未取得可核對的地區與語言覆蓋，不能把示例當成香港市場成效。",
          "Verified region and language coverage is unavailable, so the sample is not Hong Kong market evidence.",
        ),
        reportTimeLabel: tx(
          "示例固定時間",
          "Fixed synthetic time",
        ),
        observationLabel: tx("合成示例", "Synthetic sample"),
        citationSampleLabel: tx("合成示例", "Synthetic sample"),
        officialCitationLabel: tx(
          "合成示例指標（模擬 Instagram 合約，非官方讀取）",
          "Synthetic sample metrics (simulated Instagram contract, not an official read)",
        ),
      }
    : {
        trigger: (
          <button
            type="button"
            className="s-btn s-lime-btn"
            onClick={() => {
              setShowSyntheticReport(true);
              setSampleOpenRevision((revision) => revision + 1);
            }}
          >
            <FileText size={16} />
            {tx("查看合成示例", "View synthetic example")}
          </button>
        ),
      };

  return (
    <>
    <GrowthImageWorkspace
      {...props}
      report={report}
      draftSeed={
        showSyntheticReport
          ? {
              version: `${SYNTHETIC_GROWTH_REPORT.runAt}:${sampleOpenRevision}`,
              text: SAMPLE_DRAFT,
            }
          : null
      }
      sampleUi={sampleUi}
      onReportInvalidated={() => {
        setShowSyntheticReport(false);
        setPublishPreview(null);
        setPublishStatus(null);
        setPublishFeedback("");
        props.onReportInvalidated?.();
      }}
      onChooseImage={(file) => {
        setHasLocalUpload(true);
        setPublishPreview(null);
        setPublishStatus(null);
        props.onChooseImage(file);
      }}
    />
    <section className="s-publish-demo" aria-label={tx("開發用發佈模擬", "Development publishing simulation")}>
      <p className="s-publish-notice">{tx("開發專用合成流程 · 沒有 Instagram 連線、發佈、保存、積分或徽章。只使用固定示例圖片，真實上傳不能用於此模擬。", "Synthetic development flow only. No Instagram connection, post, save, points or badge. Uses a fixed example image; real uploads cannot enter this simulation.")}</p>
      <label htmlFor={scenarioId}>{tx("發佈模擬情境", "Publishing simulation scenario")}
        <select id={scenarioId} value={publishScenario} disabled={hasLocalUpload || demoOpen} onChange={event => setPublishScenario(event.target.value)}>
          <option value="receipt">{tx("個人創作 → 示例回執", "Personal creation → example receipt")}</option>
          <option value="mission">{tx("原任務核准版 → 示例回執", "Approved mission version → example receipt")}</option>
          <option value="unknown">{tx("結果待確認 → 唯讀查詢", "Unknown outcome → read-only check")}</option>
          <option value="manual">{tx("合作標籤不支援 → 手動流程", "Unsupported partnership label → manual route")}</option>
          <option value="changed">{tx("草稿變更 → 重新審核", "Changed draft → review required")}</option>
          <option value="expired">{tx("預覽已過期", "Expired preview")}</option>
        </select>
      </label>
      <button type="button" className="s-publish-button" disabled={hasLocalUpload || demoOpen} onClick={openPublishingExample}>{tx("開啟發佈模擬（開發用）", "Open publishing simulation (development only)")}</button>
      {publishPreview && <PublishPreview
        model={publishPreview}
        onConfirm={() => {
          if (hasLocalUpload) return;
          setPublishStatus({ mode: "synthetic", state: publishScenario === "unknown" ? "outcome_unknown" : "published", account: publishPreview.account });
          setPublishPreview(null);
        }}
        onEdit={() => setPublishPreview({ ...publishPreview, eligible: false, reason: "DRAFT_CHANGED" })}
        onCancel={() => {
          setPublishStatus({ mode: "synthetic", state: "cancelled", account: publishPreview.account });
          setPublishPreview(null);
        }}
        onManualProof={explainManualRoute}
      />}
      {publishStatus && <PublishStatus model={publishStatus} onManualProof={explainManualRoute} onCheckStatus={() => setPublishFeedback(tx("模擬查詢完成，沒有可核對的官方回執；結果仍待確認。沒有再次發佈。", "Simulated check complete. No verifiable official receipt; the outcome remains unknown. Nothing was published again."))} />}
      {publishFeedback && <p role="status" className="s-publish-notice">{publishFeedback}</p>}
      {demoOpen && <button type="button" className="s-publish-button" onClick={() => { setPublishPreview(null); setPublishStatus(null); setPublishFeedback(""); }}>{tx("結束模擬", "End simulation")}</button>}
    </section>
    {!hasLocalUpload && <MockNativePilot ownerKey={JSON.stringify([props.identityKey, props.threadId])} />}
    </>
  );
}

export default function GrowthImageWorkspaceDev(props: GrowthImageWorkspaceProps) {
  return <GrowthImageWorkspaceDevSession key={JSON.stringify([props.identityKey, props.threadId])} {...props} />;
}
