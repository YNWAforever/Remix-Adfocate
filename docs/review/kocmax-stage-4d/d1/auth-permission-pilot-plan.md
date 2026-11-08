# 真實登入與跨帳號權限驗證方案

日期：2026-11-01（香港時間）  
狀態：**PLAN_READY / 尚未執行真實登入、建立帳號或寫入測試資料**  
分支：`codex/kocmax-studio-stages-1-2`  
檢視時 HEAD：`5c60020091e8e6fee934b61c498bf7518944c433`  
指定共用專案：Remix-Adfocate / `mhkoayftiuojxlrkollf`

執行續記：使用者 continue 後已推進 P0，新增本機修正、精確待審 SQL 與離線驗證。[目前結果與批准範圍](auth-permission-execution/README.md) 是執行狀態依據；本文件保留原計劃。真實登入尚未開始。P0 另確認接任務會加 10 XP，所以原計劃的共用 DB 正向 join 在零 XP 範圍內不執行。

本輪只新增方案與唯讀結構檢視紀錄。下一輪執行以本方案的帳號、資料、期限與清理範圍為批准單位；重複索引的 DDL 另行審閱。維持不部署、不接 Instagram／Google Drive、不啟用外部 AI、郵件、付款、兌換或生產試點。

## 1. 要驗證甚麼，以及目前已知的限制

目標是讓真實 Supabase Auth 簽發的使用者憑證，通過同一分支的本機介面、Hono API、Data API／RPC 與檔案權限，證明「本人可以、其他帳號不能」，並證明儲存後重載仍一致。

已有 SQL 套用及本機示例驗證不取代這一層。已套用的 migration `20261031201901 / kocmax_studio_shared_review_c879b204` 本次唯讀查詢仍存在；其已批准 SQL 的 SHA-256 仍為 `9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5`。原有 39 表／400 欄位未變的結論屬上次套用時的證據，執行新測試前另立基線。

本次確認的實作要點：

- 登入後 `finishAuth` 會呼叫 `/api/me/bootstrap`，建立創作者及零積分／零現金餘額，再刷新 session。登入不是無副作用的操作。
- workspace 預設來自 `VITE_DEFAULT_WORKSPACE`；前端沒有可直接切換任意 workspace 的選單。未設定會落到 `demo`，本測試必須拒絕這個預設。
- 員工身份、品牌成員、workspace 角色是三層不同的資料。workspace 角色包括 `workspace_admin`、`operator`、`reviewer`、`finance_viewer`。
- 員工登入有網域自動加入規則；使用非員工網域的合成身份，明確配置四名測試員工，不以公司電郵觸發自動升權。
- `StaffAuthGate` 的未登入按鈕使用 Google OAuth，但也接受已有的正常 Auth session。本輪先用現有 `/login` 電郵密碼，再導航到 `/admin` 或 `/brand`；Google OAuth 登入按鈕的往返流程不算通過。
- `workspaceAuth`、員工及品牌 API 各有身份檢查；必須連同直接 Data API／RPC 測試，不能只看頁面按鈕。
- 現有 staff workspace gate 依賴 `brand_users`。品牌表的任務讀寫政策可能使角色具有另一組權限；財務／審稿帳號繞到品牌 API 或直接 Data API 是必測項。這是靜態風險，尚非已重現漏洞。
- 任務版本與 workflow events 有禁止修改／刪除的觸發器；角色審計有 Auth／workspace 外鍵。完整測試將留下受保護的合成審計資料，不能承諾「所有列都刪光」。

對照：[資料庫完成紀錄](shared-database/execution/completion-report.md)、[九個 RPC 靜態檢視](shared-database/execution/rpc-advisory-review.md)、[先前 UI 證據及限制](shared-database/execution/ui-verification.md)、[本次唯讀 metadata](auth-permission-review-20261101.json)。

## 2. 執行環境：本機程式、共用資料庫、明確限制

這是**同一共用專案中的受控測試資料**，不是另一個隔離資料庫。新 workspace、特殊名稱及 localhost 都不能單獨證明隔離。

