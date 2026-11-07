import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  ImagePlus,
  Info,
  LockKeyhole,
} from "lucide-react";
import type { GrowthEvidenceReport } from "../../../server/lib/creatorGrowth/report";
import type {
  GrowthSkillId,
} from "@/lib/creatorGrowth/skillManifest";
import { GROWTH_SKILLS } from "@/lib/creatorGrowth/skillManifest";
import { useStudioText } from "./StudioPrimitives";

export type GrowthSampleUi = Readonly<{
  trigger: ReactNode;
  banner?: ReactNode;
  metricBadge?: string;
  metricNotice?: string;
  publicImageBadge?: string;
  manualHeading?: string;
  manualBadge?: string;
  manualBody?: string;
  coverageNotice?: string;
  reportTimeLabel?: string;
  observationLabel?: string;
  citationSampleLabel?: string;
  officialCitationLabel?: string;
}>;

export type GrowthImageWorkspaceProps = {
  threadId: string;
  identityKey: string;
  skillId: GrowthSkillId;
  report?: GrowthEvidenceReport | null;
  draftSeed?: Readonly<{ version: string; text: string }> | null;
  sampleUi?: GrowthSampleUi | null;
  onChooseImage: (file: File) => void;
  onDescribeImage: () => void;
  onSaveDraft: () => void;
  onOpenBrief?: () => void;
  onReportInvalidated?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type GrowthPane = "image" | "evidence";

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const METRIC_LABELS: Record<string, string> = {
  reach: "觸及",
  views: "觀看",
  impressions: "曝光",
  likes: "讚好",
  comments: "留言",
  shares: "分享",
  saves: "收藏",
};

const SOURCE_KIND_LABELS: Record<string, string> = {
  "official_metrics": "Instagram 官方指標",
  "public_image_mock": "第三方公開圖片",
  "self_upload_manual": "手動觀察",
};

function formatEvidenceTime(value: string): string {
  return `${new Intl.DateTimeFormat("zh-HK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hong_Kong",
  }).format(new Date(value))} HKT`;
}

function metricPeriodLabel(
  period:
    | Readonly<{
        kind: "lifetime" | "date_range";
        startAt: string | null;
        endAt: string | null;
      }>
    | undefined,
): string {
  if (period === undefined) {
    return "未驗證";
  }
  if (period.kind === "lifetime") {
    return "此貼文累計（lifetime）";
  }
  return `${formatEvidenceTime(period.startAt ?? "")} 至 ${formatEvidenceTime(period.endAt ?? "")}`;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);

  return matches;
}

function metricValue(value: number | null, locale: string): string {
  return value === null ? "—" : value.toLocaleString(locale);
}

