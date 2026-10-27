# Adfocate 產品方向與設計規格

日期：2026-10-23（香港時間）。狀態：建議設計及可供實作的計劃；未實作、未部署。

## 1. 目標與證據

將 Adfocate 建成讓 Creator 可靠完成品牌任務、讓營運按優先次序處理交付的工作平台。首個產品成果是：Creator 完成一個任務的交付與發布證明，營運完成核對，雙方重載後均看見同一個「待財務處理」結果及可追溯證據。這個成果不包含實際付款。

依據是 `Adfocate_Audit_Test_Pack_2026-10-22.zip` 最新第 2 版，SHA-256：`0a9d6b96c5e7e216489b80abd45c28731d8e378eeaa6316158340e780bc859e8`。包內有 28 項發現、107 個案例；26 pass、34 fail、47 not-tested。39 個 production browser 案例為 21 pass、18 fail。7 個測試檔共 16 個驗收測試在稽核基線失敗；原 14 個合併執行，新增 2 個分開執行。這些數字是歷史證據，並非本計劃已完成的成果。

- Repository：`YNWAforever/Remix-Adfocate`。
- 稽核 baseline：`7cfa3dc84c821719a4dff754229a591c81786c53`；deployment：`dpl_71cmAPcWJAxQeDQNtHkvjRVPP4y6`。
- 本次規劃沒有重新確認最新 GitHub HEAD 或重新稽核 live；執行者須先記錄差異。
- 稽核時 staff 已成功登入；active workspace membership 為 0。這與 schema 缺失是兩個不同前置條件，不能只叫使用者再登入。
- 已知缺少 `mission_workflows`、`mission_work_items`、`mission_reward_contracts`、`mission_pending_rewards`、`mission_completion_decisions` 及 `missions.creator_workflow_mode`；不可推斷其他未查物件必然齊備或全部缺失。

補充 source 限制：`0023_brand_access.sql` 的 `brand_users.user_id` 是主鍵，目前每個帳戶只支援一個品牌 membership；角色只有 owner/member。後續proof migration只補(user_id,workspace_id) unique約束，沒有移除user_id主鍵。Reviewer、Finance 等是本計劃提出的營運職責，不是已存在的完整權限產品。`deriveNextAction()`、activation cards、proof review、reward handoff 與 release foundation 已有實作，應延伸現有模組。

## 2. Brainstorm：三條路線及選擇

| 路線 | 可得到甚麼 | 代價／限制 | 決定 |
|---|---|---|---|
| A. 完整任務流程先行 | 修復工作消失、交付及審批，建立可驗證成果；再改善每日工作台 | 前期要處理 schema、版本及權限 | **採用**；先讓一個任務可靠完成 |
| B. 全站視覺重做 | 快速改善外觀和導覽一致性 | 原有空白、錯誤狀態及資料不一致仍存在；大改易混入回歸 | 保留現有黑邊、螢光黃識別，只針對工作頁改善 |
| C. AI／匹配／增長先行 | 容易示範新能力 | 建議可能建立在不完整任務狀態上；難以證明業務結果 | 先修現有 AI 保存可靠性，進階輔助放後期 |

## 3. 建議功能優先次序