1. 保留現有 mock 預覽。另起兩個只綁定 `127.0.0.1` 的本機非 fixture 程序：建議 A 使用 8784、B 使用 8785；如埠被佔用，選空埠並把實際 origin 記入清單，不停止其他人的程序。
2. 兩程序使用同一分支／同一實際程式內容；A、B 各自固定一個測試 workspace。每一程序的 `BOOTSTRAP_WORKSPACE_SLUGS` 只包含自己的測試 slug，不含 `demo`、現有品牌或萬用字元。
3. `VITE_STUDIO_FIXTURE=false`，移除 `integrationPreview` 模擬角色。沿用正常 `src/main.tsx`、API 與身份驗證。工作室前後端開關只在這兩個本機程序啟用，不能改 hosting 或專案環境設定。
4. 在匯入會建立 client 的模組前，交叉核對 connector 專案 metadata、實際 Supabase host、前後端設定及 Auth issuer；均須指向 `mhkoayftiuojxlrkollf`。不用環境名稱自證身分。
5. 前端只使用該專案的公開 key；server key 只在本機伺服器／受控執行器記憶體使用。不存在安全可用的憑證時才請使用者在本機輸入，不能貼入對話、Git、截圖或測試輸出。
6. 保留 `INTEGRATIONS_ENABLED=false`、`INSTAGRAM_CONNECTIONS_ENABLED=false`、`DRIVE_CONNECTIONS_ENABLED=false`。D1 的產品專案拒絕規則不改；不透過 pilot entry 啟動真實 provider。
7. AI、搜尋／社交掃描、分析追蹤及 cron 主動呼叫停用；不裝載 provider／AI／SMTP／共享管理員密鑰。測試執行器只允許本機與該 Supabase 專案需要的 Auth、REST、Storage 網路請求。是否真的沒有外送須有觀測紀錄，不能僅由未設定 key 推論。
8. 開始前檢查資料庫觸發器、排程、通知與現有部署讀取測試資料的可能性。只有在新 workspace 的任務確定不會公開或被既有 worker 執行時，才進入任務 workflow 段；無法確認便保留該段未測，不關閉共用排程。
9. 不改 Auth 的全域密碼政策、JWT 有效期、SMTP、站台 URL、redirect allowlist 或 RLS。本輪密碼登入不需要新增 OAuth callback；如現有政策阻擋，列出缺口再處理，不能降級驗證。
10. 每輪最長 24 小時；完成即清理。預設序列執行，只在重複提交案例使用兩個並行請求，不做壓力／暴力登入測試。發現越權、非清單寫入、外部請求或超時，停止新增寫入並保留證據。

執行前記錄 HEAD、dirty diff、實際測試檔案 hash。不能單憑 HEAD 相同宣稱未提交內容都已驗證，也不覆蓋目前分支上的 D1 改動和近期修正。

## 3. 測試身份：9 個專用帳號，2 個 workspace

代號只代表尚未建立的身份。執行器產生唯一 run UUID，再用保留的非投遞測試電郵，例如 `kocmax-<run>-ca@example.invalid`，逐一建立與綁定回傳的 Auth UUID。若 Auth 不接受該網域，停止並選擇使用者控制的專用測試網域，不自行換成真實同事信箱。

使用 Auth Admin 建立已確認的密碼帳號，不發邀請、確認信或重設密碼信。各帳號有不同隨機密碼，不寫入報告。這是正常 password sign-in／正常簽發 JWT，不是自製 JWT 或 SQL claim 替身。Admin 建帳 API 僅供伺服器使用。[Supabase createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)

| 代號 | Workspace | 權限配置 | 核心用途 |
|---|---|---|---|
| C-A | A | 創作者本人 | 私人來源、Brief、儲存、原任務草稿、匯出 |
| C-P | A | 另一位創作者 | 同 workspace 不代表能讀 C-A 私人內容 |
| C-B | B | 創作者 | 跨 workspace ID／標頭／檔案路徑反例 |
| S-A | A | staff + brand member + workspace_admin | 測試 workspace 管理與角色操作；無 platform role |
| S-O | A | staff + brand member + operator | 原有審批入口；不能管理角色或獎賞設定 |
| S-R | A | staff + brand member + reviewer | 審稿／證明；不能完成結算或讀取不允許的財務資料 |
| S-F | A | staff + brand member + finance_viewer | 獎賞資料只讀；不能審稿、改任務、改角色或結算 |
| B-A | A | brand member，沒有 staff／workspace role | 品牌草稿與明確交付的內容；不能讀私人來源或營運內部註記 |
| U-X | 起初無；最後只可建立 A 的普通 creator | 沒有 staff／brand／workspace role | 有效登入但未加入產品、升權反例、首次 bootstrap |

