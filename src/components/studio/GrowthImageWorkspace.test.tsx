import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrowthEvidenceReport } from "../../../server/lib/creatorGrowth/report";
import { SYNTHETIC_GROWTH_REPORT } from "@/lib/creatorGrowth/sampleReport";
import { GrowthImageWorkspace } from "./GrowthImageWorkspace";
import GrowthImageWorkspaceDev from "./GrowthImageWorkspaceDev";

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

function renderWorkspace(
  overrides: Partial<React.ComponentProps<typeof GrowthImageWorkspace>> = {},
) {
  const onChooseImage = vi.fn();
  const onDescribeImage = vi.fn();
  const onSaveDraft = vi.fn();
  const view = render(
    <GrowthImageWorkspace
      threadId="thread-a"
      identityKey="creator-a"
      skillId="image_diagnosis"
      onChooseImage={onChooseImage}
      onDescribeImage={onDescribeImage}
      onSaveDraft={onSaveDraft}
      {...overrides}
    />,
  );
  return { view, onChooseImage, onDescribeImage, onSaveDraft };
}

function renderDevelopmentWorkspace(
  overrides: Partial<React.ComponentProps<typeof GrowthImageWorkspaceDev>> = {},
) {
  const onChooseImage = vi.fn();
  const onDescribeImage = vi.fn();
  const onSaveDraft = vi.fn();
  const view = render(
    <GrowthImageWorkspaceDev
      threadId="thread-a"
      identityKey="creator-a"
      skillId="image_diagnosis"
      onChooseImage={onChooseImage}
      onDescribeImage={onDescribeImage}
      onSaveDraft={onSaveDraft}
      {...overrides}
    />,
  );
  return { view, onChooseImage, onDescribeImage, onSaveDraft };
}

