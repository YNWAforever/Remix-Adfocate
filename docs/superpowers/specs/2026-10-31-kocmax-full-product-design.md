# KOCmax 創作者對話工作室：全產品設計 v2

狀態：待審閱的設計提案。2026-10-31（香港）。本次沒有修改正式程式、套用 migration、部署、建立帳號或真實連接。

## 1. 設計基準與重要更正

- 新基準：[main a20b29e](https://github.com/YNWAforever/Remix-Adfocate/commit/a20b29e2691929f47b26ea9505082bb0882fc404)，2026-10-31 02:40 HKT 合併 #70。
- 舊設計所在本機 `81b6104` 屬 #65，該 PR 關閉但未合併。與 main 共同祖先後，main 有 306 個提交，本機有 73 個不同提交。不得從舊分支直接開始產品重製。
- #68 後有 43 個提交、135 個變更檔案；本次保留完整提交、路由與檔案清單，並逐項覆核 53 個既有 findings 的最新狀態。不是聲稱逐行審計所有歷史變更。
- 已盤點 82 個前端路由定義（含 layout、index、alias，不等於 82 個獨立畫面）。新設計以畫面家族涵蓋現有路由與新增能力。
- 最新 pinned-head [CI run](https://github.com/YNWAforever/Remix-Adfocate/actions/runs/41108911098) 的 `build-test`、`integration` 均成功。這是遠端 CI 證據；本次沒有重跑其測試，也未證明正式部署的 commit、migration、ACL、Auth/provider 狀態。
- 內建瀏覽器實查公開首頁、創作者頁、登入入口；「瀏覽任務」目前導向 `/login?next=%2Fmission`。本次未取得登入後的創作者／營運 session；其功能由 pinned source、測試定義與審查記錄交叉核對，正式環境 runtime 仍待驗收。
- Ads Copilot 只借用：提問、範本、明確文件／專案範圍、獨立討論串、證據與成果展開、連接狀態。沿用前次研究，不複製其視覺。

### 會改變舊計畫的更新

| 最新行為 | 新設計必須遵守 |
|---|---|
| Active 任務接單／接受申請時固定獎勵條款 | 每張任務顯示條款版本；任務之後改價不改已接受條款 |
| `pending → settled` 已實作 | 完成審核後先待入帳；workspace_admin 結算才更新帳本與動畫 |
| settled 是帳本入帳 | 不等於轉帳、提現或現金已付款；不顯示不存在的提款功能 |
| Active 接受申請合約 XP 預設為 0 | 原型不能憑空加 100 XP；展示 180 積分、0 XP 的示例合約 |
| Legacy approval 與 active handoff 為兩條不同流程 | 各自走原命令；不能一律多一次結算或雙重發獎 |
| 接受條款／私隱版本、行銷 opt-in、匯出／匿名化刪除已新增 | 納入 onboarding、設定、失敗恢復；不能當成未開發功能重寫 |
| 單 workspace、deny-by-default staff capabilities | 不設「所有 workspace」，不把 reviewer 或 finance_viewer 當管理員 |
| PATCH、409 stale edit、必填退件原因、列表批次讀取已修 | 新介面保存原衝突處理與分頁能力，不能倒退 |
| 品牌現金任務發佈會回 403 staff_approval_required | 目前沒有正式「待審批」狀態；新審批交接明確列新增能力 |

## 2. 產品方向與選擇

目標：創作者打開就能問「我下一步做甚麼？」；每一次有效對話，落在可保存、可核實、可交付的成果上。公開入口幫訪客理解任務與獎勵；營運端幫每位工作人員處理自己有權處理的下一件事。

三種可行做法：

1. 僅加聊天首頁：改動較小，但訪客、品牌、營運與舊任務仍割裂，無法滿足本次全旅程要求。
2. **建議：全面重設體驗，漸進替換介面，沿用並包裝現有工作流與帳本。** 新導航、卡片、對話、證據／成果層共用設計系統；按角色與功能開關逐步上線。
3. 全部重寫前後端：可重構更多底層，但會重做近期修復與資料遷移，增加任務狀態、權限與帳本風險。

本文件採用第 2 項作設計提案，不代表使用者已批准正式實作。建議對外主品牌統一 KOCmax；品牌／營運入口以「KOCmax 品牌合作／營運」呈現，Adfocate 名稱保留於公司資訊及既有網址，最終品牌名稱仍待擁有人確認。

不把新樣式當作新的業務規則；不改既有積分、XP、現金負債與任務資格；不以串接換取基本功能；不以聊天內容作為任務／審批／帳本唯一記錄。

## 3. 四種入口與資訊架構

| 角色 | 預設首頁 | 手機主要導覽 | 桌面主要導覽 |
|---|---|---|---|
| 訪客 | 公開 KOCmax 首頁 | 任務、玩法、加入；次要內容在選單 | Logo、找任務、創作者、品牌合作、資源、登入 |
| 創作者 | 工作室 `/home` | 工作室、任務、獎賞、我的 | 工作室／歷史、任務、活動、成果、獎賞、成長、更多 |
| 營運者 | 按權限的待辦首頁 | 待辦、審核、創作者、更多（按權限） | 固定 workspace、可操作佇列、創作者個案、任務／活動、獎勵、內容、設定 |
| 品牌 | 任務合作首頁 | 概覽、任務、資源、帳戶 | 任務、合作成果（新增）、資源、帳戶 |

現有直接網址保留；改名使用相容 alias，不破壞通知 deep link、登入 next、歷史任務、分享連結。`/operator` 與 `/admin` 統一可見導覽，後端與權限路由仍維持原職責。

### 公開首頁與訪客完整流程

首頁由上而下：

1. 短主張：「把你的點子，變成下一個作品。」主 CTA「先看看任務」，次 CTA「開始創作」。不放虛構收入、未驗證使用人數或融資承諾。
2. 3 張可公開任務卡：題材、平台、報名／截止日期 HKT、預計總投入、難度、條件、積分、現金是否適用。沒有已公開資料就顯示「新任務準備中」。
3. 三步玩法：選任務 → 交作品與證據 → 核實後入帳，再兌換。
4. 可操作的示例對話與成果預覽，清楚標示示例。
5. 精選學習資源、真實且取得同意的案例；沒有核實案例就不顯示數字證言。
6. 品牌合作獨立入口、FAQ、條款／私隱與真實聯絡方式。

旅程：公開首頁 → 公開任務預覽 → 任務條件與獎勵說明 → 建立帳戶（保留原任務）→ email 驗證（依部署設定）→ 同意當前條款與 PICS → 最小個人檔案 → 回到任務 → 申請／接單。

公開任務預覽是新增的白名單資料投影，只包含獲准公開的標題、條件、獎勵、日期、公開品牌素材。不得取消 `/mission` 的既有登入保護，不公開申請者、私人 brief、內部評語或未發佈任務。

公開 `/creators` 說明玩法與作品成長；`/brands` 說明合作流程；`/packages` 僅顯示已確認方案，未知價格為「聯絡團隊」；`/earn` 解釋積分與入帳規則；`/stories`、`/playbooks` 保留內容導航。`/contact` 在服務端未完成前，顯示電郵連結及「表格尚未開通」，不能假裝已送出。

### 創作者首頁與日常旅程

- 新用戶：一句歡迎、立即提問框、3 張新手卡；不強迫先接 IG；已加入任務顯示「繼續你的第一件作品」。
- 回訪用戶：角色等級／XP、可用積分、連續登入天數；下一步任務、上次討論、每日／每週／真實限時任務。
- 對話主題獨立：接任務、內容創作、成效檢討、積分與獎賞。每串有自己的任務、文件、來源與成果，不沿用別串私人上下文。
- 桌面：左側導覽與歷史，中間對話，右側按需開啟證據／brief。手機：對話單欄，證據、brief 進入完整子頁，可返回原訊息。
- 編輯器是獨立成果，不讓長篇 brief 淹沒聊天；有版本、引用、可見範圍、儲存狀態與原任務連結。
- 未有平台數據可以手動輸入來源、上傳自己有權使用的文件，或只使用任務條件；標註未驗證，仍可做基本任務。

### 營運完整旅程

登入 → live capability 決定首頁 → 按截止時間／等待時間排序待辦 → 開個案與證據 → 選動作 → 預覽結果／填理由 → 確認 → 命令回執／通知與下一件。

佇列分開：申請、legacy 成果、active 草稿、發佈證明、完成資格、獎勵入帳。不用含糊「審批通過」代替所有狀態。

桌面使用工作卡清單＋個案細節；手機先列表，打開單一個案，確認面板顯示對象、版本與影響。審核沒有隨機獎勵、排行榜或以處理數量刷分；保留清楚的卡片、狀態及完成回饋。

- reviewer：只處理 submission/proof；不見財務 KPI、申請決定、結算、任務發佈、權限管理。
- operator：可處理申請、creator review、草稿／證明、完成資格；看獎勵，不結算、不改權限、不發佈任務。
- workspace_admin：有結算、任務管理、權限管理；金額動作再次顯示凍結合約、預算、idempotency receipt。
- finance_viewer：唯讀獎勵清單，不顯示結算按鈕。
- content_editor：平台 CMS／Academy；不因內容身份取得 workspace 財務權限。

### 品牌完整旅程

公開品牌頁 → 邀請登入（現有模式）→ 同一 workspace 品牌首頁 → 建立／編輯任務 → 條件檢查 → 積分任務依原規則發佈；現金／CPM 任務需 staff 發佈。

新增的「送交營運」須有正式交接記錄與通知，不能把現有 403 當成已進佇列。品牌成果頁是新增的唯讀投影，只看創作者逐項確認分享的作品／公開發佈證明與授權指標，不看私人聊天、個人 Drive 或未同意的個資。

## 4. 第一條完整流程與狀態

示例創作者「阿晴」，L1，620 XP，420 積分；示例任務「用 30 秒介紹你的日常好物」，合約固定 180 積分、HKD 0、XP 0。以下全部使用虛構資料，不是真實品牌承諾。

1. 選「內容 Brief」任務卡，對話帶入任務要求 E1。
2. 逐項選用私人的拍攝筆記 E2；對話回覆可追溯到 E1/E2，不編造觀眾成效。
3. 展開證據：實際問題、平台、HKT 時間、來源、來源是否可分享、HK/繁中覆蓋狀態。
4. 開啟獨立 brief；檢查私人來源讀取權限後儲存 v1，只對本人可見。
5. 提交前去除 E2 的私人衍生內容，重新產生可分享版本，展示逐項分享預覽；由創作者確認作品及可見對象。
6. 保存至原 mission submission 的 draft version，呼叫既有 submit 命令。回執保留 submission/workflow/revision，跳回原任務。
7. reviewer 檢閱，必要時要求修訂；批准後狀態是 `approved_to_publish`，尚未發獎。
8. 創作者自行發佈並貼上證明；如要由整合代發，必須另有確認，第一期不實作代發。
9. proof reviewer 核實 required items；operator 確認完成資格 → `reward_pending`。
10. workspace_admin 結算 → `settled` → 帳本積分 600；此時才播放一次 +180 動畫。XP 仍為 620。
11. 新的「證據小達人」徽章（提案）由首次合資格的 settled event 唯一授予，不增加額外積分或 XP。動畫可關、可略過。

Active：`draft → submitted → in_review → revision_requested → resubmitted → approved_to_publish → publication proof → proof_verified → reward_pending → settled`。這是跨物件的使用者進度，不是一套新 workflow enum：`settled` 是 `mission_pending_rewards.status`，不擅自新增 `mission_workflows` 狀態；`resubmitted` 是事件描述。實作保留原 item/workflow/handoff 的各自狀態。

Legacy：依現有 join/apply → submit → request-correction／approve／reject；approve 原交易已發獎，不再走 active settlement。終局 rejected 目前不能重交；新版顯示理由及求助，新增申訴／重開政策須另設決定紀錄，不能把 rejected 偷換 revision_requested。

## 5. 手機與桌面設計規格

### 視覺與互動

- 明亮奶油底、深紫文字、淡紫主場景、青檸獎勵點綴、珊瑚提醒；圓角卡片與小芽吉祥物。紅色只表示錯誤／需注意。
- 創作者像輕量遊戲工作室；營運採同一語言但降低裝飾、加強證據與狀態。沒有大面積 KPI 報表牆。
- 基本文字 16px，補充 13–14px；主文字對比至少 4.5:1。按鈕最小 44px，表單有 label，狀態不靠顏色。
- 手機 320/390/430px：單欄、內容全寬、底部導覽；證據／成果為子頁；確認面板不遮鍵盤與主 CTA。
- 平板 768px：可折導覽，兩欄卡片。桌面 1024/1440px：導航 208–240px，中間自適應；證據可折疊，不永久擠窄聊天。
- 轉場 160–220ms；獎勵慶祝一次 500ms 以內；遵循 reduced-motion，不自動循環、不自動捲回頂。
- 鍵盤順序自然；彈層開啟移焦、Tab trap、Esc 取消、返回觸發點；線上版本需補完整 screen-reader／實機測試。

### 所有資料頁共同狀態

| 狀態 | 呈現與下一步 |
|---|---|
| 載入 | 骨架與「讀取中」；餘額不先填 0 |
| 空白 | 說明尚無記錄並提供下一步；未知與真實 0 分開 |
| 錯誤 | 保留已輸入草稿，重試；不透露原始 DB 錯誤 |
| 未登入／session 過期 | 保存本機非敏感草稿，重新登入回原 deep link |
| 無權限 | 清楚說明該角色不能做甚麼；不要隱藏錯誤成空清單 |
| 資料已更新 409 | 顯示最新版本與本次草稿，重新檢閱，不自動覆蓋 |
| 未連接／撤銷 | 指標顯示未連接；禁止刷新與新寫入；不影響基本任務 |
| 未驗證／HK 覆蓋不足 | 顯示未知與限制，不補零、不借用其他市場 |
| 已完成／已決定 | 顯示回執；原動作不可再按造成重複獎勵 |
| 逾期／未開放／名額滿 | 依服務端回傳狀態，顯示下個可行動作，不自行創建 expiry 邏輯 |

原型有完整畫面選擇器、手機／桌面切換與共通狀態示範。它驗證資訊架構與互動敘事，不驗證真實後端或串接。

## 6. 遊戲化與 10 張範本

保留原 L0–L6 累計 XP 門檻：0、500、2,000、6,000、15,000、40,000、100,000。等級從現有 creators.xp 推導；登入天數只提供鼓勵，斷線不扣分、不降級。

| 任務卡 | 難度／預計工具使用時間 | 積分顯示 | 成果 |
|---|---|---|---|
| 這週先做哪個任務 | 入門／3 分鐘 | 提問 0；各任務獎勵另列 | 具條件及期限的 shortlist |
| 30 秒內容 Brief | 入門／10 分鐘 | 示例任務 180，完成核實後入帳；整理本身 0 | 腳本、鏡頭、交付清單 |
| 找受眾的未解問題 | 進階／12 分鐘 | 0；有正式機會研究任務才另列 | 問題與來源，不捏造 HK 搜尋量 |
| 我的貼文表現如何 | 進階／8 分鐘 | 0 | 來源、樣本與限制報告 |
| 最快兌換路線 | 入門／3 分鐘 | 0；估算不是保證 | 可行任務組合、餘額、庫存條件 |
| 找適合的品牌 | 入門／5 分鐘 | 0 | 有理由的品牌配對 |
| 拍攝前檢查 | 入門／5 分鐘 | 原任務獎勵，不另計 | Shot list、產品說法與必要披露 |
| 幫我理解退修 | 入門／5 分鐘 | 原任務獎勵，不另計 | 對應退修原因的修改清單 |
| 整理發佈證明 | 入門／4 分鐘 | 原任務獎勵，不另計 | 連結、時間、所需截圖 |
| 一週作品回顧 | 入門／8 分鐘 | 0 | 可保存週報與下一步 |

卡片時間是工具整理時間，不冒充整個拍攝任務投入。任務卡另列拍攝／發佈估時。

- 每日：一個可完成的小步驟；每週：有實際成果的挑戰；限時：只用真實截止時間，不創造倒數壓力。
- 同一任務的卡片、對話、brief、提交與結算引用同一獎勵，不多次計分。學習／整理可有進度回饋，不能兌換真實獎勵，除非另有正式可核實任務。
- 徽章提案：首次核實成果、首次完成退修、首次完成學習軌；資格事件、版本、撤回理由公開。首期示例以 active settled 觸發；完整實作為 legacy 核實 approval 的成功獎勵交易定義等價事件，避免遷移介面造成不公平。徽章不另發積分／XP。
- 獎賞商店採可收藏卡片；寶箱僅是確定內容的視覺容器，不抽獎、不付費開箱。顯示所需積分、庫存、有效期、兌換限制與確認扣分。
- 兌換沿用 request-id／intent 與原 ledger；重送同一請求回同一結果。實體配送、退款、取消沒有完整能力，先不包裝成已可用。
- 排行榜／好友挑戰預設私人、逐活動 opt-in，使用化名，可退出；不公開收益、私人來源與聯絡資料。現有 campaign 榜單隱私投影需改造，不能直接宣稱已支援 opt-in。
- 不獎勵聊天次數、上線時間、連續登入或大量低品質上傳；風控提供明確原因、人工復核，不採黑箱降權。

## 7. MCP 連接與來源規則

「解鎖技能」是產品包裝，不向一般用戶要求理解 MCP。每張技能卡有用途、最小資料範圍、最近同步與撤銷。

| 平台 | 技能 | 分期 |
|---|---|---|
| Instagram | 成效雷達 | 第一批；實際帳號類型、API 權限、審查、HK 可用欄位在供應商驗證後定案 |
| Google Drive | 素材背包 | 第一批；優先 picker 選定檔案，是否能用最小 scope 以實測為準 |
| TikTok／YouTube | 影片回顧 | 第二批 |
| Search Console | 搜尋問題雷達 | 第二批；只對有權管理的網站 |
| Calendar | 拍攝行程 | 後續，寫入必須預覽及確認 |
| Gmail | 合作信件整理 | 後續，只讀，不提供寄信動作 |
| Telegram | 創作提醒 | 後續，訊息發送／頻率另行 opt-in 與確認 |

現有 Instagram／Threads BioCode／RapidAPI 擁有權驗證保留，與 MCP OAuth 授權分開。連接成功不代表帳號擁有權已核實，不代表所有歷史指標可用。

已連接帳號：帳號名稱、授權範圍、人類可讀用途、最近成功同步（HKT）、失敗原因、重新授權、一鍵撤銷。撤銷即阻止新讀取／寫入；來源派生的既存成果按快照與授權政策標示失效／需重驗，不默默繼續更新。

證據資料須保留：實際 question、platform、query/run time、source URL 或內部 file id/version、retrieved_at、region、language、coverage、verification_status、permission_scope、access_valid_until、來源到段落的引用映射。例子與真實觀測不同標籤。

保存與分享兩次檢查：保存檢查本人對原檔的讀取及衍生使用權；分享逐項檢查可見對象與來源可分享權。不能只刪引用但留下私人內容；取消來源後重新產生相應段落。原文限制不得被摘要繞過。

日後對外發佈、寄信（如 Gmail 只讀政策改變）、改行事曆：在最終動作前顯示確切帳號、內容、收件人／受眾、時間及需要的權限，待使用者確認；確認後資料變動就需重新確認。

## 8. 資料模型與權限邊界

### 沿用的權威資料

`missions / mission_submissions`；active workflows/items/draft versions/assets/reviews/events；publication proof attempts/reviews；`mission_reward_contracts / mission_pending_rewards`；points/earnings ledgers、XP；campaigns／leaderboards；redemption intents／codes；creator profiles/social/passports；consents、staff capabilities/audit、CMS/Academy。

新成果優先引用現有 draft version，不複製另一份「最終 brief」。只在非任務成果需要時新增通用 artifact。

### 建議新增（schema 需另審，尚未執行）

| 實體 | 必要欄位／關聯 | 目的 |
|---|---|---|
| studio_threads | id, workspace_id, creator_id, topic, mission_submission_id?, title, status | 四種主題獨立、深連結 |
| thread_context_items | thread_id, source_id, selected_at, scope | 明確選取的文件／任務上下文 |
| evidence_sources | owner, workspace, provider, external_id, source_version, permissions, validity | 來源權限與時效 |
| evidence_runs | thread_id, exact_question, platform, run_at, region, language, coverage | 可重現的問題與時間 |
| evidence_claims | run_id, claim, status, citation anchors | 來源、推論、未驗證分開 |
| artifacts / artifact_versions | owner, thread_id, type, canonical_ref?, version, content_hash, status | 非任務成果與版本；任務版本引用原物件 |
| artifact_sources | version_id, source_id, passage_map, derivation | 追蹤私人資料如何產生內容 |
| share_grants / approvals | artifact_version, recipient_scope, approved_items, source_check_snapshot, approved_at | 精確版本／項目的共享與確認 |
| connector_accounts | owner, provider, external_account_ref, scope_set, status, last_sync_at, revoked_at | 授權狀態；token 僅加密保管於後端，不能寫入聊天 |
| command_receipts | actor, command, target, version, idempotency_key, result_ref | 對話動作到原工作流的去重回執 |
| badge_definitions / awards | rule_version, qualifying_event_id, creator_id, awarded/revoked_at | unique(creator, badge, rule version)＋事件去重 |
| leaderboard_opt_ins | creator_id, campaign_id, display_alias, consent_version | 預設私人、明確加入 |
| support_cases / brand_review_requests | requester, workspace, target, state, assignee, audit | 尚不存在的客服／品牌交接，分期新增 |

assistant 原歷史已改成 server-written；新討論串須重用／遷移原記錄，不重新開 client 任意寫 assistant role 的漏洞。

RLS／service 層：由 session 解析 creator/workspace，不能信任請求提供的 owner；每次工具讀取和 final command 重新查權限；staff capability 與單 workspace 規則維持。品牌僅讀經確認分享的成果投影；reviewer 不讀現金餘額與私人 context。服務帳號不可成為跨 workspace bypass。

一致性：同一 idempotency key 在逾時後重試回同一命令結果；expected revision/version 防覆寫；成功依原資料庫交易為準，動畫不改餘額。帳本與 badge 事件去重；失敗保留草稿，提供原任務連結。

帳號刪除沿用匿名化並保留必要財務／審核痕跡；新增 thread/evidence/connector/share 資料必須加入匯出與刪除範圍，撤銷授權、處理衍生內容及重試。保留期與法律文字由業務／合規擁有人定案，不能自行假設「全部永久刪除」。

## 9. 分期與依賴

見配套 `2026-10-31-kocmax-full-product-plan.md`。本次只交設計、原型、盤點與未來實作順序；不得把方案審閱當成上線／migration／OAuth 同意。

## 10. 驗收要點

- 訪客可以理解任務獎勵與條件；註冊後回原目的，不遺失上下文。
- 每個舊功能可從導覽直接到達；路由清單逐項有去向，不以「更多」掩蓋消失功能。
- 第一條流程在 creator、reviewer、operator、admin 間使用同一 mission submission 與回執；無雙重發獎。
- 未連接、未驗證、真實零值、載入、錯誤有不同狀態；HK/繁中沒有替代數據。
- 私人來源與其衍生段落不能在未確認情況下到品牌／公開頁。
- 未授權角色無操作權且無財務資料洩漏；不只是藏按鈕。
- 320px 無橫向溢出；鍵盤／讀屏／reduced-motion、表單錯誤與回復路徑可用。
- 成功指標：首次有效成果時間、首次任務完成率、退修率、審核等待、結算延誤、分享誤操作及權限事故；不以使用時長或登入連續天數作主要成功指標。

## 11. 待擁有人決定的業務政策（有建議預設）

1. 品牌命名：建議 KOCmax 為創作者及產品入口，Adfocate 留公司背景。
2. 終局退件後重開／申訴：建議保留現狀，先以人工 support case 處理；正式規則定案再開按鈕。
3. 現金付款：保留既有 ledger 與負債；新首頁主要介紹積分任務，提款／自動付款另立項目，不用新 UI 宣稱已提供。
4. 停權／復權：不是本次已有能力；需定義原因、權限、未結算負債與通知後才實作。
5. 新 XP 獎勵：本版不改經濟規則。若要讓 active 任務普遍賺 XP，必須新合約規則版本、不可追溯改舊約。
6. 正式法務文字與保留期、公開任務可披露欄位、品牌成果可見範圍，需相應擁有人簽核。設計先採最小可見範圍。

## 12. 設計檢查記錄

2026-10-31 已由獨立工程審閱者閱讀本設計，結論是沒有阻礙制定實作計畫的重大待答問題；餘下為可由工程處理的選擇或已明確延後的業務政策。這是設計可規劃性檢查，不是 production code review。

原型已在內建瀏覽器檢查所有 63 個畫面的桌面／窄版布局，另做真實 320px viewport 與 390px 交互測試。320px 首頁插畫區曾出現內容擠壓，修正後覆測通過。跨角色任務、私人來源阻擋、分享、入帳、徽章及兌換示例完成；正式 Auth/RLS／交易與 provider 仍未驗收。