| 產品想法 | 使用者結果 | 排期 | 如何驗證價值 |
|---|---|---|---|
| Creator「下一步工作」 | 登入即知哪一份稿要改、哪項 proof 要補 | R2，沿用現有 next-action engine | 任務開始頁到當前交付不超過兩次主要操作 |
| 營運「今日待辦」 | 先處理逾期、本人負責及未分派工作，直達個案 | R2，延伸 radar/queue | 無重新搜尋即可開啟正確工作項 |
| 交稿前檢查 | Creator 看見欠缺網址、資產、disclosure或必要 checklist | R1 deterministic rules；R3 可加 AI 解釋 | 必填錯誤送出前可定位，server仍獨立驗證 |
| 任務模板及 Creator 預覽 | 同事不需手寫JSON便可建立任務 | R2 | 建立、重載、預覽及Creator實際頁一致 |
| 審批決策紀錄 | 看見版本、修改原因、操作者及結果 | R1/R2 | 同一操作只產生一份持久化結果，失敗可重試 |
| 獎勵進度說明 | 分辨已承諾、待財務處理與實際錢包餘額 | R1 | pending/cancel不改既有ledger、餘額或預算 |
| 單一社交帳戶卡 | 分清自填、已同步、已驗證及失敗 | R2 | Profile與Passport同源，不自動提升可信狀態 |
| 可完成的微課程 | 按任務需要學習一個單元，回來仍見進度 | R3；R2先移除無內容承諾 | 真正內容、單元完成、重載及資格測試 |
| AI brief coach／審稿摘要 | 解釋任務要求及整理版本差異，附來源 | R3，feature flag預設關閉 | 有引用、權限隔離、故障降級及人手確認 |
| 跨品牌控制台／對外MCP／自動付款 | 更廣平台能力 | 不在本次首輪實作 | 需獨立角色、合約、整合及商業規格 |

本計劃不新增自動社交發布、真實付款、付費訂閱、多品牌資料共用、AI自動批准或批量獎賞。它們不應被悄悄放入修復PR。

## 4. 分期及產品完成條件

| 階段 | 交付 | Gate |
|---|---|---|
| R0 基線 | 最新版本差異、測試基線、隔離目標、固定測試時鐘 | 不把舊失敗直接假定仍存在；不覆蓋現有工作 |
| R1 核心流程 | schema相容、workspace scope、錯誤可恢復、有效交付、原子審批、pending reward | Legacy與active各有完整隔離E2E；所有16個稽核回歸在對應修復後通過 |
| R2 每日營運 | Creator工作首頁、Ops工作台、分頁/返回、可讀表單、社交一致性、品牌及內容誠實性 | 非工程同事與Creator完成指定工作；手機、鍵盤、效能及權限證據齊備 |
| R3 輔助與學習 | 真正課程單元、受限AI工作輔助 | R1/R2穩定；有核准內容／離線AI評估與試行結果 |
| 發布準備 | 同SHA應用、schema manifest、測試與runtime證據、復原演練 | 遵守現有release foundation；是否發布依當次授權 |

R1亦修復分頁及香港日期標籤等既有回歸，R2再全面改善工作首頁與作者體驗。R1可在已授權的單一workspace做受控內部pilot；這不是全站SaaS放行。R2對外擴大使用前完成職責權限及所有支援功能驗收。R3可獨立延期，不拖延核心修復。

## 5. Creator 體驗規格

### 首頁及我的任務

首頁先顯示本人可執行的下一項工作、截止時間及主CTA；等候營運審批時明說正在等候，不提供再次加入。推薦任務、積分、學習內容排其次。使用 `useCreatorActivation`、`ActiveMissionSummary`、`NextBestActionCard` 及 `deriveNextAction(ActiveMissionWorkspace)`；不得另造平行狀態機。

我的任務須覆蓋現有每個 SubmissionStatus，含 applied與declined；active workflow/work item狀態與legacy狀態分開映射。未知狀態顯示可求助的不可判定狀態，不能默認未加入。讀取失敗與真實空清單分開；有舊資料時標示未更新並允許重試。

手機主導航：首頁、找任務、我的任務、錢包、更多。其餘既有路由保留在更多內；所有入口仍可達。桌面側欄明確提供我的任務。`/wallet/earnings`修正至有效錢包路由，舊連結採兼容redirect或明確路由映射。

### 任務決策及交付

列表與詳情共用獎勵、資格、平台、交付、投入、截止及名額資料契約；缺少資料顯示未提供，不把null當0或無門檻。分類須涵蓋既有寵物／旅遊，保留舊值及明確mapping。

Legacy只接受有效HTTP(S)絕對作品網址；未知原始來源的舊無效記錄不能普通批准。Active交付保持既有收貨、版本、必填checklist、稿件及proof流程。草稿有保存結果、保存時間與revision；409保留本地稿並提供比較／重載，不能自動覆蓋新版本。

