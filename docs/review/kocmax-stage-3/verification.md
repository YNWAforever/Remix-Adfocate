# KOCmax Stage 3：完整畫面遷移與旅程驗證

日期：2026-10-31 HKT。分支：`codex/kocmax-studio-stages-1-2`。本期基準：`64f4e93`；保留 Stage 1–2 及其上游 `a20b29e2691929f47b26ea9505082bb0882fc404` 的修正。

本期完成共用設計套用至全部現有頁面家族，並以實際 React 畫面及本機 transport fixture 驗證。沒有部署、push、merge、真實連接、遠端資料寫入或 migration。正式開關仍預設關閉。

## 設計與功能保留

| 旅程 | 本期設計 | 保留的功能／權威流程 |
| --- | --- | --- |
| 訪客 | 公開頁共用 KOCmax 外殼；窄手機兩行導覽、探索選單及語言切換；登入吉祥物；表單、法律頁與公開護照樣式 | 創作者、品牌、方案、案例、playbooks、收益介紹、聯絡預覽；密碼／magic link／callback／reset；原安全 next 與 consent。聯絡表單仍清楚標示不會送出 |
| 新創作者 | 五步設定同一圓角配色與表單語言 | 原 categories、選填社交欄位、推薦任務、迎新規則；可略過社交帳號 |
| 任務與內容 | 插畫任務卡、任務站點提示、活動卡、清楚的狀態及日期；草稿、證明、審批頁套用共用主題 | 所有資格、平台、交付項目、名額、deadline、現金／積分、版本、checklist、上載與提交控制；原 active / legacy workflow |
| 對話工作室 | 保持對話／證據／Brief 三步；重新驗證有內容的手機與桌面版 | 10 個範本、四個主題、任務 context、歷史 thread、私人來源、不可變 Brief、逐段分享權及回執 |
| 獎賞與錢包 | 收藏卡禮物圖、紫色積分卡、兌換狀態、手機 dialog | 原 idempotency intent、確認、兌換碼、歷史、帳本、現金收益；未知餘額不能兌換，真實零分仍顯示零 |
| 個人與學院 | 創作名片、學習卡、清楚的成長指引；新的探索介紹只承諾已支援流程 | profile、passport、portfolio、social trust、同意選項、匯出／刪除入口、academy、news、通知、match；資料未驗證不造數據 |
| 品牌 | 品牌外殼、頁面標題、任務卡與表單、讀取錯誤及權限提示 | 品牌隔離、任務草稿／發布／關閉、條件式鎖欄位、交付設定、資源中心；新增／編輯成功後刷新任務列表及詳情快取 |
| 營運／審稿／財務 | 既有角色側欄與手機導覽；卡片提示、審核表單與隊列視覺 | applications、legacy submissions、active review、proof、completion、reward handoff、missions、campaigns、creator cases、notes、shortlist、engaged、insights、radar；沿用原 capability gates |
| 內容編輯 | 桌面保留語義表格，手機轉有欄位名稱的卡片；只有一組操作控制 | CMS 與 academy 的中英內容、metadata、版本衝突比較、learning editor、發布狀態；新增儲存錯誤回饋並保留草稿 |

完整功能稽核仍見 [Stage 1–2 功能保留表](../../superpowers/specs/2026-10-31-kocmax-function-audit.md)。本期沒有刪除任何 route，也沒有改動 `server/`、`supabase/`、release scripts、套件版本、正式入口 `src/main.tsx` 或部署設定。

## 設計規格與回退

- 奶油底、紫色主操作、青綠／淺紫／蜜桃任務區，圓角卡片、禮物與拍攝圖示、小芽角色；對話、任務與結果是主要內容。
- `StudioTheme` 只在 `VITE_STUDIO_SHELL=true` 設定根節點標記。關閉原 studio flags 可回到原有外殼；資料、API 與工作流沒有另建一套。
- 桌面保留側欄與工作區，手機維持底部導航。公開導覽在 ≤480px 分兩行；320px 英文按鈕不再逐字換行。CMS 在 <768px 轉卡片且保留 table semantics。
- 操作區最少 44px；可見鍵盤焦點；兌換 dialog 循環 Tab、Escape 關閉並恢復焦點，成功後將焦點移入成功狀態。
- 尊重 `prefers-reduced-motion`；沒有新增倒數壓力、連續登入懲罰、付費抽獎或聊天刷分。減少動態以程式檢查確認，未宣稱已做實機 OS 偏好測試。
- 未連接的社交成效仍為未連接／未驗證，基本任務可繼續。八個技能卡沿用前期設計，沒有建立 OAuth 或同步連接。

## 內建瀏覽器證據

使用內建瀏覽器與 `http://127.0.0.1:8772/` 的開發專用預覽。75 個實際 router 目的地（包括 dynamic route 範例、新增畫面與 redirect）分別在 **390×844** 與 **1440×1000** 走查，共 **150 項**；另有 **22 項** 320、430、768、1024px 抽查。

[完整機讀矩陣](route-coverage.json) 與 [CSV](route-coverage.csv) 記錄 requested/resolved path、角色、寬度、標題、alerts 及非容器內橫向溢出。兩種主要寬度沒有缺頁、渲染例外或非預期橫向溢出。沒有 auth token 的 callback／reset 顯示原有失敗提示，列為預期狀態。