匿名訪客另用沒有 session 的瀏覽器狀態，不建立第十個帳號。S-R 用作降權／撤銷再登入案例，不另增身份。

由於沿用現有密碼登入頁，員工／品牌身份也會產生自己的 creator 與零餘額列：**總量上限是 9 個 creator、9 個 point balance、9 個 earnings balance，不能只預算前三名創作者。** U-X 在未建立 creator 前先完成「有 Auth、無產品資格」測試。首次登入、零餘額與反覆登入的副作用都列入資料清單。

使用分離的瀏覽器 session／origin 執行不同帳號；同 origin 的兩個 tab 不當成獨立登入，因為登入狀態會共用。另以同一 tab 的 A→登出→P 測試快取清除。手機／桌面先在內建瀏覽器驗證；可用的隔離 session 不足時，循序登入登出，並由獨立 Auth clients 執行雙帳號 API 測試。

## 4. 測試資料與預計寫入

先製作獨立的 `fixture-manifest.json` 與預覽清單，再建立任何帳號。清單包含：run ID、批准版本、專案、身份代號、UUID、父子關係、資料表、允許操作、預計數量、實際回傳 ID、保留類別、清理步驟及期限。

根 ID 採本輪 UUID 衍生；API 產生的 ID 即時登記。每個寫入前確認目標和父子關係；碰撞即停止，不能覆寫或沿用現有客戶的列。重試只能用既有 idempotency key 查結果；不能另造 request ID 掩蓋失敗。

| 資料 | 上限／設計 | 清理與限制 |
|---|---|---|
| Auth identities | 9 | 新建且專用；後續刪除或禁止登入依外鍵／審計決定 |
| Workspaces | 2，A／B | 設定加合成 run 標記；標記不是安全機制，也不宣稱有 workspace disable 欄位 |
| Creator／零餘額 | 各最多 9 | XP=0、無 spendable points、無現金；不得替既有用戶補資料 |
| Staff／brand／workspace roles | 4／5／4 | 四名 staff 均需 brand membership；不建立 content_editor 或其他全域角色 |
| Role audit／command receipts | 每次批准的 grant/revoke 一組 | 四個初始化角色、撤銷／重設／清理均逐項登記；exact replay 不增加審計 |
| 任務與交付規格 | A／B 各 1 任務、各 1 規格及必要要求 | 初始 draft、`public_preview_enabled=false`；獎賞與現金設為 0，不啟用實物配送 |
| 私人工作室 | 3 個討論串、最多 4 個手動來源、3 份 Brief／最多 4 版本 | A、P、B 各有不同識別字；A 一段可分享、一段明確不可分享 |
| 原任務 workflow | 最多 2 submission／workflow、4 個草稿版本、2 輪審稿 | 必須通過第 2 節公開性／worker 檢查後才建立；停在草稿或修改要求，不完成獎賞核准 |
| Assistant request | 最多 2 個明確合成結果 | 只用已批准且可重演的 fixture 契約供讀取權限測試；沒有 model 執行或 token 計費 |
| Academy progress | 每創作者最多 1 筆 | 可讀既有已發佈的公開課程；不新發佈全站測試課程，不把自述完成當作核實成果 |
| 私人 Storage | 最多 4 張合成 PNG，各不超過 64 KiB | 只用兩個現有私有 bucket、實際生成的合法 asset 路徑；不使用客戶相片／公開頭像 bucket |
| In-app 通知與操作紀錄 | 僅上述動作產生、接收者全部為本輪帳號 | 實際 ID 登記，不能生成寄信或推送工作 |
| Provider／金流 | **0** | 無 integration connection、OAuth state、provider credential、實際 Gift 兌換、積分／現金交易或徽章發放 |

實際測試內容使用繁中合成茶飲任務。來源顯示問題、平台 `manual`、實際輸入時間、`HK / zh-Hant`、**未驗證**。A 的兩段使用不同來源識別字，方便辨認分享是否只含勾選內容。私人來源絕不偽裝成 Google Drive／Instagram 同步內容。

現有 `shared-database/30-fixture-transaction.sql` 仍以 ROLLBACK 結束，只做單連線政策演練；**不把結尾改為 COMMIT**。瀏覽器需要另一份批准的持久化資料包。命令回執、通知和版本等衍生列必須在本機演練後具體列出，資料量超過清單就停止。

## 5. 測試次序與預期結果

### A. 前置準備與登入