以`revision_requested`優先提示修稿；`approved_to_publish`表示可發布，並非任務完成；`proof_verified`尚需營運完成核對；`reward_pending`只表示待財務處理。取消handoff回到重新核對，不顯示「退款」或「扣回已付款」。

## 6. 營運體驗規格

- 共用Admin shell，頂部顯示workspace、頁名及角色可用能力。只有一個可用workspace時顯示其名稱；All只能表示授權範圍集合，不能代表全庫。
- 今日待辦延伸現有radar與active queue，按逾期、到期及未分派分組；日期顯示使用Asia/Hong_Kong。每列直達正確submission/work item並保留返回來源。
- Creator queue每頁25筆；26/51筆必須可達，穩定排序加ID tie-breaker。q/status/risk/sort/page/ws放URL；修改filter重設page=1，換workspace清除舊資料cache。
- 返回詳情保留workspace、篩選、頁數及焦點。歷史actor顯示可讀名稱或「未提供」，不把UUID當日常主要文案。內部狀態轉成中英文標籤。
- 每個mutation有pending、成功、失敗及衝突狀態；保留輸入，避免重複click。Flag要求具體理由及影響說明，取消不送出。
- 任務編輯以交付項目、所需平台、必需disclosure、審稿期限、發布期限等欄位組成；JSON僅為授權進階編輯，不能是日常必經步驟。編輯已存在未知JSON key不得默默刪除。
- 批量動作只先考慮低風險「分派負責人」，每列顯示獨立結果；批量批准、Flag及發獎不在首輪。

## 7. 資料與授權設計

沿用 React 19、TypeScript、Vite、Tailwind、TanStack Router/Query、Hono、Supabase/Postgres及Vitest。這是基線stack描述，並非建議升級版本；用repo lockfile。Node22是既有release runbook基準，另記錄Vercel Node24.x差異，發布前驗證相容。

先對照實際objects、RPC、grants、RLS及migration history，再做向前migration。歷史表已存在但migration未記錄時，不得盲目重播；既有migration不改checksum。兩個隔離DB分別證明空庫及production-shaped相容。不要把正式資料複製為fixtures。

R1的workspace-owned後台資源讀寫由有效staff身份及active brand_users membership限定workspace；resource本身的workspace在server核對，不能信任body或URL。`viaSecret`不得作為interactive human identity。域名符合不再等於自動獲得日常營運能力；正式舊staff銜接須由owner審核，不在migration自動grant。

Academy是沒有workspace_id的global內容，不能以workspace filter假裝隔離；published Creator內容維持既有資格規則。R1保留global內容的staff gate，R2將draft讀取及寫入收緊為明確platform content_editor grant；普通workspace admin不繼承平台內容權限。

R2新增營運職責能力時，與品牌owner/member分開：workspace_admin可管理該workspace設定、operator/reviewer只可處理已授權工作、finance_viewer只能讀pending handoff。明確新增grant記錄及audit，不把brand owner默認提升為平台admin。保持當前每人一個workspace的membership限制；一人多workspace另立migration與全面call-site計劃，不在本輪偷改主鍵。

CRM review/note/audit以單一transaction提交；同一邏輯操作使用穩定idempotency key；同key不同payload回409，舊revision回409，transport retry回同一結果。表內workspace和actor由可信server身份決定。資料庫RPC本身亦需驗證scope及grants，不能只靠前端。

Reward沿用既有RPC與不可變contract。當時承諾不可從今日mission設定推算；無歷史證據的contract繼續阻擋。pending/cancel操作前後points、XP、earnings、budget、redemption、legacy status及ledger counts保持相等。通知失敗獨立重試既有通知，不能重送完成指令。

## 8. 內容、社交與AI

對外品牌建議統一為Adfocate；KOCmax如需保留作歷史產品名，只作明確遷移說明。登入用同一電郵識別步驟，密碼／magic link作不同方式；保留安全的站內返回路徑。