| 實際操作 | 觀察結果 |
| --- | --- |
| 訪客探索選單、中文／英文切換 | 所有直接入口可達；點選後選單關閉；320px 英文可讀 |
| 新手五步 | 選內容興趣 → 略過社交帳號 → 推薦任務 → 完成原迎新流程；沒有真實帳戶或連接 |
| 任務卡 → 對話 → 證據 → Brief | 加入香港繁中手動筆記，保留問題／平台／觀察時間與未驗證標籤；保存私人 v1 |
| 逐段分享 → 原任務 | 只選來源段落，確認分享權及接收者；轉存回執指向原任務，caption 保留引用；原 checklist 與提交控制可用 |
| 原任務提交／獎勵狀態 | 提交 v1 後顯示審批中；用明確標示的模擬伺服器事件切換 pending / settled；settled 才顯示 400 積分入帳、總餘額 600 及「第一份核實成果」徽章，XP 維持 800 |
| 獎賞 | Escape 取消恢復焦點；確認兌換 → 成功碼 → 歷史一筆、扣 100 分；成功狀態焦點仍在 dialog |
| 缺資料 | 錢包及商店讀取失敗顯示「暫未能讀取」；所有兌換按鈕停用；academy error 與 empty 分開呈現 |
| 個人資料 | 修改示例名稱後顯示更新；原社交、作品、私隱及資料管理入口保留 |
| 品牌 | 編輯有效草稿後列表立即更新；409 保留未儲存標題；403 隱藏快取任務，之後 503 不重新顯示 |
| 營運 | 接受示例申請後移出待審隊列；內部備註及 review summary 儲存可見；維持 unknown 社交證據 |
| 審稿／財務 | 批准前清楚提示「不會發放獎賞」；reviewer 無獎勵交接權；finance viewer 顯示唯讀且無結算／設定操作 |
| CMS | 文章儲存後列表更新；409 明確顯示並保留標題；手機卡片沒有複製操作按鈕 |

讀取頁面在兩個主要尺寸都實際走查；上列寫入操作以本機示例做代表性互動測試，並非每個 mutation 都在每個尺寸重複。新 provider 授權、真實檔案上載、帳戶刪除、付款／結算、Auth/RLS 及真實服務整合沒有執行。模擬伺服器事件不是 proof／settlement 後端驗收；未實作的 fixture 路由會拒絕，不偽裝成功。

## 測試與獨立審查

| 驗證 | 實際結果 |
| --- | --- |
| 完整回歸 `vitest run --maxWorkers=2 --minWorkers=2 --testTimeout=15000` | 首次 2,497 通過、363 略過、11 失敗；11 項全屬本機 socket EACCES／temp rename EPERM。相同三個檔案在允許本機操作後 26/26 通過；合計原完整套件 2,508 項通過 |
| 修正後針對測試 | 6 files / 26 tests：studio、兌換、wallet、brand。3 files / 18 tests：ContentEditor、AcademyEditor、MissionEditor permissions。合計 44 項通過，包含本期新增的餘額／焦點、權限、衝突回歸 |
| 最後 `npm run build` | TypeScript、ESM 檢查及正式 Vite build 通過 |
| 最後 `npm run lint` | 0 errors；4 個原有 hook dependency warnings（PublicationProofReview、activeMission queries、onboarding） |
| `npm run release:manifest:check` | 通過；原 digest `8c39be176ad61b84ba4261d18569b8c49bee05a60866985bc8daaf804af86c7d` 不變 |
| 正式 bundle 掃描 | 沒有 `LOCAL_FIXTURE`、`local-fixture-only`、`studioPreviewJourneys`、`LOCAL-EXAMPLE` |
| `git diff --check` | 通過；原 API／SQL／release／production entry 無差異 |
| 獨立審查 | 品牌錯誤 status、兌換確認 guard、成功焦點、手機語言切換，以及 CMS 舊錯誤掩蓋新權限拒絕皆已修正；複查沒有剩餘 actionable finding |

針對新增的 `Save 409 → Publish 403 → read 503` 情況有獨立回歸測試：權限拒絕優先，私人快取不再顯示。保留原 academy metadata rebase、表單背景更新不覆蓋輸入、任務權限鎖及兌換 idempotency 測試。

詳細執行 logs 位於本機 `.superpowers/sdd/kocmax-stage-3/logs/`（ignored）。此報告分開記錄全套初測及最後針對測試，不把前一版本的全套執行稱作最後修改後的全套重跑。363 個原有整合略過項目沒有被計成通過。

## 預覽與截圖

啟動：`node scripts/studio-dev.mjs`。本機預覽：`http://127.0.0.1:8772/`。頁頂可選角色、75 個畫面、normal/empty/error/denied/stale 及模擬伺服器事件。領域資料只在記憶體，重載會重設；僅示例角色存於 sessionStorage。外部 fetch 被拒絕。正式 build 不包含這個入口。

| 桌面 | 手機 |
| --- | --- |
| [工作室](screenshots/desktop-studio.png) | [工作室](screenshots/mobile-studio.png) |
| [有內容的對話](screenshots/desktop-conversation.png) | [Brief 分享確認](screenshots/mobile-brief-sharing.png) |
| [獎賞商店](screenshots/desktop-rewards.png) | [獎賞商店](screenshots/mobile-rewards.png)／[兌換成功](screenshots/mobile-redemption-success.png) |
| [品牌任務](screenshots/desktop-brand-missions.png) | [版本衝突](screenshots/mobile-brand-conflict.png) |
| [審稿隊列](screenshots/desktop-review-queue.png) | [創作者隊列](screenshots/mobile-creator-queue.png) |
| [內容管理](screenshots/desktop-content.png) | [內容卡片](screenshots/mobile-content-cards.png)／[保留草稿](screenshots/mobile-content-conflict.png) |
| [結算後工作室](screenshots/desktop-studio-settled.png) | [任務結算示例](screenshots/mobile-task-settled.png)／[公開首頁](screenshots/mobile-public-home.png) |

下一階段仍需獨立批准真實服務環境的 Auth/RLS、provider 與部署驗收。本期不新增真實 Instagram／Drive 連接，也不把新 leaderboard、好友挑戰或外部提交服務包裝成已實作功能。