function GrowthWorkspaceBoundary({
  skillId,
  report = null,
  draftSeed = null,
  sampleUi = null,
  onChooseImage,
  onDescribeImage,
  onSaveDraft,
  onOpenBrief,
  onReportInvalidated,
  onDirtyChange,
}: Omit<GrowthImageWorkspaceProps, "threadId" | "identityKey">) {
  const tx = useStudioText();
  const inputId = useId();
  const [pane, setPane] = useState<GrowthPane>("image");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [manualDescription, setManualDescription] = useState("");
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reportInvalidated, setReportInvalidated] = useState(false);
  const appliedDraftSeed = useRef<string | null>(null);
  const previousReport = useRef(report);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const compact = useMediaQuery("(max-width: 767px)");
  const skill = GROWTH_SKILLS.find((candidate) => candidate.id === skillId);
  const activeReport = reportInvalidated ? null : report;
  const locale = tx("zh-HK", "en-HK");
  const workspaceRef = useRef<HTMLElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
  const desktop = workspaceWidth !== null && workspaceWidth >= 720;
  const showImage = desktop || pane === "image";
  const showEvidence = desktop || pane === "evidence";
  const localDirty =
    selectedFile !== null ||
    manualDescription.trim().length > 0 ||
    activeReport !== null ||
    draft.trim().length > 0;
  const officialSources =
    activeReport?.provenance.officialMetrics ?? [];
  const hasOfficialSource =
    officialSources.length > 0 &&
    activeReport?.availability.officialMetrics !== "unavailable";
  const hasPublicImageSource =
    activeReport?.provenance.publicImageMock !== null &&
    activeReport?.provenance.publicImageMock !== undefined &&
    (
      activeReport.availability.publicImageMock === "mock" ||
      activeReport.availability.publicImageMock === "available"
    );
  const hasManualSource =
    activeReport?.provenance.selfUploadManual !== null ||
    selectedFile !== null ||
    sampleUi?.manualHeading !== undefined;

  useEffect(() => {
    return () => {
      if (
        previewUrl !== null &&
        typeof URL.revokeObjectURL === "function"
      ) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (previousReport.current !== report) {
      previousReport.current = report;
      if (selectedFile === null) {
        setReportInvalidated(false);
      }
    }
  }, [report, selectedFile]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const updateWidth = (width: number) => setWorkspaceWidth(width);
    updateWidth(workspace.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) {
        updateWidth(width);
      }
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onDirtyChange?.(localDirty);
  }, [localDirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    if (
      draftSeed !== null &&
      appliedDraftSeed.current !== draftSeed.version
    ) {
      appliedDraftSeed.current = draftSeed.version;
      setSelectedFile(null);
      setPreviewUrl(null);
      setManualDescription("");
      setDraft(draftSeed.text);
      setReportInvalidated(false);
    }
  }, [draftSeed]);

  function chooseImage(file: File | undefined) {
    if (file === undefined) {
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setFeedback(tx(
        "只支援 JPEG、PNG 或 WebP 圖片；未讀取檔案內容。",
        "Choose a JPEG, PNG or WebP image. The file was not read.",
      ));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setFeedback(tx(
        "圖片不可大於 8 MiB；未讀取檔案內容。",
        "Choose an image no larger than 8 MiB. The file was not read.",
      ));
      return;
    }
    const hadProposal = activeReport !== null;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setManualDescription("");
    setDraft("");
    setReportInvalidated(true);
    setFeedback(hadProposal
      ? tx(
          "上一個分析與提案已清除，請重新確認目前圖片。",
          "The previous analysis and proposal were cleared. Review the current image again.",
        )
      : tx(
          "圖片只在此瀏覽器預覽；尚未上傳或送往模型。",
          "This image is previewed only in this browser. It has not been uploaded or sent to a model.",
        ));
    onReportInvalidated?.();
    onChooseImage(file);
  }

  function describeManually() {
    setFeedback(tx(
      "手動描述只保留在本機；尚未傳送或保存。",
      "Your manual description is local only. It has not been sent or saved.",
    ));
    onDescribeImage();
  }

  function updateLocalDraft() {
    setFeedback(tx(
      "本機內容已更新；重新載入頁面後仍可能失去。",
      "Local content updated. It may still be lost when this page reloads.",
    ));
    onSaveDraft();
  }

  function switchPane(nextPane: GrowthPane) {
    setPane(nextPane);
  }

  function handleTabKeys(
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentPane: GrowthPane,
  ) {
    let nextPane: GrowthPane | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      nextPane = currentPane === "image" ? "evidence" : "image";
    } else if (event.key === "Home") {
      nextPane = "image";
    } else if (event.key === "End") {
      nextPane = "evidence";
    }
    if (nextPane !== null) {
      event.preventDefault();
      switchPane(nextPane);
      document.getElementById(`growth-tab-${nextPane}`)?.focus();
    }
  }

  return (
    <section
      ref={workspaceRef}
      className="s-growth-workspace"
      aria-label={tx("圖片成長工作區", "Image growth workspace")}
      data-skill={skillId}
      data-layout={desktop ? "wide" : compact ? "compact" : "narrow"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <div className="s-between s-growth-workspace-head">
        <div>
          <span className="s-eyebrow">IMAGE QUEST</span>
          <h2>{tx("把一張圖，整理成下一步", "Turn one image into a next step")}</h2>
          <span className="s-growth-skill-name">{skill?.titleZh}</span>
        </div>
        <span className="s-save-state">
          <LockKeyhole size={13} aria-hidden />
          {tx("尚未保存 · 僅保存在此瀏覽器", "Not saved · browser only")}
        </span>
      </div>

      {!desktop && (
        <div className="s-growth-mobile-tabs" role="tablist" aria-label={tx("圖片成長步驟", "Image growth steps")}>
          {([
            ["image", tx("圖片與描述", "Image & description")],
            ["evidence", tx("證據與草稿", "Evidence & draft")],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              id={`growth-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={pane === id}
              aria-controls={`growth-panel-${id}`}
              tabIndex={pane === id ? 0 : -1}
              onClick={() => switchPane(id)}
              onKeyDown={(event) => handleTabKeys(event, id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {feedback && <div role="status" className="s-growth-feedback">{feedback}</div>}

      <div className="s-growth-panels">
        {showImage && (
          <section
            id="growth-panel-image"
            role={desktop ? "region" : "tabpanel"}
            aria-labelledby={desktop ? undefined : "growth-tab-image"}
            aria-label={desktop ? tx("圖片與手動描述", "Image and manual description") : undefined}
            className="s-growth-panel s-growth-image-panel"
          >
            <div className="s-growth-step-label">
              <span>1</span>
              <div>
                <strong>{tx("先放進你的圖", "Start with your image")}</strong>
                <small>{tx("一次一張靜態圖片", "One static image at a time")}</small>
              </div>
            </div>
            <label className="s-growth-file" htmlFor={inputId}>
              <ImagePlus size={24} aria-hidden />
              <span>
                <strong>{tx("選擇本地圖片", "Choose a local image")}</strong>
                <small>JPEG · PNG · WebP</small>
              </span>
              <ChevronRight size={18} aria-hidden />
            </label>
            <input
              id={inputId}
              className="sr-only"
              type="file"
              aria-label={tx("選擇本地圖片", "Choose a local image")}
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                chooseImage(file);
              }}
            />
            <small className="s-file-heuristic">
              {tx(
                "檔案類型只作本機初步篩選；內容尚未驗證，也未上傳。",
                "File type is only a local preliminary check. The content is not verified or uploaded.",
              )}
            </small>
            {previewUrl !== null && (
              <figure className="s-growth-preview">
                <img src={previewUrl} alt={tx("已選圖片的本地預覽", "Local preview of selected image")} />
                <figcaption>
                  <LockKeyhole size={13} aria-hidden />
                  {tx("私人預覽 · 只在此瀏覽器", "Private preview · this browser only")}
                </figcaption>
              </figure>
            )}
            <div className="s-growth-processing">
              <Info size={17} aria-hidden />
              <div>
                <strong>{tx("處理尚未核准", "Processing not approved")}</strong>
                <p>
                  {tx(
                    "你選的圖片不會上傳，也不會送到模型。請先手動描述畫面。",
                    "Your image will not be uploaded or sent to a model. Describe it manually for now.",
                  )}
                </p>
              </div>
            </div>
            <label className="s-growth-field" htmlFor={`${inputId}-description`}>
              <span>{tx("圖片畫面描述", "Image description")}</span>
              <textarea
                id={`${inputId}-description`}
                value={manualDescription}
                maxLength={2000}
                placeholder={tx(
                  "例如：產品在中間，背景是木桌；我留意到光線偏暖……",
                  "For example: the product is centered on a wooden table with warm light…",
                )}
                onChange={(event) => setManualDescription(event.target.value)}
              />
            </label>
            <div className="s-growth-actions">
              <button type="button" className="s-btn" onClick={describeManually}>
                <Check size={16} />
                {tx("使用手動描述", "Use manual description")}
              </button>
              {sampleUi?.trigger}
            </div>
          </section>
        )}

        {showEvidence && (
          <section
            id="growth-panel-evidence"
            role={desktop ? "region" : "tabpanel"}
            aria-labelledby={desktop ? undefined : "growth-tab-evidence"}
            aria-label={desktop ? tx("證據與下一篇草稿", "Evidence and next-post draft") : undefined}
            className="s-growth-panel s-growth-evidence-panel"
          >
            <div className="s-growth-step-label">
              <span>2</span>
              <div>
                <strong>{tx("分清證據，再寫下一步", "Separate evidence from the next step")}</strong>
                <small>{tx("證據與你的圖片分開顯示", "Evidence and your image are shown separately")}</small>
              </div>
            </div>

            {activeReport === null ? (
              <div className="s-growth-empty">
                <span aria-hidden>🧩</span>
                <strong>{tx("尚未載入證據", "No evidence loaded yet")}</strong>
                <p>{tx(
                  "選擇圖片後先寫手動描述，或載入可用的證據。",
                  "Choose an image and describe it manually, or load available evidence.",
                )}</p>
              </div>
            ) : (
              <div className="s-growth-evidence-grid">
                {sampleUi?.banner}
                {hasOfficialSource ? <article className="s-evidence-source official">
                  <div className="s-evidence-source-head">
                    <span className="s-source-icon" aria-hidden>◎</span>
                    <div>
                      <h3>{tx("官方指標", "Official metrics")}</h3>
                      <span className="s-source-badge official">
                        {sampleUi?.metricBadge ?? tx("Instagram 官方", "Instagram official")}
                      </span>
                    </div>
                  </div>
                  <dl className="s-metric-grid">
                    {activeReport.metrics.map((metric) => (
                      <div key={metric.metric}>
                        <dt>{METRIC_LABELS[metric.metric] ?? metric.metric}</dt>
                        <dd data-status={metric.status}>
                          {metricValue(metric.value, locale)}
                          <small>{metric.status === "available" ? tx("已提供", "provided") : tx("未提供", "missing")}</small>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <dl className="s-evidence-periods">
                    <div>
                      <dt>{tx("貼文選取", "Post selection")}</dt>
                      <dd>
                        {tx(
                          `最近 ${activeReport.period.selection.windowDays} 日 · 最多 ${activeReport.period.selection.mediaLimit} 篇`,
                          `Latest ${activeReport.period.selection.windowDays} days · up to ${activeReport.period.selection.mediaLimit} posts`,
                        )}
                        <small>{tx("只用於選取", "selection only")}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>{tx("指標期", "Metric period")}</dt>
                      <dd>
                        {activeReport.period.metrics.map((period) => (
                          <span key={period.metric}>
                            {METRIC_LABELS[period.metric] ?? period.metric}：
                            {metricPeriodLabel(period)}
                            <small className="s-source-reference">{period.sourceRef}</small>
                          </span>
                        ))}
                        <small>{tx("未列出者為未驗證", "Unlisted metrics are unverified")}</small>
                      </dd>
                    </div>
                  </dl>
                  <details className="s-raw-metrics">
                    <summary>{tx("查看原始指標名", "View raw metric names")}</summary>
                    <p>{activeReport.metrics.map((metric) => metric.metric).join(" · ")}</p>
                  </details>
                  <small>
                    {sampleUi?.metricNotice ?? tx("每個指標只按來源回傳的期間解讀。", "Read each metric only within the period returned by its source.")}
                  </small>
                  <div className="s-official-source-refs">
                    {officialSources.map((source) => (
                      <small key={`${source.sourceRef}:${source.observedAt}:${source.periodKind}`}>
                        {source.sourceRef} · {formatEvidenceTime(source.observedAt)} · {source.sampleOnly ? sampleUi?.observationLabel ?? tx("未驗證來源", "Unverified source") : tx("官方來源", "Official source")}
                      </small>
                    ))}
                  </div>
                </article> : <div className="s-evidence-unavailable">
                  <strong>{tx("官方指標未提供", "Official metrics unavailable")}</strong>
                  <small>{tx("沒有可顯示的官方來源記錄。", "No official source record is available.")}</small>
                </div>}

                {hasPublicImageSource ? <article className="s-evidence-source public-image">
                  <div className="s-evidence-source-head">
                    <span className="s-source-icon" aria-hidden>▧</span>
                    <div>
                      <h3>{tx("第三方公開圖片", "Third-party public image")}</h3>
                      <span className="s-source-badge mock">{sampleUi?.publicImageBadge ?? tx("公開媒體", "Public media")}</span>
                    </div>
                  </div>
                  <p>{tx(
                    "只會採用與原貼文紀錄完全吻合的公開單張圖片。",
                    "Only a single public image matching the original post record is accepted.",
                  )}</p>
                  <small>
                    {activeReport.provenance.publicImageMock?.sourceRef} · {formatEvidenceTime(activeReport.provenance.publicImageMock?.observedAt ?? activeReport.runAt)}
                  </small>
                  <small>{tx("使用權未核對 · 未載入真實圖片", "Usage rights unchecked · no live image loaded")}</small>
                </article> : <div className="s-evidence-unavailable">
                  <strong>{tx("第三方公開圖片未提供", "Third-party public image unavailable")}</strong>
                  <small>{tx("沒有可顯示的公開圖片來源記錄。", "No public image source record is available.")}</small>
                </div>}

                {hasManualSource && <article className="s-evidence-source self-upload">
                  <div className="s-evidence-source-head">
                    <span className="s-source-icon" aria-hidden>♙</span>
                    <div>
                      <h3>
                        {sampleUi?.manualHeading ?? tx("你的圖片／手動描述", "Your image / manual description")}
                      </h3>
                      <span className={`s-source-badge ${sampleUi?.manualBadge === undefined ? "private" : "mock"}`}>
                        {sampleUi?.manualBadge ?? tx("本人提供", "Creator-provided")}
                      </span>
                    </div>
                  </div>
                  <p>
                    {sampleUi?.manualBody ?? selectedFile?.name ?? tx("手動描述", "Manual description")}
                  </p>
                  <small>{tx("只在此瀏覽器 · 尚未保存", "This browser only · not saved")}</small>
                </article>}

                <article className="s-evidence-source coverage">
                  <div className="s-evidence-source-head">
                    <span className="s-source-icon" aria-hidden>⌖</span>
                    <div>
                      <h3>{tx("香港繁中覆蓋", "Hong Kong Traditional Chinese coverage")}</h3>
                      <span className="s-source-badge unverified">{tx("未驗證", "Unverified")}</span>
                    </div>
                  </div>
                  <p>{tx(
                    sampleUi?.coverageNotice ?? "未取得可核對的地區與語言覆蓋，不能把資料當成香港市場成效。",
                    sampleUi?.coverageNotice ?? "Verified region and language coverage is unavailable, so the data is not Hong Kong market evidence.",
                  )}</p>
                  <div className="s-coverage-row">
                    <span>{tx("地區", "Region")} <strong>{activeReport.region.label}</strong></span>
                    <span>{tx("語言", "Language")} <strong>{activeReport.language.label}</strong></span>
                  </div>
                </article>

                <details className="s-evidence-report-meta">
                  <summary>{tx("查看問題、時間與引用", "View question, timing and citations")}</summary>
                  <dl>
                    <div>
                      <dt>{tx("問題", "Question")}</dt>
                      <dd>{activeReport.question}</dd>
                    </div>
                    <div>
                      <dt>{tx("平台", "Platform")}</dt>
                      <dd>Instagram</dd>
                    </div>
                    <div>
                      <dt>{sampleUi?.reportTimeLabel ?? tx("報告產生時間", "Report generated at")}</dt>
                      <dd>{formatEvidenceTime(activeReport.runAt)}</dd>
                    </div>
                    <div>
                      <dt>{tx("觀察", "Observation")}</dt>
                      <dd>
                        {activeReport.observation.availability === "manual"
                          ? tx("手動描述", "Manual description")
                          : tx("已觀察", "Observed")}
                        {" · "}
                        {sampleUi?.observationLabel ?? (
                          activeReport.observation.sampleOnly
                            ? tx("未驗證來源", "Unverified source")
                            : activeReport.observation.sourceKind === "creator-upload"
                            ? tx("你的圖片", "Your image")
                            : tx("未驗證圖片", "Unverified image")
                        )}
                        {activeReport.provenance.selfUploadManual
                          ? ` · ${formatEvidenceTime(activeReport.provenance.selfUploadManual.observedAt)}`
                          : ""}
                      </dd>
                    </div>
                  </dl>
                  <ul>
                    {activeReport.citations.map((citation) => {
                      const sourceLabel =
                        citation.sourceKind === "official_metrics" &&
                        sampleUi?.officialCitationLabel !== undefined
                          ? sampleUi.officialCitationLabel
                          : SOURCE_KIND_LABELS[citation.sourceKind] ?? citation.title;
                      return (
                        <li key={`${citation.sourceKind}:${citation.sourceRef}:${citation.observedAt}`}>
                          <strong>{sourceLabel}</strong>
                          <span>{citation.title}</span>
                          <small>
                            {citation.sourceRef} · {formatEvidenceTime(citation.observedAt)} · {citation.sampleOnly ? sampleUi?.citationSampleLabel ?? tx("來源未驗證", "Source unverified") : tx("來源未驗證", "Source unverified")}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </div>
            )}

            <label className="s-growth-field s-growth-draft" htmlFor={`${inputId}-draft`}>
              <span>{tx("下一篇貼文草稿", "Next-post draft")}</span>
              <textarea
                id={`${inputId}-draft`}
                value={draft}
                maxLength={4000}
                placeholder={tx(
                  "把已確認的觀察寫成可編輯文案；不要補上未提供的數字。",
                  "Turn confirmed observations into editable copy. Leave missing metrics out.",
                )}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <div className="s-growth-actions">
              <button
                type="button"
                className="s-btn s-primary"
                onClick={updateLocalDraft}
                disabled={!draft.trim()}
              >
                {tx("更新草稿（僅此頁）", "Update draft (this page only)")}
              </button>
              {onOpenBrief && (
                <button type="button" className="s-btn" onClick={onOpenBrief}>
                  {tx("前往私人 Brief", "Open private brief")}
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
            <p className="s-growth-save-note">
              {tx(
                "草稿只保留在此頁；尚未保存，也不會自動發佈。",
                "This draft stays on this page. It is not saved or published automatically.",
              )}
            </p>
          </section>
        )}
      </div>
    </section>
  );
}

export function GrowthImageWorkspace(props: GrowthImageWorkspaceProps) {
  const boundaryKey = `${props.threadId}:${props.identityKey}:${props.skillId}`;
  return <GrowthWorkspaceBoundary key={boundaryKey} {...props} />;
}