社交帳戶以canonical account projection整合legacy handle及新account資料；冲突顯示兩個來源並由用戶確認，不自動覆蓋或標成擁有權已驗證。Profile保存、Passport及公開欄位使用同一projection。

R2把聯絡頁明確維持示範並移除「已記錄」假象，直到業務owner提供真實收件destination再啟用lead intake。行銷數字沒有來源便移除或標示示範；XP/level只取canonical engine。空正文課程不再承諾4堂可完成課程，可顯示準備中；原有真實內容保留。R3才以核准的單元內容及持久化進度提供正式課程。

先修現有assistant的生成／保存結果、history讀取錯誤、限流及有界輸入。R1設計預設上限為4,000 Unicode code points/訊息、每人每workspace每分鐘5次新generation、同時1次generation、30秒provider timeout；這些是建議可配置產品預設值，不是現況。以共享持久化quota／request記錄處理多instance，不能只用process記憶體。保留同一client_request_id，避免重試重複生成；不能承諾跨provider crash邊界的exactly-once計費，需記錄unknown outcome並不自動重叫。

R3優先兩項：Creator「解釋這個brief／下一步」及operator「整理修改差異」。AI只可使用該角色、該workspace、該版本允許的資料；回覆引用來源／版本、區分規則與建議。無資料便說不知道。AI不批准、不改分數、不發獎、不自行公開內容，不能以流暢文字代替確定性驗證。KB或作品中的指令視作內容，不得擴展tools。

## 9. 驗收與量度

所有目標是本計劃的建議門檻，未曾在production量測：

| 指標 | 定義／門檻 | 證據 |
|---|---|---|
| 核心流程 | 同run_id下Creator交付→修稿→proof→operator完成→雙方重載一致 | UI、API、DB及neutrality snapshots |
| 可追溯性 | 每次成功業務變更有唯一actor/revision/request/decision關聯 | fault、retry、concurrency integration |
| 狀態真實性 | 所有已支援頁區分loading/empty/error/forbidden/stale | fixture及瀏覽器情境 |
| 日常操作 | Creator首頁到當前工作≤2次主要操作；radar到指定個案≤1次 | 實際操作記錄 |
| 可靠度 | 0次未授權跨workspace讀寫；0次重複reward/CRM邏輯結果 | 正反權限與重送測試 |
| 手機／鍵盤 | 360/390/768px、200%zoom，無主要流程遮蓋；完整可用鍵盤 | 瀏覽器證據；44px是設計目標，非已通過的標準認證 |
| 效能 | 建議p95 list API<800ms；LCP<2.5s、INP<200ms、CLS<0.1 | 固定環境；1k/10k合成Creator；API至少100請求，UI≥20次互動；少於樣本只報raw結果 |
| AI | 24組固定golden cases；安全邊界與未知拒答100%，答案rubric≥90% | mock故障＋經另行核准的真實provider評估，含用量 |

產品pilot另量度：首次接單到首次有效交稿的時間、首次審稿接受率、每份交付的修稿輪數、逾期比例、每件營運處理時間、因狀態不明產生的求助數。先記錄基線，再討論改善幅度；不承諾沒有數據支持的轉化率提升。

## 10. 範圍及執行約定

本次只交付規格、計劃及交接包。未把文件寫入repo、未開PR、未commit、未執行migration或部署。未來執行以使用者的當次授權為準。

建議首輪交給Codex GPT‑6.1 Sol的範圍：先R0，再R1，持續完成同範圍內可做的local改碼、測試及已核實隔離環境驗收；受存取阻擋時繼續獨立任務。不要每修一項便重新詢問。正式membership授權、DB migration、push/merge/deploy、對外訊息、付款及付費AI仍依當次授權處理。

保留既有 `production-release-foundation.md` 的具體manifest、preflight、rehearsal、evidence expiry及release approval流程；本規劃不能代替該流程所需的當次具體授權。