function stubWorkspaceWidth(width: number) {
  vi.stubGlobal("ResizeObserver", class ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe() {
      this.callback(
        [{ contentRect: { width } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {}
    disconnect() {}
  });
}

describe("GrowthImageWorkspace", () => {
  beforeEach(() => {
    createObjectURL.mockReset().mockReturnValue("blob:growth-preview");
    revokeObjectURL.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches:
        query.includes("prefers-reduced-motion") ||
        query.includes("max-width"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a selected image private and enables manual description without upload or model requests", async () => {
    const file = new File(["private-image"], "post.png", {
      type: "image/png",
    });
    const { onChooseImage, onDescribeImage } = renderWorkspace();

    fireEvent.change(screen.getByLabelText("選擇本地圖片"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByAltText("已選圖片的本地預覽")).toHaveAttribute(
        "src",
        "blob:growth-preview",
      );
    });
    expect(screen.getByText("私人預覽 · 只在此瀏覽器")).toBeInTheDocument();
    expect(screen.getByText("處理尚未核准")).toBeInTheDocument();
    expect(
      screen.getByText(
        "檔案類型只作本機初步篩選；內容尚未驗證，也未上傳。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("圖片畫面描述")).toBeEnabled();
    expect(onChooseImage).toHaveBeenCalledWith(file);
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "使用手動描述" }));
    expect(onDescribeImage).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("releases object URLs on replacement and unmount", async () => {
    const first = new File(["one"], "one.png", { type: "image/png" });
    const second = new File(["two"], "two.png", { type: "image/png" });
    const { view } = renderWorkspace();
    const input = screen.getByLabelText("選擇本地圖片");

    createObjectURL
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    fireEvent.change(input, { target: { files: [first] } });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { files: [second] } });
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
      expect(createObjectURL).toHaveBeenCalledTimes(2);
    });

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");
  });

  it("shows explicit synthetic evidence with separate attribution and an unsaved local draft", async () => {
    const { onSaveDraft } = renderDevelopmentWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "查看合成示例" }));
    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));
    await screen.findByText("合成示例 · 未驗證");

    expect(screen.getByText("合成示例 · 未驗證")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "官方指標" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "第三方公開圖片" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "合成手動示例" }),
    ).toBeInTheDocument();
    expect(screen.getByText("示例 · 非本人提供")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "香港繁中覆蓋" }),
    ).toBeInTheDocument();
    expect(screen.getByText("貼文選取")).toBeInTheDocument();
    expect(screen.getByText("最近 30 日 · 最多 50 篇")).toBeInTheDocument();
    expect(screen.getByText("只用於選取")).toBeInTheDocument();
    expect(screen.getByText("指標期")).toBeInTheDocument();
    expect(
      screen.getByText("觸及：此貼文累計（lifetime）"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("讚好：此貼文累計（lifetime）"),
    ).toBeInTheDocument();
    expect(screen.getByText("未列出者為未驗證")).toBeInTheDocument();
    expect(screen.queryByText("REACH")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("查看原始指標名"));
    expect(screen.getByText(/reach · views · impressions/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("查看問題、時間與引用"));
    expect(screen.getByText("示例固定時間")).toBeInTheDocument();
    expect(
      screen.getByText("2026年11月4日 下午12:10 HKT"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/2026年11月4日 下午12:00 HKT/).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText("合成示例指標（模擬 Instagram 合約，非官方讀取）"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sample-official-metrics.*官方來源/)).toBeNull();
    expect(document.querySelectorAll(".s-source-reference")).toHaveLength(2);
    expect(document.querySelectorAll(".s-official-source-refs small")).toHaveLength(1);
    expect(screen.getByText("尚未保存 · 僅保存在此瀏覽器")).toBeInTheDocument();
    expect(
      screen.getByLabelText("下一篇貼文草稿"),
    ).toHaveDisplayValue(/這張圖讓我留意/);
    expect(within(screen.getByRole("region", { name: "圖片成長工作區" })).queryByRole("button", { name: /發佈/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "更新草稿（僅此頁）" }));
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByText("尚未保存 · 僅保存在此瀏覽器")).toBeInTheDocument();
  });

  it("clears the previous analysis and proposal when the selected image changes", async () => {
    renderDevelopmentWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "查看合成示例" }));
    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));
    await screen.findByText("合成示例 · 未驗證");
    expect(screen.getByText("合成示例 · 未驗證")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "圖片與描述" }));
    fireEvent.change(screen.getByLabelText("選擇本地圖片"), {
      target: {
        files: [new File(["new-image"], "new.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));

    expect(screen.queryByText("合成示例 · 未驗證")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "官方指標" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("上一個分析與提案已清除，請重新確認目前圖片。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("下一篇貼文草稿")).toHaveValue("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalidates a supplied report and clears manual text when the image changes", () => {
    renderWorkspace({ report: SYNTHETIC_GROWTH_REPORT });
    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));
    expect(screen.getByRole("heading", { name: "官方指標" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "圖片與描述" }));
    fireEvent.change(screen.getByLabelText("圖片畫面描述"), {
      target: { value: "Old image description" },
    });
    fireEvent.change(screen.getByLabelText("選擇本地圖片"), {
      target: {
        files: [new File(["new-image"], "new.png", { type: "image/png" })],
      },
    });
    expect(screen.getByLabelText("圖片畫面描述")).toHaveValue("");

    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));
    expect(screen.queryByRole("heading", { name: "官方指標" })).not.toBeInTheDocument();
    expect(screen.queryByText("sample-official-metrics")).not.toBeInTheDocument();
    expect(screen.getByText("尚未載入證據")).toBeInTheDocument();
  });

  it("reopens the synthetic sample with fresh state after an image selection", async () => {
    renderDevelopmentWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "查看合成示例" }));
    fireEvent.click(screen.getByRole("tab", { name: "圖片與描述" }));
    fireEvent.change(screen.getByLabelText("圖片畫面描述"), {
      target: { value: "本機圖片描述" },
    });

    fireEvent.change(screen.getByLabelText("選擇本地圖片"), {
      target: {
        files: [new File(["new-image"], "new.png", { type: "image/png" })],
      },
    });
    expect(screen.getByAltText("已選圖片的本地預覽")).toBeInTheDocument();
    expect(screen.getByLabelText("圖片畫面描述")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "查看合成示例" }));
    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));
    await screen.findByText("合成示例 · 未驗證");

    fireEvent.click(screen.getByRole("tab", { name: "圖片與描述" }));
    await waitFor(() =>
      expect(
        screen.queryByAltText("已選圖片的本地預覽"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("圖片畫面描述")).toHaveValue("");
    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));
    expect(screen.getByLabelText("下一篇貼文草稿")).toHaveDisplayValue(
      /這張圖讓我留意/,
    );
  });

  it("does not revive an unrelated base report after replacing a sample image", () => {
    const baseReport = structuredClone(
      SYNTHETIC_GROWTH_REPORT,
    ) as unknown as GrowthEvidenceReport;
    renderDevelopmentWorkspace({ report: baseReport });
    fireEvent.click(screen.getByRole("button", { name: "查看合成示例" }));
    fireEvent.click(screen.getByRole("tab", { name: "圖片與描述" }));
    fireEvent.change(screen.getByLabelText("選擇本地圖片"), {
      target: {
        files: [new File(["new-image"], "new.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));

    expect(
      screen.queryByRole("heading", { name: "官方指標" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("尚未載入證據")).toBeInTheDocument();
  });

  it("does not render official or public image sources absent from report provenance", () => {
    const unavailableReport = structuredClone(
      SYNTHETIC_GROWTH_REPORT,
    ) as unknown as GrowthEvidenceReport;
    const mutableReport = unavailableReport as unknown as {
      availability: {
        officialMetrics: "available" | "partial" | "unavailable";
        publicImageMock: "available" | "mock" | "unavailable" | "not_provided";
        selfUploadManual: "manual" | "not_applicable";
      };
      provenance: {
        officialMetrics: unknown[];
        publicImageMock: unknown;
        selfUploadManual: unknown;
      };
    };
    mutableReport.availability.officialMetrics = "unavailable";
    mutableReport.availability.publicImageMock = "not_provided";
    mutableReport.availability.selfUploadManual = "not_applicable";
    mutableReport.provenance.officialMetrics = [];
    mutableReport.provenance.publicImageMock = null;
    mutableReport.provenance.selfUploadManual = null;

    renderWorkspace({ report: unavailableReport });
    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));

    expect(screen.getByText("官方指標未提供")).toBeInTheDocument();
    expect(screen.getByText("第三方公開圖片未提供")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "官方指標" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "第三方公開圖片" }),
    ).not.toBeInTheDocument();
  });

  it("reports local growth dirtiness after image selection", async () => {
    const onDirtyChange = vi.fn();
    renderWorkspace({ onDirtyChange });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.change(screen.getByLabelText("選擇本地圖片"), {
      target: {
        files: [new File(["dirty"], "dirty.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });

  it("uses the growth workspace width to choose narrow and wide layouts", async () => {
    stubWorkspaceWidth(420);
    const narrowView = renderWorkspace().view;
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "圖片成長工作區" }),
      ).toHaveAttribute("data-layout", "compact"),
    );
    expect(
      screen.getByRole("tablist", { name: "圖片成長步驟" }),
    ).toBeInTheDocument();
    expect(document.querySelector("#growth-panel-evidence")).toBeNull();
    narrowView.unmount();

    stubWorkspaceWidth(820);
    renderWorkspace();
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "圖片成長工作區" }),
      ).toHaveAttribute("data-layout", "wide"),
    );
    expect(
      screen.queryByRole("tablist", { name: "圖片成長步驟" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector("#growth-panel-image")).not.toBeNull();
    expect(document.querySelector("#growth-panel-evidence")).not.toBeNull();
  });

  it("drops local image, report, and draft state when the identity boundary changes", async () => {
    const { view } = renderWorkspace();
    fireEvent.change(screen.getByLabelText("選擇本地圖片"), {
      target: {
        files: [new File(["one"], "private.png", { type: "image/png" })],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByAltText("已選圖片的本地預覽"),
      ).toBeInTheDocument(),
    );

    view.rerender(
      <GrowthImageWorkspace
        threadId="thread-a"
        identityKey="creator-b"
        skillId="image_diagnosis"
        onChooseImage={vi.fn()}
        onDescribeImage={vi.fn()}
        onSaveDraft={vi.fn()}
      />,
    );

    expect(
      screen.queryByAltText("已選圖片的本地預覽"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "證據與草稿" }));
    expect(screen.getByLabelText("下一篇貼文草稿")).toHaveValue("");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:growth-preview");
  });

  it("supports keyboard tabs and exposes compact and reduced-motion states", () => {
    renderWorkspace();
    const root = screen.getByRole("region", { name: "圖片成長工作區" });
    expect(root).toHaveAttribute("data-reduced-motion", "true");
    expect(root).toHaveAttribute("data-layout", "compact");

    const imageTab = screen.getByRole("tab", { name: "圖片與描述" });
    imageTab.focus();
    fireEvent.keyDown(imageTab, { key: "ArrowRight" });
    expect(
      screen.getByRole("tab", { name: "證據與草稿" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("runs the development-only publishing example without posting, saving or fabricating a permalink", async () => {
    const { onSaveDraft, onChooseImage } = renderDevelopmentWorkspace();
    expect(screen.queryByRole("heading", { name: "這一篇，由你確認" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "開啟發佈模擬（開發用）" }));
    expect(screen.getByText(/開發專用合成流程/)).toBeInTheDocument();
    expect(screen.getByText("@kocmax_demo_only")).toBeInTheDocument();
    fireEvent.load(screen.getByAltText("開發示例圖片，非使用者上傳"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "模擬確認 · 不會發佈到 Instagram" }));
    expect(await screen.findByRole("heading", { name: "示例回執 · 沒有發佈" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Instagram/ })).not.toBeInTheDocument();
    expect(onSaveDraft).not.toHaveBeenCalled();
    expect(onChooseImage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the simulated unknown outcome unknown after a read-only check, with manual guidance", async () => {
    renderDevelopmentWorkspace();
    fireEvent.change(screen.getByLabelText("發佈模擬情境"), { target: { value: "unknown" } });
    fireEvent.click(screen.getByRole("button", { name: "開啟發佈模擬（開發用）" }));
    fireEvent.load(screen.getByAltText("開發示例圖片，非使用者上傳"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "模擬確認 · 不會發佈到 Instagram" }));
    expect(await screen.findByRole("heading", { name: "結果待確認" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "檢查發佈狀態（唯讀）" }));
    expect(await screen.findByText(/模擬查詢完成，沒有可核對的官方回執/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "結果待確認" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /再發佈|重試/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回到原任務核對" }));
    expect(screen.getByText(/示例只說明原任務核對流程/)).toBeVisible();
    expect(screen.queryByText(/再依原任務要求手動發佈/)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks required unsupported labels in the development example and preserves the manual route", () => {
    renderDevelopmentWorkspace();
    fireEvent.change(screen.getByLabelText("發佈模擬情境"), { target: { value: "manual" } });
    fireEvent.click(screen.getByRole("button", { name: "開啟發佈模擬（開發用）" }));
    expect(screen.getByRole("button", { name: "模擬確認 · 不會發佈到 Instagram" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "原有手動發佈／提交證明" }));
    expect(screen.getByText(/示例只說明原任務手動流程/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("closes the example and disables publishing simulation for actual user uploads", () => {
    const { onChooseImage } = renderDevelopmentWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "開啟發佈模擬（開發用）" }));
    const file = new File(["real local image"], "private.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("選擇本地圖片"), { target: { files: [file] } });
    expect(screen.queryByRole("heading", { name: "這一篇，由你確認" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "開啟發佈模擬（開發用）" })).toBeDisabled();
    expect(screen.getByText(/真實上傳不能用於此模擬/)).toBeInTheDocument();
    expect(onChooseImage).toHaveBeenCalledWith(file);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("drops a development confirmation when the thread or identity changes", () => {
    const { view } = renderDevelopmentWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "開啟發佈模擬（開發用）" }));
    fireEvent.load(screen.getByAltText("開發示例圖片，非使用者上傳"));
    fireEvent.click(screen.getByRole("checkbox"));
    view.rerender(<GrowthImageWorkspaceDev threadId="thread-b" identityKey="creator-b" skillId="image_diagnosis" onChooseImage={vi.fn()} onDescribeImage={vi.fn()} onSaveDraft={vi.fn()} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "這一篇，由你確認" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