- 重新核對專案、版本、schema、RLS、grants、觸發器、兩個 bucket 及來源 hash；保存新的非測試資料基線。上次備份是套用前快照，不能當作現在狀態的完整復原點。新寫入前建立當前可用 checkpoint；還原演練只在可丟棄本機環境，絕不以共用資料庫整庫還原作清理。
- 在本機可丟棄資料庫演練 seed、各種失敗及 cleanup，包括審計外鍵／不可變版本。既有通用 integration／seed 指令不可直接指向共用 DB。
- 先建立 A、B 測試 workspace，再逐一建立已批准 Auth 帳號；身份回傳 UUID 和清單匹配後才允許正常 bootstrap。
- 測正確密碼、一次錯誤密碼、登出、重載、session refresh、深連結返回及未登入直入私人頁面。不得為測錯誤密碼大量重試。
- 測 U-X 的有效 JWT 但無 creator／無 membership；確認 API 拒絕，沒有偷偷升權。
- C-A 在 A 重複 bootstrap 不增列；C-A 帶 B slug／B origin 的請求不可搬移身份，**也不可新增 B 的零餘額列**。現有 bootstrap 對既有 creator 採 ignoreDuplicates，但餘額按請求 workspace 寫入，這是需先用本機重演確認的風險；本機發現會誤寫就先修分支／補測，不能把已知誤寫再到共用 DB 示範。
- 不帶 ref、不用現有推薦碼；不觸發 referral、生日、完成任務或登入獎勵。

### B. 真實 JWT 的權限矩陣

每一個案例先用 C-A 建立／讀取成功的對照，再用 C-P、C-B、U-X、匿名重播同一物件 ID。分別記錄 UI、Hono API、直接 Data API／RPC 結果。

| 邊界 | 必須成功 | 必須拒絕／不洩漏 |
|---|---|---|
| 私人 thread／source／Brief | 本人保存、讀回、重載 | 同 workspace 創作者、其他 workspace、品牌、staff 未經分享不能看到私人內容 |
| 逐項分享 | A 明確勾選有分享權限的一段，提交後原任務只見該段 | 私人來源段落、未確認內容、改字後的舊確認、其他 creator／mission ID、重複分享衝突 |
| 原任務 | 本人草稿與允許的 reviewer；品牌只見契約允許的已交付投影 | 其他人的 submission、version、proof、review、reward ID |
| 角色 | 四個 workspace 角色只取得明確能力；品牌按既有品牌契約 | creator 或 brand 自升 staff、修改角色／workspace／XP／balance；越 workspace 管理 |
| 跨入口 | 財務與審稿的限制涵蓋 admin、brand、REST 和 RPC | 只把 admin 按鈕藏起來、卻讓另一入口提供未批准寫權限，不算通過 |
| 角色撤銷 | 撤銷後用原 JWT 再請求，立即失去受該角色保護的 API 能力 | 舊前端快取、舊 role revision 或 user_metadata 不能恢復權限 |
| 匯出／通知／錢包 | 只包含本輪本人允許資料 | 匯出他人內容、通知識別字或錢包；讀取失敗不能呈現假 0 |
| 檔案 | 本人使用允許的草稿／證明 asset 操作 | 他人路徑、直接 object URL、listing、覆寫／copy／move／刪除、錯 workspace；副檔名不能替代 MIME 驗證 |
| Session／快取 | A 登出再以 P 登入，私人草稿和查詢結果消失 | browser Back、慢回應、tab focus、重新整理不得讓 A 的內容重現 |
| Provider | 未連接／未驗證顯示、手動工作照常 | OAuth start／callback／同步直接呼叫不應產生 provider client、token、connection 或網路請求 |

API 可以用設計規定的 401／403／404，RLS 查詢也可能返回空集合；**必須檢查實際 body、受影響列與副作用**，不能把任意 4xx、200 空結果或頁面空白一概當通過。測試只猜測本輪已知 ID，不枚舉真實客戶物件。

