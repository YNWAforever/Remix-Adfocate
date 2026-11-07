# KOCmax 全產品重製計畫 v2

日期：2026-10-31 HKT。狀態：供使用者審閱，未開始正式實作。

本計畫取代 2026-10-29 計畫中依賴舊分支、只先改創作者首頁、把 brief 通過當作發獎、以及最後才處理公開／營運入口的安排。舊文件保留為歷史。

設計依據：[全產品設計文件](../specs/2026-10-31-kocmax-full-product-design.md)。基準 [main a20b29e](https://github.com/YNWAforever/Remix-Adfocate/commit/a20b29e2691929f47b26ea9505082bb0882fc404)。任何實作開始前，先再查一次 main 是否前進；重新合併差異，不從舊 `81b6104` 分支硬接。

配套：[最新更新與功能保留對照](../specs/2026-10-31-kocmax-function-audit.md) · [63 個手機／桌面畫面清單](../specs/2026-10-31-kocmax-screen-inventory.md)。可互動概念與稽核 CSV 在本次任務的設計資料夾，全部使用示例資料。

## 1. 這次先交甚麼

1. 最新更新稽核：完整提交／檔案清單、53 findings 的修復／部分／未解分類、來源與驗證限制。
2. 功能保留對照表：每個既有路由、可見功能與新導航有對應，保留兩種任務工作流。
3. 四角色的完整資訊架構、手機／桌面畫面設計、權限與共通異常狀態。
4. 63 個可切換概念畫面，10 張創作者範本；全部示例資料，首條跨角色流程可操作。
5. 遊戲化規則、資料模型、來源／分享權限與 MCP 分期。
6. 以下可排程工作與驗收條件。生產程式、schema、部署、真實帳號授權均仍未獲本次批准。

## 2. 為甚麼調整順序

首頁、訪客轉換、創作者交付、營運決定、品牌成果與帳本是同一條產品旅程。新首頁若先承諾不存在的功能，或創作者新 UI 已完成而營運仍不懂新狀態，會把摩擦移往後段。

因此先一次確定四角色的導航與狀態，再交付一條由公開任務到獎勵入帳的完整切片。其餘畫面以同一系統逐步替換。每期使用新開關切換介面，保留原 canonical screen 作回退。

## 3. 階段、交付與出口

下列時間為規劃估算，假設 1 名產品設計／前端、1 名全端、共用 QA 與產品／營運審閱；不是承諾交期。供應商審批、法務、正式環境驗證不包含在開發工時。

| 階段 | 工作與交付 | 依賴／出口 | 粗估 |
|---|---|---|---|
| 0 已做的設計工作 | 最新 source/CI 稽核、公開 IAB 實查、全產品設計／原型／計畫 | 使用者審閱方向與業務預設；不等於批准上線 | 本次 |
| 1 重新建立實作基線與共用體驗 | 最新 main 的獨立分支；設計 tokens、響應式 shell、角色導覽、狀態字典、功能開關；公開首頁／creator/brand landing 與 auth/onboarding 路線一起處理 | 所有舊 routes 有導覽／alias；登入目的不遺失；無假收入與錯誤零值；同意及匯出／刪除不回歸 | 1–2 週 |
| 2 第一條完整任務切片 | 任務卡→對話→證據→private brief→逐項分享→原提交→review→proof→completion→settlement→積分與徽章；同步改 creator/reviewer/operator/admin 畫面 | 同一 submission 與合約；來源權限、預期版本、去重與帳本核對通過；手機桌面可完成 | 2–3 週 |
| 3 全功能畫面遷移 | 任務／活動／商店／錢包／學院／消息／profile/passport／通知；營運 CRM、任務／活動編輯、CMS/Academy；品牌任務與資源 | 保留矩陣逐項驗收；舊頁不先刪；一個功能全角色走通才切流 | 2–3 週，可部分並行 |
| 4 第一批資料技能 | 僅 Instagram＋Google Drive；供應商可行性驗證、只讀最小權限、選檔、同步、撤銷、來源失效處理 | 真實連接須另獲批准；HK/繁中與帳號類型實測；不限制基本任務 | 1–2 週＋外部審批 |
| 5 營運缺口與品牌成果 | 客服個案、品牌現金任務正式交接、品牌成果投影；權限管理 UI、預算／庫存一致性；依優先度解決剩餘 findings | 新資料政策、capability、審批與 audit 定義；沒有把 403 當送審成功 | 2–4 週，可拆 |
| 6 小規模試行與擴大 | staging 角色測試、production read-only acceptance、限定創作者與工作人員試行、觀察後逐批開關 | 來源／權限／帳本／復原／支援達標，才擴大；正式發布獨立批准 | 1–2 週觀察 |

可先以全示例／手動來源完成階段 2；不依賴 OAuth 完成。新公開任務端點需做白名單投影與權限驗收，不能直接放開既有任務 API。

## 4. 可執行的工作包

### W01 — 基準與保護網

負責：全端。從最新 main 建 `codex/kocmax-studio-foundation` 類分支，保留當前未合併工作。重新比對 #70 後更新，釘住設計所用 commit。禁止直接套用舊 #65 的程式碼或 schema。

沿用既有 CI、release manifest、integration target identity 與 migration gate。閱讀 `docs/review` 只作參考；舊報告的 F-005 CI 失敗不得蓋過已成功的新 run。正式環境部署等價、migration ledger、Auth/ACL 需獨立證據。

出口：基準清單、舊新路由對照、業務狀態字典、未解 findings 排序；沒有任務／帳本資料變動。

### W02 — 設計系統、導覽與響應式 shell

負責：設計／前端。共用 card、badge、progress、composer、evidence drawer、artifact editor、decision preview、receipt、loading/empty/error/stale/denied 元件。創作者活潑、營運克制，兩者共享狀態語言。

範圍：`src/routes/_site*`、`_app*`、`admin*`、`operator*`、`brand*` 的外殼，不重寫工作流。手機 320/390/430，平板 768，桌面 1024/1440；44px touch targets、鍵盤、200% 縮放、reduced-motion。

出口：角色導覽正確；每個保留功能可直接開啟；無假「所有 workspace」。reviewer 看不到財務資料，需 server 投影配合，不能僅 CSS 隱藏。

### W03 — 公開網站與訪客轉換

負責：設計／前端／API。重設 `/`、`/creators`、`/brands`、`/earn`、`/packages`、`/stories`、`/playbooks`、`/contact`、法律頁與公共 passport。

新增可公開 mission teaser projection；白名單欄位、草稿不曝光、無 private brief、無 creator PII。CTA 進 signup 模式，保持 next；callback 僅允許安全站內目的地。未開發聯絡表格不顯示送出成功。

出口：logged-out 可理解任務並完成可回復的註冊路線；metadata、canonical、語言、404、表單狀態及公開資料權限檢查通過。發布內容／法務文案另外審閱。

### W04 — 身份、onboarding、隱私與連接入口

負責：全端／前端。保留 password/magic link/reset、受 feature flag 控制的 OAuth/OTP、onboarding guide/profile/logout 例外、bootstrap retry 503、最新 consent gate、optional marketing。

保留 `server/routes/account.ts`、`consents.ts` 的匯出／可恢復匿名化流程；新增資料模型隨後必須納入匯出與刪除。新增 connected accounts UI 可先唯讀／未連接。

出口：未同意當前版本不能繞過必要 gate；重新登入回 deep link；缺餘額行可重試；沒有把登入 session 過期當資料為零。

### W05 — 討論串與上下文

負責：API／前端。沿用現有 assistant 的服務端寫入歷史與 KB workspace 限制。新增 thread topic 與 task/document context、歷史切換、清楚任務範圍。

自然語言只建立受控 action proposal；工具請求解析 actor、workspace、permissions；拒絕網頁／文件內指令擴權。prompt 回覆與真實命令回執分開。

出口：兩串不同主題不混用私人檔；跨 creator/workspace denied；prompt injection 不能直接發佈或寫 ledger；失敗可恢復草稿。

### W06 — 證據與 Brief

負責：前端／API。建立 evidence source/run/claim 與 artifact source lineage。真實來源、推論、例子、未知分開；列出問題、平台、HKT 時間、引用、地區／語言。

任務成果引用既有 draft version，非任務輸出才用新 artifact。儲存檢查本人來源權；共享按版本＋項目＋recipient scope 再檢查。刪來源必須重產生衍生段落，禁止只刪 citation。

出口：未授權文件、過期授權、撤銷後重試、版本變更後確認失效都正確；HK/繁中資料不足不補零、不套別區。

### W07 — 原任務提交與審核整合

負責：全端。使用最新 `src/lib/queries/activeMission.ts`、`src/components/active-mission`、`server/routes/adminActiveMissions.ts` 等現有服務界線；實作前以最新圖譜重新定位符號。

連回 submission/workflow/item/draft version；submit、revision、approve-to-publish、fulfillment、proof review 保留 expected state/revision、reasons、idempotency、audit、通知。legacy 走既有 approve/reject/correction，不能當 active 強行遷移。

出口：兩種流程都有通過、退修、拒絕、重試、逾時、重複點擊、409 的驗收；終局拒絕文案誠實；不足權限的 reviewer 不能決定 application/completion。

### W08 — 結算、徽章與獎賞

負責：全端／前端。沿用 `mission_reward_contracts`、`mission_pending_rewards` 與 `settle_mission_reward_handoff`。只在成功回執後更新錢包；通知失敗不重做交易。

新增 badge award 由合格 active settled event 或 legacy 核實 approval 的成功獎勵交易等價事件驅動，唯一鍵去重。`settled` 屬 handoff 狀態，不新增 workflow enum。現有 XP 門檻與收益不變；active 預設 XP=0 不擅改。商店沿用 redemption intent/request id，明確價格／庫存／期限。

出口：lost response 重試、雙請求、餘額不足、預算不足、缺 balance row、取消後 settle、已結算再次結算無雙重發獎。finance_viewer 無法結算；legacy 不二次結算。新 badge 重播不重複授予。

### W09 — 營運待辦、CRM 與管理

負責：前端／API。按 capability 登入 landing；待辦→個案→證據→決定→回執。保留 applications/submissions/active/proof/reward queues、creator case、radar/engaged、shortlist、任務與活動管理。

大清單繼續分頁／批次查詢；不以一次讀全部取代近期修復。任務／活動編輯保留 loaded version 與 409，避免重新讀新版後錯誤覆蓋。管理員另有權限／邀請與獎賞碼介面。

出口：各 staff role 的可見與不可見矩陣驗證；決定理由、deep links、single workspace、資料範圍正確。新批次操作只在逐項回執與交易風險定義後另上線。

### W10 — 學院、內容、個人頁與活動

負責：前端。保留 Academy track/lesson/progress、news、notifications、profile media、social verification、passport token revocation、campaign detail/leaderboard、match/copilot 功能。

擁有權驗證與資料 OAuth 分開。排行榜改隱私需資料投影與 opt-in，不能只畫開關。每日／每週挑戰不因重複對話刷分。CMS 媒體格式／magic byte／5MB 限制不回歸。

出口：內容作者與 workspace 員工權限分離；發佈、排程、封存與進度保留；中英翻譯完整，手機 proof CTA 不被底欄遮擋。

### W11 — 品牌與服務缺口

負責：產品／全端。先重設已有品牌任務與資源；另增 brand review request 與只讀 results projection。品牌只能讀逐項授權的版本與指標。

客服須保存 case、分派、狀態、回覆與通知；目前 contact 純預覽不能冒充客服。預算充值、禮物庫存原子性、終局拒絕重開、停權／復權分開估算與政策批准。

出口：cash publish guard 保留；明確送審回執才進新佇列；缺 share grant 看不到私人成果；support 不自動帶私人聊天。

### W12 — 第一批 MCP 技能

負責：整合工程。先驗證 IG 帳號類型與 API scopes、HK 可用欄位、rate limit、資料期限；Drive picker 與所選檔案權限。只讀、後端加密 tokens、按 creator/workspace 綁定、撤銷與同步回執。

出口：真實 connection 前另獲使用者批准；revocation、403、token expiry、empty data、unsupported region 都有驗證。沒有資料仍可完成基本任務。第二批 TikTok/YouTube/Search Console 與後續 Calendar/Gmail/Telegram 不混入一期。

## 5. 發布與回退

- 建議開關：`studio_shell`、`studio_threads`、`public_mission_preview`、`artifact_sharing`、`badge_v1`、`brand_results`、`connector_ig_drive`。名稱為提案，初始預設關閉。
- 先 staging 固定角色測試，再限定 workspace／創作者 cohort。UI 回退保留原網址與資料；新成果仍能在原任務看到，不把唯一結果鎖在聊天。
- migration 採擴充式、先讀相容再切寫；不刪舊欄位。關閉功能不逆轉已發生財務交易，問題用補償記錄處理。
- 每次擴大前核對凍結合約、pending/settled 與 ledger source_ref，不允許孤兒成果、重複積分、跨租戶讀取。
- 正式 deployment 的 commit、migration ledger、權限與 provider 授權另查；CI success 不能替代它們。

## 6. 驗收矩陣

| 場景 | 必須看到的結果 |
|---|---|
| 全新訪客 | 任務預覽 → signup → consent → onboarding → 回原任務 |
| 未連接創作者 | 可以提問、讀任務、整理 brief；指標明示未連接 |
| 私人文件 | 本人可存，未同意不可提交到品牌；去除來源同步移除衍生段落 |
| 正常 Active 任務 | draft → publish approval → proof → completion → pending → settled；只入帳一次 |
| Legacy 任務 | approve 原交易發獎，不建立第二次 handoff |
| 終局 rejected | 顯示理由與求助；沒有假「重新提交」按鈕 |
| Reviewer | 作品／證明可審；application/completion/settlement/財務不可存取 |
| Finance viewer | reward 唯讀；沒有 settle 或預算寫入 |
| Operator | completion 可做，settle 不可做 |
| Content editor | 內容可改；不因此取得 workspace 財務權 |
| 品牌 | 只有同 workspace 與已授權成果；現金任務發佈受 staff gate |
| 409／失聯重試 | 草稿保留、重新確認、同 key 不重複命令或積分 |
| 帳號刪除中斷 | 可恢復；私人資料／連接清理；必要審計保留及未結負債誠實說明 |
| 行動裝置 | 320–430px 無橫溢、鍵盤不遮 CTA、底導覽不遮 proof 操作 |
| 無資料／載入／錯誤 | 不顯示假的 0 元、0 觸及或跨市場替代數據 |

正式工程驗證沿用 repo lint/typecheck/unit/build/release checks；以新改動風險補整合與 E2E，不為純色彩／圓角寫鏡像測試。資料、權限、工作流及帳本要有跨邊界測試。

## 7. 成功指標與停線條件

主要看：訪客到第一份有效成果的完成率／時間、初次任務完成率、重複退修率、審核與入帳等待、support 解決率。按裝置／新舊用戶分看，避免只看整體平均。

若出現跨角色資料暴露、私人來源誤分享、雙重入帳、錯把 pending 當可用、取消／刪除造成負債遺失，停止擴大並回退入口。沒有這類事故也仍須驗證體驗是否容易完成；不以增加使用時長、強迫連續登入或不必要通知作成長策略。

## 8. 目前未驗收的事項

本次的概念瀏覽／測試不是 production acceptance。未驗證：正式部署是否等於 a20b29e、9 個新 migrations 是否已在正式 DB 套用、production RLS/ACL、真實創作者／staff sessions、SMTP/redirect allow-list、真實 IG/Drive scopes、HK 指標覆蓋、法務文字與保留期。

這些項目安排在獲准實作與試行階段，不阻礙先審閱完整設計。使用者本次的限制仍然有效：未確認前不修改正式程式或建立真實連接。
