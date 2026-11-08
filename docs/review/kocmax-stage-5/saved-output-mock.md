# 成果收藏與再次編輯 mock 驗收

日期：2026-11-06。分支：`codex/kocmax-studio-stages-1-2`。Native inline implementation；所有修改留在工作目錄，未 stage／commit。

## 已完成

- 沿用目前討論的「已保存成果」，新增私人卡片、最高版本標記、保存時間、來源數及唯讀版本預覽。
- 複製以當前 Brief／來源重新驗證，保留來源 id 與私人權限，建立全新段落 id。原版本不變；按保存前沒有寫入。
- 未保存內容須選保留或替換。替換清空分享選取、確認、任務目標及舊回執。
- 保存／分享 pending 或 unknown outcome 阻止複製，重試保留原 requestId。既有「核對最新版本」亦不能清除 unknown request。
- 保存回應和 refetch 先後順序不覆寫較新的本機編輯；精確保存的副本顯示「已保存」，修改後回復「未保存」。
- 缺失、撤銷、跨討論或重複歧義來源隱藏其衍生段落，阻止整份複製。私人可用來源仍可編輯，分享限制不變。
- 新增僅 owner A 可讀的 development fixture 討論 `...000910`，含兩個合成版本；其他既有 fixture 保留。

## 自動測試：PASS

| 檢查 | 結果 |
| --- | --- |
| 純 policy | 14/14；先觀察缺少模組的 RED |
| 成果卡元件 | 2/2；先觀察缺少元件的 RED |
| StudioWorkspace | 35/35；首批7項新測試先失敗，整合後通過；追加保存時序／401／分享回執測試通過 |
| Fixture ownership | 23/23；新討論先404失敗，新增後通過；原版本與積分不變、兩種 peer 拒絕 |
| 最終 Studio／integration／policy／fixture 選定回歸 | 292/292、17 files |
| Production fixture-off build 與排除字串 | PASS；包含 `SAVED_OUTPUT_MOCK_ONLY` 及新示例字串；於先前同次290項綜合驗證內通過，此後只追加測試及文件／末尾空白清理 |
| TypeScript `--noEmit`／指定檔案 ESLint | exit 0 |
| 指定既有檔案 `git diff --check` | exit 0 |

不是全 repository suite 或 live Auth/RLS 驗收。日誌在 `.superpowers/sdd/2026-11-05-kocmax-saved-output-mock/`：`editor-red.log`、`editor-green.log`、`fixture-red.log`、`acceptance.log`、`editor-final.log`、`final-regression.log`。

## 內建瀏覽器：直接觀察

本機 `http://127.0.0.1:8771/studio?thread=00000000-0000-4000-8000-000000000910`；僅 synthetic fixture。8770 原服務失效／沙箱服務無法存取，改為明確允許的 loopback-only 8771 後正常。未修改防火牆或安全設定。

| 情境 | 觀察結果 |
| --- | --- |
| 手機390×844 | 卡片／舊版預覽／複製／編輯／保留修改／保存 v3 通過；另測替換成 v2 並保存 |
| 桌面1440×1000 | 鍵盤 Enter 複製／修改／替換／保存 v4 通過；v1/v2 內容保留 |
| 橫向版面 | 手機 scrollWidth384≤390；桌面1434≤1440，無橫向溢出 |
| 焦點 | 實測 Keep 返回發起卡按鈕；成功替換移至 Brief 標題 |
| 私人來源 | 選取私人段落顯示權限錯誤、任務轉存停用 |
| 撤銷合成私人來源 | 開啟的v1/v2預覽相關文字被隱藏，全部引用版本複製停用 |
| 同工作區 peer | 切換後私人卡消失；直接開啟 owner 討論被中性拒絕 |
| 手機401 | 私人卡片0、textbox0；顯示重新登入提示 |
| Reload | 恢復兩個初始合成版本，暫存演練不當作持久保存；正常狀態與 owner 恢復，viewport override 已reset |

截圖：`saved-output-mobile.png`、`saved-output-desktop.png`、`saved-output-final.png`（同目錄）。Fixture 共用固定時鐘，所以新增版本時間可能早於示例v2；版本順序依版本號，不依日期。

## 獨立審查與限制

Avicenna read-only reviewer：無 Critical／Important。一項 **Minor 延後**：某些不會讓 pointer-click 按鈕取得焦點的瀏覽器，若之前另一個按鈕有焦點，Keep 可能返回先前按鈕而非此次卡片；資料／草稿不受影響。目前內建瀏覽器實測正確。

採用的裁定：

1. 保留未提交 patch 和 scratch ledger，審查本功能的目前檔案；遵守不 commit 指示。若忽略 dirty baseline，後續審查可能混入無關修改，因此不宣稱全分支通過。
2. unknown command 必須先取得確定結果，不能靠核對版本解除。代價是暫時需等待結果，保留重試身分和資料安全。
3. Reviewer 未評估無關 baseline；controller 自行執行上述測試和瀏覽器驗證。Reviewer 未重跑測試不等於獨立測試證明。
4. 真實 provider／SQL／production 被明確排除；所有結果僅為 mock，本輪不構成上線或真實授權驗收。

未部署、未套用SQL、未建立真實Instagram／Drive連接、未發布貼文或發放獎勵。