`user_metadata` 可由用戶修改，不能用來授權；`app_metadata` 的變化也可能要刷新 JWT 才出現。權限撤銷要以現有即時角色 gate 的實際結果判斷。[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

登出／ban 並不等於所有已簽發 access JWT 立即失效。分別測 refresh token 撤銷、敏感 API 即時拒絕、直接 RLS 舊 token 行為與 JWT 到期後的結果；把到期時間記在清理報告，不改全專案 JWT 設定。不接受以「已按登出」替代實際拒絕證據。[Supabase sessions](https://supabase.com/docs/guides/auth/sessions)

Storage signed URL 是持有者可用的短期權能，不能期望同一有效 URL 因換帳號便自動失效。驗收重點是無權者不能生成／取得 URL，URL 不被寫入公開內容；確認實際 TTL、期滿與檔案移除後行為。角色撤銷後已有 URL 的剩餘效期另列限制。上傳、覆寫所需的 INSERT／SELECT／UPDATE 權限分別測試。[Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

### C. 九個新增 authenticated RPC

| RPC | 本輪真實身份覆蓋 | 正向測試限制 |
|---|---|---|
| can_read_academy_track | 合資格本人、無 creator、匿名、等級限制 | Academy 已發佈內容是全域，不錯當跨 workspace 洩漏 |
| get_academy_learning | 本人歷史、無他人 progress | 沒有可用公開課程時如實列未測，不新發佈測試課程 |
| complete_academy_lesson | 本人、版本衝突、重複請求、不能代他人完成 | 專用帳號進度，不派分；完成僅屬自述 |
| create_mission_workflow | 本人 submission、peer／outsider、重播 | 只有批准且有效的合成 submission；不靠 service_role 代替 owner 測試 |
| refresh_mission_workflow_state | 本人／他人 workflow、錯 workspace | 不結算、不任意改既有狀態 |
| join_active_mission | workspace、quota、重複 join、非 active | 正向 join 只在新 workspace 的非公開合成任務；通過 worker／公開性前置條件才做 |
| get_assistant_request | 本人、peer／outsider、錯 request／workspace | 使用合成既存結果；不啟動外部 AI／未授權來源 |
| get_my_mission_reward_handoff | 本人 projection、他人 submission、狀態一致性 | 真實付款／獎賞正向結算不在本輪 |
| redeem_gift_with_request | 匿名／錯 workspace／無效目標拒絕，且無交易列 | 成功扣分與兌換只在可丟棄本機演練；共用 DB 的成功兌換明確為 NOT_RUN |

每項保留 raw status 的去敏摘要、expected／actual、時間、case ID、actor alias、物件 ID 及前後計數。禁止保存 token、密碼或含 signed URL 的原始 request／HAR。若某一正向情境未執行，不把整個 RPC 宣稱完整通過。

### D. 手機與桌面旅程

在內建瀏覽器以 390×844、1440×1000 執行完整核心旅程；320px 窄版、短視窗、200% zoom／鍵盤焦點另做重點檢查。模擬 viewport 不宣稱實體 iOS／Android 已驗收。

1. 訪客：公開首頁 → 任務預覽 → 私人深連結 → 密碼登入；返回位置正確，沒有開啟真實社交登入。
2. 創作者 A：任務卡 → 手動討論／來源 → 私人 Brief → 重載 → 逐項確認 → 原任務草稿 → 重載。未驗證來源及私人段落標示一致；積分、XP、徽章不因儲存或連接而增加。
3. C-P／C-B：從自己的首頁和直接深連結進入 A 的識別字／物件；拒絕後不殘留 A 的內容。
4. 品牌 B-A：自己的草稿編輯、保存衝突、權限撤銷；看不到創作者未交付的私人材料或營運內部註記。
5. 營運／審稿／財務：實際登入後各自查看允許入口，重載仍一致；檢查跨入口及 API 拒絕，不執行獎賞核准／結算。
6. 設定／已連接帳號：未連接、基本任務可用、連接按鈕及 API 禁用；匯出只含本人合成資料。
7. 同 tab 切帳號、未儲存內容、慢回應、登出後 Back、token refresh、被撤權時表單消失且不被後續錯誤恢復。

回傳每個角色、裝置尺寸、journey 的 PASS／FAIL／NOT_RUN 與截圖。錢包錯誤、過期 session、網路失敗、撤權及 optimistic conflict 均須有可見回饋。手機鍵盤與實體瀏覽器差異如未實測，保留限制。

## 6. 清理：刪除內容、撤權，以及必要的審計保留

**採「精確清理 + 最小保留」；不做整個 workspace cascade、不停觸發器、不刪帳本／審計、不清空共用 bucket。** 先在本機演練以下順序，再把每一類精確 ID 與預計刪除／保留數交付檢視。

1. 停止測試寫入、排定請求及 session 自動刷新；保存失敗和已建立 ID。若 seed 部分完成，只處理回執證明本輪已建立的 ID，不按名稱掃描刪除。
2. 先撤銷測試角色／品牌 membership，保留最後能執行受控清理的 S-A 到最後；S-A 的最後撤權使用既有受審計 owner 路徑及批准 reference，不能繞過 self-change 限制。每次撤權也要登記新的 audit／command。
3. 用 Storage API 刪除清單內的檔案，確認 object 不再可讀、listing 不殘留。不得直接刪 `storage.objects` 代替刪實體檔案，不移轉到真實用戶。Storage 所有權也可能阻擋 Auth user 刪除。[Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data)
4. 清除可刪的私人討論、來源、Brief、測試通知和可刪草稿；有 parent／child 關係時按已核對的 FK 順序。對受保護版本、workflow events、角色 audit／receipt、其依賴父列採保留，禁止用 CASCADE 強制刪除。
5. 正常產品帳號刪除採現有匿名化契約：creator 變為 deleted、私人工作室內容清除、登入身份匿名化並禁止登入，保留審計識別。這不是直接刪 `auth.users`；先驗證本輪的所有檔案與導出資料已處理，也驗證特殊「重試刪除」入口沒有其他權限。
6. 有審計／不可變歷史引用的帳號保持禁止登入、測試 staff／brand／角色均 inactive；workspace 及必要合成父列保留。workspace settings 標記已結束只供管理，不冒稱它會自動拒絕存取。
7. 僅對沒有引用、沒有 Storage 所有權且清單明確允許刪除的 Auth 身份，才透過 Admin API 刪除。其他帳號保留禁用回執，不以刪除失敗為由改外鍵或刪審計。
8. 撤銷專用 session／refresh token；以尚未到期的 token 驗證敏感 API、直接資料與檔案權限，再在實際 JWT／signed URL 到期後確認拒絕。未完成到期驗證前報告為 CLEANUP_PENDING_EXPIRY。
9. 關閉僅本輪建立的本機程序，移除本輪 session、密碼檔或短期憑證（若曾有），保留受保護的去敏結果。預設密碼只在記憶體使用。
10. 交付「已刪／已停用／依法則保留／未清理」逐表、逐 ID 清單。審計保留沿用現有產品政策，不臆造期限或承諾自動刪除。非測試列的前後 opaque hashes 若有變動先歸因；可能由真實用戶並行操作造成，不能擅自改回。無法歸因即不能宣稱完全保全。

清理失敗就停止後續寫入，回報精確殘留和下一步。備份只是事故復原資源；不是用整庫 restore 覆蓋真實用戶新資料的許可。

## 7. 重複索引：已完成依賴檢視，DDL 獨立處理

本次唯讀查詢確認兩個索引都是有效、ready、非 deferrable UNIQUE constraint 的 btree `(id, workspace_id)`；opclass、collation、排序、NULL 語意相同，沒有 predicate／expression。

| 索引／約束 | 目前依賴 | 建議 |
|---|---|---|
| creators_id_workspace_unique | 8 個 FK；release manifest 明確要求此約束 | 保留 |
| integration_creator_workspace_key | 自己的 UNIQUE constraint；未見 inbound FK／其他 catalog dependent | 作為待移除的重複約束候選 |

8 個 FK：
- public.mission_draft_assets — mission_draft_assets_creator_workspace_fk
- public.mission_publication_proof_attempts — mission_publication_proof_attempts_submitter_workspace_fk
- public.mission_publication_proof_assets — mission_publication_proof_assets_creator_workspace_fk
- public.integration_connections — integration_connections_creator_id_workspace_id_fkey
- private.integration_oauth_states — integration_oauth_states_creator_id_workspace_id_fkey
- private.integration_commands — integration_commands_creator_id_workspace_id_fkey
- private.integration_pilot_bindings — integration_pilot_bindings_creator_id_workspace_id_fkey
- private.integration_pilot_oauth — integration_pilot_oauth_creator_id_workspace_id_fkey

本機字串檢查只在新整合 migration 找到 `integration_creator_workspace_key` 的命名使用；未找到應用以該名稱作 ON CONFLICT ON CONSTRAINT 的依賴。這不是對未在分支中的外部程式的保證。

後續獨立索引變更包：

1. 再核對 live pg_index／pg_constraint／pg_depend、replica identity／extension membership、原 migration、release manifest、其他分支或部署對約束名的依賴及 DDL 鎖定情況。
2. 在本機的套用後 schema 演練保留舊 constraint、移除新重複 constraint，確認 8 個 FK 完整、RLS／grants／函式不變，跨 workspace FK、重複鍵及近期權限測試仍拒絕。不以 index 使用次數低作唯一刪除理由。
3. 候選是以 RESTRICT 移除 `public.creators.integration_creator_workspace_key` 的 constraint，讓 PostgreSQL 管理其 backing index；不是直接 DROP INDEX，也不是 DROP INDEX CONCURRENTLY。約束支援索引不能用 concurrent drop 移除。[PostgreSQL 17 DROP INDEX](https://www.postgresql.org/docs/17/sql-dropindex.html)
4. 新增獨立前向 migration，不改既有 92 份來源、已套用 review artifact 或歷史。附變更前後 schema digest、2 秒 lock timeout、30 秒 statement timeout、前置依賴 assertions，並於批准窗口才套用。
5. 提交前失敗以該交易 rollback；提交後如需恢復重複 constraint，使用另行批准且已本機演練的重建步驟，不對共用 DB整庫回復、不刪歷史、不自動重試 DDL。
6. 再查一次 duplicate-index advisory 和依賴；此項只處理這對重複約束，不附帶處理所有 unused-index／unindexed-FK 提示。

**索引 DDL 不是登入測試的前提。** 本輪可先保留兩個索引完成 Auth 測試；去重如獲批准，之後再跑受影響的外鍵／權限測試，不能沿用修改前的結果冒稱修改後通過。

## 8. 驗收、交付與批准單位

通過條件：

- 9 個專用身份以正常 Auth 登入；不靠 mock session、服務 key 或 SQL claim 替換使用者的正向測試。
- 自己、同 workspace、其他 workspace、匿名和受限角色矩陣有成功對照及拒絕證據；私人資料洩漏、越權修改或快取殘留為零。
- 手機及桌面的核心旅程有持久化重載證據；不把先前 mock 截圖當成這輪的實測。
- 未驗證來源、逐項分享和原任務保存行為正確；沒有合成資料被發放可用積分、現金、XP、徽章或完成真實兌換。
- 無真實 provider／外部 AI／寄信／部署；此結論有設定與請求觀測及零 provider 記錄相互印證。
- 全部寫入皆對應清單；清理完成或明確列出禁止登入且依法則保留的最小合成審計圖。尚待 token 到期、未知外送或清理失敗不能列完整 PASS。
- 最近修正及原有功能的針對性測試通過；未通過案例保留根因、重現步驟和預期修補範圍，不為了測試通過放寬權限。
- 九個 RPC 的每種情境分別標狀態；未做成功兌換／外部 provider／原生 Google 登入／實體裝置測試均保留 NOT_RUN。
- 索引 review 可通過但 DDL 仍未執行；兩項狀態分開。

批准後的執行順序：

1. **P0 準備**：完成精確 seed／cleanup 清單、readonly preflight、角色矩陣與本機演練；先修已能在本機證明的阻斷問題，保留分支近期改動。
2. **P1 登入及私人資料**：最多 9 帳號、2 workspace，真實 password login、bootstrap、私人 Brief、跨帳號 API／RLS 和持久化。
3. **P2 工作流程及裝置**：前置隔離條件通過後，合成任務／Storage／角色撤銷、手機桌面完整旅程；不做實際 reward／provider。
4. **P3 清理及報告**：刪除可刪內容、撤銷權限、禁止登入及精確審計保留、expiry 驗證；交付逐例證據與剩餘缺口。
5. **I 索引**：獨立 review／rehearsal；只有另行批准精確 DDL 後才套用。

交付物：
- 執行前的 fixture／cleanup manifest、目標與版本 preflight。
- 逐角色／資料物件／入口的 permission matrix。
- 去敏 API／RPC 結果、兩尺寸 UI 證據、持久化及 session 撤銷結果。
- 副作用與保全對帳、清理與保留資料回執。
- 索引依賴、候選前向 migration／回復設計和未執行狀態。
- 統一結論：AUTH_SCOPE_PASS、FAIL 或 BLOCKED，另列 NOT_RUN；不能用部分成功改稱整個 provider pilot 已通過。

目前仍未建立任何帳號、持久化 fixture、真實連接或新部署；這份文件不構成這些操作已執行的證據。

